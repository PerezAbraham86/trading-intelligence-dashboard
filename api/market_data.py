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
    while True:
        try:
            payload = await asyncio.to_thread(get_latest_live_snapshot, symbol, timeframe)
            yield "data: " + json.dumps(payload) + "\n\n"
        except Exception:
            yield "event: status\ndata: " + json.dumps({"provider": "alpaca", "status": "unavailable"}) + "\n\n"
        await asyncio.sleep(max(5.0, float(pollSeconds or 10)))


async def live_feed_ping_generator():
    while True:
        yield "event: ping\ndata: " + json.dumps({"provider": "alpaca", "status": "OK"}) + "\n\n"
        await asyncio.sleep(15)
