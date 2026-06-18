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

import websockets
from fastapi import HTTPException


# ─────────────────────────────────────────────────────────────────────────────
# MARKETBOS PHASE 8.5 — INSIGHTSENTRY REAL WEBSOCKET LIVE FEED
# ─────────────────────────────────────────────────────────────────────────────
#
# This module is intentionally compatible with the current api/main.py imports:
#   get_latest_live_snapshot
#   live_feed_event_generator
#   live_feed_ping_generator
#   live_feed_status
#   refresh_insightsentry_websocket_key
#
# RapidAPI flow:
#   1) Call /v2/websocket-key with RapidAPI headers.
#   2) Connect one backend WebSocket to wss://realtime.insightsentry.com/live.
#   3) Send one complete subscription message:
#      {
#        "api_key": "<temporary websocket key>",
#        "subscriptions": [
#          {"code":"CME_MINI:MES1!","type":"series","bar_type":"minute","bar_interval":1,"max_dp":1000}
#        ]
#      }
#   4) Push incoming series candles to every dashboard EventSource client.
#
# Important: InsightSentry websocket plan can allow only 1 active connection, so
# the browser must NOT connect directly to InsightSentry. This backend owns the
# one provider websocket and fans out updates through /api/live-feed/stream.


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

INSIGHTSENTRY_WS_LIVE_URL = os.getenv(
    "INSIGHTSENTRY_WS_LIVE_URL",
    "wss://realtime.insightsentry.com/live",
)

# Keep this modest; user plan may support 5 subscriptions and 1 connection.
INSIGHTSENTRY_WS_MAX_DP = int(os.getenv("INSIGHTSENTRY_WS_MAX_DP", "1000"))
INSIGHTSENTRY_WS_RECONNECT_MIN_SECONDS = float(os.getenv("INSIGHTSENTRY_WS_RECONNECT_MIN_SECONDS", "2.0"))
INSIGHTSENTRY_WS_RECONNECT_MAX_SECONDS = float(os.getenv("INSIGHTSENTRY_WS_RECONNECT_MAX_SECONDS", "30.0"))
INSIGHTSENTRY_WS_PING_SECONDS = float(os.getenv("INSIGHTSENTRY_WS_PING_SECONDS", "20.0"))

# SSE fans out cached websocket data every second without hitting provider limits.
LIVE_FEED_SSE_HEARTBEAT_SECONDS = float(os.getenv("LIVE_FEED_SSE_HEARTBEAT_SECONDS", "1.0"))
LIVE_FEED_MAX_CANDLES = int(os.getenv("LIVE_FEED_MAX_CANDLES", "3000"))

# REST fallback is disabled by default because REST quote endpoints returned 404/429.
# Turn it on only if InsightSentry REST quote endpoint is confirmed.
LIVE_FEED_ENABLE_REST_FALLBACK = os.getenv("LIVE_FEED_ENABLE_REST_FALLBACK", "false").lower() in {"1", "true", "yes"}


# ─────────────────────────────────────────────────────────────────────────────
# SHARED STATE
# ─────────────────────────────────────────────────────────────────────────────

_WS_API_KEY: Optional[str] = None
_WS_API_KEY_EXPIRATION: float = 0.0
_WS_MANAGER_TASK: Optional[asyncio.Task] = None
_WS_FORCE_RESUBSCRIBE = asyncio.Event()
_WS_STARTED_AT: Optional[str] = None

_DESIRED_SUBSCRIPTIONS: Dict[str, Dict[str, Any]] = {}
_LIVE_PRICE_CACHE: Dict[str, Dict[str, Any]] = {}
_LIVE_CANDLE_CACHE: Dict[str, Dict[str, Any]] = {}
_LIVE_CANDLE_HISTORY: Dict[str, list[Dict[str, Any]]] = {}
_LIVE_LAST_ERROR: Dict[str, Dict[str, Any]] = {}
_LIVE_STATUS: Dict[str, Any] = {
    "eventType": "LIVE_FEED_STATUS",
    "status": "Idle",
    "source": "insightsentry_websocket_backend_bridge",
    "createdAt": None,
}
_LIVE_LOCK = asyncio.Lock()


