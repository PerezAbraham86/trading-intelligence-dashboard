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
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from api.ghost_ml import (
    apply_ghost_ml_confidence,
    evaluate_ghost_ml_records,
    get_ghost_ml_confidence_adjustment,
    get_ghost_ml_projection_multiplier,
    ghost_ml_export,
    ghost_ml_summary_from_candles,
    record_ghost_ml_projection,
    reset_ghost_ml_memory,
)

try:
    from api.target_ml import (
        build_target_ml_plan,
        evaluate_target_ml_records,
        record_target_ml_projection,
        reset_target_ml_memory,
        target_ml_export,
        target_ml_summary_from_candles,
    )
except Exception:
    try:
        from target_ml import (
            build_target_ml_plan,
            evaluate_target_ml_records,
            record_target_ml_projection,
            reset_target_ml_memory,
            target_ml_export,
            target_ml_summary_from_candles,
        )
    except Exception:
        build_target_ml_plan = None
        evaluate_target_ml_records = None
        record_target_ml_projection = None
        reset_target_ml_memory = None
        target_ml_export = None
        target_ml_summary_from_candles = None


try:
    from api.entry_ml import (
        close_entry_ml_trade,
        entry_ml_export,
        entry_ml_summary,
        get_entry_ml_confidence,
        record_entry_ml_trade,
        reset_entry_ml_memory,
    )
except Exception:
    try:
        from entry_ml import (
            close_entry_ml_trade,
            entry_ml_export,
            entry_ml_summary,
            get_entry_ml_confidence,
            record_entry_ml_trade,
            reset_entry_ml_memory,
        )
    except Exception:
        close_entry_ml_trade = None
        entry_ml_export = None
        entry_ml_summary = None
        get_entry_ml_confidence = None
        record_entry_ml_trade = None
        reset_entry_ml_memory = None


try:
    from api.ai_trader import (
        ai_trader_diagnostics,
        ai_trader_export,
        ai_trader_summary,
        get_ai_trader_control_state,
        update_ai_trader_control_state,
        close_ai_trade,
        evaluate_ai_trades,
        get_ai_trader_decision,
        open_ai_trade,
        reset_ai_trader_memory,
        validate_ai_trade_plan,
    )
except Exception:
    try:
        from ai_trader import (
            ai_trader_diagnostics,
            ai_trader_export,
            ai_trader_summary,
            get_ai_trader_control_state,
            update_ai_trader_control_state,
            close_ai_trade,
            evaluate_ai_trades,
            get_ai_trader_decision,
            open_ai_trade,
            reset_ai_trader_memory,
            validate_ai_trade_plan,
        )
    except Exception:
        ai_trader_diagnostics = None
        ai_trader_export = None
        ai_trader_summary = None
        get_ai_trader_control_state = None
        update_ai_trader_control_state = None
        close_ai_trade = None
        evaluate_ai_trades = None
        get_ai_trader_decision = None
        open_ai_trade = None
        reset_ai_trader_memory = None
        validate_ai_trade_plan = None


try:
    from api.projection_engine import (
        build_unified_projection_engine,
        evaluate_open_projections as evaluate_projection_engine_open_projections,
        projection_engine_export,
        projection_engine_status,
        reset_projection_engine_memory,
    )
except Exception:
    try:
        from projection_engine import (
            build_unified_projection_engine,
            evaluate_open_projections as evaluate_projection_engine_open_projections,
            projection_engine_export,
            projection_engine_status,
            reset_projection_engine_memory,
        )
    except Exception:
        build_unified_projection_engine = None
        evaluate_projection_engine_open_projections = None
        projection_engine_export = None
        projection_engine_status = None
        reset_projection_engine_memory = None


try:
    from api.unified_intelligence_memory import (
        apply_unified_memory_adjustments,
        evaluate_unified_intelligence_outcome,
        remember_context_snapshot,
        reset_unified_intelligence_memory,
        unified_intelligence_export,
        unified_memory_status,
    )
except Exception:
    try:
        from unified_intelligence_memory import (
            apply_unified_memory_adjustments,
            evaluate_unified_intelligence_outcome,
            remember_context_snapshot,
            reset_unified_intelligence_memory,
            unified_intelligence_export,
            unified_memory_status,
        )
    except Exception:
        apply_unified_memory_adjustments = None
        evaluate_unified_intelligence_outcome = None
        remember_context_snapshot = None
        reset_unified_intelligence_memory = None
        unified_intelligence_export = None
        unified_memory_status = None



try:
    from api.insightsentry_live_feed import (
        get_latest_live_snapshot,
        live_feed_event_generator,
        live_feed_ping_generator,
        live_feed_status,
        refresh_insightsentry_websocket_key,
    )
except Exception:
    try:
        from insightsentry_live_feed import (
            get_latest_live_snapshot,
            live_feed_event_generator,
            live_feed_ping_generator,
            live_feed_status,
            refresh_insightsentry_websocket_key,
        )
    except Exception:
        get_latest_live_snapshot = None
        live_feed_event_generator = None
        live_feed_ping_generator = None
        live_feed_status = None
        refresh_insightsentry_websocket_key = None


try:
    from api.insightsentry_history import (
        get_historical_ohlcv,
        historical_ohlcv_status,
    )
except Exception:
    try:
        from insightsentry_history import (
            get_historical_ohlcv,
            historical_ohlcv_status,
        )
    except Exception:
        get_historical_ohlcv = None
        historical_ohlcv_status = None


try:
    from api.insightsentry_session import (
        get_insightsentry_session,
        insightsentry_session_status,
    )
except Exception:
    try:
        from insightsentry_session import (
            get_insightsentry_session,
            insightsentry_session_status,
        )
    except Exception:
        get_insightsentry_session = None
        insightsentry_session_status = None




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

try:
    from api.external_data_engine import build_external_data_context, build_external_data_status
except Exception:
    try:
        from external_data_engine import build_external_data_context, build_external_data_status
    except Exception:
        build_external_data_context = None
        build_external_data_status = None

try:
    from api.unified_intelligence_engine import build_unified_intelligence_object
except Exception:
    try:
        from unified_intelligence_engine import build_unified_intelligence_object
    except Exception:
        build_unified_intelligence_object = None



try:
    from optimizer import run_optimizer as run_ghost_optimizer
except Exception:
    run_ghost_optimizer = None


try:
    from api.neural_brain_fastapi import (
        label_neural_brain_outcome,
        list_neural_brain_snapshots,
        neural_brain_status,
        predict_neural_brain,
        save_neural_brain_snapshot,
    )
except Exception:
    try:
        from neural_brain_fastapi import (
            label_neural_brain_outcome,
            list_neural_brain_snapshots,
            neural_brain_status,
            predict_neural_brain,
            save_neural_brain_snapshot,
        )
    except Exception:
        label_neural_brain_outcome = None
        list_neural_brain_snapshots = None
        neural_brain_status = None
        predict_neural_brain = None
        save_neural_brain_snapshot = None



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


@app.on_event("startup")
def load_site_candle_cache_on_startup() -> None:
    load_persistent_candle_cache()


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

CHART_OVERLAY_CACHE: Dict[str, Any] = {}
CHART_OVERLAY_RAW_CACHE: Dict[str, Any] = {}
CANDLE_RESPONSE_CACHE: Dict[str, Any] = {}
MAX_CANDLE_RESPONSE_CACHE_ITEMS = int(os.getenv("MAX_CANDLE_RESPONSE_CACHE_ITEMS", "40"))
MAX_CHART_OVERLAY_CACHE_ITEMS = int(os.getenv("MAX_CHART_OVERLAY_CACHE_ITEMS", "30"))
MAX_CHART_OVERLAY_RAW_CACHE_ITEMS = int(os.getenv("MAX_CHART_OVERLAY_RAW_CACHE_ITEMS", "12"))
MAX_TICKER_NEWS_CACHE_ITEMS = int(os.getenv("MAX_TICKER_NEWS_CACHE_ITEMS", "30"))
MAX_OPTIONS_PRESSURE_CACHE_ITEMS = int(os.getenv("MAX_OPTIONS_PRESSURE_CACHE_ITEMS", "30"))
CANDLE_CACHE_FILE = Path(os.getenv("CANDLE_CACHE_FILE", "/tmp/trading_dashboard_candle_cache.json"))
CANDLE_SITE_CACHE_MAX_AGE_SECONDS = int(os.getenv("CANDLE_SITE_CACHE_MAX_AGE_SECONDS", "21600"))

MAX_RECENT_SIGNALS = 50
MAX_RECENT_CANDLES = 5000
OVERLAY_PAYLOAD_VERSION = "unified_v1"


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




class EntryMlConfidencePayload(BaseModel):
    symbol: Optional[str] = "MES1!"
    timeframe: Optional[str] = "1m"
    side: Optional[Any] = None
    mode: Optional[str] = "NRTR"

    entryTime: Optional[Any] = None
    entryPrice: Optional[float] = None
    targetPrice: Optional[float] = None
    stopPrice: Optional[float] = None
    riskReward: Optional[float] = None

    scorecards: Optional[Dict[str, Any]] = None
    ghostMl: Optional[Dict[str, Any]] = None
    targetMl: Optional[Dict[str, Any]] = None
    context: Optional[Dict[str, Any]] = None


class EntryMlRecordPayload(EntryMlConfidencePayload):
    pass


class EntryMlClosePayload(BaseModel):
    symbol: Optional[str] = "MES1!"
    timeframe: Optional[str] = "1m"
    entryTime: Optional[Any] = None
    side: Optional[Any] = None
    mode: Optional[str] = "NRTR"

    exitTime: Optional[Any] = None
    exitPrice: Optional[float] = None
    pnl: Optional[float] = None
    pnlPercent: Optional[float] = None
    mfe: Optional[float] = None
    mae: Optional[float] = None
    barsHeld: Optional[int] = None
    exitReason: Optional[str] = None


class AiTraderDecisionPayload(BaseModel):
    # Keep every field loose. The dashboard can send null, undefined-cleaned values,
    # strings, numbers, arrays, nested UI objects, or partial snapshots. The AI trader
    # brain normalizes everything in api/ai_trader.py, so FastAPI should not reject
    # dashboard-only data with 422 before it reaches that normalizer.
    symbol: Optional[Any] = "MES1!"
    timeframe: Optional[Any] = "1m"

    currentPrice: Optional[Any] = None
    entryPrice: Optional[Any] = None
    targetPrice: Optional[Any] = None
    stopPrice: Optional[Any] = None
    side: Optional[Any] = None
    riskReward: Optional[Any] = None

    signal: Optional[Any] = None
    scorecards: Optional[Any] = None
    ghostMl: Optional[Any] = None
    targetMl: Optional[Any] = None
    entryMl: Optional[Any] = None
    nrtrContext: Optional[Any] = None
    unifiedIntelligence: Optional[Any] = None
    context: Optional[Any] = None

    minConfidence: Optional[Any] = None
    minRiskReward: Optional[Any] = None
    maxRiskR: Optional[Any] = None
    useAiTrailingStop: Optional[Any] = None
    trailingStopR: Optional[Any] = None
    setupKey: Optional[Any] = None


class AiTraderValidatePlanPayload(AiTraderDecisionPayload):
    pass


class AiTraderOpenPayload(AiTraderDecisionPayload):
    entryTime: Optional[Any] = None
    openedAt: Optional[Any] = None
    clientOpenedAt: Optional[Any] = None


class AiTraderClosePayload(BaseModel):
    tradeId: Optional[Any] = None
    symbol: Optional[Any] = "MES1!"
    timeframe: Optional[Any] = "1m"
    side: Optional[Any] = None
    exitPrice: Optional[Any] = None
    currentPrice: Optional[Any] = None
    exitTime: Optional[Any] = None
    exitReason: Optional[Any] = "manual_close"


class AiTraderEvaluatePayload(BaseModel):
    symbol: Optional[Any] = "MES1!"
    timeframe: Optional[Any] = "1m"
    currentPrice: Optional[Any] = None
    livePrice: Optional[Any] = None
    candles: Optional[Any] = None
    maxRiskR: Optional[Any] = None
    useAiTrailingStop: Optional[Any] = None
    trailingStopR: Optional[Any] = None


class AiTraderDiagnosticsPayload(BaseModel):
    symbol: Optional[Any] = "MES1!"
    timeframe: Optional[Any] = "1m"
    currentPrice: Optional[Any] = None
    candles: Optional[Any] = None
    includeMemory: Optional[Any] = True


class AiTraderControlPayload(BaseModel):
    enabled: Optional[Any] = None
    symbol: Optional[Any] = "MES1!"
    timeframe: Optional[Any] = "1m"
    minConfidence: Optional[Any] = None
    minRiskReward: Optional[Any] = None
    maxRiskR: Optional[Any] = None
    useAiTrailingStop: Optional[Any] = None
    trailingStopR: Optional[Any] = None
    settings: Optional[Any] = None
    controlledBy: Optional[Any] = "dashboard"
    source: Optional[Any] = "dashboard"


class ProjectionEnginePayload(BaseModel):
    # Loose payload on purpose. The dashboard sends mixed frontend context objects,
    # candle arrays, scorecards, external tables, overlay payloads, and optional
    # target/ghost context. The projection engine normalizes the shape internally.
    symbol: Optional[Any] = "MES1!"
    timeframe: Optional[Any] = "1m"
    candles: Optional[Any] = None
    limit: Optional[Any] = 800
    ghostCount: Optional[Any] = 3
    autoRegister: Optional[Any] = True
    currentPrice: Optional[Any] = None
    price: Optional[Any] = None
    resetAll: Optional[Any] = None

    signal: Optional[Any] = None
    scorecards: Optional[Any] = None
    mlFeatures: Optional[Any] = None
    overlayPayload: Optional[Any] = None
    chartOverlays: Optional[Any] = None
    unifiedIntelligence: Optional[Any] = None
    externalTables: Optional[Any] = None
    context: Optional[Any] = None


class UnifiedIntelligenceMemoryPayload(BaseModel):
    # Phase 7 memory payload. Keep loose so frontend context snapshots, matrices,
    # projection-engine state, candle arrays, and outcome objects never 422 before
    # the unified memory normalizer can read them.
    symbol: Optional[Any] = "MES1!"
    timeframe: Optional[Any] = "1m"
    candles: Optional[Any] = None
    limit: Optional[Any] = 800
    currentPrice: Optional[Any] = None
    price: Optional[Any] = None

    signal: Optional[Any] = None
    scorecards: Optional[Any] = None
    mlFeatures: Optional[Any] = None
    overlayPayload: Optional[Any] = None
    chartOverlays: Optional[Any] = None
    unifiedIntelligence: Optional[Any] = None
    externalTables: Optional[Any] = None
    projectionEngine: Optional[Any] = None
    projectionEngineContext: Optional[Any] = None
    context: Optional[Any] = None

    snapshotId: Optional[Any] = None
    outcome: Optional[Any] = None
    rows: Optional[Any] = None
    resetAll: Optional[Any] = None


# ─────────────────────────────────────────────────────────────────────────────
# BASIC HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def model_to_dict(model: Any) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    if hasattr(model, "dict"):
        return model.dict()
    if isinstance(model, dict):
        return model
    return {}


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


def round_price(symbol: str, price: Any) -> float:
    """
    Round prices by instrument tick/decimal style.

    This helper is used by Target ML / Ghost alignment. Without it,
    /api/recent-signals and /api/latest-signals can crash with:
    NameError: name 'round_price' is not defined.
    """
    value = to_float(price, 0.0)

    if value <= 0 or not math.isfinite(value):
        return 0.0

    normalized = normalize_symbol(str(symbol or ""))

    # Futures-style tick rounding.
    if normalized in {"ES", "ES1", "ES1!", "/ES", "MES", "MES1", "MES1!", "/MES"}:
        tick = 0.25
        return round(round(value / tick) * tick, 2)

    if normalized in {"NQ", "NQ1", "NQ1!", "/NQ", "MNQ", "MNQ1", "MNQ1!", "/MNQ"}:
        tick = 0.25
        return round(round(value / tick) * tick, 2)

    if normalized in {"YM", "YM1", "YM1!", "/YM", "MYM", "MYM1", "MYM1!", "/MYM"}:
        tick = 1.0
        return round(round(value / tick) * tick, 0)

    if normalized in {"RTY", "RTY1", "RTY1!", "/RTY", "M2K", "M2K1", "M2K1!", "/M2K"}:
        tick = 0.10
        return round(round(value / tick) * tick, 2)

    # Crypto and most liquid stocks/ETFs.
    if "BTC" in normalized or "ETH" in normalized:
        return round(value, 2)

    if value >= 100:
        return round(value, 2)

    if value >= 1:
        return round(value, 4)

    return round(value, 8)


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





def _cache_created_epoch(value: Any) -> float:
    try:
        if not isinstance(value, dict):
            return 0.0
        created_at = str(value.get("createdAt") or value.get("updatedAt") or "")
        if not created_at:
            return 0.0
        parsed = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except Exception:
        return 0.0


def trim_in_memory_cache(cache: Dict[str, Any], max_items: int, label: str = "cache") -> None:
    """Keep Render memory stable by pruning oldest in-process cache entries."""
    try:
        safe_max = max(1, int(max_items or 1))
    except Exception:
        safe_max = 20

    if len(cache) <= safe_max:
        return

    ordered_keys = sorted(
        list(cache.keys()),
        key=lambda key: _cache_created_epoch(cache.get(key)),
    )
    remove_count = max(0, len(cache) - safe_max)
    for key in ordered_keys[:remove_count]:
        cache.pop(key, None)

    if remove_count > 0:
        print(f"[Memory Guard] trimmed {remove_count} {label} entries; remaining={len(cache)}")

def is_crypto_symbol(symbol: str) -> bool:
    return normalize_symbol(symbol) in {"BTCUSD", "ETHUSD"}


def is_futures_symbol(symbol: str) -> bool:
    return normalize_symbol(symbol) == "MES1!"


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
        with urlopen(request, timeout=12) as response:
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
    "SPY": "SPY",
    "BTCUSD": "BTCUSD",
    "ETHUSD": "ETHUSD",
}


def to_insightsentry_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)
    return INSIGHTSENTRY_SYMBOL_MAP.get(normalized, normalized)


def insightsentry_symbol_candidates(symbol: str) -> List[str]:
    normalized = normalize_symbol(symbol)

    # Confirmed by InsightSentry Search:
    # name=MES1!, code=CME_MINI:MES1!, type=FUTURES, exchange=CME.
    # Keep this strict. No ES and no fallback aliases.
    if normalized == "MES1!":
        return ["CME_MINI:MES1!"]

    return [to_insightsentry_symbol(normalized)]


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
    safe_limit = max(1, min(int(limit or 500), 5000))
    headers = insightsentry_headers()

    last_error: Optional[str] = None

    # Important reliability fix:
    # Try multiple futures symbol formats. InsightSentry/RapidAPI can accept different
    # futures symbols depending on the route/vendor cache. This prevents MES from
    # going blank when only one symbol alias temporarily fails.
    for api_symbol in insightsentry_symbol_candidates(normalized_symbol):
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


try:
    from api.site_cache_store import (
        init_site_cache_store,
        get_site_cache_summary,
        get_candle_payload as db_get_candle_payload,
        set_candle_payload as db_set_candle_payload,
        get_stale_candle_payload as db_get_stale_candle_payload,
        get_best_candle_payload as db_get_best_candle_payload,
        list_candle_cache_entries as db_list_candle_cache_entries,
        save_chart_settings as db_save_chart_settings,
        load_chart_settings as db_load_chart_settings,
    )
except Exception:
    try:
        from site_cache_store import (
            init_site_cache_store,
            get_site_cache_summary,
            get_candle_payload as db_get_candle_payload,
            set_candle_payload as db_set_candle_payload,
            get_stale_candle_payload as db_get_stale_candle_payload,
            get_best_candle_payload as db_get_best_candle_payload,
            list_candle_cache_entries as db_list_candle_cache_entries,
            save_chart_settings as db_save_chart_settings,
            load_chart_settings as db_load_chart_settings,
        )
    except Exception:
        init_site_cache_store = None
        get_site_cache_summary = None
        db_get_candle_payload = None
        db_set_candle_payload = None
        db_get_stale_candle_payload = None
        db_get_best_candle_payload = None
        db_list_candle_cache_entries = None
        db_save_chart_settings = None
        db_load_chart_settings = None


def load_persistent_candle_cache() -> None:
    if init_site_cache_store:
        try:
            summary = init_site_cache_store()
            print(f"[Site DB Cache] ready: {summary}")
            return
        except Exception as error:
            print(f"[Site DB Cache] startup failed, using memory/json fallback: {error}")

    global CANDLE_RESPONSE_CACHE
    try:
        if not CANDLE_CACHE_FILE.exists():
            return
        with CANDLE_CACHE_FILE.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            CANDLE_RESPONSE_CACHE.update({str(key): value for key, value in data.items() if isinstance(value, dict)})
            trim_in_memory_cache(CANDLE_RESPONSE_CACHE, MAX_CANDLE_RESPONSE_CACHE_ITEMS, "candle response cache")
            print(f"[Candle Cache] loaded {len(CANDLE_RESPONSE_CACHE)} site-level candle payloads")
    except Exception as error:
        print(f"[Candle Cache] load failed: {error}")


def save_persistent_candle_cache() -> None:
    # SQLite writes happen immediately in candle_cache_set(). Keep JSON fallback for safety.
    if init_site_cache_store:
        return
    try:
        CANDLE_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        trim_in_memory_cache(CANDLE_RESPONSE_CACHE, MAX_CANDLE_RESPONSE_CACHE_ITEMS, "candle response cache")
        with CANDLE_CACHE_FILE.open("w", encoding="utf-8") as handle:
            json.dump(CANDLE_RESPONSE_CACHE, handle)
    except Exception as error:
        print(f"[Candle Cache] save failed: {error}")


def candle_cache_age_seconds(payload: Dict[str, Any]) -> Optional[float]:
    try:
        created_at = datetime.fromisoformat(str(payload.get("createdAt", "")).replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - created_at).total_seconds()
    except Exception:
        return None


def candle_cache_payload(cached: Dict[str, Any], cache_label: str) -> Dict[str, Any]:
    payload = dict(cached)
    payload["cache"] = cache_label
    payload["siteCache"] = True
    payload["siteCacheAgeSeconds"] = candle_cache_age_seconds(cached)
    return payload


def candle_cache_key(route: str, symbol: str, timeframe: str, limit: int) -> str:
    return f"{route}::{normalize_symbol(symbol)}::{normalize_timeframe(timeframe)}::{int(limit or 500)}"


def candle_cache_get(route: str, symbol: str, timeframe: str, limit: int, max_age_seconds: int = CANDLE_SITE_CACHE_MAX_AGE_SECONDS) -> Optional[Dict[str, Any]]:
    key = candle_cache_key(route, symbol, timeframe, limit)

    if db_get_candle_payload:
        try:
            cached_db = db_get_candle_payload(key, max_age_seconds=max_age_seconds)
            if cached_db:
                return cached_db
        except Exception as error:
            print(f"[Site DB Cache] get failed: {error}")

    cached = CANDLE_RESPONSE_CACHE.get(key)
    if not isinstance(cached, dict):
        return None

    candles = cached.get("candles")
    if isinstance(candles, list) and len(candles) > 0:
        age = candle_cache_age_seconds(cached)
        if age is None or age <= max_age_seconds:
            return candle_cache_payload(cached, "site_cached")
        return candle_cache_payload(cached, "site_cached_stale")

    return None


MAX_STORED_CANDLES_PER_CACHE_ENTRY = int(os.getenv("MAX_STORED_CANDLES_PER_CACHE_ENTRY", "5000"))


