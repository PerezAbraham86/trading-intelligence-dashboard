from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# ─────────────────────────────────────────────────────────────────────────────
# GHOST ML MEMORY
# ─────────────────────────────────────────────────────────────────────────────
#
# Purpose:
# - Record every ghost candle projection.
# - Evaluate it when enough real future candles exist.
# - Learn which SMC / AlphaX DLM / OrderBlock / FVG / sweep contexts are accurate.
# - Return confidence/projection multipliers that api/main.py can use on future ghosts.
#
# Important hierarchy:
# - Uses: SMC, AlphaX/DLM liquidity, OrderBlocks, PD zones, FVG, sweeps,
#         displacement/inducement style context, and ghost history.
# - Does NOT use NRTR.
# - Does NOT use SMMA.
# - NRTR/SMMA remain chart/entry/exit/strategy tools only.
# ─────────────────────────────────────────────────────────────────────────────


GHOST_ML_MEMORY: List[Dict[str, Any]] = []
GHOST_ML_MAX_RECORDS = int(os.getenv("GHOST_ML_MAX_RECORDS", "5000"))
GHOST_ML_STORE_FILE = Path(os.getenv("GHOST_ML_STORE_FILE", "/tmp/trading_dashboard_ghost_ml_memory.json"))
GHOST_ML_MIN_EVALUATED_FOR_ADJUSTMENT = int(os.getenv("GHOST_ML_MIN_EVALUATED_FOR_ADJUSTMENT", "12"))


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
        if not math.isfinite(parsed):
            return fallback
        return parsed
    except Exception:
        return fallback


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def normalize_symbol(symbol: str) -> str:
    raw = str(symbol or "BTCUSD").strip().upper()
    raw = (
        raw.replace("BINANCE:", "")
        .replace("COINBASE:", "")
        .replace("CRYPTO:", "")
        .replace("CME_MINI:", "")
        .replace("CME:", "")
        .replace("AMEX:", "")
        .replace("NASDAQ:", "")
        .replace("NYSE:", "")
    )

    raw = raw.replace("-", "").replace("_", "")

    if raw in {"MES", "MES1", "MES1!", "/MES", "MES=F"}:
        return "MES1!"
    if raw in {"ES", "ES1", "ES1!", "/ES", "ES=F"}:
        return "ES1!"
    if "MES" in raw:
        return "MES1!"
    if "ES" in raw and "MES" not in raw:
        return "ES1!"
    if "BTC" in raw:
        return "BTCUSD"
    if "ETH" in raw:
        return "ETHUSD"
    if "SPY" in raw:
        return "SPY"

    return raw or "BTCUSD"


def normalize_timeframe(timeframe: str) -> str:
    tf = str(timeframe or "1m").strip().lower()
    mapping = {
        "1": "1m", "1m": "1m", "1min": "1m", "1minute": "1m",
        "3": "3m", "3m": "3m", "3min": "3m", "3minute": "3m",
        "5": "5m", "5m": "5m", "5min": "5m", "5minute": "5m",
        "10": "10m", "10m": "10m", "10min": "10m", "10minute": "10m",
        "15": "15m", "15m": "15m", "15min": "15m", "15minute": "15m",
        "30": "30m", "30m": "30m", "30min": "30m", "30minute": "30m",
        "60": "1h", "1h": "1h", "60m": "1h",
        "120": "2h", "2h": "2h", "120m": "2h",
        "240": "4h", "4h": "4h", "240m": "4h",
        "d": "1d", "1d": "1d", "day": "1d", "1day": "1d",
        "w": "1w", "1w": "1w", "week": "1w", "1week": "1w",
    }
    return mapping.get(tf, tf or "1m")


def _candle_time(candle: Dict[str, Any]) -> str:
    return str(candle.get("time") or candle.get("timestamp") or candle.get("createdAt") or "")


def _direction_from_text(value: Any, fallback: str = "neutral") -> str:
    text = str(value or "").strip().lower()

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


def _safe_round(value: Any, digits: int = 5, fallback: float = 0.0) -> float:
    return round(to_float(value, fallback), digits)


def _truthy_count(items: List[Any]) -> int:
    return len([item for item in items if item])


def _list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _percent_to_unit(value: Any, fallback: float = 0.5) -> float:
    parsed = to_float(value, fallback)
    if parsed > 1:
        parsed = parsed / 100.0
    return clamp(parsed, 0.0, 1.0)


