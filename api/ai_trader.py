from __future__ import annotations

import json
import math
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


MEMORY_PATH = Path(os.getenv("AI_TRADER_MEMORY_PATH", str(Path(__file__).with_name("ai_trader_memory.json"))))
MAX_CLOSED_TRADES = int(os.getenv("AI_TRADER_MAX_CLOSED_TRADES", "2500"))
DEFAULT_MIN_CONFIDENCE = float(os.getenv("AI_TRADER_MIN_CONFIDENCE", "62"))
DEFAULT_MIN_RR = float(os.getenv("AI_TRADER_MIN_RR", "1.25"))
AI_TRADER_LEARNING_MODE = os.getenv("AI_TRADER_LEARNING_MODE", "true").lower().strip() in {"1", "true", "yes", "on"}
AI_TRADER_REQUIRE_CONFIDENCE_IN_LEARNING_MODE = os.getenv("AI_TRADER_REQUIRE_CONFIDENCE_IN_LEARNING_MODE", "false").lower().strip() in {"1", "true", "yes", "on"}
AI_TRADER_REQUIRE_RR_IN_LEARNING_MODE = os.getenv("AI_TRADER_REQUIRE_RR_IN_LEARNING_MODE", "false").lower().strip() in {"1", "true", "yes", "on"}
AI_TRADER_REQUIRE_TARGET_STOP_IN_LEARNING_MODE = os.getenv("AI_TRADER_REQUIRE_TARGET_STOP_IN_LEARNING_MODE", "false").lower().strip() in {"1", "true", "yes", "on"}
MAX_DECISION_OBSERVATIONS = int(os.getenv("AI_TRADER_MAX_DECISION_OBSERVATIONS", "1500"))
VIRTUAL_TRADE_MAX_BARS = int(os.getenv("AI_TRADER_VIRTUAL_TRADE_MAX_BARS", "12"))
PHASE6_BUCKET_MODE = "phase6_projection_engine"
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
AI_TRADER_STORAGE = os.getenv("AI_TRADER_STORAGE", "json").lower().strip()
AI_TRADER_USER_KEY = os.getenv("AI_TRADER_USER_KEY", "default").strip() or "default"
AI_TRADER_ALLOW_MULTIPLE_OPEN_TRADES = os.getenv("AI_TRADER_ALLOW_MULTIPLE_OPEN_TRADES", "false").lower().strip() in {"1", "true", "yes", "on"}
AI_TRADER_OPEN_LOAD_LIMIT = int(os.getenv("AI_TRADER_OPEN_LOAD_LIMIT", "50"))
AI_TRADER_CLOSED_LOAD_LIMIT = int(os.getenv("AI_TRADER_CLOSED_LOAD_LIMIT", "500"))
AI_TRADER_DECISION_LOAD_LIMIT = int(os.getenv("AI_TRADER_DECISION_LOAD_LIMIT", "1200"))
AI_TRADER_VIRTUAL_OPEN_LOAD_LIMIT = int(os.getenv("AI_TRADER_VIRTUAL_OPEN_LOAD_LIMIT", "120"))
AI_TRADER_VIRTUAL_CLOSED_LOAD_LIMIT = int(os.getenv("AI_TRADER_VIRTUAL_CLOSED_LOAD_LIMIT", "500"))
SUPABASE_BATCH_SIZE = int(os.getenv("AI_TRADER_SUPABASE_BATCH_SIZE", "250"))
MEMORY_LOCK = threading.RLock()




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



