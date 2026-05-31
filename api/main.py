from __future__ import annotations

import csv
import io
import json
import os
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException, Request as FastAPIRequest
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field



# ─────────────────────────────────────────────────────────────────────────────
# APP SETUP
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="Trading Intelligence Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────────────────────────────────
# ENVIRONMENT
# ─────────────────────────────────────────────────────────────────────────────

ALPACA_API_KEY = os.getenv("ALPACA_API_KEY", "")
ALPACA_SECRET_KEY = os.getenv("ALPACA_SECRET_KEY", "")
DASHBOARD_SECRET = os.getenv("DASHBOARD_SECRET", os.getenv("WEBHOOK_SECRET", "my_trading_secret_123"))

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
INSIGHTSENTRY_BASE_URL = f"https://{INSIGHTSENTRY_HOST}"

ALPACA_STOCKS_BASE_URL = "https://data.alpaca.markets/v2"
ALPACA_CRYPTO_BASE_URL = "https://data.alpaca.markets/v1beta3"


# ─────────────────────────────────────────────────────────────────────────────
# IN-MEMORY STATE
# ─────────────────────────────────────────────────────────────────────────────

LATEST_SIGNAL: Dict[str, Any] = {}
RECENT_SIGNALS: List[Dict[str, Any]] = []
RECENT_CANDLES: List[Dict[str, Any]] = []

MAX_RECENT_SIGNALS = 50
MAX_RECENT_CANDLES = 5000


# ─────────────────────────────────────────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────────────────────────────────────────

class TradingViewPayload(BaseModel):
    secret: Optional[str] = None
    eventType: Optional[str] = None
    status: Optional[str] = None

    symbol: Optional[str] = None
    timeframe: Optional[str] = None
    signal: Optional[str] = None
    confidence: Optional[float] = None
    bullScore: Optional[float] = None
    bearScore: Optional[float] = None
    netBias: Optional[float] = None
    price: Optional[float] = None

    time: Optional[Any] = None
    timestamp: Optional[Any] = None
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    close: Optional[float] = None
    volume: Optional[float] = None

    entry: Optional[float] = None
    current: Optional[float] = None
    pnl: Optional[float] = None
    percent: Optional[float] = None

    smc: Optional[str] = None
    alphax: Optional[str] = None
    ghost: Optional[str] = None
    chartOverlays: Optional[Any] = None

    openInterest: Optional[str] = None
    footprint: Optional[str] = None
    session: Optional[str] = None
    fredMacro: Optional[str] = None
    finraShortVolume: Optional[str] = None
    cot: Optional[str] = None
    warnings: Optional[List[str]] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# BASIC HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None:
            return fallback
        parsed = float(value)
        if parsed != parsed:
            return fallback
        return parsed
    except Exception:
        return fallback


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def normalize_symbol(symbol: str) -> str:
    raw = str(symbol or "").upper().strip()

    for prefix in [
        "BINANCE:",
        "COINBASE:",
        "CRYPTO:",
        "CME_MINI:",
        "CME:",
        "AMEX:",
        "NASDAQ:",
        "NYSE:",
    ]:
        raw = raw.replace(prefix, "")

    raw = raw.replace("-", "").replace("_", "")

    if raw in {"BTCUSD", "BTC/USD", "XBTUSD", "BTCUSDT"}:
        return "BTCUSD"
    if raw in {"ETHUSD", "ETH/USD", "ETHUSDT"}:
        return "ETHUSD"
    if raw in {"SPY", "SPY.US"}:
        return "SPY"
    if raw in {"ES", "ES1", "ES1!", "/ES", "ES=F"}:
        return "ES1!"
    if raw in {"MES", "MES1", "MES1!", "/MES", "MES=F"}:
        return "MES1!"

    return raw


def normalize_timeframe(timeframe: str) -> str:
    tf = str(timeframe or "1m").strip().lower()
    mapping = {
        "1": "1m", "1m": "1m", "1min": "1m", "1minute": "1m",
        "3": "3m", "3m": "3m", "3min": "3m", "3minute": "3m",
        "5": "5m", "5m": "5m", "5min": "5m", "5minute": "5m",
        "10": "10m", "10m": "10m", "10min": "10m", "10minute": "10m",
        "15": "15m", "15m": "15m", "15min": "15m", "15minute": "15m",
        "30": "30m", "30m": "30m", "30min": "30m", "30minute": "30m",
        "60": "1h", "1h": "1h", "60m": "1h", "60min": "1h",
        "120": "2h", "2h": "2h", "120m": "2h",
        "240": "4h", "4h": "4h", "240m": "4h",
        "d": "1d", "1d": "1d", "day": "1d", "1day": "1d",
        "w": "1w", "1w": "1w", "week": "1w", "1week": "1w",
    }
    return mapping.get(tf, tf)


def timeframe_seconds(timeframe: str) -> int:
    tf = normalize_timeframe(timeframe)
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
        "1w": 604800,
    }
    return mapping.get(tf, 60)


def alpaca_timeframe(timeframe: str) -> str:
    mapping = {
        "1m": "1Min",
        "3m": "3Min",
        "5m": "5Min",
        "10m": "10Min",
        "15m": "15Min",
        "30m": "30Min",
        "1h": "1Hour",
        "2h": "2Hour",
        "4h": "4Hour",
        "1d": "1Day",
        "1w": "1Week",
    }
    return mapping.get(normalize_timeframe(timeframe), "1Min")




def is_crypto_symbol(symbol: str) -> bool:
    return normalize_symbol(symbol) in {"BTCUSD", "ETHUSD"}


def is_futures_symbol(symbol: str) -> bool:
    return normalize_symbol(symbol) in {"ES1!", "MES1!"}


def is_stock_symbol(symbol: str) -> bool:
    return normalize_symbol(symbol) == "SPY"


def valid_price_range_for_symbol(symbol: str) -> tuple[float, float]:
    normalized = normalize_symbol(symbol)
    if normalized == "BTCUSD":
        return 10000.0, 300000.0
    if normalized == "ETHUSD":
        return 100.0, 30000.0
    if normalized == "SPY":
        return 50.0, 2000.0
    if normalized in {"ES1!", "MES1!"}:
        return 1000.0, 20000.0
    return 0.000001, 1_000_000_000.0


def is_price_valid_for_symbol(value: Any, symbol: str) -> bool:
    price = to_float(value, 0.0)
    low, high = valid_price_range_for_symbol(symbol)
    return low <= price <= high


def is_candle_valid_for_symbol(candle: Dict[str, Any], symbol: str) -> bool:
    if not isinstance(candle, dict):
        return False

    normalized = normalize_symbol(symbol)
    candle_symbol = normalize_symbol(str(candle.get("symbol") or normalized))

    if candle_symbol and candle_symbol != normalized:
        return False

    o = to_float(candle.get("open"))
    h = to_float(candle.get("high"))
    l = to_float(candle.get("low"))
    c = to_float(candle.get("close"))

    if h < l:
        return False
    if max(o, c) > h + 1e-9:
        return False
    if min(o, c) < l - 1e-9:
        return False

    return (
        is_price_valid_for_symbol(o, normalized)
        and is_price_valid_for_symbol(h, normalized)
        and is_price_valid_for_symbol(l, normalized)
        and is_price_valid_for_symbol(c, normalized)
    )


def filter_valid_candles_for_symbol(candles: List[Dict[str, Any]], symbol: str) -> List[Dict[str, Any]]:
    normalized = normalize_symbol(symbol)
    return [candle for candle in candles if is_candle_valid_for_symbol(candle, normalized)]


def to_alpaca_crypto_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)
    if normalized == "BTCUSD":
        return "BTC/USD"
    if normalized == "ETHUSD":
        return "ETH/USD"
    return normalized



def to_epoch_seconds(value: Any) -> float:
    if value is None:
        return 0.0

    if isinstance(value, (int, float)):
        numeric = float(value)
        return numeric / 1000.0 if numeric > 1000000000000 else numeric

    text = str(value).strip()
    if not text:
        return 0.0

    try:
        numeric = float(text)
        return numeric / 1000.0 if numeric > 1000000000000 else numeric
    except Exception:
        pass

    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except Exception:
        return 0.0


def format_bar_time(value: Any) -> Any:
    if value is None:
        return datetime.now(timezone.utc).isoformat()

    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()

    if isinstance(value, str) and ("T" in value or "-" in value):
        return value

    try:
        numeric = float(value)
        if numeric > 1000000000000:
            numeric = numeric / 1000.0
        return datetime.fromtimestamp(numeric, tz=timezone.utc).isoformat()
    except Exception:
        return str(value)


def sanitize_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(payload)
    normalized["symbol"] = normalize_symbol(str(normalized.get("symbol") or ""))
    normalized["timeframe"] = normalize_timeframe(str(normalized.get("timeframe") or "1m"))
    normalized["signal"] = str(normalized.get("signal") or "NEUTRAL")
    normalized["confidence"] = to_float(normalized.get("confidence"), 0)
    normalized["bullScore"] = to_float(normalized.get("bullScore"), 50)
    normalized["bearScore"] = to_float(normalized.get("bearScore"), 50)
    normalized["netBias"] = to_float(normalized.get("netBias"), normalized["bullScore"] - normalized["bearScore"])
    normalized["price"] = to_float(normalized.get("price"), to_float(normalized.get("close"), 0))
    normalized["createdAt"] = normalized.get("createdAt") or now_iso()

    if "chartOverlays" not in normalized:
        normalized["chartOverlays"] = None
    if not isinstance(normalized.get("warnings"), list):
        normalized["warnings"] = []

    return normalized


def candle_from_payload(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not all(payload.get(key) is not None for key in ["open", "high", "low", "close"]):
        return None

    symbol = normalize_symbol(str(payload.get("symbol") or ""))
    timeframe = normalize_timeframe(str(payload.get("timeframe") or "1m"))
    candle_time = payload.get("time") or payload.get("timestamp") or payload.get("createdAt") or now_iso()
    normalized_time = format_bar_time(candle_time)

    candle = {
        "time": normalized_time,
        "timestamp": normalized_time,
        "epoch": to_epoch_seconds(normalized_time),
        "open": to_float(payload.get("open")),
        "high": to_float(payload.get("high")),
        "low": to_float(payload.get("low")),
        "close": to_float(payload.get("close")),
        "volume": to_float(payload.get("volume")),
        "symbol": symbol,
        "timeframe": timeframe,
        "createdAt": payload.get("createdAt") or now_iso(),
        "provider": "tradingview_webhook",
    }

    if not is_candle_valid_for_symbol(candle, symbol):
        return None

    return candle


def merge_candles_by_time(candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: Dict[str, Dict[str, Any]] = {}

    for candle in candles:
        if not isinstance(candle, dict):
            continue

        symbol = normalize_symbol(str(candle.get("symbol", "")))
        timeframe = normalize_timeframe(str(candle.get("timeframe", "")))
        epoch = to_epoch_seconds(candle.get("epoch") or candle.get("time") or candle.get("timestamp") or candle.get("createdAt"))

        if epoch <= 0:
            continue

        key = f"{symbol}:{timeframe}:{int(epoch)}"
        next_candle = dict(candle)
        next_candle["symbol"] = symbol
        next_candle["timeframe"] = timeframe
        next_candle["epoch"] = epoch
        next_candle["time"] = format_bar_time(epoch)
        next_candle["timestamp"] = next_candle["time"]
        merged[key] = next_candle

    return sorted(merged.values(), key=lambda item: to_epoch_seconds(item.get("epoch") or item.get("time")))



# ─────────────────────────────────────────────────────────────────────────────
# HTTP / DATA PROVIDER HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def alpaca_headers() -> Dict[str, str]:
    if not ALPACA_API_KEY or not ALPACA_SECRET_KEY:
        raise HTTPException(status_code=500, detail="Missing ALPACA_API_KEY and/or ALPACA_SECRET_KEY")
    return {
        "APCA-API-KEY-ID": ALPACA_API_KEY,
        "APCA-API-SECRET-KEY": ALPACA_SECRET_KEY,
    }


def insightsentry_headers() -> Dict[str, str]:
    if not INSIGHTSENTRY_API_KEY:
        raise HTTPException(status_code=500, detail="Missing INSIGHTSENTRY_API_KEY, INSIGHTSENTRY_RAPIDAPI_KEY, or RAPIDAPI_KEY")
    return {
        "Content-Type": "application/json",
        "x-rapidapi-host": INSIGHTSENTRY_HOST,
        "x-rapidapi-key": INSIGHTSENTRY_API_KEY,
    }


def http_get_json(url: str, headers: Optional[Dict[str, str]] = None, provider: str = "Data provider") -> Any:
    request = Request(url, headers=headers or {})
    try:
        with urlopen(request, timeout=25) as response:
            body = response.read().decode("utf-8")
            return json.loads(body)
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=error.code, detail=f"{provider} request failed: {body or error.reason}")
    except URLError as error:
        raise HTTPException(status_code=502, detail=f"{provider} connection failed: {error.reason}")
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"{provider} request failed: {str(error)}")


def http_get_json_or_none(url: str, headers: Optional[Dict[str, str]] = None, provider: str = "Data provider") -> Any:
    try:
        return http_get_json(url, headers=headers, provider=provider)
    except Exception as error:
        print(f"[{provider}] failed: {error}")
        return None


def normalize_alpaca_bar(raw: Dict[str, Any], symbol: str, timeframe: str) -> Dict[str, Any]:
    raw_time = raw.get("t") or raw.get("timestamp") or raw.get("time")
    formatted_time = format_bar_time(raw_time)
    return {
        "time": formatted_time,
        "timestamp": formatted_time,
        "epoch": to_epoch_seconds(formatted_time),
        "open": to_float(raw.get("o", raw.get("open"))),
        "high": to_float(raw.get("h", raw.get("high"))),
        "low": to_float(raw.get("l", raw.get("low"))),
        "close": to_float(raw.get("c", raw.get("close"))),
        "volume": to_float(raw.get("v", raw.get("volume"))),
        "symbol": normalize_symbol(symbol),
        "timeframe": normalize_timeframe(timeframe),
        "createdAt": now_iso(),
        "provider": "alpaca",
    }



# ─────────────────────────────────────────────────────────────────────────────
# INSIGHTSENTRY HELPERS
# ─────────────────────────────────────────────────────────────────────────────