def ghost_ml_record_key(symbol: str, timeframe: str, projection_time: str) -> str:
    return f"{normalize_symbol(symbol)}::{normalize_timeframe(timeframe)}::{projection_time}"


# ─────────────────────────────────────────────────────────────────────────────
# PERSISTENCE
# ─────────────────────────────────────────────────────────────────────────────


def load_ghost_ml_memory() -> Dict[str, Any]:
    global GHOST_ML_MEMORY

    try:
        if not GHOST_ML_STORE_FILE.exists():
            GHOST_ML_MEMORY = []
            return {
                "loaded": 0,
                "path": str(GHOST_ML_STORE_FILE),
                "status": "empty",
            }

        with GHOST_ML_STORE_FILE.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)

        records = payload.get("records") if isinstance(payload, dict) else payload
        if not isinstance(records, list):
            records = []

        cleaned = [record for record in records if isinstance(record, dict)]
        if len(cleaned) > GHOST_ML_MAX_RECORDS:
            cleaned = cleaned[-GHOST_ML_MAX_RECORDS:]

        GHOST_ML_MEMORY = cleaned

        return {
            "loaded": len(GHOST_ML_MEMORY),
            "path": str(GHOST_ML_STORE_FILE),
            "status": "loaded",
        }
    except Exception as error:
        print(f"[Ghost ML] memory load failed: {error}")
        GHOST_ML_MEMORY = []
        return {
            "loaded": 0,
            "path": str(GHOST_ML_STORE_FILE),
            "status": "error",
            "error": str(error),
        }


def save_ghost_ml_memory() -> Dict[str, Any]:
    try:
        GHOST_ML_STORE_FILE.parent.mkdir(parents=True, exist_ok=True)

        payload = {
            "version": "ghost-ml-v2-persistent-smc-alpha-dlm-ob-only",
            "createdAt": now_iso(),
            "maxRecords": GHOST_ML_MAX_RECORDS,
            "records": GHOST_ML_MEMORY[-GHOST_ML_MAX_RECORDS:],
        }

        tmp_path = GHOST_ML_STORE_FILE.with_suffix(GHOST_ML_STORE_FILE.suffix + ".tmp")
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"), ensure_ascii=False)

        tmp_path.replace(GHOST_ML_STORE_FILE)

        return {
            "saved": len(GHOST_ML_MEMORY),
            "path": str(GHOST_ML_STORE_FILE),
            "status": "saved",
        }
    except Exception as error:
        print(f"[Ghost ML] memory save failed: {error}")
        return {
            "saved": 0,
            "path": str(GHOST_ML_STORE_FILE),
            "status": "error",
            "error": str(error),
        }


def trim_ghost_ml_memory() -> None:
    global GHOST_ML_MEMORY

    if len(GHOST_ML_MEMORY) > GHOST_ML_MAX_RECORDS:
        GHOST_ML_MEMORY = GHOST_ML_MEMORY[-GHOST_ML_MAX_RECORDS:]


# Load once on module import. Safe on Render/server restart.
load_ghost_ml_memory()


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE EXTRACTION — NO NRTR / NO SMMA
# ─────────────────────────────────────────────────────────────────────────────


def ghost_direction_from_projection(entry_close: float, ghosts: List[Dict[str, Any]]) -> str:
    if not ghosts:
        return "neutral"

    final_close = to_float(ghosts[-1].get("close"), entry_close)

    if final_close > entry_close:
        return "bullish"
    if final_close < entry_close:
        return "bearish"

    explicit = _direction_from_text(ghosts[-1].get("direction"), "neutral")
    return explicit


def _zone_kind(zone: Dict[str, Any]) -> str:
    return str(
        zone.get("kind")
        or zone.get("type")
        or zone.get("label")
        or zone.get("name")
        or ""
    ).strip().lower()


def _zone_direction(zone: Dict[str, Any]) -> str:
    return _direction_from_text(
        zone.get("direction")
        or zone.get("bias")
        or zone.get("side")
        or zone.get("label")
        or zone.get("kind")
        or zone.get("type"),
        "neutral",
    )


def _level_direction(level: Dict[str, Any]) -> str:
    return _direction_from_text(
        level.get("direction")
        or level.get("bias")
        or level.get("side")
        or level.get("label")
        or level.get("kind"),
        "neutral",
    )


