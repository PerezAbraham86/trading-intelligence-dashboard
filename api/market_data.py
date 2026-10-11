"""Explicit IBKR transport selection. TWS never falls back to Client Portal."""
import asyncio
import json
import os

from fastapi import HTTPException
from api import ibkr_client as rest
from api import ibkr_tws_relay as tws

IBKR_BASE_URL = rest.IBKR_BASE_URL


def selected_source():
    value = os.getenv("IBKR_MARKET_DATA_SOURCE", "client_portal")
    if value not in {"client_portal", "tws_relay"}:
        raise HTTPException(503, "Invalid IBKR_MARKET_DATA_SOURCE; explicitly select client_portal or tws_relay.")
    return value


def is_tws():
    return selected_source() == "tws_relay"


def connection_status(symbol=None):
    return tws.status(symbol or "SPY") if is_tws() else rest.connection_status(symbol)


def get_historical_ohlcv(symbol="MES1!", timeframe="1m", **kwargs):
    return tws.historical(rest.normalize_symbol(symbol), timeframe, **kwargs) if is_tws() else rest.get_historical_ohlcv(symbol, timeframe, **kwargs)


def get_quote(symbol="MES1!", timeframe="1m"):
    return tws.quote(rest.normalize_symbol(symbol), timeframe) if is_tws() else rest.get_quote(symbol, timeframe)


def get_latest_live_snapshot(symbol="MES1!", timeframe="1m"):
    return tws.latest(rest.normalize_symbol(symbol), timeframe) if is_tws() else rest.get_latest_live_snapshot(symbol, timeframe)


def contract_id(symbol):
    if not is_tws():
        return rest.contract_id(symbol)
    value = connection_status(rest.normalize_symbol(symbol)).get("conid")
    if not value:
        raise HTTPException(503, "TWS contract not yet qualified; no REST contract fallback.")
    return value


def session_status(force=False):
    return connection_status() if is_tws() else rest.session_status(force)


def get_ibkr_session(symbol="MES1!", force=False):
    if not is_tws():
        return rest.get_ibkr_session(symbol, force)
    connection = connection_status(rest.normalize_symbol(symbol))
    return {**connection, "sessionStatus": "closed" if connection.get("marketClosed") else "open" if connection.get("marketClosed") is False else "unknown"}


def historical_ohlcv_status():
    return {**connection_status(), "barSizes": {"1m": "1 min"}, "chartAggregation": "Observed IBKR one-minute bars; gaps are not filled"} if is_tws() else rest.historical_ohlcv_status()


def live_feed_status():
    return {**connection_status(), "transport": "signed_https_tws_relay_sse"} if is_tws() else rest.live_feed_status()


async def live_feed_event_generator(symbol="MES1!", timeframe="1m", limit=700, pollSeconds=None):
    if not is_tws():
        async for event in rest.live_feed_event_generator(symbol, timeframe, limit, pollSeconds):
            yield event
        return
    previous = None
    while True:
        payload = await asyncio.to_thread(get_latest_live_snapshot, symbol, timeframe)
        content = json.dumps(payload, sort_keys=True)
        if content != previous:
            yield "data: " + content + "\n\n"
            previous = content
        else:
            yield ": heartbeat\n\n"
        # Reads local SQLite only; never calls a Gateway or historical API from SSE.
        await asyncio.sleep(2 if payload.get("connection", {}).get("ready") else 15)


live_feed_ping_generator = rest.live_feed_ping_generator
