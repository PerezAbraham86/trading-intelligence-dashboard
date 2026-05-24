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

    # TradingView prefixes
    for prefix in ["BINANCE:", "COINBASE:", "CRYPTO:", "CME_MINI:", "CME:", "AMEX:", "NASDAQ:", "NYSE:"]:
        raw = raw.replace(prefix, "")

    # Frontend / Alpaca friendly
    if raw in ["BTCUSD", "BTC/USD", "XBTUSD"]:
        return "BTCUSD"
    if raw in ["ETHUSD", "ETH/USD"]:
        return "ETHUSD"

    return raw


def normalize_timeframe(timeframe: str) -> str:
    tf = str(timeframe or "1m").strip().lower()

    mapping = {
        "1": "1m",
        "3": "3m",
        "5": "5m",
        "15": "15m",
        "30": "30m",
        "60": "1h",
        "120": "2h",
        "240": "4h",
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


def format_bar_time(value: Any) -> Any:
    # Keep unix timestamps as seconds if sent by Pine.
    if value is None:
        return int(time.time())

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

    candle_time = payload.get("time") or payload.get("timestamp") or payload.get("createdAt") or int(time.time())

    return {
        "time": format_bar_time(candle_time),
        "timestamp": format_bar_time(candle_time),
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
        key = f"{normalize_symbol(str(candle.get('symbol', '')))}:{normalize_timeframe(str(candle.get('timeframe', '')))}:{candle.get('time')}"
        merged[key] = candle

    def sort_key(item: Dict[str, Any]) -> Any:
        value = item.get("time")
        try:
            return float(value)
        except Exception:
            return str(value)

    return sorted(merged.values(), key=sort_key)


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

    # Preserve chartOverlays exactly. It may be a JSON string from Pine.
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

    # Alpaca time is ISO string. Keep ISO-like string for frontend and engine.
    return {
        "time": raw_time,
        "timestamp": raw_time,
        "open": to_float(raw.get("o")),
        "high": to_float(raw.get("h")),
        "low": to_float(raw.get("l")),
        "close": to_float(raw.get("c")),
        "volume": to_float(raw.get("v")),
        "symbol": normalize_symbol(symbol),
        "timeframe": normalize_timeframe(timeframe),
        "createdAt": now_iso(),
    }


def fetch_alpaca_historical_candles(symbol: str, timeframe: str = "1m", limit: int = 300) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    alpaca_tf = alpaca_timeframe(normalized_timeframe)
    safe_limit = max(1, min(int(limit or 300), 1000))

    headers = alpaca_headers()

    if is_crypto_symbol(normalized_symbol):
        alpaca_symbol = to_alpaca_crypto_symbol(normalized_symbol)

        params = urlencode(
            {
                "symbols": alpaca_symbol,
                "timeframe": alpaca_tf,
                "limit": safe_limit,
                "sort": "asc",
            }
        )

        url = f"{ALPACA_CRYPTO_BASE_URL}/crypto/us/bars?{params}"
        data = http_get_json(url, headers=headers)

        bars_by_symbol = data.get("bars", {})
        bars = bars_by_symbol.get(alpaca_symbol, [])

        return [
            normalize_alpaca_bar(bar, normalized_symbol, normalized_timeframe)
            for bar in bars
        ]

    # Stocks/ETFs. This is for SPY and similar. Futures like ES1!/MES1! are not covered by Alpaca data.
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
# BASIC ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "Trading Intelligence Dashboard API",
        "engine": "phase_1_python_smc_core_ready",
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
            candle for candle in candles
            if normalize_symbol(str(candle.get("symbol", ""))) == normalized_symbol
        ]

    if timeframe:
        normalized_timeframe = normalize_timeframe(timeframe)
        candles = [
            candle for candle in candles
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
# PYTHON ENGINE ROUTE — PHASE 1
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/engine-state")
def engine_state(
    symbol: str = "BTCUSD",
    timeframe: str = "1m",
    limit: int = 500,
) -> Dict[str, Any]:
    """
    Phase 1 endpoint.

    Browser test:
    https://trading-intelligence-dashboard.onrender.com/api/engine-state?symbol=BTCUSD&timeframe=1m&limit=500

    What it does:
    1. Gets historical candles from Alpaca.
    2. Merges any live webhook candles.
    3. Runs the Python SMC Phase 1 engine.
    4. Returns candles + heikinAshiCandles + smcEvents.
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
            "show_internal_structure": True,
            "show_swing_structure": True,
            "max_events": 150,
        },
    )

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