INSIGHTSENTRY_SYMBOL_MAP = {
    "MES": "CME_MINI:MES1!",
    "MES1": "CME_MINI:MES1!",
    "MES1!": "CME_MINI:MES1!",
    "/MES": "CME_MINI:MES1!",
    "ES": "CME_MINI:ES1!",
    "ES1": "CME_MINI:ES1!",
    "ES1!": "CME_MINI:ES1!",
    "/ES": "CME_MINI:ES1!",
    "SPY": "SPY",
    "BTCUSD": "BTCUSD",
    "ETHUSD": "ETHUSD",
}


def to_insightsentry_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)
    return INSIGHTSENTRY_SYMBOL_MAP.get(normalized, normalized)


def insightsentry_interval_candidates(timeframe: str) -> List[str]:
    tf = normalize_timeframe(timeframe)
    allowed = {"1m", "5m", "10m", "15m", "30m"}
    return [tf] if tf in allowed else ["1m"]


def insightsentry_bar_type_interval(timeframe: str) -> Tuple[str, int]:
    tf = normalize_timeframe(timeframe)
    mapping = {
        "1m": ("minute", 1),
        "5m": ("minute", 5),
        "10m": ("minute", 10),
        "15m": ("minute", 15),
        "30m": ("minute", 30),
    }
    return mapping.get(tf, ("minute", 1))


def candles_match_requested_timeframe(candles: List[Dict[str, Any]], timeframe: str) -> bool:
    if len(candles) < 3:
        return True

    expected = timeframe_seconds(timeframe)
    if expected <= 0:
        return True

    epochs = sorted(
        int(to_epoch_seconds(c.get("epoch") or c.get("time") or c.get("timestamp")))
        for c in candles
        if to_epoch_seconds(c.get("epoch") or c.get("time") or c.get("timestamp")) > 0
    )

    if len(epochs) < 3:
        return True

    diffs = [epochs[i] - epochs[i - 1] for i in range(1, len(epochs)) if epochs[i] > epochs[i - 1]]
    if not diffs:
        return False

    max_normal_gap = max(expected * 6, 3600)
    normal_diffs = [d for d in diffs if 0 < d <= max_normal_gap]

    if not normal_diffs:
        return False

    normal_diffs = sorted(normal_diffs)
    median_gap = normal_diffs[len(normal_diffs) // 2]

    return expected * 0.5 <= median_gap <= expected * 2.5


def extract_insightsentry_bars(payload: Any) -> List[Any]:
    if isinstance(payload, list):
        return payload

    if not isinstance(payload, dict):
        return []

    direct_keys = [
        "candles",
        "bars",
        "data",
        "items",
        "results",
        "values",
        "series",
        "time_series",
        "ohlcv",
        "historical",
    ]

    for key in direct_keys:
        value = payload.get(key)
        if isinstance(value, list):
            return value

    for parent_key in ["result", "payload", "response"]:
        nested = payload.get(parent_key)
        if isinstance(nested, list):
            return nested
        if isinstance(nested, dict):
            for key in direct_keys:
                value = nested.get(key)
                if isinstance(value, list):
                    return value

    data = payload.get("data")
    if isinstance(data, dict):
        for value in data.values():
            if isinstance(value, list):
                return value

    return []


def normalize_insightsentry_bar(raw: Any, symbol: str, timeframe: str) -> Optional[Dict[str, Any]]:
    if isinstance(raw, list):
        if len(raw) < 4:
            return None

        first_is_time = isinstance(raw[0], str) or to_epoch_seconds(raw[0]) > 100000
        if first_is_time:
            raw_time = raw[0]
            open_value = raw[1] if len(raw) > 1 else None
            high_value = raw[2] if len(raw) > 2 else None
            low_value = raw[3] if len(raw) > 3 else None
            close_value = raw[4] if len(raw) > 4 else None
            volume_value = raw[5] if len(raw) > 5 else 0
        else:
            raw_time = raw[5] if len(raw) > 5 else None
            open_value = raw[0]
            high_value = raw[1] if len(raw) > 1 else None
            low_value = raw[2] if len(raw) > 2 else None
            close_value = raw[3] if len(raw) > 3 else None
            volume_value = raw[4] if len(raw) > 4 else 0
    elif isinstance(raw, dict):
        raw_time = (
            raw.get("time")
            or raw.get("timestamp")
            or raw.get("datetime")
            or raw.get("date")
            or raw.get("t")
            or raw.get("T")
        )
        open_value = raw.get("open", raw.get("o", raw.get("Open", raw.get("OPEN"))))
        high_value = raw.get("high", raw.get("h", raw.get("High", raw.get("HIGH"))))
        low_value = raw.get("low", raw.get("l", raw.get("Low", raw.get("LOW"))))
        close_value = raw.get("close", raw.get("c", raw.get("Close", raw.get("CLOSE", raw.get("price", raw.get("last"))))))
        volume_value = raw.get("volume", raw.get("v", raw.get("Volume", 0)))
    else:
        return None

    if open_value is None or high_value is None or low_value is None or close_value is None:
        return None

    formatted_time = format_bar_time(raw_time)
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    candle = {
        "time": formatted_time,
        "timestamp": formatted_time,
        "epoch": to_epoch_seconds(formatted_time),
        "open": to_float(open_value),
        "high": to_float(high_value),
        "low": to_float(low_value),
        "close": to_float(close_value),
        "volume": to_float(volume_value),
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "createdAt": now_iso(),
        "provider": "insightsentry",
    }

    if candle["open"] <= 0 or candle["high"] <= 0 or candle["low"] <= 0 or candle["close"] <= 0:
        return None

    if not is_candle_valid_for_symbol(candle, normalized_symbol):
        return None

    return candle


def build_insightsentry_urls(api_symbol: str, api_interval: str, limit: int) -> List[str]:
    encoded_path_symbol = quote(api_symbol, safe="")
    bar_type, bar_interval = insightsentry_bar_type_interval(api_interval)
    safe_limit = max(1, min(int(limit or 500), 5000))

    series_params = {
        "bar_type": bar_type,
        "bar_interval": bar_interval,
        "extended": "true",
        "badj": "true",
        "dadj": "false",
        "dp": safe_limit,
        "long_poll": "false",
    }

    return [
        f"{INSIGHTSENTRY_BASE_URL}/v3/symbols/{encoded_path_symbol}/series?{urlencode(series_params)}",
    ]


def fetch_insightsentry_direct_candles(symbol: str, timeframe: str = "1m", limit: int = 500) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    api_symbol = to_insightsentry_symbol(normalized_symbol)
    safe_limit = max(1, min(int(limit or 500), 5000))
    headers = insightsentry_headers()

    last_error: Optional[str] = None

    for api_interval in insightsentry_interval_candidates(normalized_timeframe):
        for url in build_insightsentry_urls(api_symbol, api_interval, safe_limit):
            data = http_get_json_or_none(url, headers=headers, provider="InsightSentry")
            if data is None:
                continue

            bars = extract_insightsentry_bars(data)
            candles = [
                candle
                for candle in (normalize_insightsentry_bar(bar, normalized_symbol, normalized_timeframe) for bar in bars)
                if candle is not None
            ]

            candles = filter_valid_candles_for_symbol(merge_candles_by_time(candles), normalized_symbol)

            if candles:
                if not candles_match_requested_timeframe(candles, normalized_timeframe):
                    last_error = (
                        f"Rejected wrong spacing from {url}; "
                        f"requested={normalized_timeframe}; count={len(candles)}"
                    )
                    print(f"[InsightSentry] {last_error}")
                    continue

                print(
                    f"[InsightSentry] frontend_symbol={symbol} normalized={normalized_symbol} "
                    f"api_symbol={api_symbol} timeframe={normalized_timeframe} api_interval={api_interval} "
                    f"count={len(candles)}"
                )
                return candles[-safe_limit:]

            last_error = f"No bars parsed from {url}"

    if last_error:
        print(f"[InsightSentry] {last_error}")

    return []


def fetch_insightsentry_historical_candles(symbol: str, timeframe: str = "1m", limit: int = 500) -> List[Dict[str, Any]]:
    """
    MES/ES futures candles use the verified InsightSentry Time Series OHLCV route.

    Removed old fallback behavior:
    - No interval=5min style requests.
    - No fake relabeling.
    - No resampling fallback unless the provider returns valid direct candles.
    """
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))

    direct = fetch_insightsentry_direct_candles(normalized_symbol, normalized_timeframe, safe_limit)
    return direct[-safe_limit:] if direct else []

# ─────────────────────────────────────────────────────────────────────────────
# CANDLE PROVIDERS
# ─────────────────────────────────────────────────────────────────────────────

def alpaca_start_time_for_limit(timeframe: str, limit: int) -> str:
    """
    Use a wide UTC lookback window so Alpaca has enough history to return the
    requested candle count. The request itself must still be sorted descending
    and end at now, otherwise Alpaca returns the first candles after start.
    """
    tf = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))
    seconds = timeframe_seconds(tf)

    required_seconds = safe_limit * max(seconds, 60)
    buffer_seconds = max(required_seconds * 3, 2 * 24 * 60 * 60)

    minimum_by_tf = {
        "1m": 2,
        "3m": 4,
        "5m": 7,
        "10m": 14,
        "15m": 21,
        "30m": 35,
        "1h": 90,
        "2h": 120,
        "4h": 180,
        "1d": 900,
        "1w": 2500,
    }
    min_days = minimum_by_tf.get(tf, 14)
    lookback_seconds = max(buffer_seconds, min_days * 24 * 60 * 60)

    start = datetime.now(timezone.utc) - timedelta(seconds=lookback_seconds)
    return start.isoformat().replace("+00:00", "Z")


def alpaca_end_time_now() -> str:
    # Pin provider requests to the current UTC time so historical candles end at latest available bar.
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def candles_are_fresh(candles: List[Dict[str, Any]], timeframe: str, max_extra_seconds: int = 600) -> bool:
    if not candles:
        return False
    latest_epoch = max(to_epoch_seconds(c.get("epoch") or c.get("time") or c.get("timestamp")) for c in candles)
    if latest_epoch <= 0:
        return False
    allowed_age = max(timeframe_seconds(timeframe) * 3, max_extra_seconds)
    return (datetime.now(timezone.utc).timestamp() - latest_epoch) <= allowed_age


def fetch_alpaca_historical_candles(symbol: str, timeframe: str = "1m", limit: int = 500) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    alpaca_tf = alpaca_timeframe(normalized_timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))
    headers = alpaca_headers()
    start_time = alpaca_start_time_for_limit(normalized_timeframe, safe_limit)

    if is_crypto_symbol(normalized_symbol):
        slash_symbol = to_alpaca_crypto_symbol(normalized_symbol)
        candidates = [slash_symbol, normalized_symbol]

        for candidate in candidates:
            params = urlencode({
                "symbols": candidate,
                "timeframe": alpaca_tf,
                "limit": safe_limit,
                "start": start_time,
                "end": alpaca_end_time_now(),
                # Critical: desc returns the newest candles first. merge_candles_by_time()
                # sorts them back ascending before returning to the dashboard.
                "sort": "desc",
            })
            url = f"{ALPACA_CRYPTO_BASE_URL}/crypto/us/bars?{params}"
            data = http_get_json(url, headers=headers, provider="Alpaca crypto")
            bars_by_symbol = data.get("bars", {}) if isinstance(data, dict) else {}
            bars = (
                bars_by_symbol.get(candidate)
                or bars_by_symbol.get(slash_symbol)
                or bars_by_symbol.get(normalized_symbol)
                or []
            )

            if bars:
                normalized = [normalize_alpaca_bar(bar, normalized_symbol, normalized_timeframe) for bar in bars]
                candles = merge_candles_by_time(normalized)[-safe_limit:]
                candles = filter_valid_candles_for_symbol(candles, normalized_symbol)
                if candles:
                    if candles_are_fresh(candles, normalized_timeframe):
                        return candles
                    print(
                        f"[Alpaca crypto] stale latest candle for {normalized_symbol} {normalized_timeframe}: "
                        f"latest={candles[-1].get('time')} count={len(candles)}"
                    )

        return []

    if normalized_symbol == "SPY":
        request_limit = max(safe_limit, 1000)
        params = urlencode({
            "symbols": normalized_symbol,
            "timeframe": alpaca_tf,
            "limit": min(request_limit, 10000),
            "start": start_time,
            "end": alpaca_end_time_now(),
            "adjustment": "raw",
            "feed": "iex",
            "sort": "desc",
        })
        url = f"{ALPACA_STOCKS_BASE_URL}/stocks/bars?{params}"
        data = http_get_json(url, headers=headers, provider="Alpaca stock")
        bars_by_symbol = data.get("bars", {}) if isinstance(data, dict) else {}
        bars = bars_by_symbol.get(normalized_symbol, [])
        normalized = [normalize_alpaca_bar(bar, normalized_symbol, normalized_timeframe) for bar in bars]
        candles = merge_candles_by_time(normalized)[-safe_limit:]
        return filter_valid_candles_for_symbol(candles, normalized_symbol)

    return []


def fetch_historical_candles(symbol: str, timeframe: str = "1m", limit: int = 500) -> List[Dict[str, Any]]:
    """
    Clean provider router.

    Current dashboard symbols:
    - BTCUSD -> Alpaca crypto
    - MES1!  -> InsightSentry Time Series OHLCV

    Removed unnecessary fallback patches that were only masking the old MES endpoint issue.
    """
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))

    if is_futures_symbol(normalized_symbol):
        candles = fetch_insightsentry_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)
        return candles[-safe_limit:]

    if is_crypto_symbol(normalized_symbol):
        try:
            candles = fetch_alpaca_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)
        except Exception as error:
            print(f"[Alpaca crypto] failed for {normalized_symbol} {normalized_timeframe}: {error}")
            candles = []
        return candles[-safe_limit:]

    if normalized_symbol == "SPY":
        try:
            candles = fetch_alpaca_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)
        except Exception as error:
            print(f"[Alpaca stock] failed for {normalized_symbol} {normalized_timeframe}: {error}")
            candles = []
        return candles[-safe_limit:]

    return []

