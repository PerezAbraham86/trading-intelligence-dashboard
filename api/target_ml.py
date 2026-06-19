from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock, get_ident
from typing import Any, Dict, List, Optional, Tuple


# ─────────────────────────────────────────────────────────────────────────────
# MARKETBOS TARGET ML
# ─────────────────────────────────────────────────────────────────────────────
# Purpose:
# - Build ML target price candidates from SMC + AlphaX/DLM + OB + FVG + PD zones
#   + liquidity + ghost highs/lows.
# - Record every target projection.
# - Evaluate whether the target was hit.
# - Learn which target source works best in each context.
# - Return learned target confidence that can boost ghost candle confidence.
#
# Important hierarchy:
# - Uses: SMC, AlphaX/DLM liquidity, OrderBlocks, PD zones, FVG, sweeps,
#         liquidity profile, ghost high/low projections, and target history.
# - Does NOT use NRTR.
# - Does NOT use SMMA.
# - Does NOT use editable chart settings.
# ─────────────────────────────────────────────────────────────────────────────


TARGET_ML_MEMORY: List[Dict[str, Any]] = []
TARGET_ML_STATE: Dict[str, Any] = {}
TARGET_ML_MEMORY_LOCK = RLock()
TARGET_ML_MAX_RECORDS = int(os.getenv("TARGET_ML_MAX_RECORDS", "5000"))
TARGET_ML_MIN_EVALUATED_FOR_ADJUSTMENT = int(os.getenv("TARGET_ML_MIN_EVALUATED_FOR_ADJUSTMENT", "12"))


def resolve_target_ml_store_file() -> Path:
    explicit_path = os.getenv("TARGET_ML_STORE_FILE")
    if explicit_path:
        return Path(explicit_path)
    render_disk_path = os.getenv("RENDER_DISK_PATH")
    if render_disk_path:
        return Path(render_disk_path) / "target_ml_memory.json"
    return Path(__file__).with_name("target_ml_memory.json")


TARGET_ML_STORE_FILE = resolve_target_ml_store_file()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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
    if raw in {"MES", "MES1", "MES1!", "/MES", "MES=F"} or "MES" in raw:
        return "MES1!"
    if raw in {"ES", "ES1", "ES1!", "/ES", "ES=F"} or ("ES" in raw and "MES" not in raw):
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


def candle_time(candle: Dict[str, Any]) -> str:
    return str(candle.get("time") or candle.get("timestamp") or candle.get("createdAt") or "")


def direction_from_text(value: Any, fallback: str = "neutral") -> str:
    text = str(value or "").strip().lower()
    if any(word in text for word in ["bull", "buy", "long", "up", "demand", "discount", "sell-side", "sell side"]):
        return "bullish"
    if any(word in text for word in ["bear", "sell", "short", "down", "supply", "premium", "buy-side", "buy side"]):
        return "bearish"
    return fallback


def signal_to_direction(signal: Any) -> str:
    text = str(signal or "").strip().lower()
    if text in {"buy", "long", "bull", "bullish"}:
        return "bullish"
    if text in {"sell", "short", "bear", "bearish"}:
        return "bearish"
    return direction_from_text(text, "neutral")


