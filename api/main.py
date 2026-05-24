from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from fastapi import FastAPI, HTTPException, Request as FastAPIRequest
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from trading_engine import run_phase1_engine


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

ALPACA_STOCKS_BASE_URL = "https://data.alpaca.markets/v2"
ALPACA_CRYPTO_BASE_URL = "https://data.alpaca.markets/v1beta3"


# ─────────────────────────────────────────────────────────────────────────────
# IN-MEMORY STATE
# Render can restart, so this is not permanent storage.
# It is enough for current live dashboard state.
# ─────────────────────────────────────────────────────────────────────────────

LATEST_SIGNAL: Dict[str, Any] = {}
RECENT_SIGNALS: List[Dict[str, Any]] = []
RECENT_CANDLES: List[Dict[str, Any]] = []
LIVE_CANDLES: Dict[str, Dict[str, Any]] = {}

MAX_RECENT_SIGNALS = 50
MAX_RECENT_CANDLES = 1000


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
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_symbol(symbol: str) -> str:
    raw = (symbol or "").upper().strip()

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

    if raw in ["BTCUSD", "BTC/USD", "XBTUSD"]:
        return "BTCUSD"
    if raw in ["ETHUSD", "ETH/USD"]:
        return "ETHUSD"

    return raw


def normalize_timeframe(timeframe: str) -> str:
    tf = str(timeframe or "1m").strip().lower()

    mapping = {
        "1": "1m",
        "1m": "1m",
        "3": "3m",
        "3m": "3m",
        "5": "5m",
        "5m": "5m",
        "15": "15m",
        "15m": "15m",
        "30": "30m",
        "30m": "30m",
        "60": "1h",
        "1h": "1h",
        "120": "2h",
        "2h": "2h",
        "240": "4h",
        "4h": "4h",
        "d": "1d",
        "1d": "1d",
        "w": "1w",
        "1w": "1w",
    }

    return mapping.get(tf, tf)


def alpaca_timeframe(timeframe: str) -> str:
    tf = normalize_timeframe(timeframe)

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

    return mapping.get(tf, "1Min")


def is_crypto_symbol(symbol: str) -> bool:
    normalized = normalize_symbol(symbol)
    return normalized in {"BTCUSD", "ETHUSD"}


def to_alpaca_crypto_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)

    if normalized == "BTCUSD":
        return "BTC/USD"
    if normalized == "ETHUSD":
        return "ETH/USD"

    return normalized


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


def to_epoch_seconds(value: Any) -> float:
    """
    Converts every time format we use into sortable epoch seconds.

    Fixes BTCUSD engine errors caused by mixing:
    - Alpaca ISO strings: 2026-05-24T...
    - TradingView/live unix seconds: 1779...
    - TradingView/live unix milliseconds: 1779...000
    """

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
        iso_text = text.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(iso_text)

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)

        return parsed.timestamp()
    except Exception:
        return 0.0


def format_bar_time(value: Any) -> Any:
    if value is None:
        return int(time.time())

    # Keep ISO strings as ISO strings because Alpaca sends them that way.
    # The sort key now handles both ISO strings and unix times safely.
    if isinstance(value, str) and ("T" in value or "-" in value):
        return value

    try:
        numeric = float(value)
        if numeric > 1000000000000:
            return int(numeric / 1000)
        return int(numeric)
    except Exception:
        return value


def candle_from_payload(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    required = ["open", "high", "low", "close"]
    if not all(payload.get(key) is not None for key in required):
        return None

    symbol = normalize_symbol(str(payload.get("symbol") or ""))
    timeframe = normalize_timeframe(str(payload.get("timeframe") or "1m"))

    candle_time = (
        payload.get("time")
        or payload.get("timestamp")
        or payload.get("createdAt")
        or int(time.time())
    )

    normalized_time = format_bar_time(candle_time)

    return {
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
    }


def merge_candles_by_time(candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: Dict[str, Dict[str, Any]] = {}

    for candle in candles:
        symbol = normalize_symbol(str(candle.get("symbol", "")))
        timeframe = normalize_timeframe(str(candle.get("timeframe", "")))
        epoch = to_epoch_seconds(candle.get("time") or candle.get("timestamp") or candle.get("createdAt"))

        if epoch <= 0:
            raw_time = str(candle.get("time") or candle.get("timestamp") or candle.get("createdAt") or "")
            key = f"{symbol}:{timeframe}:{raw_time}"
        else:
            # Round because live candles and Alpaca candles can differ by milliseconds.
            key = f"{symbol}:{timeframe}:{int(epoch)}"

        next_candle = dict(candle)
        next_candle["epoch"] = epoch
        merged[key] = next_candle

    return sorted(merged.values(), key=lambda item: to_epoch_seconds(item.get("epoch") or item.get("time")))


def sanitize_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(payload)

    normalized["symbol"] = normalize_symbol(str(normalized.get("symbol") or ""))
    normalized["timeframe"] = normalize_timeframe(str(normalized.get("timeframe") or "1m"))
    normalized["signal"] = str(normalized.get("signal") or "NEUTRAL")
    normalized["confidence"] = to_float(normalized.get("confidence"), 0)
    normalized["bullScore"] = to_float(normalized.get("bullScore"), 50)
    normalized["bearScore"] = to_float(normalized.get("bearScore"), 50)
    normalized["netBias"] = to_float(
        normalized.get("netBias"),
        normalized["bullScore"] - normalized["bearScore"],
    )
    normalized["price"] = to_float(
        normalized.get("price"),
        to_float(normalized.get("close"), 0),
    )
    normalized["createdAt"] = normalized.get("createdAt") or now_iso()

    if "chartOverlays" not in normalized:
        normalized["chartOverlays"] = None

    if not isinstance(normalized.get("warnings"), list):
        normalized["warnings"] = []

    return normalized


def alpaca_headers() -> Dict[str, str]:
    if not ALPACA_API_KEY or not ALPACA_SECRET_KEY:
        raise HTTPException(
            status_code=500,
            detail="Missing Alpaca environment variables: ALPACA_API_KEY and/or ALPACA_SECRET_KEY",
        )

    return {
        "APCA-API-KEY-ID": ALPACA_API_KEY,
        "APCA-API-SECRET-KEY": ALPACA_SECRET_KEY,
    }


def http_get_json(url: str, headers: Optional[Dict[str, str]] = None) -> Any:
    request = Request(url, headers=headers or {})

    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
            return json.loads(body)
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="ignore")
        raise HTTPException(
            status_code=error.code,
            detail=f"Alpaca request failed: {body or error.reason}",
        )
    except URLError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Alpaca connection failed: {error.reason}",
        )
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Request failed: {str(error)}",
        )