# ─────────────────────────────────────────────────────────────────────────────
# BASIC HELPERS
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
    if raw in {"NQ1", "NQ1!"} or raw.startswith("NQ"):
        return "NQ1!"
    if "BTC" in raw:
        return "BTCUSD"
    if "ETH" in raw:
        return "ETHUSD"
    if "SPY" in raw:
        return "SPY"

    return raw or "MES1!"


def provider_symbol(symbol: Any) -> str:
    normalized = normalize_symbol(symbol)

    if normalized == "MES1!":
        return "CME_MINI:MES1!"
    if normalized == "ES1!":
        return "CME_MINI:ES1!"
    if normalized == "NQ1!":
        return "CME_MINI:NQ1!"
    if normalized == "BTCUSD":
        return "BINANCE:BTCUSDT"
    if normalized == "ETHUSD":
        return "BINANCE:ETHUSDT"
    if normalized == "SPY":
        return "AMEX:SPY"

    return normalized


def symbol_from_provider_code(code: Any) -> str:
    text = str(code or "").strip().upper()

    if "MES" in text:
        return "MES1!"
    if "ES1" in text or text.endswith(":ES") or text == "ES":
        return "ES1!"
    if "NQ" in text:
        return "NQ1!"
    if "BTC" in text:
        return "BTCUSD"
    if "ETH" in text:
        return "ETHUSD"
    if "SPY" in text:
        return "SPY"

    return normalize_symbol(text)


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


def timeframe_to_ws_bar(timeframe: Any = "1m") -> Tuple[str, int]:
    tf = normalize_timeframe(timeframe)

    try:
        if tf.endswith("m"):
            return "minute", max(1, int(tf[:-1] or "1"))
        if tf.endswith("h"):
            return "hour", max(1, int(tf[:-1] or "1"))
        if tf.endswith("d"):
            return "day", max(1, int(tf[:-1] or "1"))
        if tf.endswith("w"):
            return "week", max(1, int(tf[:-1] or "1"))
        if tf.endswith("s"):
            return "second", max(1, int(tf[:-1] or "1"))
    except Exception:
        pass

    return "minute", 1


def ws_bar_to_timeframe(message: Dict[str, Any], fallback: str = "1m") -> str:
    bar_type = str(message.get("bar_type") or "").strip().lower()

    # Docs example gives "bar_type": "1m" in responses.
    if bar_type.endswith("m") or bar_type.endswith("h") or bar_type.endswith("d") or bar_type.endswith("w"):
        return normalize_timeframe(bar_type)

    if bar_type in {"minute", "minutes"}:
        return f"{int(to_float(message.get('bar_interval'), 1))}m"
    if bar_type in {"hour", "hours"}:
        return f"{int(to_float(message.get('bar_interval'), 1))}h"
    if bar_type in {"day", "days"}:
        return "1d"
    if bar_type in {"week", "weeks"}:
        return "1w"
    if bar_type in {"second", "seconds"}:
        return f"{int(to_float(message.get('bar_interval'), 1))}s"

    return normalize_timeframe(fallback)


def timeframe_seconds(timeframe: Any = "1m") -> int:
    tf = normalize_timeframe(timeframe)
    mapping = {
        "1m": 60,
        "3m": 180,
        "5m": 300,
        "10m": 600,
    }
    if tf in mapping:
        return mapping[tf]

    try:
        if tf.endswith("m"):
            return max(1, int(tf[:-1] or "1")) * 60
        if tf.endswith("h"):
            return max(1, int(tf[:-1] or "1")) * 3600
        if tf.endswith("d"):
            return max(1, int(tf[:-1] or "1")) * 86400
        if tf.endswith("w"):
            return max(1, int(tf[:-1] or "1")) * 604800
        if tf.endswith("s"):
            return max(1, int(tf[:-1] or "1"))
    except Exception:
        pass

    return 60


