from __future__ import annotations

import json
import os
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
    Alpaca crypto can return fewer bars if no start window is supplied.
    Use a wide enough UTC start window so BTCUSD returns close to the requested
    500 candles for every dashboard timeframe.
    """
    tf = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))
    seconds = timeframe_seconds(tf)

    # Need at least limit * timeframe seconds, plus a provider/session buffer.
    # Crypto trades 24/7, but the buffer helps avoid short pages and provider gaps.
    required_seconds = safe_limit * max(seconds, 60)
    buffer_seconds = max(required_seconds * 3, 2 * 24 * 60 * 60)

    # Wider minimum windows for higher timeframes.
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
                "sort": "asc",
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
                    return candles

        return []

    if normalized_symbol == "SPY":
        request_limit = max(safe_limit, 1000)
        params = urlencode({
            "symbols": normalized_symbol,
            "timeframe": alpaca_tf,
            "limit": min(request_limit, 10000),
            "start": start_time,
            "adjustment": "raw",
            "feed": "iex",
            "sort": "asc",
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
    ha = build_heikin_ashi_candles(candles)
    ha_bull = to_float(ha[-1].get("close")) >= to_float(ha[-1].get("open"))

    checks = [
        ("SMA", last_close > sma_fast),
        ("Structure", sma_fast > sma_slow),
        ("Momentum", momentum > 0),
        ("Heikin Ashi", ha_bull),
    ]

    bull = 0
    bear = 0
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
        "engine": "main_v7_insightsentry_ohlcv_series_btc_mes",
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

    return {
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "latest": latest,
        "candle": latest,
        "count": len(live),
        "source": "live_candle",
    }


@app.get("/api/latest-sentiment")
def latest_sentiment(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 500) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(30, min(int(limit or 500), 1000))
    candles = get_dashboard_candles(normalized_symbol, normalized_timeframe, safe_limit)
    sentiment = calculate_latest_sentiment(candles)
    sentiment.update({
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "count": len(candles),
        "createdAt": now_iso(),
    })
    return sentiment


@app.get("/api/engine-state")
def engine_state(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 500) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    candles = get_dashboard_candles(normalized_symbol, normalized_timeframe, max(50, min(int(limit or 500), 1000)))
    sentiment = calculate_latest_sentiment(candles)
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
        "chartOverlays": empty_overlay_payload(),
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