def normalize_alpaca_bar(raw: Dict[str, Any], symbol: str, timeframe: str) -> Dict[str, Any]:
    raw_time = raw.get("t")
    epoch = to_epoch_seconds(raw_time)

    return {
        "time": raw_time,
        "timestamp": raw_time,
        "epoch": epoch,
        "open": to_float(raw.get("o")),
        "high": to_float(raw.get("h")),
        "low": to_float(raw.get("l")),
        "close": to_float(raw.get("c")),
        "volume": to_float(raw.get("v")),
        "symbol": normalize_symbol(symbol),
        "timeframe": normalize_timeframe(timeframe),
        "createdAt": now_iso(),
    }


def fetch_alpaca_historical_candles(
    symbol: str,
    timeframe: str = "1m",
    limit: int = 300,
) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    alpaca_tf = alpaca_timeframe(normalized_timeframe)
    safe_limit = max(1, min(int(limit or 300), 1000))

    headers = alpaca_headers()

    if is_crypto_symbol(normalized_symbol):
        slash_symbol = to_alpaca_crypto_symbol(normalized_symbol)

        symbol_candidates = [
            slash_symbol,       # BTC/USD
            normalized_symbol,  # BTCUSD
        ]

        for candidate_symbol in symbol_candidates:
            params = urlencode(
                {
                    "symbols": candidate_symbol,
                    "timeframe": alpaca_tf,
                    "limit": safe_limit,
                    "sort": "asc",
                }
            )

            url = f"{ALPACA_CRYPTO_BASE_URL}/crypto/us/bars?{params}"
            data = http_get_json(url, headers=headers)

            bars_by_symbol = data.get("bars", {})

            bars = (
                bars_by_symbol.get(candidate_symbol)
                or bars_by_symbol.get(slash_symbol)
                or bars_by_symbol.get(normalized_symbol)
                or []
            )

            if bars:
                return [
                    normalize_alpaca_bar(bar, normalized_symbol, normalized_timeframe)
                    for bar in bars
                ]

        return []

    # Stocks/ETFs. This is for SPY and similar.
    # Futures like ES1!/MES1! are not covered by Alpaca data.
    params = urlencode(
        {
            "symbols": normalized_symbol,
            "timeframe": alpaca_tf,
            "limit": safe_limit,
            "adjustment": "raw",
            "feed": "iex",
            "sort": "asc",
        }
    )

    url = f"{ALPACA_STOCKS_BASE_URL}/stocks/bars?{params}"
    data = http_get_json(url, headers=headers)

    bars_by_symbol = data.get("bars", {})
    bars = bars_by_symbol.get(normalized_symbol, [])

    return [
        normalize_alpaca_bar(bar, normalized_symbol, normalized_timeframe)
        for bar in bars
    ]


def get_live_recent_candles(symbol: str, timeframe: str) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    return [
        candle
        for candle in RECENT_CANDLES
        if normalize_symbol(str(candle.get("symbol", ""))) == normalized_symbol
        and normalize_timeframe(str(candle.get("timeframe", ""))) == normalized_timeframe
    ]


# ─────────────────────────────────────────────────────────────────────────────
# LIVE CURRENT CANDLE BUILDER — PHASE 4B / 1-SECOND POLLING
# ─────────────────────────────────────────────────────────────────────────────

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