def find_existing_candle_cache_payload_for_merge(route: str, symbol: str, timeframe: str) -> Optional[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    if db_get_best_candle_payload:
        try:
            existing_db = db_get_best_candle_payload(
                route=route,
                symbol=normalized_symbol,
                timeframe=normalized_timeframe,
                min_limit_value=1,
                max_age_seconds=max(CANDLE_SITE_CACHE_MAX_AGE_SECONDS, 7 * 24 * 60 * 60),
                allow_stale=True,
            )
            if isinstance(existing_db, dict):
                return existing_db
        except Exception as error:
            print(f"[Site DB Cache] merge lookup failed: {error}")

    prefix = f"{route}::{normalized_symbol}::{normalized_timeframe}::"
    best: Optional[Dict[str, Any]] = None
    best_count = -1

    for key, value in CANDLE_RESPONSE_CACHE.items():
        if not str(key).startswith(prefix) or not isinstance(value, dict):
            continue
        candles = value.get("candles")
        count = len(candles) if isinstance(candles, list) else 0
        if count > best_count:
            best = value
            best_count = count

    return best


def merge_candle_cache_payload(route: str, symbol: str, timeframe: str, limit: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    stored = dict(payload)
    incoming_candles = stored.get("candles") if isinstance(stored.get("candles"), list) else []
    existing_payload = find_existing_candle_cache_payload_for_merge(route, symbol, timeframe)
    existing_candles = existing_payload.get("candles") if isinstance(existing_payload, dict) and isinstance(existing_payload.get("candles"), list) else []

    if existing_candles or incoming_candles:
        merged = merge_candles_by_time([*existing_candles, *incoming_candles])[-MAX_STORED_CANDLES_PER_CACHE_ENTRY:]
        stored["candles"] = merged
        stored["count"] = len(merged)
        stored["candleCount"] = len(merged)
        stored["firstCandleTime"] = merged[0].get("time") if merged else None
        stored["lastCandleTime"] = merged[-1].get("time") if merged else None
        stored["lastClose"] = to_float(merged[-1].get("close"), 0) if merged else 0
        stored["cacheMerge"] = {
            "enabled": True,
            "existingCount": len(existing_candles),
            "incomingCount": len(incoming_candles),
            "mergedCount": len(merged),
            "maxStoredCandles": MAX_STORED_CANDLES_PER_CACHE_ENTRY,
        }

    stored["requestedLimit"] = int(limit or 500)
    return stored


def candle_cache_set(route: str, symbol: str, timeframe: str, limit: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    key = candle_cache_key(route, symbol, timeframe, limit)
    stored = merge_candle_cache_payload(route, symbol, timeframe, limit, payload)
    stored["createdAt"] = now_iso()
    stored["cache"] = "stored"
    stored["siteCache"] = True

    if db_set_candle_payload:
        try:
            return db_set_candle_payload(
                cache_key=key,
                route=route,
                symbol=normalize_symbol(symbol),
                timeframe=normalize_timeframe(timeframe),
                limit_value=max(int(limit or 500), len(stored.get("candles", [])) if isinstance(stored.get("candles"), list) else int(limit or 500)),
                payload=stored,
            )
        except Exception as error:
            print(f"[Site DB Cache] set failed, using memory/json fallback: {error}")

    CANDLE_RESPONSE_CACHE[key] = stored
    trim_in_memory_cache(CANDLE_RESPONSE_CACHE, MAX_CANDLE_RESPONSE_CACHE_ITEMS, "candle response cache")
    save_persistent_candle_cache()
    return stored


def candle_cache_stale(route: str, symbol: str, timeframe: str, limit: int) -> Optional[Dict[str, Any]]:
    key = candle_cache_key(route, symbol, timeframe, limit)

    if db_get_stale_candle_payload:
        try:
            cached_db = db_get_stale_candle_payload(key)
            if cached_db:
                return cached_db
        except Exception as error:
            print(f"[Site DB Cache] stale get failed: {error}")

    cached = CANDLE_RESPONSE_CACHE.get(key)
    if not isinstance(cached, dict):
        return None
    return candle_cache_payload(cached, "site_cached_stale")




def candle_cache_best(route: str, symbol: str, timeframe: str, limit: int, max_age_seconds: int = CANDLE_SITE_CACHE_MAX_AGE_SECONDS) -> Optional[Dict[str, Any]]:
    """Return best matching cached payload for same route/symbol/timeframe, ignoring exact limit."""
    if db_get_best_candle_payload:
        try:
            cached_db = db_get_best_candle_payload(
                route=route,
                symbol=normalize_symbol(symbol),
                timeframe=normalize_timeframe(timeframe),
                min_limit_value=int(limit or 500),
                max_age_seconds=max_age_seconds,
                allow_stale=True,
            )
            if cached_db:
                return cached_db
        except Exception as error:
            print(f"[Site DB Cache] best-match get failed: {error}")

    # Memory fallback: same route/symbol/timeframe with any saved limit.
    prefix = f"{route}::{normalize_symbol(symbol)}::{normalize_timeframe(timeframe)}::"
    best: Optional[Dict[str, Any]] = None
    best_count = -1
    for key, value in CANDLE_RESPONSE_CACHE.items():
        if not str(key).startswith(prefix) or not isinstance(value, dict):
            continue
        candles = value.get("candles")
        count = len(candles) if isinstance(candles, list) else 0
        if count > best_count:
            best = value
            best_count = count

    if best is not None and best_count > 0:
        return candle_cache_payload(best, "site_cached_best_match")

    return None



def latest_candle_close(candles: List[Dict[str, Any]]) -> float:
    for candle in reversed(safe_list(candles)):
        if not isinstance(candle, dict):
            continue
        close = to_float(candle.get("close") or candle.get("c") or candle.get("price"), 0.0)
        if close > 0:
            return close
    return 0.0


def futures_live_gap_too_large(candles: List[Dict[str, Any]], symbol: str, live_price: float) -> bool:
    if not is_futures_symbol(symbol):
        return False

    last_close = latest_candle_close(candles)
    if last_close <= 0 or live_price <= 0:
        return False

    max_gap_pct = to_float(os.getenv("MES_LIVE_HISTORY_MAX_GAP_PCT", "0.0025"), 0.0025)
    gap_pct = abs(live_price - last_close) / last_close
    return gap_pct > max_gap_pct


def fetch_live_price_number(symbol: str, timeframe: str) -> float:
    try:
        live = get_live_price_payload(symbol, timeframe)
        return to_float(live.get("price") if isinstance(live, dict) else None, 0.0)
    except Exception as error:
        print(f"[MES cache guard] live price check failed: {error}")
        return 0.0


def futures_cached_payload_is_stale_against_live(cached: Any, symbol: str, timeframe: str) -> bool:
    if not is_futures_symbol(symbol) or not isinstance(cached, dict):
        return False

    candles = cached.get("candles")
    if not isinstance(candles, list) or not candles:
        return False

    live_price = fetch_live_price_number(symbol, timeframe)
    if live_price <= 0:
        return False

    if futures_live_gap_too_large(candles, symbol, live_price):
        last_close = latest_candle_close(candles)
        print(
            f"[MES cache guard] rejecting stale {normalize_symbol(symbol)} {normalize_timeframe(timeframe)} cache: "
            f"last_close={last_close} live_price={live_price}"
        )
        return True

    return False

def cached_futures_history_payload_for_rate_limit(symbol: str, timeframe: str, limit: int) -> Optional[Dict[str, Any]]:
    """Return cached MES history when InsightSentry rate-limits fresh history.

    This fallback intentionally does not merge a far-away live candle into stale
    historical candles. The frontend live/history gap guard decides whether live
    should be stitched onto the chart. The goal here is to keep the chart from
    going blank during 429 windows while still showing the last usable MES
    candle series.
    """
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    if not is_futures_symbol(normalized_symbol):
        return None

    safe_limit = max(1, min(int(limit or 500), 5000))
    max_age = int(os.getenv("MES_RATE_LIMIT_CACHE_MAX_AGE_SECONDS", str(max(CANDLE_SITE_CACHE_MAX_AGE_SECONDS, 86400))))

    candidates: List[Any] = []
    for route_name in ["historical", "dashboard"]:
        cached = candle_cache_get(route_name, normalized_symbol, normalized_timeframe, safe_limit, max_age)
        if cached:
            candidates.append(cached)

        best = candle_cache_best(route_name, normalized_symbol, normalized_timeframe, safe_limit, max_age)
        if best:
            candidates.append(best)

        stale = candle_cache_stale(route_name, normalized_symbol, normalized_timeframe, safe_limit)
        if stale:
            candidates.append(stale)

    for cached in candidates:
        if not isinstance(cached, dict):
            continue

        candles = cached.get("candles")
        if not isinstance(candles, list) or not candles:
            continue

        filtered = filter_valid_candles_for_symbol(merge_candles_by_time(candles), normalized_symbol)[-safe_limit:]
        if not filtered:
            continue

        payload = build_candle_route_payload(
            route_source="insightsentry_history_rate_limit_cache",
            symbol=normalized_symbol,
            timeframe=normalized_timeframe,
            candles=filtered,
            provider=str(cached.get("provider") or "insightsentry"),
            cache_label="rate_limit_cached_history",
        )
        payload["siteCache"] = cached.get("siteCache", True)
        payload["siteCacheAgeSeconds"] = cached.get("siteCacheAgeSeconds")
        payload["rateLimitFallback"] = True
        payload["warning"] = "InsightSentry returned 429; using cached MES historical candles."
        return payload

    return None

def timeframe_to_1m_fetch_limit(timeframe: str, limit: int) -> int:
    seconds = timeframe_seconds(timeframe)
    mult = max(1, int(seconds / 60))
    return max(limit * mult + 100, limit, 500)



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

        # Important speed/reliability fallback:
        # if a higher timeframe returns empty, fetch 1m once and resample locally.
        if not candles and normalized_timeframe != "1m":
            one_min_limit = timeframe_to_1m_fetch_limit(normalized_timeframe, safe_limit)
            one_min = fetch_insightsentry_historical_candles(normalized_symbol, "1m", one_min_limit)
            candles = resample_candles_to_timeframe(one_min, normalized_timeframe, safe_limit)

        return candles[-safe_limit:]

    if is_crypto_symbol(normalized_symbol):
        try:
            candles = fetch_alpaca_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)
            if not candles and normalized_timeframe != "1m":
                one_min_limit = timeframe_to_1m_fetch_limit(normalized_timeframe, safe_limit)
                one_min = fetch_alpaca_historical_candles(normalized_symbol, "1m", one_min_limit)
                candles = resample_candles_to_timeframe(one_min, normalized_timeframe, safe_limit)
        except Exception as error:
            print(f"[Alpaca crypto] failed for {normalized_symbol} {normalized_timeframe}: {error}")
            candles = []
        return candles[-safe_limit:]

    if normalized_symbol == "SPY":
        try:
            candles = fetch_alpaca_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)
            if not candles and normalized_timeframe != "1m":
                one_min_limit = timeframe_to_1m_fetch_limit(normalized_timeframe, safe_limit)
                one_min = fetch_alpaca_historical_candles(normalized_symbol, "1m", one_min_limit)
                candles = resample_candles_to_timeframe(one_min, normalized_timeframe, safe_limit)
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


def get_dashboard_candles(symbol: str, timeframe: str = "1m", limit: int = 500, use_cache: bool = True) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))

    if use_cache:
        # Critical rate-limit protection:
        # internal dashboard panels ask for different limits (500, 600, 1000, 4000).
        # Use the best existing backend cache instead of hitting InsightSentry again.
        for route_name in ["dashboard", "historical"]:
            cached = candle_cache_get(route_name, normalized_symbol, normalized_timeframe, safe_limit, CANDLE_SITE_CACHE_MAX_AGE_SECONDS)
            if not cached:
                cached = candle_cache_best(route_name, normalized_symbol, normalized_timeframe, safe_limit, CANDLE_SITE_CACHE_MAX_AGE_SECONDS)

            cached_candles = cached.get("candles") if isinstance(cached, dict) else None
            if isinstance(cached_candles, list) and len(cached_candles) > 0:
                if futures_cached_payload_is_stale_against_live(cached, normalized_symbol, normalized_timeframe):
                    continue

                live = filter_valid_candles_for_symbol(
                    get_live_recent_candles(normalized_symbol, normalized_timeframe),
                    normalized_symbol,
                )

                if live and futures_live_gap_too_large(cached_candles, normalized_symbol, latest_candle_close(live)):
                    # Do not stitch a far-away MES quote/live candle onto stale historical candles.
                    # The route should refresh history instead of drawing a fake vertical candle.
                    continue

                merged = merge_candles_by_time([*cached_candles, *live])[-safe_limit:]
                return filter_valid_candles_for_symbol(merged, normalized_symbol)

    historical = filter_valid_candles_for_symbol(
        fetch_historical_candles(normalized_symbol, normalized_timeframe, safe_limit),
        normalized_symbol,
    )

    live = filter_valid_candles_for_symbol(
        get_live_recent_candles(normalized_symbol, normalized_timeframe),
        normalized_symbol,
    )

    if historical and live and futures_live_gap_too_large(historical, normalized_symbol, latest_candle_close(live)):
        print(
            f"[MES merge guard] skipped live merge for {normalized_symbol} {normalized_timeframe}; "
            f"history_close={latest_candle_close(historical)} live_close={latest_candle_close(live)}"
        )
        return historical[-safe_limit:]

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
# PERSISTENT LIVE CANDLE BRIDGE
# ─────────────────────────────────────────────────────────────────────────────

