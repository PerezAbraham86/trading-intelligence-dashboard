"""Read-only Client Portal Gateway adapter. Login stays with IBKR's gateway."""
from __future__ import annotations

import asyncio
import copy
import json
import math
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

import requests
from fastapi import HTTPException

IBKR_BASE_URL = os.getenv("IBKR_BASE_URL", "").rstrip("/")
_TIMEOUT = float(os.getenv("IBKR_TIMEOUT_SECONDS", "15"))
_LOCK = threading.RLock()
_SESSION = requests.Session()
_SESSION.trust_env = False
_CACHE: dict[str, tuple[float, Any]] = {}
_LAST_REQUEST = 0.0
_LAST_KEEPALIVE = 0.0
BAR_SIZES = {"1m": "1min", "3m": "3min", "5m": "5min", "10m": "10min", "15m": "15min", "30m": "30min", "1h": "1h", "2h": "2h", "4h": "4h", "1d": "1d", "1w": "1w"}


def normalize_symbol(symbol: str) -> str:
    raw = str(symbol).upper().strip().split(":")[-1]
    return {"MES": "MES1!", "MES1": "MES1!", "/MES": "MES1!", "ES": "ES1!", "ES1": "ES1!"}.get(raw, raw)


def contract_id(symbol: str) -> int:
    try:
        mapping = json.loads(os.getenv("IBKR_CONID_MAP", "{}"))
        value = mapping.get(normalize_symbol(symbol))
        if value is None and normalize_symbol(symbol) == "MES1!":
            value = os.getenv("IBKR_MES_CONID")
        conid = int(value)
        if conid <= 0:
            raise ValueError()
        return conid
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(503, "Configure IBKR_CONID_MAP with the exact IBKR contract ID (including the futures expiry).")


def request_json(path: str, params: dict | None = None) -> Any:
    global _LAST_REQUEST
    if not IBKR_BASE_URL:
        raise HTTPException(503, "IBKR_BASE_URL is not configured. Connect an authenticated Client Portal Gateway.")
    parsed = urlsplit(IBKR_BASE_URL)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(503, "IBKR_BASE_URL must be an HTTPS gateway URL without credentials, query, or fragment.")
    verify: bool | str = os.getenv("IBKR_CA_BUNDLE") or True
    if os.getenv("IBKR_VERIFY_TLS", "true").lower() == "false":
        if parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise HTTPException(503, "TLS verification can only be disabled for a loopback gateway.")
        verify = False
    with _LOCK:
        # Serialize requests across history, quotes and SSE to stay below 10/sec.
        time.sleep(max(0, 0.15 - (time.monotonic() - _LAST_REQUEST)))
        try:
            response = _SESSION.get(IBKR_BASE_URL + path, params=params, timeout=_TIMEOUT, verify=verify, allow_redirects=False)
            _LAST_REQUEST = time.monotonic()
            if response.status_code in {401, 403}:
                raise HTTPException(503, "IBKR session or market-data permission unavailable. Sign in to the gateway and check subscriptions.")
            if response.status_code == 429:
                raise HTTPException(429, "IBKR rate limit reached. Retry after the polling interval.")
            if response.status_code != 200:
                raise HTTPException(502, f"IBKR gateway returned HTTP {response.status_code}.")
            payload = response.json()
            if isinstance(payload, dict) and payload.get("error"):
                raise HTTPException(502, "IBKR rejected the request; check the contract, session and market-data permissions.")
            return payload
        except (requests.RequestException, ValueError):
            raise HTTPException(503, "IBKR gateway unreachable or returned an invalid response.")


def cached_request(key: str, ttl: float, fetch, force: bool = False):
    with _LOCK:
        cached = _CACHE.get(key)
        if not force and cached and time.monotonic() - cached[0] < ttl:
            return copy.deepcopy(cached[1])
        value = fetch()
        if len(_CACHE) >= 256:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key] = (time.monotonic(), copy.deepcopy(value))
        return value


