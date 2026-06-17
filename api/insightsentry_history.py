from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from fastapi import HTTPException


# ─────────────────────────────────────────────────────────────────────────────
# MARKETBOS PHASE 8.6 — INSIGHTSENTRY HISTORICAL TIME SERIES OHLCV
# ─────────────────────────────────────────────────────────────────────────────
#
# Confirmed RapidAPI endpoint:
#
#   GET https://insightsentry.p.rapidapi.com/v3/symbols/{symbol_code}/history
#
# Confirmed MES path param:
#
#   CME_MINI:MES1!
#
# Confirmed params:
#
#   bar_type=minute
#   bar_interval=1
#   extended=true
#   badj=true
#   dadj=false
#   start_ym=2026-06
#
# Response shape confirmed:
#
#   {
#     "code": "CME_MINI:MES1!",
#     "_ct": ...,
#     "bar_type": "1m",
#     "series": [
#       {"time":1780272000,"open":7605.25,"high":7606.25,"low":7604.5,"close":7605.75,"volume":619}
#     ]
#   }
#
# This file intentionally does ONLY historical OHLCV right now.
# No quote fallback. No recent timeseries fallback. No session fallback.


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

INSIGHTSENTRY_HISTORY_TIMEOUT_SECONDS = float(os.getenv("INSIGHTSENTRY_HISTORY_TIMEOUT_SECONDS", "20"))
INSIGHTSENTRY_HISTORY_CACHE_SECONDS = float(os.getenv("INSIGHTSENTRY_HISTORY_CACHE_SECONDS", "60"))

# In-memory cache so chart reloads/timeframe refreshes do not hammer RapidAPI.
_HISTORY_CACHE: Dict[str, Dict[str, Any]] = {}


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


def to_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(float(value))
    except Exception:
        return fallback


def to_epoch_seconds(value: Any, fallback: int = 0) -> int:
    """Normalize provider candle time to Unix epoch seconds.

    InsightSentry may return numeric epoch seconds, millisecond epochs, or ISO
    datetime strings like 2026-06-01T00:00:00+00:00. The clean candle
    service stores ISO strings for chart compatibility, but every internal sort
    and cache key should use the numeric epoch field.
    """
    if value is None:
        return fallback

    if isinstance(value, (int, float)):
        numeric = float(value)
        if numeric <= 0:
            return fallback
        if numeric > 10_000_000_000:
            numeric = numeric / 1000.0
        return int(numeric)

    text = str(value or "").strip()
    if not text:
        return fallback

    try:
        numeric = float(text)
        if numeric <= 0:
            return fallback
        if numeric > 10_000_000_000:
            numeric = numeric / 1000.0
        return int(numeric)
    except Exception:
        pass

    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp())
    except Exception:
        return fallback


def normalize_symbol(value: Any = "MES1!") -> str:
    raw = str(value or "MES1!").strip().upper()
    raw = (
        raw.replace("CME_MINI:", "")
        .replace("CME:", "")
        .replace("NASDAQ:", "")
        .replace("NYSE:", "")
        .replace("AMEX:", "")
        .replace("BINANCE:", "")
        .replace("COINBASE:", "")
    )

    if raw in {"MES", "MES1", "MES1!"} or "MES" in raw:
        return "MES1!"
    if raw in {"ES", "ES1", "ES1!"} or raw.startswith("ES"):
        return "ES1!"
    if raw in {"NQ", "NQ1", "NQ1!"} or raw.startswith("NQ"):
        return "NQ1!"
    if "BTC" in raw:
        return "BTCUSD"
    if "ETH" in raw:
        return "ETHUSD"
    if raw == "SPY":
        return "SPY"
    if raw == "QQQ":
        return "QQQ"

    return raw or "MES1!"


def provider_symbol(symbol: Any = "MES1!") -> str:
    normalized = normalize_symbol(symbol)

    if normalized == "MES1!":
        return "CME_MINI:MES1!"
    if normalized == "ES1!":
        return "CME_MINI:ES1!"
    if normalized == "NQ1!":
        return "CME_MINI:NQ1!"
    if normalized == "SPY":
        return "AMEX:SPY"
    if normalized == "QQQ":
        return "NASDAQ:QQQ"
    if normalized == "BTCUSD":
        return "BINANCE:BTCUSDT"
    if normalized == "ETHUSD":
        return "BINANCE:ETHUSDT"

    # If user already passes exchange-prefixed code, use it.
    text = str(symbol or "").strip().upper()
    if ":" in text:
        return text

    return normalized


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