def get_live_recent_candles(symbol: str, timeframe: str) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    candles = [
        candle for candle in RECENT_CANDLES
        if normalize_symbol(str(candle.get("symbol", ""))) == normalized_symbol
        and normalize_timeframe(str(candle.get("timeframe", ""))) == normalized_timeframe
    ]

    return filter_valid_candles_for_symbol(candles, normalized_symbol)


def get_dashboard_candles(symbol: str, timeframe: str = "1m", limit: int = 500) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))

    historical = filter_valid_candles_for_symbol(
        fetch_historical_candles(normalized_symbol, normalized_timeframe, safe_limit),
        normalized_symbol,
    )

    live = filter_valid_candles_for_symbol(
        get_live_recent_candles(normalized_symbol, normalized_timeframe),
        normalized_symbol,
    )

    merged = merge_candles_by_time([*historical, *live])[-safe_limit:]
    return filter_valid_candles_for_symbol(merged, normalized_symbol)


def resample_candles_to_timeframe(candles: List[Dict[str, Any]], timeframe: str, limit: int = 500) -> List[Dict[str, Any]]:
    normalized_timeframe = normalize_timeframe(timeframe)
    seconds = timeframe_seconds(normalized_timeframe)
    if seconds <= 60:
        return candles[-max(1, min(int(limit or 500), 5000)):]

    buckets: Dict[int, Dict[str, Any]] = {}

    for candle in candles:
        epoch = to_epoch_seconds(candle.get("epoch") or candle.get("time") or candle.get("timestamp"))
        if epoch <= 0:
            continue

        bucket_epoch = int(epoch // seconds) * seconds

        existing = buckets.get(bucket_epoch)
        open_value = to_float(candle.get("open"))
        high_value = to_float(candle.get("high"))
        low_value = to_float(candle.get("low"))
        close_value = to_float(candle.get("close"))
        volume_value = to_float(candle.get("volume"))

        if open_value <= 0 or high_value <= 0 or low_value <= 0 or close_value <= 0:
            continue

        if existing is None:
            buckets[bucket_epoch] = {
                "time": format_bar_time(bucket_epoch),
                "timestamp": format_bar_time(bucket_epoch),
                "epoch": bucket_epoch,
                "open": open_value,
                "high": high_value,
                "low": low_value,
                "close": close_value,
                "volume": volume_value,
                "symbol": candle.get("symbol"),
                "timeframe": normalized_timeframe,
                "createdAt": now_iso(),
                "provider": str(candle.get("provider") or "resampled"),
                "source": "python_resampled_1m",
            }
        else:
            existing["high"] = max(to_float(existing.get("high")), high_value)
            existing["low"] = min(to_float(existing.get("low")), low_value)
            existing["close"] = close_value
            existing["volume"] = to_float(existing.get("volume")) + volume_value

    merged = merge_candles_by_time(list(buckets.values()))
    return merged[-max(1, min(int(limit or 500), 5000)):]


def get_sentiment_candles(symbol: str, timeframe: str = "1m", limit: int = 500) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(120, min(int(limit or 500), 5000))

    candles = get_dashboard_candles(normalized_symbol, normalized_timeframe, safe_limit)
    source = "dashboard_candles"

    # If the sentiment route does not get enough candles from the direct timeframe,
    # retry with a wider request. This keeps the 12-indicator meter independent from
    # any temporary chart cache/front-end state.
    if len(candles) < 80:
        wider = get_dashboard_candles(normalized_symbol, normalized_timeframe, max(safe_limit, 1000))
        if len(wider) > len(candles):
            candles = wider
            source = "dashboard_candles_wide_retry"

    # Last fallback: build higher timeframes from working 1m candles.
    # This prevents the technical meter from defaulting to 50% when one provider
    # returns thin higher-timeframe data but the 1m route is working.
    if len(candles) < 80 and normalized_timeframe != "1m":
        one_minute = get_dashboard_candles(normalized_symbol, "1m", max(safe_limit * 8, 1500))
        resampled = resample_candles_to_timeframe(one_minute, normalized_timeframe, safe_limit)
        if len(resampled) > len(candles):
            candles = resampled
            source = "resampled_from_1m"

    candles = filter_valid_candles_for_symbol(merge_candles_by_time(candles), normalized_symbol)[-safe_limit:]

    latest = candles[-1] if candles else {}
    debug = {
        "sentimentCandleSource": source,
        "candlesCount": len(candles),
        "requestedSymbol": normalized_symbol,
        "requestedTimeframe": normalized_timeframe,
        "firstCandleTime": candles[0].get("time") if candles else None,
        "lastCandleTime": latest.get("time") if latest else None,
        "lastClose": to_float(latest.get("close")) if latest else 0,
    }

    return candles, debug




# ─────────────────────────────────────────────────────────────────────────────
# LIVE PRICE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def floor_epoch_to_timeframe(epoch: float, timeframe: str) -> int:
    seconds = max(timeframe_seconds(timeframe), 60)
    return int(epoch // seconds) * seconds


def recursive_find_number(payload: Any, keys: set[str]) -> Optional[float]:
    if isinstance(payload, dict):
        for key, value in payload.items():
            lowered = str(key).lower()
            if lowered in keys:
                parsed = to_float(value, 0.0)
                if parsed > 0:
                    return parsed

        # Common bid/ask midpoint support.
        bid = None
        ask = None
        for key, value in payload.items():
            lowered = str(key).lower()
            if lowered in {"bid", "bidprice", "bp", "bid_price"}:
                candidate = to_float(value, 0.0)
                if candidate > 0:
                    bid = candidate
            if lowered in {"ask", "askprice", "ap", "ask_price"}:
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
            if lowered in {"t", "time", "timestamp", "datetime", "date"} and value:
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


def normalize_live_price_payload(
    symbol: str,
    timeframe: str,
    price: float,
    raw_time: Any = None,
    provider: str = "unknown",
    source: str = "live_price",
    raw: Any = None,
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    normalized_time = format_bar_time(raw_time or now_iso())
    epoch = to_epoch_seconds(normalized_time)
    if epoch <= 0:
        epoch = datetime.now(timezone.utc).timestamp()
        normalized_time = format_bar_time(epoch)

    return {
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "price": round(to_float(price), 8),
        "time": normalized_time,
        "timestamp": normalized_time,
        "epoch": epoch,
        "bucketEpoch": floor_epoch_to_timeframe(epoch, normalized_timeframe),
        "timeframeSeconds": timeframe_seconds(normalized_timeframe),
        "provider": provider,
        "source": source,
        "raw": raw,
        "createdAt": now_iso(),
    }


def fetch_alpaca_crypto_live_price(symbol: str, timeframe: str = "1m") -> Optional[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    if not is_crypto_symbol(normalized_symbol):
        return None

    headers = alpaca_headers()
    slash_symbol = to_alpaca_crypto_symbol(normalized_symbol)

    # Prefer latest trade because it behaves closest to TradingView's moving last price.
    trade_params = urlencode({"symbols": slash_symbol})
    trade_url = f"{ALPACA_CRYPTO_BASE_URL}/crypto/us/latest/trades?{trade_params}"

    try:
        data = http_get_json(trade_url, headers=headers, provider="Alpaca crypto latest trade")
        trades = data.get("trades", {}) if isinstance(data, dict) else {}
        trade = trades.get(slash_symbol) or trades.get(normalized_symbol) or trades
        price = recursive_find_number(trade, {"p", "price", "last", "lastprice", "close"})
        raw_time = recursive_find_time(trade)
        if price and is_price_valid_for_symbol(price, normalized_symbol):
            return normalize_live_price_payload(
                normalized_symbol,
                timeframe,
                price,
                raw_time=raw_time,
                provider="alpaca",
                source="alpaca_latest_trade",
                raw=trade,
            )
    except Exception as error:
        print(f"[Alpaca live trade] failed for {normalized_symbol}: {error}")

    # Fallback to latest quote midpoint.
    quote_params = urlencode({"symbols": slash_symbol})
    quote_url = f"{ALPACA_CRYPTO_BASE_URL}/crypto/us/latest/quotes?{quote_params}"

    try:
        data = http_get_json(quote_url, headers=headers, provider="Alpaca crypto latest quote")
        quotes = data.get("quotes", {}) if isinstance(data, dict) else {}
        quote_payload = quotes.get(slash_symbol) or quotes.get(normalized_symbol) or quotes
        price = recursive_find_number(
            quote_payload,
            {"p", "price", "last", "lastprice", "ap", "ask", "bp", "bid", "close"},
        )
        raw_time = recursive_find_time(quote_payload)
        if price and is_price_valid_for_symbol(price, normalized_symbol):
            return normalize_live_price_payload(
                normalized_symbol,
                timeframe,
                price,
                raw_time=raw_time,
                provider="alpaca",
                source="alpaca_latest_quote",
                raw=quote_payload,
            )
    except Exception as error:
        print(f"[Alpaca live quote] failed for {normalized_symbol}: {error}")

    return None


def build_insightsentry_live_quote_urls(api_symbol: str) -> List[str]:
    encoded_path_symbol = quote(api_symbol, safe="")
    encoded_query_symbol = quote(api_symbol, safe="")
    return [
        f"{INSIGHTSENTRY_BASE_URL}/v3/symbols/{encoded_path_symbol}/quotes/l1",
        f"{INSIGHTSENTRY_BASE_URL}/v3/symbols/{encoded_path_symbol}/quote",
        f"{INSIGHTSENTRY_BASE_URL}/v3/symbols/{encoded_path_symbol}/quotes",
        f"{INSIGHTSENTRY_BASE_URL}/v3/quotes/l1?symbol={encoded_query_symbol}",
    ]


def fetch_insightsentry_live_price(symbol: str, timeframe: str = "1m") -> Optional[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    if not is_futures_symbol(normalized_symbol):
        return None

    headers = insightsentry_headers()
    api_symbol = to_insightsentry_symbol(normalized_symbol)

    for url in build_insightsentry_live_quote_urls(api_symbol):
        try:
            data = http_get_json_or_none(url, headers=headers, provider="InsightSentry live quote")
            if data is None:
                continue

            price = recursive_find_number(
                data,
                {
                    "last",
                    "lastprice",
                    "price",
                    "tradeprice",
                    "close",
                    "settlement",
                    "bid",
                    "ask",
                    "bidprice",
                    "askprice",
                    "bp",
                    "ap",
                },
            )
            raw_time = recursive_find_time(data)

            if price and is_price_valid_for_symbol(price, normalized_symbol):
                return normalize_live_price_payload(
                    normalized_symbol,
                    timeframe,
                    price,
                    raw_time=raw_time,
                    provider="insightsentry",
                    source="insightsentry_live_quote",
                    raw=None,
                )
        except Exception as error:
            print(f"[InsightSentry live quote] failed for {normalized_symbol}: {error}")

    return None


def get_live_price_payload(symbol: str, timeframe: str = "1m") -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    live: Optional[Dict[str, Any]] = None

    if is_crypto_symbol(normalized_symbol):
        live = fetch_alpaca_crypto_live_price(normalized_symbol, normalized_timeframe)
    elif is_futures_symbol(normalized_symbol):
        live = fetch_insightsentry_live_price(normalized_symbol, normalized_timeframe)

    if live is not None:
        return live

    # Last-resort fallback: latest historical close, so charts continue to work if live quote is unavailable.
    candles = fetch_historical_candles(normalized_symbol, normalized_timeframe, 1)
    latest = candles[-1] if candles else None

    if latest:
        return normalize_live_price_payload(
            normalized_symbol,
            normalized_timeframe,
            to_float(latest.get("close")),
            raw_time=latest.get("time") or latest.get("timestamp") or latest.get("epoch"),
            provider=str(latest.get("provider") or "historical"),
            source="historical_latest_close_fallback",
            raw=None,
        )

    return {
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "price": 0,
        "time": now_iso(),
        "timestamp": now_iso(),
        "epoch": datetime.now(timezone.utc).timestamp(),
        "bucketEpoch": floor_epoch_to_timeframe(datetime.now(timezone.utc).timestamp(), normalized_timeframe),
        "timeframeSeconds": timeframe_seconds(normalized_timeframe),
        "provider": None,
        "source": "no_live_price",
        "createdAt": now_iso(),
    }

# ─────────────────────────────────────────────────────────────────────────────
# SIMPLE TECHNICAL / GHOST HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def build_heikin_ashi_candles(candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    ha: List[Dict[str, Any]] = []
    for index, candle in enumerate(candles):
        o = to_float(candle.get("open"))
        h = to_float(candle.get("high"))
        l = to_float(candle.get("low"))
        c = to_float(candle.get("close"))
        ha_close = (o + h + l + c) / 4.0
        ha_open = (o + c) / 2.0 if index == 0 else (ha[-1]["open"] + ha[-1]["close"]) / 2.0
        ha_high = max(h, ha_open, ha_close)
        ha_low = min(l, ha_open, ha_close)
        ha.append({**candle, "open": ha_open, "high": ha_high, "low": ha_low, "close": ha_close})
    return ha


def average_true_range(candles: List[Dict[str, Any]], length: int = 14) -> float:
    if len(candles) < 2:
        return 0.0
    ranges: List[float] = []
    for index in range(max(1, len(candles) - length), len(candles)):
        current = candles[index]
        previous = candles[index - 1]
        high = to_float(current.get("high"))
        low = to_float(current.get("low"))
        prev_close = to_float(previous.get("close"))
        ranges.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
    return sum(ranges) / max(len(ranges), 1)


def candle_momentum(candles: List[Dict[str, Any]], lookback: int = 8) -> float:
    if len(candles) < 2:
        return 0.0
    sample = candles[-lookback:]
    weighted = 0.0
    weights = 0.0
    for index in range(1, len(sample)):
        weight = index
        weighted += (to_float(sample[index].get("close")) - to_float(sample[index - 1].get("close"))) * weight
        weights += weight
    return weighted / max(weights, 1.0)


def build_python_ghost_candles(candles: List[Dict[str, Any]], count: int = 3) -> List[Dict[str, Any]]:
    if len(candles) < 10:
        return []

    ha = build_heikin_ashi_candles(candles)
    atr = average_true_range(candles, 14)
    last = ha[-1]
    last_real = candles[-1]
    if atr <= 0:
        atr = max(to_float(last_real.get("high")) - to_float(last_real.get("low")), to_float(last_real.get("close")) * 0.001, 0.01)

    momentum = candle_momentum(ha, 8)
    bull_score = to_float(LATEST_SIGNAL.get("bullScore"), 50)
    bear_score = to_float(LATEST_SIGNAL.get("bearScore"), 50)
    pressure_bias = clamp((bull_score - bear_score) / 100.0, -0.50, 0.50)

    prev_open = to_float(last.get("open"))
    prev_close = to_float(last.get("close"))
    ghosts: List[Dict[str, Any]] = []

    for index in range(count):
        decay = 0.82 ** index
        ghost_open = (prev_open + prev_close) / 2.0
        raw_delta = momentum * decay + pressure_bias * atr * (0.7 ** index)
        if abs(raw_delta) < atr * 0.08:
            raw_delta = (atr * 0.08) * (1 if raw_delta >= 0 else -1)
        ghost_close = ghost_open + raw_delta
        top = max(ghost_open, ghost_close)
        bottom = min(ghost_open, ghost_close)
        ghost_high = top + atr * (0.25 + index * 0.05)
        ghost_low = bottom - atr * (0.25 + index * 0.05)
        direction = "bullish" if ghost_close > ghost_open else "bearish" if ghost_close < ghost_open else "neutral"
        confidence = round(clamp(18 + abs(raw_delta) / max(atr, 1e-9) * 35 - index * 4, 2, 88))

        ghosts.append({
            "label": f"PY #{index + 1}",
            "open": round(ghost_open, 5),
            "high": round(ghost_high, 5),
            "low": round(ghost_low, 5),
            "close": round(ghost_close, 5),
            "confidence": confidence,
            "direction": direction,
            "source": "python",
        })

        prev_open = ghost_open
        prev_close = ghost_close

    return [ghost for ghost in ghosts if is_candle_valid_for_symbol({**ghost, "symbol": normalize_symbol(str(candles[-1].get("symbol") or ""))}, str(candles[-1].get("symbol") or ""))]


# ─────────────────────────────────────────────────────────────────────────────
# PYTHON-ONLY SMC + ALPHAX DLM + GHOST CHART OVERLAYS
# No webhook. Built directly from backend candles.
# ─────────────────────────────────────────────────────────────────────────────

def _overlay_time(candle: Dict[str, Any]) -> str:
    return str(candle.get("time") or candle.get("timestamp") or format_bar_time(candle.get("epoch")))


def _pivot_highs(candles: List[Dict[str, Any]], left: int = 3, right: int = 3) -> List[Tuple[int, float]]:
    pivots: List[Tuple[int, float]] = []
    for index in range(left, max(left, len(candles) - right)):
        high = to_float(candles[index].get("high"))
        window = [to_float(candles[j].get("high")) for j in range(index - left, index + right + 1)]
        if window and high == max(window):
            pivots.append((index, high))
    return pivots


def _pivot_lows(candles: List[Dict[str, Any]], left: int = 3, right: int = 3) -> List[Tuple[int, float]]:
    pivots: List[Tuple[int, float]] = []
    for index in range(left, max(left, len(candles) - right)):
        low = to_float(candles[index].get("low"))
        window = [to_float(candles[j].get("low")) for j in range(index - left, index + right + 1)]
        if window and low == min(window):
            pivots.append((index, low))
    return pivots


def build_python_smc_events(candles: List[Dict[str, Any]], lookback: int = 220) -> List[Dict[str, Any]]:
    sample = candles[-lookback:] if len(candles) > lookback else candles[:]
    if len(sample) < 25:
        return []

    piv_hi = _pivot_highs(sample, 3, 3)
    piv_lo = _pivot_lows(sample, 3, 3)
    events: List[Dict[str, Any]] = []
    last_high: Optional[Tuple[int, float]] = None
    last_low: Optional[Tuple[int, float]] = None
    trend = 0

    high_by_index = {idx: price for idx, price in piv_hi}
    low_by_index = {idx: price for idx, price in piv_lo}

    for index in range(len(sample)):
        if index in high_by_index:
            last_high = (index, high_by_index[index])
        if index in low_by_index:
            last_low = (index, low_by_index[index])

        close = to_float(sample[index].get("close"))
        if last_high and index > last_high[0] and close > last_high[1]:
            tag = "BOS" if trend >= 0 else "CHoCH"
            events.append({
                "time": _overlay_time(sample[index]),
                "fromTime": _overlay_time(sample[last_high[0]]),
                "price": round(last_high[1], 5),
                "tag": tag,
                "direction": "bullish",
                "scope": "swing",
            })
            trend = 1
            last_high = None

        if last_low and index > last_low[0] and close < last_low[1]:
            tag = "BOS" if trend <= 0 else "CHoCH"
            events.append({
                "time": _overlay_time(sample[index]),
                "fromTime": _overlay_time(sample[last_low[0]]),
                "price": round(last_low[1], 5),
                "tag": tag,
                "direction": "bearish",
                "scope": "swing",
            })
            trend = -1
            last_low = None

    return events[-24:]


def build_python_smc_zones(candles: List[Dict[str, Any]], lookback: int = 180) -> List[Dict[str, Any]]:
    sample = candles[-lookback:] if len(candles) > lookback else candles[:]
    if len(sample) < 20:
        return []

    zones: List[Dict[str, Any]] = []
    atr = average_true_range(sample, 14) or max(to_float(sample[-1].get("close")) * 0.001, 0.01)
    highs = [to_float(c.get("high")) for c in sample]
    lows = [to_float(c.get("low")) for c in sample]
    top = max(highs)
    bottom = min(lows)
    mid = (top + bottom) / 2.0
    start_time = _overlay_time(sample[0])
    end_time = _overlay_time(sample[-1])

    zones.append({"startTime": start_time, "endTime": end_time, "top": round(top, 5), "bottom": round(mid, 5), "label": "Premium", "direction": "bearish", "kind": "premium"})
    zones.append({"startTime": start_time, "endTime": end_time, "top": round(mid, 5), "bottom": round(bottom, 5), "label": "Discount", "direction": "bullish", "kind": "discount"})

    # Latest bullish/bearish order block approximation: final opposite candle before local impulse.
    for direction in ["bullish", "bearish"]:
        found = None
        for index in range(len(sample) - 8, 5, -1):
            c = sample[index]
            body = abs(to_float(c.get("close")) - to_float(c.get("open")))
            candle_range = max(to_float(c.get("high")) - to_float(c.get("low")), 1e-9)
            if body / candle_range < 0.35:
                continue
            if direction == "bullish" and to_float(c.get("close")) < to_float(c.get("open")):
                future_high = max(to_float(x.get("high")) for x in sample[index + 1:min(len(sample), index + 8)])
                if future_high - to_float(c.get("high")) >= atr * 0.6:
                    found = (index, c)
                    break
            if direction == "bearish" and to_float(c.get("close")) > to_float(c.get("open")):
                future_low = min(to_float(x.get("low")) for x in sample[index + 1:min(len(sample), index + 8)])
                if to_float(c.get("low")) - future_low >= atr * 0.6:
                    found = (index, c)
                    break
        if found:
            index, c = found
            zones.append({
                "startTime": _overlay_time(c),
                "endTime": end_time,
                "top": round(to_float(c.get("high")), 5),
                "bottom": round(to_float(c.get("low")), 5),
                "label": "Bullish OB" if direction == "bullish" else "Bearish OB",
                "direction": direction,
                "kind": "order_block",
            })

    # Recent fair value gaps.
    for index in range(2, len(sample)):
        prev2 = sample[index - 2]
        cur = sample[index]
        if to_float(cur.get("low")) > to_float(prev2.get("high")) + atr * 0.05:
            zones.append({
                "startTime": _overlay_time(prev2),
                "endTime": end_time,
                "top": round(to_float(cur.get("low")), 5),
                "bottom": round(to_float(prev2.get("high")), 5),
                "label": "Bullish FVG",
                "direction": "bullish",
                "kind": "fvg",
            })
        if to_float(cur.get("high")) < to_float(prev2.get("low")) - atr * 0.05:
            zones.append({
                "startTime": _overlay_time(prev2),
                "endTime": end_time,
                "top": round(to_float(prev2.get("low")), 5),
                "bottom": round(to_float(cur.get("high")), 5),
                "label": "Bearish FVG",
                "direction": "bearish",
                "kind": "fvg",
            })

    # Keep the visual clean.
    pd = [z for z in zones if z["kind"] in {"premium", "discount"}]
    ob = [z for z in zones if z["kind"] == "order_block"][-2:]
    fvg = [z for z in zones if z["kind"] == "fvg"][-3:]
    return pd + ob + fvg


def build_python_liquidity_events(candles: List[Dict[str, Any]], lookback: int = 180) -> List[Dict[str, Any]]:
    sample = candles[-lookback:] if len(candles) > lookback else candles[:]
    if len(sample) < 25:
        return []

    atr = average_true_range(sample, 14) or max(to_float(sample[-1].get("close")) * 0.001, 0.01)
    piv_hi = _pivot_highs(sample, 3, 3)
    piv_lo = _pivot_lows(sample, 3, 3)
    events: List[Dict[str, Any]] = []

    for pivots, direction, label in [(piv_hi, "bearish", "Buy-Side Sweep"), (piv_lo, "bullish", "Sell-Side Sweep")]:
        for pivot_index, level in pivots[-10:]:
            for index in range(pivot_index + 1, len(sample)):
                high = to_float(sample[index].get("high"))
                low = to_float(sample[index].get("low"))
                close = to_float(sample[index].get("close"))
                if direction == "bearish" and high > level + atr * 0.04 and close < level:
                    events.append({"time": _overlay_time(sample[index]), "price": round(level, 5), "label": label, "direction": direction, "kind": "sweep"})
                    break
                if direction == "bullish" and low < level - atr * 0.04 and close > level:
                    events.append({"time": _overlay_time(sample[index]), "price": round(level, 5), "label": label, "direction": direction, "kind": "sweep"})
                    break

    return events[-12:]


def build_python_alphax_dlm(candles: List[Dict[str, Any]], lookback: int = 300, bins: int = 36) -> Dict[str, Any]:
    sample = candles[-lookback:] if len(candles) > lookback else candles[:]
    if len(sample) < 20:
        return {"levels": [], "markers": [], "profileBins": [], "meta": {}}

    high = max(to_float(c.get("high")) for c in sample)
    low = min(to_float(c.get("low")) for c in sample)
    step = max((high - low) / max(bins, 1), 1e-9)
    volume_bins = [0.0] * bins
    buy_bins = [0.0] * bins
    sell_bins = [0.0] * bins

    for candle in sample:
        price = (to_float(candle.get("high")) + to_float(candle.get("low")) + to_float(candle.get("close"))) / 3.0
        idx = int((price - low) / step)
        idx = max(0, min(bins - 1, idx))
        volume = max(to_float(candle.get("volume")), 1.0)
        volume_bins[idx] += volume
        if to_float(candle.get("close")) >= to_float(candle.get("open")):
            buy_bins[idx] += volume
        else:
            sell_bins[idx] += volume

    max_vol = max(volume_bins) if volume_bins else 0.0
    max_buy = max(buy_bins) if buy_bins else 0.0
    max_sell = max(sell_bins) if sell_bins else 0.0
    poc_index = volume_bins.index(max_vol) if max_vol > 0 else bins // 2
    buy_index = buy_bins.index(max_buy) if max_buy > 0 else poc_index
    sell_index = sell_bins.index(max_sell) if max_sell > 0 else poc_index

    def level_for(index: int) -> float:
        return low + step * index + step * 0.5

    bull_pressure = max_buy / max(max_buy + max_sell, 1.0) * 100.0
    bear_pressure = max_sell / max(max_buy + max_sell, 1.0) * 100.0
    direction = "bullish" if bull_pressure >= bear_pressure else "bearish"
    pressure = max(bull_pressure, bear_pressure)

    levels = [
        {"label": "AlphaX POC", "price": round(level_for(poc_index), 5), "direction": "neutral"},
        {"label": "DLM Buy Liquidity", "price": round(level_for(buy_index), 5), "direction": "bullish"},
        {"label": "DLM Sell Liquidity", "price": round(level_for(sell_index), 5), "direction": "bearish"},
    ]

    profile_bins = []
    for index in range(bins):
        price = level_for(index)
        profile_bins.append({
            "price": round(price, 5),
            "volumePct": round(volume_bins[index] / max(max_vol, 1.0) * 100.0, 2),
            "buyPct": round(buy_bins[index] / max(max_buy, 1.0) * 100.0, 2),
            "sellPct": round(sell_bins[index] / max(max_sell, 1.0) * 100.0, 2),
            "direction": "bullish" if buy_bins[index] >= sell_bins[index] else "bearish",
        })

    markers = [{
        "time": _overlay_time(sample[-1]),
        "price": round(to_float(sample[-1].get("close")), 5),
        "label": "AlphaX Pressure",
        "direction": direction,
        "kind": "pressure",
        "pressurePct": round(pressure, 2),
    }]

    return {
        "levels": levels,
        "markers": markers,
        "profileBins": profile_bins,
        "meta": {
            "bullPressurePct": round(bull_pressure, 2),
            "bearPressurePct": round(bear_pressure, 2),
            "pocPrice": round(level_for(poc_index), 5),
            "lookback": len(sample),
            "bins": bins,
        },
    }


def build_python_chart_overlays(candles: List[Dict[str, Any]], ghosts: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    if len(candles) < 30:
        payload = empty_overlay_payload()
        payload["ghostCandles"] = ghosts or []
        return payload

    dlm = build_python_alphax_dlm(candles)
    smc_events = build_python_smc_events(candles)
    zones = build_python_smc_zones(candles)
    liquidity = build_python_liquidity_events(candles)
    latest_close = to_float(candles[-1].get("close"))
    meta = dlm.get("meta", {}) if isinstance(dlm, dict) else {}
    bull_pressure = to_float(meta.get("bullPressurePct"), 50)
    bear_pressure = to_float(meta.get("bearPressurePct"), 50)
    direction = "bullish" if bull_pressure >= bear_pressure else "bearish"
    score = round(max(bull_pressure, bear_pressure))

    return {
        "smcEvents": smc_events,
        "dlmLevels": dlm.get("levels", []),
        "zones": zones,
        "liquidityEvents": liquidity,
        "dlmConfluenceMarkers": dlm.get("markers", []),
        "scoreMarkers": [{
            "time": _overlay_time(candles[-1]),
            "price": round(latest_close, 5),
            "label": "Python SMC+AlphaX",
            "direction": direction,
            "kind": "python_score",
            "score": score,
            "grade": "A" if score >= 70 else "B" if score >= 55 else "C",
        }],
        "alphaProfileBins": dlm.get("profileBins", []),
        "alphaProfileMeta": meta,
        "ghostCandles": ghosts or [],
        "source": "python_only_no_webhook",
    }


# ─────────────────────────────────────────────────────────────────────────────
# PYTHON-ONLY 12 INDICATOR TECHNICAL SENTIMENT ENGINE
# Matches the TradingView meter concept without requiring a webhook.
# ─────────────────────────────────────────────────────────────────────────────

TECHNICAL_METER_NAMES = [
    "RSI",
    "Stochastic",
    "Stoch RSI",
    "CCI",
    "Bull Bear Power",
    "Momentum",
    "Moving Average",
    "VWAP",
    "Bollinger Bands",
    "Supertrend",
    "Linear Regression",
    "Market Structure",
]


def technical_empty_payload(status: str = "Waiting") -> Dict[str, Any]:
    indicators = [
        {
            "name": name,
            "value": 50,
            "signal": "NEUTRAL",
            "status": "NEUTRAL",
        }
        for name in TECHNICAL_METER_NAMES
    ]

    return {
        "eventType": "PYTHON_TECHNICAL_SENTIMENT",
        "status": status,
        "sentiment": 50,
        "sentimentStatus": "Mostly Neutral",
        "bearCount": 0,
        "neutralCount": len(indicators),
        "bullCount": 0,
        "bearPct": 0,
        "neutralPct": 100,
        "bullPct": 0,
        "activeCount": len(indicators),
        "indicators": indicators,
        "technicalIndicators": indicators,
        "technicalMeter": indicators,
    }


def classify_meter_value(value: float) -> str:
    parsed = clamp(to_float(value, 50), 0, 100)
    if parsed > 60:
        return "BULLISH"
    if parsed < 40:
        return "BEARISH"
    return "NEUTRAL"


def interpolate_meter(value: float, value_high: float, value_low: float, range_high: float, range_low: float) -> float:
    if value_high == value_low:
        return range_low
    return range_low + (value - value_low) * (range_high - range_low) / (value_high - value_low)


def sma_values(values: List[float], length: int) -> List[Optional[float]]:
    safe_length = max(int(length or 1), 1)
    output: List[Optional[float]] = []

    running_sum = 0.0
    window: List[float] = []

    for value in values:
        window.append(to_float(value))
        running_sum += to_float(value)

        if len(window) > safe_length:
            running_sum -= window.pop(0)

        output.append(running_sum / safe_length if len(window) == safe_length else None)

    return output


def ema_values(values: List[float], length: int) -> List[Optional[float]]:
    safe_length = max(int(length or 1), 1)
    alpha = 2.0 / (safe_length + 1.0)
    output: List[Optional[float]] = []
    ema: Optional[float] = None

    for value in values:
        parsed = to_float(value)
        ema = parsed if ema is None else (parsed * alpha) + (ema * (1.0 - alpha))
        output.append(ema)

    return output


def rma_values(values: List[float], length: int) -> List[Optional[float]]:
    safe_length = max(int(length or 1), 1)
    alpha = 1.0 / safe_length
    output: List[Optional[float]] = []
    rma: Optional[float] = None

    for value in values:
        parsed = to_float(value)
        rma = parsed if rma is None else (parsed * alpha) + (rma * (1.0 - alpha))
        output.append(rma)

    return output


def stdev(values: List[float]) -> float:
    cleaned = [to_float(v) for v in values if v is not None]
    if not cleaned:
        return 0.0
    mean = sum(cleaned) / len(cleaned)
    variance = sum((item - mean) ** 2 for item in cleaned) / len(cleaned)
    return variance ** 0.5


def rolling_dev(values: List[float], length: int) -> List[Optional[float]]:
    safe_length = max(int(length or 1), 1)
    output: List[Optional[float]] = []

    for index in range(len(values)):
        if index + 1 < safe_length:
            output.append(None)
            continue
        output.append(stdev(values[index + 1 - safe_length:index + 1]))

    return output


def highest(values: List[float], length: int, index: int) -> Optional[float]:
    safe_length = max(int(length or 1), 1)
    if index + 1 < safe_length:
        return None
    window = values[index + 1 - safe_length:index + 1]
    return max(window) if window else None


def lowest(values: List[float], length: int, index: int) -> Optional[float]:
    safe_length = max(int(length or 1), 1)
    if index + 1 < safe_length:
        return None
    window = values[index + 1 - safe_length:index + 1]
    return min(window) if window else None


def rsi_series(values: List[float], length: int = 14) -> List[Optional[float]]:
    safe_length = max(int(length or 1), 1)
    if len(values) < 2:
        return [None for _ in values]

    gains: List[float] = [0.0]
    losses: List[float] = [0.0]

    for index in range(1, len(values)):
        change = to_float(values[index]) - to_float(values[index - 1])
        gains.append(max(change, 0.0))
        losses.append(max(-change, 0.0))

    avg_gain = rma_values(gains, safe_length)
    avg_loss = rma_values(losses, safe_length)

    output: List[Optional[float]] = []
    for gain, loss in zip(avg_gain, avg_loss):
        if gain is None or loss is None:
            output.append(None)
            continue
        if loss == 0:
            output.append(100.0)
            continue
        rs = gain / loss
        output.append(100.0 - (100.0 / (1.0 + rs)))

    return output


def rsi_meter_value(rsi_value: Optional[float]) -> float:
    r = clamp(to_float(rsi_value, 50), 0, 100)

    if r > 70:
        return clamp(interpolate_meter(r, 100, 70, 100, 75), 0, 100)
    if r > 50:
        return clamp(interpolate_meter(r, 70, 50, 75, 50), 0, 100)
    if r > 30:
        return clamp(interpolate_meter(r, 50, 30, 50, 25), 0, 100)
    return clamp(interpolate_meter(r, 30, 0, 25, 0), 0, 100)


def stochastic_values(highs: List[float], lows: List[float], closes: List[float], length: int = 14, smooth: int = 3) -> List[Optional[float]]:
    raw: List[Optional[float]] = []

    for index, close in enumerate(closes):
        hi = highest(highs, length, index)
        lo = lowest(lows, length, index)

        if hi is None or lo is None or hi == lo:
            raw.append(None)
        else:
            raw.append(clamp(((to_float(close) - lo) / (hi - lo)) * 100.0, 0, 100))

    cleaned = [50.0 if item is None else to_float(item, 50) for item in raw]
    smoothed = sma_values(cleaned, smooth)

    return smoothed


def stochastic_meter_value(stoch_value: Optional[float]) -> float:
    s = clamp(to_float(stoch_value, 50), 0, 100)

    if s > 80:
        return clamp(interpolate_meter(s, 100, 80, 100, 75), 0, 100)
    if s > 50:
        return clamp(interpolate_meter(s, 80, 50, 75, 50), 0, 100)
    if s > 20:
        return clamp(interpolate_meter(s, 50, 20, 50, 25), 0, 100)
    return clamp(interpolate_meter(s, 20, 0, 25, 0), 0, 100)


def cci_series(source: List[float], length: int = 20) -> List[Optional[float]]:
    ma = sma_values(source, length)
    dev = rolling_dev(source, length)
    output: List[Optional[float]] = []

    for value, avg, deviation in zip(source, ma, dev):
        if avg is None or deviation is None or deviation == 0:
            output.append(None)
            continue

        output.append((to_float(value) - avg) / (0.015 * deviation))

    return output


def cci_meter_value(cci_value: Optional[float]) -> float:
    c = to_float(cci_value, 0)

    if c > 100:
        return 100 if c > 300 else clamp(interpolate_meter(c, 300, 100, 100, 75), 0, 100)
    if c >= 0:
        return clamp(interpolate_meter(c, 100, 0, 75, 50), 0, 100)
    if c < -100:
        return 0 if c < -300 else clamp(interpolate_meter(c, -100, -300, 25, 0), 0, 100)
    return clamp(interpolate_meter(c, 0, -100, 50, 25), 0, 100)


def pine_like_normalize(buy_flags: List[bool], sell_flags: List[bool], closes: List[float], smooth: int = 3) -> float:
    os_state = 0
    max_price: Optional[float] = None
    min_price: Optional[float] = None
    raw_values: List[float] = []

    for index, close in enumerate(closes):
        buy = bool(buy_flags[index]) if index < len(buy_flags) else False
        sell = bool(sell_flags[index]) if index < len(sell_flags) else False
        previous_os = os_state
        os_state = 1 if buy else -1 if sell else os_state

        parsed_close = to_float(close)

        if max_price is None:
            max_price = parsed_close
        if min_price is None:
            min_price = parsed_close

        if os_state > previous_os:
            max_price = parsed_close
        elif os_state < previous_os:
            max_price = max_price
        else:
            max_price = max(parsed_close, max_price)

        if os_state < previous_os:
            min_price = parsed_close
        elif os_state > previous_os:
            min_price = min_price
        else:
            min_price = min(parsed_close, min_price)

        if max_price == min_price:
            raw_values.append(50.0)
        else:
            raw_values.append(clamp(((parsed_close - min_price) / (max_price - min_price)) * 100.0, 0, 100))

    smooth_values = sma_values(raw_values, max(int(smooth or 1), 1))
    last = next((item for item in reversed(smooth_values) if item is not None), raw_values[-1] if raw_values else 50)
    return clamp(to_float(last, 50), 0, 100)


def moving_average_series(values: List[float], length: int = 20, ma_type: str = "SMA") -> List[Optional[float]]:
    ma = ma_type.upper()
    if ma == "EMA":
        return ema_values(values, length)
    if ma == "RMA":
        return rma_values(values, length)

    # Dashboard default mirrors Pine default: SMA.
    return sma_values(values, length)


def atr_series(highs: List[float], lows: List[float], closes: List[float], length: int = 10) -> List[Optional[float]]:
    true_ranges: List[float] = []

    for index in range(len(closes)):
        high = to_float(highs[index])
        low = to_float(lows[index])
        previous_close = to_float(closes[index - 1]) if index > 0 else to_float(closes[index])
        true_ranges.append(max(high - low, abs(high - previous_close), abs(low - previous_close)))

    return rma_values(true_ranges, length)


def supertrend_values(highs: List[float], lows: List[float], closes: List[float], period: int = 10, factor: float = 3.0) -> List[Optional[float]]:
    atr = atr_series(highs, lows, closes, period)
    final_upper: Optional[float] = None
    final_lower: Optional[float] = None
    direction = 1
    output: List[Optional[float]] = []

    for index in range(len(closes)):
        if atr[index] is None:
            output.append(None)
            continue

        hl2 = (to_float(highs[index]) + to_float(lows[index])) / 2.0
        basic_upper = hl2 + factor * to_float(atr[index])
        basic_lower = hl2 - factor * to_float(atr[index])
        previous_close = to_float(closes[index - 1]) if index > 0 else to_float(closes[index])

        if final_upper is None:
            final_upper = basic_upper
        else:
            final_upper = basic_upper if basic_upper < final_upper or previous_close > final_upper else final_upper

        if final_lower is None:
            final_lower = basic_lower
        else:
            final_lower = basic_lower if basic_lower > final_lower or previous_close < final_lower else final_lower

        close = to_float(closes[index])
        if direction == -1 and close > final_upper:
            direction = 1
        elif direction == 1 and close < final_lower:
            direction = -1

        output.append(final_lower if direction == 1 else final_upper)

    return output


def correlation_with_index(values: List[float], length: int = 25) -> float:
    safe_length = max(int(length or 1), 2)
    if len(values) < safe_length:
        return 50.0

    y = [to_float(item) for item in values[-safe_length:]]
    x = list(range(safe_length))

    x_mean = sum(x) / safe_length
    y_mean = sum(y) / safe_length

    numerator = sum((x_item - x_mean) * (y_item - y_mean) for x_item, y_item in zip(x, y))
    x_var = sum((x_item - x_mean) ** 2 for x_item in x)
    y_var = sum((y_item - y_mean) ** 2 for y_item in y)

    if x_var <= 0 or y_var <= 0:
        return 50.0

    corr = numerator / ((x_var ** 0.5) * (y_var ** 0.5))
    return clamp(50.0 * corr + 50.0, 0, 100)


def market_structure_meter_value(highs: List[float], lows: List[float], closes: List[float], length: int = 5, smooth: int = 3) -> float:
    pivot_highs: List[Optional[float]] = [None for _ in closes]
    pivot_lows: List[Optional[float]] = [None for _ in closes]

    for index in range(length, len(closes) - length):
        high_window = highs[index - length:index + length + 1]
        low_window = lows[index - length:index + length + 1]

        if highs[index] == max(high_window):
            pivot_highs[index] = highs[index]
        if lows[index] == min(low_window):
            pivot_lows[index] = lows[index]

    last_ph: Optional[float] = None
    last_pl: Optional[float] = None
    ph_cross = False
    pl_cross = False
    buy_flags: List[bool] = []
    sell_flags: List[bool] = []

    for index, close in enumerate(closes):
        if pivot_highs[index] is not None:
            last_ph = pivot_highs[index]
            ph_cross = False
        if pivot_lows[index] is not None:
            last_pl = pivot_lows[index]
            pl_cross = False

        bull = last_ph is not None and to_float(close) > last_ph and not ph_cross
        bear = last_pl is not None and to_float(close) < last_pl and not pl_cross

        if bull:
            ph_cross = True
        if bear:
            pl_cross = True

        buy_flags.append(bool(bull))
        sell_flags.append(bool(bear))

    return pine_like_normalize(buy_flags, sell_flags, closes, smooth)


def latest_valid(values: List[Optional[float]], fallback: float = 50.0) -> float:
    for value in reversed(values):
        if value is not None:
            return to_float(value, fallback)
    return fallback


def build_meter_indicator(name: str, value: float) -> Dict[str, Any]:
    rounded = round(clamp(value, 0, 100), 2)
    signal = classify_meter_value(rounded)
    return {
        "name": name,
        "value": rounded,
        "signal": signal,
        "status": signal,
    }


def calculate_latest_sentiment(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    if len(candles) < 30:
        return technical_empty_payload("Waiting")

    opens = [to_float(c.get("open")) for c in candles]
    highs = [to_float(c.get("high")) for c in candles]
    lows = [to_float(c.get("low")) for c in candles]
    closes = [to_float(c.get("close")) for c in candles]
    volumes = [max(to_float(c.get("volume")), 0.0) for c in candles]
    hlc3 = [(h + l + c) / 3.0 for h, l, c in zip(highs, lows, closes)]

    if not closes or closes[-1] <= 0:
        return technical_empty_payload("Waiting")

    norm_smooth = 3

    # 1. RSI
    rsi_value = rsi_meter_value(latest_valid(rsi_series(closes, 14)))

    # 2. Stochastic
    stoch_value = stochastic_meter_value(latest_valid(stochastic_values(highs, lows, closes, 14, 3)))

    # 3. Stoch RSI
    rsi_for_stoch = [50.0 if item is None else to_float(item, 50) for item in rsi_series(closes, 14)]
    stoch_rsi_raw: List[Optional[float]] = []
    for index, rsi_item in enumerate(rsi_for_stoch):
        hi = highest(rsi_for_stoch, 14, index)
        lo = lowest(rsi_for_stoch, 14, index)
        if hi is None or lo is None or hi == lo:
            stoch_rsi_raw.append(None)
        else:
            stoch_rsi_raw.append(clamp(((rsi_item - lo) / (hi - lo)) * 100.0, 0, 100))
    stoch_rsi_smoothed = sma_values([50.0 if item is None else item for item in stoch_rsi_raw], 3)
    stoch_rsi_value = stochastic_meter_value(latest_valid(stoch_rsi_smoothed))

    # 4. CCI
    cci_value = cci_meter_value(latest_valid(cci_series(hlc3, 20), 0))

    # 5. Bull Bear Power
    ema_13 = ema_values(closes, 13)
    bbp_series = [
        (highs[index] + lows[index] - 2.0 * to_float(ema_13[index], closes[index]))
        for index in range(len(closes))
    ]
    bbp_ma = sma_values(bbp_series, 100)
    bbp_dev = rolling_dev(bbp_series, 100)
    latest_bbp = bbp_series[-1]
    latest_bbp_ma = latest_valid(bbp_ma, 0)
    latest_bbp_dev = latest_valid(bbp_dev, 0)
    upper = latest_bbp_ma + 2.0 * latest_bbp_dev
    lower = latest_bbp_ma - 2.0 * latest_bbp_dev
    if latest_bbp_dev <= 0:
        bbp_value = 50.0
    elif latest_bbp > upper:
        bbp_value = 100.0 if latest_bbp > 1.5 * upper else clamp(interpolate_meter(latest_bbp, 1.5 * upper, upper, 100, 75), 0, 100)
    elif latest_bbp > 0:
        bbp_value = clamp(interpolate_meter(latest_bbp, upper, 0, 75, 50), 0, 100)
    elif latest_bbp < lower:
        bbp_value = 0.0 if latest_bbp < 1.5 * lower else clamp(interpolate_meter(latest_bbp, lower, 1.5 * lower, 25, 0), 0, 100)
    else:
        bbp_value = clamp(interpolate_meter(latest_bbp, 0, lower, 50, 25), 0, 100)

    # 6. Momentum
    momentum_length = 10
    momentum_series = [
        closes[index] - closes[index - momentum_length] if index >= momentum_length else 0.0
        for index in range(len(closes))
    ]
    momentum_value = pine_like_normalize(
        [item > 0 for item in momentum_series],
        [item < 0 for item in momentum_series],
        closes,
        norm_smooth,
    )

    # 7. Moving Average
    ma_20 = moving_average_series(closes, 20, "SMA")
    ma_value = pine_like_normalize(
        [closes[index] > to_float(ma_20[index], closes[index]) for index in range(len(closes))],
        [closes[index] < to_float(ma_20[index], closes[index]) for index in range(len(closes))],
        closes,
        norm_smooth,
    )

    # 8. VWAP bands
    cumulative_price_volume = 0.0
    cumulative_volume = 0.0
    vwap_values: List[float] = []
    for typical, volume in zip(hlc3, volumes):
        safe_volume = volume if volume > 0 else 1.0
        cumulative_price_volume += typical * safe_volume
        cumulative_volume += safe_volume
        vwap_values.append(cumulative_price_volume / max(cumulative_volume, 1.0))

    vwap_basis = vwap_values[-1]
    vwap_dev = stdev([typical - vwap for typical, vwap in zip(hlc3[-100:], vwap_values[-100:])])
    vwap_upper = vwap_basis + 2.0 * vwap_dev
    vwap_lower = vwap_basis - 2.0 * vwap_dev
    vwap_value = pine_like_normalize(
        [close > vwap_upper for close in closes],
        [close < vwap_lower for close in closes],
        closes,
        norm_smooth,
    )

    # 9. Bollinger Bands
    bb_basis = moving_average_series(closes, 20, "SMA")
    bb_dev = rolling_dev(closes, 20)
    bb_value = pine_like_normalize(
        [
            closes[index] > to_float(bb_basis[index], closes[index]) + 2.0 * to_float(bb_dev[index], 0)
            for index in range(len(closes))
        ],
        [
            closes[index] < to_float(bb_basis[index], closes[index]) - 2.0 * to_float(bb_dev[index], 0)
            for index in range(len(closes))
        ],
        closes,
        norm_smooth,
    )

    # 10. Supertrend
    st_values = supertrend_values(highs, lows, closes, 10, 3.0)
    st_value = pine_like_normalize(
        [closes[index] > to_float(st_values[index], closes[index]) for index in range(len(closes))],
        [closes[index] < to_float(st_values[index], closes[index]) for index in range(len(closes))],
        closes,
        norm_smooth,
    )

    # 11. Linear Regression
    reg_value = correlation_with_index(closes, 25)

    # 12. Market Structure
    ms_value = market_structure_meter_value(highs, lows, closes, 5, norm_smooth)

    indicators = [
        build_meter_indicator("RSI", rsi_value),
        build_meter_indicator("Stochastic", stoch_value),
        build_meter_indicator("Stoch RSI", stoch_rsi_value),
        build_meter_indicator("CCI", cci_value),
        build_meter_indicator("Bull Bear Power", bbp_value),
        build_meter_indicator("Momentum", momentum_value),
        build_meter_indicator("Moving Average", ma_value),
        build_meter_indicator("VWAP", vwap_value),
        build_meter_indicator("Bollinger Bands", bb_value),
        build_meter_indicator("Supertrend", st_value),
        build_meter_indicator("Linear Regression", reg_value),
        build_meter_indicator("Market Structure", ms_value),
    ]

    bull = sum(1 for item in indicators if item["signal"] == "BULLISH")
    bear = sum(1 for item in indicators if item["signal"] == "BEARISH")
    neutral = sum(1 for item in indicators if item["signal"] == "NEUTRAL")
    active = len(indicators)
    sentiment = round(sum(to_float(item["value"], 50) for item in indicators) / max(active, 1), 2)

    if bull > bear and bull > neutral:
        status = "Strong Bullish" if (bull / max(active, 1)) * 100 >= 70 else "Mostly Bullish"
    elif bear > bull and bear > neutral:
        status = "Strong Bearish" if (bear / max(active, 1)) * 100 >= 70 else "Mostly Bearish"
    elif neutral > bull and neutral > bear:
        status = "Mostly Neutral"
    elif sentiment > 60:
        status = "Bullish Lean"
    elif sentiment < 40:
        status = "Bearish Lean"
    else:
        status = "Mixed"

    return {
        "eventType": "PYTHON_TECHNICAL_SENTIMENT",
        "status": "Live",
        "sentiment": sentiment,
        "sentimentStatus": status,
        "bearCount": bear,
        "neutralCount": neutral,
        "bullCount": bull,
        "bearPct": round((bear / max(active, 1)) * 100, 2),
        "neutralPct": round((neutral / max(active, 1)) * 100, 2),
        "bullPct": round((bull / max(active, 1)) * 100, 2),
        "activeCount": active,
        "indicators": indicators,
        "technicalIndicators": indicators,
        "technicalMeter": indicators,
    }


def empty_overlay_payload() -> Dict[str, Any]:
    return {
        "smcEvents": [],
        "dlmLevels": [],
        "zones": [],
        "liquidityEvents": [],
        "dlmConfluenceMarkers": [],
        "scoreMarkers": [],
        "alphaProfileBins": [],
        "alphaProfileMeta": {},
    }



# ─────────────────────────────────────────────────────────────────────────────
# S&P 500 HEATMAP — FREE LIVE/NEAR-LIVE QUOTE SNAPSHOT
# Source: Yahoo Finance quote endpoint, no API key.
# Note: free market data can be delayed by exchange/vendor rules.
# ─────────────────────────────────────────────────────────────────────────────

SP500_HEATMAP_SECTORS: Dict[str, List[str]] = {
    "Technology": ["MSFT", "NVDA", "AAPL", "AVGO", "ORCL", "CRM", "AMD", "ADBE", "QCOM", "CSCO", "TXN", "INTC"],
    "Communication Services": ["META", "GOOGL", "GOOG", "NFLX", "TMUS", "DIS", "VZ", "CMCSA"],
    "Consumer Cyclical": ["AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "LOW", "BKNG", "ORLY"],
    "Consumer Defensive": ["WMT", "COST", "PG", "KO", "PEP", "PM", "MO", "CL", "MDLZ"],
    "Financial": ["JPM", "V", "MA", "BAC", "WFC", "BRK-B", "GS", "MS", "AXP", "SPGI"],
    "Healthcare": ["LLY", "UNH", "JNJ", "ABBV", "MRK", "ABT", "TMO", "DHR", "PFE", "ISRG"],
    "Industrials": ["GE", "CAT", "RTX", "BA", "UNP", "HON", "UPS", "LMT", "ETN", "DE"],
    "Energy": ["XOM", "CVX", "COP", "SLB", "EOG", "MPC", "PSX"],
    "Utilities": ["NEE", "SO", "DUK", "AEP", "SRE", "D"],
    "Real Estate": ["AMT", "PLD", "EQIX", "CCI", "SPG", "DLR"],
    "Materials": ["LIN", "SHW", "FCX", "NEM", "APD", "ECL"],
}

# Approximate market-cap fallback in billions.
# Purpose: tile sizing only. Live/near-live price and % change still come from the quote source.
SP500_HEATMAP_MARKET_CAP_FALLBACK_BILLIONS: Dict[str, float] = {
    "MSFT": 3400, "NVDA": 3300, "AAPL": 3100, "AVGO": 1400, "ORCL": 650, "CRM": 300,
    "AMD": 260, "ADBE": 190, "QCOM": 190, "CSCO": 230, "TXN": 180, "INTC": 130,

    "META": 1500, "GOOGL": 1100, "GOOG": 1100, "NFLX": 500, "TMUS": 270, "DIS": 200,
    "VZ": 180, "CMCSA": 140,

    "AMZN": 2100, "TSLA": 1100, "HD": 410, "MCD": 220, "NKE": 120, "SBUX": 110,
    "LOW": 140, "BKNG": 170, "ORLY": 80,

    "WMT": 760, "COST": 430, "PG": 400, "KO": 300, "PEP": 220, "PM": 210, "MO": 85,
    "CL": 80, "MDLZ": 95,

    "JPM": 650, "V": 650, "MA": 500, "BAC": 320, "WFC": 260, "BRK-B": 1000, "GS": 200,
    "MS": 180, "AXP": 220, "SPGI": 160,

    "LLY": 800, "UNH": 520, "JNJ": 380, "ABBV": 360, "MRK": 240, "ABT": 230,
    "TMO": 210, "DHR": 180, "PFE": 150, "ISRG": 200,

    "GE": 250, "CAT": 180, "RTX": 180, "BA": 120, "UNP": 150, "HON": 140,
    "UPS": 110, "LMT": 110, "ETN": 150, "DE": 120,

    "XOM": 500, "CVX": 300, "COP": 130, "SLB": 65, "EOG": 70, "MPC": 55, "PSX": 50,

    "NEE": 150, "SO": 100, "DUK": 85, "AEP": 55, "SRE": 50, "D": 45,

    "AMT": 90, "PLD": 100, "EQIX": 90, "CCI": 45, "SPG": 60, "DLR": 60,

    "LIN": 220, "SHW": 95, "FCX": 60, "NEM": 50, "APD": 65, "ECL": 70,
}


def get_sp500_fallback_market_cap(symbol: str) -> float:
    normalized = str(symbol or "").upper().strip().replace(".", "-")
    billions = SP500_HEATMAP_MARKET_CAP_FALLBACK_BILLIONS.get(normalized, 10.0)
    return max(float(billions), 1.0) * 1_000_000_000.0


def flatten_sp500_heatmap_symbols() -> List[str]:
    symbols: List[str] = []
    for sector_symbols in SP500_HEATMAP_SECTORS.values():
        for symbol in sector_symbols:
            if symbol not in symbols:
                symbols.append(symbol)
    return symbols


def yahoo_chart_symbol(symbol: str) -> str:
    # Yahoo chart uses BRK-B style while dashboard display can use BRK.B.
    return str(symbol).upper().strip().replace(".", "-")


def stooq_symbol(symbol: str) -> str:
    # Stooq US stocks use lowercase ticker + .us. BRK-B is accepted as brk-b.us.
    return f"{str(symbol).lower().strip().replace('.', '-')}.us"


def http_get_text_or_none(url: str, headers: Optional[Dict[str, str]] = None, provider: str = "Data provider") -> Optional[str]:
    request = Request(url, headers=headers or {})
    try:
        with urlopen(request, timeout=25) as response:
            return response.read().decode("utf-8", errors="ignore")
    except Exception as error:
        print(f"[{provider}] failed: {error}")
        return None


def parse_yahoo_chart_row(symbol: str, chart: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        result = chart.get("chart", {}).get("result", [])
        if not isinstance(result, list) or not result:
            return None

        item = result[0]
        meta = item.get("meta", {}) if isinstance(item, dict) else {}
        timestamps = item.get("timestamp", []) if isinstance(item.get("timestamp"), list) else []
        quote = item.get("indicators", {}).get("quote", [])
        quote_item = quote[0] if isinstance(quote, list) and quote else {}

        closes = quote_item.get("close", []) if isinstance(quote_item.get("close"), list) else []
        latest_price = 0.0
        latest_index = -1

        for index in range(len(closes) - 1, -1, -1):
            parsed = to_float(closes[index], 0.0)
            if parsed > 0:
                latest_price = parsed
                latest_index = index
                break

        previous_close = to_float(
            meta.get("previousClose") or
            meta.get("chartPreviousClose") or
            meta.get("regularMarketPreviousClose"),
            0.0,
        )

        if latest_price <= 0:
            latest_price = to_float(meta.get("regularMarketPrice"), 0.0)

        if previous_close <= 0:
            first_valid = next((to_float(close, 0.0) for close in closes if to_float(close, 0.0) > 0), 0.0)
            previous_close = first_valid

        if latest_price <= 0:
            return None

        change = latest_price - previous_close if previous_close > 0 else 0.0
        change_pct = (change / previous_close) * 100.0 if previous_close > 0 else 0.0

        market_time = timestamps[latest_index] if latest_index >= 0 and latest_index < len(timestamps) else meta.get("regularMarketTime")
        market_cap = to_float(meta.get("marketCap"), 0.0)

        return {
            "symbol": symbol,
            "shortName": symbol,
            "longName": symbol,
            "regularMarketPrice": latest_price,
            "regularMarketChange": change,
            "regularMarketChangePercent": change_pct,
            "regularMarketPreviousClose": previous_close,
            "regularMarketTime": market_time,
            "marketCap": market_cap,
            "quoteSourceName": "yahoo_chart",
        }
    except Exception as error:
        print(f"[S&P 500 Heatmap] Yahoo chart parse failed for {symbol}: {error}")
        return None


def fetch_yahoo_chart_quotes(symbols: List[str]) -> List[Dict[str, Any]]:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; MARKETBOS-Dashboard/1.0)",
        "Accept": "application/json",
    }

    rows: List[Dict[str, Any]] = []

    for symbol in symbols:
        yahoo_symbol = yahoo_chart_symbol(symbol)
        params = urlencode({
            "range": "1d",
            "interval": "1m",
            "includePrePost": "true",
            "events": "div,splits",
        })

        for host in ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]:
            url = f"https://{host}/v8/finance/chart/{quote(yahoo_symbol)}?{params}"
            data = http_get_json_or_none(url, headers=headers, provider="Yahoo Finance chart")
            if isinstance(data, dict):
                row = parse_yahoo_chart_row(symbol, data)
                if row:
                    rows.append(row)
                    break

    return rows


def fetch_stooq_quote_batch(symbols: List[str]) -> List[Dict[str, Any]]:
    safe_symbols = [str(symbol).upper().strip() for symbol in symbols if str(symbol).strip()]
    if not safe_symbols:
        return []

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; MARKETBOS-Dashboard/1.0)",
        "Accept": "text/csv,*/*",
    }

    # Stooq is a no-key fallback. It is delayed, but it usually works on server hosts.
    # Fields requested: symbol,date,time,open,high,low,close,volume,name.
    stooq_symbols = ",".join(stooq_symbol(symbol) for symbol in safe_symbols)
    url = f"https://stooq.com/q/l/?s={quote(stooq_symbols, safe=',')}&f=sd2t2ohlcvn&h&e=csv"
    text = http_get_text_or_none(url, headers=headers, provider="Stooq quotes")

    if not text or "," not in text:
        return []

    rows: List[Dict[str, Any]] = []

    try:
        reader = csv.DictReader(io.StringIO(text))
        for item in reader:
            raw_symbol = str(item.get("Symbol") or item.get("symbol") or "").upper().replace(".US", "")
            if not raw_symbol:
                continue

            dashboard_symbol = raw_symbol.replace(".", "-")
            price = to_float(item.get("Close") or item.get("Last") or item.get("close") or item.get("last"), 0.0)
            open_price = to_float(item.get("Open") or item.get("open"), 0.0)

            if price <= 0:
                continue

            change = price - open_price if open_price > 0 else 0.0
            change_pct = (change / open_price) * 100.0 if open_price > 0 else 0.0

            rows.append({
                "symbol": dashboard_symbol,
                "shortName": dashboard_symbol,
                "longName": str(item.get("Name") or dashboard_symbol),
                "regularMarketPrice": price,
                "regularMarketChange": change,
                "regularMarketChangePercent": change_pct,
                "regularMarketPreviousClose": open_price,
                "regularMarketTime": None,
                "marketCap": 0.0,
                "quoteSourceName": "stooq_quote",
            })
    except Exception as error:
        print(f"[S&P 500 Heatmap] Stooq CSV parse failed: {error}")
        return []

    return rows


def fetch_yahoo_quote_batch(symbols: List[str]) -> List[Dict[str, Any]]:
    safe_symbols = [str(symbol).upper().strip() for symbol in symbols if str(symbol).strip()]
    if not safe_symbols:
        return []

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; MARKETBOS-Dashboard/1.0)",
        "Accept": "application/json,text/plain,*/*",
    }

    # 1) Yahoo quote endpoint.
    primary_params = urlencode({
        "symbols": ",".join(safe_symbols),
        "formatted": "false",
        "region": "US",
        "lang": "en-US",
        "corsDomain": "finance.yahoo.com",
        "fields": "symbol,shortName,longName,regularMarketPrice,regularMarketChangePercent,regularMarketChange,regularMarketPreviousClose,regularMarketTime,marketCap",
    })

    for host in ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]:
        try:
            data = http_get_json_or_none(
                f"https://{host}/v7/finance/quote?{primary_params}",
                headers=headers,
                provider="Yahoo Finance quote",
            )
            result = data.get("quoteResponse", {}).get("result", []) if isinstance(data, dict) else []
            if isinstance(result, list):
                valid = [
                    row for row in result
                    if to_float(row.get("regularMarketPrice"), 0.0) > 0
                ]
                if valid:
                    return valid
        except Exception as error:
            print(f"[S&P 500 Heatmap] Yahoo quote batch failed: {error}")

    # 2) Yahoo spark endpoint.
    spark_params = urlencode({
        "symbols": ",".join(safe_symbols),
        "range": "1d",
        "interval": "1m",
        "includePrePost": "true",
        "includeTimestamps": "true",
    })

    for host in ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]:
        try:
            data = http_get_json_or_none(
                f"https://{host}/v7/finance/spark?{spark_params}",
                headers=headers,
                provider="Yahoo Finance spark",
            )

            rows: List[Dict[str, Any]] = []
            spark_result = data.get("spark", {}).get("result", []) if isinstance(data, dict) else []

            if isinstance(spark_result, list):
                for item in spark_result:
                    if not isinstance(item, dict):
                        continue

                    symbol = str(item.get("symbol") or "").upper().strip()
                    response = item.get("response", [])
                    response_item = response[0] if isinstance(response, list) and response else {}

                    if not symbol or not isinstance(response_item, dict):
                        continue

                    row = parse_yahoo_chart_row(symbol, {"chart": {"result": [response_item]}})
                    if row:
                        row["quoteSourceName"] = "yahoo_spark"
                        rows.append(row)

            if rows:
                return rows
        except Exception as error:
            print(f"[S&P 500 Heatmap] Yahoo spark fallback failed: {error}")

    # 3) Yahoo chart endpoint one symbol at a time.
    chart_rows = fetch_yahoo_chart_quotes(safe_symbols)
    if chart_rows:
        return chart_rows

    # 4) Stooq delayed quote fallback.
    stooq_rows = fetch_stooq_quote_batch(safe_symbols)
    if stooq_rows:
        return stooq_rows

    return []



