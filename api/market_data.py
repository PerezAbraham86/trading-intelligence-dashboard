"""Alpaca BTCUSD-only market-data facade. No IBKR transport is active."""
import asyncio
import json

from api import alpaca_crypto as alpaca

IBKR_BASE_URL = ""
normalize_symbol = alpaca.normalize_symbol
BAR_SIZES = alpaca.SUPPORTED_TIMEFRAMES


def selected_source():
    return "alpaca_crypto"


def is_tws():
    return False


def connection_status(symbol=None):
    return alpaca.connection_status(symbol or "BTCUSD")


def get_historical_ohlcv(symbol="BTCUSD", timeframe="1m", **kwargs):
    return alpaca.get_historical_ohlcv(symbol, timeframe, **kwargs)


def get_quote(symbol="BTCUSD", timeframe="1m"):
    return alpaca.get_quote(symbol, timeframe)


def get_latest_live_snapshot(symbol="BTCUSD", timeframe="1m"):
    return alpaca.get_latest_live_snapshot(symbol, timeframe)


def contract_id(symbol):
    alpaca.normalize_symbol(symbol)
    return "BTCUSD"


def session_status(force=False):
    return connection_status()


def get_ibkr_session(symbol="BTCUSD", force=False):
    return connection_status(symbol)


def historical_ohlcv_status():
    return {**connection_status(), "barSizes": list(BAR_SIZES), "source": "alpaca_crypto_bars"}


def live_feed_status():
    return {**connection_status(), "transport": "alpaca_crypto_websocket", "stream": dict(_STREAM_STATE)}


# One upstream Alpaca socket per backend process, with per-client SSE queues.
import os
import time
from datetime import datetime
import websockets

ALPACA_CRYPTO_FEED = "us-1"  # Kraken US feed (includes Texas)
_SUBSCRIBERS = set()
_STREAM_TASK = None
_STREAM_STATE = {"status": "idle", "feed": ALPACA_CRYPTO_FEED, "lastTradeAt": None,
                 "lastQuoteAt": None, "lastBarAt": None}

def _broadcast(message):
    for queue in tuple(_SUBSCRIBERS):
        if queue.full():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        queue.put_nowait(message)

async def _alpaca_stream_worker():
    backoff = 1
    while True:
        try:
            key = os.getenv("ALPACA_API_KEY")
            secret = os.getenv("ALPACA_API_SECRET")
            if not key or not secret:
                raise RuntimeError("Alpaca stream credentials missing")
            _STREAM_STATE["status"] = "connecting"
            async with websockets.connect(
                f"wss://stream.data.alpaca.markets/v1beta3/crypto/{ALPACA_CRYPTO_FEED}",
                open_timeout=12, ping_interval=20, ping_timeout=20, max_queue=1024,
            ) as ws:
                _STREAM_STATE["status"] = "authenticating"
                await ws.send(json.dumps({"action": "auth", "key": key, "secret": secret}))
                authenticated = False
                subscribed = False
                async for raw in ws:
                    messages = json.loads(raw)
                    if not isinstance(messages, list):
                        messages = [messages]
                    for item in messages:
                        kind = item.get("T")
                        if kind == "error":
                            raise RuntimeError("Alpaca stream error: " + str(item.get("code")) +
                                               " " + str(item.get("msg", ""))[:90])
                        if kind == "success" and item.get("msg") == "authenticated":
                            authenticated = True
                            await ws.send(json.dumps({"action": "subscribe",
                                "trades": ["BTC/USD"], "quotes": ["BTC/USD"],
                                "bars": ["BTC/USD"], "updatedBars": ["BTC/USD"]}))
                        if kind == "subscription":
                            subscribed = authenticated and "BTC/USD" in item.get("trades", [])
                            _STREAM_STATE["status"] = "subscribed" if subscribed else "subscription_incomplete"
                            _STREAM_STATE["channels"] = {
                                k: "BTC/USD" in item.get(k, [])
                                for k in ("trades", "quotes", "bars", "updatedBars")}
                            if not subscribed:
                                raise RuntimeError("BTC/USD trades not subscribed")
                            backoff = 1
                        if not subscribed or item.get("S") != "BTC/USD":
                            continue
                        if kind not in ("t", "q", "b", "u"):
                            continue
                        stamp = item.get("t")
                        try:
                            epoch = datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
                        except (AttributeError, ValueError):
                            continue
                        if epoch > time.time() + 60 or time.time() - epoch > 180:
                            continue
                        if kind == "t":
                            try:
                                price = float(item["p"])
                                size = float(item.get("s") or 0)
                            except (KeyError, ValueError, TypeError):
                                continue
                            if price <= 0:
                                continue
                            _STREAM_STATE.update(status="live", lastTradeAt=stamp)
                            _broadcast({"kind": "trade", "price": price, "size": size,
                                        "epoch": epoch, "time": stamp})
                        elif kind == "q":
                            try:
                                bid, ask = float(item["bp"]), float(item["ap"])
                            except (KeyError, ValueError, TypeError):
                                continue
                            if bid <= 0 or ask <= 0 or bid > ask:
                                continue
                            _STREAM_STATE["lastQuoteAt"] = stamp
                            _broadcast({"kind": "quote", "price": (bid + ask) / 2,
                                        "size": 0, "epoch": epoch, "time": stamp})
                        else:
                            try:
                                bar = {name: float(item[field]) for name, field in
                                       (("open", "o"), ("high", "h"), ("low", "l"), ("close", "c"))}
                                bar["volume"] = float(item.get("v") or 0)
                            except (KeyError, ValueError, TypeError):
                                continue
                            _STREAM_STATE["lastBarAt"] = stamp
                            _broadcast({"kind": "bar" if kind == "b" else "updated_bar",
                                        "bar": bar, "epoch": epoch, "time": stamp})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _STREAM_STATE["status"] = "reconnecting"
            _STREAM_STATE["reason"] = str(exc)[:140]
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)


