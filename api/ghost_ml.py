from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


GHOST_ML_MEMORY: List[Dict[str, Any]] = []
GHOST_ML_MAX_RECORDS = 2500


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
    raw = str(symbol or "BTCUSD").strip().upper()
    raw = (
        raw.replace("BINANCE:", "")
        .replace("COINBASE:", "")
        .replace("CRYPTO:", "")
        .replace("CME_MINI:", "")
        .replace("CME:", "")
    )

    if raw in {"MES1", "MES1!"}:
        return "MES1!"
    if raw in {"ES1", "ES1!"}:
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
        "60": "1h", "1h": "1h", "2h": "2h", "4h": "4h",
        "d": "1d", "1d": "1d", "w": "1w", "1w": "1w",
    }
    return mapping.get(tf, tf or "1m")


def _candle_time(candle: Dict[str, Any]) -> str:
    return str(candle.get("time") or candle.get("timestamp") or "")


def ghost_ml_record_key(symbol: str, timeframe: str, projection_time: str) -> str:
    return f"{normalize_symbol(symbol)}::{normalize_timeframe(timeframe)}::{projection_time}"


def ghost_direction_from_projection(entry_close: float, ghosts: List[Dict[str, Any]]) -> str:
    if not ghosts:
        return "neutral"

    final_close = to_float(ghosts[-1].get("close"), entry_close)
    if final_close > entry_close:
        return "bullish"
    if final_close < entry_close:
        return "bearish"

    explicit = str(ghosts[-1].get("direction", "")).lower()
    if "bull" in explicit:
        return "bullish"
    if "bear" in explicit:
        return "bearish"
    return "neutral"