def session_status(force: bool = False) -> dict:
    if not IBKR_BASE_URL:
        return {"provider": "ibkr", "status": "not_configured", "configured": False, "authenticated": False}
    try:
        payload = cached_request("session", 30, lambda: request_json("/iserver/auth/status"), force)
        return {"provider": "ibkr", "configured": True, "status": "connected" if payload.get("authenticated") and payload.get("connected") else "login_required", **{k: bool(payload.get(k)) for k in ("authenticated", "connected", "competing", "established")}}
    except HTTPException as error:
        return {"provider": "ibkr", "configured": True, "status": "unavailable", "authenticated": False, "reason": error.detail}


def ensure_session() -> None:
    global _LAST_KEEPALIVE
    status = session_status()
    if not status.get("authenticated") or not status.get("connected") or status.get("competing"):
        raise HTTPException(503, "IBKR brokerage session is not available. Sign in to Client Portal Gateway.")
    with _LOCK:
        if time.monotonic() - _LAST_KEEPALIVE >= 60:
            request_json("/tickle")
            request_json("/iserver/accounts")
            _LAST_KEEPALIVE = time.monotonic()


def number(value: Any) -> float | None:
    try:
        # IBKR prefixes some prices with C/H; keep their numeric value.
        value = float(str(value).replace(",", "").lstrip("CH"))
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def get_historical_ohlcv(symbol="MES1!", timeframe="1m", start_ym=None, limit=0, extended=True, badj=False, dadj=False, force=False) -> dict:
    symbol = normalize_symbol(symbol)
    if timeframe not in BAR_SIZES:
        raise HTTPException(422, "Unsupported IBKR bar size.")
    conid = contract_id(symbol)
    # A bounded recent window is explicit; this is not a continuous, back-adjusted futures series.
    period = os.getenv("IBKR_HISTORY_PERIOD", "1d" if timeframe.endswith("m") else "1m")
    key = f"history:{conid}:{timeframe}:{period}:{extended}"
    def fetch():
        ensure_session()
        raw = request_json("/iserver/marketdata/history", {"conid": conid, "period": period, "bar": BAR_SIZES[timeframe], "outsideRth": str(extended).lower()})
        if not isinstance(raw, dict) or not isinstance(raw.get("data"), list):
            raise HTTPException(502, "IBKR history response is missing bar data.")
        bars = {}
        for row in raw["data"]:
            values = [number(row.get(k)) for k in ("t", "o", "h", "l", "c", "v")]
            stamp, o, h, l, c, v = values
            if any(x is None for x in (stamp, o, h, l, c)) or stamp <= 0 or h < max(o, c) or l > min(o, c):
                continue
            epoch = int(stamp / 1000)
            iso = datetime.fromtimestamp(epoch, timezone.utc).isoformat()
            bars[epoch] = {"time": iso, "timestamp": iso, "epoch": epoch, "open": o, "high": h, "low": l, "close": c, "volume": v or 0, "symbol": symbol, "timeframe": timeframe, "provider": "ibkr", "conid": conid, "source": "ibkr_historical_ohlcv"}
        expected_seconds = {"1m": 60, "3m": 180, "5m": 300, "10m": 600, "15m": 900, "30m": 1800, "1h": 3600, "2h": 7200, "4h": 14400, "1d": 86400, "1w": 604800}[timeframe]
        if raw.get("barLength") is not None and int(raw["barLength"]) != expected_seconds:
            raise HTTPException(502, "IBKR returned a different bar size than requested.")
        candles = [bars[k] for k in sorted(bars)]
        return {"provider": "ibkr", "source": "ibkr_historical_ohlcv", "status": "available" if candles else "unavailable", "symbol": symbol, "timeframe": timeframe, "conid": conid, "providerCode": str(conid), "candles": candles, "period": period, "requestedStartYm": start_ym, "continuousContract": False, "backAdjusted": False, "providerWindowLimited": True, "marketDataAvailability": raw.get("mdAvailability"), "delaySeconds": raw.get("mktDataDelay"), "cache": "provider"}
    payload = cached_request(key, max(20, float(os.getenv("IBKR_HISTORY_CACHE_SECONDS", "60"))), fetch, force)
    if int(limit) > 0:
        payload["candles"] = payload["candles"][-int(limit):]
    payload.update(count=len(payload["candles"]), candleCount=len(payload["candles"]))
    return payload


