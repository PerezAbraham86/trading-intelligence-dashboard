"""Shadow-only XGBoost walk-forward experiment for Ghost ML.

No live predictions or model weights are changed. Requires existing Neon
ghost_ml_forecasts archive. Run: python -m api.ghost_ml_xgb_shadow
"""
import json
import math
import os
from datetime import datetime, timezone

FEATURES = (
    "smcCount", "liquidityCount", "zoneCount", "orderBlockCount",
    "fvgCount", "pdZoneCount", "alphaBullPressurePct", "alphaBearPressurePct", "alphaPressureNet",
    "bullishSmcCount", "bearishSmcCount", "bullishLiquidityCount",
    "bearishLiquidityCount", "bullishOrderBlockCount", "bearishOrderBlockCount",
    "bullishFvgCount", "bearishFvgCount",
)
CATEGORICAL = ("smcDirection", "liquidityDirection", "orderBlockDirection",
               "fvgDirection", "pdDirection", "dlmDirection", "alphaDirection")


def _timestamp(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def _vector(record):
    features = record.get("features") or {}
    values = []
    for key in FEATURES:
        value = features.get(key)
        try:
            number = float(value)
            values.append(number if math.isfinite(number) else float("nan"))
        except (TypeError, ValueError):
            values.append(float("nan"))
    for key in CATEGORICAL:
        values.append({"bearish": -1.0, "neutral": 0.0, "bullish": 1.0}.get(str(features.get(key, "")).lower(), float("nan")))
    values.append({"bearish": -1.0, "neutral": 0.0, "bullish": 1.0}.get(str(record.get("projectedDirection", "")).lower(), 0.0))
    try:
        values.append(float(record.get("avgConfidence")))
    except (TypeError, ValueError):
        values.append(float("nan"))
    return values


def run_shadow_xgboost(min_train=60, test_size=20, max_folds=5):
    if not os.getenv("DATABASE_URL", "").strip():
        return {"status": "unavailable", "reason": "DATABASE_URL missing"}
    import numpy as np
    import psycopg
    from xgboost import XGBClassifier

    with psycopg.connect(os.environ["DATABASE_URL"].strip(), connect_timeout=10, prepare_threshold=None) as conn:
        rows = conn.execute("""
            SELECT forecast_key, record_json FROM ghost_ml_forecasts
            WHERE status = 'evaluated' AND direction_correct IS NOT NULL
            ORDER BY projection_time ASC, forecast_key ASC
        """).fetchall()
        examples = []
        for key, raw in rows:
            record = raw if isinstance(raw, dict) else json.loads(raw)
            evaluation = record.get("evaluation") or {}
            start = _timestamp(record.get("projectionTime"))
            known = _timestamp(record.get("evaluatedAt"))
            label = evaluation.get("directionCorrect")
            if not start or not known or not isinstance(label, bool):
                continue
            examples.append({"key": key, "start": start, "known": known,
                             "label": int(label), "vector": _vector(record)})
        # Fixed non-overlapping validation blocks; expanding train, purged by
        # actual evaluation completion timestamp to avoid overlapping horizons.
        folds = []
        last_start = len(examples) - test_size
        starts = list(range(min_train, last_start + 1, test_size))
        for cut in starts[-max_folds:]:
            test = examples[cut:cut + test_size]
            train = [x for x in examples[:cut] if x["known"] < test[0]["start"]]
            if len(train) < min_train or len({x["label"] for x in train}) < 2:
                continue
            x_train = np.asarray([x["vector"] for x in train], dtype=float)
            y_train = np.asarray([x["label"] for x in train])
            x_test = np.asarray([x["vector"] for x in test], dtype=float)
            y_test = np.asarray([x["label"] for x in test])
            baseline = (sum(y_train) + 6) / (len(y_train) + 12)
            model = XGBClassifier(
                n_estimators=35, max_depth=2, learning_rate=0.035,
                subsample=1.0, colsample_bytree=1.0, min_child_weight=8,
                reg_lambda=15, random_state=42, n_jobs=1,
                objective="binary:logistic", eval_metric="logloss",
            )
            model.fit(x_train, y_train)
            predicted = model.predict_proba(x_test)[:, 1]
            candidate_brier = float(np.mean((predicted - y_test) ** 2))
            baseline_brier = float(np.mean((baseline - y_test) ** 2))
            folds.append({
                "train_samples": len(train), "test_samples": len(test),
                "test_start": test[0]["start"].isoformat(),
                "test_end": test[-1]["start"].isoformat(),
                "baseline_brier": round(baseline_brier, 6),
                "candidate_brier": round(candidate_brier, 6),
            })

        report = {
            "status": "evaluated" if len(folds) >= 2 else "insufficient_walk_forward_folds",
            "model": "xgboost_ghost_direction_shadow_v1",
            "mode": "shadow_only", "available_samples": len(examples),
            "folds": folds, "live_promotion_allowed": False,
        }
        if folds:
            weights = [f["test_samples"] for f in folds]
            total = sum(weights)
            report["baseline_brier"] = round(sum(f["baseline_brier"] * w for f, w in zip(folds, weights)) / total, 6)
            report["candidate_brier"] = round(sum(f["candidate_brier"] * w for f, w in zip(folds, weights)) / total, 6)
            report["candidate_better"] = report["candidate_brier"] < report["baseline_brier"]
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
        """, (report["model"], report["mode"], json.dumps(report)))
        return report


if __name__ == "__main__":
    print(json.dumps(run_shadow_xgboost(), indent=2))
