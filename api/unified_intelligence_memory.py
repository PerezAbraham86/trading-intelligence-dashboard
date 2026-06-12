from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

MEMORY_PATH = Path(os.getenv("UNIFIED_INTELLIGENCE_MEMORY_PATH", str(Path(__file__).with_name("unified_intelligence_memory.json"))))
MAX_SNAPSHOTS = int(os.getenv("UNIFIED_INTELLIGENCE_MAX_SNAPSHOTS", "5000"))
MAX_OUTCOMES = int(os.getenv("UNIFIED_INTELLIGENCE_MAX_OUTCOMES", "5000"))

SOURCE_KEYS = [
    "smc",
    "alphax_dlm",
    "order_blocks",
    "liquidity_sweeps",
    "fvg_pd_zones",
    "meters_gauges",
    "external_tables",
    "ghost_route",
    "target_ml",
    "projection_alignment",
    "ai_permission",
    "nrtr_strategy_context",
]

SOURCE_LABELS = {
    "smc": "SMC Structure",
    "alphax_dlm": "AlphaX / DLM",
    "order_blocks": "Order Blocks",
    "liquidity_sweeps": "Liquidity / Sweeps",
    "fvg_pd_zones": "FVG / PD Zones",
    "meters_gauges": "Meters / Gauges",
    "external_tables": "External Tables",
    "ghost_route": "Ghost Route",
    "target_ml": "Target Price ML",
    "projection_alignment": "Target-Ghost Alignment",
    "ai_permission": "AI Permission",
    "nrtr_strategy_context": "NRTR Strategy Context",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def safe_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None:
            return fallback
        parsed = float(value)
        return parsed if math.isfinite(parsed) else fallback
    except Exception:
        return fallback


def to_int(value: Any, fallback: int = 0) -> int:
    try:
        if value is None:
            return fallback
        return int(value)
    except Exception:
        return fallback


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def normalize_symbol(symbol: Any) -> str:
    raw = str(symbol or "MES1!").upper().strip()
    raw = raw.replace("CME_MINI:", "").replace("CME:", "")
    raw = raw.replace("BINANCE:", "").replace("COINBASE:", "").replace("CRYPTO:", "")
    if raw in {"MES", "MES1", "MES1!", "/MES"} or "MES" in raw:
        return "MES1!"
    if raw in {"ES", "ES1", "ES1!", "/ES"}:
        return "ES1!"
    if "BTC" in raw:
        return "BTCUSD"
    if "ETH" in raw:
        return "ETHUSD"
    if "SPY" in raw:
        return "SPY"
    return raw or "MES1!"


def normalize_timeframe(timeframe: Any) -> str:
    raw = str(timeframe or "1m").lower().strip()
    if "/" in raw:
        raw = raw.split("/")[0].strip()
    mapping = {
        "1": "1m", "1m": "1m", "3": "3m", "3m": "3m", "5": "5m", "5m": "5m",
        "10": "10m", "10m": "10m", "15": "15m", "15m": "15m", "30": "30m", "30m": "30m",
        "60": "1h", "60m": "1h", "1h": "1h", "120": "2h", "120m": "2h", "2h": "2h",
        "240": "4h", "240m": "4h", "4h": "4h", "d": "1d", "1d": "1d",
    }
    return mapping.get(raw, raw or "1m")


def normalize_direction(value: Any) -> str:
    text = str(value or "").lower().strip()
    if text in {"1", "up", "buy", "bull", "bullish", "long", "demand"}:
        return "bullish"
    if text in {"-1", "down", "sell", "bear", "bearish", "short", "supply"}:
        return "bearish"
    if "bull" in text or "buy" in text or "long" in text or "up" in text:
        return "bullish"
    if "bear" in text or "sell" in text or "short" in text or "down" in text:
        return "bearish"
    if "conflict" in text:
        return "conflict"
    if "wait" in text or "learn" in text or "pending" in text:
        return "waiting"
    if "ready" in text or "active" in text:
        return "active"
    return "neutral"


def read_path(data: Any, *paths: str, fallback: Any = None) -> Any:
    for path in paths:
        current = data
        ok = True
        for key in path.split("."):
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                ok = False
                break
        if ok and current is not None:
            return current
    return fallback


def first_value(*values: Any) -> Any:
    for value in values:
        if value is not None and value != "":
            return value
    return None


def score(value: Any, fallback: float = 0.0) -> float:
    parsed = to_float(value, fallback)
    if parsed > 0 and parsed <= 1:
        parsed *= 100.0
    return clamp(parsed)


def price(value: Any, fallback: float = 0.0) -> float:
    parsed = to_float(value, fallback)
    return parsed if parsed > 0 else fallback


def load_memory() -> Dict[str, Any]:
    if not MEMORY_PATH.exists():
        return {
            "version": 1,
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
            "sourceStats": {},
            "patternStats": {},
            "contextSnapshots": [],
            "outcomes": [],
        }
    try:
        data = json.loads(MEMORY_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("memory root must be object")
    except Exception:
        data = {}
    data.setdefault("version", 1)
    data.setdefault("createdAt", now_iso())
    data.setdefault("updatedAt", now_iso())
    data.setdefault("sourceStats", {})
    data.setdefault("patternStats", {})
    data.setdefault("contextSnapshots", [])
    data.setdefault("outcomes", [])
    if not isinstance(data["sourceStats"], dict):
        data["sourceStats"] = {}
    if not isinstance(data["patternStats"], dict):
        data["patternStats"] = {}
    if not isinstance(data["contextSnapshots"], list):
        data["contextSnapshots"] = []
    if not isinstance(data["outcomes"], list):
        data["outcomes"] = []
    return data


def save_memory(memory: Dict[str, Any]) -> Dict[str, Any]:
    MEMORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    memory["updatedAt"] = now_iso()
    memory["contextSnapshots"] = safe_list(memory.get("contextSnapshots"))[-MAX_SNAPSHOTS:]
    memory["outcomes"] = safe_list(memory.get("outcomes"))[-MAX_OUTCOMES:]
    tmp = MEMORY_PATH.with_suffix(MEMORY_PATH.suffix + ".tmp")
    tmp.write_text(json.dumps(memory, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(MEMORY_PATH)
    return memory


def source_bucket(symbol: str, timeframe: str, source_key: str) -> str:
    return f"{normalize_symbol(symbol)}|{normalize_timeframe(timeframe)}|{source_key}"


def extract_projection_engine(
    signal: Optional[Dict[str, Any]] = None,
    unified_intelligence: Optional[Dict[str, Any]] = None,
    overlay_payload: Optional[Dict[str, Any]] = None,
    projection_engine: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    signal = safe_dict(signal)
    unified_intelligence = safe_dict(unified_intelligence)
    overlay_payload = safe_dict(overlay_payload)
    candidates = [
        projection_engine,
        unified_intelligence.get("projectionEngine"),
        unified_intelligence.get("unifiedProjectionEngine"),
        safe_dict(unified_intelligence.get("components")).get("projectionEngine"),
        signal.get("projectionEngine"),
        signal.get("unifiedProjectionEngine"),
        overlay_payload.get("projectionEngine"),
        overlay_payload.get("unifiedProjectionEngine"),
        safe_dict(overlay_payload.get("unifiedIntelligence")).get("projectionEngine"),
        safe_dict(overlay_payload.get("unifiedIntelligence")).get("unifiedProjectionEngine"),
        unified_intelligence,
    ]
    for candidate in candidates:
        data = safe_dict(candidate)
        if not data:
            continue
        if data.get("eventType") == "UNIFIED_PROJECTION_ENGINE" or data.get("ghostPath") or data.get("target") or data.get("alignment") or data.get("marketState") or data.get("activeTargetPrice"):
            return data
    return {}


def extract_source_snapshot(
    source_key: str,
    *,
    signal: Dict[str, Any],
    unified_intelligence: Dict[str, Any],
    overlay_payload: Dict[str, Any],
    scorecards: Dict[str, Any],
    ml_features: Dict[str, Any],
    projection_engine: Dict[str, Any],
) -> Dict[str, Any]:
    source_map = safe_dict(read_path(projection_engine, "marketState.sourceMap", fallback={}))
    components = safe_dict(unified_intelligence.get("components"))
    data = safe_dict(source_map.get(source_key))

    if source_key == "smc":
        data = data or safe_dict(source_map.get("smc")) or safe_dict(components.get("smc")) or safe_dict(scorecards.get("smc"))
    elif source_key == "alphax_dlm":
        data = data or safe_dict(source_map.get("alphaDlm")) or safe_dict(components.get("liquidity")) or safe_dict(scorecards.get("liquidityProfile"))
    elif source_key == "order_blocks":
        data = data or safe_dict(source_map.get("orderBlocks")) or safe_dict(scorecards.get("orderBlocks"))
    elif source_key == "liquidity_sweeps":
        data = data or safe_dict(source_map.get("liquidity")) or safe_dict(scorecards.get("liquidity"))
    elif source_key == "fvg_pd_zones":
        data = data or safe_dict(source_map.get("fvgPdZones")) or safe_dict(scorecards.get("fvgPdZones"))
    elif source_key == "meters_gauges":
        data = data or safe_dict(source_map.get("metersGauges")) or safe_dict(scorecards.get("metersGauges")) or safe_dict(scorecards.get("technicalSentiment"))
    elif source_key == "external_tables":
        data = data or safe_dict(source_map.get("externalTables"))
    elif source_key == "ghost_route":
        data = data or safe_dict(projection_engine.get("ghostPath")) or safe_dict(unified_intelligence.get("ghostPath")) or safe_dict(unified_intelligence.get("ghostProjection"))
    elif source_key == "target_ml":
        data = data or safe_dict(projection_engine.get("target")) or safe_dict(projection_engine.get("targetMl")) or safe_dict(signal.get("targetMl"))
    elif source_key == "projection_alignment":
        data = data or safe_dict(projection_engine.get("alignment"))
    elif source_key == "ai_permission":
        data = {
            "direction": projection_engine.get("aiPermission"),
            "confidence": read_path(projection_engine, "alignment.score", fallback=0),
            "score": read_path(projection_engine, "alignment.score", fallback=0),
            "status": projection_engine.get("aiPermission"),
            "reason": read_path(projection_engine, "mode.reason", fallback=""),
        }
    elif source_key == "nrtr_strategy_context":
        data = safe_dict(scorecards.get("nrtrStrategyContext")) or {
            "direction": read_path(ml_features, "nrtrDirection", fallback="neutral"),
            "confidence": read_path(ml_features, "nrtrConfidence", fallback=0),
            "score": read_path(ml_features, "nrtrConfidence", fallback=0),
            "status": "strategy_context_only",
            "reason": "NRTR remains strategy context only; not used by Ghost ML or Target ML hierarchy.",
        }

    confidence = score(first_value(data.get("confidence"), data.get("score"), data.get("qualityScore"), data.get("strength")), 0.0)
    row_score = score(first_value(data.get("score"), data.get("confidence"), data.get("qualityScore"), data.get("strength")), confidence)
    direction = normalize_direction(first_value(data.get("direction"), data.get("bias"), data.get("signal"), data.get("side"), data.get("status")))

    # Zero-confidence rows should not claim a directional edge.
    if confidence <= 0 and row_score <= 0 and source_key not in {"ai_permission"}:
        direction = "neutral"

    return {
        "sourceKey": source_key,
        "source": SOURCE_LABELS.get(source_key, source_key),
        "direction": direction,
        "score": round(row_score, 4),
        "confidence": round(confidence, 4),
        "status": str(data.get("status") or ("active" if confidence > 0 or row_score > 0 else "waiting")),
        "reason": str(data.get("reason") or data.get("details") or ""),
    }


def pattern_key(symbol: str, timeframe: str, snapshot: Dict[str, Any]) -> str:
    state = safe_dict(snapshot.get("state"))
    directions = safe_dict(snapshot.get("sourceDirections"))
    return "|".join([
        normalize_symbol(symbol),
        normalize_timeframe(timeframe),
        f"market:{normalize_direction(state.get('marketDirection'))}",
        f"smc:{normalize_direction(directions.get('smc'))}",
        f"target:{normalize_direction(directions.get('target_ml'))}",
        f"ghost:{normalize_direction(directions.get('ghost_route'))}",
        f"align:{normalize_direction(directions.get('projection_alignment'))}",
        f"permission:{str(snapshot.get('aiPermission', 'WAIT')).upper()}",
        f"mode:{str(snapshot.get('projectionMode', 'UNKNOWN')).upper()}",
    ])


def extract_context_snapshot(
    *,
    symbol: Any = "MES1!",
    timeframe: Any = "1m",
    signal: Optional[Dict[str, Any]] = None,
    unifiedIntelligence: Optional[Dict[str, Any]] = None,
    overlayPayload: Optional[Dict[str, Any]] = None,
    scorecards: Optional[Dict[str, Any]] = None,
    mlFeatures: Optional[Dict[str, Any]] = None,
    projectionEngine: Optional[Dict[str, Any]] = None,
    currentPrice: Any = None,
    **_: Any,
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    signal = safe_dict(signal)
    unified = safe_dict(unifiedIntelligence)
    overlay = safe_dict(overlayPayload)
    cards = safe_dict(scorecards)
    features = safe_dict(mlFeatures)
    projection = extract_projection_engine(signal, unified, overlay, safe_dict(projectionEngine))

    current_price = price(first_value(currentPrice, signal.get("current"), signal.get("price"), projection.get("currentPrice")), 0.0)
    target_price = price(first_value(
        projection.get("activeTargetPrice"), read_path(projection, "target.price", fallback=None), projection.get("targetPrice"),
        read_path(projection, "targetPlan.targetPrice", fallback=None), read_path(projection, "targetMl.targetPrice", fallback=None),
        signal.get("targetPrice"), signal.get("target"),
    ), 0.0)

    target_direction = "neutral"
    if current_price > 0 and target_price > 0:
        target_direction = "bullish" if target_price > current_price else "bearish" if target_price < current_price else "neutral"

    ai_permission = str(first_value(projection.get("aiPermission"), read_path(projection, "mode.aiPermission", fallback=None), "WAIT")).upper()
    projection_mode = str(first_value(projection.get("projectionMode"), read_path(projection, "mode.mode", fallback=None), "UNKNOWN")).upper()
    market_direction = normalize_direction(first_value(read_path(projection, "marketState.direction", fallback=None), read_path(projection, "target.direction", fallback=None), signal.get("direction"), signal.get("signal"), signal.get("type")))

    source_snapshots = {
        key: extract_source_snapshot(
            key,
            signal=signal,
            unified_intelligence=unified,
            overlay_payload=overlay,
            scorecards=cards,
            ml_features=features,
            projection_engine=projection,
        )
        for key in SOURCE_KEYS
    }

    snapshot = {
        "id": f"UICTX-{normalized_symbol}-{normalized_timeframe}-{now_iso()}",
        "eventType": "UNIFIED_INTELLIGENCE_CONTEXT_SNAPSHOT",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "createdAt": now_iso(),
        "state": {
            "currentPrice": current_price,
            "targetPrice": target_price,
            "targetDirection": target_direction,
            "marketDirection": market_direction,
            "aiPermission": ai_permission,
            "projectionMode": projection_mode,
            "alignmentScore": score(read_path(projection, "alignment.score", fallback=0)),
            "targetConfidence": score(first_value(projection.get("targetConfidence"), projection.get("activeTargetConfidence"))),
            "ghostConfidence": score(first_value(projection.get("ghostConfidence"), read_path(projection, "ghostPath.confidence", fallback=0))),
        },
        "aiPermission": ai_permission,
        "projectionMode": projection_mode,
        "sourceSnapshots": source_snapshots,
        "sourceDirections": {key: row["direction"] for key, row in source_snapshots.items()},
        "sourceConfidences": {key: row["confidence"] for key, row in source_snapshots.items()},
        "sourceScores": {key: row["score"] for key, row in source_snapshots.items()},
    }
    snapshot["patternKey"] = pattern_key(normalized_symbol, normalized_timeframe, snapshot)
    return snapshot


def remember_context_snapshot(**payload: Any) -> Dict[str, Any]:
    memory = load_memory()
    snapshot = extract_context_snapshot(**payload)
    snapshots = safe_list(memory.get("contextSnapshots"))

    last = snapshots[-1] if snapshots and isinstance(snapshots[-1], dict) else {}
    duplicate = (
        last.get("symbol") == snapshot["symbol"]
        and last.get("timeframe") == snapshot["timeframe"]
        and last.get("aiPermission") == snapshot["aiPermission"]
        and last.get("projectionMode") == snapshot["projectionMode"]
        and last.get("sourceDirections") == snapshot["sourceDirections"]
        and round(to_float(read_path(last, "state.currentPrice", fallback=0)), 2) == round(to_float(read_path(snapshot, "state.currentPrice", fallback=0)), 2)
        and round(to_float(read_path(last, "state.targetPrice", fallback=0)), 2) == round(to_float(read_path(snapshot, "state.targetPrice", fallback=0)), 2)
    )

    if duplicate:
        last["updatedAt"] = now_iso()
        last["repeatCount"] = to_int(last.get("repeatCount"), 1) + 1
        snapshots[-1] = last
        snapshot = last
    else:
        snapshots.append(snapshot)

    memory["contextSnapshots"] = snapshots
    save_memory(memory)
    return {
        "eventType": "UNIFIED_INTELLIGENCE_LEARN",
        "status": "ContextSaved",
        "snapshot": snapshot,
        "memoryStatus": unified_memory_status(snapshot["symbol"], snapshot["timeframe"]),
        "createdAt": now_iso(),
    }


def reliability_from_stats(stats: Dict[str, Any]) -> float:
    samples = to_int(stats.get("samples"), 0)
    if samples <= 0:
        return 50.0
    target_rate = to_int(stats.get("targetHits"), 0) / samples
    direction_rate = to_int(stats.get("directionCorrect"), 0) / samples
    hold_rate = to_int(stats.get("holdCorrect"), 0) / samples
    raw = (target_rate * 45.0) + (direction_rate * 40.0) + (hold_rate * 15.0)
    weight = clamp(samples / 50.0, 0.15, 1.0)
    return round((50.0 * (1.0 - weight)) + (raw * weight), 2)


def adjustment_from_reliability(reliability: float) -> float:
    return round(clamp((reliability - 50.0) * 0.4, -20.0, 20.0), 2)


def blank_source_stats(source_key: str, symbol: str, timeframe: str) -> Dict[str, Any]:
    return {
        "sourceKey": source_key,
        "source": SOURCE_LABELS.get(source_key, source_key),
        "symbol": normalize_symbol(symbol),
        "timeframe": normalize_timeframe(timeframe),
        "samples": 0,
        "targetHits": 0,
        "targetMisses": 0,
        "directionCorrect": 0,
        "directionWrong": 0,
        "holdCorrect": 0,
        "holdWrong": 0,
        "avgConfidence": 0.0,
        "avgScore": 0.0,
        "avgTargetErrorPoints": 0.0,
        "reliability": 50.0,
        "scoreAdjustment": 0.0,
        "lastOutcome": "none",
        "updatedAt": now_iso(),
    }


def blank_pattern_stats(key: str, symbol: str, timeframe: str) -> Dict[str, Any]:
    return {
        "patternKey": key,
        "symbol": normalize_symbol(symbol),
        "timeframe": normalize_timeframe(timeframe),
        "samples": 0,
        "targetHits": 0,
        "targetMisses": 0,
        "directionCorrect": 0,
        "directionWrong": 0,
        "holdCorrect": 0,
        "holdWrong": 0,
        "avgOutcomeScore": 0.0,
        "avgTargetErrorPoints": 0.0,
        "reliability": 50.0,
        "scoreAdjustment": 0.0,
        "lastOutcome": "none",
        "updatedAt": now_iso(),
    }


def running_average(old_average: float, old_count: int, new_value: float) -> float:
    if old_count <= 0:
        return new_value
    return ((old_average * old_count) + new_value) / (old_count + 1)


def determine_outcome(snapshot: Dict[str, Any], currentPrice: Any = None, candles: Optional[List[Any]] = None, outcome: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    outcome = safe_dict(outcome)
    candles = safe_list(candles)
    start_price = price(read_path(snapshot, "state.currentPrice", fallback=0), 0.0)
    target_price = price(read_path(snapshot, "state.targetPrice", fallback=0), 0.0)
    final_price = price(currentPrice, 0.0)
    high = final_price
    low = final_price

    if candles:
        highs = [to_float(safe_dict(c).get("high", safe_dict(c).get("h")), 0.0) for c in candles]
        lows = [to_float(safe_dict(c).get("low", safe_dict(c).get("l")), 0.0) for c in candles]
        closes = [to_float(safe_dict(c).get("close", safe_dict(c).get("c")), 0.0) for c in candles]
        highs = [v for v in highs if v > 0]
        lows = [v for v in lows if v > 0]
        closes = [v for v in closes if v > 0]
        if highs:
            high = max(high, max(highs))
        if lows:
            low = min(low if low > 0 else min(lows), min(lows))
        if closes:
            final_price = closes[-1]

    if final_price <= 0:
        final_price = price(outcome.get("finalPrice"), start_price)

    target_direction = read_path(snapshot, "state.targetDirection", fallback="neutral")
    target_hit = bool(outcome.get("targetHit", False))
    if target_price > 0:
        if target_direction == "bullish" and high >= target_price:
            target_hit = True
        if target_direction == "bearish" and low <= target_price:
            target_hit = True

    predicted = normalize_direction(read_path(snapshot, "state.marketDirection", fallback="neutral"))
    actual = "neutral"
    if start_price > 0 and final_price > 0:
        actual = "bullish" if final_price > start_price else "bearish" if final_price < start_price else "neutral"

    direction_correct = predicted in {"bullish", "bearish"} and predicted == actual
    direction_wrong = predicted in {"bullish", "bearish"} and actual in {"bullish", "bearish"} and predicted != actual
    ai_permission = str(snapshot.get("aiPermission", "WAIT")).upper()
    hold_mode = "HOLD" in ai_permission or "WAIT" in ai_permission or "CONFLICT" in ai_permission
    hold_correct = bool(hold_mode and (not target_hit or predicted != actual))
    hold_wrong = bool(hold_mode and target_hit and predicted == actual)
    target_error = abs(target_price - final_price) if target_price > 0 and final_price > 0 else 0.0

    outcome_score = 0.0
    if target_hit:
        outcome_score += 50.0
    if direction_correct:
        outcome_score += 35.0
    if hold_correct:
        outcome_score += 15.0
    if direction_wrong:
        outcome_score -= 25.0
    if hold_wrong:
        outcome_score -= 15.0

    return {
        "targetHit": target_hit,
        "targetMiss": bool(target_price > 0 and not target_hit),
        "predictedDirection": predicted,
        "actualDirection": actual,
        "directionCorrect": direction_correct,
        "directionWrong": direction_wrong,
        "holdMode": hold_mode,
        "holdCorrect": hold_correct,
        "holdWrong": hold_wrong,
        "startPrice": start_price,
        "finalPrice": final_price,
        "targetPrice": target_price,
        "targetErrorPoints": round(target_error, 6),
        "outcomeScore": round(clamp(outcome_score, -50.0, 100.0), 4),
    }


def source_participated(snapshot: Dict[str, Any], source_key: str) -> bool:
    data = safe_dict(read_path(snapshot, f"sourceSnapshots.{source_key}", fallback={}))
    return to_float(data.get("confidence"), 0.0) > 0 or to_float(data.get("score"), 0.0) > 0 or normalize_direction(data.get("direction")) in {"bullish", "bearish", "active", "conflict"}


def source_correctness(snapshot: Dict[str, Any], source_key: str, outcome: Dict[str, Any]) -> tuple[bool, bool]:
    data = safe_dict(read_path(snapshot, f"sourceSnapshots.{source_key}", fallback={}))
    direction = normalize_direction(data.get("direction"))
    actual = normalize_direction(outcome.get("actualDirection"))
    if direction in {"bullish", "bearish"} and actual in {"bullish", "bearish"}:
        return direction == actual, direction != actual
    if source_key in {"target_ml", "ghost_route", "projection_alignment"}:
        return bool(outcome.get("targetHit")), bool(outcome.get("targetMiss"))
    if source_key == "ai_permission":
        return bool(outcome.get("holdCorrect")), bool(outcome.get("holdWrong"))
    return False, False


def update_source_stats(memory: Dict[str, Any], snapshot: Dict[str, Any], outcome: Dict[str, Any]) -> None:
    source_stats = safe_dict(memory.get("sourceStats"))
    symbol = snapshot.get("symbol", "MES1!")
    timeframe = snapshot.get("timeframe", "1m")

    for source_key in SOURCE_KEYS:
        if not source_participated(snapshot, source_key):
            continue
        bucket = source_bucket(symbol, timeframe, source_key)
        stats = safe_dict(source_stats.get(bucket)) or blank_source_stats(source_key, symbol, timeframe)
        old_count = to_int(stats.get("samples"), 0)
        data = safe_dict(read_path(snapshot, f"sourceSnapshots.{source_key}", fallback={}))
        correct, wrong = source_correctness(snapshot, source_key, outcome)
        confidence = to_float(data.get("confidence"), 0.0)
        row_score = to_float(data.get("score"), 0.0)

        stats["samples"] = old_count + 1
        stats["targetHits"] = to_int(stats.get("targetHits"), 0) + (1 if outcome.get("targetHit") else 0)
        stats["targetMisses"] = to_int(stats.get("targetMisses"), 0) + (1 if outcome.get("targetMiss") else 0)
        stats["directionCorrect"] = to_int(stats.get("directionCorrect"), 0) + (1 if correct else 0)
        stats["directionWrong"] = to_int(stats.get("directionWrong"), 0) + (1 if wrong else 0)
        stats["holdCorrect"] = to_int(stats.get("holdCorrect"), 0) + (1 if source_key == "ai_permission" and outcome.get("holdCorrect") else 0)
        stats["holdWrong"] = to_int(stats.get("holdWrong"), 0) + (1 if source_key == "ai_permission" and outcome.get("holdWrong") else 0)
        stats["avgConfidence"] = round(running_average(to_float(stats.get("avgConfidence"), 0.0), old_count, confidence), 4)
        stats["avgScore"] = round(running_average(to_float(stats.get("avgScore"), 0.0), old_count, row_score), 4)
        stats["avgTargetErrorPoints"] = round(running_average(to_float(stats.get("avgTargetErrorPoints"), 0.0), old_count, to_float(outcome.get("targetErrorPoints"), 0.0)), 6)
        stats["lastOutcome"] = "correct" if correct else "wrong" if wrong else "observed"
        stats["reliability"] = reliability_from_stats(stats)
        stats["scoreAdjustment"] = adjustment_from_reliability(to_float(stats.get("reliability"), 50.0))
        stats["updatedAt"] = now_iso()
        source_stats[bucket] = stats

    memory["sourceStats"] = source_stats


def update_pattern_stats(memory: Dict[str, Any], snapshot: Dict[str, Any], outcome: Dict[str, Any]) -> None:
    pattern_stats = safe_dict(memory.get("patternStats"))
    key = str(snapshot.get("patternKey") or pattern_key(snapshot.get("symbol"), snapshot.get("timeframe"), snapshot))
    stats = safe_dict(pattern_stats.get(key)) or {
        "patternKey": key,
        "symbol": snapshot.get("symbol"),
        "timeframe": snapshot.get("timeframe"),
        "samples": 0,
        "targetHits": 0,
        "targetMisses": 0,
        "directionCorrect": 0,
        "directionWrong": 0,
        "holdCorrect": 0,
        "holdWrong": 0,
        "avgOutcomeScore": 0.0,
        "avgTargetErrorPoints": 0.0,
        "reliability": 50.0,
        "scoreAdjustment": 0.0,
        "lastOutcome": "none",
        "updatedAt": now_iso(),
    }
    old_count = to_int(stats.get("samples"), 0)
    stats["samples"] = old_count + 1
    stats["targetHits"] = to_int(stats.get("targetHits"), 0) + (1 if outcome.get("targetHit") else 0)
    stats["targetMisses"] = to_int(stats.get("targetMisses"), 0) + (1 if outcome.get("targetMiss") else 0)
    stats["directionCorrect"] = to_int(stats.get("directionCorrect"), 0) + (1 if outcome.get("directionCorrect") else 0)
    stats["directionWrong"] = to_int(stats.get("directionWrong"), 0) + (1 if outcome.get("directionWrong") else 0)
    stats["holdCorrect"] = to_int(stats.get("holdCorrect"), 0) + (1 if outcome.get("holdCorrect") else 0)
    stats["holdWrong"] = to_int(stats.get("holdWrong"), 0) + (1 if outcome.get("holdWrong") else 0)
    stats["avgOutcomeScore"] = round(running_average(to_float(stats.get("avgOutcomeScore"), 0.0), old_count, to_float(outcome.get("outcomeScore"), 0.0)), 4)
    stats["avgTargetErrorPoints"] = round(running_average(to_float(stats.get("avgTargetErrorPoints"), 0.0), old_count, to_float(outcome.get("targetErrorPoints"), 0.0)), 6)
    stats["reliability"] = reliability_from_stats(stats)
    stats["scoreAdjustment"] = adjustment_from_reliability(to_float(stats.get("reliability"), 50.0))
    stats["lastOutcome"] = "target_hit" if outcome.get("targetHit") else "direction_correct" if outcome.get("directionCorrect") else "hold_correct" if outcome.get("holdCorrect") else "miss"
    stats["updatedAt"] = now_iso()
    pattern_stats[key] = stats
    memory["patternStats"] = pattern_stats


def evaluate_unified_intelligence_outcome(
    *,
    snapshotId: Optional[str] = None,
    symbol: Any = "MES1!",
    timeframe: Any = "1m",
    currentPrice: Any = None,
    candles: Optional[List[Any]] = None,
    outcome: Optional[Dict[str, Any]] = None,
    **payload: Any,
) -> Dict[str, Any]:
    memory = load_memory()
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    snapshot = None
    for row in reversed(safe_list(memory.get("contextSnapshots"))):
        if not isinstance(row, dict):
            continue
        if snapshotId and row.get("id") != snapshotId:
            continue
        if not snapshotId and (normalize_symbol(row.get("symbol")) != normalized_symbol or normalize_timeframe(row.get("timeframe")) != normalized_timeframe):
            continue
        snapshot = row
        break

    if snapshot is None:
        snapshot = safe_dict(remember_context_snapshot(symbol=symbol, timeframe=timeframe, currentPrice=currentPrice, **payload).get("snapshot"))

    result = determine_outcome(snapshot, currentPrice=currentPrice, candles=candles, outcome=outcome)
    row = {
        "id": f"UIOUT-{normalized_symbol}-{normalized_timeframe}-{now_iso()}",
        "snapshotId": snapshot.get("id"),
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "patternKey": snapshot.get("patternKey"),
        "snapshotCreatedAt": snapshot.get("createdAt"),
        "createdAt": now_iso(),
        "outcome": result,
    }
    memory["outcomes"] = safe_list(memory.get("outcomes")) + [row]
    update_source_stats(memory, snapshot, result)
    update_pattern_stats(memory, snapshot, result)
    save_memory(memory)
    return {
        "eventType": "UNIFIED_INTELLIGENCE_OUTCOME",
        "status": "Evaluated",
        "snapshot": snapshot,
        "outcome": result,
        "memoryStatus": unified_memory_status(normalized_symbol, normalized_timeframe),
        "createdAt": now_iso(),
    }


def unified_memory_status(symbol: Any = "", timeframe: Any = "") -> Dict[str, Any]:
    memory = load_memory()
    normalized_symbol = normalize_symbol(symbol) if symbol else ""
    normalized_timeframe = normalize_timeframe(timeframe) if timeframe else ""

    def row_matches(row: Dict[str, Any]) -> bool:
        if normalized_symbol and normalize_symbol(row.get("symbol")) != normalized_symbol:
            return False
        if normalized_timeframe and normalize_timeframe(row.get("timeframe")) != normalized_timeframe:
            return False
        return True

    snapshots = [row for row in safe_list(memory.get("contextSnapshots")) if isinstance(row, dict) and row_matches(row)]
    outcomes = [row for row in safe_list(memory.get("outcomes")) if isinstance(row, dict) and row_matches(row)]
    sources = [row for row in safe_dict(memory.get("sourceStats")).values() if isinstance(row, dict) and row_matches(row)]
    patterns = [row for row in safe_dict(memory.get("patternStats")).values() if isinstance(row, dict) and row_matches(row)]

    if len(outcomes) >= 50:
        stage = "SOURCE_RELIABILITY_LEARNING"
        message = f"Unified Intelligence memory ready: {len(outcomes)} evaluated outcomes"
    elif len(outcomes) >= 10:
        stage = "EARLY_OUTCOME_LEARNING"
        message = f"Unified Intelligence has {len(outcomes)} evaluated outcomes"
    elif len(snapshots) >= 25:
        stage = "CONTEXT_OBSERVATION_LEARNING"
        message = f"Unified Intelligence is observing {len(snapshots)} context snapshots"
    elif snapshots:
        stage = "WARMING_UP"
        message = f"Unified Intelligence warming up: {len(snapshots)} snapshots, {len(outcomes)} outcomes"
    else:
        stage = "WAITING_FOR_CONTEXT"
        message = "Waiting for unified context snapshots"

    top_sources = sorted(sources, key=lambda row: (to_float(row.get("reliability"), 50.0), to_int(row.get("samples"), 0)), reverse=True)[:12]
    top_patterns = sorted(patterns, key=lambda row: (to_int(row.get("samples"), 0), to_float(row.get("reliability"), 50.0)), reverse=True)[:12]

    return {
        "eventType": "UNIFIED_INTELLIGENCE_MEMORY_STATUS",
        "status": "Ready",
        "stage": stage,
        "message": message,
        "symbol": normalized_symbol or "ALL",
        "timeframe": normalized_timeframe or "ALL",
        "snapshotCount": len(snapshots),
        "outcomeCount": len(outcomes),
        "sourceCount": len(sources),
        "patternCount": len(patterns),
        "topSources": top_sources,
        "topPatterns": top_patterns,
        "memoryPath": str(MEMORY_PATH),
        "updatedAt": memory.get("updatedAt"),
        "createdAt": now_iso(),
    }


def apply_unified_memory_adjustments(*, symbol: Any = "MES1!", timeframe: Any = "1m", rows: Optional[List[Dict[str, Any]]] = None, **_: Any) -> Dict[str, Any]:
    memory = load_memory()
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    adjusted_rows = []
    for row in safe_list(rows):
        if not isinstance(row, dict):
            continue
        source_key = str(row.get("sourceKey") or row.get("key") or "").strip()
        bucket = source_bucket(normalized_symbol, normalized_timeframe, source_key)
        stats = safe_dict(read_path(memory, f"sourceStats.{bucket}", fallback={}))
        reliability = to_float(stats.get("reliability"), 50.0)
        adjustment = to_float(stats.get("scoreAdjustment"), 0.0)
        base_score = score(first_value(row.get("score"), row.get("confidence")), 0.0)
        adjusted_rows.append({
            **row,
            "learnedReliability": round(reliability, 2),
            "memoryAdjustment": round(adjustment, 2),
            "adjustedScore": round(clamp(base_score + adjustment), 2),
            "memorySamples": to_int(stats.get("samples"), 0),
            "memoryStatus": "active" if to_int(stats.get("samples"), 0) > 0 else "learning",
        })
    return {
        "eventType": "UNIFIED_INTELLIGENCE_MEMORY_ADJUST",
        "status": "Ready",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "rows": adjusted_rows,
        "memoryStatus": unified_memory_status(normalized_symbol, normalized_timeframe),
        "createdAt": now_iso(),
    }


def unified_intelligence_export() -> Dict[str, Any]:
    memory = load_memory()
    return {
        "eventType": "UNIFIED_INTELLIGENCE_MEMORY_EXPORT",
        "status": "Ready",
        "memory": memory,
        "summary": unified_memory_status(),
        "createdAt": now_iso(),
    }


def reset_unified_intelligence_memory(symbol: Optional[Any] = None, timeframe: Optional[Any] = None) -> Dict[str, Any]:
    if not symbol and not timeframe:
        memory = {
            "version": 1,
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
            "sourceStats": {},
            "patternStats": {},
            "contextSnapshots": [],
            "outcomes": [],
        }
        save_memory(memory)
        return {"eventType": "UNIFIED_INTELLIGENCE_MEMORY_RESET", "status": "Reset", "createdAt": now_iso()}

    memory = load_memory()
    normalized_symbol = normalize_symbol(symbol) if symbol else ""
    normalized_timeframe = normalize_timeframe(timeframe) if timeframe else ""

    def keep(row: Any) -> bool:
        if not isinstance(row, dict):
            return False
        if normalized_symbol and normalize_symbol(row.get("symbol")) != normalized_symbol:
            return True
        if normalized_timeframe and normalize_timeframe(row.get("timeframe")) != normalized_timeframe:
            return True
        return False

    memory["contextSnapshots"] = [row for row in safe_list(memory.get("contextSnapshots")) if keep(row)]
    memory["outcomes"] = [row for row in safe_list(memory.get("outcomes")) if keep(row)]
    memory["sourceStats"] = {key: row for key, row in safe_dict(memory.get("sourceStats")).items() if keep(row)}
    memory["patternStats"] = {key: row for key, row in safe_dict(memory.get("patternStats")).items() if keep(row)}
    save_memory(memory)
    return {
        "eventType": "UNIFIED_INTELLIGENCE_MEMORY_RESET",
        "status": "PartialReset",
        "symbol": normalized_symbol or "ALL",
        "timeframe": normalized_timeframe or "ALL",
        "createdAt": now_iso(),
    }