def collect_rr_target_candidates(
    *,
    signal: Optional[Dict[str, Any]] = None,
    target_ml: Optional[Dict[str, Any]] = None,
    projection_engine: Optional[Dict[str, Any]] = None,
    projection_engine_context: Optional[Dict[str, Any]] = None,
    context: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Collect target candidates that can be used only by the AI trade planner.

    This does not rewrite Target ML memory. It lets AI Trader select a farther
    valid target when the live Target ML destination is too close to satisfy
    the user's minimum RR.
    """
    signal = safe_dict(signal)
    target_ml = safe_dict(target_ml)
    projection_engine = safe_dict(projection_engine)
    projection_engine_context = safe_dict(projection_engine_context)
    context = safe_dict(context)

    roots = [
        projection_engine,
        projection_engine_context,
        safe_dict(context.get("projectionEngine")),
        safe_dict(context.get("projectionEngineContext")),
        safe_dict(signal.get("projectionEngine")),
        safe_dict(signal.get("unifiedProjectionEngine")),
        target_ml,
        safe_dict(signal.get("targetMl")),
        safe_dict(signal.get("targetPlan")),
        signal,
    ]

    list_paths = [
        "target.candidates",
        "targetPlan.candidates",
        "targetMl.candidates",
        "candidates",
        "ghostPath.candles",
        "ghostCandles",
        "ghosts",
    ]

    direct_paths = [
        "activeTargetPrice",
        "target.price",
        "targetPrice",
        "targetPlan.targetPrice",
        "targetPlan.finalTargetPrice",
        "targetMl.targetPrice",
        "targetMl.finalTargetPrice",
        "finalTargetPrice",
        "overallTargetPrice",
        "ghostOverlayTargetPrice",
        "ghostPath.targetPrice",
        "ghostPath.endPrice",
    ]

    rows: List[Dict[str, Any]] = []

    def add_row(price: Any, source: Any = None, confidence: Any = 0, raw: Optional[Dict[str, Any]] = None) -> None:
        parsed = to_float(price, 0.0)
        if parsed <= 0:
            return
        rows.append(
            {
                "price": parsed,
                "source": str(source or "unknown"),
                "confidence": clamp(to_float(confidence, 0.0), 0.0, 100.0),
                "raw": raw or {},
            }
        )

    for root in roots:
        if not root:
            continue

        for path in direct_paths:
            price = read_path(root, path, fallback=None)
            if price is not None:
                add_row(
                    price,
                    read_path(root, "activeTargetSource", "target.source", "source", fallback=path),
                    read_path(root, "activeTargetConfidence", "target.confidence", "targetConfidence", "confidence", fallback=0),
                    {"path": path},
                )

        for path in list_paths:
            items = safe_list(read_path(root, path, fallback=[]))
            for item in items[:80]:
                item = safe_dict(item)
                if not item:
                    continue
                price = read_path(
                    item,
                    "price",
                    "targetPrice",
                    "target",
                    "finalTargetPrice",
                    "overallTargetPrice",
                    "ghostTargetPrice",
                    "projectedTargetPrice",
                    "close",
                    "c",
                    fallback=0,
                )
                add_row(
                    price,
                    read_path(item, "source", "targetSource", "type", "label", fallback=path),
                    read_path(item, "confidence", "targetConfidence", "score", "learnedQuality", "quality", fallback=0),
                    item,
                )

    deduped: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        key = f"{round(to_float(row.get('price'), 0.0), 4)}::{row.get('source')}"
        existing = deduped.get(key)
        if existing is None or to_float(row.get("confidence"), 0.0) > to_float(existing.get("confidence"), 0.0):
            deduped[key] = row

    return list(deduped.values())


def build_rr_qualified_trade_plan(
    *,
    symbol: str,
    timeframe: str,
    side: str,
    entry: float,
    target: float,
    stop: float,
    min_rr: float,
    signal: Optional[Dict[str, Any]] = None,
    target_ml: Optional[Dict[str, Any]] = None,
    ghost_ml: Optional[Dict[str, Any]] = None,
    projection_engine: Optional[Dict[str, Any]] = None,
    projection_engine_context: Optional[Dict[str, Any]] = None,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Pick the closest valid AI trade target that satisfies minimum RR.

    Target ML can correctly identify a near destination, but that can create a
    trade plan with bad RR. This helper keeps the live Target ML destination
    intact while allowing AI Trader to create a separate RR-qualified paper
    trade target.
    """
    base_rr = calculate_rr(side, entry, target, stop)
    risk_points = -signed_move(side, entry, stop) if side in {"BUY", "SELL"} else 0.0
    reward_points = signed_move(side, entry, target) if side in {"BUY", "SELL"} else 0.0

    required_reward = max(risk_points * max(min_rr, 0.01), 0.0)
    required_target = 0.0
    if side == "BUY" and entry > 0 and required_reward > 0:
        required_target = entry + required_reward
    elif side == "SELL" and entry > 0 and required_reward > 0:
        required_target = entry - required_reward

    plan = {
        "used": False,
        "upgraded": False,
        "method": "original_target",
        "originalTarget": round(target, 8),
        "target": round(target, 8),
        "stop": round(stop, 8),
        "riskReward": round(base_rr, 4),
        "originalRiskReward": round(base_rr, 4),
        "riskPoints": round(risk_points, 8),
        "rewardPoints": round(reward_points, 8),
        "requiredTarget": round(required_target, 8) if required_target > 0 else None,
        "requiredRewardPoints": round(required_reward, 8),
        "source": "original_target",
        "candidatesChecked": 0,
        "reason": "Original target already satisfies minimum RR." if base_rr >= min_rr else "Original target is too close for minimum RR.",
    }

    if side not in {"BUY", "SELL"} or entry <= 0 or target <= 0 or stop <= 0 or risk_points <= 0:
        plan["reason"] = "RR builder skipped because side, entry, target, or stop is invalid."
        return plan

    if base_rr >= min_rr:
        return plan

    candidates = collect_rr_target_candidates(
        signal=signal,
        target_ml=target_ml,
        projection_engine=projection_engine,
        projection_engine_context=projection_engine_context,
        context=context,
    )

    valid: List[Dict[str, Any]] = []
    for row in candidates:
        candidate_price = to_float(row.get("price"), 0.0)
        candidate_rr = calculate_rr(side, entry, candidate_price, stop)
        candidate_reward = signed_move(side, entry, candidate_price)
        if candidate_price <= 0 or candidate_reward <= 0:
            continue
        if candidate_rr < min_rr:
            continue

        confidence = to_float(row.get("confidence"), 0.0)
        distance_over_required = abs(candidate_reward - required_reward)
        closeness_penalty = distance_over_required / max(abs(entry) * 0.001, 0.01)
        source_text = str(row.get("source") or "unknown").lower()
        source_bonus = 10.0 if "real_target" in source_text or "target_ml" in source_text else 5.0 if "ghost" in source_text else 0.0

        valid.append(
            {
                **row,
                "riskReward": candidate_rr,
                "rewardPoints": candidate_reward,
                "rank": confidence + source_bonus - closeness_penalty,
            }
        )

    plan["candidatesChecked"] = len(candidates)

    if valid:
        valid.sort(key=lambda row: to_float(row.get("rank"), 0.0), reverse=True)
        best = valid[0]
        upgraded_target = to_float(best.get("price"), target)
        upgraded_rr = calculate_rr(side, entry, upgraded_target, stop)
        upgraded_reward = signed_move(side, entry, upgraded_target)
        return {
            **plan,
            "used": True,
            "upgraded": True,
            "method": "candidate_rr_target",
            "target": round(upgraded_target, 8),
            "riskReward": round(upgraded_rr, 4),
            "rewardPoints": round(upgraded_reward, 8),
            "source": str(best.get("source") or "candidate"),
            "selectedCandidateConfidence": round(to_float(best.get("confidence"), 0.0), 4),
            "reason": f"AI RR builder selected a farther candidate target to satisfy {min_rr:.2f}R.",
        }

    allow_constructed = str(os.getenv("AI_TRADER_ENABLE_RR_RESCUE_TARGET", "true")).lower() not in {"0", "false", "no", "off"}
    target_conf = max(
        extract_score(target_ml, "targetConfidence", "confidence"),
        extract_score(signal, "targetConfidence", "targetMl.targetConfidence"),
    )
    ghost_conf = max(
        extract_score(ghost_ml, "confidence", "ghostConfidence"),
        extract_score(signal, "ghostConfidence", "confidence"),
    )
    max_constructed_move_pct = to_float(os.getenv("AI_TRADER_MAX_RR_RESCUE_MOVE_PCT", "0.004"), 0.004)
    constructed_distance_pct = abs(required_target - entry) / max(entry, 0.000001) if required_target > 0 else 999.0

    if allow_constructed and required_target > 0 and target_conf >= 55 and ghost_conf >= 55 and constructed_distance_pct <= max_constructed_move_pct:
        upgraded_rr = calculate_rr(side, entry, required_target, stop)
        return {
            **plan,
            "used": True,
            "upgraded": True,
            "method": "constructed_min_rr_target",
            "target": round(required_target, 8),
            "riskReward": round(upgraded_rr, 4),
            "rewardPoints": round(required_reward, 8),
            "source": "ai_rr_minimum_target",
            "targetConfidence": round(target_conf, 4),
            "ghostConfidence": round(ghost_conf, 4),
            "reason": f"AI RR builder created a separate paper-trade target at the minimum {min_rr:.2f}R because live Target ML was too close.",
        }

    return {
        **plan,
        "reason": "No farther valid target candidate met minimum RR; AI should keep holding.",
        "targetConfidence": round(target_conf, 4),
        "ghostConfidence": round(ghost_conf, 4),
    }




def supabase_enabled() -> bool:
    return (
        AI_TRADER_STORAGE == "supabase"
        and bool(SUPABASE_URL)
        and bool(SUPABASE_SERVICE_ROLE_KEY)
    )


def supabase_headers(prefer: Optional[str] = None) -> Dict[str, str]:
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def supabase_url(table: str, query: str = "") -> str:
    base = f"{SUPABASE_URL}/rest/v1/{table}"
    return f"{base}?{query}" if query else base


def supabase_request(method: str, table: str, query: str = "", body: Any = None, prefer: Optional[str] = None) -> Any:
    if not supabase_enabled():
        raise RuntimeError("Supabase storage is not enabled")

    data = None
    if body is not None:
        data = json.dumps(body, default=str).encode("utf-8")

    request = urllib.request.Request(
        supabase_url(table, query),
        data=data,
        method=method.upper(),
        headers=supabase_headers(prefer=prefer),
    )

    with urllib.request.urlopen(request, timeout=15) as response:
        raw = response.read().decode("utf-8")
        if not raw:
            return None
        return json.loads(raw)


def iso_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def db_number(value: Any) -> Optional[float]:
    number = to_float(value, float("nan"))
    return number if math.isfinite(number) else None


def db_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except Exception:
        return None


def row_to_trade(row: Dict[str, Any], virtual: bool = False) -> Dict[str, Any]:
    trade = dict(row.get("source_snapshot") or {}) if isinstance(row.get("source_snapshot"), dict) else {}
    trade.update({
        "id": row.get("id"),
        "symbol": row.get("symbol"),
        "timeframe": row.get("timeframe"),
        "side": row.get("side"),
        "entry": to_float(row.get("entry"), 0.0),
        "target": to_float(row.get("target"), 0.0),
        "stop": to_float(row.get("stop"), 0.0),
        "riskReward": to_float(row.get("risk_reward"), 0.0),
        "confidence": to_float(row.get("confidence"), 0.0),
        "confidenceGrade": row.get("confidence_grade"),
        "currentPrice": to_float(row.get("current_price"), 0.0),
        "currentPnl": to_float(row.get("current_pnl"), 0.0),
        "maxPnl": to_float(row.get("max_pnl"), 0.0),
        "minPnl": to_float(row.get("min_pnl"), 0.0),
        "riskPnl": to_float(row.get("risk_pnl"), 0.0),
        "bucket": row.get("bucket"),
        "reason": row.get("reason"),
        "status": row.get("status"),
        "dashboardOnly": bool(row.get("dashboard_only", True)),
        "brokerConnected": bool(row.get("broker_connected", False)),
        "sourceSnapshot": row.get("source_snapshot") or {},
        "entryTime": row.get("entry_time"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    })

    if row.get("exit") is not None or row.get("exit_price") is not None:
        trade.update({
            "exit": to_float(row.get("exit"), 0.0),
            "exitPrice": to_float(row.get("exit_price"), 0.0),
            "exitReason": row.get("exit_reason"),
            "exitTime": row.get("exit_time"),
            "pnl": to_float(row.get("pnl"), 0.0),
            "rMultiple": to_float(row.get("r_multiple"), 0.0),
            "result": row.get("result"),
        })

    if virtual:
        trade.update({
            "barsOpen": to_int(row.get("bars_open"), 0),
            "seenCount": to_int(row.get("seen_count"), 1),
            "lastSeenAt": row.get("last_seen_at"),
            "virtualLearningOnly": bool(row.get("virtual_learning_only", True)),
        })

    return {key: value for key, value in trade.items() if value is not None}


def row_to_decision(row: Dict[str, Any]) -> Dict[str, Any]:
    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    decision = dict(payload)
    decision.update({
        "id": row.get("id"),
        "observationKey": row.get("observation_key"),
        "symbol": row.get("symbol"),
        "timeframe": row.get("timeframe"),
        "decision": row.get("decision"),
        "rawDecision": row.get("raw_decision"),
        "allowedToTrade": bool(row.get("allowed_to_trade", False)),
        "confidence": to_float(row.get("confidence"), 0.0),
        "confidenceGrade": row.get("confidence_grade"),
        "entry": to_float(row.get("entry"), 0.0),
        "target": to_float(row.get("target"), 0.0),
        "stop": to_float(row.get("stop"), 0.0),
        "riskReward": to_float(row.get("risk_reward"), 0.0),
        "bucket": row.get("bucket"),
        "reason": row.get("reason"),
        "projectionEngineMode": row.get("projection_engine_mode"),
        "aiPermission": row.get("ai_permission"),
        "createdAt": row.get("created_at"),
    })
    return {key: value for key, value in decision.items() if value is not None}


def trade_to_open_row(trade: Dict[str, Any]) -> Dict[str, Any]:
    side = normalize_side(trade.get("side"))
    return {
        "id": str(trade.get("id") or build_trade_id(trade.get("symbol"), trade.get("timeframe"), side)),
        "user_key": AI_TRADER_USER_KEY,
        "symbol": normalize_symbol(trade.get("symbol")),
        "timeframe": normalize_timeframe(trade.get("timeframe")),
        "side": side if side in {"BUY", "SELL"} else "BUY",
        "entry": db_number(trade.get("entry") or trade.get("entryPrice")) or 0,
        "target": db_number(trade.get("target") or trade.get("targetPrice")),
        "stop": db_number(trade.get("stop") or trade.get("stopPrice")),
        "risk_reward": db_number(trade.get("riskReward")),
        "confidence": db_number(trade.get("confidence")),
        "confidence_grade": trade.get("confidenceGrade"),
        "current_price": db_number(trade.get("currentPrice")),
        "current_pnl": db_number(trade.get("currentPnl") or trade.get("pnl")),
        "max_pnl": db_number(trade.get("maxPnl")),
        "min_pnl": db_number(trade.get("minPnl")),
        "risk_pnl": db_number(trade.get("riskPnl")),
        "bucket": trade.get("bucket"),
        "reason": trade.get("reason"),
        "status": trade.get("status") or "OPEN",
        "dashboard_only": bool(trade.get("dashboardOnly", True)),
        "broker_connected": bool(trade.get("brokerConnected", False)),
        "source_snapshot": trade.get("sourceSnapshot") if isinstance(trade.get("sourceSnapshot"), dict) else trade,
        "entry_time": iso_or_none(trade.get("entryTime")),
        "created_at": iso_or_none(trade.get("createdAt")) or now_iso(),
        "updated_at": iso_or_none(trade.get("updatedAt")) or now_iso(),
    }


def trade_to_closed_row(trade: Dict[str, Any], virtual: bool = False) -> Dict[str, Any]:
    row = trade_to_open_row(trade)
    row.update({
        "exit": db_number(trade.get("exit") or trade.get("exitPrice")),
        "exit_price": db_number(trade.get("exitPrice") or trade.get("exit")),
        "exit_reason": trade.get("exitReason"),
        "pnl": db_number(trade.get("pnl")),
        "r_multiple": db_number(trade.get("rMultiple") or trade.get("r")),
        "result": trade.get("result"),
        "status": trade.get("status") or ("VIRTUAL_CLOSED" if virtual else "CLOSED"),
        "exit_time": iso_or_none(trade.get("exitTime")) or now_iso(),
    })
    if "current_price" in row:
        row.pop("current_price", None)
    if "current_pnl" in row:
        row.pop("current_pnl", None)
    if "max_pnl" in row:
        row.pop("max_pnl", None)
    if "min_pnl" in row:
        row.pop("min_pnl", None)
    if "risk_pnl" in row:
        row.pop("risk_pnl", None)
    if virtual:
        row["virtual_learning_only"] = True
        row["bars_open"] = db_int(trade.get("barsOpen"))
    return row


def trade_to_virtual_open_row(trade: Dict[str, Any]) -> Dict[str, Any]:
    row = trade_to_open_row(trade)
    for key in ["current_price", "current_pnl", "max_pnl", "min_pnl", "risk_pnl", "source_snapshot", "broker_connected"]:
        row.pop(key, None)
    row.update({
        "bars_open": to_int(trade.get("barsOpen"), 0),
        "seen_count": to_int(trade.get("seenCount"), 1),
        "status": trade.get("status") or "VIRTUAL_OPEN",
        "virtual_learning_only": True,
        "last_seen_at": iso_or_none(trade.get("lastSeenAt")) or now_iso(),
    })
    return row


def decision_to_row(decision: Dict[str, Any]) -> Dict[str, Any]:
    created_at = iso_or_none(decision.get("createdAt")) or now_iso()
    return {
        "id": str(decision.get("id") or f"DECISION-{normalize_symbol(decision.get('symbol'))}-{normalize_timeframe(decision.get('timeframe'))}-{created_at}"),
        "user_key": AI_TRADER_USER_KEY,
        "observation_key": decision.get("observationKey") or decision_observation_key(decision),
        "symbol": normalize_symbol(decision.get("symbol")),
        "timeframe": normalize_timeframe(decision.get("timeframe")),
        "decision": decision.get("decision"),
        "raw_decision": decision.get("rawDecision") or decision.get("decision"),
        "allowed_to_trade": bool(decision.get("allowedToTrade", False)),
        "confidence": db_number(decision.get("confidence")),
        "confidence_grade": decision.get("confidenceGrade"),
        "entry": db_number(decision.get("entry")),
        "target": db_number(decision.get("target")),
        "stop": db_number(decision.get("stop")),
        "risk_reward": db_number(decision.get("riskReward")),
        "bucket": decision.get("bucket"),
        "reason": decision.get("reason"),
        "projection_engine_mode": decision.get("projectionEngineMode"),
        "ai_permission": decision.get("aiPermission"),
        "payload": decision,
        "created_at": created_at,
    }


def supabase_select_table(table: str, order_col: str = "created_at", limit: int = 500) -> List[Dict[str, Any]]:
    """Load a bounded recent slice from Supabase to prevent Render memory spikes."""
    safe_limit = max(1, min(int(limit or 500), 2500))
    query = urllib.parse.urlencode({
        "select": "*",
        "user_key": f"eq.{AI_TRADER_USER_KEY}",
        "order": f"{order_col}.desc",
        "limit": str(safe_limit),
    })
    result = supabase_request("GET", table, query=query)
    rows = result if isinstance(result, list) else []
    rows.reverse()
    return rows


def load_memory_from_supabase() -> Dict[str, Any]:
    open_rows = supabase_select_table("ai_trader_open_trades", "created_at", AI_TRADER_OPEN_LOAD_LIMIT)
    closed_rows = supabase_select_table("ai_trader_closed_trades", "created_at", AI_TRADER_CLOSED_LOAD_LIMIT)
    decision_rows = supabase_select_table("ai_trader_decision_log", "created_at", AI_TRADER_DECISION_LOAD_LIMIT)
    virtual_open_rows = supabase_select_table("ai_trader_virtual_open_trades", "created_at", AI_TRADER_VIRTUAL_OPEN_LOAD_LIMIT)
    virtual_closed_rows = supabase_select_table("ai_trader_virtual_closed_trades", "created_at", AI_TRADER_VIRTUAL_CLOSED_LOAD_LIMIT)

    return {
        "version": 3,
        "storage": "supabase",
        "userKey": AI_TRADER_USER_KEY,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
        "openTrades": dedupe_open_trades([row_to_trade(row) for row in open_rows]),
        "closedTrades": [row_to_trade(row) for row in closed_rows],
        "decisionLog": [row_to_decision(row) for row in decision_rows],
        "virtualOpenTrades": [row_to_trade(row, virtual=True) for row in virtual_open_rows],
        "virtualClosedTrades": [row_to_trade(row, virtual=True) for row in virtual_closed_rows],
    }


def supabase_delete_user_rows(table: str) -> None:
    query = urllib.parse.urlencode({"user_key": f"eq.{AI_TRADER_USER_KEY}"})
    supabase_request("DELETE", table, query=query, prefer="return=minimal")


def supabase_delete_missing_open_rows(table: str, keep_ids: List[Any]) -> None:
    """Delete only stale open rows after a successful upsert.

    Closed history and decision history must never be wiped during a normal save.
    This prevents the old delete-all/rewrite-all Supabase flow from causing
    disappearing trades when Render restarts or Supabase has a transient error.
    """
    clean_ids = [
        str(value).replace('"', "").replace("'", "").replace("(", "").replace(")", "").replace(",", "")
        for value in keep_ids
        if value is not None and str(value).strip()
    ]

    query_params = {"user_key": f"eq.{AI_TRADER_USER_KEY}"}
    if clean_ids:
        query_params["id"] = f"not.in.({','.join(clean_ids)})"

    query = urllib.parse.urlencode(query_params)
    supabase_request("DELETE", table, query=query, prefer="return=minimal")


def supabase_upsert_rows(table: str, rows: List[Dict[str, Any]]) -> None:
    clean_rows = [
        {key: value for key, value in row.items() if value is not None}
        for row in rows
        if isinstance(row, dict)
    ]
    if not clean_rows:
        return
    for index in range(0, len(clean_rows), SUPABASE_BATCH_SIZE):
        supabase_request(
            "POST",
            table,
            body=clean_rows[index:index + SUPABASE_BATCH_SIZE],
            prefer="resolution=merge-duplicates,return=minimal",
        )


def save_memory_to_supabase(memory: Dict[str, Any]) -> None:
    storage_state = str(memory.get("storage") or "").lower().strip()
    if storage_state == "supabase_error":
        raise RuntimeError("Refusing to overwrite Supabase AI Trader tables after a failed Supabase load.")

    table_rows = {
        "ai_trader_open_trades": [trade_to_open_row(trade) for trade in safe_list(memory.get("openTrades")) if isinstance(trade, dict)],
        "ai_trader_closed_trades": [trade_to_closed_row(trade) for trade in safe_list(memory.get("closedTrades")) if isinstance(trade, dict)],
        "ai_trader_decision_log": [decision_to_row(decision) for decision in safe_list(memory.get("decisionLog")) if isinstance(decision, dict)],
        "ai_trader_virtual_open_trades": [trade_to_virtual_open_row(trade) for trade in safe_list(memory.get("virtualOpenTrades")) if isinstance(trade, dict)],
        "ai_trader_virtual_closed_trades": [trade_to_closed_row(trade, virtual=True) for trade in safe_list(memory.get("virtualClosedTrades")) if isinstance(trade, dict)],
    }

    # Upsert first so a partial failure cannot wipe history.
    for table, rows in table_rows.items():
        supabase_upsert_rows(table, rows)

    # Only open tables need stale-row cleanup. Closed history and decision log
    # are append/merge history and should not be deleted during normal saves.
    supabase_delete_missing_open_rows(
        "ai_trader_open_trades",
        [row.get("id") for row in table_rows["ai_trader_open_trades"]],
    )
    supabase_delete_missing_open_rows(
        "ai_trader_virtual_open_trades",
        [row.get("id") for row in table_rows["ai_trader_virtual_open_trades"]],
    )


def empty_memory(storage: str = "json") -> Dict[str, Any]:
    return {
        "version": 3,
        "storage": storage,
        "userKey": AI_TRADER_USER_KEY,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
        "openTrades": [],
        "closedTrades": [],
        "decisionLog": [],
        "virtualOpenTrades": [],
        "virtualClosedTrades": [],
    }


def open_trade_dedupe_key(trade: Dict[str, Any]) -> str:
    if AI_TRADER_ALLOW_MULTIPLE_OPEN_TRADES:
        return str(trade.get("id") or build_trade_id(trade.get("symbol"), trade.get("timeframe"), normalize_side(trade.get("side"))))

    return "|".join([
        normalize_symbol(trade.get("symbol")),
        normalize_timeframe(trade.get("timeframe")),
    ])


def dedupe_open_trades(trades: List[Any]) -> List[Dict[str, Any]]:
    """Keep one active open trade per symbol/timeframe unless multiple entries are explicitly enabled."""
    if AI_TRADER_ALLOW_MULTIPLE_OPEN_TRADES:
        return [trade for trade in safe_list(trades) if isinstance(trade, dict)]

    by_key: Dict[str, Dict[str, Any]] = {}

    for trade in safe_list(trades):
        if not isinstance(trade, dict):
            continue

        key = open_trade_dedupe_key(trade)
        existing = by_key.get(key)

        # Keep the newest trade if duplicates already exist.
        trade_time = DateParseSafe(trade.get("createdAt") or trade.get("entryTime") or trade.get("updatedAt"))
        existing_time = DateParseSafe(existing.get("createdAt") or existing.get("entryTime") or existing.get("updatedAt")) if existing else -1

        if existing is None or trade_time >= existing_time:
            by_key[key] = trade

    return list(by_key.values())


def DateParseSafe(value: Any) -> float:
    try:
        if value is None:
            return 0.0
        text = str(value)
        if not text:
            return 0.0
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def load_memory() -> Dict[str, Any]:
    """Load AI Trader memory.

    Important:
    When AI_TRADER_STORAGE=supabase, Supabase is the only source of truth.
    We intentionally do NOT fall back to ai_trader_memory.json for open trades,
    because old JSON fallback files were recreating duplicate open trades.
    """
    if supabase_enabled():
        try:
            memory = load_memory_from_supabase()
            memory["openTrades"] = dedupe_open_trades(memory.get("openTrades", []))
            memory["storage"] = "supabase"
            return memory
        except Exception as error:
            print(f"AI Trader Supabase load failed; returning safe empty Supabase memory: {error}")
            return empty_memory(storage="supabase_error")

    if AI_TRADER_STORAGE == "supabase" and not supabase_enabled():
        # Storage was requested as Supabase but env/config is incomplete.
        # Do not read stale JSON open trades in this mode.
        print("AI Trader Supabase requested but not enabled. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
        return empty_memory(storage="supabase_not_configured")

    if not MEMORY_PATH.exists():
        return empty_memory(storage="json")

    try:
        data = json.loads(MEMORY_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("memory file root must be object")
    except Exception:
        data = {}

    data.setdefault("version", 3)
    data.setdefault("storage", "json")
    data.setdefault("userKey", AI_TRADER_USER_KEY)
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

    data["openTrades"] = dedupe_open_trades(data.get("openTrades", []))
    return data


def save_memory(memory: Dict[str, Any]) -> Dict[str, Any]:
    memory["version"] = max(to_int(memory.get("version"), 3), 3)
    memory["updatedAt"] = now_iso()
    memory["userKey"] = AI_TRADER_USER_KEY
    memory["closedTrades"] = safe_list(memory.get("closedTrades"))[-MAX_CLOSED_TRADES:]
    memory["virtualClosedTrades"] = safe_list(memory.get("virtualClosedTrades"))[-MAX_CLOSED_TRADES:]
    memory["decisionLog"] = safe_list(memory.get("decisionLog"))[-MAX_DECISION_OBSERVATIONS:]
    memory["openTrades"] = dedupe_open_trades(memory.get("openTrades", []))
    memory["virtualOpenTrades"] = safe_list(memory.get("virtualOpenTrades"))[-250:]

    if supabase_enabled():
        try:
            save_memory_to_supabase(memory)
            memory["storage"] = "supabase"
            # Supabase mode must not recreate ai_trader_memory.json. That old
            # fallback file was the source of ghost/duplicate open trades.
            try:
                if MEMORY_PATH.exists():
                    MEMORY_PATH.unlink()
            except Exception:
                pass
            return memory
        except Exception as error:
            print(f"AI Trader Supabase save failed; NOT writing JSON fallback in Supabase mode: {error}")
            memory["storage"] = "supabase_error"
            return memory

    if AI_TRADER_STORAGE == "supabase":
        # Supabase was requested but not configured. Stay safe and do not write
        # JSON fallback that can later resurrect open trades.
        memory["storage"] = "supabase_not_configured"
        return memory

    MEMORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    memory["storage"] = "json"
    tmp_path = MEMORY_PATH.with_suffix(MEMORY_PATH.suffix + ".tmp")
    tmp_path.write_text(json.dumps(memory, indent=2, sort_keys=True, default=str), encoding="utf-8")
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
        with MEMORY_LOCK:
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

            decision_log.append(compact)
            memory["decisionLog"] = decision_log[-MAX_DECISION_OBSERVATIONS:]
            maybe_open_virtual_learning_trade(memory, decision)
            save_memory(memory)
    except Exception as error:
        print(f"AI Trader decision memory skipped: {error}")
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



def first_present_path(data: Any, *paths: str, fallback: Any = None) -> Any:
    for path in paths:
        value = read_path(data, path, fallback=None)
        if value is not None:
            return value
    return fallback


def normalize_percent_score(value: Any) -> float:
    parsed = to_float(value, 0.0)
    if parsed <= 0:
        return 0.0
    if parsed <= 1.0:
        return parsed * 100.0
    return parsed


def extract_strategy_tester_context(strategy_tester_results: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Read main-chart Strategy Tester performance.

    Strategy Tester is intentionally treated as a settings-performance layer only.
    It does not replace SMC, AlphaX, DLM, Ghost, Target ML, or mini-chart context.
    """
    data = safe_dict(strategy_tester_results)

    if not data:
        return {
            "available": False,
            "mode": "UNKNOWN",
            "message": "Strategy Tester results not available.",
            "confidenceAdjustment": 0.0,
            "reason": "Strategy Tester not connected yet",
        }

    best = (
        safe_dict(data.get("best"))
        or safe_dict(data.get("bestResult"))
        or safe_dict(data.get("bestSettingsResult"))
        or safe_dict(read_path(data, "optimizer.best", fallback={}))
        or safe_dict(read_path(data, "nrtrOptimizer.best", fallback={}))
    )

    result = (
        safe_dict(data.get("result"))
        or safe_dict(data.get("backtestResult"))
        or safe_dict(best.get("result"))
        or data
    )

    settings = (
        safe_dict(data.get("settings"))
        or safe_dict(data.get("mainSettings"))
        or safe_dict(best.get("settings"))
        or safe_dict(best.get("mainSettings"))
    )

    mode = str(
        first_present_path(
            data,
            "strategyMode",
            "mode",
            "selectedMode",
            "testerMode",
            fallback=first_present_path(best, "strategyMode", "mode", fallback="UNKNOWN"),
        )
    ).upper()

    win_rate = normalize_percent_score(
        first_present_path(
            result,
            "winRate",
            "win_rate",
            "profitableTrades",
            fallback=first_present_path(best, "winRate", "result.winRate", fallback=0),
        )
    )

    profit_factor = to_float(
        first_present_path(
            result,
            "profitFactor",
            "profit_factor",
            fallback=first_present_path(best, "profitFactor", "result.profitFactor", fallback=0),
        ),
        0.0,
    )

    total_trades = to_int(
        first_present_path(
            result,
            "totalTrades",
            "closedTrades",
            "samples",
            fallback=first_present_path(best, "totalTrades", "result.totalTrades", fallback=0),
        ),
        0,
    )

    if isinstance(result.get("trades"), list):
        total_trades = max(total_trades, len(result.get("trades", [])))

    max_drawdown_percent = abs(
        normalize_percent_score(
            first_present_path(
                result,
                "maxDrawdownPercent",
                "maxDrawdown",
                "drawdown",
                fallback=first_present_path(best, "maxDrawdownPercent", "result.maxDrawdownPercent", fallback=0),
            )
        )
    )

    total_pnl = to_float(
        first_present_path(
            result,
            "totalPnl",
            "totalPnL",
            "pnl",
            fallback=first_present_path(best, "totalPnl", "result.totalPnl", fallback=0),
        ),
        0.0,
    )

    total_pnl_percent = normalize_percent_score(
        first_present_path(
            result,
            "totalPnlPercent",
            "totalPnLPercent",
            "pnlPercent",
            fallback=first_present_path(best, "totalPnlPercent", "result.totalPnlPercent", fallback=0),
        )
    )

    sample_weight = clamp(total_trades / 20.0, 0.0, 1.0)
    adjustment = 0.0

    if total_trades < 4:
        adjustment -= 2.0
    else:
        if win_rate >= 70:
            adjustment += 9.0
        elif win_rate >= 62:
            adjustment += 6.0
        elif win_rate >= 55:
            adjustment += 3.0
        elif win_rate < 42:
            adjustment -= 7.0
        elif win_rate < 48:
            adjustment -= 4.0

        if profit_factor >= 2.0:
            adjustment += 7.0
        elif profit_factor >= 1.5:
            adjustment += 5.0
        elif profit_factor >= 1.1:
            adjustment += 2.0
        elif profit_factor > 0 and profit_factor < 0.85:
            adjustment -= 6.0

        if total_pnl > 0:
            adjustment += 2.0
        elif total_pnl < 0:
            adjustment -= 3.0

        if max_drawdown_percent >= 6:
            adjustment -= 8.0
        elif max_drawdown_percent >= 3:
            adjustment -= 4.0

    adjustment = clamp(adjustment * max(0.25, sample_weight), -15.0, 15.0)

    if total_trades < 4:
        reason = f"Strategy Tester learning only: {total_trades} main-chart trades is not enough for a strong setting edge"
    elif adjustment > 0:
        reason = f"Strategy Tester supports current main-chart {mode}: {win_rate:.1f}% WR, PF {profit_factor:.2f}, {total_trades} trades"
    elif adjustment < 0:
        reason = f"Strategy Tester warns on current main-chart {mode}: {win_rate:.1f}% WR, PF {profit_factor:.2f}, DD {max_drawdown_percent:.2f}%"
    else:
        reason = f"Strategy Tester neutral on current main-chart {mode}: {win_rate:.1f}% WR, PF {profit_factor:.2f}, {total_trades} trades"

    return {
        "available": True,
        "mode": mode,
        "winRate": round(win_rate, 4),
        "profitFactor": round(profit_factor, 4),
        "totalTrades": total_trades,
        "maxDrawdownPercent": round(max_drawdown_percent, 4),
        "totalPnl": round(total_pnl, 4),
        "totalPnlPercent": round(total_pnl_percent, 4),
        "confidenceAdjustment": round(adjustment, 4),
        "sampleWeight": round(sample_weight, 4),
        "settings": settings,
        "best": best,
        "reason": reason,
        "message": reason,
        "purpose": "main_chart_strategy_settings_performance_only",
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
    strategy_tester_results: Optional[Dict[str, Any]] = None,
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
    strategy_tester_context = extract_strategy_tester_context(strategy_tester_results)

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

    # Strategy Tester is a main-chart settings-performance layer.
    # It can boost or reduce confidence, but it does not replace SMC/AlphaX/DLM/Ghost logic.
    base += to_float(strategy_tester_context.get("confidenceAdjustment"), 0.0)

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

    if strategy_tester_context.get("available"):
        reasons.append(str(strategy_tester_context.get("reason")))

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
        "strategyTesterContext": strategy_tester_context,
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


def has_nrtr_entry_trigger(side: str, nrtr_context: Optional[Dict[str, Any]] = None, signal: Optional[Dict[str, Any]] = None) -> bool:
    nrtr_context = safe_dict(nrtr_context)
    signal = safe_dict(signal)

    directions = [
        normalize_side(read_path(nrtr_context, "main.direction", "nrtrMain.direction", "direction", fallback="")),
        normalize_side(read_path(nrtr_context, "mini1.direction", "nrtrMini1.direction", fallback="")),
        normalize_side(read_path(nrtr_context, "mini2.direction", "nrtrMini2.direction", fallback="")),
        normalize_side(read_path(signal, "nrtrDirection", "nrtr.direction", "strategyDirection", fallback="")),
    ]

    if any(direction == side for direction in directions):
        return True

    trigger_text = str(
        read_path(
            signal,
            "nrtrSignal",
            "nrtrEntry",
            "strategyEntry",
            "entryTrigger",
            "signal",
            "type",
            "direction",
            fallback="",
        )
    ).upper()

    if side == "BUY" and any(token in trigger_text for token in ["BUY", "LONG", "BULL"]):
        return True
    if side == "SELL" and any(token in trigger_text for token in ["SELL", "SHORT", "BEAR"]):
        return True

    return False


def has_strategy_tester_context(strategy_tester_results: Optional[Dict[str, Any]] = None) -> bool:
    data = safe_dict(strategy_tester_results)
    if not data:
        return False

    mode = str(data.get("strategyMode") or data.get("mode") or data.get("selectedMode") or "").upper()
    if "NRTR" in mode or "SMMA" in mode:
        return True

    return bool(data.get("best") or data.get("bestResult") or data.get("bestSettings") or data.get("result"))


def build_learning_entry_permission(
    *,
    side: str,
    entry: float,
    target: float,
    stop: float,
    rr: float,
    min_rr: float,
    confidence: float,
    min_confidence: float,
    nrtr_context: Optional[Dict[str, Any]] = None,
    signal: Optional[Dict[str, Any]] = None,
    strategy_tester_results: Optional[Dict[str, Any]] = None,
    projection_engine: Optional[Dict[str, Any]] = None,
    projection_engine_context: Optional[Dict[str, Any]] = None,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    projection_engine = safe_dict(projection_engine)
    projection_engine_context = safe_dict(projection_engine_context)
    context = safe_dict(context)

    nrtr_trigger = has_nrtr_entry_trigger(side, nrtr_context, signal)
    strategy_context = has_strategy_tester_context(strategy_tester_results)
    projection_context = bool(
        projection_engine
        or projection_engine_context
        or context.get("projectionEngine")
        or context.get("projectionEngineContext")
        or context.get("aiPermission")
    )

    target_stop_exit = target > 0 and stop > 0
    managed_exit = bool(nrtr_trigger or strategy_context or projection_context)
    has_exit_plan = target_stop_exit or managed_exit
    has_trade_trigger = side in {"BUY", "SELL"} and entry > 0 and (nrtr_trigger or target > 0 or projection_context or strategy_context)

    confidence_ok = confidence >= min_confidence
    rr_ok = rr >= min_rr if rr > 0 else False

    if AI_TRADER_LEARNING_MODE:
        allowed = (
            side in {"BUY", "SELL"}
            and entry > 0
            and has_trade_trigger
            and has_exit_plan
            and (not AI_TRADER_REQUIRE_TARGET_STOP_IN_LEARNING_MODE or target_stop_exit)
            and (not AI_TRADER_REQUIRE_RR_IN_LEARNING_MODE or rr_ok)
            and (not AI_TRADER_REQUIRE_CONFIDENCE_IN_LEARNING_MODE or confidence_ok)
        )
        mode = "LEARNING_MODE"
    else:
        allowed = (
            side in {"BUY", "SELL"}
            and entry > 0
            and target > 0
            and stop > 0
            and rr_ok
            and confidence_ok
        )
        mode = "CONFIDENCE_GATED_MODE"

    blockers: List[str] = []
    if side not in {"BUY", "SELL"}:
        blockers.append("No BUY or SELL side")
    if entry <= 0:
        blockers.append("Entry price missing")
    if not has_trade_trigger:
        blockers.append("No NRTR/projection/target entry trigger")
    if not has_exit_plan:
        blockers.append("No target/stop, NRTR, internal, or projection exit plan")
    if not AI_TRADER_LEARNING_MODE and not rr_ok:
        blockers.append(f"Risk/reward below {min_rr:.2f}R")
    if not AI_TRADER_LEARNING_MODE and not confidence_ok:
        blockers.append(f"Confidence below {min_confidence:.1f}%")

    return {
        "allowed": bool(allowed),
        "mode": mode,
        "learningMode": AI_TRADER_LEARNING_MODE,
        "confidenceBlocksEntry": (not AI_TRADER_LEARNING_MODE) or AI_TRADER_REQUIRE_CONFIDENCE_IN_LEARNING_MODE,
        "rrBlocksEntry": (not AI_TRADER_LEARNING_MODE) or AI_TRADER_REQUIRE_RR_IN_LEARNING_MODE,
        "targetStopBlocksEntry": (not AI_TRADER_LEARNING_MODE) or AI_TRADER_REQUIRE_TARGET_STOP_IN_LEARNING_MODE,
        "hasTradeTrigger": bool(has_trade_trigger),
        "hasExitPlan": bool(has_exit_plan),
        "targetStopExit": bool(target_stop_exit),
        "managedExit": bool(managed_exit),
        "nrtrTrigger": bool(nrtr_trigger),
        "strategyTesterContext": bool(strategy_context),
        "projectionContext": bool(projection_context),
        "confidenceOk": bool(confidence_ok),
        "riskRewardOk": bool(rr_ok),
        "blockers": blockers,
    }


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
    strategyTesterResults: Optional[Dict[str, Any]] = None,
    **_: Any,
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    signal = safe_dict(signal)
    context = safe_dict(context)

    if strategyTesterResults is None:
        strategyTesterResults = safe_dict(context.get("strategyTesterResults"))

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

    min_confidence = to_float(minConfidence, DEFAULT_MIN_CONFIDENCE)
    min_rr = to_float(minRiskReward, DEFAULT_MIN_RR)

    rr_plan = build_rr_qualified_trade_plan(
        symbol=normalized_symbol,
        timeframe=normalized_timeframe,
        side=decision_side,
        entry=entry,
        target=target,
        stop=stop,
        min_rr=min_rr,
        signal=signal,
        target_ml=targetMl,
        ghost_ml=ghostMl,
        projection_engine=projectionEngine,
        projection_engine_context=projectionEngineContext,
        context=context,
    )

    if bool(rr_plan.get("upgraded")):
        target = to_float(rr_plan.get("target"), target)

    rr = to_float(riskReward, 0.0) or to_float(rr_plan.get("riskReward"), calculate_rr(decision_side, entry, target, stop))

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
        strategy_tester_results=strategyTesterResults,
    )

    permission = build_learning_entry_permission(
        side=decision_side,
        entry=entry,
        target=target,
        stop=stop,
        rr=rr,
        min_rr=min_rr,
        confidence=score["confidence"],
        min_confidence=min_confidence,
        nrtr_context=nrtrContext,
        signal=signal,
        strategy_tester_results=strategyTesterResults,
        projection_engine=projectionEngine,
        projection_engine_context=projectionEngineContext,
        context=context,
    )
    allowed = bool(permission.get("allowed"))

    current_pnl = signed_move(decision_side, entry, current_price) * point_value(normalized_symbol) if current_price > 0 and entry > 0 else 0.0
    max_pnl = signed_move(decision_side, entry, target) * point_value(normalized_symbol) if target > 0 and entry > 0 else 0.0
    risk_pnl = -abs(signed_move(decision_side, entry, stop) * point_value(normalized_symbol)) if stop > 0 and entry > 0 else 0.0

    if bool(rr_plan.get("upgraded")):
        score["reasons"] = [str(rr_plan.get("reason"))] + list(score.get("reasons", []))

    if not allowed:
        blocker_text = " | ".join(permission.get("blockers") or [])
        reason = "AI HOLD: learning entry requirements not met. " + (blocker_text or " | ".join(score["reasons"][:4]))
    elif AI_TRADER_LEARNING_MODE:
        reason = f"AI {decision_side}: Learning-mode paper trade. Confidence/RR are saved as labels, not entry blockers. " + " | ".join(score["reasons"][:3])
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
            "rrTargetPlan": rr_plan,
            "entryPermission": permission,
            "learningMode": AI_TRADER_LEARNING_MODE,
            "strategyTesterContext": score.get("strategyTesterContext"),
            "context": context,
        },
        "createdAt": now_iso(),
    }

    remember_ai_decision(decision_result)
    return decision_result


def open_ai_trade(**payload: Any) -> Dict[str, Any]:
    with MEMORY_LOCK:
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
            and (not AI_TRADER_ALLOW_MULTIPLE_OPEN_TRADES or normalize_side(trade.get("side")) == side)
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
    with MEMORY_LOCK:
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



def calculate_open_trade_live_pnl(trade: Dict[str, Any], current_price: Any) -> Dict[str, Any]:
    """Recalculate an open dashboard paper trade from the latest live/chart price."""
    live_price = to_float(current_price, 0.0)
    if live_price <= 0:
        live_price = to_float(
            trade.get("currentPrice")
            or trade.get("current")
            or trade.get("lastPrice")
            or trade.get("markPrice")
            or trade.get("entry")
            or trade.get("entryPrice"),
            0.0,
        )

    entry = to_float(trade.get("entry") or trade.get("entryPrice"), 0.0)
    side = str(trade.get("side") or trade.get("decision") or trade.get("rawDecision") or "BUY").upper()
    qty = max(1.0, to_float(trade.get("quantity") or trade.get("qty") or trade.get("contracts"), 1.0))
    symbol = normalize_symbol(str(trade.get("symbol") or ""))
    point_multiplier = 5.0 if symbol.startswith("MES") else 50.0 if symbol.startswith("ES") else 1.0
    point_value = max(1.0, to_float(trade.get("pointValue") or trade.get("dollarPerPoint") or trade.get("multiplier"), point_multiplier))

    if entry <= 0 or live_price <= 0:
        return {
            **trade,
            "currentPrice": live_price,
            "currentPnl": to_float(trade.get("currentPnl") or trade.get("pnl"), 0.0),
            "pnl": to_float(trade.get("currentPnl") or trade.get("pnl"), 0.0),
            "pnlPercent": to_float(trade.get("pnlPercent") or trade.get("percent"), 0.0),
            "percent": to_float(trade.get("pnlPercent") or trade.get("percent"), 0.0),
            "rMultiple": to_float(trade.get("rMultiple") or trade.get("r"), 0.0),
            "liveUpdatedAt": now_iso(),
            "livePnlSource": "stored_trade_price",
        }

    points = (entry - live_price) if "SELL" in side or "SHORT" in side else (live_price - entry)
    pnl = points * point_value * qty
    pnl_percent = points / entry if entry else 0.0

    stop = to_float(trade.get("stop") or trade.get("stopPrice"), 0.0)
    risk_points = abs(entry - stop) if stop > 0 else 0.0
    r_multiple = points / risk_points if risk_points > 0 else to_float(trade.get("rMultiple") or trade.get("r"), 0.0)

    max_pnl = max(to_float(trade.get("maxPnl"), pnl), pnl)
    min_pnl = min(to_float(trade.get("minPnl"), pnl), pnl)

    updated = dict(trade)
    updated.update(
        {
            "currentPrice": round(live_price, 8),
            "markPrice": round(live_price, 8),
            "currentPnl": round(pnl, 6),
            "pnl": round(pnl, 6),
            "pnlPercent": round(pnl_percent, 8),
            "percent": round(pnl_percent, 8),
            "livePoints": round(points, 8),
            "rMultiple": round(r_multiple, 6),
            "currentR": round(r_multiple, 6),
            "maxPnl": round(max_pnl, 6),
            "minPnl": round(min_pnl, 6),
            "liveUpdatedAt": now_iso(),
            "livePnlSource": "chart_live_price",
        }
    )
    return updated


def refresh_open_trades_with_live_price(memory: Dict[str, Any], symbol: Any = "", timeframe: Any = "", current_price: Any = None) -> Dict[str, Any]:
    live_price = to_float(current_price, 0.0)
    if live_price <= 0:
        return memory

    normalized_symbol = normalize_symbol(str(symbol or ""))
    normalized_timeframe = normalize_timeframe(str(timeframe or ""))

    refreshed = []
    changed = False

    for trade in safe_list(memory.get("openTrades")):
        if not isinstance(trade, dict):
            continue

        trade_symbol = normalize_symbol(str(trade.get("symbol") or ""))
        trade_tf = normalize_timeframe(str(trade.get("timeframe") or ""))

        should_refresh = True
        if normalized_symbol and trade_symbol and trade_symbol != normalized_symbol:
            should_refresh = False
        if normalized_timeframe and trade_tf and trade_tf != normalized_timeframe:
            should_refresh = False

        if should_refresh:
            refreshed_trade = calculate_open_trade_live_pnl(trade, live_price)
            refreshed.append(refreshed_trade)
            changed = True
        else:
            refreshed.append(trade)

    if changed:
        memory["openTrades"] = refreshed

    return memory

def evaluate_ai_trades(
    *,
    symbol: Any = "MES1!",
    timeframe: Any = "1m",
    currentPrice: Any = None,
    candles: Optional[List[Any]] = None,
    **_: Any,
) -> Dict[str, Any]:
    with MEMORY_LOCK:
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

        # Settlement must respect the live chart/quote price, even when the last
        # candle high/low is stale or has not merged the newest tick yet.
        if current > 0:
            latest_high = max(latest_high, current)
            latest_low = min(latest_low, current)
            latest_close = current

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

        # Settlement must respect the live chart/quote price, even when the last
        # candle high/low is stale or has not merged the newest tick yet.
        if current > 0:
            latest_high = max(latest_high, current)
            latest_low = min(latest_low, current)
            latest_close = current

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
        "storage": "supabase" if supabase_enabled() else "json",
        "supabaseEnabled": supabase_enabled(),
        "userKey": AI_TRADER_USER_KEY,
        "memoryLoadLimits": {
            "open": AI_TRADER_OPEN_LOAD_LIMIT,
            "closed": AI_TRADER_CLOSED_LOAD_LIMIT,
            "decisions": AI_TRADER_DECISION_LOAD_LIMIT,
            "virtualOpen": AI_TRADER_VIRTUAL_OPEN_LOAD_LIMIT,
            "virtualClosed": AI_TRADER_VIRTUAL_CLOSED_LOAD_LIMIT,
        },
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



def clear_ai_trader_open_trades(symbol: Optional[Any] = None, timeframe: Optional[Any] = None) -> Dict[str, Any]:
    """Clear open real + virtual trades while preserving closed history and decision memory."""
    with MEMORY_LOCK:
        memory = load_memory()
        normalized_symbol = normalize_symbol(symbol) if symbol else ""
        normalized_timeframe = normalize_timeframe(timeframe) if timeframe else ""

        def keep_open(trade: Any) -> bool:
            if not isinstance(trade, dict):
                return False
            if normalized_symbol and normalize_symbol(trade.get("symbol")) != normalized_symbol:
                return True
            if normalized_timeframe and normalize_timeframe(trade.get("timeframe")) != normalized_timeframe:
                return True
            return False

        before_open = len(safe_list(memory.get("openTrades")))
        before_virtual = len(safe_list(memory.get("virtualOpenTrades")))

        memory["openTrades"] = [trade for trade in safe_list(memory.get("openTrades")) if keep_open(trade)]
        memory["virtualOpenTrades"] = [trade for trade in safe_list(memory.get("virtualOpenTrades")) if keep_open(trade)]
        save_memory(memory)

        return {
            "eventType": "AI_TRADER_CLEAR_OPEN",
            "status": "Cleared",
            "dashboardOnly": True,
            "brokerConnected": False,
            "symbol": normalized_symbol or "ALL",
            "timeframe": normalized_timeframe or "ALL",
            "clearedOpenCount": before_open - len(memory["openTrades"]),
            "clearedVirtualOpenCount": before_virtual - len(memory["virtualOpenTrades"]),
            "summary": ai_trader_summary(symbol=normalized_symbol, timeframe=normalized_timeframe),
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
