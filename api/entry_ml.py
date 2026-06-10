from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


# ─────────────────────────────────────────────────────────────────────────────
# MARKETBOS ENTRY ML
# ─────────────────────────────────────────────────────────────────────────────
#
# Purpose:
# - Learn confidence for trade entries from historical trade outcomes.
# - Replace simple rule-based "entry confidence" in Strategy Tester.
# - Prepare the confidence layer future AI Trader will use before taking trades.
#
# Important separation:
# - Ghost ML and Target ML remain SMC/AlphaX/DLM/OB/FVG/liquidity based.
# - Entry ML is allowed to know what triggered the entry, including NRTR/SMMA,
#   because this is the strategy-trade layer, not the ghost/target prediction layer.
# - The AI Trader should read this as "trade entry probability context", not as
#   permission to trade without risk checks.
#
# Learns from:
# - Entry trigger mode: NRTR, SMMA, manual, AI, scorecard, etc.
# - Side: long/short.
# - Symbol/timeframe.
# - Mini-chart confirmations.
# - Scorecard context if available.
# - Ghost ML confidence if available.
# - Target ML confidence if available.
# - Actual trade result after exit.
#
# Outputs:
# - entryConfidence
# - confidenceGrade
# - learnedWinRate
# - learnedProfitFactor
# - learnedAvgR
# - aiTraderUsable
# ─────────────────────────────────────────────────────────────────────────────


ENTRY_ML_MEMORY: List[Dict[str, Any]] = []
ENTRY_ML_MAX_RECORDS = int(os.getenv("ENTRY_ML_MAX_RECORDS", "10000"))
ENTRY_ML_STORE_FILE = Path(os.getenv("ENTRY_ML_STORE_FILE", "/tmp/trading_dashboard_entry_ml_memory.json"))
ENTRY_ML_MIN_EVALUATED_FOR_CONFIDENCE = int(os.getenv("ENTRY_ML_MIN_EVALUATED_FOR_CONFIDENCE", "20"))
ENTRY_ML_MIN_BUCKET_SAMPLES = int(os.getenv("ENTRY_ML_MIN_BUCKET_SAMPLES", "6"))


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


def normalize_symbol(symbol: Any) -> str:
    raw = str(symbol or "MES1!").strip().upper()
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

    return raw or "MES1!"


def normalize_timeframe(timeframe: Any) -> str:
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


def normalize_side(side: Any) -> str:
    text = str(side or "").strip().lower()

    if text in {"1", "long", "buy", "bull", "bullish", "up"}:
        return "long"
    if text in {"-1", "short", "sell", "bear", "bearish", "down"}:
        return "short"

    return "neutral"


def normalize_mode(mode: Any) -> str:
    text = str(mode or "unknown").strip().lower()

    if "nrtr" in text:
        return "nrtr"
    if "smma" in text:
        return "smma"
    if "ai" in text:
        return "ai_trader"
    if "score" in text:
        return "scorecard"
    if "manual" in text:
        return "manual"

    return text.replace(" ", "_") or "unknown"


def bool_to_int(value: Any) -> int:
    return 1 if bool(value) else 0


def confidence_grade(confidence: float) -> str:
    if confidence >= 82:
        return "A+"
    if confidence >= 74:
        return "A"
    if confidence >= 66:
        return "B"
    if confidence >= 56:
        return "C"
    if confidence >= 45:
        return "D"
    return "F"


def rr_bucket(value: Any) -> str:
    rr = to_float(value, 0)
    if rr >= 3:
        return "rr_3_plus"
    if rr >= 2:
        return "rr_2_to_3"
    if rr >= 1.25:
        return "rr_1_25_to_2"
    if rr > 0:
        return "rr_under_1_25"
    return "rr_unknown"


def score_bucket(value: Any) -> str:
    score = to_float(value, 0)
    if score >= 80:
        return "very_high"
    if score >= 65:
        return "high"
    if score >= 50:
        return "medium"
    if score > 0:
        return "low"
    return "unknown"


