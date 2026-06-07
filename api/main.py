from __future__ import annotations

import csv
import io
import json
import math
import os
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request as FastAPIRequest
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from api.ghost_ml import evaluate_ghost_ml_records, ghost_ml_summary_from_candles, record_ghost_ml_projection

try:
    from api.ml_feature_store import (
        get_ml_feature_store_summary,
        get_recent_ml_feature_snapshots,
        record_ml_feature_snapshot,
        update_ml_feature_outcomes,
    )
except Exception:
    try:
        from ml_feature_store import (
            get_ml_feature_store_summary,
            get_recent_ml_feature_snapshots,
            record_ml_feature_snapshot,
            update_ml_feature_outcomes,
        )
    except Exception:
        get_ml_feature_store_summary = None
        get_recent_ml_feature_snapshots = None
        record_ml_feature_snapshot = None
        update_ml_feature_outcomes = None


try:
    from api.overlay_engine import build_overlay_payload as build_backend_overlay_payload
except Exception:
    try:
        from overlay_engine import build_overlay_payload as build_backend_overlay_payload
    except Exception:
        build_backend_overlay_payload = None



# ────────────────────────────────────────────────────────────────��[...]
# APP SETUP
# ────────────────────────────────────────────────────────────────��[...]

app = FastAPI(title="Trading Intelligence Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def load_site_candle_cache_on_startup() -> None:
    load_persistent_candle_cache()


# ────────────────────────────────────────────────────────────────��[...]
# ENVIRONMENT
# ────────────────────────────────���───────────────────────────────��[...]

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


# ────────────────────────────────────────────────────────────────��[...]
# IN-MEMORY STATE
# ────────────────────────────────────────────────────────────────�[...]

LATEST_SIGNAL: Dict[str, Any] = {}
RECENT_SIGNALS: List[Dict[str, Any]] = []
RECENT_CANDLES: List[Dict[str, Any]] = []

CHART_OVERLAY_CACHE: Dict[str, Any] = {}
CHART_OVERLAY_RAW_CACHE: Dict[str, Any] = {}
CANDLE_RESPONSE_CACHE: Dict[str, Any] = {}
CANDLE_CACHE_FILE = Path(os.getenv("CANDLE_CACHE_FILE", "/tmp/trading_dashboard_candle_cache.json"))
CANDLE_SITE_CACHE_MAX_AGE_SECONDS = int(os.getenv("CANDLE_SITE_CACHE_MAX_AGE_SECONDS", "86400"))

MAX_RECENT_SIGNALS = 50
MAX_RECENT_CANDLES = 5000
OVERLAY_PAYLOAD_VERSION = "unified_v1"


# ────────────────────────────────────────────────────────────────�[...]
# MODELS
# ────────────────────────────────────────────────────────────────�[...]

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


# ────────────────────────────────────────────────────────────────�[...]
# BASIC HELPERS
# ────────────────────────────────────────────────────────────────�[...]

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
    if raw in {"MES", "MES1", "MES1!", "/MES", "MES=F", "CME_MINI:MES1!"}:
        return "MES1!"

    return raw

# (file truncated for brevity in this message) ...

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("api.main:app", host="0.0.0.0", port=port, reload=True)
