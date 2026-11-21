"""Leakage-aware, read-only shadow calibration from Neon Ghost ML history.

This candidate never changes live forecasts. Only forecasts evaluated before
the validation window are eligible for fitting. Scores are persisted for audit.
"""
import json
import logging
import math
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def _probability(successes, count, prior=0.5, strength=12):
    return (successes + prior * strength) / (count + strength)


def evaluate_shadow_candidate(min_samples=60, validation_fraction=0.25):
    """Train a smoothed bucket-direction calibrator and score later forecasts.

    Historical labels are final-direction correctness, not candle-by-candle
    accuracy. No live adjustment is made.
    """
    if not os.getenv("DATABASE_URL", "").strip():
        return {"status": "unavailable", "reason": "DATABASE_URL missing"}

    import psycopg
    with psycopg.connect(os.environ["DATABASE_URL"].strip(), connect_timeout=10, prepare_threshold=None) as conn:
        rows = conn.execute("""
            SELECT forecast_key, projection_time, record_json
            FROM ghost_ml_forecasts
            WHERE status = 'evaluated' AND direction_correct IS NOT NULL
            ORDER BY projection_time ASC, forecast_key ASC
        """).fetchall()

        examples = []
        for key, timestamp, raw in rows:
            record = raw if isinstance(raw, dict) else json.loads(raw)
            evaluation = record.get("evaluation") or {}
            if not isinstance(evaluation.get("directionCorrect"), bool):
                continue
            # Use evaluation completion as the knowledge-availability boundary.
            evaluated_at = record.get("evaluatedAt")
            if not evaluated_at:
                continue
            examples.append({
                "key": key,
                "time": str(timestamp),
                "evaluated_at": str(evaluated_at),
                "bucket": str(record.get("featureBucket") or "unknown"),
                "label": int(evaluation["directionCorrect"]),
            })

        n = len(examples)
        if n < min_samples:
            return {"status": "insufficient_data", "samples": n, "minimum": min_samples}
        cut = max(1, int(n * (1 - validation_fraction)))
        train, validation = examples[:cut], examples[cut:]
        if not validation:
            return {"status": "insufficient_validation_data"}

        # Exclude training outcomes not yet known at validation start.
        validation_start = validation[0]["time"]
        eligible_train = [x for x in train if x["evaluated_at"] <= validation_start]
        if len(eligible_train) < 30:
            return {"status": "insufficient_mature_training_data", "samples": len(eligible_train)}

        total_success = sum(x["label"] for x in eligible_train)
        prior = _probability(total_success, len(eligible_train))
        buckets = {}
        for x in eligible_train:
            count, successes = buckets.get(x["bucket"], (0, 0))
            buckets[x["bucket"]] = (count + 1, successes + x["label"])

        predictions = []
        for x in validation:
            count, successes = buckets.get(x["bucket"], (0, 0))
            candidate = _probability(successes, count, prior, 12)
            predictions.append((x["label"], prior, candidate))

        baseline_brier = sum((y - base) ** 2 for y, base, _ in predictions) / len(predictions)
        candidate_brier = sum((y - candidate) ** 2 for y, _, candidate in predictions) / len(predictions)
        report = {
            "status": "evaluated",
            "model": "smoothed_bucket_direction_calibrator_v1",
            "mode": "shadow_only",
            "train_samples": len(eligible_train),
            "validation_samples": len(validation),
            "validation_start": validation_start,
            "baseline_brier": round(baseline_brier, 6),
            "candidate_brier": round(candidate_brier, 6),
            "improvement": round(baseline_brier - candidate_brier, 6),
            "candidate_better": candidate_brier < baseline_brier,
            "note": "Single chronological holdout; not sufficient to authorize live deployment.",
        }
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ghost_ml_shadow_training_runs (
                id BIGSERIAL PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                model_name TEXT NOT NULL,
                mode TEXT NOT NULL,
                report_json JSONB NOT NULL
            )
        """)
        conn.execute("""
            INSERT INTO ghost_ml_shadow_training_runs (model_name, mode, report_json)
            VALUES (%s, %s, %s::jsonb)
        """, (report["model"], "shadow_only", json.dumps(report)))
        return report


if __name__ == "__main__":
    print(json.dumps(evaluate_shadow_candidate(), indent=2))