async def live_feed_event_generator(symbol="BTCUSD", timeframe="1m", limit=700, pollSeconds=None):
    """Stream exchange trades, quotes, and reconciled minute bars to dashboard clients."""
    global _STREAM_TASK
    alpaca.normalize_symbol(symbol)
    if timeframe not in alpaca.SUPPORTED_TIMEFRAMES:
        timeframe = "1m"
    seconds = alpaca.SUPPORTED_TIMEFRAMES[timeframe][1]
    queue = asyncio.Queue(maxsize=2048)
    _SUBSCRIBERS.add(queue)
    if _STREAM_TASK is None or _STREAM_TASK.done():
        _STREAM_TASK = asyncio.create_task(_alpaca_stream_worker())
    current = None
    last_epoch = 0
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=12)
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
                continue
            kind, epoch, stamp = event["kind"], event["epoch"], event["time"]
            bucket = int(epoch) // seconds * seconds
            if kind in ("bar", "updated_bar"):
                # Alpaca minute bars are authoritative; only apply them directly on 1m.
                # Other timeframes use the regular REST reconciliation path.
                if timeframe != "1m":
                    continue
                candle = {**event["bar"], "epoch": bucket, "time": bucket,
                          "timestamp": bucket, "t": bucket, "symbol": "BTCUSD",
                          "timeframe": timeframe, "provider": "alpaca",
                          "source": "alpaca_crypto_live_bar"}
                if current is not None and current["epoch"] == bucket:
                    current = {**candle}
                quote_price = candle["close"]
            else:
                if epoch < last_epoch:
                    continue
                last_epoch = epoch
                price = event["price"]
                if current is None or current["epoch"] != bucket:
                    current = {"epoch": bucket, "open": price, "high": price,
                               "low": price, "close": price, "volume": 0.0}
                else:
                    current["high"] = max(current["high"], price)
                    current["low"] = min(current["low"], price)
                    current["close"] = price
                if kind == "trade":
                    current["volume"] += event["size"]
                candle = {**current, "time": bucket, "timestamp": bucket, "t": bucket,
                          "symbol": "BTCUSD", "timeframe": timeframe,
                          "provider": "alpaca", "source": "alpaca_crypto_live_trade"}
                quote_price = price
            quote = {"provider": "alpaca", "symbol": "BTCUSD", "price": quote_price,
                     "lastPrice": quote_price, "close": quote_price, "time": stamp,
                     "status": "Live", "isRealtime": True, "isLive": True}
            payload = {"eventType": "LIVE_FEED_LATEST", "symbol": "BTCUSD",
                       "timeframe": timeframe, "provider": "alpaca",
                       "source": candle["source"], "status": "Live",
                       "feed": ALPACA_CRYPTO_FEED, "updateType": kind,
                       "price": quote, "candle": candle, "history": []}
            yield "data: " + json.dumps(payload) + "\n\n"
    finally:
        _SUBSCRIBERS.discard(queue)


async def live_feed_ping_generator():
    while True:
        yield "event: ping\ndata: " + json.dumps({"provider": "alpaca", "status": "OK"}) + "\n\n"
        await asyncio.sleep(15)
