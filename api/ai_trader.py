from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


MEMORY_PATH = Path(os.getenv("AI_TRADER_MEMORY_PATH", str(Path(__file__).with_name("ai_trader_memory.json"))))
MAX_CLOSED_TRADES = int(os.getenv("AI_TRADER_MAX_CLOSED_TRADES", "2500"))
DEFAULT_MIN_CONFIDENCE = float(os.getenv("AI_TRADER_MIN_CONFIDENCE", "62"))
DEFAULT_MIN_RR = float(os.getenv("AI_TRADER_MIN_RR", "1.25"))
MAX_DECISION_OBSERVATIONS = int(os.getenv("AI_TRADER_MAX_DECISION_OBSERVATIONS", "10000"))
VIRTUAL_TRADE_MAX_BARS = int(os.getenv("AI_TRADER_VIRTUAL_TRADE_MAX_BARS", "12"))
PHASE6_BUCKET_MODE = "phase6_projection_engine"


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
        parsed = int(value)
        return parsed
    except Exception:
        return fallback


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def normalize_symbol(symbol: Any) -> str:
    raw = str(symbol or "MES1!").upper().strip()
    raw = raw.replace("CME_MINI:", "").replace("CME:", "").replace("BINANCE:", "").replace("COINBASE:", "")

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
    raw = str(timeframe or "1m").lower().strip()
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
    }
    return mapping.get(raw, raw or "1m")


def normalize_side(value: Any) -> str:
    raw = str(value or "").upper().strip()

    if raw in {"BUY", "BULL", "BULLISH", "LONG", "1"}:
        return "BUY"
    if raw in {"SELL", "BEAR", "BEARISH", "SHORT", "-1"}:
        return "SELL"

    return "HOLD"


def point_value(symbol: str) -> float:
    normalized = normalize_symbol(symbol)

    if normalized.startswith("MES"):
        return 5.0
    if normalized.startswith("ES"):
        return 50.0

    return 1.0


def safe_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def safe_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


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


def extract_score(value: Any, *paths: str, fallback: float = 0.0) -> float:
    return to_float(read_path(value, *paths, fallback=fallback), fallback)


def signed_move(side: str, start: float, end: float) -> float:
    if side == "BUY":
        return end - start
    if side == "SELL":
        return start - end
    return 0.0


def calculate_rr(side: str, entry: float, target: float, stop: float) -> float:
    if side not in {"BUY", "SELL"} or entry <= 0 or target <= 0 or stop <= 0:
        return 0.0

    reward = signed_move(side, entry, target)
    risk = -signed_move(side, entry, stop)

    if reward <= 0 or risk <= 0:
        return 0.0

    return reward / risk


def infer_side_from_target(entry: float, target: float, explicit_side: Any = None) -> str:
    side = normalize_side(explicit_side)

    if side != "HOLD":
        return side

    if entry > 0 and target > 0:
        if target > entry:
            return "BUY"
        if target < entry:
            return "SELL"

    return "HOLD"


def infer_stop(side: str, entry: float, target: float, stop: Any = None) -> float:
    parsed_stop = to_float(stop, 0.0)

    if parsed_stop > 0:
        return parsed_stop

    if side not in {"BUY", "SELL"} or entry <= 0 or target <= 0:
        return 0.0

    reward_points = abs(target - entry)
    risk_points = max(reward_points / 2.0, entry * 0.001)

    return entry - risk_points if side == "BUY" else entry + risk_points


def infer_target(side: str, entry: float, target: Any = None, signal: Optional[Dict[str, Any]] = None) -> float:
    parsed_target = to_float(target, 0.0)

    if parsed_target > 0:
        return parsed_target

    signal = safe_dict(signal)
    parsed_target = to_float(
        read_path(
            signal,
            "targetPrice",
            "target",
            "targetMl.targetPrice",
            "targetPlan.targetPrice",
            "finalTargetPrice",
            "overallTargetPrice",
            "ghostTargetPrice",
            "projectedTargetPrice",
            "takeProfitPrice",
            "tp1",
            fallback=0,
        ),
        0.0,
    )

    if parsed_target > 0:
        return parsed_target

    return 0.0


