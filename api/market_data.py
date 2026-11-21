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


# One upstream Alpaca socket per backend process; each dashboard SSE client gets its own queue.
import os
import time
from datetime import datetime, timezone
import websockets

_SUBSCRIBERS = set()
_STREAM_TASK = None
_STREAM_STATE = {"status": "connecting", "lastTradeAt": None}

async def _alpaca_stream_worker():
    backoff = 1
    while True:
        try:
            key = os.getenv("ALPACA_API_KEY")
            secret = os.getenv("ALPACA_API_SECRET")
            if not key or not secret:
                raise RuntimeError("Alpaca stream credentials missing")
            async with websockets.connect(
                "wss://stream.data.alpaca.markets/v1beta3/crypto/us",
                open_timeout=12, ping_interval=20, ping_timeout=20,
                max_queue=1024,
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
                            raise RuntimeError("Alpaca stream rejected authentication or subscription: " + str(item.get("code")))
                        if kind == "success" and item.get("msg") == "authenticated":
                            authenticated = True
                            await ws.send(json.dumps({"action": "subscribe", "trades": ["BTC/USD"]}))
                        if kind == "subscription":
                            subscribed = "BTC/USD" in item.get("trades", [])
                            if not subscribed:
                                raise RuntimeError("BTC/USD trades not subscribed")
                            _STREAM_STATE["status"] = "subscribed"
                            backoff = 1
                        if kind != "t" or item.get("S") != "BTC/USD" or not (authenticated and subscribed):
                            continue
                        try:
                            price = float(item["p"])
                            stamp = item["t"]
                            epoch = datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
                            size = float(item.get("s") or 0)
                        except (KeyError, ValueError, TypeError):
                            continue
                        if price <= 0 or abs(time.time() - epoch) > 120:
                            continue
                        _STREAM_STATE.update(status="live", lastTradeAt=stamp)
                        trade = {"price": price, "time": stamp, "epoch": epoch, "size": size}
                        for queue in tuple(_SUBSCRIBERS):
                            if queue.full():
                                try:
                                    queue.get_nowait()
                                except asyncio.QueueEmpty:
                                    pass
                            queue.put_nowait(trade)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _STREAM_STATE["status"] = "reconnecting"
            _STREAM_STATE["reason"] = str(exc)[:120]
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)


async def live_feed_event_generator(symbol="BTCUSD", timeframe="1m", limit=700, pollSeconds=None):
    """SSE fan-out of Alpaca's true trade-by-trade crypto WebSocket."""
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
    try:
        while True:
            try:
                trade = await asyncio.wait_for(queue.get(), timeout=12)
            except asyncio.TimeoutError:
                yield ": heartbeat\\n\\n"
                continue
            price, epoch, stamp = trade["price"], trade["epoch"], trade["time"]
            bucket = int(epoch) // seconds * seconds
            if current is None or current["epoch"] != bucket:
                current = {"epoch": bucket, "open": price, "high": price,
                           "low": price, "close": price, "volume": 0.0}
            else:
                current["high"] = max(current["high"], price)
                current["low"] = min(current["low"], price)
                current["close"] = price
            current["volume"] += trade["size"]
            candle = {**current, "time": bucket, "timestamp": bucket, "t": bucket,
                      "symbol": "BTCUSD", "timeframe": timeframe,
                      "provider": "alpaca", "source": "alpaca_crypto_live_trade"}
            quote = {"provider": "alpaca", "symbol": "BTCUSD", "price": price,
                     "lastPrice": price, "close": price, "time": stamp,
                     "status": "Live", "isRealtime": True, "isLive": True}
            payload = {"eventType": "LIVE_FEED_LATEST", "symbol": "BTCUSD",
                       "timeframe": timeframe, "provider": "alpaca",
                       "source": "alpaca_crypto_live_trade", "status": "Live",
                       "price": quote, "candle": candle, "history": []}
            yield "data: " + json.dumps(payload) + "\\n\\n"
    finally:
        _SUBSCRIBERS.discard(queue)


async def live_feed_ping_generator():
    while True:
        yield "event: ping\ndata: " + json.dumps({"provider": "alpaca", "status": "OK"}) + "\n\n"
        await asyncio.sleep(15)