def direction_text(value: Any) -> str:
    text = str(value or "").lower()
    if "bull" in text or "buy" in text or "long" in text or "up" in text:
        return "bullish"
    if "bear" in text or "sell" in text or "short" in text or "down" in text:
        return "bearish"
    return "neutral"


def entry_key(symbol: str, timeframe: str, entry_time: Any, side: str, mode: str) -> str:
    return f"{normalize_symbol(symbol)}::{normalize_timeframe(timeframe)}::{entry_time}::{side}::{mode}"


# ─────────────────────────────────────────────────────────────────────────────
# PERSISTENCE
# ─────────────────────────────────────────────────────────────────────────────


def load_entry_ml_memory() -> Dict[str, Any]:
    global ENTRY_ML_MEMORY

    try:
        if not ENTRY_ML_STORE_FILE.exists():
            ENTRY_ML_MEMORY = []
            return {"status": "empty", "loaded": 0, "path": str(ENTRY_ML_STORE_FILE)}

        with ENTRY_ML_STORE_FILE.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)

        records = payload.get("records") if isinstance(payload, dict) else payload
        if not isinstance(records, list):
            records = []

        cleaned = [record for record in records if isinstance(record, dict)]
        if len(cleaned) > ENTRY_ML_MAX_RECORDS:
            cleaned = cleaned[-ENTRY_ML_MAX_RECORDS:]

        ENTRY_ML_MEMORY = cleaned

        return {"status": "loaded", "loaded": len(ENTRY_ML_MEMORY), "path": str(ENTRY_ML_STORE_FILE)}
    except Exception as error:
        print(f"[Entry ML] memory load failed: {error}")
        ENTRY_ML_MEMORY = []
        return {"status": "error", "loaded": 0, "path": str(ENTRY_ML_STORE_FILE), "error": str(error)}


def save_entry_ml_memory() -> Dict[str, Any]:
    try:
        ENTRY_ML_STORE_FILE.parent.mkdir(parents=True, exist_ok=True)

        payload = {
            "version": "entry-ml-v1-ai-trader-ready",
            "createdAt": now_iso(),
            "maxRecords": ENTRY_ML_MAX_RECORDS,
            "records": ENTRY_ML_MEMORY[-ENTRY_ML_MAX_RECORDS:],
        }

        temp_path = ENTRY_ML_STORE_FILE.with_suffix(ENTRY_ML_STORE_FILE.suffix + ".tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"), ensure_ascii=False)

        temp_path.replace(ENTRY_ML_STORE_FILE)

        return {"status": "saved", "saved": len(ENTRY_ML_MEMORY), "path": str(ENTRY_ML_STORE_FILE)}
    except Exception as error:
        print(f"[Entry ML] memory save failed: {error}")
        return {"status": "error", "saved": 0, "path": str(ENTRY_ML_STORE_FILE), "error": str(error)}


def trim_entry_ml_memory() -> None:
    global ENTRY_ML_MEMORY

    if len(ENTRY_ML_MEMORY) > ENTRY_ML_MAX_RECORDS:
        ENTRY_ML_MEMORY = ENTRY_ML_MEMORY[-ENTRY_ML_MAX_RECORDS:]


load_entry_ml_memory()


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE SNAPSHOT
# ─────────────────────────────────────────────────────────────────────────────