def build_sp500_heatmap_payload() -> Dict[str, Any]:
    all_symbols = flatten_sp500_heatmap_symbols()
    quote_rows: Dict[str, Dict[str, Any]] = {}

    try:
        for index in range(0, len(all_symbols), 60):
            batch = all_symbols[index:index + 60]
            for quote_row in fetch_yahoo_quote_batch(batch):
                symbol = str(quote_row.get("symbol") or "").upper().strip()
                if symbol:
                    quote_rows[symbol] = quote_row
    except Exception as error:
        print(f"[S&P 500 Heatmap] Yahoo quote fetch failed: {error}")

    sectors: List[Dict[str, Any]] = []
    total_market_cap = 0.0

    for sector_name, symbols in SP500_HEATMAP_SECTORS.items():
        stocks: List[Dict[str, Any]] = []
        sector_market_cap = 0.0
        weighted_change_sum = 0.0

        for symbol in symbols:
            quote_row = quote_rows.get(symbol) or {}
            display_symbol = symbol.replace("-", ".")
            market_cap = max(to_float(quote_row.get("marketCap")), 0.0)
            change_pct = to_float(quote_row.get("regularMarketChangePercent"), 0.0)
            price = to_float(quote_row.get("regularMarketPrice"), 0.0)
            previous_close = to_float(quote_row.get("regularMarketPreviousClose"), 0.0)
            change = to_float(quote_row.get("regularMarketChange"), price - previous_close if price and previous_close else 0.0)

            if market_cap <= 0:
                market_cap = get_sp500_fallback_market_cap(symbol)

            sector_market_cap += market_cap
            weighted_change_sum += change_pct * market_cap

            stocks.append({
                "symbol": symbol,
                "displaySymbol": display_symbol,
                "name": quote_row.get("shortName") or quote_row.get("longName") or display_symbol,
                "price": round(price, 4),
                "change": round(change, 4),
                "changePercent": round(change_pct, 3),
                "marketCap": market_cap,
                "marketCapBillions": round(market_cap / 1_000_000_000.0, 2),
                "marketTime": quote_row.get("regularMarketTime"),
            })

        sector_change = weighted_change_sum / sector_market_cap if sector_market_cap > 0 else 0.0
        total_market_cap += sector_market_cap

        sectors.append({
            "name": sector_name,
            "changePercent": round(sector_change, 3),
            "marketCap": sector_market_cap,
            "marketCapBillions": round(sector_market_cap / 1_000_000_000.0, 2),
            "stocks": sorted(stocks, key=lambda item: item.get("marketCap", 0), reverse=True),
        })

    sectors = sorted(sectors, key=lambda item: item.get("marketCap", 0), reverse=True)
    all_stocks = [stock for sector in sectors for stock in sector.get("stocks", [])]
    gainers = len([stock for stock in all_stocks if to_float(stock.get("changePercent")) > 0])
    losers = len([stock for stock in all_stocks if to_float(stock.get("changePercent")) < 0])
    neutral = max(0, len(all_stocks) - gainers - losers)

    total_cap = max(sum(to_float(stock.get("marketCap")) for stock in all_stocks), 1)
    overall_change = sum(to_float(stock.get("changePercent")) * to_float(stock.get("marketCap")) for stock in all_stocks) / total_cap

    return {
        "eventType": "SP500_HEATMAP",
        "source": "yahoo_quote_spark_chart_or_stooq_plus_static_cap_weights",
        "note": "Free quote source. Data may be delayed depending on exchange/vendor rules. Tile size uses static approximate market-cap weights when live market cap is unavailable.",
        "isLiveSnapshot": True,
        "createdAt": now_iso(),
        "count": len(all_stocks),
        "sectorCount": len(sectors),
        "overallChangePercent": round(overall_change, 3),
        "gainers": gainers,
        "losers": losers,
        "neutral": neutral,
        "totalMarketCapBillions": round(total_market_cap / 1_000_000_000.0, 2),
        "sectors": sectors,
    }


