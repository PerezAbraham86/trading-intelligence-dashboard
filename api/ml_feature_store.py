from __future__ import annotations

import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


ML_FEATURE_STORE_FILE = Path(
    os.getenv("ML_FEATURE_STORE_FILE", "/tmp/trading_dashboard_ml_features.sqlite3")
)
ML_FEATURE_STORE_MAX_PENDING = int(os.getenv("ML_FEATURE_STORE_MAX_PENDING", "500"))
ML_FEATURE_STORE_DEFAULT_HORIZON_BARS = int(os.getenv("ML_FEATURE_STORE_HORIZON_BARS", "3"))


def utc_now_iso() -> str:
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


def to_epoch_seconds(value: Any) -> float:
    if value is None:
        return 0.0

    if isinstance(value, (int, float)):
        numeric = float(value)
        return numeric / 1000.0 if numeric > 1_000_000_000_000 else numeric

    text = str(value).strip()
    if not text:
        return 0.0

    try:
        numeric = float(text)
        return numeric / 1000.0 if numeric > 1_000_000_000_000 else numeric
    except Exception:
        pass

    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except Exception:
        return 0.0


def safe_json(value: Any) -> str:
    try:
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str)
    except Exception:
        return "{}"


def safe_json_loads(value: Any, fallback: Any = None) -> Any:
    if fallback is None:
        fallback = {}

    if value is None:
        return fallback

    if isinstance(value, (dict, list)):
        return value

    try:
        return json.loads(str(value))
    except Exception:
        return fallback


def normalize_direction(value: Any) -> int:
    text = str(value or "").lower().strip()

    if text in {"1", "bull", "bullish", "buy", "long", "up"}:
        return 1

    if text in {"-1", "bear", "bearish", "sell", "short", "down"}:
        return -1

    try:
        numeric = float(text)
        if numeric > 0:
            return 1
        if numeric < 0:
            return -1
    except Exception:
        pass

    return 0


def timeframe_seconds(timeframe: str) -> int:
    tf = str(timeframe or "1m").strip().lower()
    mapping = {
        "1m": 60,
        "3m": 180,
        "5m": 300,
        "10m": 600,
        "15m": 900,
        "30m": 1800,
        "1h": 3600,
        "2h": 7200,
        "4h": 14400,
        "1d": 86400,
        "1w": 604800,
    }

    return mapping.get(tf, 60)


def connect_ml_feature_store() -> sqlite3.Connection:
    ML_FEATURE_STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(ML_FEATURE_STORE_FILE), timeout=30)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_ml_feature_store() -> None:
    with connect_ml_feature_store() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS ml_feature_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feature_key TEXT NOT NULL UNIQUE,
                symbol TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                bar_time TEXT NOT NULL,
                bar_epoch REAL NOT NULL,
                created_at TEXT NOT NULL,

                provider TEXT,
                source TEXT,

                open REAL,
                high REAL,
                low REAL,
                close REAL,
                volume REAL,

                signal_type TEXT,
                signal_confidence REAL,
                bull_score REAL,
                bear_score REAL,
                net_bias REAL,

                overall_direction INTEGER,
                overall_confirmation_score REAL,
                overall_conflict_score REAL,
                smc_quality_score REAL,
                order_block_quality_score REAL,
                pd_quality_score REAL,
                liquidity_profile_quality_score REAL,
                hidden_context_quality_score REAL,
                nrtr_direction INTEGER,
                nrtr_agrees_with_smc INTEGER,
                ghost_direction INTEGER,
                ghost_confidence REAL,

                scorecards_json TEXT NOT NULL,
                ml_features_json TEXT NOT NULL,
                ml_feature_context_json TEXT NOT NULL,
                calculation_context_json TEXT NOT NULL,
                overlay_summary_json TEXT NOT NULL,
                ghost_candles_json TEXT NOT NULL,

                outcome_status TEXT NOT NULL DEFAULT 'pending',
                outcome_horizon_bars INTEGER NOT NULL DEFAULT 3,
                future_time TEXT,
                future_epoch REAL,
                future_close REAL,
                future_return REAL,
                future_return_pct REAL,
                future_direction INTEGER,
                direction_correct INTEGER,
                resolved_at TEXT
            )
            """
        )

        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_ml_feature_snapshots_symbol_tf_epoch
            ON ml_feature_snapshots(symbol, timeframe, bar_epoch)
            """
        )

        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_ml_feature_snapshots_outcome
            ON ml_feature_snapshots(outcome_status, symbol, timeframe, bar_epoch)
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS ml_feature_store_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )

        connection.execute(
            """
            INSERT OR REPLACE INTO ml_feature_store_meta(key, value, updated_at)
            VALUES('schema_version', 'ml_feature_store_v1', ?)
            """,
            (utc_now_iso(),),
        )

        connection.commit()