def bucket_timestamp(timestamp: Any, timeframe: Any = "1m") -> int:
    raw_timestamp = int(to_float(timestamp, time.time()))
    bucket_seconds = max(1, timeframe_seconds(timeframe))
    return int((raw_timestamp // bucket_seconds) * bucket_seconds)


def cache_key(symbol: Any, timeframe: Any = "1m") -> str:
    return f"{normalize_symbol(symbol)}::{normalize_timeframe(timeframe)}"


def symbol_key(symbol: Any) -> str:
    return normalize_symbol(symbol)


def sse_event(event: str, payload: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


def sse_comment(message: str = "keepalive") -> str:
    return f": {message} {now_iso()}\n\n"


# ─────────────────────────────────────────────────────────────────────────────
# RAPIDAPI KEY REFRESH
# ─────────────────────────────────────────────────────────────────────────────

def rapidapi_headers() -> Dict[str, str]:
    if not INSIGHTSENTRY_API_KEY:
        raise HTTPException(status_code=500, detail="INSIGHTSENTRY_API_KEY is missing")

    return {
        "x-rapidapi-key": INSIGHTSENTRY_API_KEY,
        "x-rapidapi-host": INSIGHTSENTRY_HOST,
        "accept": "application/json",
        "content-type": "application/json",
    }


def http_get_json(path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    query = f"?{urlencode(params)}" if params else ""
    url = f"{INSIGHTSENTRY_BASE_URL}{path}{query}"

    request = Request(url, headers=rapidapi_headers(), method="GET")

    try:
        with urlopen(request, timeout=12) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except HTTPError as error:
        raise RuntimeError(f"HTTP Error {error.code}: {error.reason}") from error
    except URLError as error:
        raise RuntimeError(f"URL Error: {error.reason}") from error
    except Exception as error:
        raise RuntimeError(str(error)) from error


def refresh_insightsentry_websocket_key(force: bool = False) -> Dict[str, Any]:
    """Return and cache the temporary WebSocket key for RapidAPI subscriptions."""
    global _WS_API_KEY, _WS_API_KEY_EXPIRATION

    now_ts = time.time()
    # Refresh if key is missing or has less than 1 hour left.
    if (
        not force
        and _WS_API_KEY
        and _WS_API_KEY_EXPIRATION
        and _WS_API_KEY_EXPIRATION - now_ts > 3600
    ):
        return {
            "eventType": "INSIGHTSENTRY_WEBSOCKET_KEY",
            "status": "Cached",
            "hasKey": True,
            "expiration": _WS_API_KEY_EXPIRATION,
            "secondsRemaining": int(_WS_API_KEY_EXPIRATION - now_ts),
            "createdAt": now_iso(),
            "source": "insightsentry_rapidapi_websocket_key",
        }

    payload = http_get_json("/v2/websocket-key", None)

    key = str(payload.get("api_key") or "").strip()
    expiration = to_float(payload.get("expiration"), 0.0)

    if not key:
        raise HTTPException(status_code=502, detail="InsightSentry websocket-key response did not include api_key")

    _WS_API_KEY = key
    _WS_API_KEY_EXPIRATION = expiration or (time.time() + 7 * 24 * 60 * 60)

    return {
        "eventType": "INSIGHTSENTRY_WEBSOCKET_KEY",
        "status": "OK",
        "hasKey": True,
        "expiration": _WS_API_KEY_EXPIRATION,
        "secondsRemaining": int(max(0, _WS_API_KEY_EXPIRATION - time.time())),
        "note": payload.get("note"),
        "createdAt": now_iso(),
        "source": "insightsentry_rapidapi_websocket_key",
    }


async def get_ws_key_async(force: bool = False) -> str:
    result = await asyncio.to_thread(refresh_insightsentry_websocket_key, force)
    if not _WS_API_KEY:
        raise RuntimeError(f"Unable to get websocket key: {result}")
    return _WS_API_KEY


# ─────────────────────────────────────────────────────────────────────────────
# SUBSCRIPTION + CACHE UPDATE
# ─────────────────────────────────────────────────────────────────────────────

async def ensure_subscription(symbol: Any, timeframe: Any = "1m") -> None:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    code = provider_symbol(normalized_symbol)
    bar_type, bar_interval = timeframe_to_ws_bar(normalized_timeframe)

    sub_key = cache_key(normalized_symbol, normalized_timeframe)

    async with _LIVE_LOCK:
        _DESIRED_SUBSCRIPTIONS[sub_key] = {
            "code": code,
            "type": "series",
            "bar_type": bar_type,
            "bar_interval": bar_interval,
            "max_dp": INSIGHTSENTRY_WS_MAX_DP,
            # Futures only; use regular close/last traded price.
            "badj": False,
            "settlement": False,
        }

    _WS_FORCE_RESUBSCRIBE.set()
    await ensure_websocket_manager()


async def ensure_websocket_manager() -> None:
    global _WS_MANAGER_TASK

    async with _LIVE_LOCK:
        if _WS_MANAGER_TASK and not _WS_MANAGER_TASK.done():
            return

        _WS_MANAGER_TASK = asyncio.create_task(websocket_manager_loop())


def subscription_payload(api_key: str) -> Dict[str, Any]:
    subscriptions = list(_DESIRED_SUBSCRIPTIONS.values())

    # Keep deterministic order and respect small plan limits. User key reported
    # max_subscriptions=5; keep at most 5 to avoid rejection.
    subscriptions = sorted(subscriptions, key=lambda item: (item.get("code", ""), item.get("bar_type", ""), item.get("bar_interval", 0)))[:5]

    return {
        "api_key": api_key,
        "subscriptions": subscriptions,
    }


def parse_ws_json_message(message: Any) -> Optional[Dict[str, Any]]:
    if isinstance(message, bytes):
        message = message.decode("utf-8", errors="replace")

    if not isinstance(message, str):
        return None

    text = message.strip()
    if not text or text == "pong":
        return None

    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return {
            "eventType": "RAW_WS_MESSAGE",
            "message": text,
        }


def normalize_series_candle(symbol: str, timeframe: str, raw_candle: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    open_price = to_float(raw_candle.get("open") or raw_candle.get("o"), 0.0)
    high_price = to_float(raw_candle.get("high") or raw_candle.get("h"), 0.0)
    low_price = to_float(raw_candle.get("low") or raw_candle.get("l"), 0.0)
    close_price = to_float(raw_candle.get("close") or raw_candle.get("c"), 0.0)

    if close_price <= 0:
        return None

    if open_price <= 0:
        open_price = close_price
    if high_price <= 0:
        high_price = max(open_price, close_price)
    if low_price <= 0:
        low_price = min(open_price, close_price)

    raw_timestamp = int(to_float(raw_candle.get("time") or raw_candle.get("timestamp") or raw_candle.get("t"), time.time()))
    bucket_time = bucket_timestamp(raw_timestamp, timeframe)
    volume = to_float(raw_candle.get("volume") or raw_candle.get("v"), 0.0)

    return {
        "symbol": normalize_symbol(symbol),
        "timeframe": normalize_timeframe(timeframe),
        "time": bucket_time,
        "timestamp": bucket_time,
        "t": bucket_time,
        "rawTime": raw_timestamp,
        "actualTime": raw_timestamp,
        "open": round(open_price, 8),
        "high": round(max(high_price, open_price, close_price), 8),
        "low": round(min(low_price, open_price, close_price), 8),
        "close": round(close_price, 8),
        "o": round(open_price, 8),
        "h": round(max(high_price, open_price, close_price), 8),
        "l": round(min(low_price, open_price, close_price), 8),
        "c": round(close_price, 8),
        "volume": round(volume, 8),
        "v": round(volume, 8),
        "source": "insightsentry_ws_series",
        "updatedAt": now_iso(),
    }


def update_cache_from_candle(symbol: str, timeframe: str, candle: Dict[str, Any], raw_message: Optional[Dict[str, Any]] = None) -> None:
    key = cache_key(symbol, timeframe)
    sym_key = symbol_key(symbol)
    bucket_time = int(candle.get("time") or candle.get("timestamp") or candle.get("t") or 0)
    close_price = to_float(candle.get("close") or candle.get("c"), 0.0)

    if close_price <= 0 or bucket_time <= 0:
        return

    candle = dict(candle)
    candle["time"] = bucket_time
    candle["timestamp"] = bucket_time
    candle["t"] = bucket_time
    _LIVE_CANDLE_CACHE[key] = candle
    _LIVE_PRICE_CACHE[sym_key] = {
        "eventType": "LIVE_PRICE_UPDATE",
        "status": "Live",
        "symbol": normalize_symbol(symbol),
        "timeframe": normalize_timeframe(timeframe),
        "price": close_price,
        "last": close_price,
        "bid": None,
        "ask": None,
        "source": "insightsentry_ws_series",
        "createdAt": now_iso(),
    }
    _LIVE_LAST_ERROR.pop(key, None)

    history = _LIVE_CANDLE_HISTORY.setdefault(key, [])
    replaced = False
    for index in range(len(history) - 1, -1, -1):
        history_bucket_time = int(history[index].get("time") or history[index].get("timestamp") or history[index].get("t") or 0)
        if history_bucket_time == bucket_time:
            history[index] = candle
            replaced = True
            break

    if not replaced:
        history.append(candle)
        history.sort(key=lambda item: int(item.get("time") or item.get("timestamp") or item.get("t") or 0))

    if len(history) > LIVE_FEED_MAX_CANDLES:
        del history[:-LIVE_FEED_MAX_CANDLES]


def handle_ws_data_message(message: Dict[str, Any]) -> None:
    if not message:
        return

    if "server_time" in message:
        _LIVE_STATUS.update(
            {
                "eventType": "LIVE_FEED_STATUS",
                "status": "Heartbeat",
                "serverTime": message.get("server_time"),
                "updatedAt": now_iso(),
            }
        )
        return

    if "message" in message and "series" not in message and "data" not in message:
        _LIVE_STATUS.update(
            {
                "eventType": "LIVE_FEED_STATUS",
                "status": "Info",
                "message": message.get("message"),
                "server": message.get("server"),
                "updatedAt": now_iso(),
            }
        )
        return

    # Series response shape from docs:
    # {"code":"NASDAQ:AAPL","bar_end":...,"last_update":...,"bar_type":"1m","series":[{...}]}
    if isinstance(message.get("series"), list):
        code = message.get("code")
        symbol = symbol_from_provider_code(code)
        timeframe = ws_bar_to_timeframe(message, "1m")

        for raw_candle in message.get("series") or []:
            if not isinstance(raw_candle, dict):
                continue

            candle = normalize_series_candle(symbol, timeframe, raw_candle)
            if candle:
                update_cache_from_candle(symbol, timeframe, candle, message)

        return

    # Quote response shape from docs:
    # {"data":[{"code":"NASDAQ:AAPL","last_price":239.42,...}]}
    if isinstance(message.get("data"), list):
        for item in message.get("data") or []:
            if not isinstance(item, dict):
                continue

            symbol = symbol_from_provider_code(item.get("code"))
            price = to_float(item.get("last_price") or item.get("last") or item.get("price"), 0.0)
            if price <= 0:
                continue

            sym_key = symbol_key(symbol)
            _LIVE_PRICE_CACHE[sym_key] = {
                "eventType": "LIVE_PRICE_UPDATE",
                "status": "Live",
                "symbol": symbol,
                "timeframe": "quote",
                "price": price,
                "last": price,
                "bid": to_float(item.get("bid"), 0.0) or None,
                "ask": to_float(item.get("ask"), 0.0) or None,
                "source": "insightsentry_ws_quote",
                "createdAt": now_iso(),
            }

        return

    if "error" in message or str(message.get("eventType", "")).lower().endswith("error"):
        error_payload = {
            "eventType": "LIVE_FEED_ERROR",
            "status": "Error",
            "error": message.get("error") or message.get("message") or json.dumps(message),
            "raw": message,
            "createdAt": now_iso(),
        }

        for key in _DESIRED_SUBSCRIPTIONS.keys():
            _LIVE_LAST_ERROR[key] = error_payload

        _LIVE_STATUS.update(error_payload)


async def send_ping_loop(websocket: Any) -> None:
    while True:
        await asyncio.sleep(max(15.0, INSIGHTSENTRY_WS_PING_SECONDS))
        await websocket.send("ping")


async def websocket_manager_loop() -> None:
    global _WS_STARTED_AT

    reconnect_delay = INSIGHTSENTRY_WS_RECONNECT_MIN_SECONDS

    while True:
        try:
            if not _DESIRED_SUBSCRIPTIONS:
                _LIVE_STATUS.update(
                    {
                        "eventType": "LIVE_FEED_STATUS",
                        "status": "Waiting",
                        "detail": "No active subscriptions yet",
                        "updatedAt": now_iso(),
                    }
                )
                await asyncio.sleep(1)
                continue

            api_key = await get_ws_key_async(force=False)
            _WS_STARTED_AT = now_iso()

            _LIVE_STATUS.update(
                {
                    "eventType": "LIVE_FEED_STATUS",
                    "status": "Connecting",
                    "url": INSIGHTSENTRY_WS_LIVE_URL,
                    "subscriptionCount": len(_DESIRED_SUBSCRIPTIONS),
                    "updatedAt": now_iso(),
                }
            )

            async with websockets.connect(
                INSIGHTSENTRY_WS_LIVE_URL,
                ping_interval=None,
                close_timeout=10,
                max_size=2_000_000,
            ) as websocket:
                reconnect_delay = INSIGHTSENTRY_WS_RECONNECT_MIN_SECONDS

                payload = subscription_payload(api_key)
                await websocket.send(json.dumps(payload))

                _LIVE_STATUS.update(
                    {
                        "eventType": "LIVE_FEED_STATUS",
                        "status": "Subscribed",
                        "url": INSIGHTSENTRY_WS_LIVE_URL,
                        "subscriptionCount": len(payload.get("subscriptions", [])),
                        "subscriptions": payload.get("subscriptions", []),
                        "updatedAt": now_iso(),
                    }
                )

                _WS_FORCE_RESUBSCRIBE.clear()
                ping_task = asyncio.create_task(send_ping_loop(websocket))

                try:
                    while True:
                        receive_task = asyncio.create_task(websocket.recv())
                        resub_task = asyncio.create_task(_WS_FORCE_RESUBSCRIBE.wait())

                        done, pending = await asyncio.wait(
                            {receive_task, resub_task},
                            return_when=asyncio.FIRST_COMPLETED,
                        )

                        for task in pending:
                            task.cancel()

                        if resub_task in done and _WS_FORCE_RESUBSCRIBE.is_set():
                            payload = subscription_payload(api_key)
                            await websocket.send(json.dumps(payload))
                            _WS_FORCE_RESUBSCRIBE.clear()
                            _LIVE_STATUS.update(
                                {
                                    "eventType": "LIVE_FEED_STATUS",
                                    "status": "Resubscribed",
                                    "subscriptionCount": len(payload.get("subscriptions", [])),
                                    "subscriptions": payload.get("subscriptions", []),
                                    "updatedAt": now_iso(),
                                }
                            )
                            continue

                        if receive_task in done:
                            raw_message = receive_task.result()

                            if raw_message == "pong":
                                continue

                            parsed = parse_ws_json_message(raw_message)
                            if parsed:
                                handle_ws_data_message(parsed)

                finally:
                    ping_task.cancel()

        except Exception as error:
            error_text = str(error)
            _LIVE_STATUS.update(
                {
                    "eventType": "LIVE_FEED_ERROR",
                    "status": "Error",
                    "error": error_text,
                    "reconnectDelay": reconnect_delay,
                    "updatedAt": now_iso(),
                }
            )

            for key in _DESIRED_SUBSCRIPTIONS.keys():
                _LIVE_LAST_ERROR[key] = {
                    "eventType": "LIVE_FEED_ERROR",
                    "status": "Error",
                    "error": error_text,
                    "createdAt": now_iso(),
                    "source": "insightsentry_ws_manager",
                }

            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(INSIGHTSENTRY_WS_RECONNECT_MAX_SECONDS, reconnect_delay * 2)


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC ROUTE HELPERS IMPORTED BY api/main.py
# ─────────────────────────────────────────────────────────────────────────────

def live_feed_status() -> Dict[str, Any]:
    rows = []

    for key, sub in _DESIRED_SUBSCRIPTIONS.items():
        symbol, timeframe = key.split("::", 1)
        rows.append(
            {
                "symbol": symbol,
                "timeframe": timeframe,
                "providerCode": sub.get("code"),
                "hasCandle": key in _LIVE_CANDLE_CACHE,
                "candle": _LIVE_CANDLE_CACHE.get(key),
                "price": _LIVE_PRICE_CACHE.get(symbol_key(symbol)),
                "lastError": _LIVE_LAST_ERROR.get(key),
            }
        )

    return {
        "eventType": "LIVE_FEED_STATUS",
        "status": _LIVE_STATUS.get("status", "Idle"),
        "source": "insightsentry_websocket_backend_bridge",
        "wsUrl": INSIGHTSENTRY_WS_LIVE_URL,
        "wsStartedAt": _WS_STARTED_AT,
        "hasWsKey": bool(_WS_API_KEY),
        "wsKeyExpiresAt": _WS_API_KEY_EXPIRATION or None,
        "subscriptionCount": len(_DESIRED_SUBSCRIPTIONS),
        "subscriptions": list(_DESIRED_SUBSCRIPTIONS.values()),
        "tracked": rows,
        "managerRunning": bool(_WS_MANAGER_TASK and not _WS_MANAGER_TASK.done()),
        "lastStatus": dict(_LIVE_STATUS),
        "createdAt": now_iso(),
    }


def get_latest_live_snapshot(symbol: str = "MES1!", timeframe: str = "1m") -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    key = cache_key(normalized_symbol, normalized_timeframe)

    return {
        "eventType": "LIVE_FEED_LATEST",
        "status": "Live" if _LIVE_CANDLE_CACHE.get(key) else _LIVE_STATUS.get("status", "Waiting"),
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "providerCode": provider_symbol(normalized_symbol),
        "price": _LIVE_PRICE_CACHE.get(symbol_key(normalized_symbol)),
        "candle": _LIVE_CANDLE_CACHE.get(key),
        "history": _LIVE_CANDLE_HISTORY.get(key, [])[-20:],
        "lastError": _LIVE_LAST_ERROR.get(key),
        "lastStatus": dict(_LIVE_STATUS),
        "createdAt": now_iso(),
        "source": "insightsentry_websocket_backend_bridge",
    }


async def live_feed_ping_generator() -> AsyncGenerator[str, None]:
    while True:
        yield sse_event(
            "ping",
            {
                "eventType": "LIVE_FEED_PING",
                "status": "OK",
                "managerRunning": bool(_WS_MANAGER_TASK and not _WS_MANAGER_TASK.done()),
                "subscriptionCount": len(_DESIRED_SUBSCRIPTIONS),
                "wsStatus": _LIVE_STATUS.get("status", "Idle"),
                "createdAt": now_iso(),
                "source": "insightsentry_websocket_backend_bridge",
            },
        )
        await asyncio.sleep(max(1.0, LIVE_FEED_SSE_HEARTBEAT_SECONDS))


async def live_feed_event_generator(
    symbol: str = "MES1!",
    timeframe: str = "1m",
    limit: int = 700,
    pollSeconds: Optional[float] = None,
) -> AsyncGenerator[str, None]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    key = cache_key(normalized_symbol, normalized_timeframe)

    await ensure_subscription(normalized_symbol, normalized_timeframe)

    yield sse_event(
        "status",
        {
            "eventType": "LIVE_FEED_CONNECTED",
            "status": "Connected",
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "providerCode": provider_symbol(normalized_symbol),
            "wsStatus": _LIVE_STATUS.get("status", "Starting"),
            "source": "insightsentry_websocket_backend_bridge",
            "createdAt": now_iso(),
        },
    )

    last_candle_signature = ""
    last_error_signature = ""
    last_status_signature = ""
    heartbeat_seconds = max(0.5, float(pollSeconds or LIVE_FEED_SSE_HEARTBEAT_SECONDS))

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
                        "providerCode": provider_symbol(normalized_symbol),
                        "price": price.get("price") if isinstance(price, dict) else candle.get("close"),
                        "livePrice": price.get("price") if isinstance(price, dict) else candle.get("close"),
                        "candle": candle,
                        "liveCandle": candle,
                        "bar": candle,
                        "source": "insightsentry_ws_series",
                        "createdAt": now_iso(),
                    },
                )

        elif error:
            error_signature = json.dumps(error, sort_keys=True)
            if error_signature != last_error_signature:
                last_error_signature = error_signature
                yield sse_event("error", error)

        else:
            status_payload = {
                "eventType": "LIVE_FEED_WAITING",
                "status": "Waiting",
                "symbol": normalized_symbol,
                "timeframe": normalized_timeframe,
                "providerCode": provider_symbol(normalized_symbol),
                "wsStatus": _LIVE_STATUS.get("status", "Starting"),
                "subscriptionCount": len(_DESIRED_SUBSCRIPTIONS),
                "lastStatus": dict(_LIVE_STATUS),
                "createdAt": now_iso(),
            }
            status_signature = json.dumps(status_payload, sort_keys=True)

            if status_signature != last_status_signature:
                last_status_signature = status_signature
                yield sse_event("status", status_payload)
            else:
                yield sse_comment("waiting-for-websocket-candle")

        await asyncio.sleep(heartbeat_seconds)
