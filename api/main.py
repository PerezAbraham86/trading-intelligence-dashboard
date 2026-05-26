from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from fastapi import FastAPI, HTTPException, Request as FastAPIRequest
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    from trading_engine import run_phase1_engine
except Exception:
    run_phase1_engine = None

try:
    import yfinance as yf
except Exception:
    yf = None


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
DASHBOARD_SECRET = os.getenv("DASHBOARD_SECRET", "my_trading_secret_123")

# RapidAPI / InsightSentry
# Set this in Render:
# INSIGHTSENTRY_API_KEY=your_rapidapi_key
# INSIGHTSENTRY_HOST=insightsentry.p.rapidapi.com
INSIGHTSENTRY_API_KEY = (
    os.getenv("INSIGHTSENTRY_API_KEY", "")
    or os.getenv("RAPIDAPI_KEY", "")
    or os.getenv("X_RAPIDAPI_KEY", "")
)
INSIGHTSENTRY_HOST = os.getenv("INSIGHTSENTRY_HOST", "insightsentry.p.rapidapi.com")
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

    if raw in {"BTCUSD", "BTC/USD", "XBTUSD"}:
        return "BTCUSD"
    if raw in {"ETHUSD", "ETH/USD"}:
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
        "3": "3m", "3m": "3m", "3min": "3m",
        "5": "5m", "5m": "5m", "5min": "5m",
        "15": "15m", "15m": "15m", "15min": "15m",
        "30": "30m", "30m": "30m", "30min": "30m",
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
        "15m": "15Min",
        "30m": "30Min",
        "1h": "1Hour",
        "2h": "2Hour",
        "4h": "4Hour",
        "1d": "1Day",
        "1w": "1Week",
    }
    return mapping.get(normalize_timeframe(timeframe), "1Min")


def yfinance_interval(timeframe: str) -> str:
    mapping = {
        "1m": "1m",
        "3m": "2m",
        "5m": "5m",
        "15m": "15m",
        "30m": "30m",
        "1h": "60m",
        "2h": "60m",
        "4h": "60m",
        "1d": "1d",
        "1w": "1wk",
    }
    return mapping.get(normalize_timeframe(timeframe), "1m")


def yfinance_period(timeframe: str) -> str:
    tf = normalize_timeframe(timeframe)
    if tf in {"1m", "3m", "5m", "15m", "30m"}:
        return "5d"
    if tf in {"1h", "2h", "4h"}:
        return "60d"
    return "2y"


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


def to_yfinance_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)
    if normalized == "ES1!":
        return "ES=F"
    if normalized == "MES1!":
        return "MES=F"
    if normalized == "BTCUSD":
        return "BTC-USD"
    if normalized == "ETHUSD":
        return "ETH-USD"
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