def get_quote(symbol="MES1!", timeframe="1m") -> dict:
    symbol = normalize_symbol(symbol)
    conid = contract_id(symbol)
    def fetch():
        ensure_session()
        rows = request_json("/iserver/marketdata/snapshot", {"conids": conid, "fields": "31,84,86,85,88,6509"})
        row = next((r for r in rows if str(r.get("conid")) == str(conid)), {}) if isinstance(rows, list) else {}
        price, bid, ask = (number(row.get(k)) for k in ("31", "84", "86"))
        stamp = number(row.get("_updated"))
        availability = str(row.get("6509") or "")
        age = max(0, time.time() - stamp / 1000) if stamp else None
        realtime = availability.startswith("R") and age is not None and age <= float(os.getenv("IBKR_QUOTE_MAX_AGE_SECONDS", "30"))
        return {"symbol": symbol, "conid": conid, "provider": "ibkr", "source": "ibkr_live_quote", "price": price, "lastPrice": price, "close": price, "bid": bid, "ask": ask, "bidSize": number(row.get("88")), "askSize": number(row.get("85")), "epoch": int(stamp / 1000) if stamp else None, "time": datetime.fromtimestamp(stamp / 1000, timezone.utc).isoformat() if stamp else None, "marketDataAvailability": availability, "status": "Live" if realtime and price is not None else "Delayed" if availability.startswith("D") else "Waiting", "isRealtime": realtime, "quoteAgeSeconds": age, "spread": ask - bid if ask is not None and bid is not None else None}
    payload = cached_request(f"quote:{conid}", 5, fetch)
    return {**payload, "timeframe": timeframe}


def get_latest_live_snapshot(symbol="MES1!", timeframe="1m") -> dict:
    quote = get_quote(symbol, timeframe)
    # Emit only provider OHLCV, never fabricate candle volume from snapshot totals.
    candle = None
    if quote["isRealtime"]:
        history = get_historical_ohlcv(symbol, timeframe, limit=1)
        bars = history.get("candles", [])
        if bars:
            candle = bars[-1]
    return {"eventType": "LIVE_FEED_LATEST", "symbol": normalize_symbol(symbol), "timeframe": timeframe, "status": quote["status"], "provider": "ibkr", "source": "ibkr_live_feed", "price": quote, "candle": candle, "history": [candle] if candle else []}


async def live_feed_event_generator(symbol="MES1!", timeframe="1m", limit=700, pollSeconds=None):
    while True:
        try:
            payload = await asyncio.to_thread(get_latest_live_snapshot, symbol, timeframe)
            yield "data: " + json.dumps(payload) + "\n\n"
        except HTTPException as error:
            yield "event: status\ndata: " + json.dumps({"status": "unavailable", "provider": "ibkr", "reason": error.detail}) + "\n\n"
        await asyncio.sleep(max(5, float(pollSeconds or 5)))


async def live_feed_ping_generator():
    while True:
        yield "event: ping\ndata: " + json.dumps({"provider": "ibkr", "status": "OK"}) + "\n\n"
        await asyncio.sleep(15)


def historical_ohlcv_status():
    return {**session_status(), "source": "ibkr_historical_ohlcv", "barSizes": BAR_SIZES, "providerWindowLimited": True}


def live_feed_status():
    return {**session_status(), "source": "ibkr_live_feed", "transport": "snapshot_polling_sse", "pollSeconds": 5}


def get_ibkr_session(symbol="MES1!", force=False):
    # Brokerage authentication status is distinct from exchange trading hours.
    return {**session_status(force), "symbol": normalize_symbol(symbol), "source": "ibkr_brokerage_session", "sessionStatus": "unknown", "reason": "Exchange hours are not inferred from brokerage authentication."}