def ghost_ml_feature_snapshot(overlays: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(overlays, dict):
        overlays = {}

    meta = _dict(overlays.get("alphaProfileMeta"))
    scorecards = _dict(overlays.get("scorecards"))
    ml_features = _dict(overlays.get("mlFeatures"))

    smc_events = _list(overlays.get("smcEvents"))
    liquidity_events = _list(overlays.get("liquidityEvents"))
    zones = _list(overlays.get("zones"))
    order_blocks = _list(overlays.get("orderBlocks"))
    dlm_levels = _list(overlays.get("dlmLevels"))
    profile_bins = _list(overlays.get("liquidityProfileBins")) or _list(overlays.get("alphaProfileBins"))

    recent_smc = [item for item in smc_events[-12:] if isinstance(item, dict)]
    recent_liquidity = [item for item in liquidity_events[-12:] if isinstance(item, dict)]
    recent_zones = [item for item in zones[-16:] if isinstance(item, dict)]
    recent_obs = [item for item in order_blocks[-12:] if isinstance(item, dict)]

    if not recent_obs:
        recent_obs = [
            zone for zone in recent_zones
            if any(keyword in _zone_kind(zone) for keyword in ["ob", "order", "supply", "demand"])
        ]

    fvg_zones = [
        zone for zone in recent_zones
        if any(keyword in _zone_kind(zone) for keyword in ["fvg", "fair value", "imbalance"])
    ]

    pd_zones = [
        zone for zone in recent_zones
        if any(keyword in _zone_kind(zone) for keyword in ["premium", "discount", "equilibrium", "pd"])
    ]

    bullish_smc = sum(1 for item in recent_smc if _direction_from_text(item.get("direction") or item.get("label") or item.get("tag")) == "bullish")
    bearish_smc = sum(1 for item in recent_smc if _direction_from_text(item.get("direction") or item.get("label") or item.get("tag")) == "bearish")

    bullish_liquidity = sum(1 for item in recent_liquidity if _direction_from_text(item.get("direction") or item.get("label") or item.get("kind")) == "bullish")
    bearish_liquidity = sum(1 for item in recent_liquidity if _direction_from_text(item.get("direction") or item.get("label") or item.get("kind")) == "bearish")

    bullish_ob = sum(1 for item in recent_obs if _zone_direction(item) == "bullish")
    bearish_ob = sum(1 for item in recent_obs if _zone_direction(item) == "bearish")

    bullish_fvg = sum(1 for item in fvg_zones if _zone_direction(item) == "bullish")
    bearish_fvg = sum(1 for item in fvg_zones if _zone_direction(item) == "bearish")

    discount_count = sum(1 for item in pd_zones if "discount" in _zone_kind(item))
    premium_count = sum(1 for item in pd_zones if "premium" in _zone_kind(item))

    bullish_dlm = sum(1 for item in dlm_levels if isinstance(item, dict) and _level_direction(item) == "bullish")
    bearish_dlm = sum(1 for item in dlm_levels if isinstance(item, dict) and _level_direction(item) == "bearish")

    alpha_bull = to_float(
        meta.get("bullPressurePct")
        or meta.get("bullPressure")
        or scorecards.get("alphaxBullPressure")
        or ml_features.get("alphaxBullPressure"),
        50,
    )
    alpha_bear = to_float(
        meta.get("bearPressurePct")
        or meta.get("bearPressure")
        or scorecards.get("alphaxBearPressure")
        or ml_features.get("alphaxBearPressure"),
        50,
    )

    alpha_direction = "bullish" if alpha_bull > alpha_bear else "bearish" if alpha_bear > alpha_bull else "neutral"
    smc_direction = "bullish" if bullish_smc > bearish_smc else "bearish" if bearish_smc > bullish_smc else "neutral"
    liquidity_direction = (
        "bullish" if bullish_liquidity > bearish_liquidity
        else "bearish" if bearish_liquidity > bullish_liquidity
        else "neutral"
    )
    ob_direction = "bullish" if bullish_ob > bearish_ob else "bearish" if bearish_ob > bullish_ob else "neutral"
    fvg_direction = "bullish" if bullish_fvg > bearish_fvg else "bearish" if bearish_fvg > bullish_fvg else "neutral"
    pd_direction = "bullish" if discount_count > premium_count else "bearish" if premium_count > discount_count else "neutral"
    dlm_direction = "bullish" if bullish_dlm > bearish_dlm else "bearish" if bearish_dlm > bullish_dlm else alpha_direction

    # Explicitly do not read NRTR or SMMA from overlays.
    return {
        "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_GHOST_ONLY",
        "nrtrUsedForMl": 0,
        "smmaUsedForMl": 0,

        "smcCount": len(recent_smc),
        "liquidityCount": len(recent_liquidity),
        "zoneCount": len(recent_zones),
        "orderBlockCount": len(recent_obs),
        "fvgCount": len(fvg_zones),
        "pdZoneCount": len(pd_zones),
        "dlmLevelCount": len(dlm_levels) if isinstance(dlm_levels, list) else 0,
        "profileBinCount": len(profile_bins) if isinstance(profile_bins, list) else 0,

        "bullishSmcCount": bullish_smc,
        "bearishSmcCount": bearish_smc,
        "bullishLiquidityCount": bullish_liquidity,
        "bearishLiquidityCount": bearish_liquidity,
        "bullishOrderBlockCount": bullish_ob,
        "bearishOrderBlockCount": bearish_ob,
        "bullishFvgCount": bullish_fvg,
        "bearishFvgCount": bearish_fvg,
        "discountCount": discount_count,
        "premiumCount": premium_count,
        "bullishDlmCount": bullish_dlm,
        "bearishDlmCount": bearish_dlm,

        "smcDirection": smc_direction,
        "liquidityDirection": liquidity_direction,
        "orderBlockDirection": ob_direction,
        "fvgDirection": fvg_direction,
        "pdDirection": pd_direction,
        "dlmDirection": dlm_direction,
        "alphaDirection": alpha_direction,

        "alphaBullPressurePct": round(alpha_bull, 2),
        "alphaBearPressurePct": round(alpha_bear, 2),
        "alphaPressureNet": round(alpha_bull - alpha_bear, 2),
        "alphaPocPrice": to_float(meta.get("pocPrice"), 0),

        "hasSweep": 1 if recent_liquidity else 0,
        "hasOrderBlock": 1 if recent_obs else 0,
        "hasFvg": 1 if fvg_zones else 0,
        "hasPdZone": 1 if pd_zones else 0,
        "hasDlmLevels": 1 if dlm_levels else 0,
        "hasProfile": 1 if profile_bins else 0,
    }


def feature_bucket_key(features: Dict[str, Any], projected_direction: str) -> str:
    return "|".join([
        f"proj={projected_direction}",
        f"smc={features.get('smcDirection', 'neutral')}",
        f"liq={features.get('liquidityDirection', 'neutral')}",
        f"ob={features.get('orderBlockDirection', 'neutral')}",
        f"fvg={features.get('fvgDirection', 'neutral')}",
        f"pd={features.get('pdDirection', 'neutral')}",
        f"dlm={features.get('dlmDirection', 'neutral')}",
        f"alpha={features.get('alphaDirection', 'neutral')}",
        f"sweep={int(to_float(features.get('hasSweep'), 0))}",
        f"obx={int(to_float(features.get('hasOrderBlock'), 0))}",
        f"fvgx={int(to_float(features.get('hasFvg'), 0))}",
    ])


# ─────────────────────────────────────────────────────────────────────────────
# RECORD PROJECTIONS
# ─────────────────────────────────────────────────────────────────────────────


def record_ghost_ml_projection(
    symbol: str,
    timeframe: str,
    candles: List[Dict[str, Any]],
    ghosts: List[Dict[str, Any]],
    overlays: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    if not candles or not ghosts:
        return None

    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    last_candle = candles[-1]
    projection_time = _candle_time(last_candle)

    if not projection_time:
        return None

    key = ghost_ml_record_key(normalized_symbol, normalized_timeframe, projection_time)

    for record in GHOST_ML_MEMORY:
        if record.get("key") == key:
            return record

    entry_close = to_float(last_candle.get("close"))
    projected_closes = [to_float(item.get("close"), entry_close) for item in ghosts]
    projected_highs = [to_float(item.get("high"), entry_close) for item in ghosts]
    projected_lows = [to_float(item.get("low"), entry_close) for item in ghosts]
    confidence_values = [to_float(item.get("confidence"), 0) for item in ghosts]

    projected_direction = ghost_direction_from_projection(entry_close, ghosts)
    features = ghost_ml_feature_snapshot(overlays)
    bucket = feature_bucket_key(features, projected_direction)

    record = {
        "key": key,
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "projectionTime": projection_time,
        "createdAt": now_iso(),
        "status": "pending",
        "entryClose": round(entry_close, 5),
        "horizon": len(ghosts),
        "projectedDirection": projected_direction,
        "projectedCloses": projected_closes,
        "projectedHighs": projected_highs,
        "projectedLows": projected_lows,
        "projectedFinalClose": projected_closes[-1] if projected_closes else entry_close,
        "projectedMaxHigh": max(projected_highs) if projected_highs else entry_close,
        "projectedMinLow": min(projected_lows) if projected_lows else entry_close,
        "avgConfidence": round(sum(confidence_values) / max(len(confidence_values), 1), 2),
        "features": features,
        "featureBucket": bucket,
        "evaluation": None,
    }

    GHOST_ML_MEMORY.append(record)
    trim_ghost_ml_memory()
    save_ghost_ml_memory()

    return record


# ─────────────────────────────────────────────────────────────────────────────
# EVALUATE PROJECTIONS
# ─────────────────────────────────────────────────────────────────────────────


def _index_candles_by_time(candles: List[Dict[str, Any]]) -> Dict[str, int]:
    time_to_index: Dict[str, int] = {}

    for index, candle in enumerate(candles):
        candle_time = _candle_time(candle)
        if candle_time:
            time_to_index[candle_time] = index

    return time_to_index


def _bars_to_level(
    future: List[Dict[str, Any]],
    *,
    direction: str,
    target_price: float,
) -> Optional[int]:
    for offset, candle in enumerate(future, start=1):
        high = to_float(candle.get("high"))
        low = to_float(candle.get("low"))

        if direction == "bullish" and high >= target_price:
            return offset
        if direction == "bearish" and low <= target_price:
            return offset

    return None


def evaluate_ghost_ml_records(symbol: str, timeframe: str, candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    if not candles:
        return {
            "evaluatedNow": 0,
            "pending": 0,
            "saved": False,
        }

    time_to_index = _index_candles_by_time(candles)
    evaluated_now = 0

    for record in GHOST_ML_MEMORY:
        if record.get("symbol") != normalized_symbol or record.get("timeframe") != normalized_timeframe:
            continue

        if record.get("status") == "evaluated":
            continue

        projection_time = str(record.get("projectionTime", ""))
        start_index = time_to_index.get(projection_time)
        horizon = max(1, int(record.get("horizon") or 3))

        if start_index is None:
            continue

        future = candles[start_index + 1:start_index + 1 + horizon]
        if len(future) < horizon:
            continue

        entry_close = to_float(record.get("entryClose"))
        projected_final = to_float(record.get("projectedFinalClose"), entry_close)
        projected_direction = str(record.get("projectedDirection", "neutral")).lower()

        actual_final = to_float(future[-1].get("close"), entry_close)
        actual_max_high = max(to_float(item.get("high"), entry_close) for item in future)
        actual_min_low = min(to_float(item.get("low"), entry_close) for item in future)

        actual_direction = (
            "bullish" if actual_final > entry_close
            else "bearish" if actual_final < entry_close
            else "neutral"
        )

        direction_correct = projected_direction == actual_direction and actual_direction != "neutral"

        projected_move = projected_final - entry_close
        actual_move = actual_final - entry_close
        close_error = abs(actual_final - projected_final)
        close_error_pct = (close_error / max(abs(entry_close), 0.000001)) * 100

        projected_max_high = to_float(record.get("projectedMaxHigh"), entry_close)
        projected_min_low = to_float(record.get("projectedMinLow"), entry_close)

        high_hit = actual_max_high >= projected_max_high
        low_hit = actual_min_low <= projected_min_low

        target_hit = (
            high_hit if projected_direction == "bullish"
            else low_hit if projected_direction == "bearish"
            else False
        )

        bars_to_target = _bars_to_level(
            future,
            direction=projected_direction,
            target_price=projected_max_high if projected_direction == "bullish" else projected_min_low,
        )

        adverse_move = (
            entry_close - actual_min_low if projected_direction == "bullish"
            else actual_max_high - entry_close if projected_direction == "bearish"
            else 0.0
        )

        favorable_move = (
            actual_max_high - entry_close if projected_direction == "bullish"
            else entry_close - actual_min_low if projected_direction == "bearish"
            else abs(actual_move)
        )

        projected_range = max(projected_max_high - projected_min_low, 0.000001)
        actual_range = max(actual_max_high - actual_min_low, 0.000001)
        range_error_pct = abs(actual_range - projected_range) / max(abs(entry_close), 0.000001) * 100

        move_alignment = 0.0
        if abs(projected_move) > 0 and abs(actual_move) > 0:
            same_sign = (projected_move > 0 and actual_move > 0) or (projected_move < 0 and actual_move < 0)
            magnitude_ratio = min(abs(actual_move), abs(projected_move)) / max(abs(actual_move), abs(projected_move))
            move_alignment = magnitude_ratio * 100.0 if same_sign else 0.0

        quality_score = round(
            clamp(
                (100 if direction_correct else 0) * 0.38 +
                (100 if target_hit else 0) * 0.24 +
                max(0.0, 100.0 - close_error_pct * 120.0) * 0.22 +
                max(0.0, 100.0 - range_error_pct * 100.0) * 0.08 +
                move_alignment * 0.08,
                0,
                100,
            ),
            2,
        )

        record["status"] = "evaluated"
        record["evaluatedAt"] = now_iso()
        record["evaluation"] = {
            "actualDirection": actual_direction,
            "directionCorrect": bool(direction_correct),
            "targetHit": bool(target_hit),
            "highHit": bool(high_hit),
            "lowHit": bool(low_hit),
            "barsToTarget": bars_to_target,
            "actualFinalClose": round(actual_final, 5),
            "actualMaxHigh": round(actual_max_high, 5),
            "actualMinLow": round(actual_min_low, 5),
            "projectedMove": round(projected_move, 5),
            "actualMove": round(actual_move, 5),
            "closeError": round(close_error, 5),
            "closeErrorPct": round(close_error_pct, 5),
            "rangeErrorPct": round(range_error_pct, 5),
            "moveAlignment": round(move_alignment, 2),
            "favorableMove": round(favorable_move, 5),
            "adverseMove": round(adverse_move, 5),
            "qualityScore": quality_score,
        }

        evaluated_now += 1

    pending = len([
        record for record in GHOST_ML_MEMORY
        if record.get("symbol") == normalized_symbol
        and record.get("timeframe") == normalized_timeframe
        and record.get("status") != "evaluated"
    ])

    if evaluated_now > 0:
        save_ghost_ml_memory()

    return {
        "evaluatedNow": evaluated_now,
        "pending": pending,
        "saved": evaluated_now > 0,
    }


# ─────────────────────────────────────────────────────────────────────────────
# LEARNED STATS / ADJUSTMENTS
# ─────────────────────────────────────────────────────────────────────────────


def _matching_records(symbol: str, timeframe: str) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    return [
        record for record in GHOST_ML_MEMORY
        if record.get("symbol") == normalized_symbol
        and record.get("timeframe") == normalized_timeframe
    ]


def _evaluated_records(symbol: str, timeframe: str) -> List[Dict[str, Any]]:
    return [
        record for record in _matching_records(symbol, timeframe)
        if record.get("status") == "evaluated"
        and isinstance(record.get("evaluation"), dict)
    ]


def summarize_records(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    evaluated = [
        record for record in records
        if record.get("status") == "evaluated"
        and isinstance(record.get("evaluation"), dict)
    ]
    pending = [record for record in records if record.get("status") != "evaluated"]

    if not evaluated:
        return {
            "samples": 0,
            "pending": len(pending),
            "directionAccuracy": 0.0,
            "targetHitRate": 0.0,
            "avgQualityScore": 0.0,
            "avgCloseErrorPct": 0.0,
            "avgFavorableMove": 0.0,
            "avgAdverseMove": 0.0,
            "avgMoveAlignment": 0.0,
        }

    return {
        "samples": len(evaluated),
        "pending": len(pending),
        "directionAccuracy": round(
            sum(1 for record in evaluated if record["evaluation"].get("directionCorrect")) / len(evaluated) * 100,
            2,
        ),
        "targetHitRate": round(
            sum(1 for record in evaluated if record["evaluation"].get("targetHit")) / len(evaluated) * 100,
            2,
        ),
        "avgQualityScore": round(
            sum(to_float(record["evaluation"].get("qualityScore"), 0) for record in evaluated) / len(evaluated),
            2,
        ),
        "avgCloseErrorPct": round(
            sum(to_float(record["evaluation"].get("closeErrorPct"), 0) for record in evaluated) / len(evaluated),
            5,
        ),
        "avgFavorableMove": round(
            sum(to_float(record["evaluation"].get("favorableMove"), 0) for record in evaluated) / len(evaluated),
            5,
        ),
        "avgAdverseMove": round(
            sum(to_float(record["evaluation"].get("adverseMove"), 0) for record in evaluated) / len(evaluated),
            5,
        ),
        "avgMoveAlignment": round(
            sum(to_float(record["evaluation"].get("moveAlignment"), 0) for record in evaluated) / len(evaluated),
            2,
        ),
    }


def bucket_statistics(symbol: str, timeframe: str) -> Dict[str, Any]:
    evaluated = _evaluated_records(symbol, timeframe)
    buckets: Dict[str, List[Dict[str, Any]]] = {}

    for record in evaluated:
        key = str(record.get("featureBucket") or "unknown")
        buckets.setdefault(key, []).append(record)

    summaries = []
    for key, records in buckets.items():
        summary = summarize_records(records)
        if summary["samples"] <= 0:
            continue

        summaries.append({
            "bucket": key,
            **summary,
        })

    summaries.sort(
        key=lambda item: (
            int(item.get("samples", 0)),
            float(item.get("avgQualityScore", 0)),
            float(item.get("directionAccuracy", 0)),
        ),
        reverse=True,
    )

    return {
        "bucketCount": len(summaries),
        "buckets": summaries[:50],
    }


def get_best_matching_bucket_summary(
    symbol: str,
    timeframe: str,
    overlays: Dict[str, Any],
    projected_direction: str,
) -> Optional[Dict[str, Any]]:
    features = ghost_ml_feature_snapshot(overlays)
    bucket = feature_bucket_key(features, projected_direction)

    evaluated = [
        record for record in _evaluated_records(symbol, timeframe)
        if str(record.get("featureBucket")) == bucket
    ]

    if not evaluated:
        return None

    summary = summarize_records(evaluated)
    return {
        "bucket": bucket,
        **summary,
    }


def get_ghost_ml_confidence_adjustment(
    symbol: str,
    timeframe: str,
    overlays: Dict[str, Any],
    projected_direction: str,
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    evaluated = _evaluated_records(normalized_symbol, normalized_timeframe)
    overall = summarize_records(evaluated)

    if overall["samples"] < GHOST_ML_MIN_EVALUATED_FOR_ADJUSTMENT:
        return {
            "ready": False,
            "confidenceMultiplier": 1.0,
            "confidenceBonus": 0,
            "projectionMultiplier": 1.0,
            "reason": "not_enough_evaluated_samples",
            "overall": overall,
            "bucket": None,
            "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_GHOST_ONLY",
            "nrtrUsedForMl": 0,
            "smmaUsedForMl": 0,
        }

    bucket = get_best_matching_bucket_summary(
        normalized_symbol,
        normalized_timeframe,
        overlays,
        projected_direction,
    )

    active = bucket if bucket and bucket.get("samples", 0) >= 5 else overall
    quality = to_float(active.get("avgQualityScore"), 0)
    direction_accuracy = to_float(active.get("directionAccuracy"), 0)
    target_hit_rate = to_float(active.get("targetHitRate"), 0)
    close_error_pct = to_float(active.get("avgCloseErrorPct"), 0)

    quality_edge = (quality - 50.0) / 50.0
    direction_edge = (direction_accuracy - 50.0) / 50.0
    target_edge = (target_hit_rate - 40.0) / 60.0
    error_penalty = clamp(close_error_pct * 8.0, 0.0, 0.30)

    confidence_multiplier = clamp(
        1.0 + quality_edge * 0.18 + direction_edge * 0.12 + target_edge * 0.08 - error_penalty,
        0.62,
        1.35,
    )

    confidence_bonus = round(clamp((quality - 50.0) * 0.22 + (direction_accuracy - 50.0) * 0.12, -18, 18))

    # Projection amplitude multiplier:
    # - If the system often hits targets and has high quality, allow a slightly stronger ghost path.
    # - If close error is high, compress projection movement.
    projection_multiplier = clamp(
        1.0 + (target_hit_rate - 45.0) / 100.0 * 0.16 + (quality - 50.0) / 100.0 * 0.12 - error_penalty,
        0.70,
        1.22,
    )

    return {
        "ready": True,
        "confidenceMultiplier": round(confidence_multiplier, 4),
        "confidenceBonus": confidence_bonus,
        "projectionMultiplier": round(projection_multiplier, 4),
        "reason": "bucket_match" if bucket and bucket.get("samples", 0) >= 5 else "overall_learning",
        "overall": overall,
        "bucket": bucket,
        "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_GHOST_ONLY",
        "nrtrUsedForMl": 0,
        "smmaUsedForMl": 0,
    }


def apply_ghost_ml_confidence(
    base_confidence: float,
    symbol: str,
    timeframe: str,
    overlays: Dict[str, Any],
    projected_direction: str,
) -> float:
    adjustment = get_ghost_ml_confidence_adjustment(symbol, timeframe, overlays, projected_direction)

    multiplier = to_float(adjustment.get("confidenceMultiplier"), 1.0)
    bonus = to_float(adjustment.get("confidenceBonus"), 0.0)

    return round(clamp(base_confidence * multiplier + bonus, 2, 96), 2)


def get_ghost_ml_projection_multiplier(
    symbol: str,
    timeframe: str,
    overlays: Dict[str, Any],
    projected_direction: str,
) -> float:
    adjustment = get_ghost_ml_confidence_adjustment(symbol, timeframe, overlays, projected_direction)
    return to_float(adjustment.get("projectionMultiplier"), 1.0)


# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY ROUTES
# ─────────────────────────────────────────────────────────────────────────────


def ghost_ml_summary_from_candles(symbol: str, timeframe: str, candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    eval_result = evaluate_ghost_ml_records(normalized_symbol, normalized_timeframe, candles)

    records = _matching_records(normalized_symbol, normalized_timeframe)
    evaluated = [
        record for record in records
        if record.get("status") == "evaluated"
        and isinstance(record.get("evaluation"), dict)
    ]
    pending = [record for record in records if record.get("status") != "evaluated"]

    overall = summarize_records(records)
    buckets = bucket_statistics(normalized_symbol, normalized_timeframe)

    return {
        "eventType": "GHOST_ML_PHASE_2_AUTO_LEARNING_STATUS",
        "status": "Learning" if records else "Waiting",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "memorySize": len(records),
        "evaluatedSamples": len(evaluated),
        "pendingSamples": len(pending),
        "evaluatedNow": eval_result.get("evaluatedNow", 0),
        "directionAccuracy": overall["directionAccuracy"],
        "targetHitRate": overall["targetHitRate"],
        "avgQualityScore": overall["avgQualityScore"],
        "avgCloseErrorPct": overall["avgCloseErrorPct"],
        "avgFavorableMove": overall["avgFavorableMove"],
        "avgAdverseMove": overall["avgAdverseMove"],
        "avgMoveAlignment": overall["avgMoveAlignment"],
        "readyForLiveAdjustment": overall["samples"] >= GHOST_ML_MIN_EVALUATED_FOR_ADJUSTMENT,
        "readyForOptimizer": overall["samples"] >= 30,
        "learningMode": "persistent_auto_learning",
        "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_GHOST_ONLY",
        "nrtrUsedForMl": 0,
        "smmaUsedForMl": 0,
        "storeFile": str(GHOST_ML_STORE_FILE),
        "bucketStats": buckets,
        "recent": records[-20:],
        "createdAt": now_iso(),
    }


def ghost_ml_export() -> Dict[str, Any]:
    return {
        "eventType": "GHOST_ML_EXPORT",
        "version": "ghost-ml-v2-persistent-smc-alpha-dlm-ob-only",
        "createdAt": now_iso(),
        "records": GHOST_ML_MEMORY,
        "memorySize": len(GHOST_ML_MEMORY),
        "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_GHOST_ONLY",
        "nrtrUsedForMl": 0,
        "smmaUsedForMl": 0,
    }


def reset_ghost_ml_memory(symbol: Optional[str] = None, timeframe: Optional[str] = None) -> Dict[str, Any]:
    global GHOST_ML_MEMORY

    if symbol is None and timeframe is None:
        removed = len(GHOST_ML_MEMORY)
        GHOST_ML_MEMORY = []
        save_ghost_ml_memory()
        return {
            "removed": removed,
            "remaining": 0,
            "scope": "all",
            "status": "reset",
        }

    normalized_symbol = normalize_symbol(symbol or "")
    normalized_timeframe = normalize_timeframe(timeframe or "")

    before = len(GHOST_ML_MEMORY)
    GHOST_ML_MEMORY = [
        record for record in GHOST_ML_MEMORY
        if not (
            (not symbol or record.get("symbol") == normalized_symbol)
            and (not timeframe or record.get("timeframe") == normalized_timeframe)
        )
    ]
    removed = before - len(GHOST_ML_MEMORY)
    save_ghost_ml_memory()

    return {
        "removed": removed,
        "remaining": len(GHOST_ML_MEMORY),
        "symbol": normalized_symbol if symbol else None,
        "timeframe": normalized_timeframe if timeframe else None,
        "scope": "filtered",
        "status": "reset",
    }
