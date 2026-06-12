from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# ─────────────────────────────────────────────────────────────────────────────
# MARKETBOS UNIFIED PROJECTION ENGINE
# ─────────────────────────────────────────────────────────────────────────────
#
# One shared self-learning projection brain:
#
#   SMC + AlphaX/DLM + Order Blocks + Liquidity + FVG + Meters + external tables
#       → unified market state
#       → self-learning price target / ghost overlay target
#       → target-guided ghost candle route
#       → live correction every candle
#       → shared context for Ghost Projection, Recent Signals, Matrix, AI Trader
#
# Core rule:
#   Target = destination
#   Ghost candles = route
#   Live candles = correction feedback
#   AI trader = decision manager
#
# No broker. No bot. Dashboard-only intelligence.
# ─────────────────────────────────────────────────────────────────────────────


MEMORY_PATH = Path(
    os.getenv(
        "PROJECTION_ENGINE_MEMORY_PATH",
        str(Path(__file__).with_name("projection_engine_memory.json")),
    )
)

MAX_MEMORY_ROWS = int(os.getenv("PROJECTION_ENGINE_MAX_MEMORY_ROWS", "5000"))
DEFAULT_GHOST_CANDLES = int(os.getenv("PROJECTION_ENGINE_DEFAULT_GHOST_CANDLES", "3"))


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
        if not math.isfinite(parsed):
            return fallback
        return parsed
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


def safe_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def safe_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def normalize_symbol(symbol: Any) -> str:
    raw = str(symbol or "MES1!").strip().upper()
    raw = (
        raw.replace("CME_MINI:", "")
        .replace("CME:", "")
        .replace("BINANCE:", "")
        .replace("COINBASE:", "")
        .replace("CRYPTO:", "")
    )

    if raw in {"MES", "MES1", "MES1!", "/MES"}:
        return "MES1!"
    if raw in {"ES", "ES1", "ES1!", "/ES"}:
        return "ES1!"
    if "BTC" in raw:
        return "BTCUSD"
    if "ETH" in raw:
        return "ETHUSD"

    return raw or "MES1!"


def normalize_timeframe(timeframe: Any) -> str:
    raw = str(timeframe or "1m").strip().lower()
    mapping = {
        "1": "1m",
        "1m": "1m",
        "3": "3m",
        "3m": "3m",
        "5": "5m",
        "5m": "5m",
        "10": "10m",
        "10m": "10m",
        "15": "15m",
        "15m": "15m",
        "30": "30m",
        "30m": "30m",
        "60": "1h",
        "60m": "1h",
        "1h": "1h",
        "240": "4h",
        "4h": "4h",
    }
    return mapping.get(raw, raw or "1m")


def normalize_direction(value: Any) -> str:
    raw = str(value or "").strip().lower()

    if raw in {"buy", "bull", "bullish", "long", "up", "1"}:
        return "BULLISH"
    if raw in {"sell", "bear", "bearish", "short", "down", "-1"}:
        return "BEARISH"
    if raw in {"mixed", "conflict", "both"}:
        return "MIXED"

    return "NEUTRAL"


def opposite_direction(direction: str) -> str:
    if direction == "BULLISH":
        return "BEARISH"
    if direction == "BEARISH":
        return "BULLISH"
    return "NEUTRAL"


def direction_to_side(direction: str) -> str:
    if direction == "BULLISH":
        return "BUY"
    if direction == "BEARISH":
        return "SELL"
    return "HOLD"


def signed_distance(direction: str, start: float, end: float) -> float:
    if direction == "BULLISH":
        return end - start
    if direction == "BEARISH":
        return start - end
    return 0.0


def point_value(symbol: str) -> float:
    normalized = normalize_symbol(symbol)

    if normalized.startswith("MES"):
        return 5.0
    if normalized.startswith("ES"):
        return 50.0

    return 1.0


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


def read_number(data: Any, *paths: str, fallback: float = 0.0) -> float:
    return to_float(read_path(data, *paths, fallback=fallback), fallback)


def unique_key(symbol: str, timeframe: str, timestamp: Any) -> str:
    return f"{normalize_symbol(symbol)}|{normalize_timeframe(timeframe)}|{str(timestamp or now_iso())}"


def candle_time(candle: Any) -> Any:
    data = safe_dict(candle)
    return data.get("time") or data.get("timestamp") or data.get("t")


def candle_ohlc(candle: Any) -> Tuple[float, float, float, float]:
    data = safe_dict(candle)

    open_ = to_float(data.get("open", data.get("o")), 0.0)
    high = to_float(data.get("high", data.get("h")), 0.0)
    low = to_float(data.get("low", data.get("l")), 0.0)
    close = to_float(data.get("close", data.get("c")), 0.0)

    return open_, high, low, close


def latest_valid_candle(candles: List[Any]) -> Dict[str, Any]:
    for candle in reversed(safe_list(candles)):
        _open, high, low, close = candle_ohlc(candle)
        if close > 0 and high >= low:
            return safe_dict(candle)

    return {}


def latest_close(candles: List[Any], fallback: float = 0.0) -> float:
    candle = latest_valid_candle(candles)
    return to_float(candle.get("close", candle.get("c")), fallback)


def calculate_atr(candles: List[Any], length: int = 14) -> float:
    rows = safe_list(candles)

    if len(rows) < 2:
        close = latest_close(rows, 0.0)
        return max(close * 0.001, 0.25) if close > 0 else 0.25

    true_ranges: List[float] = []

    for index, candle in enumerate(rows):
        _open, high, low, _close = candle_ohlc(candle)
        if high <= 0 or low <= 0:
            continue

        if index == 0:
            true_ranges.append(max(high - low, 0.0))
            continue

        previous_close = candle_ohlc(rows[index - 1])[3]
        true_ranges.append(
            max(
                high - low,
                abs(high - previous_close),
                abs(low - previous_close),
            )
        )

    sample = true_ranges[-max(1, length):]
    if not sample:
        close = latest_close(rows, 0.0)
        return max(close * 0.001, 0.25) if close > 0 else 0.25

    atr = sum(sample) / len(sample)
    close = latest_close(rows, 0.0)
    floor = max(close * 0.0005, 0.25) if close > 0 else 0.25
    return max(atr, floor)


# ─────────────────────────────────────────────────────────────────────────────
# MEMORY
# ─────────────────────────────────────────────────────────────────────────────


