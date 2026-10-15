"""Independent read-only TWS socket connector. Run beside the authenticated Gateway.

No login automation, brokerage credentials, account payloads or trading API exist
in this module. Only validated SPY TRADES bars and connection metadata are relayed.
"""
from __future__ import annotations

import argparse
import asyncio
import ipaddress
import json
import logging
import math
import os
import re
import socket
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import requests
from ib_async import IB, Stock, StartupFetchNONE

from api.ibkr_relay_auth import PATH, sign
from api.ibkr_tws_schema import Candle, RelayPayload

LOG = logging.getLogger("marketbos.tws")


def flag(name, default="false"):
    value = os.getenv(name, default).lower()
    if value not in {"true", "false"}:
        raise ValueError(f"{name} must be true or false")
    return value == "true"


def private_host(host):
    # Resolve once and pass this same address to connectAsync to avoid DNS rebinding.
    addresses = {row[4][0] for row in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)}
    networks = [ipaddress.ip_network(v) for v in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")]
    if not addresses:
        raise ValueError("Gateway host did not resolve")
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_loopback and not any(ip in net for net in networks):
            raise ValueError("Gateway socket host must resolve exclusively to loopback or private addresses")
    return sorted(addresses)[0]


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    client_id: int
    environment: str
    duration: str
    use_rth: bool
    timeout: float
    retry_min: float
    retry_max: float
    relay_url: str
    relay_secret: str
    connector_id: str
    heartbeat: float
    history_interval: float = 60

    @classmethod
    def from_env(cls):
        if not flag("IBKR_TWS_ENABLED") or not flag("IBKR_RELAY_ENABLED"):
            raise ValueError("Enable IBKR_TWS_ENABLED and IBKR_RELAY_ENABLED explicitly on the connector")
        if not flag("IBKR_TWS_READONLY", "true"):
            raise ValueError("Only read-only mode is supported")
        if os.getenv("IBKR_SYMBOL", "SPY").strip().upper() != "SPY" or os.getenv("IBKR_BAR_SIZE", "1 min") != "1 min":
            raise ValueError("This connector subscribes to SPY 1 min only; other chart timeframes are explicitly aggregated on the backend")
        env = os.getenv("IBKR_TWS_ENVIRONMENT", "live").lower()
        application = os.getenv("IBKR_TWS_APPLICATION", "gateway").lower()
        if env not in {"live", "paper"} or application not in {"gateway", "tws"}:
            raise ValueError("Invalid environment or Gateway/TWS application")
        default_port = {("gateway", "live"): 4001, ("gateway", "paper"): 4002, ("tws", "live"): 7496, ("tws", "paper"): 7497}[(application, env)]
        port = int(os.getenv("IBKR_TWS_PORT", str(default_port)))
        client = int(os.getenv("IBKR_TWS_CLIENT_ID", "11"))
        if not 1 <= port <= 65535 or not 1 <= client <= 2147483647:
            raise ValueError("Invalid socket port or client ID; ID zero is prohibited")
        duration = os.getenv("IBKR_HISTORY_DURATION", "1 D")
        if not re.fullmatch(r"[1-5] D", duration):
            raise ValueError("Use a bounded historical lookback of 1 D through 5 D")
        url = os.getenv("IBKR_RELAY_BACKEND_URL", "").rstrip("/")
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
            raise ValueError("Relay backend must be an HTTPS origin without credentials, path, query or fragment")
        key = os.getenv("IBKR_RELAY_SECRET", "")
        if len(key) < 32:
            raise ValueError("Dedicated IBKR_RELAY_SECRET must be at least 32 characters")
        timeout = float(os.getenv("IBKR_TWS_TIMEOUT_SECONDS", "15"))
        low = float(os.getenv("IBKR_TWS_RECONNECT_MIN_SECONDS", "30"))
        high = float(os.getenv("IBKR_TWS_RECONNECT_MAX_SECONDS", "300"))
        heartbeat = float(os.getenv("IBKR_TWS_HEARTBEAT_SECONDS", "20"))
        if not all(math.isfinite(v) for v in (timeout, low, high, heartbeat)) or not 2 <= timeout <= 60 or not 15 <= low <= high <= 900 or not 10 <= heartbeat <= 30:
            raise ValueError("Invalid timeout, pacing/backoff or heartbeat settings")
        connector = os.getenv("IBKR_RELAY_CONNECTOR_ID", "marketbos-spy")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", connector):
            raise ValueError("Invalid connector ID")
        return cls(private_host(os.getenv("IBKR_TWS_HOST", "127.0.0.1")), port, client, env, duration, flag("IBKR_USE_RTH"), timeout, low, high, url, key, connector, heartbeat)

    def delay(self, attempt):
        return min(self.retry_max, self.retry_min * 2 ** min(attempt, 10))


class MarketDataIB(IB):
    async def reqPositionsAsync(self):
        # ib_async 2.1 connectAsync requests positions even with StartupFetchNONE.
        # Disable that synchronization; it is unrelated to this market-data client.
        return []


def classify_error(code, message=""):
    lower = message.lower()
    if code in {10197} or any(v in lower for v in ("not authenticated", "authentication required", "not logged in")):
        return "authentication_required", True
    if code in {354, 10167, 10168, 10186, 10187} or (code == 162 and any(v in lower for v in ("permission", "subscription", "not subscribed"))):
        return "subscription_required", True
    if code == 162 and "pacing" in lower or code == 420:
        return "pacing_limited", False
    if code in {200, 326, 1300, 321}:
        return "contract_error", True
    if code in {1100, 502, 504, 2103, 2105}:
        return "gateway_disconnected", False
    if code in {1101, 10182, 10225}:
        return "resubscribe", False
    if code in {1102, 2104, 2106, 2107, 2108, 2158}:
        return "informational", False
    return "data_error", code in {162, 165, 366}


def exchange_schedule(details, use_rth):
    # Calendar comes from IBKR contract details, including holidays/early closes.
    aliases = {"EST": "America/New_York", "EST5EDT": "America/New_York"}
    try:
        zone = ZoneInfo(aliases.get(details.timeZoneId, details.timeZoneId))
    except KeyError:
        raise ValueError("Unknown IBKR exchange timezone") from None
    raw = details.liquidHours if use_rth else details.tradingHours
    result = []
    for part in raw.split(";"):
        if not part:
            continue
        day, sessions = part.split(":", 1)
        start = datetime.strptime(day, "%Y%m%d").replace(tzinfo=zone)
        end = start + timedelta(days=1)
        intervals = []
        if sessions != "CLOSED":
            for session in sessions.split(","):
                left, right = session.split("-")
                def parse(value):
                    value = value if ":" in value else day + ":" + value
                    return datetime.strptime(value, "%Y%m%d:%H%M").replace(tzinfo=zone)
                a, b = parse(left), parse(right)
                if b <= a:
                    b += timedelta(days=1)
                # SPY does not have overnight sessions. Reject rather than guess.
                if a < start or b > end:
                    raise ValueError("Unsupported overnight SPY schedule")
                intervals.append([int(a.timestamp()), int(b.timestamp())])
        result.append({"start": int(start.timestamp()), "end": int(end.timestamp()), "intervals": intervals})
    return result[:14]


def convert_bar(bar, completed, updated_at=None):
    if not isinstance(bar.date, datetime) or bar.date.tzinfo is None:
        raise ValueError("TWS formatDate=2 must return timezone-aware intraday dates")
    epoch = int(bar.date.astimezone(timezone.utc).timestamp())
    return Candle(epoch=epoch, open=float(bar.open), high=float(bar.high), low=float(bar.low), close=float(bar.close), volume=float(bar.volume), completed=completed, updatedAt=float(updated_at or time.time())).model_dump()


class Connector:
    def __init__(self, config, ib=None):
        self.config = config
        self.ib = ib or MarketDataIB()
        self.ib.RaiseRequestErrors = True
        self.boot_id = uuid.uuid4().hex
        self.sequence = 0
        self.state = "gateway_disconnected"
        self.error_code = None
        self.subscribed = False
        self.paused = False
        self.resubscribe = False
        self.contract = None
        self.schedule = []
        self.last_data_update = None
        self.last_disconnect = None
        self.gap_limited = False
        self.bars = None
        self.realtime_ticker = None
        self.tick_cursor = 0
        self.realtime_minutes = {}
        self.last_history_request = None
        self.subscription_failures = 0
        self.known = {}
        self.pending = {}
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.headers.update({"Content-Type": "application/json"})
        self.relay_failed = False
        self.stop = asyncio.Event()
        self.data_changed = asyncio.Event()
        self.ib.errorEvent += self.on_error
        self.ib.disconnectedEvent += self.on_disconnect

    def on_error(self, req_id, code, message, contract=None):
        state, pause = classify_error(code, message)
        if state == "informational":
            if code in {2104, 2106, 1102} and not self.paused and self.state == "gateway_disconnected":
                self.resubscribe = True
            return
        if state == "resubscribe":
            self.resubscribe = True
            return
        self.state, self.error_code = state, code
        self.paused = self.paused or pause
        if state in {"data_error", "pacing_limited"} and not pause:
            self.resubscribe = True
        self.subscribed = False
        self.data_changed.set()
        LOG.warning("IBKR market-data status=%s code=%s; manual intervention=%s", state, code, pause)

    def on_disconnect(self):
        if not self.paused:
            self.state = "gateway_disconnected"
        self.subscribed = False
        self.last_disconnect = self.last_disconnect or time.time()
        self.data_changed.set()

    def capture(self, bars, has_new_bar=False, initial=False):
        now = time.time()
        rows = bars if initial else bars[-2:]
        for bar in rows:
            stamp = int(bar.date.timestamp()) if isinstance(bar.date, datetime) else 0
            completed = stamp + 60 <= now or (has_new_bar and bar is not bars[-1])
            candle = convert_bar(bar, completed, now)
            prior = self.known.get(candle["epoch"])
            compare = lambda row: {k: v for k, v in row.items() if k != "updatedAt"}
            if prior and compare(prior) == compare(candle):
                continue
            self.known[candle["epoch"]] = candle
            self.pending[candle["epoch"]] = candle
            self.last_data_update = now
            self.data_changed.set()
        if len(self.known) > 20000:
            for epoch in sorted(self.known)[:-20000]:
                self.known.pop(epoch, None)
        if not self.paused and self.state not in {"gateway_disconnected", "pacing_limited"}:
            self.state = "connected" if bars else "waiting_for_data"

    def on_bars(self, bars, has_new_bar):
        try:
            self.capture(bars, has_new_bar)
        except (ValueError, TypeError):
            self.state = "data_error"
            LOG.error("Invalid provider candle rejected; no synthetic replacement")

    def on_trade_ticks(self, ticker):
        # IBKR tick-by-tick Last trades; never synthesize missing trades.
        ticks = ticker.tickByTicks
        if len(ticks) < self.tick_cursor:
            self.tick_cursor = 0
        for tick in ticks[self.tick_cursor:]:
            try:
                stamp = int(tick.time.timestamp())
                epoch = stamp - stamp % 60
                now = time.time()
                price, size = float(tick.price), float(tick.size)
                if not (math.isfinite(price) and math.isfinite(size) and price > 0 and size >= 0):
                    continue
                if epoch > now + 5 or epoch < now - 180:
                    continue
                prior = self.realtime_minutes.get(epoch)
                if prior and stamp < prior["last_stamp"]:
                    continue
                if prior:
                    candle = dict(prior["candle"])
                    candle.update(high=max(candle["high"], price), low=min(candle["low"], price),
                                  close=price, volume=candle["volume"] + size)
                else:
                    candle = dict(epoch=epoch, open=price, high=price, low=price,
                                  close=price, volume=size, completed=False)
                candle["updatedAt"] = now
                candle = Candle.model_validate(candle).model_dump()
                self.realtime_minutes[epoch] = {"last_stamp": stamp, "candle": candle}
                for old_epoch in list(self.realtime_minutes):
                    if old_epoch < epoch - 60:
                        self.realtime_minutes.pop(old_epoch, None)
                self.known[epoch] = candle
                self.pending[epoch] = candle
                self.last_data_update = now
                self.data_changed.set()
                self.state = "connected"
            except (ValueError, TypeError, AttributeError):
                LOG.warning("Invalid IBKR trade tick rejected")
        self.tick_cursor = len(ticks)

    def finalize(self):
        # Completion is metadata only: never invent/alter OHLCV or refresh data age.
        for epoch, candle in list(self.known.items()):
            if not candle['completed'] and epoch + 60 <= time.time():
                revised = {**candle, 'completed': True}
                self.known[epoch] = revised
                self.pending[epoch] = revised

    def lookback(self):
        days = int(self.config.duration.split()[0])
        if self.last_disconnect:
            needed = math.ceil((time.time() - self.last_disconnect) / 86400) + 1
            self.gap_limited = needed > 5
            days = max(days, min(5, needed))
        return f"{days} D"

    async def establish(self):
        await self.ib.connectAsync(self.config.host, self.config.port, clientId=self.config.client_id, timeout=self.config.timeout, readonly=True, fetchFields=StartupFetchNONE, raiseSyncErrors=True)
        contracts = await asyncio.wait_for(self.ib.qualifyContractsAsync(Stock("SPY", "SMART", "USD")), self.config.timeout)
        contract = contracts[0] if len(contracts) == 1 else None
        if not contract or contract.conId <= 0 or contract.symbol != "SPY" or contract.secType != "STK" or contract.currency != "USD" or contract.exchange != "SMART":
            self.paused, self.state = True, "contract_error"
            raise ValueError("SPY contract qualification failed")
        self.contract = contract
        await self.subscribe()

    async def subscribe(self):
        if self.realtime_ticker is not None:
            self.realtime_ticker.updateEvent -= self.on_trade_ticks
            if self.ib.isConnected():
                self.ib.cancelTickByTickData(self.realtime_ticker.contract, "Last")
            self.realtime_ticker = None
        self.tick_cursor = 0
        self.realtime_minutes.clear()
        if self.bars is not None:
            self.bars.updateEvent -= self.on_bars
            if self.ib.isConnected():
                self.ib.cancelHistoricalData(self.bars)  # Data subscription only.
        details = await asyncio.wait_for(self.ib.reqContractDetailsAsync(self.contract), self.config.timeout)
        if len(details) != 1:
            raise ValueError("Ambiguous exchange schedule")
        self.schedule = exchange_schedule(details[0], self.config.use_rth)
        self.ib.reqMarketDataType(1)  # Never request delayed/frozen fallback.
        if self.last_history_request is not None:
            interval = max(self.config.history_interval, self.config.delay(self.subscription_failures) if self.subscription_failures else 0)
            await asyncio.sleep(max(0, interval - (time.monotonic() - self.last_history_request)))
        self.last_history_request = time.monotonic()
        bars = await self.ib.reqHistoricalDataAsync(self.contract, endDateTime="", durationStr=self.lookback(), barSizeSetting="1 min", whatToShow="TRADES", useRTH=self.config.use_rth, formatDate=2, keepUpToDate=True, timeout=60)
        if self.paused:
            if bars is not None:
                self.ib.cancelHistoricalData(bars)
            return
        if not bars:
            self.ib.cancelHistoricalData(bars)
            self.subscribed = False
            self.state = 'waiting_for_data'
            self.resubscribe = True
            self.subscription_failures += 1
            return
        self.subscription_failures = 0
        self.error_code = None
        self.bars = bars
        self.bars.updateEvent += self.on_bars
        self.subscribed = True
        self.state = "connected" if bars else "waiting_for_data"
        self.capture(bars, initial=True)
        self.realtime_ticker = self.ib.reqTickByTickData(self.contract, "Last", 0, False)
        self.realtime_ticker.updateEvent += self.on_trade_ticks
        self.last_disconnect = None
        self.resubscribe = False

    def payload(self, batch):
        self.sequence += 1
        return RelayPayload(connectorId=self.config.connector_id, bootId=self.boot_id, sequence=self.sequence, environment=self.config.environment, useRTH=self.config.use_rth, state=self.state, connected=self.ib.isConnected(), subscribed=self.subscribed and self.ib.isConnected(), conid=self.contract.conId if self.contract else 0, errorCode=self.error_code, lastDataUpdate=self.last_data_update, schedule=self.schedule, candles=batch, gapRecoveryLimited=self.gap_limited)

    def post(self, payload):
        body = payload.model_dump_json().encode()
        stamp, nonce = str(int(time.time())), uuid.uuid4().hex
        headers = {"X-IBKR-Timestamp": stamp, "X-IBKR-Nonce": nonce, "X-IBKR-Signature": sign(body, stamp, nonce, self.config.relay_secret)}
        response = self.session.post(self.config.relay_url + PATH, data=body, headers=headers, timeout=15, allow_redirects=False)
        if response.status_code in {401, 403}:
            raise PermissionError("Relay authentication rejected; verify dedicated secret and clock")
        if response.status_code != 200:
            raise ConnectionError(f"Relay unavailable (HTTP {response.status_code})")
        acknowledgement = response.json()
        if acknowledgement.get("accepted") is not True:
            raise ConnectionError("Relay acknowledgement missing")
        return acknowledgement

    def acknowledge(self, batch, acknowledgement):
        # Do not erase a newer callback revision while an older HTTPS batch is in flight.
        for candle in batch:
            if self.pending.get(candle['epoch']) == candle:
                self.pending.pop(candle['epoch'], None)
        if acknowledgement.get('needsBackfill'):
            self.pending.update(self.known)

    async def relay_loop(self):
        failures = 0
        while not self.stop.is_set():
            self.data_changed.clear()
            batch = [self.pending[key] for key in sorted(self.pending)[:500]]
            try:
                self.finalize()
                acknowledgement = await asyncio.to_thread(self.post, self.payload(batch))
                self.acknowledge(batch, acknowledgement)
                failures = 0
                self.relay_failed = False
                delay = 2 if self.pending else self.config.heartbeat
            except PermissionError:
                self.relay_failed = True
                LOG.error("Relay authorization failed; connector stopped. No secret logged.")
                self.stop.set()
                return
            except (requests.RequestException, ConnectionError, ValueError):
                self.relay_failed = True
                LOG.warning("HTTPS relay unavailable; retaining pending real candles")
                delay = self.config.delay(failures)
                failures += 1
            if len(self.pending) > 20000:
                # Retain bounded history; expose the recovery horizon rather than fill gaps.
                self.gap_limited = True
                for epoch in sorted(self.pending)[:-20000]:
                    self.pending.pop(epoch, None)
            if failures:
                try:
                    await asyncio.wait_for(self.stop.wait(), delay)
                except asyncio.TimeoutError:
                    pass
            else:
                # Wake on genuine data/status changes; cap batches at one every 2s.
                try:
                    await asyncio.wait_for(self.stop.wait(), min(2, delay))
                except asyncio.TimeoutError:
                    pass
                if not self.pending and not self.stop.is_set():
                    changed = asyncio.create_task(self.data_changed.wait())
                    stopped = asyncio.create_task(self.stop.wait())
                    try:
                        await asyncio.wait((changed, stopped), timeout=max(0, delay - 2), return_when=asyncio.FIRST_COMPLETED)
                    finally:
                        changed.cancel()
                        stopped.cancel()
                        await asyncio.gather(changed, stopped, return_exceptions=True)

    async def run(self):
        relay_task = asyncio.create_task(self.relay_loop())
        attempts, last_subscription = 0, 0.0
        last_schedule_refresh = 0.0
        try:
            while not self.stop.is_set():
                if self.paused:
                    # Keep reporting the precise condition without attempting login/reconnect.
                    await asyncio.sleep(self.config.heartbeat)
                    continue
                try:
                    if not self.ib.isConnected():
                        await self.establish()
                        attempts = 0
                        last_subscription = time.monotonic()
                        last_schedule_refresh = time.monotonic()
                    if self.resubscribe or self.state == "pacing_limited":
                        wait = max(0, 60 - (time.monotonic() - last_subscription))
                        await asyncio.sleep(wait)
                        await self.subscribe()  # Full bounded historical backfill and resubscription.
                        last_subscription = time.monotonic()
                    if time.monotonic() - last_schedule_refresh >= 21600:
                        details = await asyncio.wait_for(self.ib.reqContractDetailsAsync(self.contract), self.config.timeout)
                        if len(details) == 1:
                            self.schedule = exchange_schedule(details[0], self.config.use_rth)
                        last_schedule_refresh = time.monotonic()
                    await asyncio.wait_for(self.ib.reqCurrentTimeAsync(), self.config.timeout)
                    await asyncio.sleep(self.config.heartbeat)
                except Exception as error:
                    code = getattr(error, "code", None)
                    if code is not None:
                        self.on_error(-1, int(code), str(error))
                    if isinstance(error, (ValueError, TypeError)):
                        self.paused, self.state = True, "data_error"
                    if not self.paused:
                        self.state = "gateway_disconnected"
                    self.ib.disconnect()
                    LOG.warning("Gateway connection/data request unavailable; state=%s", self.state)
                    await asyncio.sleep(self.config.delay(attempts))
                    attempts += 1
        finally:
            self.stop.set()
            self.ib.disconnect()
            relay_task.cancel()
            await asyncio.gather(relay_task, return_exceptions=True)
            self.session.close()


def main():
    parser = argparse.ArgumentParser(description="Read-only SPY TWS market-data relay")
    parser.add_argument("--env-file", default=None, help="Local ignored connector configuration file")
    parser.add_argument("--check-config", action="store_true", help="Validate settings without opening a socket")
    args = parser.parse_args()
    if args.env_file:
        from dotenv import load_dotenv
        load_dotenv(args.env_file, override=False)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        config = Config.from_env()
    except (ValueError, OSError):
        parser.exit(2, "Invalid connector configuration; check the example and enabled flags. Secrets are never printed.\n")
    if args.check_config:
        print(json.dumps({"valid": True, "readOnly": True, "symbol": "SPY", "barSize": "1 min", "environment": config.environment, "port": config.port}))
        return
    try:
        asyncio.run(Connector(config).run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
