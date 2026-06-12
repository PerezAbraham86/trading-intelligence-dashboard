from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from fastapi import HTTPException
from fastapi.responses import StreamingResponse


# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────

INSIGHTSENTRY_API_KEY = (
    os.getenv("INSIGHTSENTRY_API_KEY")
    or os.getenv("RAPIDAPI_KEY")
    or os.getenv("NEXT_PUBLIC_INSIGHTSENTRY_API_KEY")
    or ""
)

INSIGHTSENTRY_HOST = (
    os.getenv("INSIGHTSENTRY_HOST")
    or os.getenv("RAPIDAPI_HOST")
    or "insightsentry.p.rapidapi.com"
)

INSIGHTSENTRY_BASE_URL = (
    os.getenv("INSIGHTSENTRY_BASE_URL")
    or f"https://{INSIGHTSENTRY_HOST}"
).rstrip("/")

# RapidAPI/InsightSentry will rate-limit aggressive 1-second REST polling.
# Default to 5 seconds per symbol across the entire backend process.
LIVE_FEED_PROVIDER_POLL_SECONDS = float(os.getenv("LIVE_FEED_PROVIDER_POLL_SECONDS", "5.0"))
LIVE_FEED_SSE_HEARTBEAT_SECONDS = float(os.getenv("LIVE_FEED_SSE_HEARTBEAT_SECONDS", "1.0"))
LIVE_FEED_BACKOFF_SECONDS = float(os.getenv("LIVE_FEED_BACKOFF_SECONDS", "30.0"))
LIVE_FEED_REQUEST_TIMEOUT_SECONDS = float(os.getenv("LIVE_FEED_REQUEST_TIMEOUT_SECONDS", "10.0"))

# Limit history kept in memory per symbol/timeframe.
LIVE_FEED_MAX_CANDLES = int(os.getenv("LIVE_FEED_MAX_CANDLES", "1500"))


# ─────────────────────────────────────────────────────────────────────────────
# IN-MEMORY SHARED STATE
# ─────────────────────────────────────────────────────────────────────────────

# One cache shared by all connected browser EventSource clients.
_LIVE_PRICE_CACHE: Dict[str, Dict[str, Any]] = {}
_LIVE_CANDLE_CACHE: Dict[str, Dict[str, Any]] = {}
_LIVE_CANDLE_HISTORY: Dict[str, list[Dict[str, Any]]] = {}
_LIVE_PROVIDER_TASKS: Dict[str, asyncio.Task] = {}
_LIVE_LAST_ERROR: Dict[str, Dict[str, Any]] = {}
_LIVE_LOCK = asyncio.Lock()


# ─────────────────────────────────────────────────────────────────────────────
# NORMALIZATION HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
        if parsed == parsed and parsed not in (float("inf"), float("-inf")):
            return parsed
    except Exception:
        pass
    return fallback


def normalize_symbol(value: Any = "MES1!") -> str:
    raw = str(value or "MES1!").strip().upper()
    raw = (
        raw.replace("BINANCE:", "")
        .replace("COINBASE:", "")
        .replace("CRYPTO:", "")
        .replace("CME_MINI:", "")
        .replace("CME:", "")
    )

    if raw in {"MES1", "MES1!"} or "MES" in raw:
        return "MES1!"
    if raw in {"ES1", "ES1!"} or raw.startswith("ES"):
        return "ES1!"
    if "BTC" in raw:
        return "BTCUSD"
    if "ETH" in raw:
        return "ETHUSD"
    if "SPY" in raw:
        return "SPY"

    return raw or "MES1!"


def normalize_timeframe(value: Any = "1m") -> str:
    text = str(value or "1m").strip().lower()

    aliases = {
        "1": "1m",
        "3": "3m",
        "5": "5m",
        "10": "10m",
        "15": "15m",
        "30": "30m",
        "60": "1h",
        "120": "2h",
        "240": "4h",
        "d": "1d",
        "w": "1w",
    }

    return aliases.get(text, text or "1m")