def load_memory() -> Dict[str, Any]:
    if not MEMORY_PATH.exists():
        return {
            "version": 1,
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
            "openProjections": [],
            "closedProjections": [],
            "corrections": [],
            "sourceStats": {},
            "targetLocks": {},
        }

    try:
        data = json.loads(MEMORY_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("projection memory root must be object")
    except Exception:
        data = {}

    data.setdefault("version", 1)
    data.setdefault("createdAt", now_iso())
    data.setdefault("updatedAt", now_iso())
    data.setdefault("openProjections", [])
    data.setdefault("closedProjections", [])
    data.setdefault("corrections", [])
    data.setdefault("sourceStats", {})
    data.setdefault("targetLocks", {})

    if not isinstance(data["openProjections"], list):
        data["openProjections"] = []
    if not isinstance(data["closedProjections"], list):
        data["closedProjections"] = []
    if not isinstance(data["corrections"], list):
        data["corrections"] = []
    if not isinstance(data["sourceStats"], dict):
        data["sourceStats"] = {}
    if not isinstance(data["targetLocks"], dict):
        data["targetLocks"] = {}

    return data


def save_memory(memory: Dict[str, Any]) -> Dict[str, Any]:
    MEMORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    memory["updatedAt"] = now_iso()
    memory["openProjections"] = safe_list(memory.get("openProjections"))[-MAX_MEMORY_ROWS:]
    memory["closedProjections"] = safe_list(memory.get("closedProjections"))[-MAX_MEMORY_ROWS:]
    memory["corrections"] = safe_list(memory.get("corrections"))[-MAX_MEMORY_ROWS:]
    MEMORY_PATH.write_text(json.dumps(memory, indent=2, sort_keys=True), encoding="utf-8")
    return memory


def summarize_projection_memory(symbol: Any = "", timeframe: Any = "") -> Dict[str, Any]:
    memory = load_memory()
    normalized_symbol = normalize_symbol(symbol) if symbol else ""
    normalized_timeframe = normalize_timeframe(timeframe) if timeframe else ""

    def matches(row: Dict[str, Any]) -> bool:
        if normalized_symbol and normalize_symbol(row.get("symbol")) != normalized_symbol:
            return False
        if normalized_timeframe and normalize_timeframe(row.get("timeframe")) != normalized_timeframe:
            return False
        return True

    closed = [row for row in safe_list(memory.get("closedProjections")) if isinstance(row, dict) and matches(row)]
    corrections = [row for row in safe_list(memory.get("corrections")) if isinstance(row, dict) and matches(row)]
    open_rows = [row for row in safe_list(memory.get("openProjections")) if isinstance(row, dict) and matches(row)]

    total = len(closed)
    target_hits = sum(1 for row in closed if bool(row.get("targetHit")))
    direction_hits = sum(1 for row in closed if bool(row.get("directionCorrect")))

    avg_target_error = (
        sum(to_float(row.get("targetErrorPoints"), 0.0) for row in closed) / total
        if total
        else 0.0
    )
    avg_path_error = (
        sum(to_float(row.get("pathErrorPoints"), 0.0) for row in closed) / total
        if total
        else 0.0
    )
    avg_correction = (
        sum(abs(to_float(row.get("correctionPoints"), 0.0)) for row in corrections) / len(corrections)
        if corrections
        else 0.0
    )

    return {
        "eventType": "PROJECTION_ENGINE_MEMORY_SUMMARY",
        "status": "Ready",
        "symbol": normalized_symbol or "ALL",
        "timeframe": normalized_timeframe or "ALL",
        "openCount": len(open_rows),
        "closedCount": total,
        "correctionCount": len(corrections),
        "targetHitRate": round(target_hits / total, 4) if total else 0.0,
        "directionAccuracy": round(direction_hits / total, 4) if total else 0.0,
        "avgTargetErrorPoints": round(avg_target_error, 4),
        "avgPathErrorPoints": round(avg_path_error, 4),
        "avgCorrectionPoints": round(avg_correction, 4),
        "memoryPath": str(MEMORY_PATH),
        "updatedAt": memory.get("updatedAt"),
    }


# ─────────────────────────────────────────────────────────────────────────────
# TARGET SOURCE LOCK / SMOOTHING
# ─────────────────────────────────────────────────────────────────────────────

TARGET_LOCK_MAX_AGE_SECONDS = int(os.getenv("PROJECTION_ENGINE_TARGET_LOCK_MAX_AGE_SECONDS", "900"))
TARGET_LOCK_SWITCH_BONUS = float(os.getenv("PROJECTION_ENGINE_TARGET_LOCK_SWITCH_BONUS", "10"))
TARGET_LOCK_DROP_TOLERANCE = float(os.getenv("PROJECTION_ENGINE_TARGET_LOCK_DROP_TOLERANCE", "12"))


def parse_iso_epoch(value: Any) -> float:
    try:
        if not value:
            return 0.0
        if isinstance(value, (int, float)):
            numeric = float(value)
            return numeric / 1000.0 if numeric > 1000000000000 else numeric
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except Exception:
        return 0.0


def lock_key(symbol: Any, timeframe: Any) -> str:
    return f"{normalize_symbol(symbol)}|{normalize_timeframe(timeframe)}"


def target_rank(target_type: Any) -> int:
    raw = str(target_type or "").upper()
    if raw == "REAL_TARGET_PRICE_ML":
        return 100
    if raw in {"LIQUIDITY", "LIQUIDITY_TARGET", "ORDER_BLOCK", "FVG", "FVG_REBALANCE", "PD_ZONE"}:
        return 70
    if raw == "EXTERNAL_TARGET_TABLE":
        return 55
    if raw == "GHOST_OVERLAY_TARGET":
        return 40
    if raw == "NONE":
        return 0
    return 45


def target_is_usable(target: Dict[str, Any], current_price: float) -> bool:
    if not target.get("available"):
        return False
    price = to_float(target.get("price"), 0.0)
    if price <= 0 or current_price <= 0:
        return False
    if abs(price - current_price) / max(current_price, 0.000001) > 0.35:
        return False
    return True


def get_target_lock(memory: Dict[str, Any], symbol: Any, timeframe: Any) -> Dict[str, Any]:
    locks = safe_dict(memory.get("targetLocks"))
    lock = safe_dict(locks.get(lock_key(symbol, timeframe)))
    if not lock:
        return {}
    age = datetime.now(timezone.utc).timestamp() - parse_iso_epoch(lock.get("updatedAt"))
    if age > TARGET_LOCK_MAX_AGE_SECONDS:
        return {}
    return lock


def candidate_from_lock(lock: Dict[str, Any], current_price: float, atr: float) -> Dict[str, Any]:
    price = to_float(lock.get("price"), 0.0)
    direction = normalize_direction(lock.get("direction"))
    if direction == "NEUTRAL" and price > 0 and current_price > 0:
        direction = "BULLISH" if price > current_price else "BEARISH" if price < current_price else "NEUTRAL"
    return {
        "available": price > 0,
        "price": price,
        "direction": direction,
        "source": str(lock.get("source") or "target_source_lock"),
        "type": str(lock.get("type") or "LOCKED_TARGET"),
        "confidence": to_float(lock.get("confidence"), 0.0),
        "score": to_float(lock.get("score"), lock.get("confidence", 0.0)),
        "distancePoints": round(abs(price - current_price), 4) if price > 0 and current_price > 0 else 0.0,
        "distanceAtr": round(abs(price - current_price) / max(atr, 0.000001), 4) if price > 0 and current_price > 0 else 0.0,
        "marketAgreement": lock.get("marketAgreement"),
        "reason": f"Locked target source from previous stronger target: {lock.get('source')}.",
        "sourceLockActive": True,
        "lockedAt": lock.get("updatedAt"),
        "liveConfidence": to_float(lock.get("lastLiveConfidence"), lock.get("confidence", 0.0)),
        "lockedConfidence": to_float(lock.get("confidence"), 0.0),
        "candidates": safe_list(lock.get("candidates"))[:10],
    }


def apply_target_source_lock(
    *,
    symbol: Any,
    timeframe: Any,
    current_price: float,
    atr: float,
    live_target: Dict[str, Any],
) -> Dict[str, Any]:
    """Keep the best valid target stable so weak fallback sources do not whipsaw Target ML %.

    Rules:
    - Real Target Price ML outranks ghost overlay target.
    - A weaker source must beat the locked source by TARGET_LOCK_SWITCH_BONUS to replace it.
    - A confidence drop inside TARGET_LOCK_DROP_TOLERANCE keeps the previous confidence/source.
    - Lock is short-lived and refreshed only with valid target prices.
    """
    if current_price <= 0:
        return live_target

    memory = load_memory()
    locks = safe_dict(memory.get("targetLocks"))
    key = lock_key(symbol, timeframe)
    existing_lock = get_target_lock(memory, symbol, timeframe)

    if not target_is_usable(live_target, current_price):
        if existing_lock:
            locked = candidate_from_lock(existing_lock, current_price, atr)
            locked["reason"] = "Live target was unavailable; using locked target source."
            return locked
        return live_target

    live_rank = target_rank(live_target.get("type"))
    live_confidence = to_float(live_target.get("confidence"), 0.0)

    if existing_lock:
        locked_rank = target_rank(existing_lock.get("type"))
        locked_confidence = to_float(existing_lock.get("confidence"), 0.0)
        locked_price = to_float(existing_lock.get("price"), 0.0)
        locked_is_valid = locked_price > 0 and abs(locked_price - current_price) / max(current_price, 0.000001) <= 0.35

        # Keep Real Target ML over ghost overlay unless ghost is clearly superior.
        should_keep_lock = False
        if locked_is_valid and locked_rank > live_rank:
            should_keep_lock = live_confidence < locked_confidence + TARGET_LOCK_SWITCH_BONUS
        elif locked_is_valid and locked_rank == live_rank:
            should_keep_lock = live_confidence < locked_confidence - TARGET_LOCK_DROP_TOLERANCE

        if should_keep_lock:
            locked = candidate_from_lock(existing_lock, current_price, atr)
            locked["liveTargetSource"] = live_target.get("source")
            locked["liveTargetType"] = live_target.get("type")
            locked["liveConfidence"] = live_confidence
            locked["reason"] = (
                f"Target source lock kept {existing_lock.get('source')} "
                f"over weaker live source {live_target.get('source')}."
            )
            locks[key] = {
                **existing_lock,
                "lastLiveSource": live_target.get("source"),
                "lastLiveType": live_target.get("type"),
                "lastLiveConfidence": live_confidence,
                "lastLivePrice": live_target.get("price"),
                "updatedAt": now_iso(),
            }
            memory["targetLocks"] = locks
            save_memory(memory)
            return locked

    locked_row = {
        "symbol": normalize_symbol(symbol),
        "timeframe": normalize_timeframe(timeframe),
        "price": live_target.get("price"),
        "direction": live_target.get("direction"),
        "source": live_target.get("source"),
        "type": live_target.get("type"),
        "confidence": live_confidence,
        "score": live_target.get("score"),
        "marketAgreement": live_target.get("marketAgreement"),
        "candidates": safe_list(live_target.get("candidates"))[:10],
        "lastLiveSource": live_target.get("source"),
        "lastLiveType": live_target.get("type"),
        "lastLiveConfidence": live_confidence,
        "lastLivePrice": live_target.get("price"),
        "updatedAt": now_iso(),
    }
    locks[key] = locked_row
    memory["targetLocks"] = locks
    save_memory(memory)

    return {
        **live_target,
        "sourceLockActive": False,
        "liveConfidence": live_confidence,
        "lockedConfidence": live_confidence,
        "lockedAt": locked_row["updatedAt"],
    }


# ─────────────────────────────────────────────────────────────────────────────
# MARKET STATE EXTRACTION
# ─────────────────────────────────────────────────────────────────────────────


def infer_direction_from_scores(bull: float, bear: float) -> str:
    if bull > bear + 5:
        return "BULLISH"
    if bear > bull + 5:
        return "BEARISH"
    if bull > 0 or bear > 0:
        return "MIXED"
    return "NEUTRAL"


def source_direction_and_score(
    name: str,
    source: Any,
    direction_paths: List[str],
    score_paths: List[str],
    fallback_direction: str = "NEUTRAL",
    fallback_score: float = 0.0,
) -> Dict[str, Any]:
    source = safe_dict(source)

    direction_value = None
    for path in direction_paths:
        direction_value = read_path(source, path)
        if direction_value is not None:
            break

    score_value = 0.0
    for path in score_paths:
        score_value = read_number(source, path, fallback=0.0)
        if score_value > 0:
            break

    direction = normalize_direction(direction_value or fallback_direction)
    score = clamp(score_value or fallback_score, 0.0, 100.0)
    status = "Active" if score >= 55 else ("Learning" if score > 0 else "Waiting")

    return {
        "name": name,
        "direction": direction,
        "score": round(score, 4),
        "status": status,
    }


def extract_external_table_bias(external_tables: Any) -> Dict[str, Any]:
    tables = safe_dict(external_tables)
    if not tables:
        return {
            "name": "External Tables",
            "direction": "NEUTRAL",
            "score": 0.0,
            "status": "Waiting",
        }

    bull = 0.0
    bear = 0.0
    samples = 0

    def scan(value: Any) -> None:
        nonlocal bull, bear, samples

        if isinstance(value, dict):
            direction = normalize_direction(
                value.get("direction")
                or value.get("bias")
                or value.get("side")
                or value.get("signal")
            )
            score = max(
                to_float(value.get("score"), 0.0),
                to_float(value.get("confidence"), 0.0),
                to_float(value.get("weight"), 0.0),
            )

            if direction == "BULLISH":
                bull += score or 50.0
                samples += 1
            elif direction == "BEARISH":
                bear += score or 50.0
                samples += 1

            for child in value.values():
                scan(child)

        elif isinstance(value, list):
            for child in value[:50]:
                scan(child)

    scan(tables)

    direction = infer_direction_from_scores(bull, bear)
    score = clamp(max(bull, bear) / max(1, samples), 0.0, 100.0) if samples else 0.0

    return {
        "name": "External Tables",
        "direction": direction,
        "score": round(score, 4),
        "status": "Active" if score >= 55 else ("Learning" if score > 0 else "Waiting"),
    }


def build_market_state(
    *,
    candles: Optional[List[Any]] = None,
    scorecards: Optional[Dict[str, Any]] = None,
    mlFeatures: Optional[Dict[str, Any]] = None,
    overlayPayload: Optional[Dict[str, Any]] = None,
    unifiedIntelligence: Optional[Dict[str, Any]] = None,
    externalTables: Optional[Dict[str, Any]] = None,
    signal: Optional[Dict[str, Any]] = None,
    **_: Any,
) -> Dict[str, Any]:
    candles = safe_list(candles)
    scorecards = safe_dict(scorecards)
    ml_features = safe_dict(mlFeatures)
    overlay = safe_dict(overlayPayload)
    unified = safe_dict(unifiedIntelligence)
    signal = safe_dict(signal)

    latest = latest_valid_candle(candles)
    current_price = latest_close(candles, read_number(signal, "current", "price", "close", fallback=0.0))
    atr = calculate_atr(candles)

    bull_score = max(
        read_number(scorecards, "bullScore", "overall.bullScore", "main.bullScore", fallback=0.0),
        read_number(signal, "bullScore", "bullishScore", fallback=0.0),
        read_number(unified, "bullScore", "scorecards.bullScore", fallback=0.0),
    )
    bear_score = max(
        read_number(scorecards, "bearScore", "overall.bearScore", "main.bearScore", fallback=0.0),
        read_number(signal, "bearScore", "bearishScore", fallback=0.0),
        read_number(unified, "bearScore", "scorecards.bearScore", fallback=0.0),
    )

    merged = {
        **scorecards,
        **ml_features,
        **unified,
        **overlay,
        **signal,
    }

    smc = source_direction_and_score(
        "SMC Structure",
        merged,
        [
            "smc.direction",
            "smcStructure.direction",
            "structure.direction",
            "marketStructure.direction",
            "direction",
        ],
        [
            "smc.score",
            "smcStructure.score",
            "structure.score",
            "marketStructure.score",
            "structureConfidence",
        ],
        fallback_direction=infer_direction_from_scores(bull_score, bear_score),
        fallback_score=max(bull_score, bear_score),
    )

    alpha = source_direction_and_score(
        "AlphaX / DLM",
        merged,
        ["alpha.direction", "alphaX.direction", "alphaDlm.direction", "dlm.direction", "profile.direction"],
        ["alpha.score", "alphaX.score", "alphaDlm.score", "dlm.score", "profile.score", "alphaScore", "alphaDlmScore"],
    )

    order_blocks = source_direction_and_score(
        "Order Blocks",
        merged,
        ["orderBlocks.direction", "orderBlock.direction", "ob.direction"],
        ["orderBlocks.score", "orderBlock.score", "ob.score", "orderBlockScore"],
    )

    liquidity = source_direction_and_score(
        "Liquidity / Sweeps",
        merged,
        ["liquidity.direction", "sweeps.direction", "liquiditySweeps.direction", "inducement.direction"],
        ["liquidity.score", "sweeps.score", "liquiditySweeps.score", "inducement.score", "liquidityScore", "sweepScore"],
    )

    fvg_pd = source_direction_and_score(
        "FVG / PD Zones",
        merged,
        ["fvg.direction", "pdZones.direction", "imbalance.direction", "premiumDiscount.direction"],
        ["fvg.score", "pdZones.score", "imbalance.score", "premiumDiscount.score", "fvgScore", "pdZoneScore"],
    )

    meters = source_direction_and_score(
        "Meters / Gauges",
        merged,
        ["meter.direction", "technicalMeter.direction", "gauge.direction", "sentiment.direction"],
        ["meter.score", "technicalMeter.score", "gauge.score", "sentiment.score", "confidence"],
        fallback_direction=infer_direction_from_scores(bull_score, bear_score),
        fallback_score=max(bull_score, bear_score),
    )

    external = extract_external_table_bias(externalTables)

    sources = [smc, alpha, order_blocks, liquidity, fvg_pd, meters, external]

    bull_weight = 0.0
    bear_weight = 0.0
    active_weight = 0.0

    weights = {
        "SMC Structure": 1.35,
        "AlphaX / DLM": 1.15,
        "Order Blocks": 1.15,
        "Liquidity / Sweeps": 1.30,
        "FVG / PD Zones": 1.05,
        "Meters / Gauges": 1.00,
        "External Tables": 0.90,
    }

    for source in sources:
        score = to_float(source.get("score"), 0.0)
        weight = weights.get(str(source.get("name")), 1.0)
        active_weight += weight if score > 0 else 0.0

        if source.get("direction") == "BULLISH":
            bull_weight += score * weight
        elif source.get("direction") == "BEARISH":
            bear_weight += score * weight
        elif source.get("direction") == "MIXED":
            bull_weight += score * weight * 0.5
            bear_weight += score * weight * 0.5

    direction = infer_direction_from_scores(bull_weight, bear_weight)
    confidence = clamp(abs(bull_weight - bear_weight) / max(1.0, bull_weight + bear_weight) * 100.0, 0.0, 100.0)
    if direction == "MIXED":
        confidence = min(confidence, 45.0)

    return {
        "currentPrice": current_price,
        "atr": atr,
        "latestCandle": latest,
        "direction": direction,
        "confidence": round(confidence, 4),
        "bullWeight": round(bull_weight, 4),
        "bearWeight": round(bear_weight, 4),
        "activeSourceWeight": round(active_weight, 4),
        "sources": sources,
        "sourceMap": {
            "smc": smc,
            "alphaDlm": alpha,
            "orderBlocks": order_blocks,
            "liquidity": liquidity,
            "fvgPdZones": fvg_pd,
            "metersGauges": meters,
            "externalTables": external,
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# TARGET + GHOST ROUTE ENGINE
# ─────────────────────────────────────────────────────────────────────────────


def add_candidate(
    candidates: List[Dict[str, Any]],
    *,
    price: Any,
    current_price: float,
    atr: float,
    source: str,
    candidate_type: str,
    confidence: Any = 0.0,
    direction: Any = None,
) -> None:
    parsed = to_float(price, 0.0)
    if parsed <= 0 or current_price <= 0:
        return

    distance = abs(parsed - current_price)
    if distance <= 0:
        return

    if distance / current_price > 0.35:
        return

    inferred_direction = normalize_direction(direction)
    if inferred_direction == "NEUTRAL":
        inferred_direction = "BULLISH" if parsed > current_price else "BEARISH"

    candidates.append(
        {
            "price": parsed,
            "source": source,
            "type": candidate_type,
            "direction": inferred_direction,
            "distancePoints": round(distance, 4),
            "distanceAtr": round(distance / max(atr, 0.000001), 4),
            "confidence": clamp(to_float(confidence, 0.0), 0.0, 100.0),
        }
    )


def collect_price_candidates_from_sources(
    *,
    current_price: float,
    atr: float,
    overlayPayload: Optional[Dict[str, Any]] = None,
    unifiedIntelligence: Optional[Dict[str, Any]] = None,
    signal: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    overlay = safe_dict(overlayPayload)
    unified = safe_dict(unifiedIntelligence)
    signal = safe_dict(signal)
    candidates: List[Dict[str, Any]] = []

    for source_name, source in [("signal", signal), ("overlay", overlay), ("unified", unified)]:
        add_candidate(
            candidates,
            price=read_path(
                source,
                "finalTargetPrice",
                "overallTargetPrice",
                "targetMl.finalTargetPrice",
                "targetMl.overallTargetPrice",
                "targetMl.targetPrice",
                "targetPlan.finalTargetPrice",
                "targetPlan.overallTargetPrice",
                "targetPlan.targetPrice",
            ),
            current_price=current_price,
            atr=atr,
            source=f"{source_name}:real_target_price_ml",
            candidate_type="REAL_TARGET_PRICE_ML",
            confidence=read_number(source, "targetConfidence", "targetMl.targetConfidence", "targetPlan.targetConfidence", fallback=0.0),
            direction=read_path(source, "targetDirection", "targetMl.direction", "targetPlan.direction"),
        )

    for source_name, source in [("overlay", overlay), ("unified", unified)]:
        for list_path in ["targets", "targetCandidates", "liquidityTargets", "levels"]:
            rows = safe_list(read_path(source, list_path, fallback=[]))
            for row in rows[:50]:
                row = safe_dict(row)
                add_candidate(
                    candidates,
                    price=row.get("finalTargetPrice") or row.get("targetPrice") or row.get("price") or row.get("level"),
                    current_price=current_price,
                    atr=atr,
                    source=f"{source_name}:{list_path}",
                    candidate_type=str(row.get("type") or "EXTERNAL_TARGET_TABLE").upper(),
                    confidence=row.get("targetConfidence") or row.get("confidence") or row.get("score"),
                    direction=row.get("direction") or row.get("side") or row.get("bias"),
                )

    ghost_lists = [
        read_path(signal, "ghostCandles", fallback=[]),
        read_path(signal, "ghosts", fallback=[]),
        read_path(signal, "projection", fallback=[]),
        read_path(overlay, "ghostCandles", fallback=[]),
        read_path(overlay, "ghosts", fallback=[]),
        read_path(overlay, "projection", fallback=[]),
        read_path(unified, "ghostCandles", fallback=[]),
        read_path(unified, "ghosts", fallback=[]),
        read_path(unified, "ghostProjection.candles", fallback=[]),
    ]

    for ghost_list in ghost_lists:
        ghosts = safe_list(ghost_list)
        if not ghosts:
            continue

        last_ghost = safe_dict(ghosts[-1])
        add_candidate(
            candidates,
            price=read_path(
                last_ghost,
                "finalTargetPrice",
                "overallTargetPrice",
                "targetMl.targetPrice",
                "targetPlan.targetPrice",
                "ghostTargetPrice",
                "projectedTargetPrice",
                "close",
                "c",
            ),
            current_price=current_price,
            atr=atr,
            source="chart_overlay_ghost_endpoint",
            candidate_type="GHOST_OVERLAY_TARGET",
            confidence=read_path(last_ghost, "targetConfidence", "targetMlConfidence", "confidence", "baseConfidence", fallback=0),
            direction=read_path(last_ghost, "direction", "side", "bias"),
        )

    return candidates


def choose_target_candidate(
    candidates: List[Dict[str, Any]],
    market_state: Dict[str, Any],
    memory_summary: Dict[str, Any],
) -> Dict[str, Any]:
    if not candidates:
        return {
            "available": False,
            "price": None,
            "direction": "NEUTRAL",
            "source": "target_unavailable",
            "type": "NONE",
            "confidence": 0.0,
            "reason": "No real Target Price ML or chart ghost overlay target is available.",
            "candidates": [],
        }

    market_direction = str(market_state.get("direction") or "NEUTRAL")
    market_confidence = to_float(market_state.get("confidence"), 0.0)
    target_hit_rate = to_float(memory_summary.get("targetHitRate"), 0.0)
    direction_accuracy = to_float(memory_summary.get("directionAccuracy"), 0.0)

    type_weights = {
        "REAL_TARGET_PRICE_ML": 26.0,
        "GHOST_OVERLAY_TARGET": 12.0,
        "LIQUIDITY": 16.0,
        "LIQUIDITY_TARGET": 16.0,
        "FVG": 14.0,
        "FVG_REBALANCE": 14.0,
        "ORDER_BLOCK": 13.0,
        "PD_ZONE": 12.0,
        "EXTERNAL_TARGET_TABLE": 10.0,
    }

    scored: List[Dict[str, Any]] = []

    for candidate in candidates:
        direction = str(candidate.get("direction") or "NEUTRAL")
        candidate_type = str(candidate.get("type") or "UNKNOWN").upper()
        confidence = to_float(candidate.get("confidence"), 0.0)
        distance_atr = to_float(candidate.get("distanceAtr"), 0.0)

        score = confidence * 0.45
        score += type_weights.get(candidate_type, 8.0)

        if direction == market_direction and market_direction in {"BULLISH", "BEARISH"}:
            score += 14.0 + market_confidence * 0.08
        elif direction in {"BULLISH", "BEARISH"} and market_direction in {"BULLISH", "BEARISH"} and direction != market_direction:
            score -= 7.0

        if 0.25 <= distance_atr <= 2.5:
            score += 8.0
        elif 2.5 < distance_atr <= 5.0:
            score += 4.0
        elif distance_atr > 6.0:
            score -= 8.0

        if target_hit_rate > 0:
            score += (target_hit_rate - 0.5) * 16.0
        if direction_accuracy > 0:
            score += (direction_accuracy - 0.5) * 10.0

        row = dict(candidate)
        row["score"] = round(clamp(score, 0.0, 100.0), 4)
        row["marketAgreement"] = direction == market_direction if market_direction in {"BULLISH", "BEARISH"} else False
        scored.append(row)

    scored.sort(key=lambda row: to_float(row.get("score"), 0.0), reverse=True)
    best = scored[0]

    target_type = str(best.get("type") or "UNKNOWN")
    target_confidence = clamp(
        to_float(best.get("score"), 0.0) * 0.60 + to_float(best.get("confidence"), 0.0) * 0.40,
        0.0,
        100.0,
    )

    if target_type == "GHOST_OVERLAY_TARGET":
        reason = "Real Target Price ML unavailable; using the chart-overlaid ghost endpoint as the route destination."
    else:
        reason = f"Selected {target_type} from {best.get('source')} using market context and projection memory."

    return {
        "available": True,
        "price": to_float(best.get("price"), 0.0),
        "direction": str(best.get("direction") or "NEUTRAL"),
        "source": str(best.get("source") or "unknown"),
        "type": target_type,
        "confidence": round(target_confidence, 4),
        "score": best.get("score"),
        "distancePoints": best.get("distancePoints"),
        "distanceAtr": best.get("distanceAtr"),
        "marketAgreement": best.get("marketAgreement"),
        "reason": reason,
        "candidates": scored[:10],
    }


def determine_projection_mode(market_state: Dict[str, Any], target: Dict[str, Any]) -> Dict[str, Any]:
    market_direction = str(market_state.get("direction") or "NEUTRAL")
    target_direction = str(target.get("direction") or "NEUTRAL")

    if not target.get("available"):
        return {
            "mode": "NO_TARGET",
            "alignmentScore": 0.0,
            "conflict": False,
            "label": "No target",
            "reason": "No target destination exists yet.",
        }

    if market_direction in {"BULLISH", "BEARISH"} and target_direction == market_direction:
        return {
            "mode": "TARGET_GUIDED_CONTINUATION",
            "alignmentScore": 84.0,
            "conflict": False,
            "label": "Target-guided continuation",
            "reason": "Market context and target direction agree.",
        }

    if market_direction in {"BULLISH", "BEARISH"} and target_direction == opposite_direction(market_direction):
        target_type = str(target.get("type") or "")
        if target_type in {"GHOST_OVERLAY_TARGET", "FVG", "FVG_REBALANCE", "LIQUIDITY_TARGET", "LIQUIDITY"}:
            return {
                "mode": "TARGET_GUIDED_RETRACEMENT",
                "alignmentScore": 48.0,
                "conflict": True,
                "label": "Target-guided retracement",
                "reason": "Target pulls against current structure; watch for retracement or rejection.",
            }

        return {
            "mode": "TARGET_CONFLICT",
            "alignmentScore": 30.0,
            "conflict": True,
            "label": "Target conflict",
            "reason": "Target direction conflicts with market structure.",
        }

    return {
        "mode": "TARGET_GUIDED_MIXED",
        "alignmentScore": 55.0,
        "conflict": market_direction == "MIXED",
        "label": "Mixed target guidance",
        "reason": "Target exists but market context is neutral or mixed.",
    }


def build_target_guided_ghost_path(
    *,
    candles: List[Any],
    current_price: float,
    atr: float,
    target: Dict[str, Any],
    market_state: Dict[str, Any],
    mode: Dict[str, Any],
    ghost_count: int = DEFAULT_GHOST_CANDLES,
) -> Dict[str, Any]:
    ghost_count = max(1, min(10, to_int(ghost_count, DEFAULT_GHOST_CANDLES)))

    if current_price <= 0:
        return {
            "available": False,
            "direction": "NEUTRAL",
            "confidence": 0.0,
            "candles": [],
            "reason": "No current price for ghost path.",
        }

    if not target.get("available") or not target.get("price"):
        return {
            "available": False,
            "direction": "NEUTRAL",
            "confidence": 0.0,
            "candles": [],
            "reason": "No target destination for ghost path.",
        }

    target_price = to_float(target.get("price"), 0.0)
    projection_mode = str(mode.get("mode") or "NO_TARGET")
    target_confidence = to_float(target.get("confidence"), 0.0)
    market_confidence = to_float(market_state.get("confidence"), 0.0)

    total_move = target_price - current_price
    if abs(total_move) <= 0:
        return {
            "available": False,
            "direction": "NEUTRAL",
            "confidence": 0.0,
            "candles": [],
            "reason": "Target equals current price.",
        }

    if projection_mode == "TARGET_GUIDED_CONTINUATION":
        route_strength = 0.92
        wick_mult = 0.35
    elif projection_mode == "TARGET_GUIDED_RETRACEMENT":
        route_strength = 0.72
        wick_mult = 0.55
    elif projection_mode == "TARGET_CONFLICT":
        route_strength = 0.55
        wick_mult = 0.75
    else:
        route_strength = 0.65
        wick_mult = 0.55

    confidence = clamp(
        target_confidence * 0.55
        + market_confidence * 0.25
        + to_float(mode.get("alignmentScore"), 0.0) * 0.20,
        0.0,
        100.0,
    )

    candles_out: List[Dict[str, Any]] = []
    previous_close = current_price

    for index in range(1, ghost_count + 1):
        t1 = index / ghost_count
        eased1 = t1 * t1 * (3 - 2 * t1)

        desired_close = current_price + total_move * eased1 * route_strength

        if index == ghost_count and confidence >= 45:
            desired_close = current_price + total_move * min(1.0, route_strength + 0.12)

        if total_move > 0:
            desired_close = min(desired_close, target_price + atr * 0.15)
        else:
            desired_close = max(desired_close, target_price - atr * 0.15)

        open_ = previous_close
        close = desired_close
        body = abs(close - open_)
        min_wick = max(atr * 0.08, body * 0.25, 0.01)
        wick = max(min_wick, atr * wick_mult * (0.35 + 0.15 * index))

        if close >= open_:
            high = max(open_, close) + wick * 0.70
            low = min(open_, close) - wick * 0.35
            direction = "BULLISH"
        else:
            high = max(open_, close) + wick * 0.35
            low = min(open_, close) - wick * 0.70
            direction = "BEARISH"

        rejection_warning = False
        if index == ghost_count and projection_mode in {"TARGET_GUIDED_RETRACEMENT", "TARGET_CONFLICT"}:
            rejection_warning = True
            if close >= open_:
                high += atr * 0.20
            else:
                low -= atr * 0.20

        row = {
            "index": index,
            "label": f"Projected #{index}",
            "open": round(open_, 8),
            "high": round(max(high, open_, close), 8),
            "low": round(min(low, open_, close), 8),
            "close": round(close, 8),
            "direction": direction,
            "confidence": round(confidence, 4),
            "targetGuided": True,
            "targetPrice": round(target_price, 8),
            "finalTargetPrice": round(target_price, 8),
            "overallTargetPrice": round(target_price, 8),
            "ghostTargetPrice": round(close, 8),
            "projectedTargetPrice": round(close, 8),
            "targetSource": target.get("source"),
            "targetType": target.get("type"),
            "targetConfidence": target.get("confidence"),
            "projectionMode": projection_mode,
            "rejectionWarning": rejection_warning,
            "reason": f"Target-guided ghost route toward {round(target_price, 2)}.",
        }
        candles_out.append(row)
        previous_close = close

    ghost_direction = "BULLISH" if total_move > 0 else "BEARISH"
    ghost_end = to_float(candles_out[-1]["close"], current_price) if candles_out else current_price
    end_error = abs(target_price - ghost_end)

    return {
        "available": True,
        "direction": ghost_direction,
        "confidence": round(confidence, 4),
        "candles": candles_out,
        "endPrice": round(ghost_end, 8),
        "targetPrice": round(target_price, 8),
        "targetDistancePoints": round(abs(target_price - current_price), 4),
        "endErrorPoints": round(end_error, 4),
        "reason": f"Ghost path is being plotted toward the self-learning target using {projection_mode}.",
    }


def calculate_alignment(target: Dict[str, Any], ghost_path: Dict[str, Any], market_state: Dict[str, Any], mode: Dict[str, Any]) -> Dict[str, Any]:
    if not target.get("available") or not ghost_path.get("available"):
        return {
            "score": 0.0,
            "label": "Waiting",
            "conflict": False,
            "targetAndGhostAgree": False,
            "reason": "Target or ghost path is unavailable.",
        }

    target_price = to_float(target.get("price"), 0.0)
    ghost_end = to_float(ghost_path.get("endPrice"), 0.0)
    atr = to_float(market_state.get("atr"), 0.25)
    target_direction = str(target.get("direction") or "NEUTRAL")
    ghost_direction = str(ghost_path.get("direction") or "NEUTRAL")
    mode_score = to_float(mode.get("alignmentScore"), 0.0)

    distance_error = abs(target_price - ghost_end)
    distance_score = clamp(100.0 - (distance_error / max(atr, 0.000001)) * 30.0, 0.0, 100.0)
    direction_score = 100.0 if target_direction == ghost_direction else 25.0
    score = clamp(distance_score * 0.55 + direction_score * 0.25 + mode_score * 0.20, 0.0, 100.0)

    if score >= 75:
        label = "Strong"
    elif score >= 55:
        label = "Aligned"
    elif score >= 35:
        label = "Partial"
    else:
        label = "Conflict"

    conflict = bool(mode.get("conflict")) or target_direction != ghost_direction

    return {
        "score": round(score, 4),
        "label": label,
        "conflict": conflict,
        "targetAndGhostAgree": not conflict and score >= 55,
        "targetDirection": target_direction,
        "ghostDirection": ghost_direction,
        "distanceErrorPoints": round(distance_error, 4),
        "distanceErrorAtr": round(distance_error / max(atr, 0.000001), 4),
        "reason": f"Target/ghost alignment is {label}; ghost endpoint is {round(distance_error, 2)} points from target.",
    }


# ─────────────────────────────────────────────────────────────────────────────
# CORRECTION / LEARNING
# ─────────────────────────────────────────────────────────────────────────────


def register_projection_open(engine: Dict[str, Any]) -> None:
    try:
        memory = load_memory()
        projection_id = engine.get("projectionId")
        if not projection_id:
            return

        open_rows = safe_list(memory.get("openProjections"))
        if any(row.get("projectionId") == projection_id for row in open_rows if isinstance(row, dict)):
            return

        target = safe_dict(engine.get("target"))
        ghost_path = safe_dict(engine.get("ghostPath"))
        alignment = safe_dict(engine.get("alignment"))

        open_rows.append(
            {
                "projectionId": projection_id,
                "symbol": engine.get("symbol"),
                "timeframe": engine.get("timeframe"),
                "createdAt": engine.get("createdAt"),
                "entryPrice": read_path(engine, "marketState.currentPrice"),
                "targetPrice": target.get("price"),
                "targetDirection": target.get("direction"),
                "targetSource": target.get("source"),
                "targetType": target.get("type"),
                "targetConfidence": target.get("confidence"),
                "ghostEndPrice": ghost_path.get("endPrice"),
                "ghostDirection": ghost_path.get("direction"),
                "alignmentScore": alignment.get("score"),
                "projectionMode": read_path(engine, "mode.mode"),
                "status": "OPEN",
            }
        )

        memory["openProjections"] = open_rows[-MAX_MEMORY_ROWS:]
        save_memory(memory)
    except Exception:
        return


def evaluate_open_projections(
    *,
    symbol: Any = "MES1!",
    timeframe: Any = "1m",
    candles: Optional[List[Any]] = None,
    currentPrice: Any = None,
    **_: Any,
) -> Dict[str, Any]:
    memory = load_memory()
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    rows = safe_list(memory.get("openProjections"))
    candles = safe_list(candles)

    current_price = to_float(currentPrice, 0.0) or latest_close(candles, 0.0)
    if current_price <= 0:
        return {
            "eventType": "PROJECTION_ENGINE_EVALUATE",
            "status": "Skipped",
            "reason": "No current price available.",
            "closedCount": 0,
            "openCount": len(rows),
            "createdAt": now_iso(),
        }

    latest = latest_valid_candle(candles)
    _open, high, low, close = candle_ohlc(latest)
    high = high or current_price
    low = low or current_price
    close = close or current_price

    still_open: List[Dict[str, Any]] = []
    closed: List[Dict[str, Any]] = []
    corrections: List[Dict[str, Any]] = []

    for row in rows:
        if not isinstance(row, dict):
            continue

        if normalize_symbol(row.get("symbol")) != normalized_symbol or normalize_timeframe(row.get("timeframe")) != normalized_timeframe:
            still_open.append(row)
            continue

        target_price = to_float(row.get("targetPrice"), 0.0)
        entry_price = to_float(row.get("entryPrice"), 0.0)
        target_direction = str(row.get("targetDirection") or "NEUTRAL")
        ghost_end = to_float(row.get("ghostEndPrice"), 0.0)
        ghost_direction = str(row.get("ghostDirection") or "NEUTRAL")

        if target_price <= 0 or entry_price <= 0:
            row["status"] = "CLOSED_NO_TARGET"
            closed.append(row)
            continue

        target_hit = False
        if target_direction == "BULLISH":
            target_hit = high >= target_price
        elif target_direction == "BEARISH":
            target_hit = low <= target_price

        actual_direction = "BULLISH" if close > entry_price else ("BEARISH" if close < entry_price else "NEUTRAL")
        direction_correct = actual_direction == target_direction
        ghost_direction_correct = actual_direction == ghost_direction
        target_error = abs(target_price - close)
        path_error = abs(ghost_end - close) if ghost_end > 0 else target_error
        correction_points = target_price - close

        row.update(
            {
                "status": "CLOSED",
                "closedAt": now_iso(),
                "actualClose": close,
                "actualHigh": high,
                "actualLow": low,
                "actualDirection": actual_direction,
                "targetHit": target_hit,
                "directionCorrect": direction_correct,
                "ghostDirectionCorrect": ghost_direction_correct,
                "targetErrorPoints": round(target_error, 4),
                "pathErrorPoints": round(path_error, 4),
                "correctionPoints": round(correction_points, 4),
            }
        )
        closed.append(row)

        corrections.append(
            {
                "projectionId": row.get("projectionId"),
                "symbol": normalized_symbol,
                "timeframe": normalized_timeframe,
                "createdAt": now_iso(),
                "targetHit": target_hit,
                "directionCorrect": direction_correct,
                "ghostDirectionCorrect": ghost_direction_correct,
                "targetErrorPoints": round(target_error, 4),
                "pathErrorPoints": round(path_error, 4),
                "correctionPoints": round(correction_points, 4),
                "targetSource": row.get("targetSource"),
                "targetType": row.get("targetType"),
                "projectionMode": row.get("projectionMode"),
            }
        )

    memory["openProjections"] = still_open[-MAX_MEMORY_ROWS:]
    memory["closedProjections"] = (safe_list(memory.get("closedProjections")) + closed)[-MAX_MEMORY_ROWS:]
    memory["corrections"] = (safe_list(memory.get("corrections")) + corrections)[-MAX_MEMORY_ROWS:]
    save_memory(memory)

    return {
        "eventType": "PROJECTION_ENGINE_EVALUATE",
        "status": "Evaluated",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "closedCount": len(closed),
        "openCount": len(still_open),
        "closedProjections": closed[-20:],
        "corrections": corrections[-20:],
        "summary": summarize_projection_memory(symbol=normalized_symbol, timeframe=normalized_timeframe),
        "createdAt": now_iso(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# MAIN ENGINE
# ─────────────────────────────────────────────────────────────────────────────


def build_unified_projection_engine(
    *,
    symbol: Any = "MES1!",
    timeframe: Any = "1m",
    candles: Optional[List[Any]] = None,
    scorecards: Optional[Dict[str, Any]] = None,
    mlFeatures: Optional[Dict[str, Any]] = None,
    overlayPayload: Optional[Dict[str, Any]] = None,
    unifiedIntelligence: Optional[Dict[str, Any]] = None,
    externalTables: Optional[Dict[str, Any]] = None,
    signal: Optional[Dict[str, Any]] = None,
    ghostCount: Any = DEFAULT_GHOST_CANDLES,
    autoRegister: bool = True,
    **kwargs: Any,
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    candles = safe_list(candles)

    memory_summary = summarize_projection_memory(symbol=normalized_symbol, timeframe=normalized_timeframe)

    market_state = build_market_state(
        candles=candles,
        scorecards=scorecards,
        mlFeatures=mlFeatures,
        overlayPayload=overlayPayload,
        unifiedIntelligence=unifiedIntelligence,
        externalTables=externalTables,
        signal=signal,
    )

    current_price = to_float(market_state.get("currentPrice"), 0.0)
    atr = to_float(market_state.get("atr"), 0.25)

    candidates = collect_price_candidates_from_sources(
        current_price=current_price,
        atr=atr,
        overlayPayload=overlayPayload,
        unifiedIntelligence=unifiedIntelligence,
        signal=signal,
    )

    live_target = choose_target_candidate(candidates, market_state, memory_summary)
    target = apply_target_source_lock(
        symbol=normalized_symbol,
        timeframe=normalized_timeframe,
        current_price=current_price,
        atr=atr,
        live_target=live_target,
    )
    mode = determine_projection_mode(market_state, target)

    ghost_path = build_target_guided_ghost_path(
        candles=candles,
        current_price=current_price,
        atr=atr,
        target=target,
        market_state=market_state,
        mode=mode,
        ghost_count=ghostCount,
    )

    alignment = calculate_alignment(target, ghost_path, market_state, mode)

    projection_id = unique_key(
        normalized_symbol,
        normalized_timeframe,
        candle_time(latest_valid_candle(candles)) or now_iso(),
    )

    ai_permission = "WAIT"
    if target.get("available") and ghost_path.get("available"):
        if alignment.get("targetAndGhostAgree") and to_float(alignment.get("score"), 0.0) >= 65:
            ai_permission = "CAN_CONSIDER"
        elif alignment.get("conflict"):
            ai_permission = "HOLD_CONFLICT"
        else:
            ai_permission = "WAIT_LEARNING"

    target_is_real_ml = target.get("type") != "GHOST_OVERLAY_TARGET"

    engine = {
        "eventType": "UNIFIED_PROJECTION_ENGINE",
        "status": "Ready",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "projectionId": projection_id,
        "createdAt": now_iso(),

        "marketState": market_state,
        "target": target,
        "ghostPath": ghost_path,
        "alignment": alignment,
        "mode": mode,
        "learning": memory_summary,

        "currentPrice": current_price,
        "activeTargetPrice": target.get("price"),
        "activeTargetSource": target.get("source"),
        "activeTargetType": target.get("type"),
        "activeTargetConfidence": target.get("confidence"),
        "targetSourceLockActive": bool(target.get("sourceLockActive")),
        "targetLockedConfidence": target.get("lockedConfidence", target.get("confidence")),
        "targetLiveConfidence": target.get("liveConfidence", target.get("confidence")),
        "targetLiveSource": target.get("liveTargetSource", target.get("source")),
        "targetLiveType": target.get("liveTargetType", target.get("type")),
        "targetLockedAt": target.get("lockedAt"),
        "targetPrice": target.get("price"),
        "finalTargetPrice": target.get("price") if target_is_real_ml else None,
        "ghostOverlayTargetPrice": target.get("price") if not target_is_real_ml else None,
        "targetConfidence": target.get("confidence") if target_is_real_ml else 0,
        "ghostConfidence": ghost_path.get("confidence"),
        "projectionMode": mode.get("mode"),
        "projectionModeLabel": mode.get("label"),
        "aiPermission": ai_permission,

        "ghostCandles": ghost_path.get("candles", []),
        "ghosts": ghost_path.get("candles", []),

        "targetMl": {
            "targetPrice": target.get("price") if target_is_real_ml else None,
            "finalTargetPrice": target.get("price") if target_is_real_ml else None,
            "overallTargetPrice": target.get("price") if target_is_real_ml else None,
            "targetConfidence": target.get("confidence") if target_is_real_ml else 0,
            "confidence": target.get("confidence") if target_is_real_ml else 0,
            "targetMlReady": bool(target.get("available") and target_is_real_ml),
            "source": target.get("source"),
            "type": target.get("type"),
        },
        "targetPlan": {
            "targetPrice": target.get("price"),
            "finalTargetPrice": target.get("price"),
            "overallTargetPrice": target.get("price"),
            "targetConfidence": target.get("confidence"),
            "confidence": target.get("confidence"),
            "source": target.get("source"),
            "type": target.get("type"),
            "projectionMode": mode.get("mode"),
        },
    }

    if autoRegister and target.get("available") and ghost_path.get("available"):
        register_projection_open(engine)

    return engine


def projection_engine_status(symbol: Any = "", timeframe: Any = "") -> Dict[str, Any]:
    return summarize_projection_memory(symbol=symbol, timeframe=timeframe)


def projection_engine_export() -> Dict[str, Any]:
    memory = load_memory()
    return {
        "eventType": "PROJECTION_ENGINE_EXPORT",
        "status": "Ready",
        "memory": memory,
        "summary": summarize_projection_memory(),
        "createdAt": now_iso(),
    }


def reset_projection_engine_memory(symbol: Optional[Any] = None, timeframe: Optional[Any] = None) -> Dict[str, Any]:
    if not symbol and not timeframe:
        memory = {
            "version": 1,
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
            "openProjections": [],
            "closedProjections": [],
            "corrections": [],
            "sourceStats": {},
            "targetLocks": {},
        }
        save_memory(memory)
        return {
            "eventType": "PROJECTION_ENGINE_RESET",
            "status": "Reset",
            "createdAt": now_iso(),
        }

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

    memory["openProjections"] = [row for row in safe_list(memory.get("openProjections")) if keep(row)]
    memory["closedProjections"] = [row for row in safe_list(memory.get("closedProjections")) if keep(row)]
    memory["corrections"] = [row for row in safe_list(memory.get("corrections")) if keep(row)]
    save_memory(memory)

    return {
        "eventType": "PROJECTION_ENGINE_RESET",
        "status": "PartialReset",
        "symbol": normalized_symbol or "ALL",
        "timeframe": normalized_timeframe or "ALL",
        "createdAt": now_iso(),
    }
