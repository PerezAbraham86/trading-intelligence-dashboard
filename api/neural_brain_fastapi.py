from __future__ import annotations

import json
import math
import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


NEURAL_BRAIN_VERSION = "phase3_fastapi_online_memory_v2_symbol_scopes"
PHASE = "phase3_river_style_online_updates"

DATA_DIR = Path(os.getenv("NEURAL_BRAIN_DATA_DIR", os.getenv("DATA_DIR", ".data")))
DB_PATH = Path(os.getenv("NEURAL_BRAIN_DB_PATH", str(DATA_DIR / "neural_brain_memory.sqlite3")))
ONLINE_MODEL_PATH = Path(os.getenv("NEURAL_BRAIN_ONLINE_MODEL_PATH", str(DATA_DIR / "neural_brain_online_model.json")))

TASK_NAMES = ("targetHit", "reversal", "chop", "buyWin", "sellWin")
ONLINE_READY_MIN_EXAMPLES = int(os.getenv("NEURAL_BRAIN_ONLINE_READY_MIN_EXAMPLES", "25"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clamp(value: Any, minimum: float = 0.0, maximum: float = 100.0) -> float:
    try:
        number = float(value)
        if not math.isfinite(number):
            return minimum
        return max(minimum, min(maximum, number))
    except Exception:
        return minimum


def safe_json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        return "{}"


def parse_json(value: Any, fallback: Any = None) -> Any:
    if fallback is None:
        fallback = {}
    if isinstance(value, (dict, list)):
        return value
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def normalize_symbol(value: Any) -> str:
    text = str(value or "MES1!").strip().upper()

    if text in {"MES", "MES1", "MES1!"}:
        return "MES1!"
    if "MES" in text:
        return "MES1!"
    if "BTC" in text:
        return "BTCUSD"
    if "ETH" in text:
        return "ETHUSD"
    if "SPY" in text:
        return "SPY"

    return text or "MES1!"


def normalize_timeframe(value: Any) -> str:
    text = str(value or "1m").strip().lower()

    if text == "1":
        return "1m"
    if text == "3":
        return "3m"
    if text == "5":
        return "5m"
    if text == "10":
        return "10m"
    if text == "15":
        return "15m"
    if text == "30":
        return "30m"
    if text == "60":
        return "1h"
    if text in {"d", "1d"}:
        return "1d"
    if text in {"w", "1w"}:
        return "1w"

    return text or "1m"


def symbol_scope_key(symbol: Any) -> str:
    return f"symbol:{normalize_symbol(symbol)}"


def symbol_timeframe_scope_key(symbol: Any, timeframe: Any) -> str:
    return f"symbol_timeframe:{normalize_symbol(symbol)}::{normalize_timeframe(timeframe)}"


def empty_task() -> Dict[str, Any]:
    return {"seen": 0, "positive": 0, "rate": 0.0}


def empty_online_scope(scope: str = "global", symbol: Optional[str] = None, timeframe: Optional[str] = None) -> Dict[str, Any]:
    return {
        "scope": scope,
        "symbol": normalize_symbol(symbol) if symbol else None,
        "timeframe": normalize_timeframe(timeframe) if timeframe else None,
        "onlineReady": False,
        "trainedExamples": 0,
        "tasks": {task: empty_task() for task in TASK_NAMES},
        "updatedAt": now_iso(),
    }


def normalize_online_scope(scope: Any, default_scope: str = "global") -> Dict[str, Any]:
    if not isinstance(scope, dict):
        return empty_online_scope(default_scope)

    normalized = {
        **empty_online_scope(str(scope.get("scope") or default_scope)),
        **scope,
    }

    tasks = normalized.get("tasks") if isinstance(normalized.get("tasks"), dict) else {}
    normalized["tasks"] = {
        task: {
            **empty_task(),
            **(tasks.get(task) if isinstance(tasks.get(task), dict) else {}),
        }
        for task in TASK_NAMES
    }

    normalized["trainedExamples"] = int(normalized.get("trainedExamples") or 0)
    normalized["onlineReady"] = normalized["trainedExamples"] >= ONLINE_READY_MIN_EXAMPLES
    normalized["symbol"] = normalize_symbol(normalized["symbol"]) if normalized.get("symbol") else None
    normalized["timeframe"] = normalize_timeframe(normalized["timeframe"]) if normalized.get("timeframe") else None

    return normalized


def new_online_model() -> Dict[str, Any]:
    return {
        "phase": PHASE,
        "version": NEURAL_BRAIN_VERSION,
        "onlineReady": False,
        "trainedExamples": 0,
        "global": empty_online_scope("global"),
        "scopes": {},
        "updatedAt": now_iso(),
    }


def normalize_online_model(model: Any) -> Dict[str, Any]:
    if not isinstance(model, dict):
        return new_online_model()

    # Backward compatibility with the old v1 model shape:
    # { trainedExamples, tasks, onlineReady } at root.
    if "global" not in model and "tasks" in model:
        global_scope = empty_online_scope("global")
        global_scope["trainedExamples"] = int(model.get("trainedExamples") or 0)
        global_scope["tasks"] = {
            task: {
                **empty_task(),
                **(model.get("tasks", {}).get(task) if isinstance(model.get("tasks", {}).get(task), dict) else {}),
            }
            for task in TASK_NAMES
        }
        global_scope["updatedAt"] = str(model.get("updatedAt") or now_iso())
        global_scope["onlineReady"] = global_scope["trainedExamples"] >= ONLINE_READY_MIN_EXAMPLES

        return {
            "phase": PHASE,
            "version": NEURAL_BRAIN_VERSION,
            "onlineReady": global_scope["onlineReady"],
            "trainedExamples": global_scope["trainedExamples"],
            "global": normalize_online_scope(global_scope, "global"),
            "scopes": {},
            "updatedAt": str(model.get("updatedAt") or now_iso()),
            "migratedFrom": "phase3_fastapi_online_memory_v1",
        }

    normalized = {
        **new_online_model(),
        **model,
    }

    normalized["global"] = normalize_online_scope(normalized.get("global"), "global")

    scopes = normalized.get("scopes") if isinstance(normalized.get("scopes"), dict) else {}
    normalized["scopes"] = {
        str(key): normalize_online_scope(value, str(key))
        for key, value in scopes.items()
        if isinstance(value, dict)
    }

    normalized["trainedExamples"] = int(normalized["global"].get("trainedExamples") or 0)
    normalized["onlineReady"] = bool(normalized["global"].get("onlineReady"))
    normalized["updatedAt"] = str(normalized.get("updatedAt") or now_iso())
    normalized["phase"] = PHASE
    normalized["version"] = NEURAL_BRAIN_VERSION

    return normalized


def ensure_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(DB_PATH) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS neural_brain_snapshots (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                timestamp TEXT,
                symbol TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                buy_confidence REAL NOT NULL,
                sell_confidence REAL NOT NULL,
                target_hit_probability REAL NOT NULL,
                reversal_risk REAL NOT NULL,
                chop_risk REAL NOT NULL,
                decision_strength REAL NOT NULL,
                best_direction TEXT NOT NULL,
                decision TEXT NOT NULL,
                risk_status TEXT NOT NULL,
                source TEXT,
                scorecard_inputs TEXT,
                raw_payload TEXT,
                outcome_json TEXT,
                labeled_at TEXT
            )
            """
        )

        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_neural_brain_snapshots_created
            ON neural_brain_snapshots(created_at DESC)
            """
        )

        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_neural_brain_snapshots_symbol_tf
            ON neural_brain_snapshots(symbol, timeframe, created_at DESC)
            """
        )

        connection.commit()


def row_to_snapshot(row: sqlite3.Row) -> Dict[str, Any]:
    outcome = parse_json(row["outcome_json"], None) if row["outcome_json"] else None

    return {
        "id": row["id"],
        "createdAt": row["created_at"],
        "timestamp": row["timestamp"],
        "symbol": row["symbol"],
        "timeframe": row["timeframe"],
        "buyConfidence": row["buy_confidence"],
        "sellConfidence": row["sell_confidence"],
        "targetHitProbability": row["target_hit_probability"],
        "reversalRisk": row["reversal_risk"],
        "chopRisk": row["chop_risk"],
        "decisionStrength": row["decision_strength"],
        "bestDirection": row["best_direction"],
        "decision": row["decision"],
        "riskStatus": row["risk_status"],
        "source": row["source"],
        "scorecardInputs": parse_json(row["scorecard_inputs"], {}),
        "rawPayload": parse_json(row["raw_payload"], {}),
        "outcome": outcome,
        "labeledAt": row["labeled_at"],
    }


def base_scorecard_from_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    scorecards = payload.get("scorecards") if isinstance(payload.get("scorecards"), dict) else {}
    signal = payload.get("signal") if isinstance(payload.get("signal"), dict) else {}
    unified = payload.get("unifiedIntelligence") if isinstance(payload.get("unifiedIntelligence"), dict) else {}

    buy = payload.get("buyConfidence")
    sell = payload.get("sellConfidence")
    target_hit = payload.get("targetHitProbability")
    reversal = payload.get("reversalRisk")
    chop = payload.get("chopRisk")

    if buy is None:
        buy = (
            scorecards.get("buyConfidence")
            or scorecards.get("bullScore")
            or signal.get("bullScore")
            or unified.get("bullishScore")
            or 0
        )

    if sell is None:
        sell = (
            scorecards.get("sellConfidence")
            or scorecards.get("bearScore")
            or signal.get("bearScore")
            or unified.get("bearishScore")
            or 0
        )

    if target_hit is None:
        target_hit = (
            scorecards.get("targetHitProbability")
            or scorecards.get("targetConfidence")
            or payload.get("targetConfidence")
            or 0
        )

    if reversal is None:
        reversal = scorecards.get("reversalRisk") or payload.get("reversalScore") or 0

    if chop is None:
        chop = scorecards.get("chopRisk") or payload.get("chopScore") or 0

    buy = clamp(buy)
    sell = clamp(sell)
    target_hit = clamp(target_hit)
    reversal = clamp(reversal)
    chop = clamp(chop)

    spread = abs(buy - sell)
    strength = clamp((spread * 0.55) + (target_hit * 0.25) + ((100.0 - max(reversal, chop)) * 0.20))

    if buy > sell + 8:
        best_direction = "Bullish"
    elif sell > buy + 8:
        best_direction = "Bearish"
    else:
        best_direction = "Neutral"

    risk_watch = reversal >= 60 or chop >= 60 or spread <= 8

    if risk_watch:
        decision = "HOLD"
        risk_status = "Risk Watch"
    elif best_direction == "Bullish":
        decision = "BUY"
        risk_status = "Aligned"
    elif best_direction == "Bearish":
        decision = "SELL"
        risk_status = "Aligned"
    else:
        decision = "HOLD"
        risk_status = "Risk Watch"

    created_at = payload.get("createdAt") or payload.get("timestamp") or now_iso()

    return {
        "eventType": "NEURAL_BRAIN_SCORECARD",
        "status": "OK",
        "engineVersion": NEURAL_BRAIN_VERSION,
        "phase": PHASE,
        "source": "fastapi_neural_brain_phase3",
        "symbol": normalize_symbol(payload.get("symbol") or signal.get("symbol")),
        "timeframe": normalize_timeframe(payload.get("timeframe") or signal.get("timeframe")),
        "buyConfidence": buy,
        "sellConfidence": sell,
        "targetHitProbability": target_hit,
        "reversalRisk": reversal,
        "chopRisk": chop,
        "decisionStrength": strength,
        "bestDirection": best_direction,
        "decision": decision,
        "riskStatus": risk_status,
        "noTradeWarning": risk_watch,
        "inputs": {
            "scorecards": scorecards,
            "signal": signal,
            "unifiedIntelligence": unified,
        },
        "explain": [
            f"Buy {buy:.1f} / Sell {sell:.1f}",
            f"Target hit {target_hit:.1f}",
            f"Reversal risk {reversal:.1f}",
            f"Chop risk {chop:.1f}",
            f"Decision {decision}",
        ],
        "createdAt": created_at,
    }


def _load_online_model() -> Dict[str, Any]:
    if ONLINE_MODEL_PATH.exists():
        try:
            return normalize_online_model(json.loads(ONLINE_MODEL_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass

    return new_online_model()


def _save_online_model(model: Dict[str, Any]) -> None:
    ONLINE_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    _model = normalize_online_model(model)
    ONLINE_MODEL_PATH.write_text(json.dumps(_model, indent=2, sort_keys=True), encoding="utf-8")


def get_scope_from_model(model: Dict[str, Any], key: str, symbol: Any = None, timeframe: Any = None) -> Dict[str, Any]:
    model = normalize_online_model(model)

    if key == "global":
        return normalize_online_scope(model.get("global"), "global")

    scopes = model.setdefault("scopes", {})
    if key not in scopes or not isinstance(scopes.get(key), dict):
        if key.startswith("symbol_timeframe:"):
            scopes[key] = empty_online_scope(key, symbol, timeframe)
        elif key.startswith("symbol:"):
            scopes[key] = empty_online_scope(key, symbol, None)
        else:
            scopes[key] = empty_online_scope(key)

    return normalize_online_scope(scopes[key], key)


def get_online_brain_status(symbol: Any = None, timeframe: Any = None) -> Dict[str, Any]:
    model = normalize_online_model(_load_online_model())
    symbol_norm = normalize_symbol(symbol) if symbol else None
    timeframe_norm = normalize_timeframe(timeframe) if timeframe else None

    active_symbol_key = symbol_scope_key(symbol_norm) if symbol_norm else None
    active_tf_key = symbol_timeframe_scope_key(symbol_norm, timeframe_norm) if symbol_norm and timeframe_norm else None

    active_scopes: Dict[str, Any] = {
        "global": model.get("global"),
    }

    if active_symbol_key:
        active_scopes["symbol"] = get_scope_from_model(model, active_symbol_key, symbol_norm, None)

    if active_tf_key:
        active_scopes["symbolTimeframe"] = get_scope_from_model(model, active_tf_key, symbol_norm, timeframe_norm)

    model["activeContext"] = {
        "symbol": symbol_norm,
        "timeframe": timeframe_norm,
        "symbolScopeKey": active_symbol_key,
        "symbolTimeframeScopeKey": active_tf_key,
        "scopes": active_scopes,
    }

    model["modelPath"] = str(ONLINE_MODEL_PATH)
    return model


def _update_task(scope: Dict[str, Any], task: str, value: Any) -> None:
    if value is None:
        return

    tasks = scope.setdefault("tasks", {})
    item = tasks.setdefault(task, empty_task())

    item["seen"] = int(item.get("seen") or 0) + 1
    if bool(value):
        item["positive"] = int(item.get("positive") or 0) + 1

    seen = max(1, int(item.get("seen") or 1))
    item["rate"] = round((int(item.get("positive") or 0) / seen) * 100.0, 4)


def _update_scope(scope: Dict[str, Any], outcome: Dict[str, Any], updated_at: str) -> Dict[str, Any]:
    scope["trainedExamples"] = int(scope.get("trainedExamples") or 0) + 1
    _update_task(scope, "targetHit", outcome.get("targetHit"))
    _update_task(scope, "reversal", outcome.get("reversalHappened"))
    _update_task(scope, "chop", outcome.get("chopHappened"))
    _update_task(scope, "buyWin", outcome.get("buyWin"))
    _update_task(scope, "sellWin", outcome.get("sellWin"))
    scope["onlineReady"] = int(scope.get("trainedExamples") or 0) >= ONLINE_READY_MIN_EXAMPLES
    scope["updatedAt"] = updated_at
    return scope


def update_online_learning_scopes(symbol: Any, timeframe: Any, outcome: Dict[str, Any], updated_at: str) -> Dict[str, Any]:
    model = normalize_online_model(_load_online_model())
    symbol_norm = normalize_symbol(symbol)
    timeframe_norm = normalize_timeframe(timeframe)

    global_scope = get_scope_from_model(model, "global")
    global_scope = _update_scope(global_scope, outcome, updated_at)
    model["global"] = global_scope

    sym_key = symbol_scope_key(symbol_norm)
    sym_scope = get_scope_from_model(model, sym_key, symbol_norm, None)
    sym_scope = _update_scope(sym_scope, outcome, updated_at)
    model["scopes"][sym_key] = sym_scope

    tf_key = symbol_timeframe_scope_key(symbol_norm, timeframe_norm)
    tf_scope = get_scope_from_model(model, tf_key, symbol_norm, timeframe_norm)
    tf_scope = _update_scope(tf_scope, outcome, updated_at)
    model["scopes"][tf_key] = tf_scope

    model["trainedExamples"] = int(global_scope.get("trainedExamples") or 0)
    model["onlineReady"] = bool(global_scope.get("onlineReady"))
    model["updatedAt"] = updated_at

    _save_online_model(model)
    return get_online_brain_status(symbol_norm, timeframe_norm)


def task_rate(scope: Dict[str, Any], task: str, fallback: float) -> float:
    item = (scope.get("tasks") or {}).get(task) or {}
    rate = item.get("rate")
    if isinstance(rate, (int, float)) and math.isfinite(float(rate)):
        return float(rate)

    seen = int(item.get("seen") or 0)
    positive = int(item.get("positive") or 0)
    if seen > 0:
        return (positive / seen) * 100.0

    return fallback


def blend_rates(base: float, global_scope: Dict[str, Any], symbol_scope: Optional[Dict[str, Any]], tf_scope: Optional[Dict[str, Any]], task: str) -> float:
    weighted_sum = base * 0.55
    weight_total = 0.55

    if global_scope and int(global_scope.get("trainedExamples") or 0) > 0:
        weighted_sum += task_rate(global_scope, task, base) * 0.15
        weight_total += 0.15

    if symbol_scope and int(symbol_scope.get("trainedExamples") or 0) > 0:
        weighted_sum += task_rate(symbol_scope, task, base) * 0.15
        weight_total += 0.15

    if tf_scope and int(tf_scope.get("trainedExamples") or 0) > 0:
        weighted_sum += task_rate(tf_scope, task, base) * 0.15
        weight_total += 0.15

    return round(weighted_sum / max(weight_total, 0.000001), 4)


def apply_online_brain_prediction(scorecard: Dict[str, Any]) -> Dict[str, Any]:
    symbol = scorecard.get("symbol")
    timeframe = scorecard.get("timeframe")
    online = get_online_brain_status(symbol, timeframe)
    active_scopes = online.get("activeContext", {}).get("scopes", {})

    global_scope = active_scopes.get("global") or online.get("global") or {}
    symbol_scope = active_scopes.get("symbol")
    tf_scope = active_scopes.get("symbolTimeframe")

    blended = dict(scorecard)
    any_scope_ready = any(
        bool(scope and scope.get("onlineReady"))
        for scope in [global_scope, symbol_scope, tf_scope]
    )

    if any_scope_ready:
        blended["targetHitProbability"] = blend_rates(
            scorecard["targetHitProbability"],
            global_scope,
            symbol_scope,
            tf_scope,
            "targetHit",
        )
        blended["reversalRisk"] = blend_rates(
            scorecard["reversalRisk"],
            global_scope,
            symbol_scope,
            tf_scope,
            "reversal",
        )
        blended["chopRisk"] = blend_rates(
            scorecard["chopRisk"],
            global_scope,
            symbol_scope,
            tf_scope,
            "chop",
        )
        blended["onlineLearningMode"] = "blended_global_symbol_timeframe"
    else:
        blended["onlineLearningMode"] = "observer_only"

    blended["onlineLearning"] = {
        "phase": PHASE,
        "onlineReady": bool(any_scope_ready),
        "trainedExamples": int((global_scope or {}).get("trainedExamples") or 0),
        "scopeExamples": {
            "global": int((global_scope or {}).get("trainedExamples") or 0),
            "symbol": int((symbol_scope or {}).get("trainedExamples") or 0),
            "symbolTimeframe": int((tf_scope or {}).get("trainedExamples") or 0),
        },
        "scopeKeys": {
            "symbol": symbol_scope_key(symbol),
            "symbolTimeframe": symbol_timeframe_scope_key(symbol, timeframe),
        },
        "blended": {
            "decisionStrength": blended.get("decisionStrength"),
            "targetHitProbability": blended.get("targetHitProbability"),
            "reversalRisk": blended.get("reversalRisk"),
            "chopRisk": blended.get("chopRisk"),
        },
    }

    return blended


def save_neural_brain_snapshot(payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_db()

    scorecard = base_scorecard_from_payload(payload)
    scorecard.update({
        key: payload[key]
        for key in [
            "buyConfidence",
            "sellConfidence",
            "targetHitProbability",
            "reversalRisk",
            "chopRisk",
            "decisionStrength",
            "bestDirection",
            "decision",
            "riskStatus",
        ]
        if key in payload
    })

    snapshot_id = str(payload.get("id") or payload.get("snapshotId") or uuid.uuid4())
    created_at = str(payload.get("createdAt") or now_iso())
    timestamp = str(payload.get("timestamp") or created_at)
    symbol = normalize_symbol(payload.get("symbol") or scorecard.get("symbol"))
    timeframe = normalize_timeframe(payload.get("timeframe") or scorecard.get("timeframe"))

    scorecard_inputs = payload.get("scorecardInputs") or {
        "inputs": scorecard.get("inputs"),
        "explain": scorecard.get("explain"),
        "request": payload,
    }

    with sqlite3.connect(DB_PATH) as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO neural_brain_snapshots (
                id,
                created_at,
                timestamp,
                symbol,
                timeframe,
                buy_confidence,
                sell_confidence,
                target_hit_probability,
                reversal_risk,
                chop_risk,
                decision_strength,
                best_direction,
                decision,
                risk_status,
                source,
                scorecard_inputs,
                raw_payload,
                outcome_json,
                labeled_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT outcome_json FROM neural_brain_snapshots WHERE id = ?), NULL), COALESCE((SELECT labeled_at FROM neural_brain_snapshots WHERE id = ?), NULL))
            """,
            (
                snapshot_id,
                created_at,
                timestamp,
                symbol,
                timeframe,
                clamp(scorecard.get("buyConfidence")),
                clamp(scorecard.get("sellConfidence")),
                clamp(scorecard.get("targetHitProbability")),
                clamp(scorecard.get("reversalRisk")),
                clamp(scorecard.get("chopRisk")),
                clamp(scorecard.get("decisionStrength")),
                str(scorecard.get("bestDirection") or "Neutral"),
                str(scorecard.get("decision") or "HOLD"),
                str(scorecard.get("riskStatus") or "Risk Watch"),
                str(payload.get("source") or scorecard.get("source") or "fastapi_snapshot_route"),
                safe_json(scorecard_inputs),
                safe_json(payload),
                snapshot_id,
                snapshot_id,
            ),
        )
        connection.commit()

    return {
        "eventType": "NEURAL_BRAIN_SNAPSHOT_SAVED",
        "status": "OK",
        "id": snapshot_id,
        "symbol": symbol,
        "timeframe": timeframe,
        "scopeKeys": {
            "global": "global",
            "symbol": symbol_scope_key(symbol),
            "symbolTimeframe": symbol_timeframe_scope_key(symbol, timeframe),
        },
        "createdAt": created_at,
    }