def candle_bucket_epoch(epoch_seconds: float, timeframe: str) -> int:
    seconds = timeframe_seconds(timeframe)
    return int(epoch_seconds // seconds * seconds)


def pick_latest_candle_source(symbol: str, timeframe: str) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    candidates: List[Dict[str, Any]] = []

    # 1) Prefer newest Alpaca candle/bar when available.
    # This keeps BTCUSD/ETHUSD moving from the provider even if no webhook candle arrives.
    try:
        alpaca_candles = fetch_alpaca_historical_candles(
            normalized_symbol,
            normalized_timeframe,
            limit=2,
        )
        candidates.extend(alpaca_candles)
    except Exception:
        pass

    # 2) Then use recent live webhook candles.
    candidates.extend(get_live_recent_candles(normalized_symbol, normalized_timeframe)[-5:])

    # 3) Then use latest signal price as fallback.
    if LATEST_SIGNAL:
        latest_symbol = normalize_symbol(str(LATEST_SIGNAL.get("symbol") or normalized_symbol))
        latest_timeframe = normalize_timeframe(str(LATEST_SIGNAL.get("timeframe") or normalized_timeframe))

        if latest_symbol == normalized_symbol and latest_timeframe == normalized_timeframe:
            price = to_float(
                LATEST_SIGNAL.get("current"),
                to_float(LATEST_SIGNAL.get("price"), to_float(LATEST_SIGNAL.get("close"), 0.0)),
            )

            if price > 0:
                now_epoch = time.time()
                candidates.append(
                    {
                        "time": int(now_epoch),
                        "timestamp": int(now_epoch),
                        "epoch": now_epoch,
                        "open": price,
                        "high": price,
                        "low": price,
                        "close": price,
                        "volume": to_float(LATEST_SIGNAL.get("volume"), 0.0),
                        "symbol": normalized_symbol,
                        "timeframe": normalized_timeframe,
                        "createdAt": now_iso(),
                        "source": "latest_signal",
                    }
                )

    valid = [
        candidate
        for candidate in candidates
        if to_float(candidate.get("close"), 0.0) > 0
    ]

    if not valid:
        raise HTTPException(
            status_code=404,
            detail=f"No live candle source available for {normalized_symbol} {normalized_timeframe}",
        )

    return sorted(
        valid,
        key=lambda item: to_epoch_seconds(item.get("epoch") or item.get("time") or item.get("timestamp")),
    )[-1]


def update_live_candle_cache(symbol: str, timeframe: str, source: Dict[str, Any]) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    key = f"{normalized_symbol}:{normalized_timeframe}"

    source_epoch = to_epoch_seconds(source.get("epoch") or source.get("time") or source.get("timestamp"))
    if source_epoch <= 0:
        source_epoch = time.time()

    bucket = candle_bucket_epoch(source_epoch, normalized_timeframe)

    price = to_float(source.get("close"), 0.0)
    source_open = to_float(source.get("open"), price)
    source_high = to_float(source.get("high"), price)
    source_low = to_float(source.get("low"), price)
    source_close = to_float(source.get("close"), price)
    source_volume = to_float(source.get("volume"), 0.0)

    cached = LIVE_CANDLES.get(key)

    if not cached or int(cached.get("bucket", 0)) != bucket:
        # New candle bucket. Open should be the first available price for this timeframe.
        live = {
            "time": bucket,
            "timestamp": bucket,
            "epoch": bucket,
            "bucket": bucket,
            "open": source_open if source_open > 0 else source_close,
            "high": max(source_high, source_open, source_close),
            "low": min(source_low, source_open, source_close),
            "close": source_close,
            "volume": source_volume,
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "createdAt": now_iso(),
            "source": source.get("source") or "live_candle_builder",
            "isLive": True,
            "pollingMs": 1000,
        }
    else:
        live = dict(cached)
        live["high"] = max(to_float(live.get("high"), source_close), source_high, source_close)
        live["low"] = min(to_float(live.get("low"), source_close), source_low, source_close)
        live["close"] = source_close
        live["volume"] = max(to_float(live.get("volume"), 0.0), source_volume)
        live["createdAt"] = now_iso()
        live["source"] = source.get("source") or live.get("source") or "live_candle_builder"
        live["isLive"] = True
        live["pollingMs"] = 1000

    LIVE_CANDLES[key] = live
    return live


def get_cached_or_build_live_candle(symbol: str, timeframe: str) -> Optional[Dict[str, Any]]:
    try:
        source = pick_latest_candle_source(symbol, timeframe)
        return update_live_candle_cache(symbol, timeframe, source)
    except HTTPException:
        return None
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# PYTHON GHOST CANDLE ENGINE — PHASE 3X
# ─────────────────────────────────────────────────────────────────────────────

def build_heikin_ashi_candles(candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    ha_candles: List[Dict[str, Any]] = []

    for index, candle in enumerate(candles):
        o = to_float(candle.get("open"))
        h = to_float(candle.get("high"))
        l = to_float(candle.get("low"))
        c = to_float(candle.get("close"))

        ha_close = (o + h + l + c) / 4.0

        if index == 0:
            ha_open = (o + c) / 2.0
        else:
            prev = ha_candles[-1]
            ha_open = (prev["open"] + prev["close"]) / 2.0

        ha_high = max(h, ha_open, ha_close)
        ha_low = min(l, ha_open, ha_close)

        ha_candles.append(
            {
                **candle,
                "open": ha_open,
                "high": ha_high,
                "low": ha_low,
                "close": ha_close,
            }
        )

    return ha_candles


def average_true_range(candles: List[Dict[str, Any]], length: int = 14) -> float:
    if len(candles) < 2:
        return 0.0

    ranges: List[float] = []

    for index in range(max(1, len(candles) - length), len(candles)):
        current = candles[index]
        previous = candles[index - 1]

        high = to_float(current.get("high"))
        low = to_float(current.get("low"))
        previous_close = to_float(previous.get("close"))

        true_range = max(
            high - low,
            abs(high - previous_close),
            abs(low - previous_close),
        )
        ranges.append(true_range)

    return sum(ranges) / len(ranges) if ranges else 0.0


def candle_momentum(candles: List[Dict[str, Any]], lookback: int = 8) -> float:
    if len(candles) < 2:
        return 0.0

    sample = candles[-lookback:]
    if len(sample) < 2:
        return 0.0

    weighted_sum = 0.0
    weight_total = 0.0

    for index in range(1, len(sample)):
        weight = index
        weighted_sum += (to_float(sample[index].get("close")) - to_float(sample[index - 1].get("close"))) * weight
        weight_total += weight

    return weighted_sum / max(weight_total, 1.0)


def extract_levels_from_engine(result: Dict[str, Any], last_close: float) -> Dict[str, List[float]]:
    upside: List[float] = []
    downside: List[float] = []

    def add_level(value: Any) -> None:
        level = to_float(value, 0.0)

        if level <= 0:
            return

        if level > last_close:
            upside.append(level)
        elif level < last_close:
            downside.append(level)

    for zone in result.get("zones", []) or []:
        if not isinstance(zone, dict):
            continue
        add_level(zone.get("top"))
        add_level(zone.get("bottom"))

    for event in result.get("liquidityEvents", []) or []:
        if isinstance(event, dict):
            add_level(event.get("price") or event.get("level"))

    for level in result.get("dlmLevels", []) or []:
        if isinstance(level, dict):
            add_level(level.get("price"))

    return {
        "upside": sorted(set(round(level, 8) for level in upside)),
        "downside": sorted(set(round(level, 8) for level in downside), reverse=True),
    }


def recent_engine_bias(result: Dict[str, Any]) -> float:
    bias = 0.0

    for event in (result.get("smcEvents", []) or [])[-12:]:
        if not isinstance(event, dict):
            continue

        direction = str(event.get("direction") or "").lower()
        tag = str(event.get("tag") or "").upper()
        scope = str(event.get("scope") or "").lower()

        weight = 1.0
        if "BOS" in tag:
            weight += 0.4
        if "CHOCH" in tag:
            weight += 0.25
        if scope == "swing":
            weight += 0.35

        if direction == "bullish":
            bias += weight
        elif direction == "bearish":
            bias -= weight

    for event in (result.get("liquidityEvents", []) or [])[-12:]:
        if not isinstance(event, dict):
            continue

        direction = str(event.get("direction") or "").lower()

        if direction == "bullish":
            bias += 0.35
        elif direction == "bearish":
            bias -= 0.35

    return clamp(bias / 8.0, -1.0, 1.0)


def build_python_ghost_candles(
    candles: List[Dict[str, Any]],
    result: Dict[str, Any],
    count: int = 3,
) -> List[Dict[str, Any]]:
    """
    Phase 3X Python ghost candles.

    This creates the same frontend shape that v3W already knows how to draw:
    open/high/low/close/confidence/direction.

    Logic:
    - Start from Heikin Ashi so ghost candles remain smooth.
    - Use recent momentum + SMC/liquidity bias.
    - React to nearby SMC zones / liquidity levels as targets.
    - Return PY-ready candles so frontend labels become PY1/PY2/PY3.
    """

    if len(candles) < 10:
        return []

    ha = build_heikin_ashi_candles(candles)

    last_ha = ha[-1]
    last_real = candles[-1]

    atr = average_true_range(candles, 14)
    if atr <= 0:
        atr = max(to_float(last_real.get("high")) - to_float(last_real.get("low")), to_float(last_real.get("close")) * 0.001, 0.01)

    momentum = candle_momentum(ha, 8)
    last_close = to_float(last_real.get("close"))

    smc_bias = recent_engine_bias(result)

    latest_signal = str(LATEST_SIGNAL.get("signal") or "").upper()
    if latest_signal == "BUY":
        dashboard_bias = 0.25
    elif latest_signal == "SELL":
        dashboard_bias = -0.25
    else:
        dashboard_bias = 0.0

    bull_score = to_float(LATEST_SIGNAL.get("bullScore"), 50)
    bear_score = to_float(LATEST_SIGNAL.get("bearScore"), 50)
    pressure_bias = clamp((bull_score - bear_score) / 100.0, -0.5, 0.5)

    levels = extract_levels_from_engine(result, last_close)

    prev_open = to_float(last_ha.get("open"))
    prev_close = to_float(last_ha.get("close"))
    prev_high = to_float(last_ha.get("high"))
    prev_low = to_float(last_ha.get("low"))

    previous_body = max(abs(prev_close - prev_open), atr * 0.08)

    ghosts: List[Dict[str, Any]] = []
    commit_direction = 0
    commit_left = 0

    for index in range(count):
        step = index + 1
        decay = 0.82 ** index

        ha_open = (prev_open + prev_close) / 2.0

        raw_delta = momentum * decay
        bias_delta = (smc_bias * 0.30 + pressure_bias * 0.45 + dashboard_bias * 0.25) * atr * (0.75 ** index)
        projected_close = prev_close + raw_delta + bias_delta

        direction = 1 if projected_close >= ha_open else -1

        if commit_left > 0 and commit_direction != 0:
            direction = commit_direction
            commit_left -= 1

        body_size = abs(projected_close - ha_open)
        body_size = max(body_size, atr * (0.16 if commit_direction else 0.10))
        body_size = min(body_size, atr * 1.10)

        # Smooth body rhythm like Pine HA ghost logic.
        body_size = previous_body * 0.55 + body_size * 0.45

        ha_close = ha_open + direction * body_size

        top = max(ha_open, ha_close)
        bottom = min(ha_open, ha_close)

        upper_wick = max(atr * 0.10, body_size * 0.30)
        lower_wick = max(atr * 0.10, body_size * 0.30)

        # Target-aware SMC/Alpha reaction.
        nearest_up = levels["upside"][0] if levels["upside"] else None
        nearest_down = levels["downside"][0] if levels["downside"] else None

        target_reaction = "continuation"
        severity = 0.0

        if nearest_up is not None:
            up_distance = nearest_up - top
            if 0 <= up_distance <= atr * 1.4 or top >= nearest_up:
                severity = max(severity, clamp(1.0 - max(up_distance, 0.0) / max(atr * 1.4, 0.01), 0.0, 1.0))
                upper_wick = max(upper_wick, atr * (0.35 + severity * 0.65))
                if direction > 0 and severity >= 0.65:
                    # Upside target rejection -> bearish flip.
                    ha_close = ha_open - max(body_size * 0.65, atr * 0.12)
                    direction = -1
                    commit_direction = -1
                    commit_left = 2
                    target_reaction = "upside_target_rejection"

        if nearest_down is not None:
            down_distance = bottom - nearest_down
            if 0 <= down_distance <= atr * 1.4 or bottom <= nearest_down:
                dn_severity = clamp(1.0 - max(down_distance, 0.0) / max(atr * 1.4, 0.01), 0.0, 1.0)
                if dn_severity > severity:
                    severity = dn_severity
                    lower_wick = max(lower_wick, atr * (0.35 + severity * 0.65))
                    if direction < 0 and severity >= 0.65:
                        # Downside target rejection -> bullish flip.
                        ha_close = ha_open + max(body_size * 0.65, atr * 0.12)
                        direction = 1
                        commit_direction = 1
                        commit_left = 2
                        target_reaction = "downside_target_rejection"

        top = max(ha_open, ha_close)
        bottom = min(ha_open, ha_close)

        ha_high = max(top + upper_wick, top)
        ha_low = min(bottom - lower_wick, bottom)

        # Confidence combines directional pressure, SMC agreement, HA momentum, and target severity.
        momentum_score = clamp(abs(momentum) / max(atr, 0.01) * 25.0, 0.0, 25.0)
        smc_score = abs(smc_bias) * 25.0
        pressure_score = abs(pressure_bias) * 35.0
        target_score = severity * 15.0
        confidence = int(round(clamp(momentum_score + smc_score + pressure_score + target_score, 4.0, 96.0)))

        ghosts.append(
            {
                "open": round(ha_open, 8),
                "high": round(ha_high, 8),
                "low": round(ha_low, 8),
                "close": round(ha_close, 8),
                "confidence": confidence,
                "direction": "bullish" if direction > 0 else "bearish",
                "label": f"Python Ghost #{step}",
                "source": "python",
                "engine": "python_smc_alpha_ghost",
                "targetReaction": target_reaction,
                "targetSeverity": round(severity, 4),
                "smcBias": round(smc_bias, 4),
                "pressureBias": round(pressure_bias, 4),
            }
        )

        prev_open = ha_open
        prev_close = ha_close
        prev_high = ha_high
        prev_low = ha_low
        previous_body = max(abs(ha_close - ha_open), atr * 0.08)

    return ghosts




# ─────────────────────────────────────────────────────────────────────────────
# PYTHON TECHNICAL SENTIMENT ENGINE — PHASE 4A
# Mirrors the LuxAlgo Market Sentiment Technicals meter logic from Pine:
# RSI, Stochastic, Stoch RSI, CCI, Bull Bear Power, Momentum, MA, VWAP,
# Bollinger Bands, Supertrend, Linear Regression, Market Structure.
# ─────────────────────────────────────────────────────────────────────────────

def safe_mean(values: List[float], fallback: float = 0.0) -> float:
    clean = [float(value) for value in values if isinstance(value, (int, float)) and value == value]
    return sum(clean) / len(clean) if clean else fallback


def sma(values: List[float], length: int) -> Optional[float]:
    if len(values) < length or length <= 0:
        return None
    return sum(values[-length:]) / length


def ema_series(values: List[float], length: int) -> List[float]:
    if not values:
        return []
    if length <= 1:
        return list(values)

    alpha = 2.0 / (length + 1.0)
    output = [values[0]]

    for value in values[1:]:
        output.append(value * alpha + output[-1] * (1.0 - alpha))

    return output


def ema(values: List[float], length: int) -> Optional[float]:
    series = ema_series(values, length)
    return series[-1] if series else None


def wma(values: List[float], length: int) -> Optional[float]:
    if len(values) < length or length <= 0:
        return None

    sample = values[-length:]
    weights = list(range(1, length + 1))
    total_weight = sum(weights)

    return sum(value * weight for value, weight in zip(sample, weights)) / total_weight


def stdev(values: List[float], length: int) -> Optional[float]:
    if len(values) < length or length <= 1:
        return None

    sample = values[-length:]
    mean_value = sum(sample) / length
    variance = sum((value - mean_value) ** 2 for value in sample) / length

    return variance ** 0.5


def mean_deviation(values: List[float], length: int) -> Optional[float]:
    if len(values) < length or length <= 0:
        return None

    sample = values[-length:]
    mean_value = sum(sample) / length

    return sum(abs(value - mean_value) for value in sample) / length


def interpolate(value: float, value_high: float, value_low: float, range_high: float, range_low: float) -> float:
    denominator = value_high - value_low
    if abs(denominator) < 1e-12:
        return range_low

    return range_low + (value - value_low) * (range_high - range_low) / denominator


def classify_sentiment_value(value: float) -> str:
    if value > 60:
        return "BULLISH"
    if value < 40:
        return "BEARISH"
    return "NEUTRAL"


def normalize_buy_sell(
    closes: List[float],
    buy_flags: List[bool],
    sell_flags: List[bool],
    smooth: int = 3,
) -> float:
    """
    Python version of the Pine normalize(buy, sell, smooth) helper.
    It builds a 0-100 oscillator based on buy/sell regime and recent close range.
    """

    if not closes:
        return 50.0

    os_state = 0
    max_value: Optional[float] = None
    min_value: Optional[float] = None
    normalized_values: List[float] = []

    for index, close_value in enumerate(closes):
        previous_os = os_state

        if index < len(buy_flags) and buy_flags[index]:
            os_state = 1
        elif index < len(sell_flags) and sell_flags[index]:
            os_state = -1

        if max_value is None:
            max_value = close_value
        if min_value is None:
            min_value = close_value

        if os_state > previous_os:
            max_value = close_value
        elif os_state < previous_os:
            min_value = close_value
        else:
            max_value = max(close_value, max_value)
            min_value = min(close_value, min_value)

        denominator = max(max_value - min_value, 1e-12)
        normalized_values.append(clamp((close_value - min_value) / denominator * 100.0, 0.0, 100.0))

    return safe_mean(normalized_values[-max(1, smooth):], 50.0)


def rsi_series(values: List[float], length: int = 14) -> List[float]:
    if len(values) < 2:
        return [50.0 for _ in values]

    gains: List[float] = []
    losses: List[float] = []

    for index in range(1, len(values)):
        change = values[index] - values[index - 1]
        gains.append(max(change, 0.0))
        losses.append(max(-change, 0.0))

    output: List[float] = [50.0]

    if len(gains) < length:
        output.extend([50.0 for _ in gains])
        return output[:len(values)]

    avg_gain = sum(gains[:length]) / length
    avg_loss = sum(losses[:length]) / length

    for index in range(len(gains)):
        if index < length:
            output.append(50.0)
            continue

        avg_gain = (avg_gain * (length - 1) + gains[index]) / length
        avg_loss = (avg_loss * (length - 1) + losses[index]) / length

        if avg_loss == 0:
            rsi = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi = 100.0 - (100.0 / (1.0 + rs))

        output.append(clamp(rsi, 0.0, 100.0))

    return output[-len(values):]


def rsi_normalized(closes: List[float], length: int = 14) -> float:
    raw = rsi_series(closes, length)[-1] if closes else 50.0

    if raw > 70:
        return clamp(interpolate(raw, 100, 70, 100, 75), 0, 100)
    if raw > 50:
        return clamp(interpolate(raw, 70, 50, 75, 50), 0, 100)
    if raw > 30:
        return clamp(interpolate(raw, 50, 30, 50, 25), 0, 100)

    return clamp(interpolate(raw, 30, 0, 25, 0), 0, 100)


def stochastic_normalized(highs: List[float], lows: List[float], closes: List[float], length_k: int = 14, smooth_k: int = 3) -> float:
    if len(closes) < length_k:
        return 50.0

    stoch_values: List[float] = []

    start = max(0, len(closes) - length_k - smooth_k - 5)

    for index in range(start, len(closes)):
        if index + 1 < length_k:
            continue

        high_window = highs[index + 1 - length_k:index + 1]
        low_window = lows[index + 1 - length_k:index + 1]
        highest_high = max(high_window)
        lowest_low = min(low_window)
        denominator = max(highest_high - lowest_low, 1e-12)
        stoch_values.append(clamp((closes[index] - lowest_low) / denominator * 100.0, 0.0, 100.0))

    smoothed = safe_mean(stoch_values[-smooth_k:], 50.0)

    if smoothed > 80:
        return clamp(interpolate(smoothed, 100, 80, 100, 75), 0, 100)
    if smoothed > 50:
        return clamp(interpolate(smoothed, 80, 50, 75, 50), 0, 100)
    if smoothed > 20:
        return clamp(interpolate(smoothed, 50, 20, 50, 25), 0, 100)

    return clamp(interpolate(smoothed, 20, 0, 25, 0), 0, 100)


def stochastic_rsi_normalized(closes: List[float], rsi_length: int = 14, stoch_length: int = 14, smooth_k: int = 3) -> float:
    rsi_values = rsi_series(closes, rsi_length)

    if len(rsi_values) < stoch_length:
        return 50.0

    stoch_values: List[float] = []

    start = max(0, len(rsi_values) - stoch_length - smooth_k - 5)

    for index in range(start, len(rsi_values)):
        if index + 1 < stoch_length:
            continue

        sample = rsi_values[index + 1 - stoch_length:index + 1]
        highest = max(sample)
        lowest = min(sample)
        denominator = max(highest - lowest, 1e-12)
        stoch_values.append(clamp((rsi_values[index] - lowest) / denominator * 100.0, 0.0, 100.0))

    smoothed = safe_mean(stoch_values[-smooth_k:], 50.0)

    if smoothed > 80:
        return clamp(interpolate(smoothed, 100, 80, 100, 75), 0, 100)
    if smoothed > 50:
        return clamp(interpolate(smoothed, 80, 50, 75, 50), 0, 100)
    if smoothed > 20:
        return clamp(interpolate(smoothed, 50, 20, 50, 25), 0, 100)

    return clamp(interpolate(smoothed, 20, 0, 25, 0), 0, 100)


def cci_normalized(highs: List[float], lows: List[float], closes: List[float], length: int = 20) -> float:
    typical = [(h + l + c) / 3.0 for h, l, c in zip(highs, lows, closes)]

    if len(typical) < length:
        return 50.0

    ma = sma(typical, length)
    dev = mean_deviation(typical, length)

    if ma is None or dev is None or dev <= 0:
        return 50.0

    cci = (typical[-1] - ma) / (0.015 * dev)

    if cci > 100:
        return 100.0 if cci > 300 else clamp(interpolate(cci, 300, 100, 100, 75), 0, 100)
    if cci >= 0:
        return clamp(interpolate(cci, 100, 0, 75, 50), 0, 100)
    if cci < -100:
        return 0.0 if cci < -300 else clamp(interpolate(cci, -100, -300, 25, 0), 0, 100)

    return clamp(interpolate(cci, 0, -100, 50, 25), 0, 100)


def bull_bear_power_normalized(highs: List[float], lows: List[float], closes: List[float], length: int = 13) -> float:
    if len(closes) < max(length, 20):
        return 50.0

    ema_values = ema_series(closes, length)
    bbp_values = [
        highs[index] + lows[index] - 2.0 * ema_values[index]
        for index in range(len(closes))
    ]

    if len(bbp_values) < 100:
        sample = bbp_values
    else:
        sample = bbp_values[-100:]

    basis = safe_mean(sample, 0.0)
    deviation = (sum((value - basis) ** 2 for value in sample) / max(len(sample), 1)) ** 0.5
    upper = basis + 2.0 * deviation
    lower = basis - 2.0 * deviation
    bbp = bbp_values[-1]

    if bbp > upper:
        return 100.0 if bbp > 1.5 * upper else clamp(interpolate(bbp, 1.5 * upper, upper, 100, 75), 0, 100)
    if bbp > 0:
        return clamp(interpolate(bbp, upper, 0, 75, 50), 0, 100)
    if bbp < lower:
        return 0.0 if bbp < 1.5 * lower else clamp(interpolate(bbp, lower, 1.5 * lower, 25, 0), 0, 100)
    if bbp < 0:
        return clamp(interpolate(bbp, 0, lower, 50, 25), 0, 100)

    return 50.0


def momentum_normalized(closes: List[float], length: int = 10, smooth: int = 3) -> float:
    buy_flags: List[bool] = []
    sell_flags: List[bool] = []

    for index, close_value in enumerate(closes):
        if index < length:
            buy_flags.append(False)
            sell_flags.append(False)
            continue

        momentum = close_value - closes[index - length]
        buy_flags.append(momentum > 0)
        sell_flags.append(momentum < 0)

    return normalize_buy_sell(closes, buy_flags, sell_flags, smooth)


def moving_average_normalized(closes: List[float], length: int = 20, ma_type: str = "SMA", smooth: int = 3) -> float:
    buy_flags: List[bool] = []
    sell_flags: List[bool] = []
    ma_type_upper = ma_type.upper()

    for index in range(len(closes)):
        sub = closes[:index + 1]

        if ma_type_upper == "EMA":
            basis = ema(sub, length)
        elif ma_type_upper == "WMA":
            basis = wma(sub, length)
        else:
            basis = sma(sub, length)

        if basis is None:
            buy_flags.append(False)
            sell_flags.append(False)
            continue

        buy_flags.append(closes[index] > basis)
        sell_flags.append(closes[index] < basis)

    return normalize_buy_sell(closes, buy_flags, sell_flags, smooth)


def bollinger_bands_normalized(closes: List[float], length: int = 20, multiplier: float = 2.0, smooth: int = 3) -> float:
    buy_flags: List[bool] = []
    sell_flags: List[bool] = []

    for index in range(len(closes)):
        sub = closes[:index + 1]
        basis = sma(sub, length)
        deviation = stdev(sub, length)

        if basis is None or deviation is None:
            buy_flags.append(False)
            sell_flags.append(False)
            continue

        upper = basis + multiplier * deviation
        lower = basis - multiplier * deviation

        buy_flags.append(closes[index] > upper)
        sell_flags.append(closes[index] < lower)

    return normalize_buy_sell(closes, buy_flags, sell_flags, smooth)


def vwap_bands_normalized(candles: List[Dict[str, Any]], stdev_mult: float = 2.0, smooth: int = 3) -> float:
    closes = [to_float(c.get("close")) for c in candles]
    typical = [
        (to_float(c.get("high")) + to_float(c.get("low")) + to_float(c.get("close"))) / 3.0
        for c in candles
    ]
    volumes = [max(to_float(c.get("volume")), 0.0) for c in candles]

    buy_flags: List[bool] = []
    sell_flags: List[bool] = []

    # Intraday Auto anchor in the Pine script defaults to day.
    # The API candles usually contain the most recent day/session, so this rolling
    # full-sample VWAP is a close approximation and works even when volume is sparse.
    for index in range(len(candles)):
        sample_price = typical[:index + 1]
        sample_volume = volumes[:index + 1]

        volume_sum = sum(sample_volume)

        if volume_sum > 0:
            vwap = sum(p * v for p, v in zip(sample_price, sample_volume)) / volume_sum
        else:
            vwap = safe_mean(sample_price, closes[index])

        deviation = (sum((p - vwap) ** 2 for p in sample_price) / max(len(sample_price), 1)) ** 0.5
        upper = vwap + stdev_mult * deviation
        lower = vwap - stdev_mult * deviation

        buy_flags.append(closes[index] > upper)
        sell_flags.append(closes[index] < lower)

    return normalize_buy_sell(closes, buy_flags, sell_flags, smooth)


def supertrend_series(highs: List[float], lows: List[float], closes: List[float], period: int = 10, factor: float = 3.0) -> List[float]:
    if len(closes) < 2:
        return [closes[0] if closes else 0.0]

    true_ranges: List[float] = [highs[0] - lows[0]]

    for index in range(1, len(closes)):
        true_ranges.append(
            max(
                highs[index] - lows[index],
                abs(highs[index] - closes[index - 1]),
                abs(lows[index] - closes[index - 1]),
            )
        )

    atr_values: List[float] = []
    for index in range(len(true_ranges)):
        if index + 1 < period:
            atr_values.append(safe_mean(true_ranges[:index + 1], true_ranges[index]))
        elif index + 1 == period:
            atr_values.append(safe_mean(true_ranges[:period], true_ranges[index]))
        else:
            atr_values.append((atr_values[-1] * (period - 1) + true_ranges[index]) / period)

    final_upper: List[float] = []
    final_lower: List[float] = []
    supertrend_values: List[float] = []
    direction = 1

    for index in range(len(closes)):
        hl2 = (highs[index] + lows[index]) / 2.0
        basic_upper = hl2 + factor * atr_values[index]
        basic_lower = hl2 - factor * atr_values[index]

        if index == 0:
            final_upper.append(basic_upper)
            final_lower.append(basic_lower)
            supertrend_values.append(basic_lower)
            continue

        upper = basic_upper if basic_upper < final_upper[-1] or closes[index - 1] > final_upper[-1] else final_upper[-1]
        lower = basic_lower if basic_lower > final_lower[-1] or closes[index - 1] < final_lower[-1] else final_lower[-1]

        if supertrend_values[-1] == final_upper[-1]:
            if closes[index] <= upper:
                direction = -1
                supertrend_value = upper
            else:
                direction = 1
                supertrend_value = lower
        else:
            if closes[index] >= lower:
                direction = 1
                supertrend_value = lower
            else:
                direction = -1
                supertrend_value = upper

        final_upper.append(upper)
        final_lower.append(lower)
        supertrend_values.append(supertrend_value)

    return supertrend_values


def supertrend_normalized(highs: List[float], lows: List[float], closes: List[float], period: int = 10, factor: float = 3.0, smooth: int = 3) -> float:
    st_values = supertrend_series(highs, lows, closes, period, factor)

    buy_flags = [close > st for close, st in zip(closes, st_values)]
    sell_flags = [close < st for close, st in zip(closes, st_values)]

    return normalize_buy_sell(closes, buy_flags, sell_flags, smooth)


def correlation_with_index(values: List[float], length: int = 25) -> float:
    if len(values) < length or length <= 1:
        return 0.0

    y_values = values[-length:]
    x_values = list(range(length))

    mean_x = safe_mean(x_values, 0.0)
    mean_y = safe_mean(y_values, 0.0)

    numerator = sum((x - mean_x) * (y - mean_y) for x, y in zip(x_values, y_values))
    denominator_x = sum((x - mean_x) ** 2 for x in x_values) ** 0.5
    denominator_y = sum((y - mean_y) ** 2 for y in y_values) ** 0.5

    denominator = denominator_x * denominator_y

    if denominator <= 1e-12:
        return 0.0

    return numerator / denominator


def linear_regression_normalized(closes: List[float], length: int = 25) -> float:
    corr = correlation_with_index(closes, length)
    return clamp(50.0 * corr + 50.0, 0.0, 100.0)


def market_structure_normalized(highs: List[float], lows: List[float], closes: List[float], length: int = 5, smooth: int = 3) -> float:
    last_pivot_high: Optional[float] = None
    last_pivot_low: Optional[float] = None
    pivot_high_crossed = False
    pivot_low_crossed = False

    buy_flags = [False for _ in closes]
    sell_flags = [False for _ in closes]

    for index in range(len(closes)):
        pivot_index = index - length

        if pivot_index >= length and pivot_index + length < len(closes):
            high_window = highs[pivot_index - length:pivot_index + length + 1]
            low_window = lows[pivot_index - length:pivot_index + length + 1]

            if highs[pivot_index] == max(high_window):
                last_pivot_high = highs[pivot_index]
                pivot_high_crossed = False

            if lows[pivot_index] == min(low_window):
                last_pivot_low = lows[pivot_index]
                pivot_low_crossed = False

        if last_pivot_high is not None and closes[index] > last_pivot_high and not pivot_high_crossed:
            buy_flags[index] = True
            pivot_high_crossed = True

        if last_pivot_low is not None and closes[index] < last_pivot_low and not pivot_low_crossed:
            sell_flags[index] = True
            pivot_low_crossed = True

    return normalize_buy_sell(closes, buy_flags, sell_flags, smooth)


def calculate_technical_sentiment(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    if len(candles) < 60:
        return {
            "eventType": "PYTHON_TECHNICAL_SENTIMENT",
            "status": "Waiting",
            "sentiment": 50.0,
            "sentimentStatus": "Waiting for more candles",
            "bearCount": 0,
            "neutralCount": 0,
            "bullCount": 0,
            "bearPct": 0.0,
            "neutralPct": 0.0,
            "bullPct": 0.0,
            "activeCount": 0,
            "indicators": [],
        }

    highs = [to_float(c.get("high")) for c in candles]
    lows = [to_float(c.get("low")) for c in candles]
    closes = [to_float(c.get("close")) for c in candles]

    indicator_values = [
        ("RSI", rsi_normalized(closes, 14)),
        ("Stochastic", stochastic_normalized(highs, lows, closes, 14, 3)),
        ("Stoch RSI", stochastic_rsi_normalized(closes, 14, 14, 3)),
        ("CCI", cci_normalized(highs, lows, closes, 20)),
        ("Bull Bear Power", bull_bear_power_normalized(highs, lows, closes, 13)),
        ("Momentum", momentum_normalized(closes, 10, 3)),
        ("Moving Average", moving_average_normalized(closes, 20, "SMA", 3)),
        ("VWAP", vwap_bands_normalized(candles, 2.0, 3)),
        ("Bollinger Bands", bollinger_bands_normalized(closes, 20, 2.0, 3)),
        ("Supertrend", supertrend_normalized(highs, lows, closes, 10, 3.0, 3)),
        ("Linear Regression", linear_regression_normalized(closes, 25)),
        ("Market Structure", market_structure_normalized(highs, lows, closes, 5, 3)),
    ]

    indicators = []
    bull_count = 0
    bear_count = 0
    neutral_count = 0

    for name, value in indicator_values:
        clean_value = clamp(float(value), 0.0, 100.0)
        signal = classify_sentiment_value(clean_value)

        if signal == "BULLISH":
            bull_count += 1
        elif signal == "BEARISH":
            bear_count += 1
        else:
            neutral_count += 1

        indicators.append(
            {
                "name": name,
                "value": round(clean_value, 2),
                "signal": signal,
            }
        )

    active_count = len(indicators)
    sentiment = safe_mean([item["value"] for item in indicators], 50.0)

    bear_pct = bear_count * 100.0 / active_count if active_count else 0.0
    neutral_pct = neutral_count * 100.0 / active_count if active_count else 0.0
    bull_pct = bull_count * 100.0 / active_count if active_count else 0.0

    if bull_count > bear_count and bull_count > neutral_count:
        status = "Mostly Bullish"
    elif bear_count > bull_count and bear_count > neutral_count:
        status = "Mostly Bearish"
    elif neutral_count > bull_count and neutral_count > bear_count:
        status = "Mostly Neutral"
    else:
        status = "Mixed"

    return {
        "eventType": "PYTHON_TECHNICAL_SENTIMENT",
        "status": "Live",
        "sentiment": round(sentiment, 2),
        "sentimentStatus": status,
        "bearCount": bear_count,
        "neutralCount": neutral_count,
        "bullCount": bull_count,
        "bearPct": round(bear_pct, 2),
        "neutralPct": round(neutral_pct, 2),
        "bullPct": round(bull_pct, 2),
        "activeCount": active_count,
        "indicators": indicators,
    }


# ─────────────────────────────────────────────────────────────────────────────
# BASIC ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "Trading Intelligence Dashboard API",
        "engine": "phase_4B_1_second_live_candle_polling",
        "endpoints": [
            "/api/latest-signal",
            "/api/recent-signals",
            "/api/recent-candles",
            "/api/historical-candles",
            "/api/merged-candles",
            "/api/live-candle",
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
# DASHBOARD STATE ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/latest-signal")
def latest_signal() -> Dict[str, Any]:
    if LATEST_SIGNAL:
        return LATEST_SIGNAL

    return {
        "eventType": "WAITING",
        "status": "Waiting",
        "symbol": "WAITING",
        "timeframe": "1m",
        "signal": "NEUTRAL",
        "confidence": 0,
        "bullScore": 50,
        "bearScore": 50,
        "netBias": 0,
        "price": 0,
        "smc": "Waiting for signal",
        "alphax": "Waiting for signal",
        "ghost": "Waiting for signal",
        "chartOverlays": None,
        "warnings": ["No webhook received yet"],
        "createdAt": now_iso(),
    }


@app.get("/api/recent-signals")
def recent_signals(limit: int = 20) -> List[Dict[str, Any]]:
    safe_limit = max(1, min(int(limit or 20), MAX_RECENT_SIGNALS))
    return RECENT_SIGNALS[:safe_limit]


@app.get("/api/recent-candles")
def recent_candles(
    symbol: Optional[str] = None,
    timeframe: Optional[str] = None,
    limit: int = 300,
) -> List[Dict[str, Any]]:
    candles = RECENT_CANDLES

    if symbol:
        normalized_symbol = normalize_symbol(symbol)
        candles = [
            candle
            for candle in candles
            if normalize_symbol(str(candle.get("symbol", ""))) == normalized_symbol
        ]

    if timeframe:
        normalized_timeframe = normalize_timeframe(timeframe)
        candles = [
            candle
            for candle in candles
            if normalize_timeframe(str(candle.get("timeframe", ""))) == normalized_timeframe
        ]

    safe_limit = max(1, min(int(limit or 300), MAX_RECENT_CANDLES))
    return candles[-safe_limit:]


# ─────────────────────────────────────────────────────────────────────────────
# ALPACA ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/historical-candles")
def historical_candles(
    symbol: str = "BTCUSD",
    timeframe: str = "1m",
    limit: int = 300,
) -> List[Dict[str, Any]]:
    return fetch_alpaca_historical_candles(symbol, timeframe, limit)


@app.get("/api/merged-candles")
def merged_candles(
    symbol: str = "BTCUSD",
    timeframe: str = "1m",
    limit: int = 300,
) -> List[Dict[str, Any]]:
    historical = fetch_alpaca_historical_candles(symbol, timeframe, limit)
    live = get_live_recent_candles(symbol, timeframe)
    live_current = get_cached_or_build_live_candle(symbol, timeframe)

    merged = merge_candles_by_time([
        *historical,
        *live,
        *([live_current] if live_current else []),
    ])
    safe_limit = max(1, min(int(limit or 300), 1000))

    return merged[-safe_limit:]


@app.get("/api/live-candle")
def live_candle(
    symbol: str = "BTCUSD",
    timeframe: str = "1m",
) -> Dict[str, Any]:
    """
    Returns one mutable current candle for the selected symbol/timeframe.

    Frontend polls this every 1 second and replaces only the last candle.
    Historical candles remain stable. This creates the live moving candle effect.
    """
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    source = pick_latest_candle_source(normalized_symbol, normalized_timeframe)
    return update_live_candle_cache(normalized_symbol, normalized_timeframe, source)




@app.get("/api/latest-sentiment")
def latest_sentiment(
    symbol: Optional[str] = None,
    timeframe: Optional[str] = None,
    limit: int = 500,
) -> Dict[str, Any]:
    """
    Phase 4A technical sentiment endpoint.
    Computes the full 12-indicator LuxAlgo-style sentiment meter from candles.
    """

    selected_symbol = normalize_symbol(symbol or str(LATEST_SIGNAL.get("symbol") or "BTCUSD"))
    selected_timeframe = normalize_timeframe(timeframe or str(LATEST_SIGNAL.get("timeframe") or "1m"))
    safe_limit = max(100, min(int(limit or 500), 1000))

    historical = fetch_alpaca_historical_candles(selected_symbol, selected_timeframe, safe_limit)
    live = get_live_recent_candles(selected_symbol, selected_timeframe)
    live_current = get_cached_or_build_live_candle(selected_symbol, selected_timeframe)
    candles = merge_candles_by_time([
        *historical,
        *live,
        *([live_current] if live_current else []),
    ])[-safe_limit:]

    sentiment = calculate_technical_sentiment(candles)
    sentiment["symbol"] = selected_symbol
    sentiment["timeframe"] = selected_timeframe
    sentiment["price"] = candles[-1]["close"] if candles else 0
    sentiment["time"] = candles[-1].get("time") if candles else None
    sentiment["createdAt"] = now_iso()

    return sentiment

# ─────────────────────────────────────────────────────────────────────────────
# PYTHON ENGINE ROUTE — PHASE 3X
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/engine-state")
def engine_state(
    symbol: str = "BTCUSD",
    timeframe: str = "1m",
    limit: int = 500,
) -> Dict[str, Any]:
    """
    Phase 3X endpoint.

    Browser test:
    https://trading-intelligence-dashboard.onrender.com/api/engine-state?symbol=BTCUSD&timeframe=1m&limit=500

    What it does:
    1. Gets historical candles from Alpaca.
    2. Merges any live webhook candles.
    3. Runs the Python SMC Phase 2 engine.
    4. Adds Python Ghost Candles from HA + SMC + AlphaX-style pressure.
    5. Returns candles + heikinAshiCandles + smcEvents + zones + liquidityEvents + ghostCandles.
    """

    safe_limit = max(100, min(int(limit or 500), 1000))

    historical = fetch_alpaca_historical_candles(symbol, timeframe, safe_limit)
    live = get_live_recent_candles(symbol, timeframe)
    live_current = get_cached_or_build_live_candle(symbol, timeframe)
    candles = merge_candles_by_time([
        *historical,
        *live,
        *([live_current] if live_current else []),
    ])[-safe_limit:]

    result = run_phase1_engine(
        candles,
        config={
            "internal_pivot_len": 5,
            "swing_pivot_len": 50,
            "internal_equal_pivot_len": 3,
            "swing_equal_pivot_len": 3,
            "show_internal_structure": True,
            "show_swing_structure": True,
            "show_internal_order_blocks": True,
            "show_swing_order_blocks": False,
            "internal_order_blocks_size": 5,
            "swing_order_blocks_size": 5,
            "show_fair_value_gaps": True,
            "show_premium_discount_zones": True,
            "show_equal_highs_lows": True,
            "show_internal_sweeps": True,
            "show_swing_sweeps": True,
            "show_liquidity_pools": True,
            "max_events": 150,
            "max_zones": 80,
            "max_liquidity_events": 120,
        },
    )

    ghost_candles = build_python_ghost_candles(candles, result, count=3)
    technical_sentiment = calculate_technical_sentiment(candles)

    result["technicalSentiment"] = technical_sentiment
    result["sentiment"] = technical_sentiment
    result["ghostProjections"] = ghost_candles
    result["ghostEngine"] = {
        "phase": "phase_3x_python_ghost_candles",
        "source": "python",
        "count": len(ghost_candles),
        "uses": [
            "heikin_ashi_sequence",
            "smc_structure_bias",
            "liquidity_target_reaction",
            "dashboard_pressure_bias",
        ],
    }

    result["source"] = {
        "symbol": normalize_symbol(symbol),
        "timeframe": normalize_timeframe(timeframe),
        "limit": safe_limit,
        "historicalCandles": len(historical),
        "liveCandles": len(live),
        "liveCurrentCandle": live_current is not None,
        "mergedCandles": len(candles),
        "dataProvider": "alpaca",
    }

    return result