def resample_candles(candles: List[Dict[str, Any]], target_timeframe: str, limit: int = 300) -> List[Dict[str, Any]]:
    """
    Resample 1m candles into 3m/5m/15m/30m/1h/2h/4h/1d/1w.

    This is the important futures fix:
    InsightSentry currently returns MES/ES reliably on 1m. Some higher futures
    intervals can return blank depending on the endpoint/provider. We fetch 1m
    and aggregate locally so all dashboard timeframes work.
    """
    tf = normalize_timeframe(target_timeframe)
    seconds = timeframe_seconds(tf)

    if seconds <= 60:
        return merge_candles_by_time(candles)[-limit:]

    source = merge_candles_by_time(candles)
    buckets: Dict[int, Dict[str, Any]] = {}

    for candle in source:
        epoch = int(to_epoch_seconds(candle.get("epoch") or candle.get("time") or candle.get("timestamp")))
        if epoch <= 0:
            continue

        bucket_epoch = (epoch // seconds) * seconds
        existing = buckets.get(bucket_epoch)

        if existing is None:
            buckets[bucket_epoch] = {
                "time": format_bar_time(bucket_epoch),
                "timestamp": format_bar_time(bucket_epoch),
                "epoch": float(bucket_epoch),
                "open": to_float(candle.get("open")),
                "high": to_float(candle.get("high")),
                "low": to_float(candle.get("low")),
                "close": to_float(candle.get("close")),
                "volume": to_float(candle.get("volume")),
                "symbol": normalize_symbol(str(candle.get("symbol") or "")),
                "timeframe": tf,
                "createdAt": now_iso(),
                "provider": f"{candle.get('provider', 'insightsentry')}_resampled_from_1m",
            }
        else:
            existing["high"] = max(to_float(existing.get("high")), to_float(candle.get("high")))
            existing["low"] = min(to_float(existing.get("low")), to_float(candle.get("low")))
            existing["close"] = to_float(candle.get("close"))
            existing["volume"] = to_float(existing.get("volume")) + to_float(candle.get("volume"))

    return sorted(buckets.values(), key=lambda item: to_epoch_seconds(item.get("epoch")))[-limit:]


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
        raise HTTPException(status_code=500, detail="Missing INSIGHTSENTRY_API_KEY or RAPIDAPI_KEY")
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
    except Exception:
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


def normalize_yfinance_row(index_value: Any, row: Any, symbol: str, timeframe: str) -> Optional[Dict[str, Any]]:
    try:
        open_value = row.get("Open") if hasattr(row, "get") else row["Open"]
        high_value = row.get("High") if hasattr(row, "get") else row["High"]
        low_value = row.get("Low") if hasattr(row, "get") else row["Low"]
        close_value = row.get("Close") if hasattr(row, "get") else row["Close"]
        volume_value = row.get("Volume", 0) if hasattr(row, "get") else row["Volume"]
    except Exception:
        return None

    if any(value is None for value in [open_value, high_value, low_value, close_value]):
        return None

    formatted_time = format_bar_time(index_value.to_pydatetime() if hasattr(index_value, "to_pydatetime") else index_value)

    candle = {
        "time": formatted_time,
        "timestamp": formatted_time,
        "epoch": to_epoch_seconds(formatted_time),
        "open": to_float(open_value),
        "high": to_float(high_value),
        "low": to_float(low_value),
        "close": to_float(close_value),
        "volume": to_float(volume_value),
        "symbol": normalize_symbol(symbol),
        "timeframe": normalize_timeframe(timeframe),
        "createdAt": now_iso(),
        "provider": "yfinance",
    }

    if candle["open"] <= 0 or candle["high"] <= 0 or candle["low"] <= 0 or candle["close"] <= 0:
        return None

    return candle


# ─────────────────────────────────────────────────────────────────────────────
# INSIGHTSENTRY HELPERS
# ─────────────────────────────────────────────────────────────────────────────

INSIGHTSENTRY_SYMBOL_MAP = {
    "MES": "CME_MINI:MES1!",
    "MES1": "CME_MINI:MES1!",
    "MES1!": "CME_MINI:MES1!",
    "/MES": "CME_MINI:MES1!",
    "MES2": "CME_MINI:MES2!",
    "MES2!": "CME_MINI:MES2!",

    "ES": "CME_MINI:ES1!",
    "ES1": "CME_MINI:ES1!",
    "ES1!": "CME_MINI:ES1!",
    "/ES": "CME_MINI:ES1!",
    "ES2": "CME_MINI:ES2!",
    "ES2!": "CME_MINI:ES2!",

    "SPY": "SPY",
    "BTCUSD": "BTCUSD",
    "ETHUSD": "ETHUSD",
}


def to_insightsentry_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)
    return INSIGHTSENTRY_SYMBOL_MAP.get(normalized, normalized)


def insightsentry_interval_candidates(timeframe: str) -> List[str]:
    tf = normalize_timeframe(timeframe)

    mapping = {
        "1m": ["1min", "1m", "1"],
        "3m": ["3min", "3m", "3"],
        "5m": ["5min", "5m", "5"],
        "15m": ["15min", "15m", "15"],
        "30m": ["30min", "30m", "30"],
        "1h": ["1h", "60min", "60m", "60"],
        "2h": ["2h", "120min", "120m", "120"],
        "4h": ["4h", "240min", "240m", "240"],
        "1d": ["1day", "1d", "day", "D"],
        "1w": ["1week", "1w", "week", "W"],
    }

    return mapping.get(tf, [tf])


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

    # Sometimes data is returned as {"data": {"CME_MINI:MES1!": [...]}}
    data = payload.get("data")
    if isinstance(data, dict):
        for value in data.values():
            if isinstance(value, list):
                return value

    return []


