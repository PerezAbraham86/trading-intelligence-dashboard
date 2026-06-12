from __future__ import annotations

import asyncio
import json
import math
import os
import time
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


# ─────────────────────────────────────────────────────────────────────────────
# MARKETBOS PHASE 8 — INSIGHTSENTRY LIVE PRICE / CANDLE FEED BRIDGE
# ─────────────────────────────────────────────────────────────────────────────
# Purpose:
# - Give the React charts a live-updating candle feed through Server-Sent Events.
# - Use InsightSentry live quote endpoints immediately.
# - Expose the websocket-key endpoint so the backend is ready for the real
#   InsightSentry websocket connection when subscription docs/message format are
#   finalized.
#
# Current live behavior:
# - /api/live-feed/stream polls latest quote every LIVE_FEED_POLL_SECONDS.
# - The backend builds the current in-progress candle from every live price tick.
# - The chart merges that in-progress candle into its existing candle array.
#
# This gives live chart movement without waiting for /api/candles polling.
# ─────────────────────────────────────────────────────────────────────────────


INSIGHTSENTRY_API_KEY = (
    os.getenv("INSIGHTSENTRY_API_KEY", "")
    or os.getenv("INSIGHTSENTRY_RAPIDAPI_KEY", "")
    or os.getenv("RAPIDAPI_KEY", "")
    or os.getenv("X_RAPIDAPI_KEY", "")
)
INSIGHTSENTRY_HOST = (
    os.getenv("INSIGHTSENTRY_HOST", "")
    or os.getenv("INSIGHTSENTRY_RAPIDAPI_HOST", "")
    or "insightsentry.p.rapidapi.com"
)
INSIGHTSENTRY_REST_BASE_URL = f"https://{INSIGHTSENTRY_HOST}"
INSIGHTSENTRY_WS_LIVE_URL = os.getenv("INSIGHTSENTRY_WS_LIVE_URL", "wss://realtime.insightsentry.com/live")
INSIGHTSENTRY_WS_NEWS_URL = os.getenv("INSIGHTSENTRY_WS_NEWS_URL", "wss://realtime.insightsentry.com/newsfeed")
LIVE_FEED_POLL_SECONDS = float(os.getenv("LIVE_FEED_POLL_SECONDS", "1.0"))
LIVE_FEED_STALE_SECONDS = int(os.getenv("LIVE_FEED_STALE_SECONDS", "10"))

WEBSOCKET_KEY_CACHE: Dict[str, Any] = {
    "api_key": "",
    "expiration": 0,
    "note": "",
    "fetchedAt": "",
}

LATEST_TICKS: Dict[str, Dict[str, Any]] = {}
LIVE_CANDLES: Dict[str, Dict[str, Any]] = {}
LIVE_FEED_STATUS: Dict[str, Any] = {
    "eventType": "INSIGHTSENTRY_LIVE_FEED_STATUS",
    "status": "Idle",
    "source": "not_started",
    "message": "Live feed has not started yet.",
    "lastError": "",
    "lastTickAt": "",
    "streamClients": 0,
    "createdAt": "",
}


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None:
            return fallback
        parsed = float(value)
        if not math.isfinite(parsed):
            return fallback
        return parsed
    except Exception:
        return fallback


def to_int(value: Any, fallback: int = 0) -> int:
    try:
        if value is None:
            return fallback
        return int(float(value))
    except Exception:
        return fallback


def normalize_symbol(symbol: Any) -> str:
    raw = str(symbol or "MES1!").strip().upper()
    raw = (
        raw.replace("CME_MINI:", "")
        .replace("CME:", "")
        .replace("BINANCE:", "")
        .replace("COINBASE:", "")
        .replace("CRYPTO:", "")
    )

    if raw in {"MES", "MES1", "MES1!", "/MES", "MES=F"} or "MES" in raw:
        return "MES1!"
    if raw in {"ES", "ES1", "ES1!", "/ES", "ES=F"}:
        return "ES1!"
    if "BTC" in raw:
        return "BTCUSD"
    if "ETH" in raw:
        return "ETHUSD"
    if "SPY" in raw:
        return "SPY"

    return raw or "MES1!"