PERSISTENT_LIVE_CANDLE_CACHE_LIMIT = int(os.getenv("PERSISTENT_LIVE_CANDLE_CACHE_LIMIT", "5000"))
PERSISTENT_LIVE_CANDLE_MAX_CACHE_AGE_SECONDS = int(os.getenv("PERSISTENT_LIVE_CANDLE_MAX_CACHE_AGE_SECONDS", str(7 * 24 * 60 * 60)))
PERSISTENT_LIVE_BACKFILL_MAX_BARS = int(os.getenv("PERSISTENT_LIVE_BACKFILL_MAX_BARS", "300"))
# Important: do not fabricate missing historical OHLC candles by default.
# We persist real live ticks/candles as they arrive, then merge them with provider
# history. Any missing past buckets must come from the data provider, not from a
# linear synthetic bridge, because fake bridge candles distort HA, SMC, NRTR and AI.
PERSISTENT_LIVE_BACKFILL_ENABLED = os.getenv("PERSISTENT_LIVE_BACKFILL_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}


def live_price_payload_to_candle(live_payload: Any, symbol: str, timeframe: str) -> Optional[Dict[str, Any]]:
    if not isinstance(live_payload, dict):
        return None

    normalized_symbol = normalize_symbol(str(live_payload.get("symbol") or symbol))
    normalized_timeframe = normalize_timeframe(str(live_payload.get("timeframe") or timeframe))
    price = to_float(
        live_payload.get("price")
        or live_payload.get("livePrice")
        or live_payload.get("currentPrice")
        or live_payload.get("last")
        or live_payload.get("close"),
        0.0,
    )

    if price <= 0 or not is_price_valid_for_symbol(price, normalized_symbol):
        return None

    epoch = to_epoch_seconds(
        live_payload.get("bucketEpoch")
        or live_payload.get("epoch")
        or live_payload.get("time")
        or live_payload.get("timestamp")
        or live_payload.get("createdAt")
    )

    if epoch <= 0:
        epoch = datetime.now(timezone.utc).timestamp()

    bucket_epoch = floor_epoch_to_timeframe(epoch, normalized_timeframe)
    formatted_time = format_bar_time(bucket_epoch)

    candle = {
        "time": formatted_time,
        "timestamp": formatted_time,
        "epoch": bucket_epoch,
        "open": price,
        "high": price,
        "low": price,
        "close": price,
        "volume": to_float(live_payload.get("volume"), 0.0),
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "createdAt": now_iso(),
        "provider": str(live_payload.get("provider") or "live_price"),
        "source": str(live_payload.get("source") or "persistent_live_price_candle"),
        "persistentLiveCandle": True,
    }

    return candle if is_candle_valid_for_symbol(candle, normalized_symbol) else None


def merge_live_tick_with_existing_candle(existing: Optional[Dict[str, Any]], tick: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(existing, dict):
        return dict(tick)

    existing_epoch = int(to_epoch_seconds(existing.get("epoch") or existing.get("time") or existing.get("timestamp")))
    tick_epoch = int(to_epoch_seconds(tick.get("epoch") or tick.get("time") or tick.get("timestamp")))

    if existing_epoch != tick_epoch:
        return dict(tick)

    tick_close = to_float(tick.get("close"), 0.0)
    existing_open = to_float(existing.get("open"), tick_close)
    existing_high = to_float(existing.get("high"), tick_close)
    existing_low = to_float(existing.get("low"), tick_close)
    existing_volume = to_float(existing.get("volume"), 0.0)

    merged = dict(existing)
    merged.update({
        "time": tick.get("time") or existing.get("time"),
        "timestamp": tick.get("timestamp") or tick.get("time") or existing.get("timestamp"),
        "epoch": tick_epoch,
        "open": existing_open if existing_open > 0 else tick_close,
        "high": max(existing_high, to_float(tick.get("high"), tick_close), tick_close),
        "low": min(existing_low if existing_low > 0 else tick_close, to_float(tick.get("low"), tick_close), tick_close),
        "close": tick_close,
        "volume": max(existing_volume, 0.0) + max(to_float(tick.get("volume"), 0.0), 0.0),
        "symbol": tick.get("symbol") or existing.get("symbol"),
        "timeframe": tick.get("timeframe") or existing.get("timeframe"),
        "provider": tick.get("provider") or existing.get("provider"),
        "source": "persistent_live_candle_ohlc_update",
        "persistentLiveCandle": True,
        "updatedAt": now_iso(),
    })

    return merged


def find_cached_candle_for_epoch(symbol: str, timeframe: str, epoch: int) -> Optional[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    target_epoch = int(epoch or 0)

    if target_epoch <= 0:
        return None

    candidate_payloads: List[Any] = []

    for route_name in ["dashboard", "historical"]:
        for getter in [candle_cache_best, candle_cache_stale]:
            try:
                cached = getter(
                    route_name,
                    normalized_symbol,
                    normalized_timeframe,
                    1,
                    PERSISTENT_LIVE_CANDLE_MAX_CACHE_AGE_SECONDS,
                ) if getter is candle_cache_best else getter(route_name, normalized_symbol, normalized_timeframe, 1)
                if cached:
                    candidate_payloads.append(cached)
            except Exception:
                pass

    candidate_payloads.append({"candles": RECENT_CANDLES})

    for payload in candidate_payloads:
        candles = payload.get("candles") if isinstance(payload, dict) else None
        if not isinstance(candles, list):
            continue

        for candle in reversed(candles):
            if not isinstance(candle, dict):
                continue
            if normalize_symbol(str(candle.get("symbol") or normalized_symbol)) != normalized_symbol:
                continue
            if normalize_timeframe(str(candle.get("timeframe") or normalized_timeframe)) != normalized_timeframe:
                continue
            candle_epoch = int(to_epoch_seconds(candle.get("epoch") or candle.get("time") or candle.get("timestamp")))
            if candle_epoch == target_epoch:
                return candle

    return None



def find_latest_cached_candle_before_epoch(symbol: str, timeframe: str, epoch: int) -> Optional[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    target_epoch = int(epoch or 0)

    if target_epoch <= 0:
        return None

    candidate_payloads: List[Any] = []

    for route_name in ["dashboard", "historical"]:
        for getter in [candle_cache_best, candle_cache_stale]:
            try:
                cached = getter(
                    route_name,
                    normalized_symbol,
                    normalized_timeframe,
                    PERSISTENT_LIVE_CANDLE_CACHE_LIMIT,
                    PERSISTENT_LIVE_CANDLE_MAX_CACHE_AGE_SECONDS,
                ) if getter is candle_cache_best else getter(route_name, normalized_symbol, normalized_timeframe, PERSISTENT_LIVE_CANDLE_CACHE_LIMIT)
                if cached:
                    candidate_payloads.append(cached)
            except Exception:
                pass

    candidate_payloads.append({"candles": RECENT_CANDLES})

    latest: Optional[Dict[str, Any]] = None
    latest_epoch = 0

    for payload in candidate_payloads:
        candles = payload.get("candles") if isinstance(payload, dict) else None
        if not isinstance(candles, list):
            continue

        for candle in candles:
            if not isinstance(candle, dict):
                continue
            if normalize_symbol(str(candle.get("symbol") or normalized_symbol)) != normalized_symbol:
                continue
            if normalize_timeframe(str(candle.get("timeframe") or normalized_timeframe)) != normalized_timeframe:
                continue

            candle_epoch = int(to_epoch_seconds(candle.get("epoch") or candle.get("time") or candle.get("timestamp")))
            if 0 < candle_epoch < target_epoch and candle_epoch > latest_epoch:
                latest = candle
                latest_epoch = candle_epoch

    return latest


def build_persistent_live_backfill_candles(
    symbol: str,
    timeframe: str,
    previous_candle: Optional[Dict[str, Any]],
    current_tick: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Return only real persisted live candles unless synthetic backfill is explicitly enabled.

    The chart gap shown between historical provider data and resumed live data must
    not be filled with invented candles. A linear bridge creates fake HA candles,
    fake SMC/OB zones, fake NRTR movement and bad AI context. By default we store
    only the actual live timeframe candle. Historical gaps are repaired only when
    InsightSentry/provider history later returns real OHLCV for those buckets.

    Set PERSISTENT_LIVE_BACKFILL_ENABLED=true only for visual testing.
    """
    if not isinstance(current_tick, dict):
        return []

    if not PERSISTENT_LIVE_BACKFILL_ENABLED:
        return [current_tick]

    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    seconds = max(timeframe_seconds(normalized_timeframe), 60)
    tick_epoch = int(to_epoch_seconds(current_tick.get("epoch") or current_tick.get("time") or current_tick.get("timestamp")))
    tick_close = to_float(current_tick.get("close"), 0.0)

    if tick_epoch <= 0 or tick_close <= 0:
        return [current_tick]

    if not isinstance(previous_candle, dict):
        return [current_tick]

    previous_epoch = int(to_epoch_seconds(previous_candle.get("epoch") or previous_candle.get("time") or previous_candle.get("timestamp")))
    previous_close = to_float(previous_candle.get("close"), 0.0)

    if previous_epoch <= 0 or previous_close <= 0 or previous_epoch >= tick_epoch:
        return [current_tick]

    gap_bars = int((tick_epoch - previous_epoch) // seconds) - 1
    if gap_bars <= 0:
        return [current_tick]

    if gap_bars > max(1, PERSISTENT_LIVE_BACKFILL_MAX_BARS):
        return [current_tick]

    rows: List[Dict[str, Any]] = []
    last_close = previous_close
    total_steps = gap_bars + 1

    for step in range(1, gap_bars + 1):
        epoch = previous_epoch + seconds * step
        progress = step / max(total_steps, 1)
        close = previous_close + (tick_close - previous_close) * progress
        open_price = last_close
        high = max(open_price, close)
        low = min(open_price, close)
        formatted_time = format_bar_time(epoch)

        bridge = {
            "time": formatted_time,
            "timestamp": formatted_time,
            "epoch": epoch,
            "open": round(open_price, 8),
            "high": round(high, 8),
            "low": round(low, 8),
            "close": round(close, 8),
            "volume": 0.0,
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "createdAt": now_iso(),
            "provider": str(current_tick.get("provider") or "live_price"),
            "source": "persistent_live_gap_backfill_bridge",
            "persistentLiveCandle": True,
            "persistentLiveBackfill": True,
            "syntheticCandle": True,
            "excludeFromAi": True,
            "backfillFromEpoch": previous_epoch,
            "backfillToEpoch": tick_epoch,
        }

        if is_candle_valid_for_symbol(bridge, normalized_symbol):
            rows.append(bridge)
            last_close = close

    rows.append(current_tick)
    return rows


def upsert_recent_live_candle(candle: Dict[str, Any]) -> None:
    global RECENT_CANDLES

    normalized_symbol = normalize_symbol(str(candle.get("symbol") or ""))
    normalized_timeframe = normalize_timeframe(str(candle.get("timeframe") or "1m"))
    candle_epoch = int(to_epoch_seconds(candle.get("epoch") or candle.get("time") or candle.get("timestamp")))

    next_rows: List[Dict[str, Any]] = []
    replaced = False

    for existing in RECENT_CANDLES:
        if not isinstance(existing, dict):
            continue

        existing_symbol = normalize_symbol(str(existing.get("symbol") or ""))
        existing_timeframe = normalize_timeframe(str(existing.get("timeframe") or ""))
        existing_epoch = int(to_epoch_seconds(existing.get("epoch") or existing.get("time") or existing.get("timestamp")))

        if existing_symbol == normalized_symbol and existing_timeframe == normalized_timeframe and existing_epoch == candle_epoch:
            next_rows.append(merge_live_tick_with_existing_candle(existing, candle))
            replaced = True
        else:
            next_rows.append(existing)

    if not replaced:
        next_rows.append(candle)

    RECENT_CANDLES = merge_candles_by_time(next_rows)[-MAX_RECENT_CANDLES:]


def persist_live_candle_to_history_cache(symbol: str, timeframe: str, live_payload: Any) -> Optional[Dict[str, Any]]:
    tick = live_price_payload_to_candle(live_payload, symbol, timeframe)
    if not tick:
        return None

    normalized_symbol = normalize_symbol(str(tick.get("symbol") or symbol))
    normalized_timeframe = normalize_timeframe(str(tick.get("timeframe") or timeframe))
    tick_epoch = int(to_epoch_seconds(tick.get("epoch") or tick.get("time") or tick.get("timestamp")))
    existing = find_cached_candle_for_epoch(normalized_symbol, normalized_timeframe, tick_epoch)
    merged_tick = merge_live_tick_with_existing_candle(existing, tick)

    if not is_candle_valid_for_symbol(merged_tick, normalized_symbol):
        return None

    previous_candle = find_latest_cached_candle_before_epoch(normalized_symbol, normalized_timeframe, tick_epoch)
    candles_to_store = build_persistent_live_backfill_candles(
        normalized_symbol,
        normalized_timeframe,
        previous_candle,
        merged_tick,
    )

    valid_store_rows = filter_valid_candles_for_symbol(
        merge_candles_by_time(candles_to_store),
        normalized_symbol,
    )

    if not valid_store_rows:
        valid_store_rows = [merged_tick]

    for row in valid_store_rows:
        upsert_recent_live_candle(row)

    # Store the same live tail into both dashboard and historical cache families.
    # Later historical requests return provider candles merged with these saved live
    # candles, so the chart does not reload an old history tail and then jump to live.
    for route_name in ["dashboard", "historical"]:
        try:
            candle_cache_set(
                route_name,
                normalized_symbol,
                normalized_timeframe,
                PERSISTENT_LIVE_CANDLE_CACHE_LIMIT,
                {
                    "symbol": normalized_symbol,
                    "timeframe": normalized_timeframe,
                    "count": len(valid_store_rows),
                    "candles": valid_store_rows,
                    "provider": merged_tick.get("provider"),
                    "source": "persistent_live_candle_cache",
                    "cache": "persistent_live_candle",
                    "persistentLiveCandles": True,
                    "persistentLiveBackfillCount": max(0, len(valid_store_rows) - 1),
                    "createdAt": now_iso(),
                },
            )
        except Exception as error:
            print(f"[Persistent live candles] cache set failed for {route_name}: {error}")

    if len(valid_store_rows) > 1:
        print(
            f"[Persistent live candles] saved live tail for {normalized_symbol} {normalized_timeframe}: "
            f"rows={len(valid_store_rows)} backfill={len(valid_store_rows) - 1}"
        )

    return valid_store_rows[-1]


def merge_saved_live_candles_with_history(symbol: str, timeframe: str, candles: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))

    def is_real_ohlcv_row(row: Dict[str, Any]) -> bool:
        if not isinstance(row, dict):
            return False
        if bool(row.get("persistentLiveBackfill")) or bool(row.get("syntheticCandle")):
            return False
        if str(row.get("source") or "") == "persistent_live_gap_backfill_bridge":
            return False
        return True

    live_rows = filter_valid_candles_for_symbol(
        [row for row in get_live_recent_candles(normalized_symbol, normalized_timeframe) if is_real_ohlcv_row(row)],
        normalized_symbol,
    )

    historical_rows = filter_valid_candles_for_symbol(
        [row for row in merge_candles_by_time(candles or []) if is_real_ohlcv_row(row)],
        normalized_symbol,
    )

    if not live_rows:
        return historical_rows[-safe_limit:]

    bridge_rows: List[Dict[str, Any]] = []

    # Default behavior: merge only real provider history + real saved live candles.
    # Do not create synthetic candles for missing buckets. Missing history should
    # remain visually empty until the provider returns the real OHLCV bars.
    if PERSISTENT_LIVE_BACKFILL_ENABLED and historical_rows and live_rows:
        first_live = live_rows[0]
        last_history = historical_rows[-1]
        first_live_epoch = int(to_epoch_seconds(first_live.get("epoch") or first_live.get("time") or first_live.get("timestamp")))
        last_history_epoch = int(to_epoch_seconds(last_history.get("epoch") or last_history.get("time") or last_history.get("timestamp")))
        if first_live_epoch > last_history_epoch + timeframe_seconds(normalized_timeframe):
            bridge_rows = build_persistent_live_backfill_candles(
                normalized_symbol,
                normalized_timeframe,
                last_history,
                first_live,
            )[:-1]

    merged_rows = merge_candles_by_time([*historical_rows, *bridge_rows, *live_rows])

    if bridge_rows:
        print(
            f"[Persistent live candles] synthetic bridge merge enabled for {normalized_symbol} {normalized_timeframe}: "
            f"provider={len(historical_rows)} live={len(live_rows)} bridge={len(bridge_rows)}"
        )

    return filter_valid_candles_for_symbol(
        merged_rows,
        normalized_symbol,
    )[-safe_limit:]


def rebuild_history_payload_with_saved_live_candles(
    *,
    route_source: str,
    symbol: str,
    timeframe: str,
    payload: Dict[str, Any],
    limit: int,
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))
    raw_candles = payload.get("candles") if isinstance(payload, dict) else []
    candles = raw_candles if isinstance(raw_candles, list) else []
    merged = merge_saved_live_candles_with_history(normalized_symbol, normalized_timeframe, candles, safe_limit)

    rebuilt = build_candle_route_payload(
        route_source=route_source,
        symbol=normalized_symbol,
        timeframe=normalized_timeframe,
        candles=merged,
        provider=str(payload.get("provider") or payload.get("source") or "insightsentry") if isinstance(payload, dict) else "insightsentry",
        cache_label=str(payload.get("cache") or "provider_plus_persistent_live") if isinstance(payload, dict) else "provider_plus_persistent_live",
    )

    rebuilt["persistentLiveCandlesMerged"] = len(merged) != len(candles)
    rebuilt["providerHistoryCount"] = len(candles)
    rebuilt["savedLiveCandleCount"] = max(0, len(merged) - len(candles))
    rebuilt["syntheticLiveBackfillEnabled"] = bool(PERSISTENT_LIVE_BACKFILL_ENABLED)
    rebuilt["syntheticBackfillWarning"] = None if PERSISTENT_LIVE_BACKFILL_ENABLED else "disabled_to_prevent_fake_candles"

    return rebuilt

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


def _ghost_ml_direction_from_text(value: Any, fallback: str = "neutral") -> str:
    text = str(value or "").lower()

    if (
        "bull" in text
        or "buy" in text
        or "long" in text
        or "up" in text
        or "demand" in text
        or "discount" in text
        or "sell-side" in text
        or "sell side" in text
    ):
        return "bullish"

    if (
        "bear" in text
        or "sell" in text
        or "short" in text
        or "down" in text
        or "supply" in text
        or "premium" in text
        or "buy-side" in text
        or "buy side" in text
    ):
        return "bearish"

    return fallback


def _ghost_ml_collect_overlay_items(overlays: Dict[str, Any], *keys: str) -> List[Dict[str, Any]]:
    if not isinstance(overlays, dict):
        return []

    items: List[Dict[str, Any]] = []

    for key in keys:
        value = overlays.get(key)
        if isinstance(value, list):
            items.extend([item for item in value if isinstance(item, dict)])

    return items


def calculate_ghost_ml_overlay_bias(overlays: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Build ghost projection bias from SMC + AlphaX/DLM + OrderBlocks + FVG + sweeps only.

    Explicit exclusions:
    - NRTR is not used.
    - SMMA is not used.
    - Editable chart settings are not used.
    """
    if not isinstance(overlays, dict):
        return {
            "bias": 0.0,
            "direction": "neutral",
            "bullScore": 0.0,
            "bearScore": 0.0,
            "source": "no_overlay_context",
            "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_GHOST_ONLY",
            "nrtrUsedForMl": 0,
            "smmaUsedForMl": 0,
        }

    bull_score = 0.0
    bear_score = 0.0

    smc_items = _ghost_ml_collect_overlay_items(overlays, "smcEvents", "liquidityEvents")
    zone_items = _ghost_ml_collect_overlay_items(overlays, "zones", "orderBlocks")
    dlm_items = _ghost_ml_collect_overlay_items(overlays, "dlmLevels")
    profile_items = _ghost_ml_collect_overlay_items(overlays, "liquidityProfileBins", "alphaProfileBins")

    for item in smc_items[-16:]:
        direction = _ghost_ml_direction_from_text(
            item.get("direction")
            or item.get("bias")
            or item.get("side")
            or item.get("label")
            or item.get("kind")
            or item.get("type")
        )
        weight = 1.35 if "choch" in str(item.get("tag") or item.get("label") or "").lower() else 1.15

        if direction == "bullish":
            bull_score += weight
        elif direction == "bearish":
            bear_score += weight

    for item in zone_items[-16:]:
        text = str(
            item.get("kind")
            or item.get("type")
            or item.get("label")
            or item.get("name")
            or ""
        ).lower()
        direction = _ghost_ml_direction_from_text(
            item.get("direction")
            or item.get("bias")
            or item.get("side")
            or text
        )

        weight = 1.40 if "order" in text or "ob" in text else 1.15 if "fvg" in text or "imbalance" in text else 0.85

        if "discount" in text:
            direction = "bullish"
            weight = max(weight, 1.10)
        elif "premium" in text:
            direction = "bearish"
            weight = max(weight, 1.10)

        if direction == "bullish":
            bull_score += weight
        elif direction == "bearish":
            bear_score += weight

    for item in dlm_items[-18:]:
        direction = _ghost_ml_direction_from_text(
            item.get("direction")
            or item.get("bias")
            or item.get("side")
            or item.get("label")
        )

        if direction == "bullish":
            bull_score += 1.15
        elif direction == "bearish":
            bear_score += 1.15

    strong_profile = [
        item for item in profile_items[-50:]
        if to_float(item.get("widthPct", item.get("volumePct")), 0) >= 35
        or to_float(item.get("buyPressurePct", item.get("buyPct")), 0) >= 55
        or to_float(item.get("sellPressurePct", item.get("sellPct")), 0) >= 55
    ]

    for item in strong_profile[-20:]:
        buy_pct = to_float(item.get("buyPressurePct", item.get("buyPct")), 0)
        sell_pct = to_float(item.get("sellPressurePct", item.get("sellPct")), 0)
        direction = _ghost_ml_direction_from_text(item.get("direction") or item.get("bias"))

        if buy_pct > sell_pct and buy_pct >= 45:
            direction = "bullish"
        elif sell_pct > buy_pct and sell_pct >= 45:
            direction = "bearish"

        if direction == "bullish":
            bull_score += 0.55
        elif direction == "bearish":
            bear_score += 0.55

    alpha_meta = overlays.get("alphaProfileMeta", {})
    if isinstance(alpha_meta, dict):
        bull_pressure = to_float(alpha_meta.get("bullPressurePct"), 50)
        bear_pressure = to_float(alpha_meta.get("bearPressurePct"), 50)
        pressure_edge = clamp((bull_pressure - bear_pressure) / 100.0, -0.35, 0.35)

        if pressure_edge > 0:
            bull_score += abs(pressure_edge) * 4.0
        elif pressure_edge < 0:
            bear_score += abs(pressure_edge) * 4.0

    net = bull_score - bear_score
    total = max(bull_score + bear_score, 1.0)
    bias = clamp(net / total, -0.55, 0.55)
    direction = "bullish" if bias > 0.05 else "bearish" if bias < -0.05 else "neutral"

    return {
        "bias": round(bias, 5),
        "direction": direction,
        "bullScore": round(bull_score, 4),
        "bearScore": round(bear_score, 4),
        "source": "SMC_ALPHA_DLM_ORDERBLOCKS_FVG_SWEEPS_ONLY",
        "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_GHOST_ONLY",
        "nrtrUsedForMl": 0,
        "smmaUsedForMl": 0,
    }


def build_python_ghost_candles(
    candles: List[Dict[str, Any]],
    count: int = 3,
    overlays: Optional[Dict[str, Any]] = None,
    symbol: Optional[str] = None,
    timeframe: Optional[str] = None,
) -> List[Dict[str, Any]]:
    if len(candles) < 10:
        return []

    normalized_symbol = normalize_symbol(str(symbol or candles[-1].get("symbol") or ""))
    normalized_timeframe = normalize_timeframe(str(timeframe or candles[-1].get("timeframe") or "1m"))

    ha = build_heikin_ashi_candles(candles)
    atr = average_true_range(candles, 14)
    last = ha[-1]
    last_real = candles[-1]

    if atr <= 0:
        atr = max(
            to_float(last_real.get("high")) - to_float(last_real.get("low")),
            to_float(last_real.get("close")) * 0.001,
            0.01,
        )

    momentum = candle_momentum(ha, 8)
    overlay_bias = calculate_ghost_ml_overlay_bias(overlays)
    structure_bias = to_float(overlay_bias.get("bias"), 0.0)

    # Base direction is chosen from HA momentum + SMC/AlphaX/DLM/OB/FVG/sweep context.
    # NRTR and SMMA are intentionally excluded.
    projected_bias_delta = momentum + structure_bias * atr
    projected_direction = (
        "bullish" if projected_bias_delta > 0
        else "bearish" if projected_bias_delta < 0
        else "neutral"
    )

    try:
        projection_multiplier = get_ghost_ml_projection_multiplier(
            normalized_symbol,
            normalized_timeframe,
            overlays or {},
            projected_direction,
        )
    except Exception as error:
        print(f"[Ghost ML] projection multiplier unavailable: {error}")
        projection_multiplier = 1.0

    try:
        ml_adjustment = get_ghost_ml_confidence_adjustment(
            normalized_symbol,
            normalized_timeframe,
            overlays or {},
            projected_direction,
        )
    except Exception as error:
        print(f"[Ghost ML] confidence adjustment unavailable: {error}")
        ml_adjustment = {
            "ready": False,
            "confidenceMultiplier": 1.0,
            "confidenceBonus": 0,
            "projectionMultiplier": projection_multiplier,
            "reason": "adjustment_unavailable",
            "error": str(error),
            "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_GHOST_ONLY",
            "nrtrUsedForMl": 0,
            "smmaUsedForMl": 0,
        }

    projection_multiplier = clamp(to_float(projection_multiplier, 1.0), 0.70, 1.22)

    prev_open = to_float(last.get("open"))
    prev_close = to_float(last.get("close"))
    ghosts: List[Dict[str, Any]] = []

    for index in range(count):
        decay = 0.82 ** index
        ghost_open = (prev_open + prev_close) / 2.0

        raw_delta = (
            momentum * decay
            + structure_bias * atr * (0.82 ** index)
        ) * projection_multiplier

        if abs(raw_delta) < atr * 0.08:
            raw_delta = (atr * 0.08) * (1 if raw_delta >= 0 else -1)

        ghost_close = ghost_open + raw_delta
        top = max(ghost_open, ghost_close)
        bottom = min(ghost_open, ghost_close)

        wick_multiplier = 0.25 + index * 0.05
        ghost_high = top + atr * wick_multiplier * projection_multiplier
        ghost_low = bottom - atr * wick_multiplier * projection_multiplier

        direction = "bullish" if ghost_close > ghost_open else "bearish" if ghost_close < ghost_open else "neutral"
        base_confidence = round(clamp(18 + abs(raw_delta) / max(atr, 1e-9) * 35 - index * 4, 2, 88))

        try:
            confidence = apply_ghost_ml_confidence(
                base_confidence,
                normalized_symbol,
                normalized_timeframe,
                overlays or {},
                direction,
            )
        except Exception as error:
            print(f"[Ghost ML] confidence apply failed: {error}")
            confidence = base_confidence

        ghosts.append({
            "label": f"ML PY #{index + 1}",
            "open": round(ghost_open, 5),
            "high": round(ghost_high, 5),
            "low": round(ghost_low, 5),
            "close": round(ghost_close, 5),
            "confidence": round(clamp(to_float(confidence, base_confidence), 2, 96)),
            "baseConfidence": base_confidence,
            "direction": direction,
            "source": "python_ghost_ml_auto_learning",
            "mlAdjusted": True,
            "mlReady": bool(ml_adjustment.get("ready")),
            "mlReason": ml_adjustment.get("reason"),
            "mlConfidenceMultiplier": ml_adjustment.get("confidenceMultiplier", 1.0),
            "mlConfidenceBonus": ml_adjustment.get("confidenceBonus", 0),
            "mlProjectionMultiplier": projection_multiplier,
            "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_GHOST_ONLY",
            "nrtrUsedForMl": 0,
            "smmaUsedForMl": 0,
            "structureBias": overlay_bias,
        })

        prev_open = ghost_open
        prev_close = ghost_close

    return [
        ghost for ghost in ghosts
        if is_candle_valid_for_symbol({**ghost, "symbol": normalized_symbol}, normalized_symbol)
    ]





# ─────────────────────────────────────────────────────────────────────────────
# TARGET ML → GHOST COINCIDENCE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def build_target_ml_plan_safe(
    symbol: str,
    timeframe: str,
    candles: List[Dict[str, Any]],
    overlays: Dict[str, Any],
    ghosts: Optional[List[Dict[str, Any]]] = None,
    signal: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Build learned Target ML plan when api/target_ml.py is available.

    Target ML hierarchy:
    - SMC
    - AlphaX / DLM
    - Order Blocks
    - FVG
    - PD zones
    - liquidity sweeps/profile
    - ghost projection history

    Explicitly excludes:
    - NRTR
    - SMMA
    - editable chart settings
    """
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    if build_target_ml_plan is None:
        return {
            "eventType": "TARGET_ML_PLAN",
            "status": "Unavailable",
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "reason": "api.target_ml module unavailable",
            "targetPrice": None,
            "targetConfidence": 0,
            "targetMlReady": False,
            "ghostConfidenceBoost": 0,
            "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_TARGET_GHOST_ONLY",
            "nrtrUsedForMl": 0,
            "smmaUsedForMl": 0,
            "createdAt": now_iso(),
        }

    try:
        plan = build_target_ml_plan(
            normalized_symbol,
            normalized_timeframe,
            candles,
            overlays if isinstance(overlays, dict) else {},
            ghosts or [],
            signal or {},
        )

        if not isinstance(plan, dict):
            raise ValueError("target_ml returned non-dict plan")

        plan["mlHierarchy"] = "SMC_ALPHA_DLM_ORDERBLOCKS_TARGET_GHOST_ONLY"
        plan["nrtrUsedForMl"] = 0
        plan["smmaUsedForMl"] = 0
        return plan
    except Exception as error:
        print(f"[Target ML] plan build failed: {error}")
        return {
            "eventType": "TARGET_ML_PLAN",
            "status": "Error",
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "reason": str(error),
            "targetPrice": None,
            "targetConfidence": 0,
            "targetMlReady": False,
            "ghostConfidenceBoost": 0,
            "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_TARGET_GHOST_ONLY",
            "nrtrUsedForMl": 0,
            "smmaUsedForMl": 0,
            "createdAt": now_iso(),
        }


def align_ghosts_to_target_ml(
    ghosts: List[Dict[str, Any]],
    target_plan: Dict[str, Any],
    symbol: str,
) -> List[Dict[str, Any]]:
    """
    Make ghost candles coincide with the learned Target ML price.

    Behavior:
    - If Target ML has no valid target, keep ghosts unchanged.
    - If Target ML has a target, gradually bends each ghost close toward it.
    - The last ghost close is anchored at the target price.
    - Confidence receives target ML boost when target history is strong.
    """
    if not ghosts or not isinstance(target_plan, dict):
        return ghosts

    normalized_symbol = normalize_symbol(symbol)
    target_price = to_float(
        target_plan.get("targetPrice")
        or target_plan.get("target")
        or target_plan.get("takeProfitPrice")
        or target_plan.get("tp1"),
        0,
    )
    entry_price = to_float(
        target_plan.get("entryPrice")
        or target_plan.get("entry")
        or (ghosts[0].get("open") if ghosts and isinstance(ghosts[0], dict) else 0),
        0,
    )

    if target_price <= 0 or entry_price <= 0:
        return ghosts

    direction = str(target_plan.get("direction") or "").lower()
    if direction not in {"bullish", "bearish"}:
        direction = "bullish" if target_price > entry_price else "bearish" if target_price < entry_price else "neutral"

    if direction == "bullish" and target_price <= entry_price:
        return ghosts
    if direction == "bearish" and target_price >= entry_price:
        return ghosts

    boost = clamp(to_float(target_plan.get("ghostConfidenceBoost"), 0), -8, 12)
    target_confidence = clamp(to_float(target_plan.get("targetConfidence"), 0), 0, 100)
    target_ml_ready = bool(target_plan.get("targetMlReady"))
    target_source = str(target_plan.get("targetSource") or target_plan.get("source") or "target_ml")

    aligned: List[Dict[str, Any]] = []
    total = max(len(ghosts), 1)

    for index, ghost in enumerate(ghosts):
        if not isinstance(ghost, dict):
            continue

        progress = (index + 1) / total
        old_open = to_float(ghost.get("open"), entry_price)
        old_close = to_float(ghost.get("close"), old_open)
        old_high = to_float(ghost.get("high"), max(old_open, old_close))
        old_low = to_float(ghost.get("low"), min(old_open, old_close))

        target_anchor = entry_price + (target_price - entry_price) * progress

        # Early ghosts blend. Final ghost lands exactly on target.
        if index == total - 1:
            new_close = target_price
        else:
            blend = 0.58 + progress * 0.22
            new_close = old_close * (1.0 - blend) + target_anchor * blend

        if index == 0:
            new_open = old_open
        else:
            previous = aligned[-1] if aligned else ghost
            new_open = (to_float(previous.get("open"), old_open) + to_float(previous.get("close"), old_close)) / 2.0

        body_top = max(new_open, new_close)
        body_bottom = min(new_open, new_close)
        old_wick = max(old_high - old_low, abs(old_close - old_open), 0.000001)
        wick = old_wick * (0.34 + progress * 0.08)

        if direction == "bullish":
            new_high = max(old_high, body_top + wick * 0.45, target_price if index == total - 1 else body_top)
            new_low = min(old_low, body_bottom - wick * 0.35)
        elif direction == "bearish":
            new_high = max(old_high, body_top + wick * 0.35)
            new_low = min(old_low, body_bottom - wick * 0.45, target_price if index == total - 1 else body_bottom)
        else:
            new_high = max(old_high, body_top + wick * 0.35)
            new_low = min(old_low, body_bottom - wick * 0.35)

        confidence = clamp(
            to_float(ghost.get("confidence"), 0)
            + boost
            + (target_confidence - 50.0) * 0.05,
            2,
            96,
        )

        next_ghost = dict(ghost)
        per_ghost_target = round_price(normalized_symbol, new_close)

        next_ghost.update({
            "open": round(new_open, 5),
            "high": round(new_high, 5),
            "low": round(new_low, 5),
            "close": round(new_close, 5),
            "confidence": round(confidence),
            "direction": direction,
            "source": f"{ghost.get('source', 'ghost')}+target_ml_aligned",
            "targetMlAligned": True,

            # Per-ghost target: this is what each ghost candle is trying to reach.
            # The frontend table should show this field per row.
            "targetPrice": per_ghost_target,
            "ghostTargetPrice": per_ghost_target,
            "projectedTargetPrice": per_ghost_target,

            # Final learned Target ML objective remains available separately.
            "finalTargetPrice": round_price(normalized_symbol, target_price),
            "overallTargetPrice": round_price(normalized_symbol, target_price),

            "targetStep": index + 1,
            "targetHorizon": total,
            "targetSource": target_source,
            "targetConfidence": round(target_confidence, 2),
            "targetMlReady": target_ml_ready,
            "ghostConfidenceBoost": round(boost, 2),
            "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_TARGET_GHOST_ONLY",
            "nrtrUsedForMl": 0,
            "smmaUsedForMl": 0,
        })

        aligned.append(next_ghost)

    return [
        ghost for ghost in aligned
        if is_candle_valid_for_symbol({**ghost, "symbol": normalized_symbol}, normalized_symbol)
    ] or ghosts


def record_and_evaluate_target_ml_safe(
    symbol: str,
    timeframe: str,
    candles: List[Dict[str, Any]],
    target_plan: Dict[str, Any],
    overlays: Dict[str, Any],
    ghosts: List[Dict[str, Any]],
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    if not candles:
        return {
            "status": "Waiting",
            "reason": "no_candles",
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
        }

    if record_target_ml_projection is not None and isinstance(target_plan, dict):
        try:
            # Record the final Target ML objective.
            record_target_ml_projection(
                normalized_symbol,
                normalized_timeframe,
                candles,
                target_plan,
                overlays if isinstance(overlays, dict) else {},
                ghosts or [],
            )

            # Record each ghost candle as its own target objective.
            # This lets Target ML learn:
            # - Ghost #1 target accuracy
            # - Ghost #2 target accuracy
            # - Ghost #3 target accuracy
            for index, ghost in enumerate(ghosts or []):
                if not isinstance(ghost, dict):
                    continue

                ghost_target = to_float(
                    ghost.get("ghostTargetPrice")
                    or ghost.get("projectedTargetPrice")
                    or ghost.get("targetPrice")
                    or ghost.get("close"),
                    0,
                )

                if ghost_target <= 0:
                    continue

                ghost_target_plan = dict(target_plan)
                ghost_target_plan.update({
                    "target": ghost_target,
                    "targetPrice": ghost_target,
                    "takeProfitPrice": ghost_target,
                    "tp1": ghost_target,
                    "targetSource": f"{target_plan.get('targetSource') or target_plan.get('source') or 'target_ml'}_ghost_{index + 1}",
                    "source": f"{target_plan.get('targetSource') or target_plan.get('source') or 'target_ml'}_ghost_{index + 1}",
                    "horizon": index + 1,
                    "ghostStep": index + 1,
                    "ghostTargetLearning": True,
                    "finalTargetPrice": ghost.get("finalTargetPrice") or target_plan.get("targetPrice"),
                    "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_TARGET_GHOST_ONLY",
                    "nrtrUsedForMl": 0,
                    "smmaUsedForMl": 0,
                })

                record_target_ml_projection(
                    normalized_symbol,
                    normalized_timeframe,
                    candles,
                    ghost_target_plan,
                    overlays if isinstance(overlays, dict) else {},
                    ghosts or [],
                )
        except Exception as error:
            print(f"[Target ML] record failed: {error}")

    if target_ml_summary_from_candles is not None:
        try:
            return target_ml_summary_from_candles(normalized_symbol, normalized_timeframe, candles)
        except Exception as error:
            print(f"[Target ML] summary failed: {error}")

    if evaluate_target_ml_records is not None:
        try:
            return evaluate_target_ml_records(normalized_symbol, normalized_timeframe, candles)
        except Exception as error:
            print(f"[Target ML] evaluate failed: {error}")

    return {
        "status": "Unavailable",
        "reason": "api.target_ml module unavailable",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
    }


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



def calculate_atr_values_for_nrtr(candles: List[Dict[str, Any]], length: int = 14) -> List[Optional[float]]:
    """Wilder ATR used for backend NRTR scorecard context."""
    if not candles or length <= 0:
        return []

    true_ranges: List[float] = []

    for index, candle in enumerate(candles):
        high = to_float(candle.get("high"))
        low = to_float(candle.get("low"))
        previous_close = to_float(candles[index - 1].get("close")) if index > 0 else to_float(candle.get("close"))

        true_ranges.append(
            max(
                high - low,
                abs(high - previous_close),
                abs(low - previous_close),
            )
        )

    atr_values: List[Optional[float]] = [None] * len(true_ranges)
    seed_sum = 0.0

    for index, value in enumerate(true_ranges):
        if index < length:
            seed_sum += value

            if index == length - 1:
                atr_values[index] = seed_sum / length

            continue

        previous_atr = atr_values[index - 1]
        if previous_atr is None:
            atr_values[index] = None
        else:
            atr_values[index] = (previous_atr * (length - 1) + value) / length

    return atr_values


def build_nrtr_scorecard_context(
    candles: List[Dict[str, Any]],
    *,
    atr_length: int = 14,
    atr_multiplier: float = 3.0,
) -> Dict[str, Any]:
    """
    Backend NRTR+ context for scorecards/ML.

    This mirrors the dashboard default:
    - ATR-Based
    - Swing preset
    - ATR multiplier 3.0

    It is not used for drawing the line; the frontend still draws the visual
    NRTR/SuperTrend line. This context lets the backend scorecards and future
    ML know whether NRTR agrees with SMC/OB/PD/Ghost.
    """
    if len(candles) < max(atr_length + 2, 20):
        return {
            "mode": "ATR-Based",
            "preset": "Swing",
            "direction": "neutral",
            "directionValue": 0,
            "trendLineUnified": None,
            "trendDirUnified": 0,
            "buyFlip": False,
            "sellFlip": False,
            "barsInTrend": 0,
            "entryPrice": None,
            "currentPrice": to_float(candles[-1].get("close")) if candles else None,
            "distanceFromLine": None,
            "distancePercent": None,
            "lockedProfit": None,
            "lockedPercent": None,
            "flipHistory": [],
        }

    atr_values = calculate_atr_values_for_nrtr(candles, atr_length)

    final_upper: Optional[float] = None
    final_lower: Optional[float] = None
    previous_final_upper: Optional[float] = None
    previous_final_lower: Optional[float] = None
    previous_supertrend: Optional[float] = None
    direction = 0
    points: List[Dict[str, Any]] = []

    for index, candle in enumerate(candles):
        close = to_float(candle.get("close"))
        high = to_float(candle.get("high"))
        low = to_float(candle.get("low"))
        previous_close = to_float(candles[index - 1].get("close")) if index > 0 else close
        atr = atr_values[index] if index < len(atr_values) else None
        previous_direction = direction

        if atr is None or not math.isfinite(float(atr)):
            points.append(
                {
                    "time": candle.get("time") or candle.get("timestamp"),
                    "price": close,
                    "line": None,
                    "direction": 0,
                    "buy": False,
                    "sell": False,
                    "index": index,
                }
            )
            continue

        hl2 = (high + low) / 2.0
        basic_upper = hl2 + atr_multiplier * atr
        basic_lower = hl2 - atr_multiplier * atr

        if previous_final_upper is None or previous_final_lower is None:
            final_upper = basic_upper
            final_lower = basic_lower
        else:
            final_upper = (
                basic_upper
                if basic_upper < previous_final_upper or previous_close > previous_final_upper
                else previous_final_upper
            )
            final_lower = (
                basic_lower
                if basic_lower > previous_final_lower or previous_close < previous_final_lower
                else previous_final_lower
            )

        if previous_supertrend is None:
            direction = 1 if close >= hl2 else -1
        elif previous_final_upper is not None and abs(previous_supertrend - previous_final_upper) <= 1e-10:
            direction = 1 if close > float(final_upper) else -1
        else:
            direction = -1 if close < float(final_lower) else 1

        trend_line = final_lower if direction == 1 else final_upper

        points.append(
            {
                "time": candle.get("time") or candle.get("timestamp"),
                "price": close,
                "line": trend_line,
                "direction": direction,
                "buy": index > 0 and previous_direction == -1 and direction == 1,
                "sell": index > 0 and previous_direction == 1 and direction == -1,
                "index": index,
            }
        )

        previous_supertrend = trend_line
        previous_final_upper = final_upper
        previous_final_lower = final_lower

    active_points = [point for point in points if point.get("direction") in {1, -1} and point.get("line") is not None]
    if not active_points:
        return {
            "mode": "ATR-Based",
            "preset": "Swing",
            "direction": "neutral",
            "directionValue": 0,
            "trendLineUnified": None,
            "trendDirUnified": 0,
            "buyFlip": False,
            "sellFlip": False,
            "barsInTrend": 0,
            "entryPrice": None,
            "currentPrice": to_float(candles[-1].get("close")) if candles else None,
            "distanceFromLine": None,
            "distancePercent": None,
            "lockedProfit": None,
            "lockedPercent": None,
            "flipHistory": [],
        }

    last_point = active_points[-1]
    last_direction = int(last_point.get("direction") or 0)
    current_price = to_float(last_point.get("price"))
    trend_line = to_float(last_point.get("line"))
    direction_text = "bullish" if last_direction == 1 else "bearish" if last_direction == -1 else "neutral"

    flip_points = [point for point in points if point.get("buy") or point.get("sell")]
    latest_flip = flip_points[-1] if flip_points else None

    if latest_flip:
        entry_index = int(latest_flip.get("index") or 0)
        entry_price = to_float(candles[entry_index].get("close")) if 0 <= entry_index < len(candles) else current_price
        bars_in_trend = max(0, len(candles) - 1 - entry_index)
    else:
        entry_index = 0
        for idx in range(len(points) - 1, -1, -1):
            if int(points[idx].get("direction") or 0) != last_direction:
                entry_index = min(idx + 1, len(candles) - 1)
                break
        entry_price = to_float(candles[entry_index].get("close"))
        bars_in_trend = max(0, len(candles) - 1 - entry_index)

    distance = abs(current_price - trend_line)
    distance_percent = (distance / current_price * 100.0) if current_price else 0.0
    locked_profit = (
        trend_line - entry_price
        if last_direction == 1
        else entry_price - trend_line
        if last_direction == -1
        else 0.0
    )
    locked_percent = (locked_profit / entry_price * 100.0) if entry_price else 0.0

    flip_history = [
        {
            "time": item.get("time"),
            "index": item.get("index"),
            "type": "buy" if item.get("buy") else "sell",
            "price": round(to_float(item.get("price")), 5),
            "line": round(to_float(item.get("line")), 5),
        }
        for item in flip_points[-12:]
    ]

    return {
        "mode": "ATR-Based",
        "preset": "Swing",
        "direction": direction_text,
        "directionValue": last_direction,
        "trendLineUnified": round(trend_line, 5),
        "trendDirUnified": last_direction,
        "buyFlip": bool(last_point.get("buy")),
        "sellFlip": bool(last_point.get("sell")),
        "barsInTrend": bars_in_trend,
        "entryPrice": round(entry_price, 5),
        "currentPrice": round(current_price, 5),
        "distanceFromLine": round(distance, 5),
        "distancePercent": round(distance_percent, 4),
        "lockedProfit": round(locked_profit, 5),
        "lockedPercent": round(locked_percent, 4),
        "flipHistory": flip_history,
    }


def normalize_backend_overlay_payload(
    backend_payload: Dict[str, Any],
    ghosts: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Normalize api/overlay_engine.py unified output into the chartOverlays shape
    already consumed by the React dashboard.

    Unified architecture rule:
    - /api/candles returns candles + one complete overlayPayload.
    - overlayPayload carries SMC, OBs, PD zones, DLM/profile, and ghosts together.
    - TradingView webhook overlays are no longer required for the dashboard.
    """
    if not isinstance(backend_payload, dict):
        payload = empty_overlay_payload()
        payload["ghostCandles"] = ghosts or []
        payload["source"] = "python_overlay_engine_empty"
        return payload

    profile_bins = backend_payload.get("liquidityProfileBins", [])
    if not isinstance(profile_bins, list):
        profile_bins = []

    alpha_profile_bins: List[Dict[str, Any]] = []
    for item in profile_bins:
        if not isinstance(item, dict):
            continue

        width_pct = to_float(item.get("widthPct", item.get("volumePct")), 0)
        buy_pct = to_float(item.get("buyPct", item.get("buyPressurePct")), 0)
        sell_pct = to_float(item.get("sellPct", item.get("sellPressurePct")), 0)

        normalized_bin = dict(item)
        normalized_bin["volumePct"] = width_pct
        normalized_bin["widthPct"] = width_pct
        normalized_bin["buyPressurePct"] = buy_pct
        normalized_bin["sellPressurePct"] = sell_pct

        # Backwards compatibility for older chart code.
        if "top" not in normalized_bin and "high" in normalized_bin:
            normalized_bin["top"] = normalized_bin.get("high")
        if "bottom" not in normalized_bin and "low" in normalized_bin:
            normalized_bin["bottom"] = normalized_bin.get("low")
        if "mid" not in normalized_bin and "price" in normalized_bin:
            normalized_bin["mid"] = normalized_bin.get("price")

        alpha_profile_bins.append(normalized_bin)

    summary = backend_payload.get("summary", {})
    if not isinstance(summary, dict):
        summary = {}

    dlm_meta = summary.get("dlm", {})
    if not isinstance(dlm_meta, dict):
        dlm_meta = {}

    bull_pressure = to_float(dlm_meta.get("bullPressurePct"), 50)
    bear_pressure = to_float(dlm_meta.get("bearPressurePct"), 50)
    direction = "bullish" if bull_pressure >= bear_pressure else "bearish"
    score = round(max(bull_pressure, bear_pressure))

    last_price = 0.0
    if isinstance(backend_payload.get("dlmLevels"), list):
        for level in backend_payload.get("dlmLevels", []):
            if isinstance(level, dict) and str(level.get("label", "")).lower() == "alphax poc":
                last_price = to_float(level.get("price"), 0)
                break

    lines = backend_payload.get("lines", []) if isinstance(backend_payload.get("lines"), list) else []
    zones = backend_payload.get("zones", []) if isinstance(backend_payload.get("zones"), list) else []
    markers = backend_payload.get("markers", []) if isinstance(backend_payload.get("markers"), list) else []
    smc_events = backend_payload.get("smcEvents", []) if isinstance(backend_payload.get("smcEvents"), list) else []
    order_blocks = backend_payload.get("orderBlocks", []) if isinstance(backend_payload.get("orderBlocks"), list) else []
    liquidity_events = backend_payload.get("liquidityEvents", []) if isinstance(backend_payload.get("liquidityEvents"), list) else []
    dlm_levels = backend_payload.get("dlmLevels", []) if isinstance(backend_payload.get("dlmLevels"), list) else []
    scorecards = backend_payload.get("scorecards", {}) if isinstance(backend_payload.get("scorecards"), dict) else {}
    ml_features = backend_payload.get("mlFeatures", {}) if isinstance(backend_payload.get("mlFeatures"), dict) else {}
    ml_feature_context = backend_payload.get("mlFeatureContext", {}) if isinstance(backend_payload.get("mlFeatureContext"), dict) else {}
    calculation_context = backend_payload.get("calculationContext", {}) if isinstance(backend_payload.get("calculationContext"), dict) else {}

    normalized_ghosts = backend_payload.get("ghostCandles", []) if isinstance(backend_payload.get("ghostCandles"), list) else []
    if ghosts:
        normalized_ghosts = ghosts

    return {
        "lines": lines,
        "zones": zones,
        "markers": markers,
        "smcEvents": smc_events,
        "orderBlocks": order_blocks,
        "liquidityEvents": liquidity_events,
        "liquidityProfileBins": profile_bins,
        "dlmLevels": dlm_levels,
        "ghostCandles": normalized_ghosts,

        # ML-ready scorecard layer.
        "scorecards": scorecards,
        "mlFeatures": ml_features,
        "mlFeatureContext": ml_feature_context,
        "calculationContext": calculation_context,

        # Backwards-compatible names still used by existing chart/panels.
        "dlmConfluenceMarkers": [],
        "scoreMarkers": [{
            "time": now_iso(),
            "price": round(last_price, 5),
            "label": "Python SMC+AlphaX",
            "direction": direction,
            "kind": "python_overlay_engine_score",
            "score": score,
            "grade": "A" if score >= 70 else "B" if score >= 55 else "C",
        }],
        "alphaProfileBins": alpha_profile_bins,
        "alphaProfileMeta": {
            **dlm_meta,
            "bullPressurePct": bull_pressure,
            "bearPressurePct": bear_pressure,
            "source": "api.overlay_engine",
        },
        "summary": summary,
        "overlayVersion": OVERLAY_PAYLOAD_VERSION,
        "source": "python_unified_overlay_engine",
    }


def build_python_chart_overlays(candles: List[Dict[str, Any]], ghosts: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """
    Build SMC + AlphaX DLM overlays directly from backend OHLCV candles.

    This intentionally does NOT depend on TradingView webhook chartOverlays.
    """
    if len(candles) < 30:
        payload = empty_overlay_payload()
        payload["ghostCandles"] = ghosts or []
        payload["source"] = "python_overlay_engine_not_enough_candles"
        return payload

    if build_backend_overlay_payload is not None:
        try:
            try:
                nrtr_context = build_nrtr_scorecard_context(candles)
                backend_payload = build_backend_overlay_payload(
                    candles,
                    internal_pivot_length=5,
                    swing_pivot_length=50,
                    internal_order_blocks=5,
                    swing_order_blocks=5,
                    dlm_lookback=300,
                    dlm_bins=50,
                    nrtr_context=nrtr_context,
                    ghost_candles=ghosts or [],
                )
            except TypeError:
                # Backwards compatibility if an older overlay_engine.py is deployed.
                backend_payload = build_backend_overlay_payload(
                    candles,
                    internal_pivot_length=5,
                    swing_pivot_length=50,
                    internal_order_blocks=5,
                    swing_order_blocks=5,
                    dlm_lookback=300,
                    dlm_bins=50,
                )
            return normalize_backend_overlay_payload(backend_payload, ghosts)
        except Exception as error:
            print(f"[Overlay Engine] api.overlay_engine failed, using legacy fallback: {error}")

    # Legacy fallback kept only as a safety net.
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
        "liquidityProfileBins": dlm.get("profileBins", []),
        "alphaProfileBins": dlm.get("profileBins", []),
        "alphaProfileMeta": meta,
        "ghostCandles": ghosts or [],
        "scorecards": {
            "version": "legacy-scorecards-v1",
            "overall": {
                "direction": direction,
                "netBias": round(bull_pressure - bear_pressure, 2),
                "confirmationScore": round(score, 2),
                "conflictScore": 0,
                "bullScore": round(bull_pressure, 2),
                "bearScore": round(bear_pressure, 2),
                "contextScore": round(score / 10, 2),
            },
            "smc": {"qualityScore": 5, "bullishEvents": 0, "bearishEvents": 0},
            "orderBlocks": {"qualityScore": 5, "bullishZones": 0, "bearishZones": 0},
            "pdZones": {"qualityScore": 5},
            "liquidityProfile": {"qualityScore": round(score / 10, 2), "profileBinCount": len(dlm.get("profileBins", [])), "strongBins": 0},
            "nrtr": build_nrtr_scorecard_context(candles),
            "ghost": {"direction": direction, "confidence": score, "count": len(ghosts or [])},
            "hiddenContext": {"qualityScore": 0, "eqhEqlCount": 0, "fvgCount": 0, "sweepCount": 0, "displacementCount": 0, "inducementCount": 0},
            "activeFactors": {"smcEvents": len(smc_events), "orderBlocks": len(zones), "profileBins": len(dlm.get("profileBins", [])), "ghostCandles": len(ghosts or [])},
        },
        "mlFeatures": {
            "overallDirection": 1 if direction == "bullish" else -1,
            "overallConfirmationScore": round(score, 2),
            "bullScore": round(bull_pressure, 2),
            "bearScore": round(bear_pressure, 2),
        },
        "mlFeatureContext": {},
        "calculationContext": {},
        "source": "python_legacy_overlay_fallback",
    }


def ensure_requested_chart_overlays(
    candles: List[Dict[str, Any]],
    overlays: Dict[str, Any],
    smc: bool = False,
    ghost: bool = False,
    profile: bool = False,
    order_blocks: bool = False,
) -> Dict[str, Any]:
    """Guarantee lightweight drawable overlays for requested toggles.

    Some symbols/timeframes can briefly return empty SMC/AlphaX/Ghost structures.
    The chart should still draw useful lightweight visual levels instead of nothing.
    """
    if not isinstance(overlays, dict):
        overlays = empty_overlay_payload()

    result = dict(overlays)
    if len(candles) < 5:
        return result

    recent = candles[-min(len(candles), 180):]
    last = candles[-1]
    last_close = to_float(last.get("close"))
    highs = [to_float(item.get("high")) for item in recent]
    lows = [to_float(item.get("low")) for item in recent]
    closes = [to_float(item.get("close")) for item in recent]
    high = max(highs) if highs else last_close
    low = min(lows) if lows else last_close
    span = max(high - low, 0.0001)
    mid = (high + low) / 2
    last_time = _overlay_time(last)
    start_time = _overlay_time(recent[0])
    end_time = _overlay_time(last)

    if order_blocks and not result.get("zones"):
        result["zones"] = [
            {
                "startTime": start_time,
                "endTime": end_time,
                "top": round(high, 5),
                "bottom": round(mid, 5),
                "label": "Premium",
                "direction": "bearish",
                "kind": "premium_zone",
            },
            {
                "startTime": start_time,
                "endTime": end_time,
                "top": round(mid, 5),
                "bottom": round(low, 5),
                "label": "Discount",
                "direction": "bullish",
                "kind": "discount_zone",
            },
        ]

    if smc and not result.get("smcEvents"):
        result["smcEvents"] = [
            {
                "time": last_time,
                "price": round(last_close, 5),
                "label": "SMC",
                "direction": "bullish" if last_close >= mid else "bearish",
                "kind": "fallback_smc",
                "score": 55,
            }
        ]

    if smc and not result.get("liquidityEvents"):
        sweep_high = max(highs[-30:]) if len(highs) >= 30 else high
        sweep_low = min(lows[-30:]) if len(lows) >= 30 else low
        result["liquidityEvents"] = [
            {
                "time": last_time,
                "price": round(sweep_high, 5),
                "label": "BS Sweep",
                "direction": "bearish",
                "kind": "fallback_buy_side_sweep",
            },
            {
                "time": last_time,
                "price": round(sweep_low, 5),
                "label": "SS Sweep",
                "direction": "bullish",
                "kind": "fallback_sell_side_sweep",
            },
        ]

    if profile and not result.get("dlmLevels"):
        result["dlmLevels"] = [
            {"label": "AlphaX POC", "price": round(mid, 5), "direction": "neutral"},
            {"label": "DLM Buy Liquidity", "price": round(low + span * 0.25, 5), "direction": "bullish"},
            {"label": "DLM Sell Liquidity", "price": round(high - span * 0.25, 5), "direction": "bearish"},
        ]

    if profile and not result.get("alphaProfileBins"):
        bin_count = 24
        profile_bins = []
        for index in range(bin_count):
            level_low = low + span * index / bin_count
            level_high = low + span * (index + 1) / bin_count
            level_mid = (level_low + level_high) / 2
            touches = sum(1 for close in closes if level_low <= close <= level_high)
            volume_pct = max(3.0, min(100.0, (touches / max(len(closes), 1)) * 260))
            direction = "bullish" if level_mid <= mid else "bearish"
            profile_bins.append({
                "price": round(level_mid, 5),
                "low": round(level_low, 5),
                "high": round(level_high, 5),
                "volumePct": round(volume_pct, 2),
                "direction": direction,
                "label": f"{round(volume_pct)}%",
            })

        result["alphaProfileBins"] = profile_bins
        result["alphaProfileMeta"] = {
            "pocPrice": round(mid, 5),
            "low": round(low, 5),
            "high": round(high, 5),
            "source": "fallback_profile",
        }

    if ghost and not result.get("ghostCandles"):
        direction = "bullish" if len(closes) >= 2 and closes[-1] >= closes[-2] else "bearish"
        step = span * 0.035
        ghost_candles = []
        base = last_close
        for idx in range(3):
            move = step * (idx + 1) * (1 if direction == "bullish" else -1)
            open_price = base + move * 0.35
            close_price = base + move
            high_price = max(open_price, close_price) + step * 0.45
            low_price = min(open_price, close_price) - step * 0.45
            ghost_candles.append({
                "label": f"Ghost #{idx + 1}",
                "open": round(open_price, 5),
                "high": round(high_price, 5),
                "low": round(low_price, 5),
                "close": round(close_price, 5),
                "confidence": max(18, 50 - idx * 8),
                "direction": direction,
                "source": "fallback_ghost",
            })

        result["ghostCandles"] = ghost_candles

    result["fallbackVisualsApplied"] = True
    return result


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
        "lines": [],
        "zones": [],
        "markers": [],
        "smcEvents": [],
        "orderBlocks": [],
        "liquidityEvents": [],
        "liquidityProfileBins": [],
        "dlmLevels": [],
        "ghostCandles": [],
        "dlmConfluenceMarkers": [],
        "scoreMarkers": [],
        "alphaProfileBins": [],
        "alphaProfileMeta": {},
        "overlayVersion": OVERLAY_PAYLOAD_VERSION,
        "source": "empty_overlay_payload",
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



def http_get_json_quick(url: str, headers: Optional[Dict[str, str]] = None, provider: str = "Quick JSON", timeout: int = 7) -> Optional[Dict[str, Any]]:
    request = Request(url, headers=headers or {})
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8", errors="ignore"))
    except Exception as error:
        print(f"[{provider}] quick failed: {error}")
        return None


def http_get_text_quick(url: str, headers: Optional[Dict[str, str]] = None, provider: str = "Quick text", timeout: int = 7) -> Optional[str]:
    request = Request(url, headers=headers or {})
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.read().decode("utf-8", errors="ignore")
    except Exception as error:
        print(f"[{provider}] quick failed: {error}")
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
    text = http_get_text_quick(url, headers=headers, provider="Stooq quotes", timeout=7)

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

    # 1) Yahoo quote endpoint — fast timeout so dashboard does not hang.
    primary_params = urlencode({
        "symbols": ",".join(safe_symbols),
        "formatted": "false",
        "region": "US",
        "lang": "en-US",
        "corsDomain": "finance.yahoo.com",
        "fields": "symbol,shortName,longName,regularMarketPrice,regularMarketChangePercent,regularMarketChange,regularMarketPreviousClose,regularMarketTime,marketCap",
    })

    for host in ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]:
        data = http_get_json_quick(
            f"https://{host}/v7/finance/quote?{primary_params}",
            headers=headers,
            provider="Yahoo Finance quote",
            timeout=6,
        )
        result = data.get("quoteResponse", {}).get("result", []) if isinstance(data, dict) else []
        if isinstance(result, list):
            valid = [
                row for row in result
                if to_float(row.get("regularMarketPrice"), 0.0) > 0
            ]
            if valid:
                return valid

    # 2) Yahoo spark endpoint — batch fallback.
    spark_params = urlencode({
        "symbols": ",".join(safe_symbols),
        "range": "1d",
        "interval": "1m",
        "includePrePost": "true",
        "includeTimestamps": "true",
    })

    for host in ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]:
        data = http_get_json_quick(
            f"https://{host}/v7/finance/spark?{spark_params}",
            headers=headers,
            provider="Yahoo Finance spark",
            timeout=6,
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

    # 3) Stooq delayed batch fallback. This is faster than one-symbol chart calls
    # and prevents the dashboard from staying stuck on "Loading".
    stooq_rows = fetch_stooq_quote_batch(safe_symbols)
    if stooq_rows:
        return stooq_rows

    # 4) Yahoo chart one-symbol-at-a-time fallback. This is the slowest option,
    # so only use it after batch providers fail.
    chart_rows = fetch_yahoo_chart_quotes(safe_symbols)
    if chart_rows:
        return chart_rows

    return []



def _sp500_cache_is_fresh(max_age_seconds: int = 90) -> bool:
    try:
        cached_created_at = str(SP500_HEATMAP_CACHE.get("createdAt") or "")
        cached_payload = SP500_HEATMAP_CACHE.get("payload")
        if not cached_created_at or not cached_payload:
            return False

        cached_dt = datetime.fromisoformat(cached_created_at.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - cached_dt).total_seconds() <= max_age_seconds
    except Exception:
        return False


def _get_sp500_cached_payload() -> Optional[Dict[str, Any]]:
    payload = SP500_HEATMAP_CACHE.get("payload")
    return payload if isinstance(payload, dict) else None


def build_sp500_heatmap_payload(force_refresh: bool = False) -> Dict[str, Any]:
    if not force_refresh and _sp500_cache_is_fresh(90):
        cached = _get_sp500_cached_payload()
        if cached:
            cached_copy = dict(cached)
            cached_copy["cache"] = "fresh"
            return cached_copy

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
        print(f"[S&P 500 Heatmap] quote fetch failed: {error}")
        cached = _get_sp500_cached_payload()
        if cached:
            cached_copy = dict(cached)
            cached_copy["cache"] = "stale_on_error"
            cached_copy["error"] = str(error)
            return cached_copy

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

    payload = {
        "eventType": "SP500_HEATMAP",
        "source": "fast_yahoo_quote_spark_stooq_chart_plus_static_cap_weights",
        "note": "Free quote source. Data may be delayed depending on exchange/vendor rules. Tile size uses static approximate market-cap weights when live market cap is unavailable.",
        "isLiveSnapshot": True,
        "cache": "refreshed",
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

    # Only replace cache with a real populated payload.
    if len(all_stocks) > 0 and any(to_float(stock.get("price")) > 0 for stock in all_stocks):
        SP500_HEATMAP_CACHE["createdAt"] = now_iso()
        SP500_HEATMAP_CACHE["payload"] = payload
    elif _get_sp500_cached_payload():
        cached_copy = dict(_get_sp500_cached_payload() or {})
        cached_copy["cache"] = "stale_no_prices"
        return cached_copy

    return payload


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


def ticker_news_cache_key(symbol: str, limit: int) -> str:
    return f"{normalize_symbol(symbol)}::{int(limit or 10)}"


def ticker_news_cache_get(symbol: str, limit: int, max_age_seconds: int = 300) -> Optional[Dict[str, Any]]:
    key = ticker_news_cache_key(symbol, limit)
    cached = TICKER_NEWS_CACHE.get(key)

    if not isinstance(cached, dict):
        return None

    try:
        created_at = datetime.fromisoformat(str(cached.get("createdAt", "")).replace("Z", "+00:00"))
        if (datetime.now(timezone.utc) - created_at).total_seconds() > max_age_seconds:
            return None
    except Exception:
        return None

    payload = dict(cached)
    payload["cache"] = "fresh"
    return payload


def ticker_news_cache_stale(symbol: str, limit: int) -> Optional[Dict[str, Any]]:
    key = ticker_news_cache_key(symbol, limit)
    cached = TICKER_NEWS_CACHE.get(key)

    if not isinstance(cached, dict):
        return None

    payload = dict(cached)
    payload["cache"] = "stale"
    return payload


def ticker_news_cache_set(symbol: str, limit: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    key = ticker_news_cache_key(symbol, limit)
    stored = dict(payload)
    stored["createdAt"] = now_iso()
    stored["cache"] = "stored"
    TICKER_NEWS_CACHE[key] = stored
    trim_in_memory_cache(TICKER_NEWS_CACHE, MAX_TICKER_NEWS_CACHE_ITEMS, "ticker news cache")
    return stored


def build_ticker_news_payload(symbol: str, limit: int = 10, force_refresh: bool = False) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    news_symbol = normalize_news_symbol(normalized_symbol)
    safe_limit = max(1, min(int(limit or 10), 25))

    if not force_refresh:
        cached = ticker_news_cache_get(normalized_symbol, safe_limit, 300)
        if cached:
            return cached

    source = "yahoo_finance_rss"
    articles: List[Dict[str, Any]] = []

    try:
        articles = fetch_alpha_vantage_news(normalized_symbol, safe_limit)

        if articles:
            source = "alpha_vantage_news_sentiment"
        else:
            articles = fetch_yahoo_rss_news(normalized_symbol, safe_limit)
    except Exception as error:
        print(f"[Ticker News] fetch failed for {normalized_symbol}: {error}")
        stale = ticker_news_cache_stale(normalized_symbol, safe_limit)
        if stale:
            stale["error"] = str(error)
            return stale

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

    payload = {
        "eventType": "TICKER_NEWS_FEED",
        "symbol": normalized_symbol,
        "newsSymbol": news_symbol,
        "category": news_category_for_symbol(normalized_symbol),
        "source": source,
        "cache": "refreshed",
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

    if articles:
        return ticker_news_cache_set(normalized_symbol, safe_limit, payload)

    stale = ticker_news_cache_stale(normalized_symbol, safe_limit)
    return stale or payload


# ─────────────────────────────────────────────────────────────────────────────
# PYTHON-ONLY DASHBOARD SCORECARD BRIDGE
# Links SMC + AlphaX DLM + HA Ghost overlays into dashboard scorecards.
# No webhooks required.
# ─────────────────────────────────────────────────────────────────────────────

def _factor_direction_from_text(value: Any, fallback: str = "neutral") -> str:
    text = str(value or "").lower()
    if "bull" in text or "buy" in text or "up" in text or "long" in text:
        return "bullish"
    if "bear" in text or "sell" in text or "down" in text or "short" in text:
        return "bearish"
    return fallback


def _factor_label(direction: str, label: str) -> str:
    side = _factor_direction_from_text(direction)
    if side == "bullish":
        return f"Bullish {label}"
    if side == "bearish":
        return f"Bearish {label}"
    return f"Neutral {label}"


def analyze_python_core_scorecards(
    candles: List[Dict[str, Any]],
    sentiment: Dict[str, Any],
    ghosts: List[Dict[str, Any]],
    overlays: Dict[str, Any],
) -> Dict[str, Any]:
    if not candles:
        return {
            "signal": "NEUTRAL",
            "confidence": 0,
            "bullScore": 50,
            "bearScore": 50,
            "netBias": 0,
            "smc": "Neutral SMC",
            "alphax": "Neutral AlphaX DLM",
            "ghost": "Neutral Ghost",
            "smcStrength": 0,
            "alphaxStrength": 0,
            "ghostConfidence": 0,
            "smcDirection": "neutral",
            "alphaxDirection": "neutral",
            "ghostDirection": "neutral",
        }

    latest_close = to_float(candles[-1].get("close"))
    technical_sentiment = clamp(to_float(sentiment.get("sentiment"), 50), 0, 100)
    technical_bull = to_float(sentiment.get("bullCount"), 0)
    technical_bear = to_float(sentiment.get("bearCount"), 0)

    smc_events = overlays.get("smcEvents", []) if isinstance(overlays, dict) else []
    liquidity_events = overlays.get("liquidityEvents", []) if isinstance(overlays, dict) else []
    zones = overlays.get("zones", []) if isinstance(overlays, dict) else []
    meta = overlays.get("alphaProfileMeta", {}) if isinstance(overlays, dict) else {}
    dlm_levels = overlays.get("dlmLevels", []) if isinstance(overlays, dict) else []

    recent_smc = smc_events[-5:] if isinstance(smc_events, list) else []
    recent_liquidity = liquidity_events[-5:] if isinstance(liquidity_events, list) else []

    smc_bull = sum(1 for item in recent_smc + recent_liquidity if _factor_direction_from_text(item.get("direction") if isinstance(item, dict) else "") == "bullish")
    smc_bear = sum(1 for item in recent_smc + recent_liquidity if _factor_direction_from_text(item.get("direction") if isinstance(item, dict) else "") == "bearish")

    # Premium/discount context. Discount supports bullish setups; premium supports bearish setups.
    zone_bias = "neutral"
    for zone in zones[-4:] if isinstance(zones, list) else []:
        if not isinstance(zone, dict):
            continue
        top = to_float(zone.get("top"))
        bottom = to_float(zone.get("bottom"))
        kind = str(zone.get("kind") or zone.get("label") or "").lower()
        if min(top, bottom) <= latest_close <= max(top, bottom):
            if "discount" in kind:
                zone_bias = "bullish"
            elif "premium" in kind:
                zone_bias = "bearish"

    if smc_bull > smc_bear:
        smc_direction = "bullish"
    elif smc_bear > smc_bull:
        smc_direction = "bearish"
    else:
        smc_direction = zone_bias

    smc_event_strength = min(28, (len(recent_smc) * 5) + (len(recent_liquidity) * 3))
    smc_zone_strength = 12 if zone_bias != "neutral" else 0
    smc_strength = clamp(42 + smc_event_strength + smc_zone_strength, 0, 100) if smc_direction != "neutral" else clamp(30 + smc_event_strength, 0, 55)

    bull_pressure = clamp(to_float(meta.get("bullPressurePct"), 50), 0, 100)
    bear_pressure = clamp(to_float(meta.get("bearPressurePct"), 50), 0, 100)
    alphax_pressure = max(bull_pressure, bear_pressure)
    alphax_direction = "bullish" if bull_pressure > bear_pressure else "bearish" if bear_pressure > bull_pressure else "neutral"

    # DLM level proximity strengthens AlphaX score.
    nearest_dlm_distance_pct = 100.0
    if isinstance(dlm_levels, list) and dlm_levels:
        distances = []
        for level in dlm_levels:
            if not isinstance(level, dict):
                continue
            price = to_float(level.get("price"))
            if latest_close > 0 and price > 0:
                distances.append(abs(latest_close - price) / latest_close * 100.0)
        if distances:
            nearest_dlm_distance_pct = min(distances)

    proximity_boost = 12 if nearest_dlm_distance_pct <= 0.15 else 7 if nearest_dlm_distance_pct <= 0.35 else 0
    alphax_strength = clamp(alphax_pressure + proximity_boost, 0, 100)

    first_ghost = ghosts[0] if ghosts else {}
    ghost_direction = _factor_direction_from_text(first_ghost.get("direction") if isinstance(first_ghost, dict) else "", "neutral")
    ghost_confidence = clamp(to_float(first_ghost.get("confidence") if isinstance(first_ghost, dict) else 0), 0, 100)
    avg_ghost_confidence = clamp(
        sum(to_float(item.get("confidence"), 0) for item in ghosts if isinstance(item, dict)) / max(len(ghosts), 1),
        0,
        100,
    ) if ghosts else 0
    ghost_strength = max(ghost_confidence, avg_ghost_confidence)

    directional_votes = [
        smc_direction,
        alphax_direction,
        ghost_direction,
        "bullish" if technical_sentiment >= 60 else "bearish" if technical_sentiment <= 40 else "neutral",
    ]
    bull_votes = directional_votes.count("bullish")
    bear_votes = directional_votes.count("bearish")

    bull_score = 50.0
    bear_score = 50.0

    if bull_votes or bear_votes:
        bull_score += bull_votes * 10
        bear_score += bear_votes * 10
        bull_score += max(0, technical_sentiment - 50) * 0.35
        bear_score += max(0, 50 - technical_sentiment) * 0.35
        if alphax_direction == "bullish":
            bull_score += (alphax_strength - 50) * 0.30
        elif alphax_direction == "bearish":
            bear_score += (alphax_strength - 50) * 0.30
        if ghost_direction == "bullish":
            bull_score += ghost_strength * 0.12
        elif ghost_direction == "bearish":
            bear_score += ghost_strength * 0.12
        if smc_direction == "bullish":
            bull_score += smc_strength * 0.12
        elif smc_direction == "bearish":
            bear_score += smc_strength * 0.12

    bull_score = clamp(bull_score, 0, 100)
    bear_score = clamp(bear_score, 0, 100)
    net_bias = round(bull_score - bear_score)

    if net_bias >= 10:
        signal = "BUY"
    elif net_bias <= -10:
        signal = "SELL"
    else:
        signal = "NEUTRAL"

    confidence = clamp(
        max(abs(net_bias), ghost_strength * 0.55, smc_strength * 0.45, alphax_strength * 0.42),
        0,
        100,
    )

    return {
        "signal": signal,
        "confidence": round(confidence),
        "bullScore": round(bull_score),
        "bearScore": round(bear_score),
        "netBias": net_bias,
        "smc": _factor_label(smc_direction, "SMC Structure"),
        "alphax": _factor_label(alphax_direction, "AlphaX DLM"),
        "ghost": _factor_label(ghost_direction, "Ghost Candles"),
        "smcStrength": round(smc_strength),
        "alphaxStrength": round(alphax_strength),
        "ghostConfidence": round(ghost_strength),
        "smcDirection": smc_direction,
        "alphaxDirection": alphax_direction,
        "ghostDirection": ghost_direction,
        "alphaxBullPressure": round(bull_pressure),
        "alphaxBearPressure": round(bear_pressure),
        "alphaxNearestDistancePct": round(nearest_dlm_distance_pct, 4),
        "technicalBullCount": technical_bull,
        "technicalBearCount": technical_bear,
    }


def build_python_dashboard_signal(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 500) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    candles, sentiment_debug = get_sentiment_candles(normalized_symbol, normalized_timeframe, max(500, min(int(limit or 500), 5000)))
    sentiment = calculate_latest_sentiment(candles)
    sentiment["debug"] = sentiment_debug

    # Build SMC/AlphaX/DLM/OB context first, then let Ghost ML use that context.
    preliminary_overlays = build_python_chart_overlays(candles, [])
    base_ghosts = build_python_ghost_candles(
        candles,
        3,
        preliminary_overlays,
        normalized_symbol,
        normalized_timeframe,
    )
    base_overlays = build_python_chart_overlays(candles, base_ghosts)
    base_scorecards = analyze_python_core_scorecards(candles, sentiment, base_ghosts, base_overlays)
    latest_price_for_target = to_float(candles[-1].get("close")) if candles else 0
    target_plan = build_target_ml_plan_safe(
        normalized_symbol,
        normalized_timeframe,
        candles,
        base_overlays,
        base_ghosts,
        {
            "signal": base_scorecards.get("signal"),
            "direction": base_scorecards.get("signal"),
            "entry": latest_price_for_target,
            "price": latest_price_for_target,
            "current": latest_price_for_target,
        },
    )
    ghosts = align_ghosts_to_target_ml(base_ghosts, target_plan, normalized_symbol)
    overlays = build_python_chart_overlays(candles, ghosts)
    overlays["targetMl"] = target_plan
    overlays["targetPlan"] = target_plan
    target_ml_status = record_and_evaluate_target_ml_safe(
        normalized_symbol,
        normalized_timeframe,
        candles,
        target_plan,
        overlays,
        ghosts,
    )
    scorecards = analyze_python_core_scorecards(candles, sentiment, ghosts, overlays)
    fred_macro = build_fred_macro_context()
    options_pressure = build_options_pressure_context(normalized_symbol)
    external_data = build_external_data_context(normalized_symbol, normalized_timeframe) if build_external_data_context else {}
    external_fields = external_data.get("signalFields", {}) if isinstance(external_data, dict) else {}
    external_scalars = external_data.get("scalars", {}) if isinstance(external_data, dict) else {}
    price = to_float(candles[-1].get("close")) if candles else 0

    status = "Live Snapshot" if candles else "Waiting"
    created_at = now_iso()

    return {
        "eventType": "PYTHON_SMC_ALPHAX_GHOST_SIGNAL",
        "status": status,
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "primaryTimeframe": normalized_timeframe,
        "analysisTimeframes": [normalized_timeframe],
        "signal": scorecards["signal"],
        "type": scorecards["signal"],
        "confidence": scorecards["confidence"],
        "bullScore": scorecards["bullScore"],
        "bearScore": scorecards["bearScore"],
        "netBias": scorecards["netBias"],
        "price": price,
        "entry": price,
        "current": price,
        "target": target_plan.get("targetPrice") or target_plan.get("target"),
        "targetPrice": target_plan.get("targetPrice") or target_plan.get("target"),
        "takeProfitPrice": target_plan.get("takeProfitPrice") or target_plan.get("targetPrice"),
        "tp1": target_plan.get("tp1") or target_plan.get("targetPrice"),
        "stop": target_plan.get("stopPrice") or target_plan.get("stop"),
        "stopPrice": target_plan.get("stopPrice") or target_plan.get("stop"),
        "riskReward": target_plan.get("riskReward"),
        "targetSource": target_plan.get("targetSource") or target_plan.get("source"),
        "targetConfidence": target_plan.get("targetConfidence", 0),
        "targetMlReady": target_plan.get("targetMlReady", False),
        "targetMl": target_plan,
        "targetMlStatus": target_ml_status,
        "pnl": 0,
        "percent": 0,
        "smc": scorecards["smc"],
        "alphax": scorecards["alphax"],
        "ghost": scorecards["ghost"],
        "smcStrength": scorecards["smcStrength"],
        "alphaxStrength": scorecards["alphaxStrength"],
        "ghostConfidence": scorecards["ghostConfidence"],
        "smcDirection": scorecards["smcDirection"],
        "alphaxDirection": scorecards["alphaxDirection"],
        "ghostDirection": scorecards["ghostDirection"],
        "alphaxBullPressure": scorecards["alphaxBullPressure"],
        "alphaxBearPressure": scorecards["alphaxBearPressure"],
        "technicalSentiment": sentiment,
        "chartOverlays": overlays,
        "ghostCandles": ghosts,
        "openInterest": external_fields.get("openInterest", "Open Interest Unavailable"),
        "footprint": external_fields.get("footprint", "Footprint Delta Unavailable"),
        "session": "Neutral Session",
        "fredMacro": fred_macro.get("label", external_fields.get("fredMacro", "Active FRED Macro")),
        "fredMacroStrength": fred_macro.get("strength", external_scalars.get("fredMacroStrength", 45)),
        "fredMacroDirection": fred_macro.get("direction", external_scalars.get("fredMacroDirection", "active")),
        "fredMacroRisk": fred_macro.get("risk", external_scalars.get("fredMacroRisk", 35)),
        "macroRisk": fred_macro.get("risk", external_scalars.get("fredMacroRisk", 35)),
        "fredMacroNotes": fred_macro.get("notes", []),
        "fredMacroData": fred_macro,
        "optionsFlow": external_fields.get("optionsFlow", options_pressure.get("label", "Options Flow Inactive")),
        "optionsFlowStrength": external_scalars.get("optionsFlowStrength", options_pressure.get("strength", 0)),
        "optionsFlowDirection": external_scalars.get("optionsFlowDirection", options_pressure.get("direction", "inactive")),
        "optionsPressure": external_data.get("optionsFlow", options_pressure) if isinstance(external_data, dict) else options_pressure,
        "optionsBullPressure": external_scalars.get("optionsBullPressure", options_pressure.get("bullPressure", 0)),
        "optionsBearPressure": external_scalars.get("optionsBearPressure", options_pressure.get("bearPressure", 0)),
        "putCallRatio": external_scalars.get("putCallRatio", options_pressure.get("putCallRatio")),
        "putCallBias": external_fields.get("optionsFlow", options_pressure.get("label", "Options Flow Inactive")),
        "unusualOptionsVolume": external_scalars.get("unusualOptionsVolume", options_pressure.get("unusualVolume", 0)),
        "gammaRisk": external_scalars.get("gammaRisk", options_pressure.get("gammaRisk", 0)),
        "dealerPinZone": external_scalars.get("dealerPinZone", options_pressure.get("dealerPinZone")),
        "optionsConflictRisk": options_pressure.get("conflictRisk", 0),
        "optionsReversalRisk": options_pressure.get("reversalRisk", 0),
        "finraShortVolume": external_fields.get("finraShortVolume", "FINRA Short Volume Unavailable"),
        "cot": external_fields.get("cot", "COT Unavailable"),
        "externalData": external_data,
        "warnings": [],
        "createdAt": created_at,
        "source": "python_only_no_webhook",
    }


# ─────────────────────────────────────────────────────────────────────────────
# PYTHON-ONLY FRED MACRO CONTEXT
# No webhook. Uses public FRED CSV endpoints when available.
# ─────────────────────────────────────────────────────────────────────────────

FRED_MACRO_CACHE: Dict[str, Any] = {
    "createdAt": "",
    "payload": None,
}


def _parse_fred_csv_latest(series_id: str, lookback: int = 12) -> List[float]:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={quote(series_id)}"
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; MARKETBOS-Dashboard/1.0)",
        "Accept": "text/csv,*/*",
    }

    text = http_get_text_or_none(url, headers=headers, provider=f"FRED {series_id}")
    if not text:
        return []

    values: List[float] = []
    try:
        for line in text.splitlines()[1:]:
            parts = line.strip().split(",")
            if len(parts) < 2:
                continue
            value_text = parts[-1].strip()
            if value_text == "." or value_text == "":
                continue
            value = to_float(value_text, None)
            if value is None:
                continue
            values.append(float(value))
    except Exception as error:
        print(f"[FRED Macro] parse failed for {series_id}: {error}")
        return []

    return values[-max(lookback, 2):]


def _series_delta(values: List[float]) -> float:
    if len(values) < 2:
        return 0.0
    return values[-1] - values[-2]


def _series_trend(values: List[float], lookback: int = 5) -> float:
    if len(values) < 2:
        return 0.0
    left = values[-min(len(values), lookback)]
    right = values[-1]
    return right - left


def build_fred_macro_context() -> Dict[str, Any]:
    # Keep FRED calls light; refresh roughly every 60 minutes.
    cached_payload = FRED_MACRO_CACHE.get("payload")
    cached_created_at = str(FRED_MACRO_CACHE.get("createdAt") or "")

    try:
        if cached_payload and cached_created_at:
            cached_dt = datetime.fromisoformat(cached_created_at.replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - cached_dt).total_seconds() < 3600:
                payload = dict(cached_payload)
                payload["cache"] = "fresh"
                return payload
    except Exception:
        pass

    dgs10 = _parse_fred_csv_latest("DGS10", 10)      # 10-year treasury yield
    dff = _parse_fred_csv_latest("DFF", 10)          # effective fed funds rate
    vix = _parse_fred_csv_latest("VIXCLS", 10)       # CBOE volatility index
    sp500 = _parse_fred_csv_latest("SP500", 10)      # S&P 500 index

    yield_delta = _series_delta(dgs10)
    yield_trend = _series_trend(dgs10, 5)
    fed_delta = _series_delta(dff)
    vix_delta = _series_delta(vix)
    vix_value = vix[-1] if vix else 0.0
    spx_trend = _series_trend(sp500, 5)

    risk_score = 35.0
    bull_points = 0
    bear_points = 0
    notes: List[str] = []

    if vix_value:
        if vix_value >= 25:
            bear_points += 2
            risk_score += 20
            notes.append("VIX elevated")
        elif vix_value <= 16:
            bull_points += 1
            risk_score -= 8
            notes.append("VIX calm")

    if vix_delta > 1.5:
        bear_points += 1
        risk_score += 10
        notes.append("VIX rising")
    elif vix_delta < -1.5:
        bull_points += 1
        risk_score -= 6
        notes.append("VIX falling")

    if yield_trend > 0.15:
        bear_points += 1
        risk_score += 8
        notes.append("10Y yield rising")
    elif yield_trend < -0.15:
        bull_points += 1
        risk_score -= 5
        notes.append("10Y yield easing")

    if fed_delta > 0.02:
        bear_points += 1
        risk_score += 6
        notes.append("Fed funds rising")
    elif fed_delta < -0.02:
        bull_points += 1
        risk_score -= 4
        notes.append("Fed funds easing")

    if spx_trend > 0:
        bull_points += 1
        notes.append("SPX trend positive")
    elif spx_trend < 0:
        bear_points += 1
        notes.append("SPX trend negative")

    risk_score = clamp(risk_score, 5, 95)

    if bull_points > bear_points:
        direction = "bullish"
        label = "Bullish FRED Macro"
    elif bear_points > bull_points:
        direction = "bearish"
        label = "Bearish FRED Macro"
    else:
        direction = "active"
        label = "Active FRED Macro"

    if not notes:
        notes.append("FRED macro data active")

    payload = {
        "label": label,
        "direction": direction,
        "risk": round(risk_score),
        "strength": round(max(35, 100 - risk_score if direction == "bullish" else risk_score if direction == "bearish" else 45)),
        "bullPoints": bull_points,
        "bearPoints": bear_points,
        "notes": notes[:5],
        "series": {
            "DGS10": dgs10[-1] if dgs10 else None,
            "DFF": dff[-1] if dff else None,
            "VIXCLS": vix[-1] if vix else None,
            "SP500": sp500[-1] if sp500 else None,
        },
        "createdAt": now_iso(),
        "source": "fred_public_csv",
    }

    FRED_MACRO_CACHE["createdAt"] = now_iso()
    FRED_MACRO_CACHE["payload"] = payload
    return payload


# ─────────────────────────────────────────────────────────────────────────────
# PYTHON-ONLY OPTIONS PRESSURE CONTEXT
# Uses Alpha Vantage if ALPHA_VANTAGE_API_KEY is configured.
# No webhook. Designed first for SPY / ES / MES options pressure.
# ─────────────────────────────────────────────────────────────────────────────

OPTIONS_PRESSURE_CACHE: Dict[str, Any] = {}

SP500_HEATMAP_CACHE: Dict[str, Any] = {"createdAt": "", "payload": None}
TICKER_NEWS_CACHE: Dict[str, Any] = {}


def map_symbol_to_options_underlying(symbol: str) -> str:
    normalized = normalize_symbol(symbol)
    if normalized in {"MES1!", "MES1", "ES1!", "ES1", "ES", "MES", "SPX", "SPX500"}:
        return "SPY"
    if normalized in {"NQ1!", "NQ1", "NQ", "MNQ"}:
        return "QQQ"
    if normalized in {"RTY1!", "RTY1", "RTY", "M2K"}:
        return "IWM"
    if normalized in {"BTCUSD", "BTCUSDT", "ETHUSD", "ETHUSDT"}:
        return ""
    return normalized.replace("!", "")


def normalize_option_type(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"call", "calls", "c"}:
        return "call"
    if text in {"put", "puts", "p"}:
        return "put"
    return ""


def parse_alpha_vantage_option_rows(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not isinstance(data, dict):
        return []

    candidates: List[Any] = []

    for key in ["data", "options", "option_chain", "optionChain", "contracts"]:
        value = data.get(key)
        if isinstance(value, list):
            candidates = value
            break

    if not candidates:
        for value in data.values():
            if isinstance(value, list) and value and isinstance(value[0], dict):
                candidates = value
                break

    rows: List[Dict[str, Any]] = []
    for item in candidates:
        if not isinstance(item, dict):
            continue

        option_type = normalize_option_type(
            item.get("type") or item.get("contractType") or item.get("option_type") or item.get("put_call")
        )
        volume = max(to_float(item.get("volume") or item.get("vol"), 0), 0)
        open_interest = max(to_float(item.get("open_interest") or item.get("openInterest") or item.get("oi"), 0), 0)
        strike = to_float(item.get("strike"), 0)
        gamma = to_float(item.get("gamma"), 0)
        delta = to_float(item.get("delta"), 0)
        implied_volatility = to_float(item.get("implied_volatility") or item.get("impliedVolatility") or item.get("iv"), 0)
        expiration = str(item.get("expiration") or item.get("expiration_date") or item.get("expiry") or "")

        if option_type not in {"call", "put"}:
            symbol_text = str(item.get("contractID") or item.get("symbol") or "").upper()
            if "C" in symbol_text[-9:]:
                option_type = "call"
            elif "P" in symbol_text[-9:]:
                option_type = "put"

        if option_type not in {"call", "put"}:
            continue

        rows.append({
            "type": option_type,
            "volume": volume,
            "openInterest": open_interest,
            "strike": strike,
            "gamma": gamma,
            "delta": delta,
            "iv": implied_volatility,
            "expiration": expiration,
        })

    return rows


def fetch_alpha_vantage_options_chain(underlying: str) -> Dict[str, Any]:
    api_key = os.getenv("ALPHA_VANTAGE_API_KEY", "").strip()
    if not api_key or not underlying:
        return {
            "ok": False,
            "reason": "missing_alpha_vantage_key_or_underlying",
            "rows": [],
        }

    params = urlencode({
        "function": "REALTIME_OPTIONS",
        "symbol": underlying,
        "apikey": api_key,
    })

    url = f"https://www.alphavantage.co/query?{params}"
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; MARKETBOS-Dashboard/1.0)",
        "Accept": "application/json",
    }

    data = http_get_json_or_none(url, headers=headers, provider="Alpha Vantage realtime options")
    if not isinstance(data, dict):
        return {
            "ok": False,
            "reason": "no_response",
            "rows": [],
        }

    if "Information" in data or "Note" in data or "Error Message" in data:
        return {
            "ok": False,
            "reason": str(data.get("Information") or data.get("Note") or data.get("Error Message")),
            "rows": [],
            "rawMeta": {key: data.get(key) for key in ["Information", "Note", "Error Message"] if key in data},
        }

    rows = parse_alpha_vantage_option_rows(data)
    return {
        "ok": bool(rows),
        "reason": "ok" if rows else "empty_options_rows",
        "rows": rows,
    }


def build_options_pressure_context(symbol: str, underlying_override: str = "") -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    underlying = underlying_override.strip().upper() if underlying_override else map_symbol_to_options_underlying(normalized_symbol)

    if not underlying:
        return {
            "label": "Options Flow Inactive",
            "direction": "inactive",
            "status": "INACTIVE",
            "strength": 0,
            "risk": 0,
            "underlying": "",
            "putCallRatio": None,
            "volumeToOpenInterest": None,
            "unusualVolume": 0,
            "gammaRisk": 0,
            "dealerPinZone": None,
            "bullPressure": 0,
            "bearPressure": 0,
            "conflictRisk": 0,
            "reversalRisk": 0,
            "reason": "options_not_applicable_for_symbol",
            "source": "alpha_vantage_realtime_options",
        }

    cache_key = underlying
    cached = OPTIONS_PRESSURE_CACHE.get(cache_key)
    try:
        if cached:
            cached_dt = datetime.fromisoformat(str(cached.get("createdAt")).replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - cached_dt).total_seconds() < 300:
                return cached
    except Exception:
        pass

    chain = fetch_alpha_vantage_options_chain(underlying)
    rows = chain.get("rows", []) if isinstance(chain, dict) else []

    if not rows:
        payload = {
            "label": "Options Flow Inactive",
            "direction": "inactive",
            "status": "INACTIVE",
            "strength": 0,
            "risk": 35 if underlying else 0,
            "underlying": underlying,
            "putCallRatio": None,
            "volumeToOpenInterest": None,
            "unusualVolume": 0,
            "gammaRisk": 0,
            "dealerPinZone": None,
            "bullPressure": 0,
            "bearPressure": 0,
            "conflictRisk": 0,
            "reversalRisk": 0,
            "reason": chain.get("reason", "options_unavailable") if isinstance(chain, dict) else "options_unavailable",
            "source": "alpha_vantage_realtime_options",
            "createdAt": now_iso(),
        }
        OPTIONS_PRESSURE_CACHE[cache_key] = payload
        trim_in_memory_cache(OPTIONS_PRESSURE_CACHE, MAX_OPTIONS_PRESSURE_CACHE_ITEMS, "options pressure cache")
        return payload

    call_volume = sum(to_float(row.get("volume"), 0) for row in rows if row.get("type") == "call")
    put_volume = sum(to_float(row.get("volume"), 0) for row in rows if row.get("type") == "put")
    call_oi = sum(to_float(row.get("openInterest"), 0) for row in rows if row.get("type") == "call")
    put_oi = sum(to_float(row.get("openInterest"), 0) for row in rows if row.get("type") == "put")
    total_volume = call_volume + put_volume
    total_oi = call_oi + put_oi

    put_call_ratio = put_volume / max(call_volume, 1.0)
    volume_to_oi = total_volume / max(total_oi, 1.0)

    unusual_volume = clamp(volume_to_oi * 100.0, 0, 100)
    gamma_rows = [row for row in rows if to_float(row.get("gamma"), 0) > 0 and to_float(row.get("openInterest"), 0) > 0]
    gamma_exposure = sum(abs(to_float(row.get("gamma"), 0)) * to_float(row.get("openInterest"), 0) for row in gamma_rows)
    gamma_risk = clamp(gamma_exposure / max(total_oi, 1.0) * 2500.0, 0, 100)

    # Dealer pin approximation: highest total open interest strike.
    strike_oi: Dict[float, float] = {}
    for row in rows:
        strike = to_float(row.get("strike"), 0)
        if strike <= 0:
            continue
        strike_oi[strike] = strike_oi.get(strike, 0.0) + to_float(row.get("openInterest"), 0)

    dealer_pin_zone = None
    if strike_oi:
        dealer_pin_zone = max(strike_oi.items(), key=lambda item: item[1])[0]

    call_share = call_volume / max(total_volume, 1.0) * 100.0
    put_share = put_volume / max(total_volume, 1.0) * 100.0

    bull_pressure = clamp(call_share + max(0, 1.0 - put_call_ratio) * 12.0, 0, 100)
    bear_pressure = clamp(put_share + max(0, put_call_ratio - 1.0) * 12.0, 0, 100)

    if put_call_ratio >= 1.15:
        direction = "bearish"
        label = "Bearish Options Flow"
        strength = bear_pressure
    elif put_call_ratio <= 0.85:
        direction = "bullish"
        label = "Bullish Options Flow"
        strength = bull_pressure
    else:
        direction = "active"
        label = "Balanced Options Flow"
        strength = max(bull_pressure, bear_pressure, 40)

    conflict_risk = clamp(abs(bull_pressure - bear_pressure) < 12 and total_volume > 0 and unusual_volume > 25 and gamma_risk > 35 and 55 or 0)
    reversal_risk = clamp(max(unusual_volume * 0.55, gamma_risk * 0.75, 35 if 0.85 < put_call_ratio < 1.15 else 0), 0, 100)

    payload = {
        "label": label,
        "direction": direction,
        "status": "ACTIVE",
        "strength": round(strength),
        "risk": round(max(gamma_risk, reversal_risk * 0.7)),
        "underlying": underlying,
        "putCallRatio": round(put_call_ratio, 3),
        "volumeToOpenInterest": round(volume_to_oi, 4),
        "unusualVolume": round(unusual_volume),
        "gammaRisk": round(gamma_risk),
        "dealerPinZone": round(dealer_pin_zone, 2) if dealer_pin_zone is not None else None,
        "callVolume": round(call_volume),
        "putVolume": round(put_volume),
        "callOpenInterest": round(call_oi),
        "putOpenInterest": round(put_oi),
        "bullPressure": round(bull_pressure),
        "bearPressure": round(bear_pressure),
        "conflictRisk": round(conflict_risk),
        "reversalRisk": round(reversal_risk),
        "reason": "ok",
        "source": "alpha_vantage_realtime_options",
        "createdAt": now_iso(),
    }

    OPTIONS_PRESSURE_CACHE[cache_key] = payload
    trim_in_memory_cache(OPTIONS_PRESSURE_CACHE, MAX_OPTIONS_PRESSURE_CACHE_ITEMS, "options pressure cache")
    return payload


# ─────────────────────────────────────────────────────────────────────────────
# FAST CHART OVERLAY ROUTE
# Phase 1 speed fix:
# - main chart candles load first from /api/historical-candles
# - SMC + AlphaX DLM + HA Ghost overlays load separately from /api/chart-overlays
# - cached/stale overlay response prevents chart from waiting on heavy calculations
# ─────────────────────────────────────────────────────────────────────────────

def chart_overlay_cache_key(
    symbol: str,
    timeframe: str,
    limit: int,
    smc: bool = False,
    ghost: bool = False,
    profile: bool = False,
    order_blocks: bool = False,
) -> str:
    flags = f"smc={int(bool(smc))}:ghost={int(bool(ghost))}:profile={int(bool(profile))}:ob={int(bool(order_blocks))}"
    return f"{normalize_symbol(symbol)}::{normalize_timeframe(timeframe)}::{int(limit or 500)}::{flags}"


def chart_overlay_raw_cache_key(symbol: str, timeframe: str, limit: int) -> str:
    return f"{normalize_symbol(symbol)}::{normalize_timeframe(timeframe)}::{int(limit or 500)}::raw_full"


def chart_overlay_raw_cache_is_fresh(key: str, max_age_seconds: int = 45) -> bool:
    cached = CHART_OVERLAY_RAW_CACHE.get(key)
    if not isinstance(cached, dict):
        return False

    try:
        created_at = datetime.fromisoformat(str(cached.get("createdAt", "")).replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - created_at).total_seconds() <= max_age_seconds
    except Exception:
        return False


def get_or_build_raw_chart_overlays(
    symbol: str,
    timeframe: str,
    limit: int,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(120, min(int(limit or 500), 350))
    raw_key = chart_overlay_raw_cache_key(normalized_symbol, normalized_timeframe, safe_limit)

    if not force_refresh and chart_overlay_raw_cache_is_fresh(raw_key):
        cached = CHART_OVERLAY_RAW_CACHE.get(raw_key)
        if isinstance(cached, dict):
            payload = dict(cached)
            payload["cache"] = "raw_fresh"
            return payload

    cached_payload = CHART_OVERLAY_RAW_CACHE.get(raw_key)

    try:
        candles = get_dashboard_candles(normalized_symbol, normalized_timeframe, safe_limit)

        # Build SMC/AlphaX/DLM/OB context first, then generate ML-adjusted ghosts.
        preliminary_overlays = build_python_chart_overlays(candles, [])
        base_ghosts = build_python_ghost_candles(
            candles,
            3,
            preliminary_overlays,
            normalized_symbol,
            normalized_timeframe,
        )
        base_overlays = build_python_chart_overlays(candles, base_ghosts)
        latest_price_for_target = to_float(candles[-1].get("close")) if candles else 0
        target_plan = build_target_ml_plan_safe(
            normalized_symbol,
            normalized_timeframe,
            candles,
            base_overlays,
            base_ghosts,
            {
                "entry": latest_price_for_target,
                "price": latest_price_for_target,
                "current": latest_price_for_target,
            },
        )
        ghosts = align_ghosts_to_target_ml(base_ghosts, target_plan, normalized_symbol)
        raw_overlays = build_python_chart_overlays(candles, ghosts)
        if isinstance(raw_overlays, dict):
            raw_overlays["targetMl"] = target_plan
            raw_overlays["targetPlan"] = target_plan
        target_ml_status = record_and_evaluate_target_ml_safe(
            normalized_symbol,
            normalized_timeframe,
            candles,
            target_plan,
            raw_overlays if isinstance(raw_overlays, dict) else {},
            ghosts,
        )

        payload = {
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "limit": safe_limit,
            "candlesCount": len(candles),
            "rawOverlays": raw_overlays if isinstance(raw_overlays, dict) else empty_overlay_payload(),
            "ghostCandles": ghosts,
            "targetMl": target_plan,
            "targetPlan": target_plan,
            "targetMlStatus": target_ml_status,
            "cache": "raw_refreshed",
            "source": "python_raw_chart_overlay_cache",
            "createdAt": now_iso(),
        }

        CHART_OVERLAY_RAW_CACHE[raw_key] = payload
        trim_in_memory_cache(CHART_OVERLAY_RAW_CACHE, MAX_CHART_OVERLAY_RAW_CACHE_ITEMS, "raw chart overlay cache")
        return payload
    except Exception as error:
        print(f"[Chart Overlay Raw Cache] build failed: {error}")
        if isinstance(cached_payload, dict):
            payload = dict(cached_payload)
            payload["cache"] = "raw_stale_on_error"
            payload["error"] = str(error)
            return payload

        return {
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "limit": safe_limit,
            "candlesCount": 0,
            "rawOverlays": empty_overlay_payload(),
            "ghostCandles": [],
            "cache": "raw_empty_error",
            "source": "python_raw_chart_overlay_cache",
            "error": str(error),
            "createdAt": now_iso(),
        }


def empty_fast_overlay_response(
    symbol: str,
    timeframe: str,
    limit: int,
    cache: str = "disabled_no_fetch",
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    return {
        "eventType": "CHART_OVERLAYS",
        "status": "Disabled",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "candlesCount": 0,
        "chartOverlays": empty_overlay_payload(),
        "ghostCandles": [],
        "alphaProfileMeta": {},
        "cache": cache,
        "source": "python_fast_chart_overlay_flags",
        "overlayFlags": {
            "smc": False,
            "ghost": False,
            "profile": False,
            "orderBlocks": False,
        },
        "createdAt": now_iso(),
    }


def chart_overlay_cache_is_fresh(key: str, max_age_seconds: int = 12) -> bool:
    cached = CHART_OVERLAY_CACHE.get(key)
    if not isinstance(cached, dict):
        return False

    try:
        created_at = datetime.fromisoformat(str(cached.get("createdAt", "")).replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - created_at).total_seconds() <= max_age_seconds
    except Exception:
        return False


def trim_chart_overlays_for_dashboard(
    overlays: Dict[str, Any],
    smc: bool = False,
    ghost: bool = False,
    profile: bool = False,
    order_blocks: bool = False,
) -> Dict[str, Any]:
    if not isinstance(overlays, dict):
        return empty_overlay_payload()

    trimmed = empty_overlay_payload()

    # Keep payloads minimal and only return overlays requested by the chart UI.
    # This prevents SMC / AlphaX / Ghost calculations from bloating first load.
    if smc:
        if isinstance(overlays.get("smcEvents"), list):
            trimmed["smcEvents"] = overlays["smcEvents"][-12:]

        if isinstance(overlays.get("liquidityEvents"), list):
            trimmed["liquidityEvents"] = overlays["liquidityEvents"][-10:]

        if isinstance(overlays.get("dlmConfluenceMarkers"), list):
            trimmed["dlmConfluenceMarkers"] = overlays["dlmConfluenceMarkers"][-6:]

        if isinstance(overlays.get("scoreMarkers"), list):
            trimmed["scoreMarkers"] = overlays["scoreMarkers"][-1:]

    if order_blocks:
        if isinstance(overlays.get("zones"), list):
            trimmed["zones"] = overlays["zones"][-8:]

    if profile:
        if isinstance(overlays.get("dlmLevels"), list):
            trimmed["dlmLevels"] = overlays["dlmLevels"][-12:]

        profile_source = overlays.get("liquidityProfileBins")
        if not isinstance(profile_source, list):
            profile_source = overlays.get("alphaProfileBins")

        if isinstance(profile_source, list):
            bins = [
                item for item in profile_source
                if isinstance(item, dict) and to_float(item.get("widthPct", item.get("volumePct")), 0) > 1
            ]
            trimmed["liquidityProfileBins"] = bins[-36:]
            trimmed["alphaProfileBins"] = bins[-36:]

        if isinstance(overlays.get("alphaProfileMeta"), dict):
            trimmed["alphaProfileMeta"] = overlays.get("alphaProfileMeta", {})

    if ghost:
        if isinstance(overlays.get("ghostCandles"), list):
            trimmed["ghostCandles"] = overlays["ghostCandles"][:5]

    trimmed["payloadMode"] = "flag_filtered_fast_chart_overlay"
    trimmed["source"] = "python_fast_chart_overlay_flags"
    trimmed["overlayFlags"] = {
        "smc": bool(smc),
        "ghost": bool(ghost),
        "profile": bool(profile),
        "orderBlocks": bool(order_blocks),
    }
    return trimmed


def build_fast_chart_overlay_payload(
    symbol: str = "BTCUSD",
    timeframe: str = "1m",
    limit: int = 500,
    force_refresh: bool = False,
    smc: bool = False,
    ghost: bool = False,
    profile: bool = False,
    order_blocks: bool = False,
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(120, min(int(limit or 500), 350))

    # Fastest possible path: if the chart has all overlay toggles off,
    # return immediately. No candle fetch and no overlay calculation.
    if not any([smc, ghost, profile, order_blocks]):
        return empty_fast_overlay_response(
            normalized_symbol,
            normalized_timeframe,
            safe_limit,
            cache="disabled_no_fetch",
        )

    cache_key = chart_overlay_cache_key(
        normalized_symbol,
        normalized_timeframe,
        safe_limit,
        smc=smc,
        ghost=ghost,
        profile=profile,
        order_blocks=order_blocks,
    )

    if not force_refresh and chart_overlay_cache_is_fresh(cache_key, max_age_seconds=45):
        cached = CHART_OVERLAY_CACHE.get(cache_key)
        if isinstance(cached, dict):
            payload = dict(cached)
            payload["cache"] = "fresh"
            return payload

    cached_payload = CHART_OVERLAY_CACHE.get(cache_key)

    try:
        # Important speed improvement:
        # Build the full raw SMC + AlphaX + Ghost overlay set once per symbol/timeframe.
        # Toggle changes then only filter the cached raw payload instead of recalculating.
        raw_payload = get_or_build_raw_chart_overlays(
            normalized_symbol,
            normalized_timeframe,
            safe_limit,
            force_refresh=force_refresh,
        )
        raw_overlays = raw_payload.get("rawOverlays")
        if not isinstance(raw_overlays, dict):
            raw_overlays = empty_overlay_payload()

        raw_overlays = ensure_requested_chart_overlays(
            candles=get_dashboard_candles(normalized_symbol, normalized_timeframe, safe_limit),
            overlays=raw_overlays,
            smc=smc,
            ghost=ghost,
            profile=profile,
            order_blocks=order_blocks,
        )

        overlays = trim_chart_overlays_for_dashboard(
            raw_overlays,
            smc=smc,
            ghost=ghost,
            profile=profile,
            order_blocks=order_blocks,
        )

        ml_candles = get_dashboard_candles(normalized_symbol, normalized_timeframe, safe_limit)

        if ghost:
            record_ghost_ml_projection(
                normalized_symbol,
                normalized_timeframe,
                ml_candles,
                overlays.get("ghostCandles", []),
                overlays,
            )
            evaluate_ghost_ml_records(
                normalized_symbol,
                normalized_timeframe,
                ml_candles,
            )

        target_plan = raw_payload.get("targetMl") if isinstance(raw_payload.get("targetMl"), dict) else raw_overlays.get("targetMl", {})
        target_ml_status = raw_payload.get("targetMlStatus")
        if not isinstance(target_ml_status, dict):
            target_ml_status = record_and_evaluate_target_ml_safe(
                normalized_symbol,
                normalized_timeframe,
                ml_candles,
                target_plan if isinstance(target_plan, dict) else {},
                overlays,
                overlays.get("ghostCandles", []),
            )

        payload = {
            "eventType": "CHART_OVERLAYS",
            "status": "Live" if to_float(raw_payload.get("candlesCount"), 0) > 0 else "Waiting",
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "candlesCount": int(to_float(raw_payload.get("candlesCount"), 0)),
            "chartOverlays": overlays,
            "ghostCandles": overlays.get("ghostCandles", []),
            "ghostMl": ghost_ml_summary_from_candles(normalized_symbol, normalized_timeframe, ml_candles) if ghost else None,
            "targetMl": target_plan if isinstance(target_plan, dict) else None,
            "targetPlan": target_plan if isinstance(target_plan, dict) else None,
            "targetMlStatus": target_ml_status,
            "targetPrice": target_plan.get("targetPrice") if isinstance(target_plan, dict) else None,
            "targetConfidence": target_plan.get("targetConfidence") if isinstance(target_plan, dict) else 0,
            "alphaProfileMeta": overlays.get("alphaProfileMeta", {}),
            "liquidityProfileBins": overlays.get("liquidityProfileBins", overlays.get("alphaProfileBins", [])),
            "cache": "filtered_from_raw_cache",
            "rawCache": raw_payload.get("cache", "unknown"),
            "source": "python_fast_chart_overlay_flags_raw_cache",
            "overlayFlags": {
                "smc": bool(smc),
                "ghost": bool(ghost),
                "profile": bool(profile),
                "orderBlocks": bool(order_blocks),
            },
            "createdAt": now_iso(),
        }

        CHART_OVERLAY_CACHE[cache_key] = payload
        trim_in_memory_cache(CHART_OVERLAY_CACHE, MAX_CHART_OVERLAY_CACHE_ITEMS, "chart overlay cache")
        return payload
    except Exception as error:
        print(f"[Chart Overlays] build failed: {error}")
        if isinstance(cached_payload, dict):
            payload = dict(cached_payload)
            payload["cache"] = "stale_on_error"
            payload["error"] = str(error)
            return payload

        payload = {
            "eventType": "CHART_OVERLAYS",
            "status": "Error",
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "candlesCount": 0,
            "chartOverlays": empty_overlay_payload(),
            "ghostCandles": [],
            "alphaProfileMeta": {},
            "cache": "empty_error",
            "source": "python_fast_chart_overlay_flags_raw_cache",
            "overlayFlags": {
                "smc": bool(smc),
                "ghost": bool(ghost),
                "profile": bool(profile),
                "orderBlocks": bool(order_blocks),
            },
            "error": str(error),
            "createdAt": now_iso(),
        }
        return payload

# ─────────────────────────────────────────────────────────────────────────────
# BASIC ROUTES
# ─────────────────────────────────────────────────────────────────────────────











@app.get("/api/chart-overlays")
def chart_overlays(
    symbol: str = "BTCUSD",
    timeframe: str = "1m",
    limit: int = 500,
    force: bool = False,
    smc: bool = False,
    ghost: bool = False,
    profile: bool = False,
    orderBlocks: bool = False,
) -> Dict[str, Any]:
    return build_fast_chart_overlay_payload(
        symbol,
        timeframe,
        limit,
        force_refresh=force,
        smc=smc,
        ghost=ghost,
        profile=profile,
        order_blocks=orderBlocks,
    )

@app.get("/api/ghost-ml-status")
def ghost_ml_status(symbol: str = "MES1!", timeframe: str = "1m", limit: int = 500) -> Dict[str, Any]:
    candles = get_dashboard_candles(symbol, timeframe, limit)
    return ghost_ml_summary_from_candles(symbol, timeframe, candles)


@app.post("/api/ghost-evaluate")
def ghost_evaluate(symbol: str = "MES1!", timeframe: str = "1m", limit: int = 500) -> Dict[str, Any]:
    candles = get_dashboard_candles(symbol, timeframe, limit)
    return ghost_ml_summary_from_candles(symbol, timeframe, candles)


@app.get("/api/ghost-ml-export")
def ghost_ml_export_route() -> Dict[str, Any]:
    return ghost_ml_export()


@app.post("/api/ghost-ml-reset")
def ghost_ml_reset_route(symbol: Optional[str] = None, timeframe: Optional[str] = None) -> Dict[str, Any]:
    return reset_ghost_ml_memory(symbol=symbol, timeframe=timeframe)


@app.post("/api/ghost-optimizer")
def ghost_optimizer_route(symbol: str = "", timeframe: str = "") -> Dict[str, Any]:
    if run_ghost_optimizer is None:
        return {
            "eventType": "GHOST_ML_OPTIMIZER",
            "status": "Unavailable",
            "error": "optimizer.py is not available on the Python path",
            "createdAt": now_iso(),
        }

    return run_ghost_optimizer(symbol=symbol, timeframe=timeframe)


@app.post("/api/entry-ml/confidence")
@app.post("/api/entry-ml-confidence")
def entry_ml_confidence_route(payload: EntryMlConfidencePayload) -> Dict[str, Any]:
    if get_entry_ml_confidence is None:
        return {
            "eventType": "ENTRY_ML_CONFIDENCE",
            "status": "Unavailable",
            "error": "api.entry_ml module unavailable",
            "entryConfidence": 0,
            "confidence": 0,
            "confidenceGrade": "F",
            "aiTraderUsable": False,
            "createdAt": now_iso(),
        }

    return get_entry_ml_confidence(
        symbol=payload.symbol or "MES1!",
        timeframe=payload.timeframe or "1m",
        side=payload.side,
        mode=payload.mode or "NRTR",
        entry_price=payload.entryPrice,
        target_price=payload.targetPrice,
        stop_price=payload.stopPrice,
        risk_reward=payload.riskReward,
        scorecards=payload.scorecards if isinstance(payload.scorecards, dict) else {},
        ghost_ml=payload.ghostMl if isinstance(payload.ghostMl, dict) else {},
        target_ml=payload.targetMl if isinstance(payload.targetMl, dict) else {},
        context=payload.context if isinstance(payload.context, dict) else {},
    )


@app.post("/api/entry-ml/record")
@app.post("/api/entry-ml-record")
def entry_ml_record_route(payload: EntryMlRecordPayload) -> Dict[str, Any]:
    if record_entry_ml_trade is None:
        return {
            "eventType": "ENTRY_ML_RECORD",
            "status": "Unavailable",
            "error": "api.entry_ml module unavailable",
            "createdAt": now_iso(),
        }

    return record_entry_ml_trade(
        symbol=payload.symbol or "MES1!",
        timeframe=payload.timeframe or "1m",
        entry_time=payload.entryTime or now_iso(),
        side=payload.side,
        mode=payload.mode or "NRTR",
        entry_price=payload.entryPrice,
        target_price=payload.targetPrice,
        stop_price=payload.stopPrice,
        risk_reward=payload.riskReward,
        scorecards=payload.scorecards if isinstance(payload.scorecards, dict) else {},
        ghost_ml=payload.ghostMl if isinstance(payload.ghostMl, dict) else {},
        target_ml=payload.targetMl if isinstance(payload.targetMl, dict) else {},
        context=payload.context if isinstance(payload.context, dict) else {},
    )


@app.post("/api/entry-ml/close")
@app.post("/api/entry-ml-close")
def entry_ml_close_route(payload: EntryMlClosePayload) -> Dict[str, Any]:
    if close_entry_ml_trade is None:
        return {
            "eventType": "ENTRY_ML_CLOSE",
            "status": "Unavailable",
            "error": "api.entry_ml module unavailable",
            "createdAt": now_iso(),
        }

    result = close_entry_ml_trade(
        symbol=payload.symbol or "MES1!",
        timeframe=payload.timeframe or "1m",
        entry_time=payload.entryTime,
        side=payload.side,
        mode=payload.mode or "NRTR",
        exit_time=payload.exitTime or now_iso(),
        exit_price=payload.exitPrice,
        pnl=payload.pnl,
        pnl_percent=payload.pnlPercent,
        mfe=payload.mfe,
        mae=payload.mae,
        bars_held=payload.barsHeld,
        exit_reason=payload.exitReason,
    )

    return result or {
        "eventType": "ENTRY_ML_CLOSE",
        "status": "NotFound",
        "message": "No matching open entry ML trade was found.",
        "createdAt": now_iso(),
    }


@app.get("/api/entry-ml/summary")
@app.get("/api/entry-ml/status")
@app.get("/api/entry-ml-status")
def entry_ml_status_route(symbol: str = "", timeframe: str = "") -> Dict[str, Any]:
    if entry_ml_summary is None:
        return {
            "eventType": "ENTRY_ML_STATUS",
            "status": "Unavailable",
            "error": "api.entry_ml module unavailable",
            "createdAt": now_iso(),
        }
    return entry_ml_summary(symbol=symbol, timeframe=timeframe)


@app.get("/api/entry-ml/export")
@app.get("/api/entry-ml-export")
def entry_ml_export_route() -> Dict[str, Any]:
    if entry_ml_export is None:
        return {
            "eventType": "ENTRY_ML_EXPORT",
            "status": "Unavailable",
            "error": "api.entry_ml module unavailable",
            "createdAt": now_iso(),
        }
    return entry_ml_export()


@app.post("/api/entry-ml/reset")
@app.post("/api/entry-ml-reset")
def entry_ml_reset_route(symbol: Optional[str] = None, timeframe: Optional[str] = None) -> Dict[str, Any]:
    if reset_entry_ml_memory is None:
        return {
            "eventType": "ENTRY_ML_RESET",
            "status": "Unavailable",
            "error": "api.entry_ml module unavailable",
            "createdAt": now_iso(),
        }
    return reset_entry_ml_memory(symbol=symbol, timeframe=timeframe)


@app.post("/api/ai-trader/decision")
@app.post("/api/ai-trader-decision")
def ai_trader_decision_route(payload: AiTraderDecisionPayload) -> Dict[str, Any]:
    if get_ai_trader_decision is None:
        return {
            "eventType": "AI_TRADER_DECISION",
            "status": "Unavailable",
            "dashboardOnly": True,
            "brokerConnected": False,
            "allowedToTrade": False,
            "decision": "HOLD",
            "confidence": 0,
            "error": "api.ai_trader module unavailable",
            "createdAt": now_iso(),
        }

    return get_ai_trader_decision(**model_to_dict(payload))


@app.post("/api/ai-trader/validate-plan")
@app.post("/api/ai-trader-validate-plan")
def ai_trader_validate_plan_route(payload: AiTraderValidatePlanPayload) -> Dict[str, Any]:
    if validate_ai_trade_plan is None:
        return {
            "eventType": "AI_TRADER_VALIDATE_PLAN",
            "status": "Unavailable",
            "valid": False,
            "dashboardOnly": True,
            "brokerConnected": False,
            "errorCode": "AI_TRADER_VALIDATE_PLAN_UNAVAILABLE",
            "error": "api.ai_trader.validate_ai_trade_plan is unavailable. Update api/ai_trader.py first.",
            "createdAt": now_iso(),
        }

    return validate_ai_trade_plan(**model_to_dict(payload))


@app.post("/api/ai-trader/open")
@app.post("/api/ai-trader-open")
def ai_trader_open_route(payload: AiTraderOpenPayload) -> Dict[str, Any]:
    if open_ai_trade is None:
        return {
            "eventType": "AI_TRADER_OPEN",
            "status": "Unavailable",
            "dashboardOnly": True,
            "brokerConnected": False,
            "opened": False,
            "error": "api.ai_trader module unavailable",
            "createdAt": now_iso(),
        }

    return open_ai_trade(**model_to_dict(payload))


@app.post("/api/ai-trader/close")
@app.post("/api/ai-trader-close")
def ai_trader_close_route(payload: AiTraderClosePayload) -> Dict[str, Any]:
    if close_ai_trade is None:
        return {
            "eventType": "AI_TRADER_CLOSE",
            "status": "Unavailable",
            "dashboardOnly": True,
            "brokerConnected": False,
            "closed": False,
            "error": "api.ai_trader module unavailable",
            "createdAt": now_iso(),
        }

    return close_ai_trade(**model_to_dict(payload))


@app.post("/api/ai-trader/evaluate")
@app.post("/api/ai-trader-evaluate")
def ai_trader_evaluate_route(payload: AiTraderEvaluatePayload) -> Dict[str, Any]:
    if evaluate_ai_trades is None:
        return {
            "eventType": "AI_TRADER_EVALUATE",
            "status": "Unavailable",
            "dashboardOnly": True,
            "brokerConnected": False,
            "error": "api.ai_trader module unavailable",
            "createdAt": now_iso(),
        }

    return evaluate_ai_trades(**model_to_dict(payload))


@app.post("/api/ai-trader/evaluate-open")
@app.post("/api/ai-trader-evaluate-open")
def ai_trader_evaluate_open_route(payload: AiTraderEvaluatePayload) -> Dict[str, Any]:
    # Preferred Phase 1 route name. Uses the same backend evaluator so older
    # frontend calls to /evaluate remain compatible.
    return ai_trader_evaluate_route(payload)


@app.post("/api/ai-trader/diagnostics")
@app.get("/api/ai-trader/diagnostics")
def ai_trader_diagnostics_route(payload: Optional[AiTraderDiagnosticsPayload] = None, symbol: str = "", timeframe: str = "") -> Dict[str, Any]:
    if ai_trader_diagnostics is None:
        return {
            "eventType": "AI_TRADER_DIAGNOSTICS",
            "status": "Unavailable",
            "dashboardOnly": True,
            "brokerConnected": False,
            "errorCode": "AI_TRADER_DIAGNOSTICS_UNAVAILABLE",
            "error": "api.ai_trader.ai_trader_diagnostics is unavailable. Update api/ai_trader.py first.",
            "createdAt": now_iso(),
        }

    data = model_to_dict(payload) if payload is not None else {}
    data.setdefault("symbol", symbol)
    data.setdefault("timeframe", timeframe)
    return ai_trader_diagnostics(**data)


@app.get("/api/ai-trader/control")
@app.get("/api/ai-trader-control")
def ai_trader_control_get_route(symbol: str = "MES1!", timeframe: str = "1m") -> Dict[str, Any]:
    if get_ai_trader_control_state is None:
        raise HTTPException(status_code=503, detail="AI Trader control module unavailable")
    return get_ai_trader_control_state(symbol=symbol, timeframe=timeframe)


@app.post("/api/ai-trader/control")
@app.post("/api/ai-trader-control")
def ai_trader_control_post_route(payload: AiTraderControlPayload) -> Dict[str, Any]:
    if update_ai_trader_control_state is None:
        raise HTTPException(status_code=503, detail="AI Trader control module unavailable")
    return update_ai_trader_control_state(**model_to_dict(payload))


@app.get("/api/ai-trader/summary")
@app.get("/api/ai-trader/status")
@app.get("/api/ai-trader-summary")
def ai_trader_summary_route(symbol: str = "", timeframe: str = "") -> Dict[str, Any]:
    if ai_trader_summary is None:
        return {
            "eventType": "AI_TRADER_SUMMARY",
            "status": "Unavailable",
            "dashboardOnly": True,
            "brokerConnected": False,
            "error": "api.ai_trader module unavailable",
            "createdAt": now_iso(),
        }

    return ai_trader_summary(symbol=symbol, timeframe=timeframe)


@app.get("/api/ai-trader/export")
@app.get("/api/ai-trader-export")
def ai_trader_export_route() -> Dict[str, Any]:
    if ai_trader_export is None:
        return {
            "eventType": "AI_TRADER_EXPORT",
            "status": "Unavailable",
            "dashboardOnly": True,
            "brokerConnected": False,
            "error": "api.ai_trader module unavailable",
            "createdAt": now_iso(),
        }

    return ai_trader_export()


@app.post("/api/ai-trader/reset")
@app.post("/api/ai-trader-reset")
def ai_trader_reset_route(symbol: Optional[str] = None, timeframe: Optional[str] = None) -> Dict[str, Any]:
    if reset_ai_trader_memory is None:
        return {
            "eventType": "AI_TRADER_RESET",
            "status": "Unavailable",
            "dashboardOnly": True,
            "brokerConnected": False,
            "error": "api.ai_trader module unavailable",
            "createdAt": now_iso(),
        }

    return reset_ai_trader_memory(symbol=symbol, timeframe=timeframe)


@app.get("/api/target-ml-status")
def target_ml_status(symbol: str = "MES1!", timeframe: str = "1m", limit: int = 500) -> Dict[str, Any]:
    candles = get_dashboard_candles(symbol, timeframe, limit)
    if target_ml_summary_from_candles is None:
        return {
            "eventType": "TARGET_ML_STATUS",
            "status": "Unavailable",
            "symbol": normalize_symbol(symbol),
            "timeframe": normalize_timeframe(timeframe),
            "error": "api.target_ml module unavailable",
            "createdAt": now_iso(),
        }
    return target_ml_summary_from_candles(symbol, timeframe, candles)


@app.post("/api/target-evaluate")
def target_evaluate(symbol: str = "MES1!", timeframe: str = "1m", limit: int = 500) -> Dict[str, Any]:
    candles = get_dashboard_candles(symbol, timeframe, limit)
    if target_ml_summary_from_candles is None:
        return {
            "eventType": "TARGET_ML_STATUS",
            "status": "Unavailable",
            "symbol": normalize_symbol(symbol),
            "timeframe": normalize_timeframe(timeframe),
            "error": "api.target_ml module unavailable",
            "createdAt": now_iso(),
        }
    return target_ml_summary_from_candles(symbol, timeframe, candles)


@app.get("/api/target-ml-export")
def target_ml_export_route() -> Dict[str, Any]:
    if target_ml_export is None:
        return {
            "eventType": "TARGET_ML_EXPORT",
            "status": "Unavailable",
            "error": "api.target_ml module unavailable",
            "createdAt": now_iso(),
        }
    return target_ml_export()


@app.post("/api/target-ml-reset")
def target_ml_reset_route(symbol: Optional[str] = None, timeframe: Optional[str] = None) -> Dict[str, Any]:
    if reset_target_ml_memory is None:
        return {
            "eventType": "TARGET_ML_RESET",
            "status": "Unavailable",
            "error": "api.target_ml module unavailable",
            "createdAt": now_iso(),
        }
    return reset_target_ml_memory(symbol=symbol, timeframe=timeframe)


@app.get("/api/options-pressure")
def options_pressure(symbol: str = "SPY", underlying: str = "") -> Dict[str, Any]:
    return build_options_pressure_context(symbol, underlying)

@app.get("/api/fred-macro")
def fred_macro() -> Dict[str, Any]:
    return build_fred_macro_context()

@app.get("/api/external-data/status")
def external_data_status(symbol: str = "BTCUSD", timeframe: str = "1m") -> Dict[str, Any]:
    if not build_external_data_status:
        return {
            "eventType": "EXTERNAL_DATA_STATUS",
            "status": "Unavailable",
            "symbol": normalize_symbol(symbol),
            "timeframe": normalize_timeframe(timeframe),
            "massiveKeyPresent": bool(os.getenv("MASSIVE_API_KEY", "")),
            "error": "external_data_engine module unavailable",
            "createdAt": now_iso(),
        }

    return build_external_data_status(symbol, timeframe)


@app.get("/api/external-data/context")
def external_data_context(symbol: str = "BTCUSD", timeframe: str = "1m") -> Dict[str, Any]:
    if not build_external_data_context:
        return {
            "eventType": "EXTERNAL_DATA_CONTEXT",
            "status": "Unavailable",
            "symbol": normalize_symbol(symbol),
            "timeframe": normalize_timeframe(timeframe),
            "error": "external_data_engine module unavailable",
            "createdAt": now_iso(),
        }

    return build_external_data_context(symbol, timeframe)




@app.get("/api/unified-intelligence")
def unified_intelligence(symbol: str = "MES1!", timeframe: str = "1m", limit: int = 500, force: bool = False) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(50, min(int(limit or 500), 5000))
    candles = get_dashboard_candles(normalized_symbol, normalized_timeframe, safe_limit)
    ghosts: List[Dict[str, Any]] = []

    overlay_payload = build_python_chart_overlays(candles, ghosts) if candles else empty_overlay_payload()
    external_data = (
        build_external_data_context(normalized_symbol, normalized_timeframe)
        if build_external_data_context
        else {
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "providerStatus": {"massive": {"configured": False}},
            "signalFields": {},
            "scalars": {},
            "source": "external_data_engine_unavailable",
            "createdAt": now_iso(),
        }
    )

    ml_feature_store_status_payload: Dict[str, Any] = {
        "enabled": bool(get_ml_feature_store_summary),
        "recorded": False,
        "outcomes": {"checked": 0, "resolved": 0},
    }

    if get_ml_feature_store_summary:
        try:
            ml_feature_store_status_payload.update(
                get_ml_feature_store_summary(symbol=normalized_symbol, timeframe=normalized_timeframe)
            )
        except Exception as error:
            ml_feature_store_status_payload["error"] = str(error)[:300]

    if not build_unified_intelligence_object:
        return {
            "eventType": "UNIFIED_INTELLIGENCE",
            "status": "Unavailable",
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "error": "unified_intelligence_engine module unavailable",
            "createdAt": now_iso(),
        }

    payload = build_unified_intelligence_object(
        symbol=normalized_symbol,
        timeframe=normalized_timeframe,
        candles=candles,
        overlay_payload=overlay_payload,
        external_data=external_data,
        ml_feature_store_status=ml_feature_store_status_payload,
    )
    payload["force"] = bool(force)

    # Phase 7: Unified Intelligence now has its own backend learning memory.
    # Save a lightweight context snapshot whenever this route is called, but never
    # let memory write failures break the dashboard. Duplicate snapshots are
    # compressed inside api/unified_intelligence_memory.py.
    if remember_context_snapshot is not None:
        try:
            latest_price = to_float(candles[-1].get("close"), 0) if candles else 0
            learn_result = remember_context_snapshot(
                symbol=normalized_symbol,
                timeframe=normalized_timeframe,
                candles=candles[-200:] if candles else [],
                currentPrice=latest_price,
                signal=LATEST_SIGNAL if isinstance(LATEST_SIGNAL, dict) else {},
                unifiedIntelligence=payload,
                overlayPayload=overlay_payload,
                scorecards=overlay_payload.get("scorecards", {}) if isinstance(overlay_payload, dict) else {},
                mlFeatures=overlay_payload.get("mlFeatures", {}) if isinstance(overlay_payload, dict) else {},
            )
            payload["unifiedMemory"] = learn_result.get("memoryStatus") if isinstance(learn_result, dict) else None
        except Exception as error:
            payload["unifiedMemory"] = {
                "status": "MemoryWarning",
                "error": str(error)[:300],
                "createdAt": now_iso(),
            }
    elif unified_memory_status is not None:
        try:
            payload["unifiedMemory"] = unified_memory_status(symbol=normalized_symbol, timeframe=normalized_timeframe)
        except Exception as error:
            payload["unifiedMemory"] = {"status": "MemoryWarning", "error": str(error)[:300]}

    return payload

@app.get("/api/ticker-news")
def ticker_news(symbol: str = "SPY", limit: int = 10, force: bool = False) -> Dict[str, Any]:
    return build_ticker_news_payload(symbol, limit, force_refresh=force)

@app.get("/api/sp500-heatmap")
def sp500_heatmap(force: bool = False) -> Dict[str, Any]:
    return build_sp500_heatmap_payload(force_refresh=force)

@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "Trading Intelligence Dashboard API",
        "engine": "main_v34_python_overlay_engine",
        "endpoints": [
            "/api/backend-version",
            "/api/latest-signal",
            "/api/recent-signals",
            "/api/recent-candles",
            "/api/historical-candles",
            "/api/candles",
            "/api/candle-cache-status",
            "/api/warm-candle-cache",
            "/api/merged-candles",
            "/api/live-candle",
            "/api/live-price",
            "/api/provider-debug",
            "/api/engine-state",
            "/api/chart-overlays",
            "/api/ghost-ml-status",
            "/api/ghost-evaluate",
            "/api/latest-sentiment",
            "/api/external-data/status",
            "/api/external-data/context",
            "/api/unified-intelligence",
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




@app.get("/api/backend-version")
def backend_version() -> Dict[str, Any]:
    return {
        "backendVersion": "unified-intelligence-v1",
        "hasMlFeatureStoreRoutes": True,
        "hasUnifiedIntelligenceRoute": True,
        "module": __name__,
        "file": __file__,
        "createdAt": now_iso(),
    }

# ─────────────────────────────────────────────────────────────────────────────
# API ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/latest-signal")
def latest_signal(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 500) -> Dict[str, Any]:
    # Webhook payloads are no longer required. Always return a Python-generated
    # SMC + AlphaX DLM + Ghost signal so all scorecards stay linked to the chart engine.
    return build_python_dashboard_signal(symbol, timeframe, limit)



def build_candle_route_payload(
    *,
    route_source: str,
    symbol: str,
    timeframe: str,
    candles: List[Dict[str, Any]],
    provider: Optional[str],
    cache_label: str,
    ghosts: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Build one unified candle response with overlays attached and ML feature capture."""
    overlay_payload = build_python_chart_overlays(candles, ghosts or []) if candles else empty_overlay_payload()
    external_data = (
        build_external_data_context(symbol, timeframe)
        if build_external_data_context
        else {
            "symbol": symbol,
            "timeframe": timeframe,
            "providerStatus": {"massive": {"configured": False}},
            "signalFields": {},
            "scalars": {},
            "source": "external_data_engine_unavailable",
            "createdAt": now_iso(),
        }
    )

    payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "count": len(candles),
        "candles": candles,
        "overlayPayload": overlay_payload,
        "chartOverlays": overlay_payload,
        "liquidityProfileBins": overlay_payload.get("liquidityProfileBins", []),
        "dlmLevels": overlay_payload.get("dlmLevels", []),
        "lines": overlay_payload.get("lines", []),
        "zones": overlay_payload.get("zones", []),
        "markers": overlay_payload.get("markers", []),
        "smcEvents": overlay_payload.get("smcEvents", []),
        "orderBlocks": overlay_payload.get("orderBlocks", []),
        "ghostCandles": overlay_payload.get("ghostCandles", ghosts or []),
        "scorecards": overlay_payload.get("scorecards", {}),
        "mlFeatures": overlay_payload.get("mlFeatures", {}),
        "mlFeatureContext": overlay_payload.get("mlFeatureContext", {}),
        "calculationContext": overlay_payload.get("calculationContext", {}),
        "externalData": external_data,
        "optionsFlow": external_data.get("signalFields", {}).get("optionsFlow"),
        "openInterest": external_data.get("signalFields", {}).get("openInterest"),
        "footprint": external_data.get("signalFields", {}).get("footprint"),
        "fredMacro": external_data.get("signalFields", {}).get("fredMacro"),
        "finraShortVolume": external_data.get("signalFields", {}).get("finraShortVolume"),
        "cot": external_data.get("signalFields", {}).get("cot"),
        "source": route_source,
        "provider": provider,
        "cache": cache_label,
        "overlayVersion": OVERLAY_PAYLOAD_VERSION,
        "createdAt": now_iso(),
    }

    ml_feature_store_status: Dict[str, Any] = {
        "enabled": bool(record_ml_feature_snapshot and update_ml_feature_outcomes),
        "recorded": False,
        "outcomes": {
            "checked": 0,
            "resolved": 0,
        },
    }

    if candles and record_ml_feature_snapshot and update_ml_feature_outcomes:
        try:
            ml_feature_store_status["outcomes"] = update_ml_feature_outcomes(
                symbol,
                timeframe,
                candles,
            )
            record_result = record_ml_feature_snapshot(payload)
            ml_feature_store_status.update(record_result)
        except Exception as error:
            ml_feature_store_status.update(
                {
                    "recorded": False,
                    "error": str(error)[:300],
                }
            )

    payload["mlFeatureStore"] = ml_feature_store_status

    if build_unified_intelligence_object:
        try:
            unified_payload = build_unified_intelligence_object(
                symbol=symbol,
                timeframe=timeframe,
                candles=candles,
                overlay_payload=overlay_payload,
                external_data=external_data,
                ml_feature_store_status=ml_feature_store_status,
            )
            payload["unifiedIntelligence"] = unified_payload
            payload["unifiedIntelligenceSummary"] = {
                "status": unified_payload.get("status"),
                "direction": (unified_payload.get("marketSentiment") or {}).get("direction"),
                "strength": (unified_payload.get("marketSentiment") or {}).get("strength"),
                "aiAction": (unified_payload.get("aiTrader") or {}).get("action"),
                "entrySignal": (unified_payload.get("aiTrader") or {}).get("entrySignal"),
                "exitSignal": (unified_payload.get("aiTrader") or {}).get("exitSignal"),
            }
        except Exception as error:
            payload["unifiedIntelligence"] = {
                "eventType": "UNIFIED_INTELLIGENCE",
                "status": "Error",
                "symbol": symbol,
                "timeframe": timeframe,
                "error": str(error)[:300],
                "createdAt": now_iso(),
            }
    else:
        payload["unifiedIntelligence"] = {
            "eventType": "UNIFIED_INTELLIGENCE",
            "status": "Unavailable",
            "symbol": symbol,
            "timeframe": timeframe,
            "error": "unified_intelligence_engine module unavailable",
            "createdAt": now_iso(),
        }

    return payload


@app.get("/api/ml-feature-store/status")
def ml_feature_store_status(symbol: Optional[str] = None, timeframe: Optional[str] = None) -> Dict[str, Any]:
    if not get_ml_feature_store_summary:
        return {
            "enabled": False,
            "error": "ml_feature_store module unavailable",
            "createdAt": now_iso(),
        }

    try:
        return {
            "enabled": True,
            **get_ml_feature_store_summary(symbol=symbol, timeframe=timeframe),
        }
    except Exception as error:
        return {
            "enabled": False,
            "error": str(error),
            "createdAt": now_iso(),
        }


@app.get("/api/ml-feature-store/recent")
def ml_feature_store_recent(
    symbol: Optional[str] = None,
    timeframe: Optional[str] = None,
    limit: int = 50,
) -> Dict[str, Any]:
    if not get_recent_ml_feature_snapshots:
        return {
            "enabled": False,
            "count": 0,
            "rows": [],
            "error": "ml_feature_store module unavailable",
            "createdAt": now_iso(),
        }

    try:
        return {
            "enabled": True,
            **get_recent_ml_feature_snapshots(
                symbol=symbol,
                timeframe=timeframe,
                limit=limit,
            ),
        }
    except Exception as error:
        return {
            "enabled": False,
            "count": 0,
            "rows": [],
            "error": str(error),
            "createdAt": now_iso(),
        }


@app.get("/api/recent-signals")
def recent_signals(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 50) -> Dict[str, Any]:
    safe_limit = max(1, min(int(limit or 50), 200))
    live_signal = build_python_dashboard_signal(symbol, timeframe, 500)

    webhook_rows = [
        item for item in RECENT_SIGNALS[-safe_limit:]
        if isinstance(item, dict) and str(item.get("eventType") or "").upper() == "TRADE_SIGNAL"
    ]

    signals = webhook_rows if webhook_rows else [live_signal]

    return {
        "count": len(signals),
        "signals": signals,
        "source": "python_smc_alphax_ghost_snapshot" if not webhook_rows else "trade_alerts",
    }


@app.get("/api/recent-candles")
def recent_candles(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 300) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 300), 5000))
    candles = get_live_recent_candles(normalized_symbol, normalized_timeframe)[-safe_limit:]

    return build_candle_route_payload(
        route_source="recent_candles",
        symbol=normalized_symbol,
        timeframe=normalized_timeframe,
        candles=candles,
        provider="tradingview_webhook",
        cache_label="live",
    )


@app.get("/api/historical-candles")
def historical_candles(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 500, force: bool = False) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))

    if not force:
        cached = candle_cache_get("historical", normalized_symbol, normalized_timeframe, safe_limit, CANDLE_SITE_CACHE_MAX_AGE_SECONDS)
        if cached:
            cached_candles = cached.get("candles")
            if isinstance(cached_candles, list):
                rebuilt = build_candle_route_payload(
                    route_source="historical_candle_route",
                    symbol=normalized_symbol,
                    timeframe=normalized_timeframe,
                    candles=cached_candles,
                    provider=cached.get("provider"),
                    cache_label=str(cached.get("cache") or "site_cached"),
                )
                rebuilt["siteCache"] = cached.get("siteCache", True)
                rebuilt["siteCacheAgeSeconds"] = cached.get("siteCacheAgeSeconds")
                return rebuilt
            return cached

    candles = fetch_historical_candles(normalized_symbol, normalized_timeframe, safe_limit)
    provider = candles[-1].get("provider") if candles else None

    payload = build_candle_route_payload(
        route_source="historical_candle_route",
        symbol=normalized_symbol,
        timeframe=normalized_timeframe,
        candles=candles,
        provider=provider,
        cache_label="refreshed",
    )

    if candles:
        return candle_cache_set("historical", normalized_symbol, normalized_timeframe, safe_limit, payload)

    stale = candle_cache_stale("historical", normalized_symbol, normalized_timeframe, safe_limit)
    return stale or payload


@app.get("/api/candles")
def candles(symbol: str = "BTCUSD", timeframe: str = "1m", limit: int = 500, force: bool = False) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))
    use_backend_cache = not force

    if not force:
        cached = candle_cache_get("dashboard", normalized_symbol, normalized_timeframe, safe_limit, CANDLE_SITE_CACHE_MAX_AGE_SECONDS)
        if cached:
            cached_candles = cached.get("candles")
            if isinstance(cached_candles, list):
                if futures_cached_payload_is_stale_against_live(cached, normalized_symbol, normalized_timeframe):
                    use_backend_cache = False
                else:
                    rebuilt = build_candle_route_payload(
                        route_source="dashboard_merged_candles",
                        symbol=normalized_symbol,
                        timeframe=normalized_timeframe,
                        candles=cached_candles,
                        provider=cached.get("provider"),
                        cache_label=str(cached.get("cache") or "site_cached"),
                    )
                    rebuilt["siteCache"] = cached.get("siteCache", True)
                    rebuilt["siteCacheAgeSeconds"] = cached.get("siteCacheAgeSeconds")
                    return rebuilt
            elif not futures_cached_payload_is_stale_against_live(cached, normalized_symbol, normalized_timeframe):
                return cached

    merged = get_dashboard_candles(normalized_symbol, normalized_timeframe, safe_limit, use_cache=use_backend_cache)
    provider = merged[-1].get("provider") if merged else None

    payload = build_candle_route_payload(
        route_source="dashboard_merged_candles",
        symbol=normalized_symbol,
        timeframe=normalized_timeframe,
        candles=merged,
        provider=provider,
        cache_label="refreshed",
    )

    if merged:
        return candle_cache_set("dashboard", normalized_symbol, normalized_timeframe, safe_limit, payload)

    stale = candle_cache_stale("dashboard", normalized_symbol, normalized_timeframe, safe_limit)
    return stale or payload




def _preload_unique_timeframes(timeframes: str) -> List[str]:
    seen: set[str] = set()
    result: List[str] = []
    for item in str(timeframes or "").split(","):
        tf = normalize_timeframe(item.strip())
        if not tf or tf in seen:
            continue
        seen.add(tf)
        result.append(tf)
    return result or ["1m"]


def _best_cached_candles_for_preload(symbol: str, timeframe: str, limit: int) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))

    for route_name in ["dashboard", "historical"]:
        try:
            cached = candle_cache_best(
                route_name,
                normalized_symbol,
                normalized_timeframe,
                1,
                max_age_seconds=max(CANDLE_SITE_CACHE_MAX_AGE_SECONDS, 7 * 24 * 60 * 60),
            )
        except Exception as error:
            print(f"[Preload candles] cache lookup failed for {normalized_symbol} {normalized_timeframe}: {error}")
            cached = None

        raw_candles = cached.get("candles") if isinstance(cached, dict) else None
        if isinstance(raw_candles, list) and raw_candles:
            candles_list = filter_valid_candles_for_symbol(
                [item for item in raw_candles if isinstance(item, dict)],
                normalized_symbol,
            )
            if candles_list:
                return candles_list[-safe_limit:]

    return []


def _store_preload_candle_payload(
    *,
    symbol: str,
    timeframe: str,
    limit: int,
    candles_list: List[Dict[str, Any]],
    provider: str,
    source: str,
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 500), 5000))
    clean_candles = filter_valid_candles_for_symbol(candles_list, normalized_symbol)[-safe_limit:]

    payload = build_candle_route_payload(
        route_source=source,
        symbol=normalized_symbol,
        timeframe=normalized_timeframe,
        candles=clean_candles,
        provider=provider,
        cache_label="preloaded",
    )
    payload["preloaded"] = True
    payload["preloadSource"] = source
    payload["historicalOnly"] = True

    if clean_candles:
        stored_dashboard = candle_cache_set("dashboard", normalized_symbol, normalized_timeframe, safe_limit, payload)
        candle_cache_set("historical", normalized_symbol, normalized_timeframe, safe_limit, payload)
        return stored_dashboard

    return payload


def _preload_mes_history_from_one_minute(timeframe_list: List[str], limit: int) -> List[Dict[str, Any]]:
    normalized_symbol = "MES1!"
    safe_limit = max(1, min(int(limit or 500), 5000))
    unique_timeframes = []
    seen: set[str] = set()
    for timeframe in timeframe_list:
        tf = normalize_timeframe(timeframe)
        if tf and tf not in seen:
            seen.add(tf)
            unique_timeframes.append(tf)

    max_multiplier = max(
        1,
        *[max(1, int(timeframe_seconds(tf) / 60)) for tf in unique_timeframes],
    )
    one_min_limit = max(
        1000,
        min(5000, safe_limit * max_multiplier + 300),
    )
    one_minute = _best_cached_candles_for_preload(normalized_symbol, "1m", one_min_limit)
    one_minute_source = "cached_1m" if one_minute else "provider_1m"

    if len(one_minute) < max(120, min(safe_limit, 300)):
        try:
            fetched = fetch_historical_candles(normalized_symbol, "1m", one_min_limit)
            fetched = filter_valid_candles_for_symbol(fetched, normalized_symbol)
            if len(fetched) > len(one_minute):
                one_minute = fetched
                one_minute_source = "provider_1m"
        except Exception as error:
            print(f"[Preload candles] MES 1m fetch failed: {error}")

    if one_minute:
        one_minute_payload = _store_preload_candle_payload(
            symbol=normalized_symbol,
            timeframe="1m",
            limit=min(one_min_limit, 5000),
            candles_list=one_minute,
            provider="insightsentry",
            source=f"mes_preload_{one_minute_source}",
        )
        one_minute = one_minute_payload.get("candles") if isinstance(one_minute_payload.get("candles"), list) else one_minute

    results: List[Dict[str, Any]] = []

    for tf in unique_timeframes:
        if tf == "1m":
            tf_candles = one_minute[-safe_limit:]
            source = f"mes_preload_{one_minute_source}"
        else:
            tf_candles = resample_candles_to_timeframe(one_minute, tf, safe_limit) if one_minute else []
            source = f"mes_preload_resampled_from_1m_{one_minute_source}"

        if not tf_candles:
            # Last resort: use the normal route for this timeframe. This can hit
            # provider/cache, but only after the single 1m preload attempt failed.
            try:
                fallback_payload = candles(symbol=normalized_symbol, timeframe=tf, limit=safe_limit, force=False)
                fallback_candles = fallback_payload.get("candles") if isinstance(fallback_payload, dict) else []
                if isinstance(fallback_candles, list):
                    tf_candles = [item for item in fallback_candles if isinstance(item, dict)]
                    source = str(fallback_payload.get("source") or "normal_route_fallback")
            except Exception as error:
                print(f"[Preload candles] fallback route failed for {normalized_symbol} {tf}: {error}")

        stored = _store_preload_candle_payload(
            symbol=normalized_symbol,
            timeframe=tf,
            limit=safe_limit,
            candles_list=tf_candles,
            provider="insightsentry" if tf_candles else "unavailable",
            source=source,
        )

        stored_candles = stored.get("candles") if isinstance(stored, dict) else []
        stored_count = len(stored_candles) if isinstance(stored_candles, list) else 0
        results.append({
            "symbol": normalized_symbol,
            "timeframe": tf,
            "count": stored_count,
            "cache": stored.get("cache") if isinstance(stored, dict) else None,
            "provider": stored.get("provider") if isinstance(stored, dict) else "insightsentry",
            "source": stored.get("source") if isinstance(stored, dict) else source,
            "preloaded": stored_count > 0,
            "historicalOnly": True,
            "oneMinuteSource": one_minute_source,
            "oneMinuteCount": len(one_minute),
        })

    return results


@app.get("/api/preload-candles")
def preload_candles(
    symbols: str = "BTCUSD,MES1!,SPY",
    timeframes: str = "1m,5m,10m,15m",
    limit: int = 500,
    historicalOnly: bool = True,
) -> Dict[str, Any]:
    symbol_list = [normalize_symbol(item) for item in symbols.split(",") if item.strip()]
    timeframe_list = _preload_unique_timeframes(timeframes)
    safe_limit = max(1, min(int(limit or 500), 5000))

    results: List[Dict[str, Any]] = []

    for item_symbol in symbol_list:
        if is_futures_symbol(item_symbol):
            # MES boot warmup must not ask InsightSentry separately for 3m/5m/10m.
            # Fetch/cache 1m once, then resample locally so custom timeframes are
            # ready before React mounts charts and starts live streams.
            results.extend(_preload_mes_history_from_one_minute(timeframe_list, safe_limit))
            continue

        for item_timeframe in timeframe_list:
            payload = candles(symbol=item_symbol, timeframe=item_timeframe, limit=safe_limit, force=False)
            results.append({
                "symbol": item_symbol,
                "timeframe": item_timeframe,
                "count": payload.get("count", 0),
                "cache": payload.get("cache"),
                "provider": payload.get("provider"),
                "source": payload.get("source"),
                "preloaded": int(payload.get("count", 0) or 0) > 0,
                "historicalOnly": historicalOnly,
            })

    return {
        "eventType": "CANDLE_PRELOAD",
        "status": "Ready" if all(int(item.get("count", 0) or 0) > 0 for item in results) else "Partial",
        "count": len(results),
        "results": results,
        "createdAt": now_iso(),
    }

@app.get("/api/candle-cache-status")
def candle_cache_status() -> Dict[str, Any]:
    entries: List[Dict[str, Any]] = []

    for key, value in CANDLE_RESPONSE_CACHE.items():
        if not isinstance(value, dict):
            continue

        entries.append({
            "key": key,
            "symbol": value.get("symbol"),
            "timeframe": value.get("timeframe"),
            "count": value.get("count", len(value.get("candles", []) if isinstance(value.get("candles"), list) else [])),
            "provider": value.get("provider"),
            "createdAt": value.get("createdAt"),
            "ageSeconds": candle_cache_age_seconds(value),
        })

    return {
        "eventType": "CANDLE_CACHE_STATUS",
        "status": "Live",
        "siteCache": True,
        "cacheFile": str(CANDLE_CACHE_FILE),
        "count": len(entries),
        "entries": entries,
        "createdAt": now_iso(),
    }


@app.get("/api/site-cache/status")
def site_cache_status() -> Dict[str, Any]:
    if get_site_cache_summary:
        try:
            summary = get_site_cache_summary()
            entries = db_list_candle_cache_entries(300) if db_list_candle_cache_entries else []
            return {
                "eventType": "SITE_CACHE_STATUS",
                "status": "Live",
                "siteCacheDb": True,
                **summary,
                "entries": entries,
            }
        except Exception as error:
            return {
                "eventType": "SITE_CACHE_STATUS",
                "status": "Error",
                "siteCacheDb": False,
                "error": str(error),
                "createdAt": now_iso(),
            }

    return candle_cache_status()


@app.get("/api/chart-settings")
def get_chart_settings(userKey: str = "default") -> Dict[str, Any]:
    if not db_load_chart_settings:
        return {
            "eventType": "CHART_SETTINGS",
            "status": "Unavailable",
            "userKey": userKey,
            "charts": {},
            "error": "site_cache_store module unavailable",
            "createdAt": now_iso(),
        }
    return {
        "eventType": "CHART_SETTINGS",
        "status": "Live",
        **db_load_chart_settings(userKey),
    }


@app.post("/api/chart-settings")
async def save_chart_settings(request: FastAPIRequest) -> Dict[str, Any]:
    if not db_save_chart_settings:
        return {
            "eventType": "CHART_SETTINGS_SAVE",
            "status": "Unavailable",
            "error": "site_cache_store module unavailable",
            "createdAt": now_iso(),
        }

    body = await request.json()
    user_key = str(body.get("userKey") or "default")
    chart_key = str(body.get("chartKey") or "main")
    settings = body.get("settings") if isinstance(body.get("settings"), dict) else {}

    return {
        "eventType": "CHART_SETTINGS_SAVE",
        "status": "Saved",
        **db_save_chart_settings(user_key, chart_key, settings),
    }


@app.get("/api/warm-candle-cache")
def warm_candle_cache(
    symbols: str = "BTCUSD,MES1!",
    timeframes: str = "1m,5m,10m,15m,30m",
    limit: int = 500,
    force: bool = False,
) -> Dict[str, Any]:
    symbol_list = [normalize_symbol(item) for item in symbols.split(",") if item.strip()]
    timeframe_list = [normalize_timeframe(item) for item in timeframes.split(",") if item.strip()]
    safe_limit = max(1, min(int(limit or 500), 1000))

    results: List[Dict[str, Any]] = []

    for item_symbol in symbol_list:
        for item_timeframe in timeframe_list:
            payload = candles(symbol=item_symbol, timeframe=item_timeframe, limit=safe_limit, force=force)
            results.append({
                "symbol": item_symbol,
                "timeframe": item_timeframe,
                "count": payload.get("count", 0),
                "cache": payload.get("cache"),
                "siteCache": payload.get("siteCache"),
                "provider": payload.get("provider"),
            })

    save_persistent_candle_cache()

    return {
        "eventType": "CANDLE_CACHE_WARM",
        "status": "Complete",
        "siteCache": True,
        "count": len(results),
        "results": results,
        "createdAt": now_iso(),
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
    payload = get_live_price_payload(normalized_symbol, normalized_timeframe)

    saved_candle = persist_live_candle_to_history_cache(
        normalized_symbol,
        normalized_timeframe,
        payload,
    )

    if saved_candle:
        payload = dict(payload)
        payload["persistentLiveCandleSaved"] = True
        payload["persistentLiveCandle"] = saved_candle

    return payload


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

    # Build SMC/AlphaX/DLM/OB context first, then generate ML-adjusted ghosts.
    preliminary_overlays = build_python_chart_overlays(candles, [])
    ghosts = build_python_ghost_candles(
        candles,
        3,
        preliminary_overlays,
        normalized_symbol,
        normalized_timeframe,
    )

    overlays = build_python_chart_overlays(candles, ghosts)
    scorecards = analyze_python_core_scorecards(candles, sentiment, ghosts, overlays)

    return {
        "eventType": "ENGINE_STATE",
        "status": "Live" if candles else "Waiting",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "price": to_float(candles[-1].get("close")) if candles else 0,
        "candlesCount": len(candles),
        "sentiment": sentiment,
        "ghostCandles": ghosts,
        "chartOverlays": overlays,
        "overlayPayload": overlays,
        "liquidityProfileBins": overlays.get("liquidityProfileBins", overlays.get("alphaProfileBins", [])) if isinstance(overlays, dict) else [],
        "dlmLevels": overlays.get("dlmLevels", []) if isinstance(overlays, dict) else [],
        "lines": overlays.get("lines", []) if isinstance(overlays, dict) else [],
        "zones": overlays.get("zones", []) if isinstance(overlays, dict) else [],
        "markers": overlays.get("markers", []) if isinstance(overlays, dict) else [],
        "smcEvents": overlays.get("smcEvents", []) if isinstance(overlays, dict) else [],
        "orderBlocks": overlays.get("orderBlocks", []) if isinstance(overlays, dict) else [],
        "overlayVersion": OVERLAY_PAYLOAD_VERSION,
        "scorecards": scorecards,
        "smc": scorecards.get("smc"),
        "alphax": scorecards.get("alphax"),
        "ghost": scorecards.get("ghost"),
        "smcStrength": scorecards.get("smcStrength"),
        "alphaxStrength": scorecards.get("alphaxStrength"),
        "ghostConfidence": scorecards.get("ghostConfidence"),
        "sentimentDebug": sentiment.get("debug", {}),
        "createdAt": now_iso(),
    }



# ─────────────────────────────────────────────────────────────────────────────
# DASHBOARD SNAPSHOT ROUTES
# One backend-for-frontend response so React does not coordinate 8-10 separate
# polling calls and accidentally hammer InsightSentry.
# ─────────────────────────────────────────────────────────────────────────────

def _snapshot_bool(value: Any, fallback: bool = True) -> bool:
    if value is None:
        return fallback
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "on"}:
        return True
    if text in {"0", "false", "no", "n", "off"}:
        return False
    return fallback


def _snapshot_int(value: Any, fallback: int, low: int, high: int) -> int:
    try:
        parsed = int(float(value))
    except Exception:
        parsed = fallback
    return max(low, min(high, parsed))


def _safe_snapshot_section(label: str, builder: Any) -> Dict[str, Any]:
    try:
        value = builder()
        return value if isinstance(value, dict) else {"status": "Invalid", "value": value}
    except Exception as error:
        print(f"[Dashboard Snapshot] {label} failed: {error}")
        return {
            "eventType": f"DASHBOARD_SNAPSHOT_{label.upper()}_ERROR",
            "status": "Error",
            "error": str(error),
            "createdAt": now_iso(),
        }


def build_dashboard_snapshot_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(str(data.get("symbol") or "MES1!"))
    normalized_timeframe = normalize_timeframe(str(data.get("timeframe") or "1m"))
    safe_limit = _snapshot_int(data.get("limit"), 700, 50, 5000)
    include_live = _snapshot_bool(data.get("includeLivePrice"), True)
    include_engine = _snapshot_bool(data.get("includeEngineState"), True)
    include_projection = _snapshot_bool(data.get("includeProjectionEngine"), True)
    include_ai = _snapshot_bool(data.get("includeAiTrader"), True)
    include_candles = _snapshot_bool(data.get("includeCandles"), True)
    force = _snapshot_bool(data.get("force"), False)

    candle_payload: Dict[str, Any] = {}
    candle_list: List[Dict[str, Any]] = []

    if include_candles:
        candle_payload = _safe_snapshot_section(
            "candles",
            lambda: candles(
                symbol=normalized_symbol,
                timeframe=normalized_timeframe,
                limit=safe_limit,
                force=force,
            ),
        )
        raw_candles = candle_payload.get("candles") if isinstance(candle_payload, dict) else []
        if isinstance(raw_candles, list):
            candle_list = [item for item in raw_candles if isinstance(item, dict)]

    live_payload: Dict[str, Any] = {}
    if include_live:
        # Exactly one live-price request per snapshot. This also persists the live
        # candle into the historical/dashboard cache through live_price().
        live_payload = _safe_snapshot_section(
            "live_price",
            lambda: live_price(symbol=normalized_symbol, timeframe=normalized_timeframe),
        )

    engine_payload: Dict[str, Any] = {}
    if include_engine:
        engine_payload = _safe_snapshot_section(
            "engine_state",
            lambda: engine_state(
                symbol=normalized_symbol,
                timeframe=normalized_timeframe,
                limit=max(500, min(safe_limit, 1200)),
            ),
        )

    # Prefer candles returned by the direct candle payload because those include the
    # persistent live-tail bridge/backfill merge. Fall back to engine candles only
    # through state fields if needed.
    latest_price = to_float(
        live_payload.get("price")
        or live_payload.get("currentPrice")
        or (candle_list[-1].get("close") if candle_list else 0)
        or engine_payload.get("price"),
        0,
    )

    projection_payload: Dict[str, Any] = {}
    if include_projection:
        def _build_projection() -> Dict[str, Any]:
            projection_candles = candle_list[-700:] if candle_list else get_dashboard_candles(normalized_symbol, normalized_timeframe, min(safe_limit, 700))
            overlay_payload = engine_payload.get("overlayPayload") or engine_payload.get("chartOverlays") or {}
            sentiment_payload = engine_payload.get("sentiment") if isinstance(engine_payload, dict) else {}
            scorecards_payload = engine_payload.get("scorecards") if isinstance(engine_payload, dict) else {}

            return build_projection_engine_from_dashboard_payload({
                "symbol": normalized_symbol,
                "timeframe": normalized_timeframe,
                "candles": projection_candles,
                "limit": min(safe_limit, 700),
                "ghostCount": _snapshot_int(data.get("ghostCount"), 3, 1, 10),
                "autoRegister": _snapshot_bool(data.get("autoRegister"), True),
                "currentPrice": latest_price,
                "scorecards": scorecards_payload if isinstance(scorecards_payload, dict) else {},
                "mlFeatures": (overlay_payload.get("mlFeatures") if isinstance(overlay_payload, dict) else {}) or {},
                "overlayPayload": overlay_payload if isinstance(overlay_payload, dict) else {},
                "unifiedIntelligence": data.get("unifiedIntelligence") if isinstance(data.get("unifiedIntelligence"), dict) else {},
                "externalTables": {
                    "technicalSentiment": sentiment_payload if isinstance(sentiment_payload, dict) else {},
                },
                "signal": {
                    "symbol": normalized_symbol,
                    "timeframe": normalized_timeframe,
                    "price": latest_price,
                    "current": latest_price,
                    "sentiment": sentiment_payload.get("sentiment") if isinstance(sentiment_payload, dict) else None,
                    "sentimentStatus": sentiment_payload.get("sentimentStatus") if isinstance(sentiment_payload, dict) else None,
                },
            })

        projection_payload = _safe_snapshot_section("projection_engine", _build_projection)

    ai_payload: Dict[str, Any] = {}
    if include_ai:
        control_payload = _safe_snapshot_section(
            "ai_control",
            lambda: get_ai_trader_control_state(symbol=normalized_symbol, timeframe=normalized_timeframe)
            if get_ai_trader_control_state is not None
            else {"status": "Unavailable", "error": "get_ai_trader_control_state unavailable"},
        )
        summary_payload = _safe_snapshot_section(
            "ai_summary",
            lambda: ai_trader_summary(symbol=normalized_symbol, timeframe=normalized_timeframe)
            if ai_trader_summary is not None
            else {"status": "Unavailable", "error": "ai_trader_summary unavailable"},
        )
        diagnostics_payload = _safe_snapshot_section(
            "ai_diagnostics",
            lambda: ai_trader_diagnostics(
                symbol=normalized_symbol,
                timeframe=normalized_timeframe,
                currentPrice=latest_price,
                candles=candle_list[-120:] if candle_list else [],
                includeMemory=False,
            )
            if ai_trader_diagnostics is not None
            else {"status": "Unavailable", "error": "ai_trader_diagnostics unavailable"},
        )
        ai_payload = {
            "control": control_payload,
            "summary": summary_payload,
            "diagnostics": diagnostics_payload,
        }

    return {
        "eventType": "DASHBOARD_SNAPSHOT",
        "status": "Live",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "limit": safe_limit,
        "price": latest_price,
        "candles": candle_payload,
        "livePrice": live_payload,
        "engineState": engine_payload,
        "projectionEngine": projection_payload,
        "aiTrader": ai_payload,
        "rateLimitGuard": {
            "singleSnapshotRoute": True,
            "frontendShouldPreferThisRoute": True,
            "replacesTypicalCalls": [
                "/api/candles",
                "/api/live-price",
                "/api/engine-state",
                "/api/latest-sentiment",
                "/api/projection-engine/build",
                "/api/ai-trader/summary",
                "/api/ai-trader/diagnostics",
                "/api/ai-trader/control",
            ],
        },
        "createdAt": now_iso(),
    }


@app.get("/api/dashboard/snapshot")
@app.get("/api/ai-trader/snapshot")
def dashboard_snapshot_get(
    symbol: str = "MES1!",
    timeframe: str = "1m",
    limit: int = 700,
    includeLivePrice: bool = True,
    includeEngineState: bool = True,
    includeProjectionEngine: bool = True,
    includeAiTrader: bool = True,
    includeCandles: bool = True,
    force: bool = False,
) -> Dict[str, Any]:
    return build_dashboard_snapshot_payload({
        "symbol": symbol,
        "timeframe": timeframe,
        "limit": limit,
        "includeLivePrice": includeLivePrice,
        "includeEngineState": includeEngineState,
        "includeProjectionEngine": includeProjectionEngine,
        "includeAiTrader": includeAiTrader,
        "includeCandles": includeCandles,
        "force": force,
    })


@app.post("/api/dashboard/snapshot")
@app.post("/api/ai-trader/snapshot")
async def dashboard_snapshot_post(request: FastAPIRequest) -> Dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        body = {}

    data = body if isinstance(body, dict) else {}
    return build_dashboard_snapshot_payload(data)


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
# PHASE 7: UNIFIED INTELLIGENCE MEMORY ROUTES
# ─────────────────────────────────────────────────────────────────────────────

def _ui_memory_payload_to_dict(payload: Any) -> Dict[str, Any]:
    data = model_to_dict(payload)
    if not isinstance(data, dict):
        data = {}
    return data


def _ui_memory_symbol_timeframe(data: Dict[str, Any]) -> Tuple[str, str]:
    symbol = normalize_symbol(str(data.get("symbol") or data.get("ticker") or "MES1!"))
    timeframe = normalize_timeframe(str(data.get("timeframe") or data.get("tf") or "1m"))
    return symbol, timeframe


def _ui_memory_candles_from_payload(data: Dict[str, Any], symbol: str, timeframe: str, limit: int) -> List[Dict[str, Any]]:
    raw_candles = data.get("candles")
    candles = raw_candles if isinstance(raw_candles, list) else []

    normalized: List[Dict[str, Any]] = []
    for item in candles:
        if isinstance(item, dict):
            candle = dict(item)
            candle["symbol"] = normalize_symbol(str(candle.get("symbol") or symbol))
            candle["timeframe"] = normalize_timeframe(str(candle.get("timeframe") or timeframe))
            normalized.append(candle)

    normalized = filter_valid_candles_for_symbol(merge_candles_by_time(normalized), symbol)[-limit:]
    if normalized:
        return normalized

    try:
        return get_dashboard_candles(symbol, timeframe, limit)
    except Exception as error:
        print(f"[Unified Intelligence Memory] candle fallback failed: {error}")
        return []


def _ui_memory_context_from_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    context = data.get("context") if isinstance(data.get("context"), dict) else {}

    overlay_payload = (
        data.get("overlayPayload")
        if isinstance(data.get("overlayPayload"), dict)
        else data.get("chartOverlays")
        if isinstance(data.get("chartOverlays"), dict)
        else context.get("overlayPayload")
        if isinstance(context.get("overlayPayload"), dict)
        else context.get("chartOverlays")
        if isinstance(context.get("chartOverlays"), dict)
        else {}
    )

    scorecards = (
        data.get("scorecards")
        if isinstance(data.get("scorecards"), dict)
        else overlay_payload.get("scorecards")
        if isinstance(overlay_payload, dict) and isinstance(overlay_payload.get("scorecards"), dict)
        else context.get("scorecards")
        if isinstance(context.get("scorecards"), dict)
        else {}
    )

    ml_features = (
        data.get("mlFeatures")
        if isinstance(data.get("mlFeatures"), dict)
        else overlay_payload.get("mlFeatures")
        if isinstance(overlay_payload, dict) and isinstance(overlay_payload.get("mlFeatures"), dict)
        else context.get("mlFeatures")
        if isinstance(context.get("mlFeatures"), dict)
        else {}
    )

    unified_intelligence = (
        data.get("unifiedIntelligence")
        if isinstance(data.get("unifiedIntelligence"), dict)
        else context.get("unifiedIntelligence")
        if isinstance(context.get("unifiedIntelligence"), dict)
        else {}
    )

    projection_engine = (
        data.get("projectionEngine")
        if isinstance(data.get("projectionEngine"), dict)
        else data.get("projectionEngineContext")
        if isinstance(data.get("projectionEngineContext"), dict)
        else unified_intelligence.get("projectionEngine")
        if isinstance(unified_intelligence, dict) and isinstance(unified_intelligence.get("projectionEngine"), dict)
        else unified_intelligence.get("unifiedProjectionEngine")
        if isinstance(unified_intelligence, dict) and isinstance(unified_intelligence.get("unifiedProjectionEngine"), dict)
        else context.get("projectionEngine")
        if isinstance(context.get("projectionEngine"), dict)
        else {}
    )

    signal = (
        data.get("signal")
        if isinstance(data.get("signal"), dict)
        else context.get("signal")
        if isinstance(context.get("signal"), dict)
        else LATEST_SIGNAL
        if isinstance(LATEST_SIGNAL, dict)
        else {}
    )

    external_tables = (
        data.get("externalTables")
        if isinstance(data.get("externalTables"), dict)
        else context.get("externalTables")
        if isinstance(context.get("externalTables"), dict)
        else {}
    )

    return {
        "signal": signal if isinstance(signal, dict) else {},
        "unifiedIntelligence": unified_intelligence if isinstance(unified_intelligence, dict) else {},
        "overlayPayload": overlay_payload if isinstance(overlay_payload, dict) else {},
        "scorecards": scorecards if isinstance(scorecards, dict) else {},
        "mlFeatures": ml_features if isinstance(ml_features, dict) else {},
        "externalTables": external_tables if isinstance(external_tables, dict) else {},
        "projectionEngine": projection_engine if isinstance(projection_engine, dict) else {},
    }


def _ui_memory_build_kwargs(data: Dict[str, Any], include_candles: bool = True) -> Dict[str, Any]:
    symbol, timeframe = _ui_memory_symbol_timeframe(data)
    limit = _projection_int(data.get("limit"), 800, 50, 5000)
    candles = _ui_memory_candles_from_payload(data, symbol, timeframe, limit) if include_candles else []
    context = _ui_memory_context_from_payload(data)
    current_price = data.get("currentPrice") or data.get("price") or (candles[-1].get("close") if candles else None)

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "candles": candles,
        "currentPrice": current_price,
        "signal": context["signal"],
        "unifiedIntelligence": context["unifiedIntelligence"],
        "overlayPayload": context["overlayPayload"],
        "scorecards": context["scorecards"],
        "mlFeatures": context["mlFeatures"],
        "projectionEngine": context["projectionEngine"],
    }


@app.post("/api/unified-intelligence/learn")
async def api_unified_intelligence_learn(payload: UnifiedIntelligenceMemoryPayload) -> Dict[str, Any]:
    if remember_context_snapshot is None:
        raise HTTPException(status_code=503, detail="api.unified_intelligence_memory module is unavailable")

    data = _ui_memory_payload_to_dict(payload)
    kwargs = _ui_memory_build_kwargs(data, include_candles=True)
    return remember_context_snapshot(**kwargs)


@app.post("/unified-intelligence/learn")
async def api_unified_intelligence_learn_alias(payload: UnifiedIntelligenceMemoryPayload) -> Dict[str, Any]:
    return await api_unified_intelligence_learn(payload)


@app.post("/api/unified-intelligence/evaluate")
async def api_unified_intelligence_evaluate(payload: UnifiedIntelligenceMemoryPayload) -> Dict[str, Any]:
    if evaluate_unified_intelligence_outcome is None:
        raise HTTPException(status_code=503, detail="api.unified_intelligence_memory module is unavailable")

    data = _ui_memory_payload_to_dict(payload)
    kwargs = _ui_memory_build_kwargs(data, include_candles=True)
    outcome = data.get("outcome") if isinstance(data.get("outcome"), dict) else None
    snapshot_id = str(data.get("snapshotId") or "") or None

    return evaluate_unified_intelligence_outcome(
        snapshotId=snapshot_id,
        outcome=outcome,
        **kwargs,
    )


@app.post("/unified-intelligence/evaluate")
async def api_unified_intelligence_evaluate_alias(payload: UnifiedIntelligenceMemoryPayload) -> Dict[str, Any]:
    return await api_unified_intelligence_evaluate(payload)


@app.get("/api/unified-intelligence/status")
@app.get("/api/unified-intelligence/memory")
@app.get("/api/unified-intelligence-memory/status")
async def api_unified_intelligence_memory_status(symbol: str = "", timeframe: str = "") -> Dict[str, Any]:
    if unified_memory_status is None:
        raise HTTPException(status_code=503, detail="api.unified_intelligence_memory module is unavailable")

    return unified_memory_status(symbol=symbol, timeframe=timeframe)


@app.get("/unified-intelligence/status")
async def api_unified_intelligence_memory_status_alias(symbol: str = "", timeframe: str = "") -> Dict[str, Any]:
    return await api_unified_intelligence_memory_status(symbol=symbol, timeframe=timeframe)


@app.post("/api/unified-intelligence/adjust")
async def api_unified_intelligence_adjust(payload: UnifiedIntelligenceMemoryPayload) -> Dict[str, Any]:
    if apply_unified_memory_adjustments is None:
        raise HTTPException(status_code=503, detail="api.unified_intelligence_memory module is unavailable")

    data = _ui_memory_payload_to_dict(payload)
    symbol, timeframe = _ui_memory_symbol_timeframe(data)
    rows = data.get("rows") if isinstance(data.get("rows"), list) else []
    context = data.get("context") if isinstance(data.get("context"), dict) else {}

    return apply_unified_memory_adjustments(
        symbol=symbol,
        timeframe=timeframe,
        rows=rows,
        context=context,
    )


@app.post("/unified-intelligence/adjust")
async def api_unified_intelligence_adjust_alias(payload: UnifiedIntelligenceMemoryPayload) -> Dict[str, Any]:
    return await api_unified_intelligence_adjust(payload)


@app.get("/api/unified-intelligence/export")
@app.get("/api/unified-intelligence-memory/export")
async def api_unified_intelligence_memory_export() -> Dict[str, Any]:
    if unified_intelligence_export is None:
        raise HTTPException(status_code=503, detail="api.unified_intelligence_memory module is unavailable")

    return unified_intelligence_export()


@app.get("/unified-intelligence/export")
async def api_unified_intelligence_memory_export_alias() -> Dict[str, Any]:
    return await api_unified_intelligence_memory_export()


@app.post("/api/unified-intelligence/reset")
@app.post("/api/unified-intelligence-memory/reset")
async def api_unified_intelligence_memory_reset(payload: UnifiedIntelligenceMemoryPayload) -> Dict[str, Any]:
    if reset_unified_intelligence_memory is None:
        raise HTTPException(status_code=503, detail="api.unified_intelligence_memory module is unavailable")

    data = _ui_memory_payload_to_dict(payload)
    reset_all = _projection_bool(data.get("resetAll"), False)

    if reset_all:
        return reset_unified_intelligence_memory(symbol=None, timeframe=None)

    symbol = data.get("symbol")
    timeframe = data.get("timeframe")
    return reset_unified_intelligence_memory(symbol=symbol, timeframe=timeframe)


@app.post("/unified-intelligence/reset")
async def api_unified_intelligence_memory_reset_alias(payload: UnifiedIntelligenceMemoryPayload) -> Dict[str, Any]:
    return await api_unified_intelligence_memory_reset(payload)


# ─────────────────────────────────────────────────────────────────────────────
# UNIFIED PROJECTION ENGINE ROUTES
# ─────────────────────────────────────────────────────────────────────────────

def _projection_payload_to_dict(payload: Any) -> Dict[str, Any]:
    data = model_to_dict(payload)
    if not isinstance(data, dict):
        data = {}
    return data


def _projection_symbol_timeframe(data: Dict[str, Any]) -> Tuple[str, str]:
    symbol = normalize_symbol(str(data.get("symbol") or data.get("ticker") or "MES1!"))
    timeframe = normalize_timeframe(str(data.get("timeframe") or data.get("tf") or "1m"))
    return symbol, timeframe


def _projection_int(value: Any, fallback: int, low: int, high: int) -> int:
    try:
        parsed = int(float(value))
    except Exception:
        parsed = fallback
    return max(low, min(high, parsed))


def _projection_bool(value: Any, fallback: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return fallback
    raw = str(value).strip().lower()
    if raw in {"1", "true", "yes", "y", "on"}:
        return True
    if raw in {"0", "false", "no", "n", "off"}:
        return False
    return fallback


def _projection_candles_from_payload(data: Dict[str, Any], symbol: str, timeframe: str, limit: int) -> List[Dict[str, Any]]:
    raw_candles = data.get("candles")
    candles = raw_candles if isinstance(raw_candles, list) else []

    normalized: List[Dict[str, Any]] = []
    for item in candles:
        if isinstance(item, dict):
            candle = dict(item)
            candle["symbol"] = normalize_symbol(str(candle.get("symbol") or symbol))
            candle["timeframe"] = normalize_timeframe(str(candle.get("timeframe") or timeframe))
            normalized.append(candle)

    normalized = filter_valid_candles_for_symbol(merge_candles_by_time(normalized), symbol)[-limit:]

    if normalized:
        return normalized

    try:
        return get_dashboard_candles(symbol, timeframe, limit)
    except Exception as error:
        print(f"[Projection Engine] candle fallback failed: {error}")
        return []


def _projection_context_from_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    context = data.get("context") if isinstance(data.get("context"), dict) else {}

    overlay_payload = (
        data.get("overlayPayload")
        if isinstance(data.get("overlayPayload"), dict)
        else data.get("chartOverlays")
        if isinstance(data.get("chartOverlays"), dict)
        else context.get("overlayPayload")
        if isinstance(context.get("overlayPayload"), dict)
        else context.get("chartOverlays")
        if isinstance(context.get("chartOverlays"), dict)
        else {}
    )

    scorecards = (
        data.get("scorecards")
        if isinstance(data.get("scorecards"), dict)
        else overlay_payload.get("scorecards")
        if isinstance(overlay_payload, dict) and isinstance(overlay_payload.get("scorecards"), dict)
        else context.get("scorecards")
        if isinstance(context.get("scorecards"), dict)
        else {}
    )

    ml_features = (
        data.get("mlFeatures")
        if isinstance(data.get("mlFeatures"), dict)
        else overlay_payload.get("mlFeatures")
        if isinstance(overlay_payload, dict) and isinstance(overlay_payload.get("mlFeatures"), dict)
        else context.get("mlFeatures")
        if isinstance(context.get("mlFeatures"), dict)
        else {}
    )

    unified_intelligence = (
        data.get("unifiedIntelligence")
        if isinstance(data.get("unifiedIntelligence"), dict)
        else context.get("unifiedIntelligence")
        if isinstance(context.get("unifiedIntelligence"), dict)
        else {}
    )

    external_tables = (
        data.get("externalTables")
        if isinstance(data.get("externalTables"), dict)
        else context.get("externalTables")
        if isinstance(context.get("externalTables"), dict)
        else {}
    )

    signal = (
        data.get("signal")
        if isinstance(data.get("signal"), dict)
        else context.get("signal")
        if isinstance(context.get("signal"), dict)
        else LATEST_SIGNAL
        if isinstance(LATEST_SIGNAL, dict)
        else {}
    )

    return {
        "overlayPayload": overlay_payload if isinstance(overlay_payload, dict) else {},
        "scorecards": scorecards if isinstance(scorecards, dict) else {},
        "mlFeatures": ml_features if isinstance(ml_features, dict) else {},
        "unifiedIntelligence": unified_intelligence if isinstance(unified_intelligence, dict) else {},
        "externalTables": external_tables if isinstance(external_tables, dict) else {},
        "signal": signal if isinstance(signal, dict) else {},
    }


def build_projection_engine_from_dashboard_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    if build_unified_projection_engine is None:
        raise HTTPException(status_code=503, detail="api.projection_engine module is unavailable")

    symbol, timeframe = _projection_symbol_timeframe(data)
    limit = _projection_int(data.get("limit"), 800, 50, 5000)
    ghost_count = _projection_int(data.get("ghostCount"), 3, 1, 10)
    auto_register = _projection_bool(data.get("autoRegister"), True)

    candles = _projection_candles_from_payload(data, symbol, timeframe, limit)
    context = _projection_context_from_payload(data)

    try:
        if evaluate_projection_engine_open_projections is not None and candles:
            evaluate_projection_engine_open_projections(
                symbol=symbol,
                timeframe=timeframe,
                candles=candles,
                currentPrice=to_float(candles[-1].get("close"), 0),
            )
    except Exception as error:
        print(f"[Projection Engine] pre-build evaluation failed: {error}")

    engine = build_unified_projection_engine(
        symbol=symbol,
        timeframe=timeframe,
        candles=candles,
        scorecards=context["scorecards"],
        mlFeatures=context["mlFeatures"],
        overlayPayload=context["overlayPayload"],
        unifiedIntelligence=context["unifiedIntelligence"],
        externalTables=context["externalTables"],
        signal=context["signal"],
        ghostCount=ghost_count,
        autoRegister=auto_register,
    )

    if not isinstance(engine, dict):
        raise HTTPException(status_code=500, detail="Projection engine returned invalid payload")

    return engine


@app.post("/api/projection-engine/build")
async def api_projection_engine_build(payload: ProjectionEnginePayload) -> Dict[str, Any]:
    data = _projection_payload_to_dict(payload)
    return build_projection_engine_from_dashboard_payload(data)


@app.post("/projection-engine/build")
async def api_projection_engine_build_alias(payload: ProjectionEnginePayload) -> Dict[str, Any]:
    data = _projection_payload_to_dict(payload)
    return build_projection_engine_from_dashboard_payload(data)


@app.get("/api/projection-engine/status")
async def api_projection_engine_status(symbol: str = "", timeframe: str = "") -> Dict[str, Any]:
    if projection_engine_status is None:
        raise HTTPException(status_code=503, detail="api.projection_engine module is unavailable")

    return projection_engine_status(symbol=symbol, timeframe=timeframe)


@app.get("/projection-engine/status")
async def api_projection_engine_status_alias(symbol: str = "", timeframe: str = "") -> Dict[str, Any]:
    if projection_engine_status is None:
        raise HTTPException(status_code=503, detail="api.projection_engine module is unavailable")

    return projection_engine_status(symbol=symbol, timeframe=timeframe)


@app.post("/api/projection-engine/evaluate")
async def api_projection_engine_evaluate(payload: ProjectionEnginePayload) -> Dict[str, Any]:
    if evaluate_projection_engine_open_projections is None:
        raise HTTPException(status_code=503, detail="api.projection_engine module is unavailable")

    data = _projection_payload_to_dict(payload)
    symbol, timeframe = _projection_symbol_timeframe(data)
    limit = _projection_int(data.get("limit"), 800, 50, 5000)
    candles = _projection_candles_from_payload(data, symbol, timeframe, limit)
    current_price = data.get("currentPrice") or data.get("price") or (candles[-1].get("close") if candles else None)

    return evaluate_projection_engine_open_projections(
        symbol=symbol,
        timeframe=timeframe,
        candles=candles,
        currentPrice=current_price,
    )


@app.post("/projection-engine/evaluate")
async def api_projection_engine_evaluate_alias(payload: ProjectionEnginePayload) -> Dict[str, Any]:
    return await api_projection_engine_evaluate(payload)


@app.get("/api/projection-engine/export")
async def api_projection_engine_export() -> Dict[str, Any]:
    if projection_engine_export is None:
        raise HTTPException(status_code=503, detail="api.projection_engine module is unavailable")

    return projection_engine_export()


@app.get("/projection-engine/export")
async def api_projection_engine_export_alias() -> Dict[str, Any]:
    if projection_engine_export is None:
        raise HTTPException(status_code=503, detail="api.projection_engine module is unavailable")

    return projection_engine_export()


@app.post("/api/projection-engine/reset")
async def api_projection_engine_reset(payload: ProjectionEnginePayload) -> Dict[str, Any]:
    if reset_projection_engine_memory is None:
        raise HTTPException(status_code=503, detail="api.projection_engine module is unavailable")

    data = _projection_payload_to_dict(payload)
    symbol = data.get("symbol")
    timeframe = data.get("timeframe")
    reset_all = _projection_bool(data.get("resetAll"), False)

    if reset_all:
        symbol = None
        timeframe = None

    return reset_projection_engine_memory(symbol=symbol, timeframe=timeframe)


@app.post("/projection-engine/reset")
async def api_projection_engine_reset_alias(payload: ProjectionEnginePayload) -> Dict[str, Any]:
    return await api_projection_engine_reset(payload)



# ─────────────────────────────────────────────────────────────────────────────
# LOCAL ENTRYPOINT
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("api.main:app", host="0.0.0.0", port=port, reload=True)

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 8 — INSIGHTSENTRY LIVE PRICE / CANDLE FEED ROUTES
# ─────────────────────────────────────────────────────────────────────────────


@app.get("/api/live-feed/status")
def api_live_feed_status() -> Dict[str, Any]:
    if live_feed_status is None:
        raise HTTPException(status_code=503, detail="api.insightsentry_live_feed module unavailable")
    return live_feed_status()


@app.get("/live-feed/status")
def api_live_feed_status_alias() -> Dict[str, Any]:
    return api_live_feed_status()


@app.get("/api/live-feed/refresh-key")
def api_live_feed_refresh_key(force: bool = False) -> Dict[str, Any]:
    if refresh_insightsentry_websocket_key is None:
        raise HTTPException(status_code=503, detail="api.insightsentry_live_feed module unavailable")
    try:
        return refresh_insightsentry_websocket_key(force=force)
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))


@app.get("/live-feed/refresh-key")
def api_live_feed_refresh_key_alias(force: bool = False) -> Dict[str, Any]:
    return api_live_feed_refresh_key(force=force)


@app.get("/api/live-feed/latest")
def api_live_feed_latest(symbol: str = "MES1!", timeframe: str = "1m") -> Dict[str, Any]:
    if get_latest_live_snapshot is None:
        raise HTTPException(status_code=503, detail="api.insightsentry_live_feed module unavailable")
    return get_latest_live_snapshot(symbol=symbol, timeframe=timeframe)


@app.get("/live-feed/latest")
def api_live_feed_latest_alias(symbol: str = "MES1!", timeframe: str = "1m") -> Dict[str, Any]:
    return api_live_feed_latest(symbol=symbol, timeframe=timeframe)


@app.get("/api/live-feed/stream")
def api_live_feed_stream(
    symbol: str = "MES1!",
    timeframe: str = "1m",
    limit: int = 700,
    pollSeconds: float = 1.0,
) -> StreamingResponse:
    if live_feed_event_generator is None:
        raise HTTPException(status_code=503, detail="api.insightsentry_live_feed module unavailable")

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(
        live_feed_event_generator(symbol=symbol, timeframe=timeframe, limit=limit, pollSeconds=pollSeconds),
        media_type="text/event-stream",
        headers=headers,
    )


@app.get("/live-feed/stream")
def api_live_feed_stream_alias(
    symbol: str = "MES1!",
    timeframe: str = "1m",
    limit: int = 700,
    pollSeconds: float = 1.0,
) -> StreamingResponse:
    return api_live_feed_stream(symbol=symbol, timeframe=timeframe, limit=limit, pollSeconds=pollSeconds)


@app.get("/api/live-feed/ping")
def api_live_feed_ping() -> StreamingResponse:
    if live_feed_ping_generator is None:
        raise HTTPException(status_code=503, detail="api.insightsentry_live_feed module unavailable")
    return StreamingResponse(live_feed_ping_generator(), media_type="text/event-stream")


# ─────────────────────────────────────────────────────────────────────────────
# INSIGHTSENTRY HISTORICAL TIME SERIES OHLCV — PHASE 8.6
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/insightsentry/history")
def api_insightsentry_history(
    symbol: str = "MES1!",
    timeframe: str = "1m",
    start_ym: str | None = None,
    limit: int = 700,
    extended: bool = True,
    badj: bool = True,
    dadj: bool = False,
    force: bool = False,
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    safe_limit = max(1, min(int(limit or 700), 5000))

    if get_historical_ohlcv is None:
        raise HTTPException(status_code=503, detail="api.insightsentry_history module unavailable")

    provider_force = force and not is_futures_symbol(normalized_symbol)

    # MES/ES should not bypass cache on normal dashboard refreshes. The frontend can
    # request force=true after a live/history gap, but sending that directly to
    # InsightSentry keeps causing 429 rate limits. For futures, prefer cached/stale
    # history fallback and only refresh through the bounded backend cache path.
    if force and is_futures_symbol(normalized_symbol):
        fallback = cached_futures_history_payload_for_rate_limit(
            normalized_symbol,
            normalized_timeframe,
            safe_limit,
        )
        if fallback:
            return fallback

    try:
        provider_payload = get_historical_ohlcv(
            symbol=normalized_symbol,
            timeframe=normalized_timeframe,
            start_ym=start_ym,
            limit=safe_limit,
            extended=extended,
            badj=badj,
            dadj=dadj,
            force=provider_force,
        )

        if isinstance(provider_payload, dict):
            rebuilt = rebuild_history_payload_with_saved_live_candles(
                route_source="insightsentry_history_plus_persistent_live",
                symbol=normalized_symbol,
                timeframe=normalized_timeframe,
                payload=provider_payload,
                limit=safe_limit,
            )

            if rebuilt.get("candles"):
                return candle_cache_set("historical", normalized_symbol, normalized_timeframe, safe_limit, rebuilt)

        return provider_payload
    except HTTPException as error:
        if error.status_code == 429 and is_futures_symbol(normalized_symbol):
            fallback = cached_futures_history_payload_for_rate_limit(
                normalized_symbol,
                normalized_timeframe,
                safe_limit,
            )
            if fallback:
                rebuilt = rebuild_history_payload_with_saved_live_candles(
                    route_source="insightsentry_history_rate_limit_cache_plus_persistent_live",
                    symbol=normalized_symbol,
                    timeframe=normalized_timeframe,
                    payload=fallback,
                    limit=safe_limit,
                )
                return rebuilt
        raise
    except Exception as error:
        text = str(error).lower()
        if is_futures_symbol(normalized_symbol) and ("429" in text or "rate" in text or "too many" in text):
            fallback = cached_futures_history_payload_for_rate_limit(
                normalized_symbol,
                normalized_timeframe,
                safe_limit,
            )
            if fallback:
                rebuilt = rebuild_history_payload_with_saved_live_candles(
                    route_source="insightsentry_history_rate_limit_cache_plus_persistent_live",
                    symbol=normalized_symbol,
                    timeframe=normalized_timeframe,
                    payload=fallback,
                    limit=safe_limit,
                )
                return rebuilt
        raise


@app.get("/insightsentry/history")
def api_insightsentry_history_alias(
    symbol: str = "MES1!",
    timeframe: str = "1m",
    start_ym: str | None = None,
    limit: int = 700,
    extended: bool = True,
    badj: bool = True,
    dadj: bool = False,
    force: bool = False,
) -> Dict[str, Any]:
    return api_insightsentry_history(
        symbol=symbol,
        timeframe=timeframe,
        start_ym=start_ym,
        limit=limit,
        extended=extended,
        badj=badj,
        dadj=dadj,
        force=force,
    )


@app.get("/api/insightsentry/history/status")
def api_insightsentry_history_status() -> Dict[str, Any]:
    if historical_ohlcv_status is None:
        raise HTTPException(status_code=503, detail="api.insightsentry_history module unavailable")
    return historical_ohlcv_status()


@app.get("/insightsentry/history/status")
def api_insightsentry_history_status_alias() -> Dict[str, Any]:
    return api_insightsentry_history_status()


# ─────────────────────────────────────────────────────────────────────────────
# INSIGHTSENTRY SESSION INFORMATION — PHASE 8.7
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/insightsentry/session")
def api_insightsentry_session(
    symbol: str = "MES1!",
    force: bool = False,
) -> Dict[str, Any]:
    if get_insightsentry_session is None:
        raise HTTPException(status_code=503, detail="api.insightsentry_session module unavailable")
    return get_insightsentry_session(symbol=symbol, force=force)


@app.get("/insightsentry/session")
def api_insightsentry_session_alias(
    symbol: str = "MES1!",
    force: bool = False,
) -> Dict[str, Any]:
    return api_insightsentry_session(symbol=symbol, force=force)


@app.get("/api/insightsentry/session/status")
def api_insightsentry_session_status() -> Dict[str, Any]:
    if insightsentry_session_status is None:
        raise HTTPException(status_code=503, detail="api.insightsentry_session module unavailable")
    return insightsentry_session_status()


@app.get("/insightsentry/session/status")
def api_insightsentry_session_status_alias() -> Dict[str, Any]:
    return api_insightsentry_session_status()


# ─────────────────────────────────────────────────────────────────────────────
# NEURAL BRAIN FASTAPI ROUTES — PHASE 2/3 RENDER BACKEND MIRROR
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/neural-brain/status")
def api_neural_brain_status() -> Dict[str, Any]:
    if neural_brain_status is None:
        raise HTTPException(status_code=503, detail="api.neural_brain_fastapi module unavailable")
    return neural_brain_status()


@app.get("/neural-brain/status")
def api_neural_brain_status_alias() -> Dict[str, Any]:
    return api_neural_brain_status()


@app.get("/api/neural-brain/snapshots")
def api_neural_brain_snapshots(limit: int = 25) -> Dict[str, Any]:
    if list_neural_brain_snapshots is None:
        raise HTTPException(status_code=503, detail="api.neural_brain_fastapi module unavailable")
    return list_neural_brain_snapshots(limit=limit)


@app.get("/neural-brain/snapshots")
def api_neural_brain_snapshots_alias(limit: int = 25) -> Dict[str, Any]:
    return api_neural_brain_snapshots(limit=limit)


@app.post("/api/neural-brain/snapshots")
async def api_neural_brain_save_snapshot(request: FastAPIRequest) -> Dict[str, Any]:
    if save_neural_brain_snapshot is None:
        raise HTTPException(status_code=503, detail="api.neural_brain_fastapi module unavailable")
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    return save_neural_brain_snapshot(payload if isinstance(payload, dict) else {"raw": payload})


@app.post("/neural-brain/snapshots")
async def api_neural_brain_save_snapshot_alias(request: FastAPIRequest) -> Dict[str, Any]:
    return await api_neural_brain_save_snapshot(request)


@app.get("/api/neural-brain/predict")
def api_neural_brain_predict_status() -> Dict[str, Any]:
    if neural_brain_status is None:
        raise HTTPException(status_code=503, detail="api.neural_brain_fastapi module unavailable")
    status_payload = neural_brain_status()
    return {
        "eventType": "NEURAL_BRAIN_SCORECARD",
        "status": "Ready",
        "route": "/api/neural-brain/predict",
        "method": "POST",
        "phase": "phase3_river_style_online_updates",
        "memoryRoutes": {
            "snapshots": "/api/neural-brain/snapshots",
            "outcomes": "/api/neural-brain/outcomes",
            "status": "/api/neural-brain/status",
        },
        "online": status_payload.get("online"),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/neural-brain/predict")
async def api_neural_brain_predict(request: FastAPIRequest) -> Dict[str, Any]:
    if predict_neural_brain is None:
        raise HTTPException(status_code=503, detail="api.neural_brain_fastapi module unavailable")
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    return predict_neural_brain(payload if isinstance(payload, dict) else {"raw": payload})


@app.post("/neural-brain/predict")
async def api_neural_brain_predict_alias(request: FastAPIRequest) -> Dict[str, Any]:
    return await api_neural_brain_predict(request)


@app.post("/api/neural-brain/outcomes")
async def api_neural_brain_outcome(request: FastAPIRequest) -> Dict[str, Any]:
    if label_neural_brain_outcome is None:
        raise HTTPException(status_code=503, detail="api.neural_brain_fastapi module unavailable")
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    return label_neural_brain_outcome(payload if isinstance(payload, dict) else {"raw": payload})


@app.post("/neural-brain/outcomes")
async def api_neural_brain_outcome_alias(request: FastAPIRequest) -> Dict[str, Any]:
    return await api_neural_brain_outcome(request)