def normalize_insightsentry_bar(raw: Any, symbol: str, timeframe: str) -> Optional[Dict[str, Any]]:
    if isinstance(raw, list):
        # Common array formats:
        # [time, open, high, low, close, volume]
        # [open, high, low, close, volume, time]
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
    common_params = {
        "symbol": api_symbol,
        "code": api_symbol,
        "interval": api_interval,
        "timeframe": api_interval,
        "limit": limit,
    }

    # Keep the working endpoint first. Additional endpoints are defensive fallbacks
    # for RapidAPI/InsightSentry naming differences.
    return [
        f"{INSIGHTSENTRY_BASE_URL}/v3/symbols/{encoded_path_symbol}/series?{urlencode({'interval': api_interval, 'limit': limit})}",
        f"{INSIGHTSENTRY_BASE_URL}/v3/symbols/{encoded_path_symbol}/time-series?{urlencode({'interval': api_interval, 'limit': limit})}",
        f"{INSIGHTSENTRY_BASE_URL}/v3/time-series?{urlencode({'symbol': api_symbol, 'interval': api_interval, 'limit': limit})}",
        f"{INSIGHTSENTRY_BASE_URL}/v3/ohlcv?{urlencode({'symbol': api_symbol, 'interval': api_interval, 'limit': limit})}",
        f"{INSIGHTSENTRY_BASE_URL}/v3/historical?{urlencode({'symbol': api_symbol, 'interval': api_interval, 'limit': limit})}",
        f"{INSIGHTSENTRY_BASE_URL}/v3/symbols/{encoded_path_symbol}/historical?{urlencode({'interval': api_interval, 'limit': limit})}",
    ]


def fetch_insightsentry_direct_candles(symbol: str, timeframe: str = "1m", limit: int = 300) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    api_symbol = to_insightsentry_symbol(normalized_symbol)
    safe_limit = max(1, min(int(limit or 300), 5000))
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