def ghost_ml_feature_snapshot(overlays: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(overlays, dict):
        overlays = {}

    meta = overlays.get("alphaProfileMeta", {})
    if not isinstance(meta, dict):
        meta = {}

    smc_events = overlays.get("smcEvents", [])
    liquidity_events = overlays.get("liquidityEvents", [])
    zones = overlays.get("zones", [])
    dlm_levels = overlays.get("dlmLevels", [])

    last_smc_direction = "neutral"
    if isinstance(smc_events, list) and smc_events:
        last_smc_direction = str(smc_events[-1].get("direction", "neutral")).lower()

    return {
        "smcCount": len(smc_events) if isinstance(smc_events, list) else 0,
        "liquidityCount": len(liquidity_events) if isinstance(liquidity_events, list) else 0,
        "zoneCount": len(zones) if isinstance(zones, list) else 0,
        "dlmLevelCount": len(dlm_levels) if isinstance(dlm_levels, list) else 0,
        "lastSmcDirection": last_smc_direction,
        "alphaBullPressurePct": round(to_float(meta.get("bullPressurePct"), 50), 2),
        "alphaBearPressurePct": round(to_float(meta.get("bearPressurePct"), 50), 2),
        "alphaPocPrice": to_float(meta.get("pocPrice"), 0),
    }


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

    record = {
        "key": key,
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "projectionTime": projection_time,
        "createdAt": now_iso(),
        "status": "pending",
        "entryClose": entry_close,
        "horizon": len(ghosts),
        "projectedDirection": projected_direction,
        "projectedCloses": projected_closes,
        "projectedHighs": projected_highs,
        "projectedLows": projected_lows,
        "projectedFinalClose": projected_closes[-1] if projected_closes else entry_close,
        "projectedMaxHigh": max(projected_highs) if projected_highs else entry_close,
        "projectedMinLow": min(projected_lows) if projected_lows else entry_close,
        "avgConfidence": round(sum(confidence_values) / max(len(confidence_values), 1), 2),
        "features": ghost_ml_feature_snapshot(overlays),
        "evaluation": None,
    }

    GHOST_ML_MEMORY.append(record)

    if len(GHOST_ML_MEMORY) > GHOST_ML_MAX_RECORDS:
        del GHOST_ML_MEMORY[:len(GHOST_ML_MEMORY) - GHOST_ML_MAX_RECORDS]

    return record


def evaluate_ghost_ml_records(symbol: str, timeframe: str, candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    if not candles:
        return {"evaluatedNow": 0, "pending": 0}

    time_to_index: Dict[str, int] = {}
    for index, candle in enumerate(candles):
        candle_time = _candle_time(candle)
        if candle_time:
            time_to_index[candle_time] = index

    evaluated_now = 0

    for record in GHOST_ML_MEMORY:
        if record.get("symbol") != normalized_symbol or record.get("timeframe") != normalized_timeframe:
            continue
        if record.get("status") == "evaluated":
            continue

        projection_time = str(record.get("projectionTime", ""))
        start_index = time_to_index.get(projection_time)
        horizon = int(record.get("horizon") or 3)

        if start_index is None:
            continue

        future = candles[start_index + 1:start_index + 1 + horizon]
        if len(future) < horizon:
            continue

        entry_close = to_float(record.get("entryClose"))
        projected_final = to_float(record.get("projectedFinalClose"), entry_close)
        actual_final = to_float(future[-1].get("close"), entry_close)
        actual_max_high = max(to_float(item.get("high"), entry_close) for item in future)
        actual_min_low = min(to_float(item.get("low"), entry_close) for item in future)

        projected_direction = str(record.get("projectedDirection", "neutral")).lower()
        actual_direction = "bullish" if actual_final > entry_close else "bearish" if actual_final < entry_close else "neutral"

        direction_correct = projected_direction == actual_direction and actual_direction != "neutral"
        projected_move = projected_final - entry_close
        actual_move = actual_final - entry_close
        close_error = abs(actual_final - projected_final)
        close_error_pct = (close_error / max(abs(entry_close), 0.000001)) * 100

        projected_max_high = to_float(record.get("projectedMaxHigh"), entry_close)
        projected_min_low = to_float(record.get("projectedMinLow"), entry_close)

        high_hit = actual_max_high >= projected_max_high
        low_hit = actual_min_low <= projected_min_low

        target_hit = high_hit if projected_direction == "bullish" else low_hit if projected_direction == "bearish" else False
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

        record["status"] = "evaluated"
        record["evaluatedAt"] = now_iso()
        record["evaluation"] = {
            "actualDirection": actual_direction,
            "directionCorrect": direction_correct,
            "targetHit": bool(target_hit),
            "highHit": bool(high_hit),
            "lowHit": bool(low_hit),
            "actualFinalClose": round(actual_final, 5),
            "actualMaxHigh": round(actual_max_high, 5),
            "actualMinLow": round(actual_min_low, 5),
            "projectedMove": round(projected_move, 5),
            "actualMove": round(actual_move, 5),
            "closeError": round(close_error, 5),
            "closeErrorPct": round(close_error_pct, 5),
            "favorableMove": round(favorable_move, 5),
            "adverseMove": round(adverse_move, 5),
            "qualityScore": round(
                clamp(
                    (100 if direction_correct else 0) * 0.45 +
                    (100 if target_hit else 0) * 0.25 +
                    max(0.0, 100.0 - close_error_pct * 120.0) * 0.30,
                    0,
                    100,
                ),
                2,
            ),
        }
        evaluated_now += 1

    pending = len([
        record for record in GHOST_ML_MEMORY
        if record.get("symbol") == normalized_symbol
        and record.get("timeframe") == normalized_timeframe
        and record.get("status") != "evaluated"
    ])

    return {"evaluatedNow": evaluated_now, "pending": pending}


def ghost_ml_summary_from_candles(symbol: str, timeframe: str, candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    eval_result = evaluate_ghost_ml_records(normalized_symbol, normalized_timeframe, candles)

    records = [
        record for record in GHOST_ML_MEMORY
        if record.get("symbol") == normalized_symbol
        and record.get("timeframe") == normalized_timeframe
    ]

    evaluated = [record for record in records if record.get("status") == "evaluated" and isinstance(record.get("evaluation"), dict)]
    pending = [record for record in records if record.get("status") != "evaluated"]

    if evaluated:
        direction_accuracy = sum(1 for record in evaluated if record["evaluation"].get("directionCorrect")) / len(evaluated) * 100
        target_hit_rate = sum(1 for record in evaluated if record["evaluation"].get("targetHit")) / len(evaluated) * 100
        avg_quality = sum(to_float(record["evaluation"].get("qualityScore"), 0) for record in evaluated) / len(evaluated)
        avg_close_error_pct = sum(to_float(record["evaluation"].get("closeErrorPct"), 0) for record in evaluated) / len(evaluated)
        avg_favorable = sum(to_float(record["evaluation"].get("favorableMove"), 0) for record in evaluated) / len(evaluated)
        avg_adverse = sum(to_float(record["evaluation"].get("adverseMove"), 0) for record in evaluated) / len(evaluated)
    else:
        direction_accuracy = 0.0
        target_hit_rate = 0.0
        avg_quality = 0.0
        avg_close_error_pct = 0.0
        avg_favorable = 0.0
        avg_adverse = 0.0

    return {
        "eventType": "GHOST_ML_PHASE_1_STATUS",
        "status": "Learning" if records else "Waiting",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "memorySize": len(records),
        "evaluatedSamples": len(evaluated),
        "pendingSamples": len(pending),
        "evaluatedNow": eval_result.get("evaluatedNow", 0),
        "directionAccuracy": round(direction_accuracy, 2),
        "targetHitRate": round(target_hit_rate, 2),
        "avgQualityScore": round(avg_quality, 2),
        "avgCloseErrorPct": round(avg_close_error_pct, 5),
        "avgFavorableMove": round(avg_favorable, 5),
        "avgAdverseMove": round(avg_adverse, 5),
        "readyForOptimizer": len(evaluated) >= 30,
        "recent": records[-20:],
        "createdAt": now_iso(),
    }