def list_value(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def dict_value(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def price_is_valid(price: Any) -> bool:
    parsed = to_float(price, 0.0)
    return math.isfinite(parsed) and parsed > 0


def round_price(symbol: str, price: float) -> float:
    normalized = normalize_symbol(symbol)
    if normalized in {"MES1!", "ES1!"}:
        tick = 0.25
    elif normalized == "BTCUSD":
        tick = 0.5
    elif normalized == "ETHUSD":
        tick = 0.05
    else:
        tick = 0.01
    return round(round(price / tick) * tick, 5) if tick > 0 else round(price, 5)


def average_true_range(candles: List[Dict[str, Any]], length: int = 14) -> float:
    if len(candles) < 2:
        return 0.0
    ranges: List[float] = []
    start = max(1, len(candles) - max(1, int(length or 14)))
    for index in range(start, len(candles)):
        current = candles[index]
        previous = candles[index - 1]
        high = to_float(current.get("high"))
        low = to_float(current.get("low"))
        previous_close = to_float(previous.get("close"))
        ranges.append(max(high - low, abs(high - previous_close), abs(low - previous_close)))
    return sum(ranges) / max(len(ranges), 1)


def target_record_key(symbol: str, timeframe: str, projection_time: str, direction: str, source: str) -> str:
    return f"{normalize_symbol(symbol)}::{normalize_timeframe(timeframe)}::{projection_time}::{direction}::{source}"


# ─────────────────────────────────────────────────────────────────────────────
# PERSISTENCE
# ─────────────────────────────────────────────────────────────────────────────


def load_target_ml_memory() -> Dict[str, Any]:
    global TARGET_ML_MEMORY, TARGET_ML_STATE
    with TARGET_ML_MEMORY_LOCK:
        try:
            if not TARGET_ML_STORE_FILE.exists():
                TARGET_ML_MEMORY = []
                TARGET_ML_STATE = {}
                print(f"[Target ML] memory load path={TARGET_ML_STORE_FILE} records=0")
                return {"status": "empty", "loaded": 0, "path": str(TARGET_ML_STORE_FILE)}
            with TARGET_ML_STORE_FILE.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            records = payload.get("records") if isinstance(payload, dict) else payload
            if not isinstance(records, list):
                records = []
            cleaned = [record for record in records if isinstance(record, dict)]
            TARGET_ML_MEMORY = cleaned[-TARGET_ML_MAX_RECORDS:]
            TARGET_ML_STATE = payload.get("state", {}) if isinstance(payload, dict) and isinstance(payload.get("state"), dict) else {}
            print(f"[Target ML] memory load path={TARGET_ML_STORE_FILE} records={len(TARGET_ML_MEMORY)}")
            return {"status": "loaded", "loaded": len(TARGET_ML_MEMORY), "path": str(TARGET_ML_STORE_FILE)}
        except Exception as error:
            print(f"[Target ML] memory load failed: path={TARGET_ML_STORE_FILE} error={error}")
            TARGET_ML_MEMORY = []
            TARGET_ML_STATE = {}
            return {"status": "error", "loaded": 0, "path": str(TARGET_ML_STORE_FILE), "error": str(error)}


def save_target_ml_memory() -> Dict[str, Any]:
    temp_path: Optional[Path] = None
    with TARGET_ML_MEMORY_LOCK:
        try:
            TARGET_ML_STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "version": "target-ml-v1-smc-alpha-dlm-ob-ghost",
                "createdAt": now_iso(),
                "maxRecords": TARGET_ML_MAX_RECORDS,
                "state": TARGET_ML_STATE,
                "records": TARGET_ML_MEMORY[-TARGET_ML_MAX_RECORDS:],
            }
            temp_path = TARGET_ML_STORE_FILE.with_name(f"{TARGET_ML_STORE_FILE.name}.{get_ident()}.tmp")
            with temp_path.open("w", encoding="utf-8") as handle:
                json.dump(payload, handle, separators=(",", ":"), ensure_ascii=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, TARGET_ML_STORE_FILE)
            return {"status": "saved", "saved": len(TARGET_ML_MEMORY), "path": str(TARGET_ML_STORE_FILE)}
        except Exception as error:
            if temp_path is not None:
                try:
                    temp_path.unlink()
                except FileNotFoundError:
                    pass
                except Exception:
                    pass
            print(f"[Target ML] memory save failed: source={temp_path} destination={TARGET_ML_STORE_FILE} error={error}")
            return {"status": "error", "saved": 0, "path": str(TARGET_ML_STORE_FILE), "error": str(error)}


def trim_target_ml_memory() -> None:
    global TARGET_ML_MEMORY
    with TARGET_ML_MEMORY_LOCK:
        if len(TARGET_ML_MEMORY) > TARGET_ML_MAX_RECORDS:
            TARGET_ML_MEMORY = TARGET_ML_MEMORY[-TARGET_ML_MAX_RECORDS:]


load_target_ml_memory()


# ─────────────────────────────────────────────────────────────────────────────
# TARGET CANDIDATES
# ─────────────────────────────────────────────────────────────────────────────


def extract_price_candidates_from_item(item: Dict[str, Any]) -> List[float]:
    if not isinstance(item, dict):
        return []
    prices: List[float] = []
    for key in [
        "target", "targetPrice", "takeProfit", "takeProfitPrice", "tp", "tp1",
        "price", "level", "mid", "pocPrice", "top", "bottom", "high", "low",
    ]:
        if key in item and price_is_valid(item.get(key)):
            prices.append(to_float(item.get(key)))
    for nested_key in ["zone", "level", "target", "range"]:
        nested = item.get(nested_key)
        if isinstance(nested, dict):
            prices.extend(extract_price_candidates_from_item(nested))
    return list(dict.fromkeys(round(value, 8) for value in prices if price_is_valid(value)))


def source_from_item(item: Dict[str, Any], fallback: str) -> str:
    text = str(item.get("source") or item.get("kind") or item.get("type") or item.get("label") or item.get("name") or fallback).strip().lower()
    if "order" in text or "ob" in text or "supply" in text or "demand" in text:
        return "order_block"
    if "fvg" in text or "fair value" in text or "imbalance" in text:
        return "fvg"
    if "premium" in text or "discount" in text or "pd" in text:
        return "pd_zone"
    if "dlm" in text or "alphax" in text or "poc" in text or "profile" in text:
        return "alphax_dlm"
    if "sweep" in text or "liquid" in text:
        return "liquidity_sweep"
    if "ghost" in text:
        return "ghost_projection"
    if "smc" in text or "bos" in text or "choch" in text:
        return "smc_structure"
    return fallback


def push_candidate(
    candidates: List[Dict[str, Any]],
    *,
    symbol: str,
    entry: float,
    price: float,
    direction: str,
    source: str,
    quality: float,
    item: Optional[Dict[str, Any]] = None,
) -> None:
    if not price_is_valid(price) or not price_is_valid(entry):
        return
    rounded_price = round_price(symbol, price)
    if direction == "bullish" and rounded_price <= entry:
        return
    if direction == "bearish" and rounded_price >= entry:
        return
    distance = abs(rounded_price - entry)
    distance_pct = distance / max(abs(entry), 0.000001) * 100.0
    if distance_pct <= 0.001:
        return
    candidates.append({
        "price": rounded_price,
        "direction": direction,
        "source": source,
        "quality": round(clamp(quality, 0, 100), 2),
        "distance": round(distance, 5),
        "distancePct": round(distance_pct, 5),
        "raw": {
            "label": item.get("label") if isinstance(item, dict) else None,
            "kind": item.get("kind") if isinstance(item, dict) else None,
            "type": item.get("type") if isinstance(item, dict) else None,
        },
    })


def scan_structure_targets(candles: List[Dict[str, Any]], *, symbol: str, direction: str, entry: float, atr: float, lookback: int = 160) -> List[Dict[str, Any]]:
    sample = candles[-lookback:] if len(candles) > lookback else candles[:]
    candidates: List[Dict[str, Any]] = []
    if len(sample) < 10 or not price_is_valid(entry):
        return candidates
    highs = [to_float(item.get("high")) for item in sample]
    lows = [to_float(item.get("low")) for item in sample]
    if direction == "bullish":
        levels = sorted({round_price(symbol, high) for high in highs if high > entry})
    elif direction == "bearish":
        levels = sorted({round_price(symbol, low) for low in lows if low < entry}, reverse=True)
    else:
        return candidates
    min_distance = max(atr * 0.35, abs(entry) * 0.0003)
    max_distance = max(atr * 8.0, abs(entry) * 0.02)
    for index, level in enumerate(levels[:20]):
        distance = abs(level - entry)
        if distance < min_distance or distance > max_distance:
            continue
        push_candidate(
            candidates,
            symbol=symbol,
            entry=entry,
            price=level,
            direction=direction,
            source="structure_swing",
            quality=58 - min(index, 10) * 1.5,
            item={"label": "Structure Swing"},
        )
    return candidates


def build_target_candidates(symbol: str, timeframe: str, candles: List[Dict[str, Any]], overlays: Dict[str, Any], ghosts: Optional[List[Dict[str, Any]]] = None, signal: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    ghosts = ghosts or []
    signal = signal or {}
    if not candles:
        return []
    latest = candles[-1]
    entry = to_float(signal.get("entry") or signal.get("price") or signal.get("current") or latest.get("close"), 0)
    if entry <= 0:
        return []
    direction = signal_to_direction(signal.get("signal") or signal.get("type") or signal.get("direction") or (ghosts[0].get("direction") if ghosts and isinstance(ghosts[0], dict) else "neutral"))
    if direction == "neutral":
        if ghosts and isinstance(ghosts[0], dict):
            direction = direction_from_text(ghosts[0].get("direction"), "neutral")
        if direction == "neutral" and len(candles) >= 2:
            direction = "bullish" if to_float(candles[-1].get("close")) >= to_float(candles[-2].get("close")) else "bearish"
    atr = average_true_range(candles, 14)
    if atr <= 0:
        atr = max(to_float(latest.get("high")) - to_float(latest.get("low")), entry * 0.001, 0.01)
    candidates: List[Dict[str, Any]] = []

    for key in ["targetPrice", "target", "takeProfitPrice", "takeProfit", "tp1", "tp"]:
        if price_is_valid(signal.get(key)):
            push_candidate(candidates, symbol=normalized_symbol, entry=entry, price=to_float(signal.get(key)), direction=direction, source="explicit_signal_target", quality=76, item={"label": key})

    if isinstance(overlays, dict):
        extraction_sets: List[Tuple[str, List[Any], float]] = [
            ("smc_structure", list_value(overlays.get("smcEvents")), 66),
            ("liquidity_sweep", list_value(overlays.get("liquidityEvents")), 68),
            ("order_block", list_value(overlays.get("orderBlocks")), 74),
            ("zone", list_value(overlays.get("zones")), 62),
            ("alphax_dlm", list_value(overlays.get("dlmLevels")), 72),
            ("profile_bin", list_value(overlays.get("liquidityProfileBins")) or list_value(overlays.get("alphaProfileBins")), 64),
            ("line", list_value(overlays.get("lines")), 58),
        ]
        for fallback_source, items, base_quality in extraction_sets:
            for item in items[-80:]:
                if not isinstance(item, dict):
                    continue
                item_source = source_from_item(item, fallback_source)
                prices = extract_price_candidates_from_item(item)
                for price in prices:
                    quality = base_quality
                    if item_source == "order_block":
                        quality += 6
                    if item_source == "alphax_dlm":
                        quality += 5
                    if item_source == "fvg":
                        quality += 3
                    if item_source == "liquidity_sweep":
                        quality += 4
                    push_candidate(candidates, symbol=normalized_symbol, entry=entry, price=price, direction=direction, source=item_source, quality=quality, item=item)

    for index, ghost in enumerate(ghosts[:10]):
        if not isinstance(ghost, dict):
            continue
        for key in ["high", "low", "close", "target", "targetPrice"]:
            if not price_is_valid(ghost.get(key)):
                continue
            source = "ghost_projection_high" if key == "high" else "ghost_projection_low" if key == "low" else "ghost_projection"
            quality = clamp(to_float(ghost.get("confidence"), 45) * 0.75 + 18 - index * 2, 25, 86)
            push_candidate(candidates, symbol=normalized_symbol, entry=entry, price=to_float(ghost.get(key)), direction=direction, source=source, quality=quality, item={"label": ghost.get("label") or f"Ghost #{index + 1}", "kind": source})

    candidates.extend(scan_structure_targets(candles, symbol=normalized_symbol, direction=direction, entry=entry, atr=atr))

    fallback_move = atr * 2.0
    fallback_price = entry + fallback_move if direction == "bullish" else entry - fallback_move if direction == "bearish" else entry
    push_candidate(candidates, symbol=normalized_symbol, entry=entry, price=fallback_price, direction=direction, source="atr_fallback", quality=38, item={"label": "ATR fallback"})

    deduped: Dict[str, Dict[str, Any]] = {}
    for candidate in candidates:
        key = f"{candidate.get('source')}::{candidate.get('price')}"
        existing = deduped.get(key)
        if existing is None or to_float(candidate.get("quality"), 0) > to_float(existing.get("quality"), 0):
            deduped[key] = candidate
    output = list(deduped.values())
    source_weights = get_target_ml_source_weights(normalized_symbol, normalized_timeframe)
    for candidate in output:
        source = str(candidate.get("source") or "unknown")
        learned = source_weights.get(source, {})
        source_quality = to_float(learned.get("qualityMultiplier"), 1.0)
        source_bonus = to_float(learned.get("confidenceBonus"), 0.0)
        candidate["learnedQuality"] = round(clamp(to_float(candidate.get("quality"), 0) * source_quality + source_bonus, 0, 100), 2)
        candidate["learnedSamples"] = int(learned.get("samples") or 0)
        candidate["learnedHitRate"] = to_float(learned.get("hitRate"), 0.0)
    output.sort(key=lambda item: (to_float(item.get("learnedQuality"), item.get("quality")), -to_float(item.get("distancePct"), 999)), reverse=True)
    return output[:40]


def empty_target_plan(symbol: str, timeframe: str, reason: str) -> Dict[str, Any]:
    return {
        "eventType": "TARGET_ML_PLAN", "status": "Waiting", "symbol": normalize_symbol(symbol), "timeframe": normalize_timeframe(timeframe), "reason": reason,
        "entry": None, "entryPrice": None, "target": None, "targetPrice": None, "takeProfitPrice": None, "tp1": None,
        "stop": None, "stopPrice": None, "direction": "neutral", "source": None, "targetSource": None,
        "targetConfidence": 0, "targetMlReady": False, "targetMlSamples": 0, "targetMlHitRate": 0, "ghostConfidenceBoost": 0,
        "riskReward": 0, "candidates": [], "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_TARGET_GHOST_ONLY", "nrtrUsedForMl": 0, "smmaUsedForMl": 0,
        "createdAt": now_iso(),
    }



def target_ml_state_key(symbol: str, timeframe: str) -> str:
    return f"{normalize_symbol(symbol)}::{normalize_timeframe(timeframe)}"


def smooth_target_ml_plan(symbol: str, timeframe: str, plan: Dict[str, Any]) -> Dict[str, Any]:
    """Persist a short target confidence/source lock so live Target ML does not visually reset.

    This does not fake a target. It only smooths the displayed confidence and learned
    reliability for the latest valid Target ML plan. Weak drops are dampened; stronger
    plans update the lock immediately.
    """
    global TARGET_ML_STATE

    if not isinstance(plan, dict):
        return plan

    with TARGET_ML_MEMORY_LOCK:
        target_price = to_float(plan.get("targetPrice") or plan.get("target"), 0.0)
        confidence = clamp(to_float(plan.get("targetConfidence"), 0.0), 0.0, 100.0)
        source = str(plan.get("targetSource") or plan.get("source") or "unknown")
        key = target_ml_state_key(symbol, timeframe)
        state = TARGET_ML_STATE.get(key, {}) if isinstance(TARGET_ML_STATE.get(key), dict) else {}

        if target_price <= 0:
            if state:
                return {
                    **plan,
                    "targetConfidence": to_float(state.get("smoothedConfidence"), confidence),
                    "liveTargetConfidence": confidence,
                    "smoothedTargetConfidence": to_float(state.get("smoothedConfidence"), confidence),
                    "learnedReliability": to_float(state.get("learnedReliability"), 50.0),
                    "targetSourceLockActive": True,
                    "targetSourceLocked": state.get("source"),
                    "targetMlReason": plan.get("targetMlReason") or "using_previous_target_confidence_lock",
                }
            return plan

        previous_smoothed = to_float(state.get("smoothedConfidence"), confidence)
        previous_source = str(state.get("source") or source)
        previous_samples = int(state.get("observations") or 0)

        # Faster rise, slower drop.
        alpha = 0.60 if confidence >= previous_smoothed else 0.18
        smoothed = clamp(previous_smoothed * (1.0 - alpha) + confidence * alpha, 0.0, 100.0)

        # If source changes and new confidence is much weaker, keep previous confidence as a display lock.
        lock_active = False
        if previous_source != source and confidence < previous_smoothed - 10:
            smoothed = previous_smoothed
            lock_active = True

        learned_reliability = clamp(smoothed * 0.55 + to_float(plan.get("targetMlHitRate"), 0.0) * 0.45, 0.0, 100.0)

        TARGET_ML_STATE[key] = {
            "symbol": normalize_symbol(symbol),
            "timeframe": normalize_timeframe(timeframe),
            "source": previous_source if lock_active else source,
            "liveSource": source,
            "targetPrice": target_price,
            "liveConfidence": confidence,
            "smoothedConfidence": round(smoothed, 4),
            "learnedReliability": round(learned_reliability, 4),
            "observations": previous_samples + 1,
            "targetSourceLockActive": lock_active,
            "updatedAt": now_iso(),
        }
        save_target_ml_memory()

        return {
            **plan,
            "targetConfidence": round(smoothed, 2),
            "liveTargetConfidence": round(confidence, 2),
            "smoothedTargetConfidence": round(smoothed, 2),
            "learnedReliability": round(learned_reliability, 2),
            "targetSourceLockActive": lock_active,
            "targetSourceLocked": TARGET_ML_STATE[key]["source"],
            "targetMlStateSamples": previous_samples + 1,
            "targetMlReason": plan.get("targetMlReason") or ("target_source_lock" if lock_active else "target_confidence_smoothed"),
        }


def build_target_ml_plan(symbol: str, timeframe: str, candles: List[Dict[str, Any]], overlays: Dict[str, Any], ghosts: Optional[List[Dict[str, Any]]] = None, signal: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    candidates = build_target_candidates(normalized_symbol, normalized_timeframe, candles, overlays, ghosts, signal)
    if not candles:
        return empty_target_plan(normalized_symbol, normalized_timeframe, "no_candles")
    latest = candles[-1]
    signal = signal or {}
    entry = to_float(signal.get("entry") or signal.get("price") or signal.get("current") or latest.get("close"), 0)
    direction = signal_to_direction(signal.get("signal") or signal.get("type") or signal.get("direction") or (ghosts[0].get("direction") if ghosts and isinstance(ghosts[0], dict) else "neutral"))
    if direction == "neutral" and candidates:
        direction = str(candidates[0].get("direction") or "neutral")
    if not candidates:
        return empty_target_plan(normalized_symbol, normalized_timeframe, "no_candidates")
    best = candidates[0]
    target_price = to_float(best.get("price"), 0)
    atr = average_true_range(candles, 14)
    stop_distance = max(atr * 1.15, abs(target_price - entry) * 0.42, abs(entry) * 0.001)
    stop_price = entry - stop_distance if direction == "bullish" else entry + stop_distance if direction == "bearish" else entry
    risk = abs(entry - stop_price)
    reward = abs(target_price - entry)
    risk_reward = reward / risk if risk > 0 else 0.0
    target_confidence = get_target_ml_confidence(normalized_symbol, normalized_timeframe, best, candidates)
    plan = {
        "eventType": "TARGET_ML_PLAN", "status": "Ready", "symbol": normalized_symbol, "timeframe": normalized_timeframe,
        "entry": round_price(normalized_symbol, entry), "entryPrice": round_price(normalized_symbol, entry),
        "target": round_price(normalized_symbol, target_price), "targetPrice": round_price(normalized_symbol, target_price), "takeProfitPrice": round_price(normalized_symbol, target_price), "tp1": round_price(normalized_symbol, target_price),
        "stop": round_price(normalized_symbol, stop_price), "stopPrice": round_price(normalized_symbol, stop_price),
        "direction": direction, "source": best.get("source"), "targetSource": best.get("source"),
        "targetConfidence": round(target_confidence.get("confidence", 0), 2), "targetMlReady": bool(target_confidence.get("ready")), "targetMlReason": target_confidence.get("reason"),
        "targetMlSamples": target_confidence.get("samples", 0), "targetMlHitRate": target_confidence.get("hitRate", 0), "ghostConfidenceBoost": target_confidence.get("ghostConfidenceBoost", 0),
        "riskReward": round(risk_reward, 3), "rewardDistance": round(reward, 5), "riskDistance": round(risk, 5), "candidates": candidates[:12],
        "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_TARGET_GHOST_ONLY", "nrtrUsedForMl": 0, "smmaUsedForMl": 0, "createdAt": now_iso(),
    }
    return smooth_target_ml_plan(normalized_symbol, normalized_timeframe, plan)


# ─────────────────────────────────────────────────────────────────────────────
# RECORD + EVALUATE
# ─────────────────────────────────────────────────────────────────────────────


def target_feature_snapshot(overlays: Dict[str, Any], ghosts: List[Dict[str, Any]], target_plan: Dict[str, Any]) -> Dict[str, Any]:
    smc_events = [item for item in list_value(overlays.get("smcEvents")) if isinstance(item, dict)]
    liquidity_events = [item for item in list_value(overlays.get("liquidityEvents")) if isinstance(item, dict)]
    zones = [item for item in list_value(overlays.get("zones")) if isinstance(item, dict)]
    order_blocks = [item for item in list_value(overlays.get("orderBlocks")) if isinstance(item, dict)]
    dlm_levels = [item for item in list_value(overlays.get("dlmLevels")) if isinstance(item, dict)]
    profile_bins = [item for item in (list_value(overlays.get("liquidityProfileBins")) or list_value(overlays.get("alphaProfileBins"))) if isinstance(item, dict)]
    meta = dict_value(overlays.get("alphaProfileMeta"))
    bull_pressure = to_float(meta.get("bullPressurePct"), 50)
    bear_pressure = to_float(meta.get("bearPressurePct"), 50)
    return {
        "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_TARGET_GHOST_ONLY", "nrtrUsedForMl": 0, "smmaUsedForMl": 0,
        "source": target_plan.get("targetSource") or target_plan.get("source"), "direction": target_plan.get("direction"), "riskReward": to_float(target_plan.get("riskReward"), 0),
        "smcCount": len(smc_events[-12:]), "liquidityCount": len(liquidity_events[-12:]), "zoneCount": len(zones[-16:]), "orderBlockCount": len(order_blocks[-12:]), "dlmLevelCount": len(dlm_levels[-18:]), "profileBinCount": len(profile_bins),
        "ghostCount": len(ghosts), "avgGhostConfidence": round(sum(to_float(item.get("confidence"), 0) for item in ghosts if isinstance(item, dict)) / max(len(ghosts), 1), 2) if ghosts else 0,
        "alphaBullPressurePct": round(bull_pressure, 2), "alphaBearPressurePct": round(bear_pressure, 2), "alphaPressureNet": round(bull_pressure - bear_pressure, 2),
    }


def record_target_ml_projection(symbol: str, timeframe: str, candles: List[Dict[str, Any]], target_plan: Dict[str, Any], overlays: Optional[Dict[str, Any]] = None, ghosts: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
    if not candles or not isinstance(target_plan, dict):
        return None
    target_price = to_float(target_plan.get("targetPrice") or target_plan.get("target"), 0)
    entry_price = to_float(target_plan.get("entryPrice") or target_plan.get("entry"), 0)
    direction = str(target_plan.get("direction") or "neutral").lower()
    source = str(target_plan.get("targetSource") or target_plan.get("source") or "unknown")
    if not price_is_valid(target_price) or not price_is_valid(entry_price) or direction not in {"bullish", "bearish"}:
        return None
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    projection_time = candle_time(candles[-1])
    if not projection_time:
        return None
    key = target_record_key(normalized_symbol, normalized_timeframe, projection_time, direction, source)
    with TARGET_ML_MEMORY_LOCK:
        for record in TARGET_ML_MEMORY:
            if record.get("key") == key:
                return record
        atr = average_true_range(candles, 14)
        horizon = int(target_plan.get("horizon") or max(3, min(12, round(abs(target_price - entry_price) / max(atr, 0.000001)))))
        horizon = max(3, min(20, horizon))
        record = {
            "key": key, "symbol": normalized_symbol, "timeframe": normalized_timeframe, "projectionTime": projection_time, "createdAt": now_iso(), "status": "pending",
            "entryPrice": round_price(normalized_symbol, entry_price), "targetPrice": round_price(normalized_symbol, target_price), "stopPrice": round_price(normalized_symbol, to_float(target_plan.get("stopPrice") or target_plan.get("stop"), 0)),
            "direction": direction, "source": source, "horizon": horizon, "riskReward": to_float(target_plan.get("riskReward"), 0), "targetConfidence": to_float(target_plan.get("targetConfidence"), 0), "candidateCount": len(list_value(target_plan.get("candidates"))),
            "features": target_feature_snapshot(overlays or {}, ghosts or [], target_plan), "evaluation": None,
        }
        TARGET_ML_MEMORY.append(record)
        trim_target_ml_memory()
        save_target_ml_memory()
        return record


def evaluate_target_ml_records(symbol: str, timeframe: str, candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    if not candles:
        return {"evaluatedNow": 0, "pending": 0, "saved": False}
    time_to_index = {candle_time(candle): index for index, candle in enumerate(candles) if candle_time(candle)}
    with TARGET_ML_MEMORY_LOCK:
        evaluated_now = 0
        for record in TARGET_ML_MEMORY:
            if record.get("symbol") != normalized_symbol or record.get("timeframe") != normalized_timeframe or record.get("status") == "evaluated":
                continue
            start_index = time_to_index.get(str(record.get("projectionTime") or ""))
            horizon = max(1, int(record.get("horizon") or 5))
            if start_index is None:
                continue
            future = candles[start_index + 1:start_index + 1 + horizon]
            if len(future) < horizon:
                continue
            entry = to_float(record.get("entryPrice"), 0)
            target = to_float(record.get("targetPrice"), 0)
            stop = to_float(record.get("stopPrice"), 0)
            direction = str(record.get("direction") or "neutral").lower()
            if not price_is_valid(entry) or not price_is_valid(target) or direction not in {"bullish", "bearish"}:
                continue
            actual_max_high = max(to_float(item.get("high"), entry) for item in future)
            actual_min_low = min(to_float(item.get("low"), entry) for item in future)
            actual_final_close = to_float(future[-1].get("close"), entry)
            target_hit = actual_max_high >= target if direction == "bullish" else actual_min_low <= target
            stop_hit = False
            if price_is_valid(stop):
                stop_hit = actual_min_low <= stop if direction == "bullish" else actual_max_high >= stop
            bars_to_target: Optional[int] = None
            bars_to_stop: Optional[int] = None
            for offset, candle in enumerate(future, start=1):
                high = to_float(candle.get("high"), entry)
                low = to_float(candle.get("low"), entry)
                if bars_to_target is None:
                    if direction == "bullish" and high >= target:
                        bars_to_target = offset
                    if direction == "bearish" and low <= target:
                        bars_to_target = offset
                if bars_to_stop is None and price_is_valid(stop):
                    if direction == "bullish" and low <= stop:
                        bars_to_stop = offset
                    if direction == "bearish" and high >= stop:
                        bars_to_stop = offset
            if bars_to_target is not None and bars_to_stop is not None:
                first_hit = "target" if bars_to_target <= bars_to_stop else "stop"
            elif bars_to_target is not None:
                first_hit = "target"
            elif bars_to_stop is not None:
                first_hit = "stop"
            else:
                first_hit = "none"
            favorable_move = actual_max_high - entry if direction == "bullish" else entry - actual_min_low
            adverse_move = entry - actual_min_low if direction == "bullish" else actual_max_high - entry
            target_distance = abs(target - entry)
            adverse_ratio = adverse_move / max(target_distance, 0.000001)
            favorable_ratio = favorable_move / max(target_distance, 0.000001)
            close_direction_ok = actual_final_close > entry if direction == "bullish" else actual_final_close < entry
            quality_score = round(clamp((100 if target_hit else 0) * 0.45 + (100 if first_hit == "target" else 0) * 0.25 + (100 if close_direction_ok else 0) * 0.12 + clamp(favorable_ratio * 100, 0, 100) * 0.10 + max(0, 100 - adverse_ratio * 100) * 0.08, 0, 100), 2)
            record["status"] = "evaluated"
            record["evaluatedAt"] = now_iso()
            record["evaluation"] = {
                "targetHit": bool(target_hit), "stopHit": bool(stop_hit), "firstHit": first_hit, "barsToTarget": bars_to_target, "barsToStop": bars_to_stop,
                "actualFinalClose": round(actual_final_close, 5), "actualMaxHigh": round(actual_max_high, 5), "actualMinLow": round(actual_min_low, 5),
                "favorableMove": round(favorable_move, 5), "adverseMove": round(adverse_move, 5), "favorableRatio": round(favorable_ratio, 5), "adverseRatio": round(adverse_ratio, 5), "closeDirectionOk": bool(close_direction_ok), "qualityScore": quality_score,
            }
            evaluated_now += 1
        pending = len([record for record in TARGET_ML_MEMORY if record.get("symbol") == normalized_symbol and record.get("timeframe") == normalized_timeframe and record.get("status") != "evaluated"])
        if evaluated_now > 0:
            save_target_ml_memory()
        return {"evaluatedNow": evaluated_now, "pending": pending, "saved": evaluated_now > 0}


# ─────────────────────────────────────────────────────────────────────────────
# LEARNING / CONFIDENCE
# ─────────────────────────────────────────────────────────────────────────────


def matching_records(symbol: str, timeframe: str) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    with TARGET_ML_MEMORY_LOCK:
        return [record for record in TARGET_ML_MEMORY if record.get("symbol") == normalized_symbol and record.get("timeframe") == normalized_timeframe]


def evaluated_records(symbol: str, timeframe: str) -> List[Dict[str, Any]]:
    return [record for record in matching_records(symbol, timeframe) if record.get("status") == "evaluated" and isinstance(record.get("evaluation"), dict)]


def summarize_target_records(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    evaluated = [record for record in records if record.get("status") == "evaluated" and isinstance(record.get("evaluation"), dict)]
    pending = [record for record in records if record.get("status") != "evaluated"]
    if not evaluated:
        return {"samples": 0, "pending": len(pending), "hitRate": 0.0, "firstTargetRate": 0.0, "avgQualityScore": 0.0, "avgFavorableRatio": 0.0, "avgAdverseRatio": 0.0, "avgBarsToTarget": None}
    bars_to_target_values = [to_float(record["evaluation"].get("barsToTarget"), 0) for record in evaluated if record["evaluation"].get("barsToTarget") is not None]
    return {
        "samples": len(evaluated), "pending": len(pending),
        "hitRate": round(sum(1 for record in evaluated if record["evaluation"].get("targetHit")) / len(evaluated) * 100, 2),
        "firstTargetRate": round(sum(1 for record in evaluated if record["evaluation"].get("firstHit") == "target") / len(evaluated) * 100, 2),
        "avgQualityScore": round(sum(to_float(record["evaluation"].get("qualityScore"), 0) for record in evaluated) / len(evaluated), 2),
        "avgFavorableRatio": round(sum(to_float(record["evaluation"].get("favorableRatio"), 0) for record in evaluated) / len(evaluated), 5),
        "avgAdverseRatio": round(sum(to_float(record["evaluation"].get("adverseRatio"), 0) for record in evaluated) / len(evaluated), 5),
        "avgBarsToTarget": round(sum(bars_to_target_values) / len(bars_to_target_values), 2) if bars_to_target_values else None,
    }


def get_target_ml_source_weights(symbol: str, timeframe: str) -> Dict[str, Dict[str, Any]]:
    evaluated = evaluated_records(symbol, timeframe)
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for record in evaluated:
        source = str(record.get("source") or "unknown")
        groups.setdefault(source, []).append(record)
    output: Dict[str, Dict[str, Any]] = {}
    for source, records in groups.items():
        summary = summarize_target_records(records)
        samples = int(summary.get("samples") or 0)
        if samples <= 0:
            continue
        hit_rate = to_float(summary.get("hitRate"), 0)
        first_rate = to_float(summary.get("firstTargetRate"), 0)
        quality = to_float(summary.get("avgQualityScore"), 0)
        adverse = to_float(summary.get("avgAdverseRatio"), 0)
        sample_weight = clamp(samples / max(TARGET_ML_MIN_EVALUATED_FOR_ADJUSTMENT, 1), 0.15, 1.0)
        edge = ((hit_rate - 45) * 0.35 + (first_rate - 35) * 0.25 + (quality - 50) * 0.30 - max(0, adverse - 0.75) * 12) * sample_weight
        output[source] = {
            "samples": samples, "hitRate": hit_rate, "firstTargetRate": first_rate, "avgQualityScore": quality, "avgAdverseRatio": adverse,
            "qualityMultiplier": round(clamp(1.0 + edge / 100.0, 0.70, 1.35), 4), "confidenceBonus": round(clamp(edge * 0.20, -10, 14), 2),
        }
    return output


def get_target_ml_confidence(symbol: str, timeframe: str, best_candidate: Dict[str, Any], candidates: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    all_evaluated = evaluated_records(normalized_symbol, normalized_timeframe)
    overall = summarize_target_records(all_evaluated)
    source = str(best_candidate.get("source") or "unknown")
    source_records = [record for record in all_evaluated if str(record.get("source") or "unknown") == source]
    source_summary = summarize_target_records(source_records)
    ready = int(overall.get("samples") or 0) >= TARGET_ML_MIN_EVALUATED_FOR_ADJUSTMENT
    active = source_summary if int(source_summary.get("samples") or 0) >= 5 else overall
    base_quality = to_float(best_candidate.get("learnedQuality") or best_candidate.get("quality"), 45)
    hit_rate = to_float(active.get("hitRate"), 0)
    first_rate = to_float(active.get("firstTargetRate"), 0)
    quality = to_float(active.get("avgQualityScore"), 0)
    adverse = to_float(active.get("avgAdverseRatio"), 0)
    if not ready:
        confidence = clamp(base_quality * 0.78, 15, 74)
        return {"ready": False, "confidence": round(confidence, 2), "samples": int(overall.get("samples") or 0), "hitRate": hit_rate, "firstTargetRate": first_rate, "quality": quality, "ghostConfidenceBoost": 0, "reason": "not_enough_evaluated_target_samples", "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_TARGET_GHOST_ONLY", "nrtrUsedForMl": 0, "smmaUsedForMl": 0}
    confidence = clamp(base_quality * 0.40 + hit_rate * 0.24 + first_rate * 0.16 + quality * 0.16 + max(0, 100 - adverse * 100) * 0.04, 5, 96)
    ghost_boost = clamp((confidence - 50) * 0.16, -6, 10)
    return {"ready": True, "confidence": round(confidence, 2), "samples": int(active.get("samples") or 0), "overallSamples": int(overall.get("samples") or 0), "hitRate": hit_rate, "firstTargetRate": first_rate, "quality": quality, "ghostConfidenceBoost": round(ghost_boost, 2), "reason": "source_learning" if int(source_summary.get("samples") or 0) >= 5 else "overall_learning", "sourceSummary": source_summary, "overall": overall, "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_TARGET_GHOST_ONLY", "nrtrUsedForMl": 0, "smmaUsedForMl": 0}


def target_ml_summary_from_candles(symbol: str, timeframe: str, candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    eval_result = evaluate_target_ml_records(normalized_symbol, normalized_timeframe, candles)
    records = matching_records(normalized_symbol, normalized_timeframe)
    evaluated = [record for record in records if record.get("status") == "evaluated" and isinstance(record.get("evaluation"), dict)]
    pending = [record for record in records if record.get("status") != "evaluated"]
    overall = summarize_target_records(records)
    with TARGET_ML_MEMORY_LOCK:
        state = TARGET_ML_STATE.get(target_ml_state_key(normalized_symbol, normalized_timeframe), {})
    return {
        "eventType": "TARGET_ML_STATUS", "status": "Learning" if records else "Waiting", "symbol": normalized_symbol, "timeframe": normalized_timeframe,
        "memorySize": len(records), "evaluatedSamples": len(evaluated), "pendingSamples": len(pending), "evaluatedNow": eval_result.get("evaluatedNow", 0),
        "hitRate": overall["hitRate"], "firstTargetRate": overall["firstTargetRate"], "avgQualityScore": overall["avgQualityScore"], "avgFavorableRatio": overall["avgFavorableRatio"], "avgAdverseRatio": overall["avgAdverseRatio"], "avgBarsToTarget": overall["avgBarsToTarget"],
        "readyForLiveTargetAdjustment": overall["samples"] >= TARGET_ML_MIN_EVALUATED_FOR_ADJUSTMENT, "sourceWeights": get_target_ml_source_weights(normalized_symbol, normalized_timeframe), "state": state, "storeFile": str(TARGET_ML_STORE_FILE), "recent": records[-20:],
        "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_TARGET_GHOST_ONLY", "nrtrUsedForMl": 0, "smmaUsedForMl": 0, "createdAt": now_iso(),
    }


def target_ml_export() -> Dict[str, Any]:
    with TARGET_ML_MEMORY_LOCK:
        return {"eventType": "TARGET_ML_EXPORT", "version": "target-ml-v1-smc-alpha-dlm-ob-ghost", "createdAt": now_iso(), "memorySize": len(TARGET_ML_MEMORY), "state": TARGET_ML_STATE, "records": TARGET_ML_MEMORY, "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_TARGET_GHOST_ONLY", "nrtrUsedForMl": 0, "smmaUsedForMl": 0}


def reset_target_ml_memory(symbol: Optional[str] = None, timeframe: Optional[str] = None) -> Dict[str, Any]:
    global TARGET_ML_MEMORY, TARGET_ML_STATE
    with TARGET_ML_MEMORY_LOCK:
        if symbol is None and timeframe is None:
            removed = len(TARGET_ML_MEMORY)
            TARGET_ML_MEMORY = []
            TARGET_ML_STATE = {}
            save_target_ml_memory()
            return {"status": "reset", "scope": "all", "removed": removed, "remaining": 0}
        normalized_symbol = normalize_symbol(symbol or "")
        normalized_timeframe = normalize_timeframe(timeframe or "")
        before = len(TARGET_ML_MEMORY)
        TARGET_ML_MEMORY = [record for record in TARGET_ML_MEMORY if not ((not symbol or record.get("symbol") == normalized_symbol) and (not timeframe or record.get("timeframe") == normalized_timeframe))]
        removed = before - len(TARGET_ML_MEMORY)
        state_key = target_ml_state_key(normalized_symbol, normalized_timeframe)
        TARGET_ML_STATE.pop(state_key, None)
        save_target_ml_memory()
        return {"status": "reset", "scope": "filtered", "symbol": normalized_symbol if symbol else None, "timeframe": normalized_timeframe if timeframe else None, "removed": removed, "remaining": len(TARGET_ML_MEMORY)}