def fetch_insightsentry_historical_candles(symbol: str, timeframe: str = "1m", limit: int = 300) -> List[Dict[str, Any]]:
    """
    Futures data source for ES/MES.

    Direct timeframe is tried first.
    If ES/MES only returns 1m from InsightSentry, this fetches 1m and locally
    resamples into the requested timeframe. This fixes ES/MES 3m, 5m, 15m,
    30m, 1h, 2h, 4h, 1D, etc.
    """
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 300), 5000))

    direct = fetch_insightsentry_direct_candles(normalized_symbol, normalized_timeframe, safe_limit)
    if direct:
        return direct[-safe_limit:]

    # Futures fallback: fetch 1m then aggregate locally.
    if is_futures_symbol(normalized_symbol) and normalized_timeframe != "1m":
        seconds = timeframe_seconds(normalized_timeframe)
        multiplier = max(1, seconds // 60)
        one_minute_limit = min(5000, max(safe_limit * multiplier + multiplier * 3, safe_limit * 2, 300))
        one_minute = fetch_insightsentry_direct_candles(normalized_symbol, "1m", one_minute_limit)
        if one_minute:
            resampled = resample_candles(one_minute, normalized_timeframe, safe_limit)
            resampled = filter_valid_candles_for_symbol(resampled, normalized_symbol)
            if resampled:
                print(
                    f"[InsightSentry] resampled futures {normalized_symbol} from 1m "
                    f"to {normalized_timeframe}; source={len(one_minute)} output={len(resampled)}"
                )
                return resampled[-safe_limit:]

    return []


# ─────────────────────────────────────────────────────────────────────────────
# CANDLE PROVIDERS
# ─────────────────────────────────────────────────────────────────────────────

def fetch_alpaca_historical_candles(symbol: str, timeframe: str = "1m", limit: int = 300) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    alpaca_tf = alpaca_timeframe(normalized_timeframe)
    safe_limit = max(1, min(int(limit or 300), 5000))
    headers = alpaca_headers()

    if is_crypto_symbol(normalized_symbol):
        slash_symbol = to_alpaca_crypto_symbol(normalized_symbol)
        candidates = [slash_symbol, normalized_symbol]

        for candidate in candidates:
            params = urlencode({"symbols": candidate, "timeframe": alpaca_tf, "limit": safe_limit, "sort": "desc"})
            url = f"{ALPACA_CRYPTO_BASE_URL}/crypto/us/bars?{params}"
            data = http_get_json(url, headers=headers, provider="Alpaca crypto")
            bars_by_symbol = data.get("bars", {}) if isinstance(data, dict) else {}
            bars = bars_by_symbol.get(candidate) or bars_by_symbol.get(slash_symbol) or bars_by_symbol.get(normalized_symbol) or []

            if bars:
                normalized = [normalize_alpaca_bar(bar, normalized_symbol, normalized_timeframe) for bar in bars]
                return merge_candles_by_time(normalized)[-safe_limit:]

        return []

    if normalized_symbol == "SPY":
        request_limit = max(safe_limit, 1000)
        params = urlencode({
            "symbols": normalized_symbol,
            "timeframe": alpaca_tf,
            "limit": min(request_limit, 10000),
            "adjustment": "raw",
            "feed": "iex",
            "sort": "desc",
        })
        url = f"{ALPACA_STOCKS_BASE_URL}/stocks/bars?{params}"
        data = http_get_json(url, headers=headers, provider="Alpaca stock")
        bars_by_symbol = data.get("bars", {}) if isinstance(data, dict) else {}
        bars = bars_by_symbol.get(normalized_symbol, [])
        normalized = [normalize_alpaca_bar(bar, normalized_symbol, normalized_timeframe) for bar in bars]
        return merge_candles_by_time(normalized)[-safe_limit:]

    return []


def fetch_yfinance_historical_candles(symbol: str, timeframe: str = "1m", limit: int = 300) -> List[Dict[str, Any]]:
    if yf is None:
        return []

    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    yf_symbol = to_yfinance_symbol(normalized_symbol)
    interval = yfinance_interval(normalized_timeframe)
    period = yfinance_period(normalized_timeframe)
    safe_limit = max(1, min(int(limit or 300), 5000))

    try:
        ticker = yf.Ticker(yf_symbol)
        frame = ticker.history(period=period, interval=interval, prepost=True, auto_adjust=False)
    except Exception:
        return []

    if frame is None or getattr(frame, "empty", True):
        return []

    candles: List[Dict[str, Any]] = []
    for index_value, row in frame.iterrows():
        candle = normalize_yfinance_row(index_value, row, normalized_symbol, normalized_timeframe)
        if candle is not None:
            candles.append(candle)

    return merge_candles_by_time(candles)[-safe_limit:]


def fetch_historical_candles(symbol: str, timeframe: str = "1m", limit: int = 300) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 300), 5000))

    # Futures are routed to InsightSentry only.
    # If InsightSentry only returns 1m, we resample 1m locally to all higher timeframes.
    if is_futures_symbol(normalized_symbol):
        return fetch_insightsentry_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)

    # SPY: try Alpaca first, then Yahoo fallback.
    if normalized_symbol == "SPY":
        candles: List[Dict[str, Any]] = []
        try:
            candles = fetch_alpaca_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)
        except Exception:
            candles = []
        if candles:
            return candles
        return fetch_yfinance_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)

    # Crypto: keep Alpaca first, then Yahoo fallback.
    if is_crypto_symbol(normalized_symbol):
        candles = []
        try:
            candles = fetch_alpaca_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)
        except Exception:
            candles = []
        if candles:
            return candles
        return fetch_yfinance_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)

    return fetch_yfinance_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)


def get_live_recent_candles(symbol: str, timeframe: str) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    candles = [
        candle for candle in RECENT_CANDLES
        if normalize_symbol(str(candle.get("symbol", ""))) == normalized_symbol
        and normalize_timeframe(str(candle.get("timeframe", ""))) == normalized_timeframe
    ]

    return filter_valid_candles_for_symbol(candles, normalized_symbol)


def get_dashboard_candles(symbol: str, timeframe: str = "1m", limit: int = 300) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 300), 5000))

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


