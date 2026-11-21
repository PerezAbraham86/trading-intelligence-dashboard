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
    return {**connection_status(), "transport": "alpaca_crypto_polling"}


async def live_feed_event_generator(symbol="BTCUSD", timeframe="1m", limit=700, pollSeconds=None):
    """SSE: poll Alpaca latest trades and update the active candle when a trade changes."""
    from datetime import datetime
    alpaca.normalize_symbol(symbol)
    if timeframe not in alpaca.SUPPORTED_TIMEFRAMES:
        timeframe = "1m"
    seconds = alpaca.SUPPORTED_TIMEFRAMES[timeframe][1]
    current = None
    last_trade = None
    while True:
        try:
            quote = await asyncio.to_thread(alpaca.get_quote, "BTCUSD", timeframe)
            price, stamp = quote.get("price"), quote.get("time")
            if price is not None and stamp and stamp != last_trade:
                last_trade = stamp
                epoch = int(datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp())
                bucket = epoch // seconds * seconds
                if current is None or current["epoch"] != bucket:
                    current = {"epoch": bucket, "open": price, "high": price, "low": price,
                               "close": price, "volume": 0.0}
                else:
                    current["high"] = max(current["high"], price)
                    current["low"] = min(current["low"], price)
                    current["close"] = price
                candle = {**current, "time": bucket, "timestamp": bucket, "t": bucket,
                          "symbol": "BTCUSD", "timeframe": timeframe,
                          "provider": "alpaca", "source": "alpaca_crypto_live_trade"}
                payload = {"eventType": "LIVE_FEED_LATEST", "symbol": "BTCUSD",
                           "timeframe": timeframe, "provider": "alpaca",
                           "source": "alpaca_crypto_live_trade",
                           "status": "Live", "price": quote, "candle": candle,
                           "history": []}
                yield "data: " + json.dumps(payload) + "\n\n"
            else:
                yield ": heartbeat\n\n"
        except Exception:
            yield "event: status\ndata: " + json.dumps({"provider": "alpaca", "status": "unavailable"}) + "\n\n"
        await asyncio.sleep(max(0.5, float(pollSeconds or 1)))


async def live_feed_ping_generator():
    while True:
        yield "event: ping\ndata: " + json.dumps({"provider": "alpaca", "status": "OK"}) + "\n\n"
        await asyncio.sleep(15)