def timeframe_to_seconds(timeframe: Any = "1m") -> int:
    text = normalize_timeframe(timeframe)

    try:
        if text.endswith("m"):
            return max(1, int(text[:-1] or "1")) * 60
        if text.endswith("h"):
            return max(1, int(text[:-1] or "1")) * 60 * 60
        if text.endswith("d"):
            return max(1, int(text[:-1] or "1")) * 24 * 60 * 60
        if text.endswith("w"):
            return max(1, int(text[:-1] or "1")) * 7 * 24 * 60 * 60
    except Exception:
        return 60

    return 60


def cache_key(symbol: Any, timeframe: Any = "1m") -> str:
    return f"{normalize_symbol(symbol)}::{normalize_timeframe(timeframe)}"


def symbol_key(symbol: Any) -> str:
    return normalize_symbol(symbol)


def bucket_epoch(timestamp: Optional[float] = None, timeframe: Any = "1m") -> int:
    ts = int(timestamp or time.time())
    seconds = timeframe_to_seconds(timeframe)
    return ts - (ts % max(1, seconds))


def rapidapi_headers() -> Dict[str, str]:
    if not INSIGHTSENTRY_API_KEY:
        raise HTTPException(status_code=500, detail="INSIGHTSENTRY_API_KEY is missing")

    return {
        "x-rapidapi-key": INSIGHTSENTRY_API_KEY,
        "x-rapidapi-host": INSIGHTSENTRY_HOST,
        "accept": "application/json",
    }