def calculate_latest_sentiment(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    indicators: List[Dict[str, Any]] = []
    if len(candles) < 20:
        return {
            "eventType": "PYTHON_TECHNICAL_SENTIMENT",
            "status": "Waiting",
            "sentiment": 50,
            "sentimentStatus": "Neutral",
            "bearCount": 0,
            "neutralCount": 12,
            "bullCount": 0,
            "bearPct": 0,
            "neutralPct": 100,
            "bullPct": 0,
            "activeCount": 12,
            "indicators": [],
        }

    closes = [to_float(c.get("close")) for c in candles]
    last_close = closes[-1]
    sma_fast = sum(closes[-10:]) / 10
    sma_slow = sum(closes[-20:]) / 20
    momentum = last_close - closes[-6]

    bull = 0
    bear = 0

    checks = [
        ("SMA", last_close > sma_fast),
        ("Structure", sma_fast > sma_slow),
        ("Momentum", momentum > 0),
    ]

    for name, bullish in checks:
        if bullish:
            bull += 1
            state = "BULLISH"
            value = 70
        else:
            bear += 1
            state = "BEARISH"
            value = 30
        indicators.append({"name": name, "status": state, "value": value})

    neutral = max(0, 12 - bull - bear)
    active = bull + bear + neutral
    sentiment = round(((bull + neutral * 0.5) / max(active, 1)) * 100, 2)
    if sentiment >= 60:
        status = "Mostly Bullish"
    elif sentiment <= 40:
        status = "Mostly Bearish"
    else:
        status = "Mostly Neutral"

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
# BASIC ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "Trading Intelligence Dashboard API",
        "engine": "main_v5_insightsentry_futures_all_timeframes",
        "endpoints": [
            "/api/latest-signal",
            "/api/recent-signals",
            "/api/recent-candles",
            "/api/historical-candles",
            "/api/candles",
            "/api/merged-candles",
            "/api/live-candle",
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
        "yfinancePresent": yf is not None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# WEBHOOK
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/webhook/tradingview")
async def tradingview_webhook(request: FastAPIRequest) -> Dict[str, Any]:
    global LATEST_SIGNAL, RECENT_SIGNALS, RECENT_CANDLES

    try:
        raw_payload = await request.json()
    except Exception:
        raw_text = await request.body()
        try:
            raw_payload = json.loads(raw_text.decode("utf-8"))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON payload")

    if not isinstance(raw_payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be a JSON object")

    supplied_secret = raw_payload.get("secret")
    if DASHBOARD_SECRET and supplied_secret and supplied_secret != DASHBOARD_SECRET:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

    payload = sanitize_payload(raw_payload)
    LATEST_SIGNAL = payload

    candle = candle_from_payload(payload)
    if candle is not None:
        RECENT_CANDLES.append(candle)
        RECENT_CANDLES = merge_candles_by_time(RECENT_CANDLES)[-MAX_RECENT_CANDLES:]

    event_type = str(payload.get("eventType") or "").upper()
    if event_type == "TRADE_SIGNAL":
        RECENT_SIGNALS.insert(0, payload)
        RECENT_SIGNALS = RECENT_SIGNALS[:MAX_RECENT_SIGNALS]

    return {
        "ok": True,
        "message": "Webhook received",
        "storedAsLatest": True,
        "storedCandle": candle is not None,
        "storedRecentSignal": event_type == "TRADE_SIGNAL",
        "chartOverlaysPresent": payload.get("chartOverlays") is not None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# DASHBOARD ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/latest-signal")
def latest_signal() -> Dict[str, Any]:
    if LATEST_SIGNAL:
        return LATEST_SIGNAL
    return {
        "eventType": "TRADE_SIGNAL",
        "status": "Live Snapshot",
        "symbol": "BTCUSD",
        "timeframe": "1m",
        "signal": "NEUTRAL",
        "confidence": 6,
        "bullScore": 50,
        "bearScore": 50,
        "netBias": 0,
        "price": 0,
        "createdAt": now_iso(),
        "chartOverlays": None,
        "warnings": ["No webhook received yet"],
    }


@app.get("/api/recent-signals")
def recent_signals(limit: int = 20) -> Dict[str, Any]:
    safe_limit = max(1, min(int(limit or 20), MAX_RECENT_SIGNALS))
    return {"signals": RECENT_SIGNALS[:safe_limit]}


@app.get("/api/recent-candles")
def recent_candles(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 300) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 300), 5000))
    candles = get_dashboard_candles(normalized_symbol, normalized_timeframe, safe_limit)
    return {
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "count": len(candles),
        "candles": candles,
        "source": "dashboard_candle_router",
    }


@app.get("/api/historical-candles")
def historical_candles(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 300) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 300), 5000))
    candles = fetch_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)
    return {
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "count": len(candles),
        "candles": candles,
        "source": "historical_candle_router",
        "provider": candles[-1].get("provider") if candles else None,
    }


