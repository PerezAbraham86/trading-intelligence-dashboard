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


NEURAL_BRAIN_VERSION = "phase3_fastapi_online_memory_v1"
PHASE = "phase3_river_style_online_updates"

DATA_DIR = Path(os.getenv("NEURAL_BRAIN_DATA_DIR", os.getenv("DATA_DIR", ".data")))
DB_PATH = Path(os.getenv("NEURAL_BRAIN_DB_PATH", str(DATA_DIR / "neural_brain_memory.sqlite3")))
ONLINE_MODEL_PATH = Path(os.getenv("NEURAL_BRAIN_ONLINE_MODEL_PATH", str(DATA_DIR / "neural_brain_online_model.json")))


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
    return text or "MES1!"


def normalize_timeframe(value: Any) -> str:
    text = str(value or "1m").strip().lower()
    return text or "1m"


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
            return json.loads(ONLINE_MODEL_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass

    return {
        "phase": PHASE,
        "onlineReady": False,
        "trainedExamples": 0,
        "tasks": {
            "targetHit": {"seen": 0, "positive": 0},
            "reversal": {"seen": 0, "positive": 0},
            "chop": {"seen": 0, "positive": 0},
            "buyWin": {"seen": 0, "positive": 0},
            "sellWin": {"seen": 0, "positive": 0},
        },
        "updatedAt": now_iso(),
    }


def _save_online_model(model: Dict[str, Any]) -> None:
    ONLINE_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    ONLINE_MODEL_PATH.write_text(json.dumps(model, indent=2, sort_keys=True), encoding="utf-8")


def get_online_brain_status() -> Dict[str, Any]:
    model = _load_online_model()
    trained = int(model.get("trainedExamples") or 0)
    model["onlineReady"] = trained >= 25
    model["modelPath"] = str(ONLINE_MODEL_PATH)
    return model


def _update_task(model: Dict[str, Any], task: str, value: Any) -> None:
    if value is None:
        return

    tasks = model.setdefault("tasks", {})
    item = tasks.setdefault(task, {"seen": 0, "positive": 0})

    item["seen"] = int(item.get("seen") or 0) + 1
    if bool(value):
        item["positive"] = int(item.get("positive") or 0) + 1

    seen = max(1, int(item.get("seen") or 1))
    item["rate"] = round((int(item.get("positive") or 0) / seen) * 100.0, 4)


def apply_online_brain_prediction(scorecard: Dict[str, Any]) -> Dict[str, Any]:
    online = get_online_brain_status()
    blended = dict(scorecard)

    # Observer-only until enough labels exist. After ready, use learned rates
    # as a small stabilizing adjustment, not a hard override.
    if online.get("onlineReady"):
        tasks = online.get("tasks") or {}

        target_rate = float((tasks.get("targetHit") or {}).get("rate") or scorecard.get("targetHitProbability") or 0)
        reversal_rate = float((tasks.get("reversal") or {}).get("rate") or scorecard.get("reversalRisk") or 0)
        chop_rate = float((tasks.get("chop") or {}).get("rate") or scorecard.get("chopRisk") or 0)

        blended["targetHitProbability"] = round((scorecard["targetHitProbability"] * 0.75) + (target_rate * 0.25), 4)
        blended["reversalRisk"] = round((scorecard["reversalRisk"] * 0.75) + (reversal_rate * 0.25), 4)
        blended["chopRisk"] = round((scorecard["chopRisk"] * 0.75) + (chop_rate * 0.25), 4)
        blended["onlineLearningMode"] = "blended"
    else:
        blended["onlineLearningMode"] = "observer_only"

    blended["onlineLearning"] = {
        "phase": PHASE,
        "onlineReady": bool(online.get("onlineReady")),
        "trainedExamples": int(online.get("trainedExamples") or 0),
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
                normalize_symbol(payload.get("symbol") or scorecard.get("symbol")),
                normalize_timeframe(payload.get("timeframe") or scorecard.get("timeframe")),
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
        "symbol": normalize_symbol(payload.get("symbol") or scorecard.get("symbol")),
        "timeframe": normalize_timeframe(payload.get("timeframe") or scorecard.get("timeframe")),
        "createdAt": created_at,
    }


def list_neural_brain_snapshots(limit: int = 25) -> Dict[str, Any]:
    ensure_db()
    safe_limit = max(1, min(250, int(limit or 25)))

    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT *
            FROM neural_brain_snapshots
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()

        total = connection.execute("SELECT COUNT(*) FROM neural_brain_snapshots").fetchone()[0]
        labeled = connection.execute("SELECT COUNT(*) FROM neural_brain_snapshots WHERE outcome_json IS NOT NULL").fetchone()[0]

    return {
        "eventType": "NEURAL_BRAIN_SNAPSHOTS",
        "status": "OK",
        "count": len(rows),
        "total": int(total),
        "labeled": int(labeled),
        "snapshots": [row_to_snapshot(row) for row in rows],
        "createdAt": now_iso(),
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

    with sqlite3.connect(DB_PATH) as connection:
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

    if updated:
        model = _load_online_model()
        model["trainedExamples"] = int(model.get("trainedExamples") or 0) + 1
        _update_task(model, "targetHit", outcome.get("targetHit"))
        _update_task(model, "reversal", outcome.get("reversalHappened"))
        _update_task(model, "chop", outcome.get("chopHappened"))
        _update_task(model, "buyWin", outcome.get("buyWin"))
        _update_task(model, "sellWin", outcome.get("sellWin"))
        model["onlineReady"] = int(model.get("trainedExamples") or 0) >= 25
        model["updatedAt"] = labeled_at
        _save_online_model(model)

    return {
        "eventType": "NEURAL_BRAIN_OUTCOME",
        "status": "OK" if updated else "NOT_FOUND",
        "id": snapshot_id,
        "updated": bool(updated),
        "outcome": outcome,
        "online": get_online_brain_status(),
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
        "onlineStatus": get_online_brain_status(),
    }


def neural_brain_status() -> Dict[str, Any]:
    ensure_db()

    with sqlite3.connect(DB_PATH) as connection:
        total = connection.execute("SELECT COUNT(*) FROM neural_brain_snapshots").fetchone()[0]
        labeled = connection.execute("SELECT COUNT(*) FROM neural_brain_snapshots WHERE outcome_json IS NOT NULL").fetchone()[0]

    return {
        "eventType": "NEURAL_BRAIN_STATUS",
        "status": "Ready",
        "engineVersion": NEURAL_BRAIN_VERSION,
        "modelType": PHASE,
        "trainedModelReady": bool(get_online_brain_status().get("onlineReady")),
        "phase": PHASE,
        "routes": {
            "predict": "/api/neural-brain/predict",
            "status": "/api/neural-brain/status",
            "snapshots": "/api/neural-brain/snapshots",
            "outcomes": "/api/neural-brain/outcomes",
        },
        "memory": {
            "dbPath": str(DB_PATH),
            "totalSnapshots": int(total),
            "labeledSnapshots": int(labeled),
            "readyForTraining": int(labeled) >= 25,
        },
        "online": get_online_brain_status(),
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
        "note": "FastAPI Phase 3 route mirror. Saves Neural Brain snapshots, accepts outcome labels, and runs River-style online updates from labeled outcomes.",
        "createdAt": now_iso(),
    }