def get_latest_candle(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    candles = payload.get("candles")

    if isinstance(candles, list) and candles:
        latest = candles[-1]
        return latest if isinstance(latest, dict) else None

    return None


def get_scorecards(payload: Dict[str, Any]) -> Dict[str, Any]:
    scorecards = payload.get("scorecards")
    if isinstance(scorecards, dict) and scorecards:
        return scorecards

    overlay_payload = payload.get("overlayPayload")
    if isinstance(overlay_payload, dict):
        scorecards = overlay_payload.get("scorecards")
        if isinstance(scorecards, dict):
            return scorecards

    return {}


def get_ml_features(payload: Dict[str, Any]) -> Dict[str, Any]:
    ml_features = payload.get("mlFeatures")
    if isinstance(ml_features, dict) and ml_features:
        return ml_features

    overlay_payload = payload.get("overlayPayload")
    if isinstance(overlay_payload, dict):
        ml_features = overlay_payload.get("mlFeatures")
        if isinstance(ml_features, dict):
            return ml_features

    return {}


def get_ml_feature_context(payload: Dict[str, Any]) -> Dict[str, Any]:
    context = payload.get("mlFeatureContext")
    if isinstance(context, dict) and context:
        return context

    overlay_payload = payload.get("overlayPayload")
    if isinstance(overlay_payload, dict):
        context = overlay_payload.get("mlFeatureContext")
        if isinstance(context, dict):
            return context

    return {}


def get_calculation_context(payload: Dict[str, Any]) -> Dict[str, Any]:
    context = payload.get("calculationContext")
    if isinstance(context, dict) and context:
        return context

    overlay_payload = payload.get("overlayPayload")
    if isinstance(overlay_payload, dict):
        context = overlay_payload.get("calculationContext")
        if isinstance(context, dict):
            return context

    return {}


def get_overlay_summary(payload: Dict[str, Any]) -> Dict[str, Any]:
    overlay_payload = payload.get("overlayPayload")
    if isinstance(overlay_payload, dict):
        summary = overlay_payload.get("summary")
        if isinstance(summary, dict):
            return summary

    chart_overlays = payload.get("chartOverlays")
    if isinstance(chart_overlays, dict):
        summary = chart_overlays.get("summary")
        if isinstance(summary, dict):
            return summary

    return {}


def get_ghost_candles(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    ghost_candles = payload.get("ghostCandles")
    if isinstance(ghost_candles, list):
        return [item for item in ghost_candles if isinstance(item, dict)]

    overlay_payload = payload.get("overlayPayload")
    if isinstance(overlay_payload, dict):
        ghost_candles = overlay_payload.get("ghostCandles")
        if isinstance(ghost_candles, list):
            return [item for item in ghost_candles if isinstance(item, dict)]

    return []


def extract_signal_type(scorecards: Dict[str, Any], ml_features: Dict[str, Any], payload: Dict[str, Any]) -> str:
    direct = payload.get("signal") or payload.get("type")
    if direct:
        return str(direct).upper()

    overall = scorecards.get("overall") if isinstance(scorecards.get("overall"), dict) else {}
    direction = str(overall.get("direction") or "").lower()

    if direction == "bullish":
        return "BUY"
    if direction == "bearish":
        return "SELL"

    overall_direction = normalize_direction(ml_features.get("overallDirection"))
    if overall_direction > 0:
        return "BUY"
    if overall_direction < 0:
        return "SELL"

    return "NEUTRAL"


def build_feature_snapshot(payload: Dict[str, Any], horizon_bars: int = ML_FEATURE_STORE_DEFAULT_HORIZON_BARS) -> Optional[Dict[str, Any]]:
    latest_candle = get_latest_candle(payload)
    if not latest_candle:
        return None

    symbol = str(payload.get("symbol") or latest_candle.get("symbol") or "UNKNOWN").upper()
    timeframe = str(payload.get("timeframe") or latest_candle.get("timeframe") or "1m").lower()

    bar_time = str(
        latest_candle.get("time")
        or latest_candle.get("timestamp")
        or payload.get("createdAt")
        or utc_now_iso()
    )
    bar_epoch = to_epoch_seconds(latest_candle.get("epoch") or latest_candle.get("time") or latest_candle.get("timestamp") or bar_time)

    if bar_epoch <= 0:
        return None

    scorecards = get_scorecards(payload)
    ml_features = get_ml_features(payload)
    ml_feature_context = get_ml_feature_context(payload)
    calculation_context = get_calculation_context(payload)
    overlay_summary = get_overlay_summary(payload)
    ghost_candles = get_ghost_candles(payload)

    overall = scorecards.get("overall") if isinstance(scorecards.get("overall"), dict) else {}
    smc = scorecards.get("smc") if isinstance(scorecards.get("smc"), dict) else {}
    order_blocks = scorecards.get("orderBlocks") if isinstance(scorecards.get("orderBlocks"), dict) else {}
    pd_zones = scorecards.get("pdZones") if isinstance(scorecards.get("pdZones"), dict) else {}
    liquidity_profile = scorecards.get("liquidityProfile") if isinstance(scorecards.get("liquidityProfile"), dict) else {}
    hidden_context = scorecards.get("hiddenContext") if isinstance(scorecards.get("hiddenContext"), dict) else {}
    nrtr = scorecards.get("nrtr") if isinstance(scorecards.get("nrtr"), dict) else {}
    ghost = scorecards.get("ghost") if isinstance(scorecards.get("ghost"), dict) else {}

    overall_direction = normalize_direction(
        ml_features.get("overallDirection", overall.get("direction"))
    )
    nrtr_direction = normalize_direction(
        ml_features.get("nrtrDirection", nrtr.get("direction"))
    )
    ghost_direction = normalize_direction(
        ml_features.get("ghostDirection", ghost.get("direction"))
    )

    feature_key = f"{symbol}|{timeframe}|{int(bar_epoch)}"

    signal_type = extract_signal_type(scorecards, ml_features, payload)

    return {
        "feature_key": feature_key,
        "symbol": symbol,
        "timeframe": timeframe,
        "bar_time": bar_time,
        "bar_epoch": bar_epoch,
        "created_at": utc_now_iso(),
        "provider": payload.get("provider"),
        "source": payload.get("source"),

        "open": to_float(latest_candle.get("open")),
        "high": to_float(latest_candle.get("high")),
        "low": to_float(latest_candle.get("low")),
        "close": to_float(latest_candle.get("close")),
        "volume": to_float(latest_candle.get("volume")),

        "signal_type": signal_type,
        "signal_confidence": to_float(payload.get("confidence", overall.get("confirmationScore"))),
        "bull_score": to_float(payload.get("bullScore", overall.get("bullScore"))),
        "bear_score": to_float(payload.get("bearScore", overall.get("bearScore"))),
        "net_bias": to_float(payload.get("netBias", overall.get("netBias"))),

        "overall_direction": overall_direction,
        "overall_confirmation_score": to_float(ml_features.get("overallConfirmationScore", overall.get("confirmationScore"))),
        "overall_conflict_score": to_float(ml_features.get("overallConflictScore", overall.get("conflictScore"))),
        "smc_quality_score": to_float(ml_features.get("smcQualityScore", smc.get("qualityScore"))),
        "order_block_quality_score": to_float(ml_features.get("orderBlockQualityScore", order_blocks.get("qualityScore"))),
        "pd_quality_score": to_float(ml_features.get("pdQualityScore", pd_zones.get("qualityScore"))),
        "liquidity_profile_quality_score": to_float(ml_features.get("liquidityProfileQualityScore", liquidity_profile.get("qualityScore"))),
        "hidden_context_quality_score": to_float(ml_features.get("hiddenContextQualityScore", hidden_context.get("qualityScore"))),
        "nrtr_direction": nrtr_direction,
        "nrtr_agrees_with_smc": 1 if bool(ml_features.get("nrtrAgreesWithSmc", nrtr.get("agreesWithSmc"))) else 0,
        "ghost_direction": ghost_direction,
        "ghost_confidence": to_float(ml_features.get("ghostConfidence", ghost.get("confidence"))),

        "scorecards_json": safe_json(scorecards),
        "ml_features_json": safe_json(ml_features),
        "ml_feature_context_json": safe_json(ml_feature_context),
        "calculation_context_json": safe_json(calculation_context),
        "overlay_summary_json": safe_json(overlay_summary),
        "ghost_candles_json": safe_json(ghost_candles),

        "outcome_horizon_bars": int(horizon_bars or ML_FEATURE_STORE_DEFAULT_HORIZON_BARS),
    }


def record_ml_feature_snapshot(
    payload: Dict[str, Any],
    *,
    horizon_bars: int = ML_FEATURE_STORE_DEFAULT_HORIZON_BARS,
) -> Dict[str, Any]:
    initialize_ml_feature_store()

    snapshot = build_feature_snapshot(payload, horizon_bars=horizon_bars)
    if not snapshot:
        return {
            "recorded": False,
            "reason": "no_latest_candle",
        }

    columns = [
        "feature_key",
        "symbol",
        "timeframe",
        "bar_time",
        "bar_epoch",
        "created_at",
        "provider",
        "source",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "signal_type",
        "signal_confidence",
        "bull_score",
        "bear_score",
        "net_bias",
        "overall_direction",
        "overall_confirmation_score",
        "overall_conflict_score",
        "smc_quality_score",
        "order_block_quality_score",
        "pd_quality_score",
        "liquidity_profile_quality_score",
        "hidden_context_quality_score",
        "nrtr_direction",
        "nrtr_agrees_with_smc",
        "ghost_direction",
        "ghost_confidence",
        "scorecards_json",
        "ml_features_json",
        "ml_feature_context_json",
        "calculation_context_json",
        "overlay_summary_json",
        "ghost_candles_json",
        "outcome_horizon_bars",
    ]

    placeholders = ",".join("?" for _ in columns)
    update_columns = [
        column for column in columns
        if column not in {"feature_key", "outcome_horizon_bars"}
    ]

    update_clause = ",".join(f"{column}=excluded.{column}" for column in update_columns)

    with connect_ml_feature_store() as connection:
        connection.execute(
            f"""
            INSERT INTO ml_feature_snapshots({",".join(columns)})
            VALUES({placeholders})
            ON CONFLICT(feature_key) DO UPDATE SET
                {update_clause}
            """,
            [snapshot.get(column) for column in columns],
        )
        connection.commit()

    return {
        "recorded": True,
        "featureKey": snapshot["feature_key"],
        "symbol": snapshot["symbol"],
        "timeframe": snapshot["timeframe"],
        "barTime": snapshot["bar_time"],
        "outcomeHorizonBars": snapshot["outcome_horizon_bars"],
    }


def find_future_candle(candles: List[Dict[str, Any]], target_epoch: float) -> Optional[Dict[str, Any]]:
    for candle in candles:
        epoch = to_epoch_seconds(candle.get("epoch") or candle.get("time") or candle.get("timestamp"))

        if epoch >= target_epoch:
            return candle

    return None


def update_ml_feature_outcomes(
    symbol: str,
    timeframe: str,
    candles: List[Dict[str, Any]],
    *,
    max_pending: int = ML_FEATURE_STORE_MAX_PENDING,
) -> Dict[str, Any]:
    initialize_ml_feature_store()

    if not candles:
        return {
            "checked": 0,
            "resolved": 0,
        }

    normalized_symbol = str(symbol or "").upper()
    normalized_timeframe = str(timeframe or "1m").lower()
    seconds = timeframe_seconds(normalized_timeframe)

    with connect_ml_feature_store() as connection:
        pending_rows = connection.execute(
            """
            SELECT *
            FROM ml_feature_snapshots
            WHERE outcome_status = 'pending'
              AND symbol = ?
              AND timeframe = ?
            ORDER BY bar_epoch ASC
            LIMIT ?
            """,
            (normalized_symbol, normalized_timeframe, int(max_pending or ML_FEATURE_STORE_MAX_PENDING)),
        ).fetchall()

        resolved = 0

        for row in pending_rows:
            horizon_bars = int(row["outcome_horizon_bars"] or ML_FEATURE_STORE_DEFAULT_HORIZON_BARS)
            target_epoch = float(row["bar_epoch"]) + seconds * horizon_bars
            future_candle = find_future_candle(candles, target_epoch)

            if not future_candle:
                continue

            entry_close = to_float(row["close"])
            future_close = to_float(future_candle.get("close"))
            future_epoch = to_epoch_seconds(future_candle.get("epoch") or future_candle.get("time") or future_candle.get("timestamp"))
            future_time = str(future_candle.get("time") or future_candle.get("timestamp") or future_epoch)

            if entry_close <= 0 or future_close <= 0:
                continue

            future_return = future_close - entry_close
            future_return_pct = (future_return / entry_close) * 100.0
            future_direction = 1 if future_return > 0 else -1 if future_return < 0 else 0

            prediction_direction = int(row["overall_direction"] or 0)
            if prediction_direction == 0:
                prediction_direction = int(row["ghost_direction"] or 0)
            if prediction_direction == 0:
                prediction_direction = int(row["nrtr_direction"] or 0)

            direction_correct: Optional[int]
            if prediction_direction == 0 or future_direction == 0:
                direction_correct = None
            else:
                direction_correct = 1 if prediction_direction == future_direction else 0

            connection.execute(
                """
                UPDATE ml_feature_snapshots
                SET outcome_status = 'resolved',
                    future_time = ?,
                    future_epoch = ?,
                    future_close = ?,
                    future_return = ?,
                    future_return_pct = ?,
                    future_direction = ?,
                    direction_correct = ?,
                    resolved_at = ?
                WHERE id = ?
                """,
                (
                    future_time,
                    future_epoch,
                    future_close,
                    future_return,
                    future_return_pct,
                    future_direction,
                    direction_correct,
                    utc_now_iso(),
                    row["id"],
                ),
            )

            resolved += 1

        connection.commit()

    return {
        "checked": len(pending_rows),
        "resolved": resolved,
    }


def get_ml_feature_store_summary(symbol: Optional[str] = None, timeframe: Optional[str] = None) -> Dict[str, Any]:
    initialize_ml_feature_store()

    filters: List[str] = []
    params: List[Any] = []

    if symbol:
        filters.append("symbol = ?")
        params.append(str(symbol).upper())

    if timeframe:
        filters.append("timeframe = ?")
        params.append(str(timeframe).lower())

    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""

    with connect_ml_feature_store() as connection:
        total = connection.execute(
            f"SELECT COUNT(*) AS value FROM ml_feature_snapshots {where_clause}",
            params,
        ).fetchone()["value"]

        pending = connection.execute(
            f"SELECT COUNT(*) AS value FROM ml_feature_snapshots {where_clause + (' AND ' if where_clause else 'WHERE ') + 'outcome_status = ?'}",
            [*params, "pending"],
        ).fetchone()["value"]

        resolved = connection.execute(
            f"SELECT COUNT(*) AS value FROM ml_feature_snapshots {where_clause + (' AND ' if where_clause else 'WHERE ') + 'outcome_status = ?'}",
            [*params, "resolved"],
        ).fetchone()["value"]

        correct = connection.execute(
            f"SELECT COUNT(*) AS value FROM ml_feature_snapshots {where_clause + (' AND ' if where_clause else 'WHERE ') + 'direction_correct = 1'}",
            params,
        ).fetchone()["value"]

        incorrect = connection.execute(
            f"SELECT COUNT(*) AS value FROM ml_feature_snapshots {where_clause + (' AND ' if where_clause else 'WHERE ') + 'direction_correct = 0'}",
            params,
        ).fetchone()["value"]

        latest = connection.execute(
            f"""
            SELECT *
            FROM ml_feature_snapshots
            {where_clause}
            ORDER BY bar_epoch DESC
            LIMIT 1
            """,
            params,
        ).fetchone()

    accuracy = correct / (correct + incorrect) * 100.0 if correct + incorrect > 0 else 0.0

    return {
        "dbFile": str(ML_FEATURE_STORE_FILE),
        "symbol": symbol,
        "timeframe": timeframe,
        "total": int(total or 0),
        "pending": int(pending or 0),
        "resolved": int(resolved or 0),
        "correct": int(correct or 0),
        "incorrect": int(incorrect or 0),
        "directionAccuracy": round(accuracy, 2),
        "latest": row_to_public_dict(latest) if latest else None,
        "updatedAt": utc_now_iso(),
    }


def row_to_public_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    if row is None:
        return None

    return {
        "featureKey": row["feature_key"],
        "symbol": row["symbol"],
        "timeframe": row["timeframe"],
        "barTime": row["bar_time"],
        "createdAt": row["created_at"],
        "close": row["close"],
        "signalType": row["signal_type"],
        "overallDirection": row["overall_direction"],
        "overallConfirmationScore": row["overall_confirmation_score"],
        "overallConflictScore": row["overall_conflict_score"],
        "smcQualityScore": row["smc_quality_score"],
        "orderBlockQualityScore": row["order_block_quality_score"],
        "pdQualityScore": row["pd_quality_score"],
        "liquidityProfileQualityScore": row["liquidity_profile_quality_score"],
        "hiddenContextQualityScore": row["hidden_context_quality_score"],
        "nrtrDirection": row["nrtr_direction"],
        "ghostDirection": row["ghost_direction"],
        "ghostConfidence": row["ghost_confidence"],
        "outcomeStatus": row["outcome_status"],
        "futureTime": row["future_time"],
        "futureClose": row["future_close"],
        "futureReturn": row["future_return"],
        "futureReturnPct": row["future_return_pct"],
        "futureDirection": row["future_direction"],
        "directionCorrect": row["direction_correct"],
    }


def get_recent_ml_feature_snapshots(
    symbol: Optional[str] = None,
    timeframe: Optional[str] = None,
    limit: int = 50,
) -> Dict[str, Any]:
    initialize_ml_feature_store()

    filters: List[str] = []
    params: List[Any] = []

    if symbol:
        filters.append("symbol = ?")
        params.append(str(symbol).upper())

    if timeframe:
        filters.append("timeframe = ?")
        params.append(str(timeframe).lower())

    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
    safe_limit = max(1, min(int(limit or 50), 500))

    with connect_ml_feature_store() as connection:
        rows = connection.execute(
            f"""
            SELECT *
            FROM ml_feature_snapshots
            {where_clause}
            ORDER BY bar_epoch DESC
            LIMIT ?
            """,
            [*params, safe_limit],
        ).fetchall()

    return {
        "count": len(rows),
        "rows": [row_to_public_dict(row) for row in rows],
        "updatedAt": utc_now_iso(),
    }


# Initialize lazily at import time when possible. Failure is non-fatal because
# the API route will return the error in mlFeatureStore instead of breaking candles.
try:
    initialize_ml_feature_store()
except Exception as error:
    print(f"[ml_feature_store] initialization skipped: {error}")

