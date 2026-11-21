"""Structured, append-preserving Neon archive for Ghost ML forecast records.

The existing ml_engine_memory state remains the authoritative runtime store.
This archive is an additional durable, queryable history.
"""
import json
import logging
import os

logger = logging.getLogger(__name__)


def archive_ghost_forecasts(records):
    """Idempotently archive records; never delete prior historical forecasts.

    Failures are logged without interrupting live predictions. The existing
    engine-state persistence remains authoritative.
    """
    if not os.getenv("DATABASE_URL", "").strip() or not records:
        return 0

    import psycopg

    valid = [r for r in records if isinstance(r, dict) and r.get("key")]
    if not valid:
        return 0

    with psycopg.connect(
        os.environ["DATABASE_URL"].strip(),
        connect_timeout=10,
        prepare_threshold=None,
    ) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ghost_ml_forecasts (
                forecast_key TEXT PRIMARY KEY,
                symbol TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                projection_time TEXT NOT NULL,
                status TEXT NOT NULL,
                predicted_direction TEXT,
                entry_close DOUBLE PRECISION,
                horizon INTEGER,
                direction_correct BOOLEAN,
                absolute_close_error DOUBLE PRECISION,
                record_json JSONB NOT NULL,
                archived_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS ghost_ml_forecasts_lookup_idx
            ON ghost_ml_forecasts (symbol, timeframe, projection_time DESC)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS ghost_ml_forecasts_status_idx
            ON ghost_ml_forecasts (status, updated_at DESC)
        """)
        for record in valid:
            evaluation = record.get("evaluation") or {}
            conn.execute("""
                INSERT INTO ghost_ml_forecasts (
                    forecast_key, symbol, timeframe, projection_time, status,
                    predicted_direction, entry_close, horizon,
                    direction_correct, absolute_close_error, record_json
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                )
                ON CONFLICT (forecast_key) DO UPDATE SET
                    status = EXCLUDED.status,
                    direction_correct = EXCLUDED.direction_correct,
                    absolute_close_error = EXCLUDED.absolute_close_error,
                    record_json = EXCLUDED.record_json,
                    updated_at = CURRENT_TIMESTAMP
                WHERE ghost_ml_forecasts.status <> 'evaluated'
            """, (
                str(record["key"]),
                str(record.get("symbol", "")),
                str(record.get("timeframe", "")),
                str(record.get("projectionTime", "")),
                str(record.get("status", "pending")),
                str(record.get("projectedDirection", "")),
                record.get("entryClose"),
                record.get("horizon"),
                evaluation.get("directionCorrect"),
                evaluation.get("closeError"),
                json.dumps(record, allow_nan=False),
            ))
    return len(valid)


def archive_ghost_forecasts_safely(records):
    try:
        return archive_ghost_forecasts(records)
    except Exception:
        logger.exception("Ghost ML forecast archive failed; primary engine state unaffected")
        return 0