def http_get_json(path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    query = f"?{urlencode(params)}" if params else ""
    url = f"{INSIGHTSENTRY_BASE_URL}{path}{query}"

    request = Request(url, headers=rapidapi_headers(), method="GET")

    try:
        with urlopen(request, timeout=LIVE_FEED_REQUEST_TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except HTTPError as error:
        raise RuntimeError(f"HTTP Error {error.code}: {error.reason}") from error
    except URLError as error:
        raise RuntimeError(f"URL Error: {error.reason}") from error
    except Exception as error:
        raise RuntimeError(str(error)) from error


def extract_price_from_quote(payload: Any) -> Tuple[float, Dict[str, Any]]:
    """Extract last/price/bid/ask from multiple InsightSentry/RapidAPI shapes."""
    if payload is None:
        return 0.0, {}

    candidates: list[Any] = []

    if isinstance(payload, list):
        candidates.extend(payload)
    elif isinstance(payload, dict):
        candidates.extend(
            [
                payload,
                payload.get("data"),
                payload.get("quote"),
                payload.get("result"),
                payload.get("results"),
                payload.get("last"),
            ]
        )

        for key in ("data", "results", "quotes"):
            value = payload.get(key)
            if isinstance(value, list):
                candidates.extend(value)
            elif isinstance(value, dict):
                candidates.append(value)

    for item in candidates:
        if not isinstance(item, dict):
            continue

        values = [
            item.get("last"),
            item.get("lastPrice"),
            item.get("price"),
            item.get("mark"),
            item.get("markPrice"),
            item.get("mid"),
            item.get("close"),
            item.get("c"),
            item.get("bid"),
            item.get("ask"),
        ]

        for value in values:
            price = to_float(value, 0.0)
            if price > 0:
                quote = {
                    "price": price,
                    "last": to_float(item.get("last") or item.get("lastPrice") or price, price),
                    "bid": to_float(item.get("bid"), 0.0) or None,
                    "ask": to_float(item.get("ask"), 0.0) or None,
                    "raw": item,
                }
                return price, quote

    return 0.0, {}


def build_live_candle(
    *,
    symbol: Any,
    timeframe: Any,
    price: Any,
    previous_candle: Optional[Dict[str, Any]] = None,
    timestamp: Optional[float] = None,
    volume: Any = 0,
    source: str = "insightsentry_live_feed_throttled",
) -> Dict[str, Any]:
    live_price = to_float(price, 0.0)
    now_bucket = bucket_epoch(timestamp, timeframe)

    previous = previous_candle if isinstance(previous_candle, dict) else {}
    previous_time = int(to_float(previous.get("time") or previous.get("t"), 0.0))

    if previous and previous_time == now_bucket:
        open_price = to_float(previous.get("open") or previous.get("o"), live_price)
        high_price = max(to_float(previous.get("high") or previous.get("h"), live_price), live_price, open_price)
        low_price = min(to_float(previous.get("low") or previous.get("l"), live_price), live_price, open_price)
        previous_volume = to_float(previous.get("volume") or previous.get("v"), 0.0)
    else:
        open_price = live_price
        high_price = live_price
        low_price = live_price
        previous_volume = 0.0

    total_volume = previous_volume + max(0.0, to_float(volume, 0.0))

    return {
        "symbol": normalize_symbol(symbol),
        "timeframe": normalize_timeframe(timeframe),
        "time": now_bucket,
        "timestamp": now_bucket,
        "t": now_bucket,
        "open": round(open_price, 8),
        "high": round(high_price, 8),
        "low": round(low_price, 8),
        "close": round(live_price, 8),
        "o": round(open_price, 8),
        "h": round(high_price, 8),
        "l": round(low_price, 8),
        "c": round(live_price, 8),
        "volume": round(total_volume, 8),
        "v": round(total_volume, 8),
        "source": source,
        "updatedAt": now_iso(),
    }


def sse_event(event: str, payload: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


def sse_comment(message: str = "keepalive") -> str:
    return f": {message} {now_iso()}\n\n"


# ─────────────────────────────────────────────────────────────────────────────
# INSIGHTSENTRY REQUESTS
# ─────────────────────────────────────────────────────────────────────────────

def fetch_insightsentry_l1_quote(symbol: Any) -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)

    # Try paths your existing backend has used successfully. Stop at first valid price.
    paths = [
        f"/v3/symbols/{quote(normalized, safe='')}/quotes/l1",
        f"/v3/symbols/{quote(normalized, safe='')}/quote",
        f"/v3/symbols/{quote(normalized, safe='')}/quotes",
        "/v3/quotes/l1",
    ]

    errors: list[str] = []

    for path in paths:
        params = {"symbol": normalized} if path == "/v3/quotes/l1" else None

        try:
            payload = http_get_json(path, params=params)
            price, quote_payload = extract_price_from_quote(payload)

            if price > 0:
                return {
                    "symbol": normalized,
                    "price": price,
                    "quote": quote_payload,
                    "providerPayload": payload,
                    "sourcePath": path,
                    "createdAt": now_iso(),
                }
        except Exception as error:
            errors.append(str(error))

            # Important: if RapidAPI says 429, stop trying the other endpoints.
            # Trying fallback paths makes the rate limit worse.
            if "429" in str(error):
                raise

    raise RuntimeError("; ".join(errors) if errors else "No valid InsightSentry live quote")


# ─────────────────────────────────────────────────────────────────────────────
# SHARED PROVIDER LOOP
# ─────────────────────────────────────────────────────────────────────────────

async def ensure_provider_task(symbol: Any, timeframe: Any) -> None:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    key = cache_key(normalized_symbol, normalized_timeframe)

    async with _LIVE_LOCK:
        task = _LIVE_PROVIDER_TASKS.get(key)
        if task and not task.done():
            return

        _LIVE_PROVIDER_TASKS[key] = asyncio.create_task(
            provider_poll_loop(normalized_symbol, normalized_timeframe)
        )


async def provider_poll_loop(symbol: str, timeframe: str) -> None:
    key = cache_key(symbol, timeframe)
    sym_key = symbol_key(symbol)
    backoff_until = 0.0

    while True:
        try:
            now_ts = time.time()

            if now_ts < backoff_until:
                await asyncio.sleep(min(5.0, max(1.0, backoff_until - now_ts)))
                continue

            quote_payload = await asyncio.to_thread(fetch_insightsentry_l1_quote, symbol)
            price = to_float(quote_payload.get("price"), 0.0)

            if price <= 0:
                raise RuntimeError("InsightSentry quote returned no valid price")

            previous_candle = _LIVE_CANDLE_CACHE.get(key)
            candle = build_live_candle(
                symbol=symbol,
                timeframe=timeframe,
                price=price,
                previous_candle=previous_candle,
                source="insightsentry_rest_l1_shared_cache",
            )

            snapshot = {
                "eventType": "LIVE_PRICE_UPDATE",
                "status": "Live",
                "symbol": symbol,
                "timeframe": timeframe,
                "price": price,
                "last": quote_payload.get("quote", {}).get("last") or price,
                "bid": quote_payload.get("quote", {}).get("bid"),
                "ask": quote_payload.get("quote", {}).get("ask"),
                "source": quote_payload.get("sourcePath") or "insightsentry_l1",
                "createdAt": now_iso(),
            }

            _LIVE_PRICE_CACHE[sym_key] = snapshot
            _LIVE_CANDLE_CACHE[key] = candle
            _LIVE_LAST_ERROR.pop(key, None)

            history = _LIVE_CANDLE_HISTORY.setdefault(key, [])
            if history and int(history[-1].get("time", 0)) == int(candle.get("time", 0)):
                history[-1] = candle
            else:
                history.append(candle)
                if len(history) > LIVE_FEED_MAX_CANDLES:
                    del history[:-LIVE_FEED_MAX_CANDLES]

            await asyncio.sleep(max(2.0, LIVE_FEED_PROVIDER_POLL_SECONDS))

        except Exception as error:
            error_text = str(error)
            _LIVE_LAST_ERROR[key] = {
                "eventType": "LIVE_FEED_ERROR",
                "status": "Error",
                "symbol": symbol,
                "timeframe": timeframe,
                "error": error_text,
                "createdAt": now_iso(),
                "pollSeconds": LIVE_FEED_PROVIDER_POLL_SECONDS,
            }

            # 429 means the provider rate limit is active. Back off hard.
            if "429" in error_text or "Too Many Requests" in error_text:
                backoff_until = time.time() + max(15.0, LIVE_FEED_BACKOFF_SECONDS)

            await asyncio.sleep(max(5.0, min(LIVE_FEED_BACKOFF_SECONDS, 30.0)))


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC ROUTE HANDLERS IMPORTED BY api/main.py
# ─────────────────────────────────────────────────────────────────────────────

async def api_live_feed_status(symbol: str = "MES1!", timeframe: str = "1m") -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    key = cache_key(normalized_symbol, normalized_timeframe)

    await ensure_provider_task(normalized_symbol, normalized_timeframe)

    candle = _LIVE_CANDLE_CACHE.get(key)
    price = _LIVE_PRICE_CACHE.get(symbol_key(normalized_symbol))
    error = _LIVE_LAST_ERROR.get(key)

    return {
        "eventType": "LIVE_FEED_STATUS",
        "status": "Live" if candle or price else "Connecting",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "providerPollSeconds": LIVE_FEED_PROVIDER_POLL_SECONDS,
        "sseHeartbeatSeconds": LIVE_FEED_SSE_HEARTBEAT_SECONDS,
        "hasCandle": candle is not None,
        "hasPrice": price is not None,
        "price": price,
        "candle": candle,
        "lastError": error,
        "createdAt": now_iso(),
        "source": "insightsentry_live_feed_shared_throttled",
    }


async def api_live_feed_latest(symbol: str = "MES1!", timeframe: str = "1m") -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    key = cache_key(normalized_symbol, normalized_timeframe)

    await ensure_provider_task(normalized_symbol, normalized_timeframe)

    return {
        "eventType": "LIVE_FEED_LATEST",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "price": _LIVE_PRICE_CACHE.get(symbol_key(normalized_symbol)),
        "candle": _LIVE_CANDLE_CACHE.get(key),
        "history": _LIVE_CANDLE_HISTORY.get(key, [])[-20:],
        "lastError": _LIVE_LAST_ERROR.get(key),
        "providerPollSeconds": LIVE_FEED_PROVIDER_POLL_SECONDS,
        "createdAt": now_iso(),
    }


async def api_live_feed_ping() -> Dict[str, Any]:
    return {
        "eventType": "LIVE_FEED_PING",
        "status": "OK",
        "providerPollSeconds": LIVE_FEED_PROVIDER_POLL_SECONDS,
        "createdAt": now_iso(),
    }


async def api_live_feed_refresh_key() -> Dict[str, Any]:
    """Fetch InsightSentry WebSocket key from RapidAPI. This does not start WebSocket streaming yet."""
    try:
        payload = await asyncio.to_thread(http_get_json, "/v2/websocket-key", None)
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

    return {
        "eventType": "INSIGHTSENTRY_WEBSOCKET_KEY",
        "status": "OK",
        "payload": payload,
        "createdAt": now_iso(),
    }


async def live_feed_event_generator(
    symbol: str = "MES1!",
    timeframe: str = "1m",
    limit: int = 700,
    pollSeconds: Optional[float] = None,
) -> AsyncGenerator[str, None]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    key = cache_key(normalized_symbol, normalized_timeframe)

    await ensure_provider_task(normalized_symbol, normalized_timeframe)

    yield sse_event(
        "status",
        {
            "eventType": "LIVE_FEED_CONNECTED",
            "status": "Connected",
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "providerPollSeconds": LIVE_FEED_PROVIDER_POLL_SECONDS,
            "sseHeartbeatSeconds": LIVE_FEED_SSE_HEARTBEAT_SECONDS,
            "source": "insightsentry_live_feed_shared_throttled",
            "createdAt": now_iso(),
        },
    )

    last_candle_signature = ""
    last_error_signature = ""

    while True:
        candle = _LIVE_CANDLE_CACHE.get(key)
        price = _LIVE_PRICE_CACHE.get(symbol_key(normalized_symbol))
        error = _LIVE_LAST_ERROR.get(key)

        if candle:
            signature = json.dumps(
                {
                    "time": candle.get("time"),
                    "open": candle.get("open"),
                    "high": candle.get("high"),
                    "low": candle.get("low"),
                    "close": candle.get("close"),
                    "updatedAt": candle.get("updatedAt"),
                },
                sort_keys=True,
            )

            if signature != last_candle_signature:
                last_candle_signature = signature

                yield sse_event(
                    "candle",
                    {
                        "eventType": "LIVE_CANDLE",
                        "status": "Live",
                        "symbol": normalized_symbol,
                        "timeframe": normalized_timeframe,
                        "price": price.get("price") if isinstance(price, dict) else candle.get("close"),
                        "livePrice": price.get("price") if isinstance(price, dict) else candle.get("close"),
                        "candle": candle,
                        "liveCandle": candle,
                        "bar": candle,
                        "source": "insightsentry_live_feed_shared_throttled",
                        "createdAt": now_iso(),
                    },
                )
        elif error:
            error_signature = json.dumps(error, sort_keys=True)
            if error_signature != last_error_signature:
                last_error_signature = error_signature
                yield sse_event("error", error)
        else:
            yield sse_comment("waiting-for-provider-cache")

        await asyncio.sleep(max(0.5, float(pollSeconds or LIVE_FEED_SSE_HEARTBEAT_SECONDS)))


async def api_live_feed_stream(
    symbol: str = "MES1!",
    timeframe: str = "1m",
    pollSeconds: Optional[float] = None,
) -> StreamingResponse:
    return StreamingResponse(
        live_feed_event_generator(symbol=symbol, timeframe=timeframe, pollSeconds=pollSeconds),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# COMPATIBILITY ALIASES FOR CURRENT api/main.py
# ─────────────────────────────────────────────────────────────────────────────
#
# Current api/main.py imports these older names:
#   get_latest_live_snapshot
#   live_feed_event_generator
#   live_feed_ping_generator
#   live_feed_status
#   refresh_insightsentry_websocket_key
#
# Keep these wrappers so the module imports cleanly without needing another
# main.py route rewrite.

def live_feed_status() -> Dict[str, Any]:
    """Synchronous status wrapper expected by api/main.py."""
    status_rows = []

    for key, candle in _LIVE_CANDLE_CACHE.items():
        symbol, timeframe = key.split("::", 1)
        status_rows.append(
            {
                "symbol": symbol,
                "timeframe": timeframe,
                "hasCandle": candle is not None,
                "candle": candle,
                "price": _LIVE_PRICE_CACHE.get(symbol_key(symbol)),
                "lastError": _LIVE_LAST_ERROR.get(key),
            }
        )

    return {
        "eventType": "LIVE_FEED_STATUS",
        "status": "Live" if status_rows else "Waiting",
        "providerPollSeconds": LIVE_FEED_PROVIDER_POLL_SECONDS,
        "sseHeartbeatSeconds": LIVE_FEED_SSE_HEARTBEAT_SECONDS,
        "tracked": status_rows,
        "createdAt": now_iso(),
        "source": "insightsentry_live_feed_shared_throttled",
    }


def get_latest_live_snapshot(symbol: str = "MES1!", timeframe: str = "1m") -> Dict[str, Any]:
    """Synchronous latest snapshot wrapper expected by api/main.py."""
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    key = cache_key(normalized_symbol, normalized_timeframe)

    return {
        "eventType": "LIVE_FEED_LATEST",
        "status": "Live" if _LIVE_CANDLE_CACHE.get(key) or _LIVE_PRICE_CACHE.get(symbol_key(normalized_symbol)) else "Waiting",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "price": _LIVE_PRICE_CACHE.get(symbol_key(normalized_symbol)),
        "candle": _LIVE_CANDLE_CACHE.get(key),
        "history": _LIVE_CANDLE_HISTORY.get(key, [])[-20:],
        "lastError": _LIVE_LAST_ERROR.get(key),
        "providerPollSeconds": LIVE_FEED_PROVIDER_POLL_SECONDS,
        "createdAt": now_iso(),
        "source": "insightsentry_live_feed_shared_throttled",
    }


async def live_feed_ping_generator() -> AsyncGenerator[str, None]:
    """SSE ping wrapper expected by api/main.py."""
    while True:
        yield sse_event(
            "ping",
            {
                "eventType": "LIVE_FEED_PING",
                "status": "OK",
                "providerPollSeconds": LIVE_FEED_PROVIDER_POLL_SECONDS,
                "sseHeartbeatSeconds": LIVE_FEED_SSE_HEARTBEAT_SECONDS,
                "createdAt": now_iso(),
                "source": "insightsentry_live_feed_shared_throttled",
            },
        )
        await asyncio.sleep(max(1.0, LIVE_FEED_SSE_HEARTBEAT_SECONDS))


def refresh_insightsentry_websocket_key(force: bool = False) -> Dict[str, Any]:
    """Synchronous websocket-key wrapper expected by api/main.py."""
    try:
        payload = http_get_json("/v2/websocket-key", None)
        return {
            "eventType": "INSIGHTSENTRY_WEBSOCKET_KEY",
            "status": "OK",
            "force": bool(force),
            "payload": payload,
            "createdAt": now_iso(),
            "source": "insightsentry_rapidapi_websocket_key",
        }
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