def load_memory() -> Dict[str, Any]:
    if not MEMORY_PATH.exists():
        return {
            "version": 2,
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
            "openTrades": [],
            "closedTrades": [],
            "decisionLog": [],
            "virtualOpenTrades": [],
            "virtualClosedTrades": [],
        }

    try:
        data = json.loads(MEMORY_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("memory file root must be object")
    except Exception:
        data = {}

    data.setdefault("version", 2)
    data.setdefault("createdAt", now_iso())
    data.setdefault("updatedAt", now_iso())
    data.setdefault("openTrades", [])
    data.setdefault("closedTrades", [])
    data.setdefault("decisionLog", [])
    data.setdefault("virtualOpenTrades", [])
    data.setdefault("virtualClosedTrades", [])

    for key in ["openTrades", "closedTrades", "decisionLog", "virtualOpenTrades", "virtualClosedTrades"]:
        if not isinstance(data.get(key), list):
            data[key] = []

    return data


def save_memory(memory: Dict[str, Any]) -> Dict[str, Any]:
    MEMORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    memory["version"] = max(to_int(memory.get("version"), 2), 2)
    memory["updatedAt"] = now_iso()
    memory["closedTrades"] = safe_list(memory.get("closedTrades"))[-MAX_CLOSED_TRADES:]
    memory["virtualClosedTrades"] = safe_list(memory.get("virtualClosedTrades"))[-MAX_CLOSED_TRADES:]
    memory["decisionLog"] = safe_list(memory.get("decisionLog"))[-MAX_DECISION_OBSERVATIONS:]
    memory["openTrades"] = safe_list(memory.get("openTrades"))
    memory["virtualOpenTrades"] = safe_list(memory.get("virtualOpenTrades"))[-250:]

    tmp_path = MEMORY_PATH.with_suffix(MEMORY_PATH.suffix + ".tmp")
    tmp_path.write_text(json.dumps(memory, indent=2, sort_keys=True), encoding="utf-8")
    tmp_path.replace(MEMORY_PATH)
    return memory



def trade_bucket(symbol: str, timeframe: str, side: str, confidence: float, context: Optional[Dict[str, Any]] = None) -> str:
    context = safe_dict(context)
    raw_mode = str(
        context.get("projectionEngineMode")
        or context.get("projectionEngineLabel")
        or context.get("mode")
        or context.get("entryMode")
        or "dashboard"
    ).lower()

    # Phase 6 fix:
    # Do NOT include confidence bands in the learning key. The old key split memory
    # across many buckets and made observations appear to rise/fall between refreshes.
    # Keep one stable bucket per symbol + timeframe + side + engine family.
    if "projection" in raw_mode or "target_guided" in raw_mode or context.get("aiPermission"):
        mode = PHASE6_BUCKET_MODE
    else:
        mode = raw_mode.replace(" ", "_")[:48] or "dashboard"

    return f"{normalize_symbol(symbol)}|{normalize_timeframe(timeframe)}|{side}|{mode}"



def summarize_closed_trades(closed_trades: List[Dict[str, Any]], bucket: Optional[str] = None) -> Dict[str, Any]:
    rows = [
        trade for trade in safe_list(closed_trades)
        if isinstance(trade, dict) and (bucket is None or trade.get("bucket") == bucket)
    ]

    total = len(rows)
    wins = sum(1 for trade in rows if to_float(trade.get("pnl"), 0.0) > 0)
    losses = sum(1 for trade in rows if to_float(trade.get("pnl"), 0.0) < 0)
    gross_profit = sum(max(0.0, to_float(trade.get("pnl"), 0.0)) for trade in rows)
    gross_loss = abs(sum(min(0.0, to_float(trade.get("pnl"), 0.0)) for trade in rows))
    avg_pnl = sum(to_float(trade.get("pnl"), 0.0) for trade in rows) / total if total else 0.0
    avg_r = sum(to_float(trade.get("rMultiple"), 0.0) for trade in rows) / total if total else 0.0
    win_rate = wins / total if total else 0.0
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else (gross_profit if gross_profit > 0 else 0.0)

    return {
        "samples": total,
        "wins": wins,
        "losses": losses,
        "winRate": round(win_rate, 4),
        "profitFactor": round(profit_factor, 4),
        "avgPnl": round(avg_pnl, 4),
        "avgR": round(avg_r, 4),
    }


def summarize_decision_log(decision_log: List[Dict[str, Any]], bucket: Optional[str] = None) -> Dict[str, Any]:
    rows = [
        decision for decision in safe_list(decision_log)
        if isinstance(decision, dict) and (bucket is None or decision.get("bucket") == bucket)
    ]

    total = len(rows)
    buy_bias = sum(1 for decision in rows if normalize_side(decision.get("rawDecision") or decision.get("decision")) == "BUY")
    sell_bias = sum(1 for decision in rows if normalize_side(decision.get("rawDecision") or decision.get("decision")) == "SELL")
    hold_count = sum(1 for decision in rows if normalize_side(decision.get("decision")) == "HOLD")
    trade_ready = sum(1 for decision in rows if bool(decision.get("allowedToTrade")))
    avg_confidence = sum(to_float(decision.get("confidence"), 0.0) for decision in rows) / total if total else 0.0

    return {
        "samples": total,
        "buyBias": buy_bias,
        "sellBias": sell_bias,
        "holdCount": hold_count,
        "tradeReadyCount": trade_ready,
        "avgConfidence": round(avg_confidence, 4),
    }


def ai_memory_status(memory: Dict[str, Any], bucket: Optional[str] = None) -> Dict[str, Any]:
    closed_source = combined_closed_trades(memory)
    closed_stats = summarize_closed_trades(closed_source, bucket=bucket)
    decision_stats = summarize_decision_log(memory.get("decisionLog", []), bucket=bucket)
    overall_closed = summarize_closed_trades(closed_source, bucket=None)
    overall_decisions = summarize_decision_log(memory.get("decisionLog", []), bucket=None)

    if closed_stats["samples"] >= 8:
        stage = "TRADE_LEARNING_READY"
        message = f"AI trade memory ready: {closed_stats['samples']} closed/virtual outcomes in this bucket"
    elif overall_closed["samples"] >= 8:
        stage = "GLOBAL_TRADE_LEARNING"
        message = f"AI using global outcome memory: {overall_closed['samples']} closed/virtual outcomes"
    elif decision_stats["samples"] >= 10:
        stage = "OBSERVATION_LEARNING_READY"
        message = f"AI observation memory ready: {decision_stats['samples']} live decisions in this setup"
    elif overall_decisions["samples"] >= 10:
        stage = "GLOBAL_OBSERVATION_LEARNING"
        message = f"AI observing globally: {overall_decisions['samples']} total live decisions"
    else:
        stage = "WARMING_UP"
        message = f"AI memory warming up: {overall_decisions['samples']} decision observations, {overall_closed['samples']} closed/virtual outcomes"

    return {
        "stage": stage,
        "message": message,
        "bucketDecisionStats": decision_stats,
        "overallDecisionStats": overall_decisions,
        "bucketClosedStats": closed_stats,
        "overallClosedStats": overall_closed,
    }


    if closed_stats["samples"] >= 8:
        stage = "TRADE_LEARNING_READY"
        message = f"AI trade memory ready: {closed_stats['samples']} closed trades in this bucket"
    elif overall_closed["samples"] >= 20:
        stage = "GLOBAL_TRADE_LEARNING"
        message = f"AI using global trade memory: {overall_closed['samples']} closed trades"
    elif decision_stats["samples"] >= 10:
        stage = "OBSERVATION_LEARNING"
        message = f"AI memory observing {decision_stats['samples']} live decisions in this setup"
    elif overall_decisions["samples"] >= 10:
        stage = "GLOBAL_OBSERVATION_LEARNING"
        message = f"AI memory observing {overall_decisions['samples']} total live decisions"
    else:
        stage = "WARMING_UP"
        message = f"AI memory warming up: {overall_decisions['samples']} decision observations, {overall_closed['samples']} closed trades"

    return {
        "stage": stage,
        "message": message,
        "bucketDecisionStats": decision_stats,
        "overallDecisionStats": overall_decisions,
        "bucketClosedStats": closed_stats,
        "overallClosedStats": overall_closed,
    }



def combined_closed_trades(memory: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        trade for trade in [
            *safe_list(memory.get("closedTrades")),
            *safe_list(memory.get("virtualClosedTrades")),
        ]
        if isinstance(trade, dict)
    ]


def decision_observation_key(decision: Dict[str, Any]) -> str:
    return "|".join([
        normalize_symbol(decision.get("symbol")),
        normalize_timeframe(decision.get("timeframe")),
        str(decision.get("rawDecision") or decision.get("decision") or "HOLD"),
        str(round(to_float(decision.get("entry"), 0.0), 2)),
        str(round(to_float(decision.get("target"), 0.0), 2)),
        str(round(to_float(decision.get("stop"), 0.0), 2)),
        str(round(to_float(decision.get("confidence"), 0.0), 1)),
    ])


def maybe_open_virtual_learning_trade(memory: Dict[str, Any], decision: Dict[str, Any]) -> None:
    side = normalize_side(decision.get("rawDecision") or decision.get("decision"))
    if side not in {"BUY", "SELL"}:
        return

    symbol = normalize_symbol(decision.get("symbol"))
    timeframe = normalize_timeframe(decision.get("timeframe"))
    entry = to_float(decision.get("entry"), 0.0)
    target = to_float(decision.get("target"), 0.0)
    stop = to_float(decision.get("stop"), 0.0)
    bucket = str(read_path(decision, "details.bucket", fallback=decision.get("bucket") or trade_bucket(symbol, timeframe, side, to_float(decision.get("confidence"), 0.0), read_path(decision, "details.context", fallback={}))))

    if entry <= 0 or target <= 0 or stop <= 0:
        return

    virtual_open = safe_list(memory.get("virtualOpenTrades"))
    for trade in virtual_open:
        if not isinstance(trade, dict):
            continue
        if normalize_symbol(trade.get("symbol")) != symbol:
            continue
        if normalize_timeframe(trade.get("timeframe")) != timeframe:
            continue
        if normalize_side(trade.get("side")) != side:
            continue
        if trade.get("bucket") != bucket:
            continue
        if abs(to_float(trade.get("entry"), 0.0) - entry) / max(entry, 0.000001) <= 0.0002:
            trade["lastSeenAt"] = now_iso()
            trade["seenCount"] = to_int(trade.get("seenCount"), 1) + 1
            trade["confidence"] = max(to_float(trade.get("confidence"), 0.0), to_float(decision.get("confidence"), 0.0))
            return

    virtual_open.append({
        "id": "VIRTUAL-" + build_trade_id(symbol, timeframe, side, decision.get("createdAt")),
        "symbol": symbol,
        "timeframe": timeframe,
        "side": side,
        "entry": round(entry, 8),
        "target": round(target, 8),
        "stop": round(stop, 8),
        "riskReward": decision.get("riskReward"),
        "confidence": decision.get("confidence"),
        "confidenceGrade": decision.get("confidenceGrade"),
        "bucket": bucket,
        "reason": decision.get("reason"),
        "entryTime": decision.get("createdAt") or now_iso(),
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
        "lastSeenAt": now_iso(),
        "seenCount": 1,
        "barsOpen": 0,
        "status": "VIRTUAL_OPEN",
        "dashboardOnly": True,
        "virtualLearningOnly": True,
    })
    memory["virtualOpenTrades"] = virtual_open


def remember_ai_decision(decision: Dict[str, Any]) -> None:
    try:
        memory = load_memory()
        decision_log = safe_list(memory.get("decisionLog"))

        bucket = str(read_path(decision, "details.bucket", fallback=decision.get("bucket") or ""))
        created_at = decision.get("createdAt") or now_iso()
        compact = {
            "id": f"DECISION-{normalize_symbol(decision.get('symbol'))}-{normalize_timeframe(decision.get('timeframe'))}-{created_at}",
            "observationKey": decision_observation_key(decision),
            "symbol": normalize_symbol(decision.get("symbol")),
            "timeframe": normalize_timeframe(decision.get("timeframe")),
            "decision": decision.get("decision"),
            "rawDecision": decision.get("rawDecision") or decision.get("decision"),
            "allowedToTrade": bool(decision.get("allowedToTrade")),
            "confidence": to_float(decision.get("confidence"), 0.0),
            "confidenceGrade": decision.get("confidenceGrade"),
            "entry": decision.get("entry"),
            "target": decision.get("target"),
            "stop": decision.get("stop"),
            "riskReward": decision.get("riskReward"),
            "bucket": bucket,
            "reason": decision.get("reason"),
            "projectionEngineMode": read_path(decision, "details.projectionEngine.mode", "details.context.projectionEngineMode", fallback=None),
            "aiPermission": read_path(decision, "details.projectionEngine.aiPermission", "details.context.aiPermission", fallback=None),
            "createdAt": created_at,
        }

        # Phase 6 fix:
        # Every decision call counts as an observation. We no longer collapse repeat
        # refreshes into one row, because that made the UI appear stuck at 0/1 samples.
        decision_log.append(compact)
        memory["decisionLog"] = decision_log[-MAX_DECISION_OBSERVATIONS:]
        maybe_open_virtual_learning_trade(memory, decision)
        save_memory(memory)
    except Exception:
        # Decision memory should never break the dashboard.
        return


        bucket = str(read_path(decision, "details.bucket", fallback=decision.get("bucket") or ""))
        compact = {
            "id": f"DECISION-{normalize_symbol(decision.get('symbol'))}-{normalize_timeframe(decision.get('timeframe'))}-{decision.get('createdAt')}",
            "symbol": normalize_symbol(decision.get("symbol")),
            "timeframe": normalize_timeframe(decision.get("timeframe")),
            "decision": decision.get("decision"),
            "rawDecision": decision.get("rawDecision"),
            "allowedToTrade": bool(decision.get("allowedToTrade")),
            "confidence": to_float(decision.get("confidence"), 0.0),
            "confidenceGrade": decision.get("confidenceGrade"),
            "entry": decision.get("entry"),
            "target": decision.get("target"),
            "stop": decision.get("stop"),
            "riskReward": decision.get("riskReward"),
            "bucket": bucket,
            "reason": decision.get("reason"),
            "createdAt": decision.get("createdAt") or now_iso(),
        }

        # Avoid repeated identical observations from the 15-second refresh loop.
        last = decision_log[-1] if decision_log and isinstance(decision_log[-1], dict) else {}
        duplicate_key = (
            last.get("symbol") == compact["symbol"]
            and last.get("timeframe") == compact["timeframe"]
            and last.get("decision") == compact["decision"]
            and last.get("rawDecision") == compact["rawDecision"]
            and round(to_float(last.get("entry"), 0.0), 2) == round(to_float(compact["entry"], 0.0), 2)
            and round(to_float(last.get("target"), 0.0), 2) == round(to_float(compact["target"], 0.0), 2)
            and round(to_float(last.get("confidence"), 0.0), 1) == round(to_float(compact["confidence"], 0.0), 1)
        )

        if duplicate_key:
            last["updatedAt"] = now_iso()
            last["repeatCount"] = to_int(last.get("repeatCount"), 1) + 1
            decision_log[-1] = last
        else:
            decision_log.append(compact)

        memory["decisionLog"] = decision_log[-MAX_CLOSED_TRADES:]
        save_memory(memory)
    except Exception:
        # Decision memory should never break the dashboard.
        return


def extract_directional_context(
    side: str,
    scorecards: Optional[Dict[str, Any]] = None,
    ghost_ml: Optional[Dict[str, Any]] = None,
    target_ml: Optional[Dict[str, Any]] = None,
    entry_ml: Optional[Dict[str, Any]] = None,
    nrtr_context: Optional[Dict[str, Any]] = None,
    signal: Optional[Dict[str, Any]] = None,
    unified_intelligence: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    scorecards = safe_dict(scorecards)
    ghost_ml = safe_dict(ghost_ml)
    target_ml = safe_dict(target_ml)
    entry_ml = safe_dict(entry_ml)
    nrtr_context = safe_dict(nrtr_context)
    signal = safe_dict(signal)
    unified_intelligence = safe_dict(unified_intelligence)

    bull_score = max(
        extract_score(scorecards, "bullScore", "main.bullScore", "overall.bullScore"),
        extract_score(signal, "bullScore", "bullishScore"),
        extract_score(unified_intelligence, "bullScore", "scorecards.bullScore"),
    )
    bear_score = max(
        extract_score(scorecards, "bearScore", "main.bearScore", "overall.bearScore"),
        extract_score(signal, "bearScore", "bearishScore"),
        extract_score(unified_intelligence, "bearScore", "scorecards.bearScore"),
    )

    target_confidence = max(
        extract_score(target_ml, "targetConfidence", "confidence", "targetPlan.targetConfidence"),
        extract_score(signal, "targetConfidence", "targetMl.targetConfidence"),
    )
    ghost_confidence = max(
        extract_score(ghost_ml, "ghostConfidence", "confidence", "mlConfidence", "baseConfidence"),
        extract_score(signal, "ghostConfidence", "confidence", "mlConfidence"),
    )
    entry_confidence = max(
        extract_score(entry_ml, "entryConfidence", "confidence"),
        extract_score(signal, "entryConfidence", "entryMlConfidence"),
    )

    target_ready = bool(
        read_path(target_ml, "targetMlReady", "ready", fallback=False)
        or read_path(signal, "targetMlReady", "targetMl.targetMlReady", fallback=False)
        or target_confidence > 0
    )
    ghost_ready = bool(
        read_path(ghost_ml, "mlReady", "ready", fallback=False)
        or read_path(signal, "mlReady", "ghostMlReady", fallback=False)
        or ghost_confidence > 0
    )

    nrtr_main = normalize_side(read_path(nrtr_context, "main.direction", "nrtrMain.direction", "direction", fallback=""))
    nrtr_mini1 = normalize_side(read_path(nrtr_context, "mini1.direction", "nrtrMini1.direction", fallback=""))
    nrtr_mini2 = normalize_side(read_path(nrtr_context, "mini2.direction", "nrtrMini2.direction", fallback=""))

    nrtr_agreements = sum(1 for direction in [nrtr_main, nrtr_mini1, nrtr_mini2] if direction == side)
    nrtr_conflicts = sum(1 for direction in [nrtr_main, nrtr_mini1, nrtr_mini2] if direction in {"BUY", "SELL"} and direction != side)

    directional_score = bull_score - bear_score if side == "BUY" else bear_score - bull_score

    return {
        "bullScore": round(bull_score, 4),
        "bearScore": round(bear_score, 4),
        "directionalScore": round(directional_score, 4),
        "targetConfidence": round(target_confidence, 4),
        "ghostConfidence": round(ghost_confidence, 4),
        "entryConfidence": round(entry_confidence, 4),
        "targetReady": target_ready,
        "ghostReady": ghost_ready,
        "nrtrAgreementCount": nrtr_agreements,
        "nrtrConflictCount": nrtr_conflicts,
        "nrtrMain": nrtr_main,
        "nrtrMini1": nrtr_mini1,
        "nrtrMini2": nrtr_mini2,
    }


def score_ai_decision(
    *,
    symbol: str,
    timeframe: str,
    side: str,
    entry: float,
    target: float,
    stop: float,
    risk_reward: float,
    scorecards: Optional[Dict[str, Any]] = None,
    ghost_ml: Optional[Dict[str, Any]] = None,
    target_ml: Optional[Dict[str, Any]] = None,
    entry_ml: Optional[Dict[str, Any]] = None,
    nrtr_context: Optional[Dict[str, Any]] = None,
    signal: Optional[Dict[str, Any]] = None,
    unified_intelligence: Optional[Dict[str, Any]] = None,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    memory = load_memory()
    context = safe_dict(context)

    directional = extract_directional_context(
        side=side,
        scorecards=scorecards,
        ghost_ml=ghost_ml,
        target_ml=target_ml,
        entry_ml=entry_ml,
        nrtr_context=nrtr_context,
        signal=signal,
        unified_intelligence=unified_intelligence,
    )

    base = 38.0

    if directional["targetReady"]:
        base += min(18.0, directional["targetConfidence"] * 0.18)
    if directional["ghostReady"]:
        base += min(14.0, directional["ghostConfidence"] * 0.14)
    if directional["entryConfidence"] > 0:
        base += min(18.0, directional["entryConfidence"] * 0.18)

    base += clamp(directional["directionalScore"] * 0.18, -18.0, 18.0)
    base += directional["nrtrAgreementCount"] * 4.0
    base -= directional["nrtrConflictCount"] * 5.0

    if risk_reward >= 2.0:
        base += 8.0
    elif risk_reward >= 1.5:
        base += 5.0
    elif risk_reward >= DEFAULT_MIN_RR:
        base += 2.0
    else:
        base -= 15.0

    if entry <= 0 or target <= 0 or stop <= 0:
        base -= 25.0

    bucket = trade_bucket(symbol, timeframe, side, base, context)
    closed_source = combined_closed_trades(memory)
    bucket_stats = summarize_closed_trades(closed_source, bucket=bucket)
    overall_stats = summarize_closed_trades(closed_source, bucket=None)

    learning_adjustment = 0.0

    if bucket_stats["samples"] >= 8:
        learning_adjustment += (bucket_stats["winRate"] - 0.50) * 30.0
        learning_adjustment += clamp((bucket_stats["profitFactor"] - 1.0) * 5.0, -8.0, 10.0)
        learning_adjustment += clamp(bucket_stats["avgR"] * 4.0, -8.0, 8.0)
    elif overall_stats["samples"] >= 20:
        learning_adjustment += (overall_stats["winRate"] - 0.50) * 18.0
        learning_adjustment += clamp((overall_stats["profitFactor"] - 1.0) * 3.0, -5.0, 6.0)
        learning_adjustment += clamp(overall_stats["avgR"] * 2.0, -4.0, 4.0)

    confidence = clamp(base + learning_adjustment, 0.0, 100.0)

    reasons: List[str] = []

    if directional["targetReady"]:
        reasons.append(f"Target ML active ({directional['targetConfidence']:.0f} confidence)")
    else:
        reasons.append("Target ML not ready")

    if directional["ghostReady"]:
        reasons.append(f"Ghost ML active ({directional['ghostConfidence']:.0f} confidence)")
    else:
        reasons.append("Ghost ML not ready")

    if directional["entryConfidence"] > 0:
        reasons.append(f"Entry ML confidence {directional['entryConfidence']:.0f}")

    if directional["directionalScore"] > 0:
        reasons.append(f"SMC/scorecard favors {side}")
    elif directional["directionalScore"] < 0:
        reasons.append("SMC/scorecard conflicts with trade side")

    if directional["nrtrAgreementCount"]:
        reasons.append(f"NRTR strategy context agrees on {directional['nrtrAgreementCount']} chart(s)")
    if directional["nrtrConflictCount"]:
        reasons.append(f"NRTR strategy context conflicts on {directional['nrtrConflictCount']} chart(s)")

    memory_status = ai_memory_status(memory, bucket=bucket)

    if bucket_stats["samples"] >= 8:
        reasons.append(f"Learned bucket win rate {bucket_stats['winRate'] * 100:.1f}% from {bucket_stats['samples']} closed trades")
    elif overall_stats["samples"] >= 20:
        reasons.append(f"Overall AI trade memory win rate {overall_stats['winRate'] * 100:.1f}% from {overall_stats['samples']} closed trades")
    else:
        reasons.append(memory_status["message"])

    return {
        "confidence": round(confidence, 2),
        "baseConfidence": round(base, 2),
        "learningAdjustment": round(learning_adjustment, 2),
        "confidenceGrade": confidence_grade(confidence),
        "bucket": bucket,
        "bucketStats": bucket_stats,
        "overallStats": overall_stats,
        "memoryStatus": memory_status,
        "directionalContext": directional,
        "reasons": reasons,
    }


def confidence_grade(confidence: float) -> str:
    if confidence >= 85:
        return "A+"
    if confidence >= 78:
        return "A"
    if confidence >= 70:
        return "B"
    if confidence >= 62:
        return "C"
    if confidence >= 50:
        return "D"
    return "F"


def choose_decision_side(
    *,
    entry: float,
    target: float,
    side: Any = None,
    signal: Optional[Dict[str, Any]] = None,
    scorecards: Optional[Dict[str, Any]] = None,
) -> str:
    explicit = normalize_side(side)
    if explicit != "HOLD":
        return explicit

    signal = safe_dict(signal)
    signal_side = normalize_side(read_path(signal, "signal", "type", "side", "direction", fallback=""))
    if signal_side != "HOLD":
        return signal_side

    inferred = infer_side_from_target(entry, target)
    if inferred != "HOLD":
        return inferred

    scorecards = safe_dict(scorecards)
    bull = extract_score(scorecards, "bullScore", "main.bullScore", "overall.bullScore")
    bear = extract_score(scorecards, "bearScore", "main.bearScore", "overall.bearScore")

    if bull > bear + 5:
        return "BUY"
    if bear > bull + 5:
        return "SELL"

    return "HOLD"


def build_trade_id(symbol: str, timeframe: str, side: str, entry_time: Optional[Any] = None) -> str:
    stamp = str(entry_time or now_iso()).replace(":", "-").replace(".", "-")
    return f"AI-{normalize_symbol(symbol)}-{normalize_timeframe(timeframe)}-{side}-{stamp}"


def get_ai_trader_decision(
    *,
    symbol: Any = "MES1!",
    timeframe: Any = "1m",
    currentPrice: Any = None,
    entryPrice: Any = None,
    targetPrice: Any = None,
    stopPrice: Any = None,
    side: Any = None,
    riskReward: Any = None,
    signal: Optional[Dict[str, Any]] = None,
    scorecards: Optional[Dict[str, Any]] = None,
    ghostMl: Optional[Dict[str, Any]] = None,
    targetMl: Optional[Dict[str, Any]] = None,
    entryMl: Optional[Dict[str, Any]] = None,
    nrtrContext: Optional[Dict[str, Any]] = None,
    unifiedIntelligence: Optional[Dict[str, Any]] = None,
    context: Optional[Dict[str, Any]] = None,
    minConfidence: Any = None,
    minRiskReward: Any = None,
    projectionEngine: Optional[Dict[str, Any]] = None,
    projectionEngineContext: Optional[Dict[str, Any]] = None,
    **_: Any,
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    signal = safe_dict(signal)
    context = safe_dict(context)

    current_price = to_float(currentPrice, 0.0)
    entry = to_float(entryPrice, 0.0)

    if entry <= 0:
        entry = to_float(
            read_path(
                signal,
                "entryPrice",
                "entry",
                "nrtrEntryPrice",
                "strategyEntryPrice",
                "price",
                "current",
                "close",
                fallback=current_price,
            ),
            current_price,
        )

    target = infer_target(normalize_side(side), entry, targetPrice, signal=signal)
    decision_side = choose_decision_side(entry=entry, target=target, side=side, signal=signal, scorecards=scorecards)
    stop = infer_stop(decision_side, entry, target, stopPrice)
    rr = to_float(riskReward, 0.0) or calculate_rr(decision_side, entry, target, stop)

    min_confidence = to_float(minConfidence, DEFAULT_MIN_CONFIDENCE)
    min_rr = to_float(minRiskReward, DEFAULT_MIN_RR)

    if decision_side not in {"BUY", "SELL"}:
        memory = load_memory()
        bucket = trade_bucket(normalized_symbol, normalized_timeframe, "HOLD", 0.0, context)
        memory_status = ai_memory_status(memory, bucket=bucket)
        decision_result = {
            "eventType": "AI_TRADER_DECISION",
            "status": "Waiting",
            "dashboardOnly": True,
            "brokerConnected": False,
            "allowedToTrade": False,
            "decision": "HOLD",
            "rawDecision": "HOLD",
            "confidence": 0,
            "confidenceGrade": "F",
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "entry": entry,
            "target": target,
            "stop": stop,
            "riskReward": rr,
            "currentPrice": current_price,
            "reason": "No clear BUY or SELL side was available.",
            "details": {
                "source": "dashboard_ai_trader",
                "noBroker": True,
                "bucket": bucket,
                "memoryStatus": memory_status,
                "directionalContext": {},
                "projectionEngine": safe_dict(_.get("projectionEngine") if isinstance(_, dict) else {}),
                "context": context,
            },
            "createdAt": now_iso(),
        }
        remember_ai_decision(decision_result)
        return decision_result

    score = score_ai_decision(
        symbol=normalized_symbol,
        timeframe=normalized_timeframe,
        side=decision_side,
        entry=entry,
        target=target,
        stop=stop,
        risk_reward=rr,
        scorecards=scorecards,
        ghost_ml=ghostMl,
        target_ml=targetMl,
        entry_ml=entryMl,
        nrtr_context=nrtrContext,
        signal=signal,
        unified_intelligence=unifiedIntelligence,
        context=context,
    )

    allowed = (
        decision_side in {"BUY", "SELL"}
        and entry > 0
        and target > 0
        and stop > 0
        and rr >= min_rr
        and score["confidence"] >= min_confidence
    )

    current_pnl = signed_move(decision_side, entry, current_price) * point_value(normalized_symbol) if current_price > 0 and entry > 0 else 0.0
    max_pnl = signed_move(decision_side, entry, target) * point_value(normalized_symbol) if target > 0 and entry > 0 else 0.0
    risk_pnl = -abs(signed_move(decision_side, entry, stop) * point_value(normalized_symbol)) if stop > 0 and entry > 0 else 0.0

    if not allowed:
        reason = "AI HOLD: requirements not met. " + " | ".join(score["reasons"][:4])
    else:
        reason = f"AI {decision_side}: " + " | ".join(score["reasons"][:4])

    decision_result = {
        "eventType": "AI_TRADER_DECISION",
        "status": "Ready" if allowed else "Waiting",
        "dashboardOnly": True,
        "brokerConnected": False,
        "allowedToTrade": bool(allowed),
        "decision": decision_side if allowed else "HOLD",
        "rawDecision": decision_side,
        "confidence": score["confidence"],
        "baseConfidence": score["baseConfidence"],
        "learningAdjustment": score["learningAdjustment"],
        "confidenceGrade": score["confidenceGrade"],
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "entry": round(entry, 8),
        "target": round(target, 8),
        "stop": round(stop, 8),
        "riskReward": round(rr, 4),
        "currentPrice": round(current_price, 8),
        "currentPnl": round(current_pnl, 4),
        "maxPnl": round(max_pnl, 4),
        "riskPnl": round(risk_pnl, 4),
        "pointValue": point_value(normalized_symbol),
        "reason": reason,
        "reasons": score["reasons"],
        "details": {
            "source": "dashboard_ai_trader",
            "noBroker": True,
            "bucket": score["bucket"],
            "bucketStats": score["bucketStats"],
            "overallStats": score["overallStats"],
            "memoryStatus": score["memoryStatus"],
            "directionalContext": score["directionalContext"],
            "projectionEngine": safe_dict(projectionEngine) or safe_dict(projectionEngineContext) or safe_dict(context.get("projectionEngine")),
            "context": context,
        },
        "createdAt": now_iso(),
    }

    remember_ai_decision(decision_result)
    return decision_result


def open_ai_trade(**payload: Any) -> Dict[str, Any]:
    decision = get_ai_trader_decision(**payload)

    if not decision.get("allowedToTrade"):
        return {
            **decision,
            "eventType": "AI_TRADER_OPEN",
            "status": "Rejected",
            "opened": False,
            "message": "AI trade was not opened because allowedToTrade is false.",
        }

    memory = load_memory()
    open_trades = safe_list(memory.get("openTrades"))
    symbol = normalize_symbol(decision.get("symbol"))
    timeframe = normalize_timeframe(decision.get("timeframe"))
    side = normalize_side(decision.get("rawDecision") or decision.get("decision"))
    entry_time = payload.get("entryTime") or decision.get("createdAt") or now_iso()

    existing = [
        trade for trade in open_trades
        if isinstance(trade, dict)
        and normalize_symbol(trade.get("symbol")) == symbol
        and normalize_timeframe(trade.get("timeframe")) == timeframe
        and normalize_side(trade.get("side")) == side
    ]

    if existing:
        return {
            "eventType": "AI_TRADER_OPEN",
            "status": "AlreadyOpen",
            "opened": False,
            "dashboardOnly": True,
            "brokerConnected": False,
            "trade": existing[-1],
            "decision": decision,
            "createdAt": now_iso(),
        }

    trade = {
        "id": build_trade_id(symbol, timeframe, side, entry_time),
        "symbol": symbol,
        "timeframe": timeframe,
        "side": side,
        "entryTime": entry_time,
        "entry": decision.get("entry"),
        "target": decision.get("target"),
        "stop": decision.get("stop"),
        "riskReward": decision.get("riskReward"),
        "confidence": decision.get("confidence"),
        "confidenceGrade": decision.get("confidenceGrade"),
        "currentPrice": decision.get("currentPrice"),
        "currentPnl": decision.get("currentPnl"),
        "maxPnl": decision.get("maxPnl"),
        "riskPnl": decision.get("riskPnl"),
        "bucket": read_path(decision, "details.bucket", fallback=""),
        "reason": decision.get("reason"),
        "dashboardOnly": True,
        "brokerConnected": False,
        "status": "OPEN",
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
        "sourceSnapshot": {
            "decision": decision,
            "payloadContext": safe_dict(payload.get("context")),
        },
    }

    open_trades.append(trade)
    memory["openTrades"] = open_trades
    save_memory(memory)

    return {
        "eventType": "AI_TRADER_OPEN",
        "status": "Open",
        "opened": True,
        "dashboardOnly": True,
        "brokerConnected": False,
        "trade": trade,
        "decision": decision,
        "summary": ai_trader_summary(symbol=symbol, timeframe=timeframe),
        "createdAt": now_iso(),
    }


def close_ai_trade(
    *,
    tradeId: Optional[str] = None,
    symbol: Any = "MES1!",
    timeframe: Any = "1m",
    side: Any = None,
    exitPrice: Any = None,
    exitTime: Any = None,
    exitReason: Optional[str] = None,
    currentPrice: Any = None,
    **_: Any,
) -> Dict[str, Any]:
    memory = load_memory()
    symbol = normalize_symbol(symbol)
    timeframe = normalize_timeframe(timeframe)
    close_side = normalize_side(side)
    price = to_float(exitPrice, 0.0) or to_float(currentPrice, 0.0)

    if price <= 0:
        return {
            "eventType": "AI_TRADER_CLOSE",
            "status": "Rejected",
            "closed": False,
            "message": "exitPrice/currentPrice is required to close an AI dashboard trade.",
            "createdAt": now_iso(),
        }

    open_trades = safe_list(memory.get("openTrades"))
    match_index = -1

    for index, trade in enumerate(open_trades):
        if not isinstance(trade, dict):
            continue

        if tradeId and trade.get("id") == tradeId:
            match_index = index
            break

        if tradeId:
            continue

        if normalize_symbol(trade.get("symbol")) != symbol:
            continue
        if normalize_timeframe(trade.get("timeframe")) != timeframe:
            continue
        if close_side != "HOLD" and normalize_side(trade.get("side")) != close_side:
            continue

        match_index = index

    if match_index < 0:
        return {
            "eventType": "AI_TRADER_CLOSE",
            "status": "NotFound",
            "closed": False,
            "message": "No matching open AI dashboard trade found.",
            "createdAt": now_iso(),
        }

    trade = dict(open_trades.pop(match_index))
    trade_side = normalize_side(trade.get("side"))
    entry = to_float(trade.get("entry"), 0.0)
    target = to_float(trade.get("target"), 0.0)
    stop = to_float(trade.get("stop"), 0.0)
    pnl = signed_move(trade_side, entry, price) * point_value(symbol) if entry > 0 else 0.0
    risk_points = abs(signed_move(trade_side, entry, stop))
    r_multiple = signed_move(trade_side, entry, price) / risk_points if risk_points > 0 else 0.0

    trade.update({
        "status": "CLOSED",
        "exitTime": exitTime or now_iso(),
        "exit": price,
        "exitPrice": price,
        "exitReason": exitReason or "manual_close",
        "pnl": round(pnl, 4),
        "rMultiple": round(r_multiple, 4),
        "result": "WIN" if pnl > 0 else ("LOSS" if pnl < 0 else "BREAKEVEN"),
        "updatedAt": now_iso(),
    })

    memory["openTrades"] = open_trades
    memory["closedTrades"] = safe_list(memory.get("closedTrades")) + [trade]
    save_memory(memory)

    return {
        "eventType": "AI_TRADER_CLOSE",
        "status": "Closed",
        "closed": True,
        "dashboardOnly": True,
        "brokerConnected": False,
        "trade": trade,
        "summary": ai_trader_summary(symbol=symbol, timeframe=timeframe),
        "createdAt": now_iso(),
    }


def candle_high_low_close(candle: Any) -> Tuple[float, float, float]:
    data = safe_dict(candle)
    high = to_float(data.get("high", data.get("h")), 0.0)
    low = to_float(data.get("low", data.get("l")), 0.0)
    close = to_float(data.get("close", data.get("c")), 0.0)
    return high, low, close


def evaluate_ai_trades(
    *,
    symbol: Any = "MES1!",
    timeframe: Any = "1m",
    currentPrice: Any = None,
    candles: Optional[List[Any]] = None,
    **_: Any,
) -> Dict[str, Any]:
    memory = load_memory()
    symbol = normalize_symbol(symbol)
    timeframe = normalize_timeframe(timeframe)
    current = to_float(currentPrice, 0.0)
    candles = safe_list(candles)

    latest_high = latest_low = latest_close = current

    if candles:
        high, low, close = candle_high_low_close(candles[-1])
        latest_high = high or current
        latest_low = low or current
        latest_close = close or current

    if current <= 0:
        current = latest_close

    def evaluate_trade_list(trades: List[Any], virtual: bool = False) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        closed_rows: List[Dict[str, Any]] = []
        still_rows: List[Dict[str, Any]] = []

        for trade in trades:
            if not isinstance(trade, dict):
                continue

            if normalize_symbol(trade.get("symbol")) != symbol or normalize_timeframe(trade.get("timeframe")) != timeframe:
                still_rows.append(trade)
                continue

            side = normalize_side(trade.get("side"))
            target = to_float(trade.get("target"), 0.0)
            stop = to_float(trade.get("stop"), 0.0)
            entry = to_float(trade.get("entry"), 0.0)
            exit_price = 0.0
            exit_reason = ""
            bars_open = to_int(trade.get("barsOpen"), 0) + 1

            if side == "BUY":
                if target > 0 and latest_high >= target:
                    exit_price = target
                    exit_reason = "target_hit"
                elif stop > 0 and latest_low <= stop:
                    exit_price = stop
                    exit_reason = "stop_hit"
            elif side == "SELL":
                if target > 0 and latest_low <= target:
                    exit_price = target
                    exit_reason = "target_hit"
                elif stop > 0 and latest_high >= stop:
                    exit_price = stop
                    exit_reason = "stop_hit"

            if virtual and exit_price <= 0 and bars_open >= VIRTUAL_TRADE_MAX_BARS and current > 0:
                exit_price = current
                exit_reason = "virtual_timeout"

            if exit_price > 0:
                pnl = signed_move(side, entry, exit_price) * point_value(symbol) if entry > 0 else 0.0
                risk_points = abs(signed_move(side, entry, stop))
                r_multiple = signed_move(side, entry, exit_price) / risk_points if risk_points > 0 else 0.0
                trade.update({
                    "status": "VIRTUAL_CLOSED" if virtual else "CLOSED",
                    "exit": exit_price,
                    "exitPrice": exit_price,
                    "exitReason": exit_reason,
                    "exitTime": now_iso(),
                    "pnl": round(pnl, 4),
                    "rMultiple": round(r_multiple, 4),
                    "result": "WIN" if pnl > 0 else ("LOSS" if pnl < 0 else "BREAKEVEN"),
                    "barsOpen": bars_open,
                    "updatedAt": now_iso(),
                    "virtualLearningOnly": bool(virtual),
                })
                closed_rows.append(trade)
            else:
                trade["barsOpen"] = bars_open
                trade["currentPrice"] = current
                trade["currentPnl"] = round(signed_move(side, entry, current) * point_value(symbol), 4) if entry > 0 and current > 0 else 0.0
                trade["updatedAt"] = now_iso()
                still_rows.append(trade)

        return closed_rows, still_rows

    closed, still_open = evaluate_trade_list(safe_list(memory.get("openTrades")), virtual=False)
    virtual_closed, virtual_still_open = evaluate_trade_list(safe_list(memory.get("virtualOpenTrades")), virtual=True)

    memory["openTrades"] = still_open
    memory["closedTrades"] = safe_list(memory.get("closedTrades")) + closed
    memory["virtualOpenTrades"] = virtual_still_open
    memory["virtualClosedTrades"] = safe_list(memory.get("virtualClosedTrades")) + virtual_closed
    save_memory(memory)

    return {
        "eventType": "AI_TRADER_EVALUATE",
        "status": "Evaluated",
        "dashboardOnly": True,
        "brokerConnected": False,
        "symbol": symbol,
        "timeframe": timeframe,
        "closedCount": len(closed),
        "virtualClosedCount": len(virtual_closed),
        "openCount": len(still_open),
        "virtualOpenCount": len(virtual_still_open),
        "closedTrades": closed,
        "virtualClosedTrades": virtual_closed,
        "openTrades": [
            trade for trade in still_open
            if isinstance(trade, dict)
            and normalize_symbol(trade.get("symbol")) == symbol
            and normalize_timeframe(trade.get("timeframe")) == timeframe
        ],
        "virtualOpenTrades": [
            trade for trade in virtual_still_open
            if isinstance(trade, dict)
            and normalize_symbol(trade.get("symbol")) == symbol
            and normalize_timeframe(trade.get("timeframe")) == timeframe
        ],
        "summary": ai_trader_summary(symbol=symbol, timeframe=timeframe),
        "createdAt": now_iso(),
    }


    latest_high = latest_low = latest_close = current

    if candles:
        high, low, close = candle_high_low_close(candles[-1])
        latest_high = high or current
        latest_low = low or current
        latest_close = close or current

    if current <= 0:
        current = latest_close

    closed: List[Dict[str, Any]] = []
    still_open: List[Dict[str, Any]] = []

    for trade in safe_list(memory.get("openTrades")):
        if not isinstance(trade, dict):
            continue

        if normalize_symbol(trade.get("symbol")) != symbol or normalize_timeframe(trade.get("timeframe")) != timeframe:
            still_open.append(trade)
            continue

        side = normalize_side(trade.get("side"))
        target = to_float(trade.get("target"), 0.0)
        stop = to_float(trade.get("stop"), 0.0)
        exit_price = 0.0
        exit_reason = ""

        if side == "BUY":
            if target > 0 and latest_high >= target:
                exit_price = target
                exit_reason = "target_hit"
            elif stop > 0 and latest_low <= stop:
                exit_price = stop
                exit_reason = "stop_hit"
        elif side == "SELL":
            if target > 0 and latest_low <= target:
                exit_price = target
                exit_reason = "target_hit"
            elif stop > 0 and latest_high >= stop:
                exit_price = stop
                exit_reason = "stop_hit"

        if exit_price > 0:
            entry = to_float(trade.get("entry"), 0.0)
            pnl = signed_move(side, entry, exit_price) * point_value(symbol) if entry > 0 else 0.0
            risk_points = abs(signed_move(side, entry, stop))
            r_multiple = signed_move(side, entry, exit_price) / risk_points if risk_points > 0 else 0.0
            trade.update({
                "status": "CLOSED",
                "exit": exit_price,
                "exitPrice": exit_price,
                "exitReason": exit_reason,
                "exitTime": now_iso(),
                "pnl": round(pnl, 4),
                "rMultiple": round(r_multiple, 4),
                "result": "WIN" if pnl > 0 else ("LOSS" if pnl < 0 else "BREAKEVEN"),
                "updatedAt": now_iso(),
            })
            closed.append(trade)
        else:
            entry = to_float(trade.get("entry"), 0.0)
            trade["currentPrice"] = current
            trade["currentPnl"] = round(signed_move(side, entry, current) * point_value(symbol), 4) if entry > 0 and current > 0 else 0.0
            trade["updatedAt"] = now_iso()
            still_open.append(trade)

    memory["openTrades"] = still_open
    memory["closedTrades"] = safe_list(memory.get("closedTrades")) + closed
    save_memory(memory)

    return {
        "eventType": "AI_TRADER_EVALUATE",
        "status": "Evaluated",
        "dashboardOnly": True,
        "brokerConnected": False,
        "symbol": symbol,
        "timeframe": timeframe,
        "closedCount": len(closed),
        "openCount": len(still_open),
        "closedTrades": closed,
        "openTrades": [
            trade for trade in still_open
            if isinstance(trade, dict)
            and normalize_symbol(trade.get("symbol")) == symbol
            and normalize_timeframe(trade.get("timeframe")) == timeframe
        ],
        "summary": ai_trader_summary(symbol=symbol, timeframe=timeframe),
        "createdAt": now_iso(),
    }


def ai_trader_summary(symbol: Any = "", timeframe: Any = "") -> Dict[str, Any]:
    memory = load_memory()
    normalized_symbol = normalize_symbol(symbol) if symbol else ""
    normalized_timeframe = normalize_timeframe(timeframe) if timeframe else ""

    def matches(trade: Dict[str, Any]) -> bool:
        if normalized_symbol and normalize_symbol(trade.get("symbol")) != normalized_symbol:
            return False
        if normalized_timeframe and normalize_timeframe(trade.get("timeframe")) != normalized_timeframe:
            return False
        return True

    open_trades = [trade for trade in safe_list(memory.get("openTrades")) if isinstance(trade, dict) and matches(trade)]
    virtual_open_trades = [trade for trade in safe_list(memory.get("virtualOpenTrades")) if isinstance(trade, dict) and matches(trade)]
    real_closed_trades = [trade for trade in safe_list(memory.get("closedTrades")) if isinstance(trade, dict) and matches(trade)]
    virtual_closed_trades = [trade for trade in safe_list(memory.get("virtualClosedTrades")) if isinstance(trade, dict) and matches(trade)]
    closed_trades = real_closed_trades + virtual_closed_trades
    stats = summarize_closed_trades(closed_trades)
    memory_status = ai_memory_status(memory)

    return {
        "eventType": "AI_TRADER_SUMMARY",
        "status": "Ready",
        "dashboardOnly": True,
        "brokerConnected": False,
        "symbol": normalized_symbol or "ALL",
        "timeframe": normalized_timeframe or "ALL",
        "openTrades": open_trades[-20:],
        "virtualOpenTrades": virtual_open_trades[-20:],
        "closedTrades": closed_trades[-20:],
        "realClosedTrades": real_closed_trades[-20:],
        "virtualClosedTrades": virtual_closed_trades[-20:],
        "recentClosedTrades": closed_trades[-10:],
        "openCount": len(open_trades),
        "virtualOpenCount": len(virtual_open_trades),
        "closedCount": len(closed_trades),
        "realClosedCount": len(real_closed_trades),
        "virtualClosedCount": len(virtual_closed_trades),
        "stats": stats,
        "decisionStats": memory_status["overallDecisionStats"],
        "memoryStatus": memory_status,
        "memoryPath": str(MEMORY_PATH),
        "phase6MemoryFix": True,
        "createdAt": now_iso(),
    }


    def matches(trade: Dict[str, Any]) -> bool:
        if normalized_symbol and normalize_symbol(trade.get("symbol")) != normalized_symbol:
            return False
        if normalized_timeframe and normalize_timeframe(trade.get("timeframe")) != normalized_timeframe:
            return False
        return True

    open_trades = [trade for trade in safe_list(memory.get("openTrades")) if isinstance(trade, dict) and matches(trade)]
    closed_trades = [trade for trade in safe_list(memory.get("closedTrades")) if isinstance(trade, dict) and matches(trade)]
    stats = summarize_closed_trades(closed_trades)
    memory_status = ai_memory_status(memory)

    return {
        "eventType": "AI_TRADER_SUMMARY",
        "status": "Ready",
        "dashboardOnly": True,
        "brokerConnected": False,
        "symbol": normalized_symbol or "ALL",
        "timeframe": normalized_timeframe or "ALL",
        "openTrades": open_trades[-20:],
        "closedTrades": closed_trades[-20:],
        "recentClosedTrades": closed_trades[-10:],
        "openCount": len(open_trades),
        "closedCount": len(closed_trades),
        "stats": stats,
        "decisionStats": memory_status["overallDecisionStats"],
        "memoryStatus": memory_status,
        "memoryPath": str(MEMORY_PATH),
        "createdAt": now_iso(),
    }


def ai_trader_export() -> Dict[str, Any]:
    memory = load_memory()
    return {
        "eventType": "AI_TRADER_EXPORT",
        "status": "Ready",
        "dashboardOnly": True,
        "brokerConnected": False,
        "memory": memory,
        "summary": ai_trader_summary(),
        "createdAt": now_iso(),
    }


def reset_ai_trader_memory(symbol: Optional[Any] = None, timeframe: Optional[Any] = None) -> Dict[str, Any]:
    if not symbol and not timeframe:
        memory = {
            "version": 1,
            "createdAt": now_iso(),
            "updatedAt": now_iso(),
            "openTrades": [],
            "closedTrades": [],
            "decisionLog": [],
            "virtualOpenTrades": [],
            "virtualClosedTrades": [],
        }
        save_memory(memory)
        return {
            "eventType": "AI_TRADER_RESET",
            "status": "Reset",
            "dashboardOnly": True,
            "brokerConnected": False,
            "createdAt": now_iso(),
        }

    memory = load_memory()
    normalized_symbol = normalize_symbol(symbol) if symbol else ""
    normalized_timeframe = normalize_timeframe(timeframe) if timeframe else ""

    def keep(trade: Any) -> bool:
        if not isinstance(trade, dict):
            return False
        if normalized_symbol and normalize_symbol(trade.get("symbol")) != normalized_symbol:
            return True
        if normalized_timeframe and normalize_timeframe(trade.get("timeframe")) != normalized_timeframe:
            return True
        return False

    memory["openTrades"] = [trade for trade in safe_list(memory.get("openTrades")) if keep(trade)]
    memory["closedTrades"] = [trade for trade in safe_list(memory.get("closedTrades")) if keep(trade)]
    memory["decisionLog"] = [trade for trade in safe_list(memory.get("decisionLog")) if keep(trade)]
    memory["virtualOpenTrades"] = [trade for trade in safe_list(memory.get("virtualOpenTrades")) if keep(trade)]
    memory["virtualClosedTrades"] = [trade for trade in safe_list(memory.get("virtualClosedTrades")) if keep(trade)]
    save_memory(memory)

    return {
        "eventType": "AI_TRADER_RESET",
        "status": "PartialReset",
        "dashboardOnly": True,
        "brokerConnected": False,
        "symbol": normalized_symbol or "ALL",
        "timeframe": normalized_timeframe or "ALL",
        "createdAt": now_iso(),
    }