# ─────────────────────────────────────────────────────────────────────────────
# TICKER NEWS FEED — FREE RSS FALLBACK + OPTIONAL ALPHA VANTAGE
# ─────────────────────────────────────────────────────────────────────────────

NEWS_BULLISH_WORDS = [
    "beats", "beat", "surge", "surges", "rally", "rallies", "gain", "gains", "higher",
    "upgrade", "upgraded", "bullish", "strong", "record", "growth", "profit", "profits",
    "rebound", "breakout", "optimism", "buy", "outperform", "raises", "raised",
]

NEWS_BEARISH_WORDS = [
    "misses", "miss", "falls", "fall", "drops", "drop", "plunge", "plunges", "lower",
    "downgrade", "downgraded", "bearish", "weak", "loss", "losses", "lawsuit", "probe",
    "investigation", "warning", "cuts", "cut", "sell", "underperform", "risk", "slump",
    "crash", "recession", "inflation", "default", "layoffs",
]


def normalize_news_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)

    if normalized in {"BTCUSD", "BTCUSDT", "XBTUSD"}:
        return "BTC-USD"

    if normalized in {"ETHUSD", "ETHUSDT"}:
        return "ETH-USD"

    if normalized in {"MES1", "MES1!", "ES1", "ES1!", "ES", "MES", "SPX", "SPX500"}:
        return "SPY"

    if normalized in {"NQ1", "NQ1!", "NQ", "MNQ"}:
        return "QQQ"

    if normalized in {"RTY1", "RTY1!", "RTY", "M2K"}:
        return "IWM"

    if normalized.endswith("!"):
        return normalized.replace("!", "")

    return normalized