def build_entry_feature_snapshot(
    *,
    symbol: Any,
    timeframe: Any,
    side: Any,
    mode: Any,
    entry_price: Any,
    target_price: Any = None,
    stop_price: Any = None,
    risk_reward: Any = None,
    scorecards: Optional[Dict[str, Any]] = None,
    ghost_ml: Optional[Dict[str, Any]] = None,
    target_ml: Optional[Dict[str, Any]] = None,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    scorecards = scorecards if isinstance(scorecards, dict) else {}
    ghost_ml = ghost_ml if isinstance(ghost_ml, dict) else {}
    target_ml = target_ml if isinstance(target_ml, dict) else {}
    context = context if isinstance(context, dict) else {}

    normalized_side = normalize_side(side)
    normalized_mode = normalize_mode(mode)

    overall = scorecards.get("overall") if isinstance(scorecards.get("overall"), dict) else {}
    smc = scorecards.get("smc") if isinstance(scorecards.get("smc"), dict) else {}
    order_blocks = scorecards.get("orderBlocks") if isinstance(scorecards.get("orderBlocks"), dict) else {}
    liquidity = scorecards.get("liquidityProfile") if isinstance(scorecards.get("liquidityProfile"), dict) else {}
    ghost = scorecards.get("ghost") if isinstance(scorecards.get("ghost"), dict) else {}

    main_direction = normalize_side(context.get("mainDirection") or context.get("main"))
    mini_one_direction = normalize_side(context.get("miniOneDirection") or context.get("miniOne"))
    mini_two_direction = normalize_side(context.get("miniTwoDirection") or context.get("miniTwo"))

    mini_confirmations = 0
    if mini_one_direction == normalized_side:
        mini_confirmations += 1
    if mini_two_direction == normalized_side:
        mini_confirmations += 1

    target_confidence = to_float(
        target_ml.get("targetConfidence")
        or target_ml.get("confidence")
        or context.get("targetConfidence"),
        0,
    )
    ghost_confidence = to_float(
        ghost_ml.get("confidence")
        or ghost.get("confidence")
        or context.get("ghostConfidence"),
        0,
    )
    overall_score = to_float(
        overall.get("confirmationScore")
        or overall.get("score")
        or context.get("overallScore"),
        0,
    )

    entry_price_float = to_float(entry_price, 0)
    target_price_float = to_float(target_price, 0)
    stop_price_float = to_float(stop_price, 0)
    risk_reward_float = to_float(risk_reward, 0)

    if risk_reward_float <= 0 and entry_price_float > 0 and target_price_float > 0 and stop_price_float > 0:
        reward = abs(target_price_float - entry_price_float)
        risk = abs(entry_price_float - stop_price_float)
        risk_reward_float = reward / max(risk, 0.000001)

    side_direction = "bullish" if normalized_side == "long" else "bearish" if normalized_side == "short" else "neutral"
    target_direction = direction_text(target_ml.get("direction") or context.get("targetDirection"))
    ghost_direction = direction_text(ghost_ml.get("direction") or ghost.get("direction") or context.get("ghostDirection"))
    overall_direction = direction_text(overall.get("direction") or context.get("overallDirection"))

    return {
        "symbol": normalize_symbol(symbol),
        "timeframe": normalize_timeframe(timeframe),
        "side": normalized_side,
        "mode": normalized_mode,
        "entryTriggerMode": normalized_mode,

        "mainDirection": main_direction,
        "miniOneDirection": mini_one_direction,
        "miniTwoDirection": mini_two_direction,
        "miniConfirmations": mini_confirmations,
        "allChartsAligned": bool_to_int(
            main_direction == normalized_side
            and mini_one_direction == normalized_side
            and mini_two_direction == normalized_side
        ),

        "entryPrice": round(entry_price_float, 5),
        "targetPrice": round(target_price_float, 5),
        "stopPrice": round(stop_price_float, 5),
        "riskReward": round(risk_reward_float, 4),
        "riskRewardBucket": rr_bucket(risk_reward_float),

        "overallScore": round(overall_score, 2),
        "overallScoreBucket": score_bucket(overall_score),
        "overallDirectionAligned": bool_to_int(overall_direction == side_direction),

        "smcQuality": round(to_float(smc.get("qualityScore") or smc.get("score"), 0), 2),
        "orderBlockQuality": round(to_float(order_blocks.get("qualityScore") or order_blocks.get("score"), 0), 2),
        "liquidityQuality": round(to_float(liquidity.get("qualityScore") or liquidity.get("score"), 0), 2),

        "ghostConfidence": round(ghost_confidence, 2),
        "ghostConfidenceBucket": score_bucket(ghost_confidence),
        "ghostDirectionAligned": bool_to_int(ghost_direction == side_direction),
        "ghostMlReady": bool_to_int(ghost_ml.get("mlReady") or ghost_ml.get("ready") or context.get("ghostMlReady")),

        "targetConfidence": round(target_confidence, 2),
        "targetConfidenceBucket": score_bucket(target_confidence),
        "targetDirectionAligned": bool_to_int(target_direction == side_direction),
        "targetMlReady": bool_to_int(target_ml.get("targetMlReady") or target_ml.get("ready") or context.get("targetMlReady")),
        "targetSource": str(target_ml.get("targetSource") or target_ml.get("source") or context.get("targetSource") or "unknown"),

        "session": str(context.get("session") or "unknown").lower(),
        "marketState": str(context.get("marketState") or context.get("regime") or "unknown").lower(),

        # This is entry/trade ML, not Ghost/Target ML.
        "mlLayer": "ENTRY_ML_AI_TRADER_READY",
    }


def feature_bucket(features: Dict[str, Any]) -> str:
    return "|".join([
        f"symbol={features.get('symbol')}",
        f"tf={features.get('timeframe')}",
        f"side={features.get('side')}",
        f"mode={features.get('mode')}",
        f"rr={features.get('riskRewardBucket')}",
        f"overall={features.get('overallScoreBucket')}",
        f"ghost={features.get('ghostConfidenceBucket')}",
        f"target={features.get('targetConfidenceBucket')}",
        f"mini={features.get('miniConfirmations')}",
        f"targetSource={features.get('targetSource')}",
    ])


def broad_bucket(features: Dict[str, Any]) -> str:
    return "|".join([
        f"symbol={features.get('symbol')}",
        f"tf={features.get('timeframe')}",
        f"side={features.get('side')}",
        f"mode={features.get('mode')}",
        f"target={features.get('targetConfidenceBucket')}",
        f"ghost={features.get('ghostConfidenceBucket')}",
    ])


# ─────────────────────────────────────────────────────────────────────────────
# RECORD / UPDATE ENTRIES
# ─────────────────────────────────────────────────────────────────────────────


def record_entry_ml_trade(
    *,
    symbol: Any,
    timeframe: Any,
    entry_time: Any,
    side: Any,
    mode: Any,
    entry_price: Any,
    target_price: Any = None,
    stop_price: Any = None,
    risk_reward: Any = None,
    scorecards: Optional[Dict[str, Any]] = None,
    ghost_ml: Optional[Dict[str, Any]] = None,
    target_ml: Optional[Dict[str, Any]] = None,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    normalized_side = normalize_side(side)
    normalized_mode = normalize_mode(mode)
    entry_time_text = str(entry_time or now_iso())
    key = entry_key(normalized_symbol, normalized_timeframe, entry_time_text, normalized_side, normalized_mode)

    for record in ENTRY_ML_MEMORY:
        if record.get("key") == key:
            return record

    features = build_entry_feature_snapshot(
        symbol=normalized_symbol,
        timeframe=normalized_timeframe,
        side=normalized_side,
        mode=normalized_mode,
        entry_price=entry_price,
        target_price=target_price,
        stop_price=stop_price,
        risk_reward=risk_reward,
        scorecards=scorecards,
        ghost_ml=ghost_ml,
        target_ml=target_ml,
        context=context,
    )

    confidence = get_entry_ml_confidence_from_features(features)

    record = {
        "key": key,
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "entryTime": entry_time_text,
        "createdAt": now_iso(),
        "status": "open",
        "side": normalized_side,
        "mode": normalized_mode,
        "entryPrice": round(to_float(entry_price), 5),
        "targetPrice": round(to_float(target_price), 5),
        "stopPrice": round(to_float(stop_price), 5),
        "riskReward": to_float(features.get("riskReward"), 0),
        "features": features,
        "featureBucket": feature_bucket(features),
        "broadBucket": broad_bucket(features),
        "entryConfidence": confidence,
        "evaluation": None,
    }

    ENTRY_ML_MEMORY.append(record)
    trim_entry_ml_memory()
    save_entry_ml_memory()

    return record


def close_entry_ml_trade(
    *,
    symbol: Any,
    timeframe: Any,
    entry_time: Any,
    side: Any,
    mode: Any,
    exit_time: Any,
    exit_price: Any,
    pnl: Any = None,
    pnl_percent: Any = None,
    mfe: Any = None,
    mae: Any = None,
    bars_held: Any = None,
    exit_reason: Any = None,
) -> Optional[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    normalized_side = normalize_side(side)
    normalized_mode = normalize_mode(mode)
    key = entry_key(normalized_symbol, normalized_timeframe, str(entry_time or ""), normalized_side, normalized_mode)

    found: Optional[Dict[str, Any]] = None

    for record in ENTRY_ML_MEMORY:
        if record.get("key") == key:
            found = record
            break

    if found is None:
        return None

    entry_price = to_float(found.get("entryPrice"), 0)
    exit_price_float = to_float(exit_price, 0)
    pnl_value = to_float(pnl, 0)

    if pnl_value == 0 and entry_price > 0 and exit_price_float > 0:
        pnl_value = exit_price_float - entry_price if normalized_side == "long" else entry_price - exit_price_float

    pnl_percent_value = to_float(pnl_percent, 0)
    if pnl_percent_value == 0 and entry_price > 0 and pnl_value != 0:
        pnl_percent_value = pnl_value / entry_price * 100

    target_price = to_float(found.get("targetPrice"), 0)
    stop_price = to_float(found.get("stopPrice"), 0)
    risk = abs(entry_price - stop_price) if stop_price > 0 else abs(entry_price * 0.001)
    r_multiple = pnl_value / max(risk, 0.000001)

    won = pnl_value > 0
    target_hit = False
    stop_hit = False

    if target_price > 0:
        target_hit = exit_price_float >= target_price if normalized_side == "long" else exit_price_float <= target_price
    if stop_price > 0:
        stop_hit = exit_price_float <= stop_price if normalized_side == "long" else exit_price_float >= stop_price

    quality_score = clamp(
        (100 if won else 0) * 0.36 +
        (100 if target_hit else 0) * 0.24 +
        clamp((r_multiple + 1.0) * 35.0, 0, 100) * 0.25 +
        max(0.0, 100.0 - abs(to_float(mae, 0)) * 220.0) * 0.08 +
        clamp(to_float(mfe, 0) * 220.0, 0, 100) * 0.07,
        0,
        100,
    )

    found["status"] = "closed"
    found["exitTime"] = str(exit_time or now_iso())
    found["exitPrice"] = round(exit_price_float, 5)
    found["evaluation"] = {
        "won": bool(won),
        "targetHit": bool(target_hit),
        "stopHit": bool(stop_hit),
        "pnl": round(pnl_value, 5),
        "pnlPercent": round(pnl_percent_value, 5),
        "rMultiple": round(r_multiple, 5),
        "mfe": to_float(mfe, 0),
        "mae": to_float(mae, 0),
        "barsHeld": int(to_float(bars_held, 0)),
        "exitReason": str(exit_reason or ""),
        "qualityScore": round(quality_score, 2),
    }
    found["closedAt"] = now_iso()

    save_entry_ml_memory()

    return found


# ─────────────────────────────────────────────────────────────────────────────
# SUMMARIES / CONFIDENCE
# ─────────────────────────────────────────────────────────────────────────────


def matching_records(symbol: Any = "", timeframe: Any = "") -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol) if symbol else ""
    normalized_timeframe = normalize_timeframe(timeframe) if timeframe else ""

    records = []

    for record in ENTRY_ML_MEMORY:
        if normalized_symbol and normalize_symbol(record.get("symbol")) != normalized_symbol:
            continue
        if normalized_timeframe and normalize_timeframe(record.get("timeframe")) != normalized_timeframe:
            continue
        records.append(record)

    return records


def evaluated_records(symbol: Any = "", timeframe: Any = "") -> List[Dict[str, Any]]:
    return [
        record for record in matching_records(symbol, timeframe)
        if record.get("status") == "closed"
        and isinstance(record.get("evaluation"), dict)
    ]


def summarize_entry_records(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    closed = [
        record for record in records
        if record.get("status") == "closed"
        and isinstance(record.get("evaluation"), dict)
    ]
    open_records = [record for record in records if record.get("status") != "closed"]

    if not closed:
        return {
            "samples": 0,
            "open": len(open_records),
            "winRate": 0.0,
            "targetHitRate": 0.0,
            "avgR": 0.0,
            "avgPnl": 0.0,
            "profitFactor": 0.0,
            "avgQualityScore": 0.0,
            "avgMfe": 0.0,
            "avgMae": 0.0,
        }

    wins = [record for record in closed if record["evaluation"].get("won")]
    losses = [record for record in closed if not record["evaluation"].get("won")]
    gross_profit = sum(max(to_float(record["evaluation"].get("pnl"), 0), 0) for record in closed)
    gross_loss = abs(sum(min(to_float(record["evaluation"].get("pnl"), 0), 0) for record in closed))

    return {
        "samples": len(closed),
        "open": len(open_records),
        "winRate": round(len(wins) / len(closed) * 100, 2),
        "targetHitRate": round(sum(1 for record in closed if record["evaluation"].get("targetHit")) / len(closed) * 100, 2),
        "avgR": round(sum(to_float(record["evaluation"].get("rMultiple"), 0) for record in closed) / len(closed), 4),
        "avgPnl": round(sum(to_float(record["evaluation"].get("pnl"), 0) for record in closed) / len(closed), 5),
        "profitFactor": round(gross_profit / gross_loss, 4) if gross_loss > 0 else 99.0 if gross_profit > 0 else 0.0,
        "avgQualityScore": round(sum(to_float(record["evaluation"].get("qualityScore"), 0) for record in closed) / len(closed), 2),
        "avgMfe": round(sum(to_float(record["evaluation"].get("mfe"), 0) for record in closed) / len(closed), 5),
        "avgMae": round(sum(to_float(record["evaluation"].get("mae"), 0) for record in closed) / len(closed), 5),
    }


def group_by(records: List[Dict[str, Any]], key: str) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for record in records:
        group_key = str(record.get(key) or "unknown")
        grouped.setdefault(group_key, []).append(record)
    return grouped


def confidence_from_summary(summary: Dict[str, Any], base_confidence: float = 50.0) -> float:
    samples = int(summary.get("samples") or 0)
    win_rate = to_float(summary.get("winRate"), 0)
    target_hit = to_float(summary.get("targetHitRate"), 0)
    avg_r = to_float(summary.get("avgR"), 0)
    profit_factor = to_float(summary.get("profitFactor"), 0)
    quality = to_float(summary.get("avgQualityScore"), 0)

    if samples <= 0:
        return clamp(base_confidence, 5, 95)

    sample_weight = clamp(samples / max(ENTRY_ML_MIN_EVALUATED_FOR_CONFIDENCE, 1), 0.15, 1.0)

    learned = (
        win_rate * 0.34 +
        target_hit * 0.18 +
        clamp((avg_r + 1.0) * 35.0, 0, 100) * 0.18 +
        clamp(profit_factor / 3.0 * 100.0, 0, 100) * 0.14 +
        quality * 0.16
    )

    # Shrink low sample results toward neutral.
    return round(clamp(base_confidence * (1.0 - sample_weight) + learned * sample_weight, 5, 96), 2)


def base_context_confidence(features: Dict[str, Any]) -> float:
    confidence = 44.0

    confidence += to_float(features.get("miniConfirmations"), 0) * 5.0
    confidence += 6.0 if to_float(features.get("allChartsAligned"), 0) > 0 else 0.0
    confidence += clamp((to_float(features.get("riskReward"), 0) - 1.0) * 6.0, -8, 12)
    confidence += clamp((to_float(features.get("overallScore"), 0) - 50.0) * 0.12, -8, 8)
    confidence += clamp((to_float(features.get("ghostConfidence"), 0) - 50.0) * 0.10, -7, 8)
    confidence += clamp((to_float(features.get("targetConfidence"), 0) - 50.0) * 0.16, -10, 12)

    if to_float(features.get("ghostDirectionAligned"), 0) > 0:
        confidence += 5.0
    if to_float(features.get("targetDirectionAligned"), 0) > 0:
        confidence += 7.0
    if to_float(features.get("overallDirectionAligned"), 0) > 0:
        confidence += 5.0
    if to_float(features.get("targetMlReady"), 0) > 0:
        confidence += 4.0
    if to_float(features.get("ghostMlReady"), 0) > 0:
        confidence += 3.0

    return clamp(confidence, 5, 92)


def get_entry_ml_confidence_from_features(features: Dict[str, Any]) -> Dict[str, Any]:
    evaluated = evaluated_records(features.get("symbol"), features.get("timeframe"))
    overall = summarize_entry_records(evaluated)
    exact_bucket_records = [
        record for record in evaluated
        if record.get("featureBucket") == feature_bucket(features)
    ]
    broad_bucket_records = [
        record for record in evaluated
        if record.get("broadBucket") == broad_bucket(features)
    ]

    exact_summary = summarize_entry_records(exact_bucket_records)
    broad_summary = summarize_entry_records(broad_bucket_records)

    base = base_context_confidence(features)

    if int(exact_summary.get("samples") or 0) >= ENTRY_ML_MIN_BUCKET_SAMPLES:
        active_summary = exact_summary
        reason = "exact_bucket_learning"
    elif int(broad_summary.get("samples") or 0) >= ENTRY_ML_MIN_BUCKET_SAMPLES:
        active_summary = broad_summary
        reason = "broad_bucket_learning"
    elif int(overall.get("samples") or 0) >= ENTRY_ML_MIN_EVALUATED_FOR_CONFIDENCE:
        active_summary = overall
        reason = "overall_learning"
    else:
        active_summary = overall
        reason = "not_enough_evaluated_entry_samples"

    confidence = confidence_from_summary(active_summary, base)

    return {
        "entryConfidence": round(confidence, 2),
        "confidence": round(confidence, 2),
        "confidenceGrade": confidence_grade(confidence),
        "reason": reason,
        "aiTraderUsable": int(active_summary.get("samples") or 0) >= ENTRY_ML_MIN_BUCKET_SAMPLES
            or int(overall.get("samples") or 0) >= ENTRY_ML_MIN_EVALUATED_FOR_CONFIDENCE,
        "samples": int(active_summary.get("samples") or 0),
        "overallSamples": int(overall.get("samples") or 0),
        "learnedWinRate": active_summary.get("winRate", 0.0),
        "learnedTargetHitRate": active_summary.get("targetHitRate", 0.0),
        "learnedProfitFactor": active_summary.get("profitFactor", 0.0),
        "learnedAvgR": active_summary.get("avgR", 0.0),
        "learnedQuality": active_summary.get("avgQualityScore", 0.0),
        "baseContextConfidence": round(base, 2),
        "exactBucket": feature_bucket(features),
        "broadBucket": broad_bucket(features),
        "mlLayer": "ENTRY_ML_AI_TRADER_READY",
        "createdAt": now_iso(),
    }


def get_entry_ml_confidence(
    *,
    symbol: Any,
    timeframe: Any,
    side: Any,
    mode: Any,
    entry_price: Any,
    target_price: Any = None,
    stop_price: Any = None,
    risk_reward: Any = None,
    scorecards: Optional[Dict[str, Any]] = None,
    ghost_ml: Optional[Dict[str, Any]] = None,
    target_ml: Optional[Dict[str, Any]] = None,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    features = build_entry_feature_snapshot(
        symbol=symbol,
        timeframe=timeframe,
        side=side,
        mode=mode,
        entry_price=entry_price,
        target_price=target_price,
        stop_price=stop_price,
        risk_reward=risk_reward,
        scorecards=scorecards,
        ghost_ml=ghost_ml,
        target_ml=target_ml,
        context=context,
    )

    confidence = get_entry_ml_confidence_from_features(features)

    return {
        **confidence,
        "features": features,
        "mlLayer": "ENTRY_ML_AI_TRADER_READY",
        "createdAt": now_iso(),
    }


def entry_ml_summary(symbol: Any = "", timeframe: Any = "") -> Dict[str, Any]:
    records = matching_records(symbol, timeframe)
    evaluated = [
        record for record in records
        if record.get("status") == "closed"
        and isinstance(record.get("evaluation"), dict)
    ]
    open_records = [record for record in records if record.get("status") != "closed"]
    overall = summarize_entry_records(records)

    by_mode = []
    for mode, mode_records in group_by(evaluated, "mode").items():
        summary = summarize_entry_records(mode_records)
        by_mode.append({"mode": mode, **summary})
    by_mode.sort(key=lambda item: (item.get("samples", 0), item.get("avgQualityScore", 0)), reverse=True)

    by_bucket = []
    for bucket, bucket_records in group_by(evaluated, "featureBucket").items():
        if len(bucket_records) < ENTRY_ML_MIN_BUCKET_SAMPLES:
            continue
        summary = summarize_entry_records(bucket_records)
        by_bucket.append({
            "bucket": bucket,
            **summary,
            "confidence": confidence_from_summary(summary, 50),
        })
    by_bucket.sort(key=lambda item: item.get("confidence", 0), reverse=True)

    return {
        "eventType": "ENTRY_ML_STATUS",
        "version": "entry-ml-v1-ai-trader-ready",
        "status": "Learning" if records else "Waiting",
        "symbol": normalize_symbol(symbol) if symbol else "",
        "timeframe": normalize_timeframe(timeframe) if timeframe else "",
        "memorySize": len(records),
        "closedSamples": len(evaluated),
        "openSamples": len(open_records),
        "overall": overall,
        "byMode": by_mode,
        "topBuckets": by_bucket[:25],
        "readyForAiTrader": overall.get("samples", 0) >= ENTRY_ML_MIN_EVALUATED_FOR_CONFIDENCE,
        "minEvaluatedForConfidence": ENTRY_ML_MIN_EVALUATED_FOR_CONFIDENCE,
        "minBucketSamples": ENTRY_ML_MIN_BUCKET_SAMPLES,
        "storeFile": str(ENTRY_ML_STORE_FILE),
        "recent": records[-30:],
        "createdAt": now_iso(),
    }


def entry_ml_export() -> Dict[str, Any]:
    return {
        "eventType": "ENTRY_ML_EXPORT",
        "version": "entry-ml-v1-ai-trader-ready",
        "createdAt": now_iso(),
        "memorySize": len(ENTRY_ML_MEMORY),
        "records": ENTRY_ML_MEMORY,
    }


def reset_entry_ml_memory(symbol: Optional[str] = None, timeframe: Optional[str] = None) -> Dict[str, Any]:
    global ENTRY_ML_MEMORY

    if symbol is None and timeframe is None:
        removed = len(ENTRY_ML_MEMORY)
        ENTRY_ML_MEMORY = []
        save_entry_ml_memory()
        return {"status": "reset", "scope": "all", "removed": removed, "remaining": 0}

    normalized_symbol = normalize_symbol(symbol or "")
    normalized_timeframe = normalize_timeframe(timeframe or "")

    before = len(ENTRY_ML_MEMORY)

    ENTRY_ML_MEMORY = [
        record for record in ENTRY_ML_MEMORY
        if not (
            (not symbol or record.get("symbol") == normalized_symbol)
            and (not timeframe or record.get("timeframe") == normalized_timeframe)
        )
    ]

    removed = before - len(ENTRY_ML_MEMORY)
    save_entry_ml_memory()

    return {
        "status": "reset",
        "scope": "filtered",
        "symbol": normalized_symbol if symbol else None,
        "timeframe": normalized_timeframe if timeframe else None,
        "removed": removed,
        "remaining": len(ENTRY_ML_MEMORY),
    }
