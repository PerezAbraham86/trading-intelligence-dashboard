from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


NEURAL_BRAIN_VERSION = "neural_brain_scorecards_v1"
NEURAL_BRAIN_MEMORY_FILE = Path(os.getenv("NEURAL_BRAIN_MEMORY_FILE", "/tmp/trading_dashboard_neural_brain_memory.json"))
MAX_MEMORY_ROWS = int(os.getenv("NEURAL_BRAIN_MAX_MEMORY_ROWS", "2000"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    try:
        parsed = float(value)
        if parsed != parsed or not math.isfinite(parsed):
            return low
        return max(low, min(high, parsed))
    except Exception:
        return low


def to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None:
            return fallback
        parsed = float(value)
        if parsed != parsed or not math.isfinite(parsed):
            return fallback
        return parsed
    except Exception:
        return fallback


def sigmoid_score(value: float, center: float = 0.0, scale: float = 18.0) -> float:
    try:
        safe_scale = max(abs(scale), 1e-9)
        z = max(-40.0, min(40.0, (float(value) - center) / safe_scale))
        return 100.0 / (1.0 + math.exp(-z))
    except Exception:
        return 50.0


def direction_to_value(value: Any) -> float:
    text = str(value or "").lower()
    if any(token in text for token in ["bull", "buy", "long", "up", "call"]):
        return 1.0
    if any(token in text for token in ["bear", "sell", "short", "down", "put"]):
        return -1.0
    return 0.0


def first_number(payload: Any, keys: List[str], fallback: float = 0.0) -> float:
    if isinstance(payload, dict):
        lowered_keys = {str(key).lower(): key for key in payload.keys()}
        for key in keys:
            actual = lowered_keys.get(str(key).lower())
            if actual is not None:
                return to_float(payload.get(actual), fallback)
        for value in payload.values():
            found = first_number(value, keys, fallback=None)  # type: ignore[arg-type]
            if found is not None:
                return to_float(found, fallback)
    if isinstance(payload, list):
        for item in payload:
            found = first_number(item, keys, fallback=None)  # type: ignore[arg-type]
            if found is not None:
                return to_float(found, fallback)
    return fallback


def latest_candle_features(candles: List[Dict[str, Any]]) -> Dict[str, float]:
    if not candles:
        return {
            "priceChangePct": 0.0,
            "bodyPct": 0.0,
            "upperWickPct": 0.0,
            "lowerWickPct": 0.0,
            "rangePct": 0.0,
            "trendSlopePct": 0.0,
            "momentum3Pct": 0.0,
            "momentum8Pct": 0.0,
        }

    last = candles[-1]
    prev = candles[-2] if len(candles) > 1 else last
    close = to_float(last.get("close"), 0.0)
    open_ = to_float(last.get("open"), close)
    high = to_float(last.get("high"), max(open_, close))
    low = to_float(last.get("low"), min(open_, close))
    prev_close = to_float(prev.get("close"), close)
    candle_range = max(high - low, 1e-9)

    def pct(delta: float, base: float = close) -> float:
        return (delta / base * 100.0) if base else 0.0

    close_3 = to_float(candles[-4].get("close"), close) if len(candles) >= 4 else close
    close_8 = to_float(candles[-9].get("close"), close) if len(candles) >= 9 else close
    close_20 = to_float(candles[-21].get("close"), close) if len(candles) >= 21 else close

    return {
        "priceChangePct": pct(close - prev_close, prev_close),
        "bodyPct": abs(close - open_) / candle_range * 100.0,
        "upperWickPct": max(high - max(open_, close), 0.0) / candle_range * 100.0,
        "lowerWickPct": max(min(open_, close) - low, 0.0) / candle_range * 100.0,
        "rangePct": pct(candle_range),
        "trendSlopePct": pct(close - close_20, close_20),
        "momentum3Pct": pct(close - close_3, close_3),
        "momentum8Pct": pct(close - close_8, close_8),
    }


def load_memory() -> List[Dict[str, Any]]:
    try:
        if not NEURAL_BRAIN_MEMORY_FILE.exists():
            return []
        data = json.loads(NEURAL_BRAIN_MEMORY_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return [row for row in data if isinstance(row, dict)][-MAX_MEMORY_ROWS:]
    except Exception:
        return []
    return []


def save_memory(rows: List[Dict[str, Any]]) -> None:
    try:
        NEURAL_BRAIN_MEMORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        NEURAL_BRAIN_MEMORY_FILE.write_text(json.dumps(rows[-MAX_MEMORY_ROWS:], indent=2), encoding="utf-8")
    except Exception:
        pass


def remember_neural_brain_snapshot(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    rows = load_memory()
    row = dict(snapshot)
    row["createdAt"] = row.get("createdAt") or now_iso()
    row["engineVersion"] = NEURAL_BRAIN_VERSION
    rows.append(row)
    save_memory(rows)
    return {
        "eventType": "NEURAL_BRAIN_MEMORY",
        "status": "Recorded",
        "rows": len(rows[-MAX_MEMORY_ROWS:]),
        "createdAt": now_iso(),
    }


def neural_brain_status(symbol: Optional[str] = None, timeframe: Optional[str] = None) -> Dict[str, Any]:
    rows = load_memory()
    filtered = rows
    if symbol:
        filtered = [row for row in filtered if str(row.get("symbol", "")).upper() == str(symbol).upper()]
    if timeframe:
        filtered = [row for row in filtered if str(row.get("timeframe", "")).lower() == str(timeframe).lower()]

    return {
        "eventType": "NEURAL_BRAIN_STATUS",
        "status": "Ready",
        "engineVersion": NEURAL_BRAIN_VERSION,
        "memoryRows": len(rows),
        "filteredRows": len(filtered),
        "modelType": "phase1_weighted_neural_scorecard",
        "trainedModelReady": False,
        "note": "Phase 1 uses weighted neural-style probabilities. Phase 2 can replace this with sklearn/PyTorch after enough labeled outcomes exist.",
        "createdAt": now_iso(),
    }


def build_neural_brain_scorecard(
    *,
    symbol: str = "MES1!",
    timeframe: str = "1m",
    candles: Optional[List[Dict[str, Any]]] = None,
    scorecards: Optional[Dict[str, Any]] = None,
    ml_features: Optional[Dict[str, Any]] = None,
    overlay_payload: Optional[Dict[str, Any]] = None,
    unified_intelligence: Optional[Dict[str, Any]] = None,
    external_data: Optional[Dict[str, Any]] = None,
    auto_record: bool = True,
) -> Dict[str, Any]:
    candles = candles or []
    scorecards = scorecards or {}
    ml_features = ml_features or {}
    overlay_payload = overlay_payload or {}
    unified_intelligence = unified_intelligence or {}
    external_data = external_data or {}

    candle_features = latest_candle_features(candles)

    bull_score = first_number(scorecards, ["bullScore", "bull", "bullishScore"], 50.0)
    bear_score = first_number(scorecards, ["bearScore", "bear", "bearishScore"], 50.0)
    net_bias = first_number(scorecards, ["netBias", "bias", "net"], bull_score - bear_score)

    smc_strength = first_number(scorecards, ["smcStrength", "structureStrength"], first_number(ml_features, ["smcStrength"], 50.0))
    alphax_strength = first_number(scorecards, ["alphaxStrength", "alphaXStrength", "dlmStrength"], first_number(ml_features, ["alphaxStrength"], 50.0))
    ghost_strength = first_number(scorecards, ["ghostConfidence", "ghostStrength"], first_number(ml_features, ["ghostConfidence"], 50.0))

    smc_dir = direction_to_value(scorecards.get("smcDirection") or scorecards.get("smc") or ml_features.get("smcDirection"))
    alphax_dir = direction_to_value(scorecards.get("alphaxDirection") or scorecards.get("alphax") or ml_features.get("alphaxDirection"))
    ghost_dir = direction_to_value(scorecards.get("ghostDirection") or scorecards.get("ghost") or ml_features.get("ghostDirection"))

    bull_pressure = first_number(scorecards, ["alphaxBullPressure", "bullPressurePct", "buyPressurePct"], first_number(overlay_payload, ["bullPressurePct", "buyPressurePct"], 50.0))
    bear_pressure = first_number(scorecards, ["alphaxBearPressure", "bearPressurePct", "sellPressurePct"], first_number(overlay_payload, ["bearPressurePct", "sellPressurePct"], 50.0))

    macro_risk = first_number(external_data, ["macroRisk", "fredMacroRisk", "risk"], first_number(unified_intelligence, ["macroRisk", "risk"], 35.0))
    options_reversal_risk = first_number(external_data, ["optionsReversalRisk", "gammaRisk", "optionsConflictRisk"], 0.0)

    direction_alignment = (smc_dir + alphax_dir + ghost_dir) / 3.0
    pressure_bias = bull_pressure - bear_pressure
    momentum_bias = candle_features["momentum3Pct"] * 8.0 + candle_features["momentum8Pct"] * 4.0 + candle_features["trendSlopePct"] * 2.0
    wick_reversal_bias = candle_features["upperWickPct"] - candle_features["lowerWickPct"]

    raw_buy = (
        0.35 * net_bias
        + 0.22 * pressure_bias
        + 18.0 * direction_alignment
        + 0.12 * smc_strength * max(smc_dir, 0.0)
        + 0.10 * alphax_strength * max(alphax_dir, 0.0)
        + 0.10 * ghost_strength * max(ghost_dir, 0.0)
        + momentum_bias
        - 0.25 * macro_risk
    )

    raw_sell = (
        -0.35 * net_bias
        - 0.22 * pressure_bias
        - 18.0 * direction_alignment
        + 0.12 * smc_strength * abs(min(smc_dir, 0.0))
        + 0.10 * alphax_strength * abs(min(alphax_dir, 0.0))
        + 0.10 * ghost_strength * abs(min(ghost_dir, 0.0))
        - momentum_bias
        - 0.25 * macro_risk
    )

    disagreement = abs(smc_dir - alphax_dir) + abs(smc_dir - ghost_dir) + abs(alphax_dir - ghost_dir)
    chop_risk = clamp(35.0 + disagreement * 13.0 - abs(net_bias) * 0.18 + macro_risk * 0.22)
    reversal_risk = clamp(28.0 + abs(wick_reversal_bias) * 0.35 + options_reversal_risk * 0.35 + disagreement * 8.0 - ghost_strength * 0.12)

    buy_confidence = clamp(sigmoid_score(raw_buy, center=5.0, scale=18.0))
    sell_confidence = clamp(sigmoid_score(raw_sell, center=5.0, scale=18.0))

    best_direction = "bullish" if buy_confidence > sell_confidence + 5 else "bearish" if sell_confidence > buy_confidence + 5 else "neutral"
    target_hit_probability = clamp(max(buy_confidence, sell_confidence) * 0.72 + ghost_strength * 0.18 + (100.0 - chop_risk) * 0.10 - reversal_risk * 0.12)

    if best_direction == "bullish":
        decision = "bullish_continuation" if target_hit_probability >= 55 and reversal_risk < 55 else "bullish_watch"
    elif best_direction == "bearish":
        decision = "bearish_continuation" if target_hit_probability >= 55 and reversal_risk < 55 else "bearish_watch"
    else:
        decision = "wait_for_alignment"

    no_trade_warning = bool(chop_risk >= 62 or reversal_risk >= 70 or target_hit_probability < 38)
    if no_trade_warning and decision not in {"wait_for_alignment"}:
        decision = f"{decision}_with_risk"

    payload = {
        "eventType": "NEURAL_BRAIN_SCORECARD",
        "status": "Ready",
        "engineVersion": NEURAL_BRAIN_VERSION,
        "symbol": symbol,
        "timeframe": timeframe,
        "buyConfidence": round(buy_confidence, 2),
        "sellConfidence": round(sell_confidence, 2),
        "reversalRisk": round(reversal_risk, 2),
        "targetHitProbability": round(target_hit_probability, 2),
        "chopRisk": round(chop_risk, 2),
        "bestDirection": best_direction,
        "decision": decision,
        "noTradeWarning": no_trade_warning,
        "modelType": "phase1_weighted_neural_scorecard",
        "trainedModelReady": False,
        "inputs": {
            "bullScore": round(bull_score, 2),
            "bearScore": round(bear_score, 2),
            "netBias": round(net_bias, 2),
            "smcStrength": round(smc_strength, 2),
            "alphaxStrength": round(alphax_strength, 2),
            "ghostStrength": round(ghost_strength, 2),
            "smcDirectionValue": smc_dir,
            "alphaxDirectionValue": alphax_dir,
            "ghostDirectionValue": ghost_dir,
            "bullPressure": round(bull_pressure, 2),
            "bearPressure": round(bear_pressure, 2),
            "macroRisk": round(macro_risk, 2),
            "optionsReversalRisk": round(options_reversal_risk, 2),
            **{key: round(value, 6) for key, value in candle_features.items()},
        },
        "explain": [
            "Phase 1 keeps the neural brain as an observer/scorer only.",
            "SMC, AlphaX/DLM, Ghost, candle momentum, wick pressure, macro/options risk, and disagreement are blended into probabilities.",
            "Phase 2 can train a real MLP/PyTorch model from stored outcomes once enough snapshots are labeled.",
        ],
        "createdAt": now_iso(),
    }

    if auto_record:
        memory_result = remember_neural_brain_snapshot({
            "symbol": symbol,
            "timeframe": timeframe,
            "decision": decision,
            "bestDirection": best_direction,
            "buyConfidence": payload["buyConfidence"],
            "sellConfidence": payload["sellConfidence"],
            "reversalRisk": payload["reversalRisk"],
            "targetHitProbability": payload["targetHitProbability"],
            "chopRisk": payload["chopRisk"],
            "inputs": payload["inputs"],
        })
        payload["memory"] = memory_result

    return payload


def reset_neural_brain_memory(symbol: Optional[str] = None, timeframe: Optional[str] = None) -> Dict[str, Any]:
    rows = load_memory()
    before = len(rows)
    if symbol or timeframe:
        kept = []
        for row in rows:
            symbol_match = str(row.get("symbol", "")).upper() == str(symbol or row.get("symbol", "")).upper()
            timeframe_match = str(row.get("timeframe", "")).lower() == str(timeframe or row.get("timeframe", "")).lower()
            if symbol_match and timeframe_match:
                continue
            kept.append(row)
        save_memory(kept)
        after = len(kept)
    else:
        save_memory([])
        after = 0

    return {
        "eventType": "NEURAL_BRAIN_RESET",
        "status": "Reset",
        "removed": before - after,
        "remaining": after,
        "createdAt": now_iso(),
    }