def news_category_for_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)
    if normalized in {"BTCUSD", "BTCUSDT", "XBTUSD", "ETHUSD", "ETHUSDT"}:
        return "crypto"
    if normalized in {"MES1", "MES1!", "ES1", "ES1!", "ES", "MES", "SPX", "SPX500", "SPY", "QQQ", "IWM"}:
        return "market"
    return "stock"


def score_news_sentiment(title: str, summary: str = "") -> Dict[str, Any]:
    text = f"{title} {summary}".lower()
    bullish = sum(1 for word in NEWS_BULLISH_WORDS if word in text)
    bearish = sum(1 for word in NEWS_BEARISH_WORDS if word in text)

    raw_score = bullish - bearish

    if raw_score > 0:
        signal = "BULLISH"
        score = min(100, 55 + raw_score * 10)
    elif raw_score < 0:
        signal = "BEARISH"
        score = max(0, 45 + raw_score * 10)
    else:
        signal = "NEUTRAL"
        score = 50

    return {
        "signal": signal,
        "score": score,
        "bullishHits": bullish,
        "bearishHits": bearish,
    }


def parse_datetime_to_iso(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return now_iso()

    formats = [
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%Y%m%dT%H%M%S",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S%z",
    ]

    for fmt in formats:
        try:
            parsed = datetime.strptime(raw, fmt)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).isoformat()
        except Exception:
            pass

    return now_iso()