def timeframe_to_history_params(timeframe: Any = "1m") -> tuple[str, int]:
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


def bool_param(value: Any, default: bool = False) -> str:
    if value is None:
        value = default

    if isinstance(value, bool):
        return "true" if value else "false"

    return "true" if str(value).strip().lower() in {"1", "true", "yes", "y", "on"} else "false"


def current_start_ym(months_back: int = 1) -> str:
    """Default to current UTC month. User can pass start_ym explicitly."""
    dt = datetime.now(timezone.utc)
    return f"{dt.year:04d}-{dt.month:02d}"


def rapidapi_headers() -> Dict[str, str]:
    if not INSIGHTSENTRY_API_KEY:
        raise HTTPException(status_code=500, detail="INSIGHTSENTRY_API_KEY is missing")

    return {
        "x-rapidapi-key": INSIGHTSENTRY_API_KEY,
        "x-rapidapi-host": INSIGHTSENTRY_HOST,
        "accept": "application/json",
        "content-type": "application/json",
    }


def request_json(path: str, params: Dict[str, Any]) -> Any:
    url = f"{INSIGHTSENTRY_BASE_URL}{path}?{urlencode(params)}"
    request = Request(url, headers=rapidapi_headers(), method="GET")

    try:
        with urlopen(request, timeout=INSIGHTSENTRY_HISTORY_TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except HTTPError as error:
        raise HTTPException(status_code=error.code, detail=f"InsightSentry historical OHLCV error: {error.reason}") from error
    except URLError as error:
        raise HTTPException(status_code=502, detail=f"InsightSentry historical OHLCV URL error: {error.reason}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"InsightSentry historical OHLCV request failed: {error}") from error


def normalize_history_candle(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    timestamp = to_epoch_seconds(raw.get("time") or raw.get("timestamp") or raw.get("t"), 0)
    open_price = to_float(raw.get("open") or raw.get("o"), 0.0)
    high_price = to_float(raw.get("high") or raw.get("h"), 0.0)
    low_price = to_float(raw.get("low") or raw.get("l"), 0.0)
    close_price = to_float(raw.get("close") or raw.get("c"), 0.0)
    volume = to_float(raw.get("volume") or raw.get("v"), 0.0)

    if timestamp <= 0 or close_price <= 0:
        return None

    if open_price <= 0:
        open_price = close_price
    if high_price <= 0:
        high_price = max(open_price, close_price)
    if low_price <= 0:
        low_price = min(open_price, close_price)

    high_price = max(high_price, open_price, close_price)
    low_price = min(low_price, open_price, close_price)

    iso_time = datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()

    return {
        "time": iso_time,
        "timestamp": iso_time,
        "epoch": timestamp,
        "t": timestamp,
        "open": round(open_price, 8),
        "high": round(high_price, 8),
        "low": round(low_price, 8),
        "close": round(close_price, 8),
        "o": round(open_price, 8),
        "h": round(high_price, 8),
        "l": round(low_price, 8),
        "c": round(close_price, 8),
        "volume": round(volume, 8),
        "v": round(volume, 8),
    }


def normalize_history_response(
    payload: Any,
    *,
    symbol: str,
    provider_code: str,
    timeframe: str,
    limit: int,
) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="InsightSentry historical OHLCV returned non-object response")

    raw_series = payload.get("series")
    if not isinstance(raw_series, list):
        raise HTTPException(status_code=502, detail="InsightSentry historical OHLCV response missing series array")

    candles: List[Dict[str, Any]] = []

    for item in raw_series:
        candle = normalize_history_candle(item)
        if candle:
            candles.append(candle)

    candles.sort(key=lambda item: to_epoch_seconds(item.get("epoch") or item.get("time") or item.get("timestamp"), 0))

    if limit and limit > 0:
        candles = candles[-int(limit):]

    return {
        "eventType": "INSIGHTSENTRY_HISTORICAL_OHLCV",
        "status": "OK",
        "symbol": normalize_symbol(symbol),
        "providerCode": provider_code,
        "timeframe": normalize_timeframe(timeframe),
        "barType": payload.get("bar_type"),
        "count": len(candles),
        "candles": candles,
        "series": candles,
        "source": "insightsentry_v3_historical_ohlcv",
        "createdAt": now_iso(),
        "rawMeta": {
            "code": payload.get("code"),
            "_ct": payload.get("_ct"),
            "bar_type": payload.get("bar_type"),
        },
    }


def cache_key(
    *,
    symbol: str,
    timeframe: str,
    start_ym: str,
    limit: int,
    extended: Any,
    badj: Any,
    dadj: Any,
) -> str:
    return json.dumps(
        {
            "symbol": normalize_symbol(symbol),
            "providerCode": provider_symbol(symbol),
            "timeframe": normalize_timeframe(timeframe),
            "start_ym": start_ym,
            "limit": int(limit),
            "extended": bool_param(extended, True),
            "badj": bool_param(badj, True),
            "dadj": bool_param(dadj, False),
        },
        sort_keys=True,
    )


def get_historical_ohlcv(
    symbol: str = "MES1!",
    timeframe: str = "1m",
    start_ym: Optional[str] = None,
    limit: int = 0,
    extended: bool = True,
    badj: bool = True,
    dadj: bool = False,
    force: bool = False,
) -> Dict[str, Any]:
    """Fetch confirmed InsightSentry Historical Time Series OHLCV.

    Use this as the initial chart candle loader. WebSocket handles live candle
    updates after initial load.
    """
    normalized_symbol = normalize_symbol(symbol)
    code = provider_symbol(symbol)
    tf = normalize_timeframe(timeframe)
    bar_type, bar_interval = timeframe_to_history_params(tf)
    start_ym_value = str(start_ym or current_start_ym()).strip()

    # Dashboard rule: limit=0 means do not artificially cap MES/provider history.
    # Positive limit still slices the returned series when explicitly requested.
    try:
        requested_limit = int(limit or 0)
    except Exception:
        requested_limit = 0
    safe_limit = max(0, min(requested_limit, 100000))
    key = cache_key(
        symbol=normalized_symbol,
        timeframe=tf,
        start_ym=start_ym_value,
        limit=safe_limit,
        extended=extended,
        badj=badj,
        dadj=dadj,
    )

    cached = _HISTORY_CACHE.get(key)
    if (
        not force
        and cached
        and time.time() - float(cached.get("cachedAtEpoch", 0.0)) <= INSIGHTSENTRY_HISTORY_CACHE_SECONDS
    ):
        response = dict(cached.get("response") or {})
        response["cache"] = "HIT"
        response["createdAt"] = now_iso()
        return response

    path = f"/v3/symbols/{quote(code, safe='')}/history"
    params = {
        "bar_type": bar_type,
        "bar_interval": bar_interval,
        "extended": bool_param(extended, True),
        "badj": bool_param(badj, True),
        "dadj": bool_param(dadj, False),
        "start_ym": start_ym_value,
    }

    payload = request_json(path, params)
    response = normalize_history_response(
        payload,
        symbol=normalized_symbol,
        provider_code=code,
        timeframe=tf,
        limit=safe_limit,
    )

    response["request"] = {
        "path": path,
        "params": params,
        "urlPath": f"{path}?{urlencode(params)}",
    }
    response["cache"] = "MISS"

    _HISTORY_CACHE[key] = {
        "cachedAtEpoch": time.time(),
        "response": response,
    }

    return response


def historical_ohlcv_status() -> Dict[str, Any]:
    return {
        "eventType": "INSIGHTSENTRY_HISTORICAL_OHLCV_STATUS",
        "status": "OK",
        "baseUrl": INSIGHTSENTRY_BASE_URL,
        "host": INSIGHTSENTRY_HOST,
        "hasApiKey": bool(INSIGHTSENTRY_API_KEY),
        "cacheSize": len(_HISTORY_CACHE),
        "cacheSeconds": INSIGHTSENTRY_HISTORY_CACHE_SECONDS,
        "createdAt": now_iso(),
        "source": "insightsentry_v3_historical_ohlcv",
    }