def to_insightsentry_symbol(symbol: Any) -> str:
    normalized = normalize_symbol(symbol)
    if normalized == "MES1!":
        return "CME_MINI:MES1!"
    if normalized == "ES1!":
        return "CME_MINI:ES1!"
    return normalized


def normalize_timeframe(timeframe: Any) -> str:
    raw = str(timeframe or "1m").strip().lower()
    mapping = {
        "1": "1m", "1m": "1m", "1min": "1m", "1minute": "1m",
        "3": "3m", "3m": "3m", "3min": "3m", "3minute": "3m",
        "5": "5m", "5m": "5m", "5min": "5m", "5minute": "5m",
        "10": "10m", "10m": "10m", "10min": "10m", "10minute": "10m",
        "15": "15m", "15m": "15m", "15min": "15m", "15minute": "15m",
        "30": "30m", "30m": "30m", "30min": "30m", "30minute": "30m",
        "60": "1h", "60m": "1h", "1h": "1h",
        "120": "2h", "120m": "2h", "2h": "2h",
        "240": "4h", "240m": "4h", "4h": "4h",
        "d": "1d", "1d": "1d", "day": "1d", "1day": "1d",
    }
    return mapping.get(raw, raw or "1m")


def timeframe_seconds(timeframe: Any) -> int:
    mapping = {
        "1m": 60,
        "3m": 180,
        "5m": 300,
        "10m": 600,
        "15m": 900,
        "30m": 1800,
        "1h": 3600,
        "2h": 7200,
        "4h": 14400,
        "1d": 86400,
    }
    return mapping.get(normalize_timeframe(timeframe), 60)


def feed_key(symbol: Any, timeframe: Any) -> str:
    return f"{normalize_symbol(symbol)}::{normalize_timeframe(timeframe)}"