def list_neural_brain_snapshots(limit: int = 25, symbol: Any = None, timeframe: Any = None) -> Dict[str, Any]:
    ensure_db()
    safe_limit = max(1, min(250, int(limit or 25)))
    symbol_norm = normalize_symbol(symbol) if symbol else None
    timeframe_norm = normalize_timeframe(timeframe) if timeframe else None

    where_parts = []
    params: List[Any] = []

    if symbol_norm:
        where_parts.append("symbol = ?")
        params.append(symbol_norm)

    if timeframe_norm:
        where_parts.append("timeframe = ?")
        params.append(timeframe_norm)

    where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            f"""
            SELECT *
            FROM neural_brain_snapshots
            {where_sql}
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (*params, safe_limit),
        ).fetchall()

        total = connection.execute(
            f"SELECT COUNT(*) FROM neural_brain_snapshots {where_sql}",
            tuple(params),
        ).fetchone()[0]

        labeled = connection.execute(
            f"SELECT COUNT(*) FROM neural_brain_snapshots {where_sql} {'AND' if where_sql else 'WHERE'} outcome_json IS NOT NULL",
            tuple(params),
        ).fetchone()[0]

    return {
        "eventType": "NEURAL_BRAIN_SNAPSHOTS",
        "status": "OK",
        "count": len(rows),
        "total": int(total),
        "labeled": int(labeled),
        "filters": {
            "symbol": symbol_norm,
            "timeframe": timeframe_norm,
        },
        "snapshots": [row_to_snapshot(row) for row in rows],
        "createdAt": now_iso(),
    }


def get_memory_group_stats() -> Dict[str, Any]:
    ensure_db()

    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row

        by_symbol_rows = connection.execute(
            """
            SELECT
              symbol,
              COUNT(*) AS total,
              SUM(CASE WHEN outcome_json IS NOT NULL THEN 1 ELSE 0 END) AS labeled,
              MAX(created_at) AS latest
            FROM neural_brain_snapshots
            GROUP BY symbol
            ORDER BY total DESC, symbol ASC
            """
        ).fetchall()

        by_timeframe_rows = connection.execute(
            """
            SELECT
              symbol,
              timeframe,
              COUNT(*) AS total,
              SUM(CASE WHEN outcome_json IS NOT NULL THEN 1 ELSE 0 END) AS labeled,
              MAX(created_at) AS latest
            FROM neural_brain_snapshots
            GROUP BY symbol, timeframe
            ORDER BY total DESC, symbol ASC, timeframe ASC
            """
        ).fetchall()

    return {
        "bySymbol": [
            {
                "symbol": row["symbol"],
                "total": int(row["total"] or 0),
                "labeled": int(row["labeled"] or 0),
                "latest": row["latest"],
                "scopeKey": symbol_scope_key(row["symbol"]),
            }
            for row in by_symbol_rows
        ],
        "bySymbolTimeframe": [
            {
                "symbol": row["symbol"],
                "timeframe": row["timeframe"],
                "total": int(row["total"] or 0),
                "labeled": int(row["labeled"] or 0),
                "latest": row["latest"],
                "scopeKey": symbol_timeframe_scope_key(row["symbol"], row["timeframe"]),
            }
            for row in by_timeframe_rows
        ],
    }


def label_neural_brain_outcome(payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_db()

    snapshot_id = str(payload.get("id") or payload.get("snapshotId") or "").strip()
    if not snapshot_id:
        return {
            "eventType": "NEURAL_BRAIN_OUTCOME",
            "status": "ERROR",
            "error": "snapshot id is required",
            "createdAt": now_iso(),
        }

    outcome = {
        "targetHit": payload.get("targetHit"),
        "reversalHappened": payload.get("reversalHappened"),
        "chopHappened": payload.get("chopHappened"),
        "buyWin": payload.get("buyWin"),
        "sellWin": payload.get("sellWin"),
        "candlesToResult": payload.get("candlesToResult"),
        "maxDrawdownBeforeTarget": payload.get("maxDrawdownBeforeTarget"),
        "raw": payload,
    }

    labeled_at = now_iso()
    snapshot_symbol = None
    snapshot_timeframe = None

    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row
        existing = connection.execute(
            """
            SELECT symbol, timeframe
            FROM neural_brain_snapshots
            WHERE id = ?
            """,
            (snapshot_id,),
        ).fetchone()

        if existing:
            snapshot_symbol = existing["symbol"]
            snapshot_timeframe = existing["timeframe"]

        cursor = connection.execute(
            """
            UPDATE neural_brain_snapshots
            SET outcome_json = ?, labeled_at = ?
            WHERE id = ?
            """,
            (safe_json(outcome), labeled_at, snapshot_id),
        )
        connection.commit()
        updated = cursor.rowcount

    online = get_online_brain_status(snapshot_symbol, snapshot_timeframe)

    if updated and snapshot_symbol and snapshot_timeframe:
        online = update_online_learning_scopes(snapshot_symbol, snapshot_timeframe, outcome, labeled_at)

    return {
        "eventType": "NEURAL_BRAIN_OUTCOME",
        "status": "OK" if updated else "NOT_FOUND",
        "id": snapshot_id,
        "updated": bool(updated),
        "symbol": normalize_symbol(snapshot_symbol) if snapshot_symbol else None,
        "timeframe": normalize_timeframe(snapshot_timeframe) if snapshot_timeframe else None,
        "outcome": outcome,
        "online": online,
        "createdAt": labeled_at,
    }


def predict_neural_brain(payload: Dict[str, Any]) -> Dict[str, Any]:
    base = base_scorecard_from_payload(payload or {})
    scorecard = apply_online_brain_prediction(base)

    memory = save_neural_brain_snapshot({
        **scorecard,
        "symbol": scorecard.get("symbol"),
        "timeframe": scorecard.get("timeframe"),
        "scorecardInputs": {
            "inputs": scorecard.get("inputs"),
            "explain": scorecard.get("explain"),
            "onlineLearning": scorecard.get("onlineLearning"),
            "request": payload or {},
        },
        "source": "fastapi_neural_brain_predict_phase3_online",
        "timestamp": scorecard.get("createdAt") or now_iso(),
    })

    return {
        **scorecard,
        "memory": memory,
        "onlineStatus": get_online_brain_status(scorecard.get("symbol"), scorecard.get("timeframe")),
    }


def neural_brain_status(symbol: Any = None, timeframe: Any = None) -> Dict[str, Any]:
    ensure_db()

    symbol_norm = normalize_symbol(symbol) if symbol else None
    timeframe_norm = normalize_timeframe(timeframe) if timeframe else None

    with sqlite3.connect(DB_PATH) as connection:
        total = connection.execute("SELECT COUNT(*) FROM neural_brain_snapshots").fetchone()[0]
        labeled = connection.execute("SELECT COUNT(*) FROM neural_brain_snapshots WHERE outcome_json IS NOT NULL").fetchone()[0]

    online = get_online_brain_status(symbol_norm, timeframe_norm)

    return {
        "eventType": "NEURAL_BRAIN_STATUS",
        "status": "Ready",
        "engineVersion": NEURAL_BRAIN_VERSION,
        "modelType": PHASE,
        "trainedModelReady": bool(online.get("onlineReady")),
        "phase": PHASE,
        "routes": {
            "predict": "/api/neural-brain/predict",
            "status": "/api/neural-brain/status",
            "snapshots": "/api/neural-brain/snapshots",
            "outcomes": "/api/neural-brain/outcomes",
            "filteredSnapshotsExample": "/api/neural-brain/snapshots?symbol=BTCUSD&timeframe=5m",
            "filteredStatusExample": "/api/neural-brain/status?symbol=BTCUSD&timeframe=5m",
        },
        "memory": {
            "dbPath": str(DB_PATH),
            "totalSnapshots": int(total),
            "labeledSnapshots": int(labeled),
            "readyForTraining": int(labeled) >= ONLINE_READY_MIN_EXAMPLES,
            "groups": get_memory_group_stats(),
        },
        "online": online,
        "scopeBehavior": {
            "global": "Learns from every symbol and timeframe together.",
            "symbol": "Learns market-specific behavior such as BTCUSD vs MES1!.",
            "symbolTimeframe": "Learns exact chart context such as BTCUSD::5m or MES1!::5m.",
            "switchingCharts": "Snapshots and online stats remain stored when switching symbols/timeframes.",
        },
        "scorecards": [
            "buyConfidence",
            "sellConfidence",
            "reversalRisk",
            "targetHitProbability",
            "chopRisk",
            "bestDirection",
            "decision",
            "noTradeWarning",
        ],
        "outcomeLabelsPlanned": [
            "targetHit",
            "reversalHappened",
            "chopHappened",
            "candlesToResult",
            "maxDrawdownBeforeTarget",
        ],
        "note": "FastAPI Phase 3 route mirror. Saves Neural Brain snapshots by symbol/timeframe, accepts outcome labels, and runs global + symbol + symbol-timeframe online updates from labeled outcomes.",
        "createdAt": now_iso(),
    }
