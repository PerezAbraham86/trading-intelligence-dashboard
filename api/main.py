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
# BASIC ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "Trading Intelligence Dashboard API",
        "engine": "phase_3x_python_ghost_candles",
        "endpoints": [
            "/api/latest-signal",
            "/api/recent-signals",
            "/api/recent-candles",
            "/api/historical-candles",
            "/api/merged-candles",
            "/api/engine-state",
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

    merged = merge_candles_by_time([*historical, *live])
    safe_limit = max(1, min(int(limit or 300), 1000))

    return merged[-safe_limit:]


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
    candles = merge_candles_by_time([*historical, *live])[-safe_limit:]

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

    result["ghostCandles"] = ghost_candles
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
        "mergedCandles": len(candles),
        "dataProvider": "alpaca",
    }

    return result