def fetch_yahoo_rss_news(symbol: str, limit: int = 10) -> List[Dict[str, Any]]:
    news_symbol = normalize_news_symbol(symbol)
    encoded_symbol = quote(news_symbol)
    url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={encoded_symbol}&region=US&lang=en-US"
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; MARKETBOS-Dashboard/1.0)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
    }

    text = http_get_text_or_none(url, headers=headers, provider="Yahoo Finance RSS")
    if not text:
        return []

    try:
        root = ET.fromstring(text)
    except Exception as error:
        print(f"[Ticker News] Yahoo RSS parse failed: {error}")
        return []

    articles: List[Dict[str, Any]] = []

    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        published = (item.findtext("pubDate") or "").strip()
        description = (item.findtext("description") or "").strip()

        if not title:
            continue

        sentiment = score_news_sentiment(title, description)

        articles.append({
            "title": title,
            "summary": description,
            "url": link,
            "source": "Yahoo Finance",
            "publishedAt": parse_datetime_to_iso(published),
            "tickers": [news_symbol],
            "sentiment": sentiment["signal"],
            "sentimentScore": sentiment["score"],
            "bullishHits": sentiment["bullishHits"],
            "bearishHits": sentiment["bearishHits"],
        })

        if len(articles) >= limit:
            break

    return articles