@app.get("/api/candles")
def candles(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 300) -> Dict[str, Any]:
    return recent_candles(symbol=symbol, timeframe=timeframe, limit=limit)


@app.get("/api/merged-candles")
def merged_candles(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 300) -> Dict[str, Any]:
    return recent_candles(symbol=symbol, timeframe=timeframe, limit=limit)


@app.get("/api/live-candle")
def live_candle(symbol: str = "BTCUSD", timeframe: str = "1m") -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    candles = get_dashboard_candles(normalized_symbol, normalized_timeframe, 5)
    latest = candles[-1] if candles else None
    return {
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "candle": latest,
        "hasCandle": latest is not None,
        "source": latest.get("provider") if latest else None,
    }


@app.get("/api/provider-debug")
def provider_debug(symbol: str = "MES1!", timeframe: str = "1m", limit: int = 5) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    api_symbol = to_insightsentry_symbol(normalized_symbol)
    safe_limit = max(1, min(int(limit or 5), 5000))

    if is_futures_symbol(normalized_symbol):
        direct = fetch_insightsentry_direct_candles(normalized_symbol, normalized_timeframe, safe_limit)
        resampled = False

        candles = direct
        if not candles and normalized_timeframe != "1m":
            seconds = timeframe_seconds(normalized_timeframe)
            multiplier = max(1, seconds // 60)
            one_minute_limit = min(5000, max(safe_limit * multiplier + multiplier * 3, 300))
            one_minute = fetch_insightsentry_direct_candles(normalized_symbol, "1m", one_minute_limit)
            candles = resample_candles(one_minute, normalized_timeframe, safe_limit) if one_minute else []
            resampled = bool(candles)

        return {
            "provider": "insightsentry",
            "host": INSIGHTSENTRY_HOST,
            "version": "v3",
            "frontendSymbol": symbol,
            "normalizedSymbol": normalized_symbol,
            "apiSymbol": api_symbol,
            "timeframe": normalized_timeframe,
            "resampledFrom1m": resampled,
            "count": len(candles),
            "latest": candles[-1] if candles else None,
            "candles": candles,
        }

    candles = fetch_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)
    return {
        "provider": candles[-1].get("provider") if candles else None,
        "frontendSymbol": symbol,
        "normalizedSymbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "count": len(candles),
        "latest": candles[-1] if candles else None,
        "candles": candles,
    }


@app.get("/api/latest-sentiment")
def latest_sentiment(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 300) -> Dict[str, Any]:
    candles = get_dashboard_candles(symbol, timeframe, limit)
    return calculate_latest_sentiment(candles)


@app.get("/api/engine-state")
def engine_state(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 300) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 300), 5000))
    candles = get_dashboard_candles(normalized_symbol, normalized_timeframe, safe_limit)

    overlay_payload: Dict[str, Any] = empty_overlay_payload()

    if run_phase1_engine is not None and candles:
        try:
            engine_result = run_phase1_engine(candles)
            if isinstance(engine_result, dict):
                overlay_payload.update(engine_result)
        except Exception as error:
            overlay_payload["engineError"] = str(error)

    ghost_candles = build_python_ghost_candles(candles, 3)
    sentiment = calculate_latest_sentiment(candles)
    latest = candles[-1] if candles else {}

    return {
        "engine": "main_v5_insightsentry_futures_all_timeframes",
        "phase": "insightsentry_futures_with_1m_resample_fallback",
        "status": "Live" if candles else "Waiting",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "source": {
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "provider": latest.get("provider") if latest else None,
            "count": len(candles),
        },
        "price": latest.get("close", 0),
        "candles": candles,
        "heikinAshiCandles": build_heikin_ashi_candles(candles) if candles else [],
        "ghostCandles": ghost_candles,
        "ghostProjections": ghost_candles,
        "projections": ghost_candles,
        "technicalSentiment": sentiment,
        **overlay_payload,
    }