def floor_epoch_to_timeframe(epoch: float, timeframe: Any) -> int:
    seconds = max(timeframe_seconds(timeframe), 60)
    return int(epoch // seconds) * seconds


def epoch_to_iso(epoch: Any) -> str:
    parsed = to_float(epoch, time.time())
    if parsed > 1_000_000_000_000:
        parsed = parsed / 1000.0
    return datetime.fromtimestamp(parsed, tz=timezone.utc).isoformat()


def parse_time_to_epoch(value: Any) -> float:
    if value is None:
        return time.time()

    if isinstance(value, (int, float)):
        numeric = float(value)
        return numeric / 1000.0 if numeric > 1_000_000_000_000 else numeric

    text = str(value).strip()
    if not text:
        return time.time()

    try:
        numeric = float(text)
        return numeric / 1000.0 if numeric > 1_000_000_000_000 else numeric
    except Exception:
        pass

    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except Exception:
        return time.time()


def insightsentry_headers() -> Dict[str, str]:
    return {
        "Content-Type": "application/json",
        "x-rapidapi-host": INSIGHTSENTRY_HOST,
        "x-rapidapi-key": INSIGHTSENTRY_API_KEY,
    }


def http_get_json(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 8) -> Any:
    request = Request(url, headers=headers or {})
    with urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", errors="ignore")
        return json.loads(body)


def recursive_find_number(payload: Any, keys: set[str]) -> Optional[float]:
    if isinstance(payload, dict):
        bid = None
        ask = None

        for key, value in payload.items():
            lowered = str(key).lower().replace("_", "")
            if lowered in keys:
                parsed = to_float(value, 0.0)
                if parsed > 0:
                    return parsed
            if lowered in {"bid", "bidprice", "bp"}:
                candidate = to_float(value, 0.0)
                if candidate > 0:
                    bid = candidate
            if lowered in {"ask", "askprice", "ap"}:
                candidate = to_float(value, 0.0)
                if candidate > 0:
                    ask = candidate

        if bid and ask:
            return (bid + ask) / 2.0

        for value in payload.values():
            found = recursive_find_number(value, keys)
            if found is not None:
                return found

    if isinstance(payload, list):
        for item in payload:
            found = recursive_find_number(item, keys)
            if found is not None:
                return found

    return None


def recursive_find_time(payload: Any) -> Optional[Any]:
    if isinstance(payload, dict):
        for key, value in payload.items():
            lowered = str(key).lower()
            if lowered in {"t", "time", "timestamp", "datetime", "date", "lasttime", "tradetime"} and value:
                return value
        for value in payload.values():
            found = recursive_find_time(value)
            if found is not None:
                return found

    if isinstance(payload, list):
        for item in payload:
            found = recursive_find_time(item)
            if found is not None:
                return found

    return None


# ─────────────────────────────────────────────────────────────────────────────
# WEBSOCKET KEY + LIVE QUOTE FETCH
# ─────────────────────────────────────────────────────────────────────────────


def refresh_insightsentry_websocket_key(force: bool = False) -> Dict[str, Any]:
    global WEBSOCKET_KEY_CACHE

    expiration = to_int(WEBSOCKET_KEY_CACHE.get("expiration"), 0)
    if not force and WEBSOCKET_KEY_CACHE.get("api_key") and expiration - int(time.time()) > 24 * 60 * 60:
        return {
            "eventType": "INSIGHTSENTRY_WEBSOCKET_KEY",
            "status": "Cached",
            "liveUrl": INSIGHTSENTRY_WS_LIVE_URL,
            "newsUrl": INSIGHTSENTRY_WS_NEWS_URL,
            "expiration": expiration,
            "expiresInSeconds": expiration - int(time.time()),
            "hasKey": True,
            "fetchedAt": WEBSOCKET_KEY_CACHE.get("fetchedAt"),
        }

    if not INSIGHTSENTRY_API_KEY:
        raise RuntimeError("Missing INSIGHTSENTRY_API_KEY / RAPIDAPI_KEY")

    url = f"{INSIGHTSENTRY_REST_BASE_URL}/v2/websocket-key"
    data = http_get_json(url, headers=insightsentry_headers(), timeout=10)
    if not isinstance(data, dict):
        raise RuntimeError("InsightSentry websocket-key response was not a JSON object")

    api_key = str(data.get("api_key") or data.get("apiKey") or data.get("key") or "")
    expiration = to_int(data.get("expiration") or data.get("expires") or data.get("expires_at"), 0)

    if not api_key:
        raise RuntimeError("InsightSentry websocket-key response did not include api_key")

    WEBSOCKET_KEY_CACHE = {
        "api_key": api_key,
        "expiration": expiration,
        "note": data.get("note"),
        "fetchedAt": now_iso(),
    }

    return {
        "eventType": "INSIGHTSENTRY_WEBSOCKET_KEY",
        "status": "Ready",
        "liveUrl": INSIGHTSENTRY_WS_LIVE_URL,
        "newsUrl": INSIGHTSENTRY_WS_NEWS_URL,
        "expiration": expiration,
        "expiresInSeconds": expiration - int(time.time()) if expiration else None,
        "hasKey": True,
        "note": data.get("note"),
        "fetchedAt": WEBSOCKET_KEY_CACHE.get("fetchedAt"),
    }


def build_insightsentry_live_quote_urls(api_symbol: str) -> List[str]:
    encoded_path_symbol = quote(api_symbol, safe="")
    encoded_query_symbol = quote(api_symbol, safe="")
    return [
        f"{INSIGHTSENTRY_REST_BASE_URL}/v3/symbols/{encoded_path_symbol}/quotes/l1",
        f"{INSIGHTSENTRY_REST_BASE_URL}/v3/symbols/{encoded_path_symbol}/quote",
        f"{INSIGHTSENTRY_REST_BASE_URL}/v3/symbols/{encoded_path_symbol}/quotes",
        f"{INSIGHTSENTRY_REST_BASE_URL}/v3/quotes/l1?symbol={encoded_query_symbol}",
    ]


def fetch_insightsentry_live_tick(symbol: Any, timeframe: Any = "1m") -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    api_symbol = to_insightsentry_symbol(normalized_symbol)

    if not INSIGHTSENTRY_API_KEY:
        raise RuntimeError("Missing INSIGHTSENTRY_API_KEY / RAPIDAPI_KEY")

    last_error = ""
    for url in build_insightsentry_live_quote_urls(api_symbol):
        try:
            data = http_get_json(url, headers=insightsentry_headers(), timeout=7)
            price = recursive_find_number(
                data,
                {
                    "last",
                    "lastprice",
                    "price",
                    "tradeprice",
                    "close",
                    "settlement",
                    "p",
                    "c",
                    "bid",
                    "ask",
                    "bidprice",
                    "askprice",
                    "bp",
                    "ap",
                },
            )
            raw_time = recursive_find_time(data)
            if price and price > 0:
                epoch = parse_time_to_epoch(raw_time)
                tick = {
                    "eventType": "LIVE_PRICE_TICK",
                    "symbol": normalized_symbol,
                    "timeframe": normalized_timeframe,
                    "providerSymbol": api_symbol,
                    "price": round(price, 8),
                    "time": epoch_to_iso(epoch),
                    "timestamp": epoch_to_iso(epoch),
                    "epoch": epoch,
                    "bucketEpoch": floor_epoch_to_timeframe(epoch, normalized_timeframe),
                    "provider": "insightsentry",
                    "source": "insightsentry_rest_live_quote",
                    "urlUsed": url,
                    "createdAt": now_iso(),
                }
                LATEST_TICKS[feed_key(normalized_symbol, normalized_timeframe)] = tick
                LIVE_FEED_STATUS.update(
                    {
                        "status": "Live",
                        "source": "insightsentry_rest_live_quote",
                        "message": "Receiving live quote snapshots.",
                        "lastError": "",
                        "lastTickAt": tick["createdAt"],
                        "createdAt": LIVE_FEED_STATUS.get("createdAt") or now_iso(),
                    }
                )
                return tick
            last_error = f"No usable price parsed from {url}"
        except Exception as error:
            last_error = str(error)
            continue

    LIVE_FEED_STATUS.update(
        {
            "status": "Error",
            "source": "insightsentry_rest_live_quote",
            "message": "Live quote fetch failed.",
            "lastError": last_error,
            "createdAt": LIVE_FEED_STATUS.get("createdAt") or now_iso(),
        }
    )
    raise RuntimeError(last_error or "InsightSentry live quote fetch failed")


# ─────────────────────────────────────────────────────────────────────────────
# LIVE CANDLE BUILDER
# ─────────────────────────────────────────────────────────────────────────────


def update_live_candle_from_tick(tick: Dict[str, Any], timeframe: Any = "1m") -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(tick.get("symbol"))
    normalized_timeframe = normalize_timeframe(timeframe or tick.get("timeframe"))
    price = to_float(tick.get("price"), 0.0)
    epoch = parse_time_to_epoch(tick.get("epoch") or tick.get("time") or tick.get("timestamp"))
    bucket_epoch = floor_epoch_to_timeframe(epoch, normalized_timeframe)
    key = f"{normalized_symbol}::{normalized_timeframe}::{bucket_epoch}"
    existing = LIVE_CANDLES.get(key)

    if existing and normalize_symbol(existing.get("symbol")) == normalized_symbol:
        open_price = to_float(existing.get("open"), price)
        high = max(to_float(existing.get("high"), price), price)
        low = min(to_float(existing.get("low"), price), price)
        volume = to_float(existing.get("volume"), 0.0) + 1.0
        tick_count = to_int(existing.get("tickCount"), 0) + 1
    else:
        open_price = price
        high = price
        low = price
        volume = 1.0
        tick_count = 1

    candle = {
        "eventType": "LIVE_CANDLE_UPDATE",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "time": epoch_to_iso(bucket_epoch),
        "timestamp": epoch_to_iso(bucket_epoch),
        "epoch": bucket_epoch,
        "open": round(open_price, 8),
        "high": round(high, 8),
        "low": round(low, 8),
        "close": round(price, 8),
        "volume": volume,
        "tickCount": tick_count,
        "isLive": True,
        "isPartial": True,
        "provider": tick.get("provider", "insightsentry"),
        "source": tick.get("source", "live_price_tick"),
        "lastTickEpoch": epoch,
        "lastTickTime": epoch_to_iso(epoch),
        "createdAt": now_iso(),
    }

    LIVE_CANDLES[key] = candle
    return candle


def get_latest_live_snapshot(symbol: Any = "MES1!", timeframe: Any = "1m") -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    key_prefix = f"{normalized_symbol}::{normalized_timeframe}::"
    candles = [row for key, row in LIVE_CANDLES.items() if key.startswith(key_prefix)]
    candles.sort(key=lambda row: to_float(row.get("epoch"), 0.0))
    latest_tick = LATEST_TICKS.get(feed_key(normalized_symbol, normalized_timeframe))

    return {
        "eventType": "LIVE_FEED_LATEST",
        "status": "Ready" if latest_tick or candles else "Waiting",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "tick": latest_tick,
        "candle": candles[-1] if candles else None,
        "candles": candles[-20:],
        "statusInfo": live_feed_status(),
        "createdAt": now_iso(),
    }


def live_feed_status() -> Dict[str, Any]:
    latest_ticks = list(LATEST_TICKS.values())
    latest_tick_at = ""
    if latest_ticks:
        latest_tick_at = max(str(row.get("createdAt") or "") for row in latest_ticks)

    status = dict(LIVE_FEED_STATUS)
    status.update(
        {
            "eventType": "INSIGHTSENTRY_LIVE_FEED_STATUS",
            "hasRapidApiKey": bool(INSIGHTSENTRY_API_KEY),
            "rapidApiHost": INSIGHTSENTRY_HOST,
            "websocketLiveUrl": INSIGHTSENTRY_WS_LIVE_URL,
            "websocketNewsUrl": INSIGHTSENTRY_WS_NEWS_URL,
            "websocketKeyReady": bool(WEBSOCKET_KEY_CACHE.get("api_key")),
            "websocketKeyExpiration": WEBSOCKET_KEY_CACHE.get("expiration"),
            "latestTickCount": len(LATEST_TICKS),
            "liveCandleCount": len(LIVE_CANDLES),
            "lastTickAt": status.get("lastTickAt") or latest_tick_at,
            "pollSeconds": LIVE_FEED_POLL_SECONDS,
            "createdAt": status.get("createdAt") or now_iso(),
        }
    )
    return status


async def live_feed_event_generator(
    symbol: Any = "MES1!",
    timeframe: Any = "1m",
    limit: Any = 700,
    pollSeconds: Optional[float] = None,
) -> AsyncGenerator[str, None]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    interval = max(0.5, float(pollSeconds or LIVE_FEED_POLL_SECONDS))

    LIVE_FEED_STATUS["streamClients"] = to_int(LIVE_FEED_STATUS.get("streamClients"), 0) + 1
    LIVE_FEED_STATUS["createdAt"] = LIVE_FEED_STATUS.get("createdAt") or now_iso()

    hello = {
        "eventType": "LIVE_FEED_CONNECTED",
        "status": "Connected",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "pollSeconds": interval,
        "source": "insightsentry_live_feed_bridge",
        "createdAt": now_iso(),
    }
    yield f"event: status\ndata: {json.dumps(hello, separators=(',', ':'))}\n\n"

    try:
        while True:
            try:
                tick = await asyncio.to_thread(fetch_insightsentry_live_tick, normalized_symbol, normalized_timeframe)
                candle = update_live_candle_from_tick(tick, normalized_timeframe)
                payload = {
                    "eventType": "LIVE_CANDLE_UPDATE",
                    "status": "Live",
                    "symbol": normalized_symbol,
                    "timeframe": normalized_timeframe,
                    "tick": tick,
                    "candle": candle,
                    "price": tick.get("price"),
                    "source": candle.get("source"),
                    "createdAt": now_iso(),
                }
                yield f"event: candle\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"
            except Exception as error:
                payload = {
                    "eventType": "LIVE_FEED_ERROR",
                    "status": "Error",
                    "symbol": normalized_symbol,
                    "timeframe": normalized_timeframe,
                    "error": str(error),
                    "createdAt": now_iso(),
                }
                yield f"event: error\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"

            await asyncio.sleep(interval)
    finally:
        LIVE_FEED_STATUS["streamClients"] = max(0, to_int(LIVE_FEED_STATUS.get("streamClients"), 0) - 1)


async def live_feed_ping_generator() -> AsyncGenerator[str, None]:
    while True:
        yield f"event: status\ndata: {json.dumps(live_feed_status(), separators=(',', ':'))}\n\n"
        await asyncio.sleep(5.0)