def fetch_alpha_vantage_news(symbol: str, limit: int = 10) -> List[Dict[str, Any]]:
    api_key = os.getenv("ALPHA_VANTAGE_API_KEY", "").strip()
    if not api_key:
        return []

    news_symbol = normalize_news_symbol(symbol)

    # Alpha Vantage uses CRYPTO:BTC for BTC; stocks/ETFs use ticker directly.
    alpha_ticker = "CRYPTO:BTC" if news_symbol == "BTC-USD" else "CRYPTO:ETH" if news_symbol == "ETH-USD" else news_symbol

    params = urlencode({
        "function": "NEWS_SENTIMENT",
        "tickers": alpha_ticker,
        "limit": str(max(1, min(int(limit or 10), 50))),
        "apikey": api_key,
    })

    url = f"https://www.alphavantage.co/query?{params}"
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; MARKETBOS-Dashboard/1.0)",
        "Accept": "application/json",
    }

    data = http_get_json_or_none(url, headers=headers, provider="Alpha Vantage news")
    if not isinstance(data, dict):
        return []

    feed = data.get("feed", [])
    if not isinstance(feed, list):
        return []

    articles: List[Dict[str, Any]] = []

    for item in feed[:max(1, min(int(limit or 10), 50))]:
        if not isinstance(item, dict):
            continue

        title = str(item.get("title") or "").strip()
        if not title:
            continue

        ticker_sentiment = item.get("ticker_sentiment", [])
        ticker_symbols = []
        if isinstance(ticker_sentiment, list):
            ticker_symbols = [
                str(row.get("ticker") or "").strip()
                for row in ticker_sentiment
                if isinstance(row, dict) and str(row.get("ticker") or "").strip()
            ]

        raw_label = str(item.get("overall_sentiment_label") or "").upper()
        raw_score = to_float(item.get("overall_sentiment_score"), 0.0)

        if "BULL" in raw_label:
            sentiment = "BULLISH"
        elif "BEAR" in raw_label:
            sentiment = "BEARISH"
        else:
            sentiment = "NEUTRAL"

        sentiment_score = clamp(50 + raw_score * 50, 0, 100)

        articles.append({
            "title": title,
            "summary": str(item.get("summary") or "").strip(),
            "url": str(item.get("url") or "").strip(),
            "source": str(item.get("source") or "Alpha Vantage").strip(),
            "publishedAt": parse_datetime_to_iso(str(item.get("time_published") or "")),
            "tickers": ticker_symbols[:8] or [news_symbol],
            "sentiment": sentiment,
            "sentimentScore": round(sentiment_score, 2),
            "bullishHits": 0,
            "bearishHits": 0,
        })

    return articles


def build_ticker_news_payload(symbol: str, limit: int = 10) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    news_symbol = normalize_news_symbol(normalized_symbol)
    safe_limit = max(1, min(int(limit or 10), 25))

    source = "yahoo_finance_rss"
    articles = fetch_alpha_vantage_news(normalized_symbol, safe_limit)

    if articles:
        source = "alpha_vantage_news_sentiment"
    else:
        articles = fetch_yahoo_rss_news(normalized_symbol, safe_limit)

    bullish = len([item for item in articles if str(item.get("sentiment")) == "BULLISH"])
    bearish = len([item for item in articles if str(item.get("sentiment")) == "BEARISH"])
    neutral = max(0, len(articles) - bullish - bearish)

    if articles:
        news_score = round(sum(to_float(item.get("sentimentScore"), 50) for item in articles) / len(articles), 2)
    else:
        news_score = 50.0

    if news_score >= 60:
        status = "Bullish News"
    elif news_score <= 40:
        status = "Bearish News"
    else:
        status = "Neutral News"

    return {
        "eventType": "TICKER_NEWS_FEED",
        "symbol": normalized_symbol,
        "newsSymbol": news_symbol,
        "category": news_category_for_symbol(normalized_symbol),
        "source": source,
        "createdAt": now_iso(),
        "count": len(articles),
        "limit": safe_limit,
        "newsScore": news_score,
        "status": status,
        "bullish": bullish,
        "bearish": bearish,
        "neutral": neutral,
        "articles": articles,
    }

# ─────────────────────────────────────────────────────────────────────────────
# BASIC ROUTES
# ─────────────────────────────────────────────────────────────────────────────





@app.get("/api/ticker-news")
def ticker_news(symbol: str = "SPY", limit: int = 10) -> Dict[str, Any]:
    return build_ticker_news_payload(symbol, limit)

@app.get("/api/sp500-heatmap")
def sp500_heatmap() -> Dict[str, Any]:
    return build_sp500_heatmap_payload()

@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "Trading Intelligence Dashboard API",
        "engine": "main_v17_python_smc_alphax_ghost_overlays",
        "endpoints": [
            "/api/latest-signal",
            "/api/recent-signals",
            "/api/recent-candles",
            "/api/historical-candles",
            "/api/candles",
            "/api/merged-candles",
            "/api/live-candle",
            "/api/live-price",
            "/api/provider-debug",
            "/api/engine-state",
            "/api/latest-sentiment",
            "/webhook/tradingview",
        ],
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "time": now_iso(),
        "alpacaKeyPresent": bool(ALPACA_API_KEY),
        "alpacaSecretPresent": bool(ALPACA_SECRET_KEY),
        "insightsentryKeyPresent": bool(INSIGHTSENTRY_API_KEY),
        "insightsentryHost": INSIGHTSENTRY_HOST,
    }


# ─────────────────────────────────────────────────────────────────────────────
# API ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/latest-signal")
def latest_signal() -> Dict[str, Any]:
    return LATEST_SIGNAL or {
        "eventType": "LATEST_SIGNAL",
        "status": "Waiting",
        "symbol": "BTCUSD",
        "timeframe": "1m",
        "signal": "NEUTRAL",
        "confidence": 0,
        "bullScore": 50,
        "bearScore": 50,
        "netBias": 0,
        "price": 0,
        "createdAt": now_iso(),
        "warnings": ["No webhook received yet"],
    }


@app.get("/api/recent-signals")
def recent_signals(limit: int = 50) -> Dict[str, Any]:
    safe_limit = max(1, min(int(limit or 50), 200))
    return {
        "count": len(RECENT_SIGNALS[-safe_limit:]),
        "signals": RECENT_SIGNALS[-safe_limit:],
    }


@app.get("/api/recent-candles")
def recent_candles(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 300) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 300), 5000))
    candles = get_live_recent_candles(normalized_symbol, normalized_timeframe)[-safe_limit:]

    return {
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "count": len(candles),
        "candles": candles,
        "source": "recent_candles",
        "provider": "tradingview_webhook",
    }


@app.get("/api/historical-candles")
def historical_candles(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 500) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))
    candles = fetch_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)
    provider = candles[-1].get("provider") if candles else None

    return {
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "count": len(candles),
        "candles": candles,
        "source": "historical_candle_route",
        "provider": provider,
    }


@app.get("/api/candles")
def candles(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 500) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))
    merged = get_dashboard_candles(normalized_symbol, normalized_timeframe, safe_limit)
    provider = merged[-1].get("provider") if merged else None

    return {
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "count": len(merged),
        "candles": merged,
        "source": "dashboard_merged_candles",
        "provider": provider,
    }


@app.get("/api/merged-candles")
def merged_candles(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 500) -> Dict[str, Any]:
    return candles(symbol=symbol, timeframe=timeframe, limit=limit)


@app.get("/api/live-candle")
def live_candle(symbol: str = "BTCUSD", timeframe: str = "1m") -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    live = get_live_recent_candles(normalized_symbol, normalized_timeframe)
    latest = live[-1] if live else None

    if latest is None:
        live_price = get_live_price_payload(normalized_symbol, normalized_timeframe)
        if to_float(live_price.get("price"), 0) > 0:
            bucket_epoch = int(live_price.get("bucketEpoch") or floor_epoch_to_timeframe(to_epoch_seconds(live_price.get("epoch")), normalized_timeframe))
            price = to_float(live_price.get("price"))
            latest = {
                "time": format_bar_time(bucket_epoch),
                "timestamp": format_bar_time(bucket_epoch),
                "epoch": bucket_epoch,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "volume": 0,
                "symbol": normalized_symbol,
                "timeframe": normalized_timeframe,
                "createdAt": now_iso(),
                "provider": live_price.get("provider"),
                "source": live_price.get("source"),
            }

    return {
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "latest": latest,
        "candle": latest,
        "count": len(live),
        "source": "live_candle",
    }


@app.get("/api/live-price")
def live_price(symbol: str = "BTCUSD", timeframe: str = "1m") -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    return get_live_price_payload(normalized_symbol, normalized_timeframe)


@app.get("/api/latest-sentiment")
def latest_sentiment(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 500) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(500, min(int(limit or 500), 5000))

    candles, debug = get_sentiment_candles(normalized_symbol, normalized_timeframe, safe_limit)
    sentiment = calculate_latest_sentiment(candles)

    sentiment.update({
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "count": len(candles),
        "createdAt": now_iso(),
        "debug": debug,
    })

    return sentiment


@app.get("/api/engine-state")
def engine_state(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 500) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    candles, sentiment_debug = get_sentiment_candles(normalized_symbol, normalized_timeframe, max(500, min(int(limit or 500), 5000)))
    sentiment = calculate_latest_sentiment(candles)
    sentiment["debug"] = sentiment_debug
    ghosts = build_python_ghost_candles(candles, 3)

    return {
        "eventType": "ENGINE_STATE",
        "status": "Live" if candles else "Waiting",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "price": to_float(candles[-1].get("close")) if candles else 0,
        "candlesCount": len(candles),
        "sentiment": sentiment,
        "ghostCandles": ghosts,
        "chartOverlays": build_python_chart_overlays(candles, ghosts),
        "sentimentDebug": sentiment.get("debug", {}),
        "createdAt": now_iso(),
    }


@app.get("/api/provider-debug")
def provider_debug(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 20) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 20), 100))
    debug: Dict[str, Any] = {
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "alpacaKeyPresent": bool(ALPACA_API_KEY),
        "insightsentryKeyPresent": bool(INSIGHTSENTRY_API_KEY),
        "insightsentryHost": INSIGHTSENTRY_HOST,
        "tests": {},
    }

    if is_futures_symbol(normalized_symbol):
        api_symbol = to_insightsentry_symbol(normalized_symbol)
        urls = build_insightsentry_urls(api_symbol, normalized_timeframe, safe_limit)
        data = http_get_json_or_none(urls[0], headers=insightsentry_headers(), provider="InsightSentry")
        bars = extract_insightsentry_bars(data)
        parsed = [
            candle
            for candle in (normalize_insightsentry_bar(bar, normalized_symbol, normalized_timeframe) for bar in bars)
            if candle is not None
        ]
        parsed = merge_candles_by_time(parsed)
        debug["tests"]["insightsentry"] = {
            "apiSymbol": api_symbol,
            "urlWithoutKey": urls[0],
            "rawBarsCount": len(bars),
            "parsedCount": len(parsed),
            "spacingOk": candles_match_requested_timeframe(parsed, normalized_timeframe),
            "sample": parsed[-5:],
        }
    else:
        try:
            parsed = fetch_alpaca_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)
        except Exception as error:
            parsed = []
            debug["tests"]["alpacaError"] = str(error)
        debug["tests"]["alpaca"] = {
            "parsedCount": len(parsed),
            "sample": parsed[-5:],
        }

    return debug


# ─────────────────────────────────────────────────────────────────────────────
# WEBHOOK ROUTE
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/webhook/tradingview")
async def webhook_tradingview(request: FastAPIRequest) -> Dict[str, Any]:
    global LATEST_SIGNAL, RECENT_SIGNALS, RECENT_CANDLES

    try:
        raw_payload = await request.json()
    except Exception:
        try:
            text = (await request.body()).decode("utf-8")
            raw_payload = json.loads(text)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON payload")

    if not isinstance(raw_payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be an object")

    secret = raw_payload.get("secret")
    if DASHBOARD_SECRET and secret not in {DASHBOARD_SECRET, None, ""}:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

    try:
        TradingViewPayload(**raw_payload)
    except Exception:
        # Keep accepting loose TradingView payloads while still using the model above as documentation.
        pass

    payload = sanitize_payload(raw_payload)
    LATEST_SIGNAL = payload
    RECENT_SIGNALS.append(payload)
    RECENT_SIGNALS = RECENT_SIGNALS[-MAX_RECENT_SIGNALS:]

    candle = candle_from_payload(payload)
    if candle is not None:
        RECENT_CANDLES.append(candle)
        RECENT_CANDLES = RECENT_CANDLES[-MAX_RECENT_CANDLES:]

    return {
        "ok": True,
        "received": True,
        "symbol": payload.get("symbol"),
        "timeframe": payload.get("timeframe"),
        "storedSignals": len(RECENT_SIGNALS),
        "storedCandles": len(RECENT_CANDLES),
        "createdAt": now_iso(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# LOCAL ENTRYPOINT
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
