"""Optional BTCUSD AI research layer. Read-only: never submits orders."""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import threading
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from api.ml_feature_store import connect_ml_feature_store, initialize_ml_feature_store

FEATURES = ("open", "high", "low", "close", "volume", "signal_confidence",
            "bull_score", "bear_score", "net_bias", "overall_direction",
            "overall_confirmation_score", "overall_conflict_score",
            "smc_quality_score", "order_block_quality_score", "pd_quality_score",
            "liquidity_profile_quality_score", "nrtr_direction",
            "ghost_direction", "ghost_confidence")
MODEL_PATH = Path(os.getenv("BTCUSD_XGB_MODEL_PATH", "/tmp/btcusd_xgb_model.json"))
METADATA_PATH = Path(os.getenv("BTCUSD_XGB_METADATA_PATH", "/tmp/btcusd_xgb_metadata.json"))
MIN_ROWS = max(100, int(os.getenv("BTCUSD_XGB_MIN_ROWS", "300")))


def _rows(timeframe="5m", limit=10000):
    initialize_ml_feature_store()
    with connect_ml_feature_store() as db:
        rows = db.execute(
            """SELECT * FROM ml_feature_snapshots
               WHERE symbol = 'BTCUSD' AND timeframe = ?
                 AND provider = 'alpaca' AND outcome_status = 'resolved' AND future_direction IN (-1, 1)
               ORDER BY bar_epoch DESC LIMIT ?""", (timeframe, min(int(limit), 50000))
        ).fetchall()
    return [dict(row) for row in reversed(rows)]


def _vector(row):
    return [float(row.get(k) or 0) for k in FEATURES]


_training_lock = threading.Lock()


def train_btcusd_model(timeframe="5m"):
    if not _training_lock.acquire(blocking=False):
        return {"status": "Busy"}
    try:
        return _train_btcusd_model(timeframe)
    finally:
        _training_lock.release()


def _train_btcusd_model(timeframe="5m"):
    """Chronological holdout, no future outcome columns in model features."""
    if timeframe not in ("1m", "3m", "5m", "10m", "15m", "30m", "1h"):
        return {"status": "Rejected", "reason": "Unsupported timeframe"}
    if os.getenv("BTCUSD_XGB_TRAINING_ENABLED", "false").lower() != "true":
        return {"status": "Disabled", "reason": "Set BTCUSD_XGB_TRAINING_ENABLED=true to allow training"}
    try:
        from xgboost import XGBClassifier
        from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
    except ImportError:
        return {"status": "Unavailable", "reason": "Install optional xgboost and scikit-learn dependencies"}
    rows = _rows(timeframe)
    # Remove overlapping label horizons around the train/test boundary.
    if len(rows) < MIN_ROWS:
        return {"status": "InsufficientData", "resolvedRows": len(rows), "requiredRows": MIN_ROWS}
    previous = _load_artifact(timeframe)
    prior = json.loads(previous["metadata_json"]) if previous else {}
    if prior.get("lastBarEpoch") is not None and float(rows[-1]["bar_epoch"]) <= float(prior["lastBarEpoch"]):
        return {"status": "NoNewData"}
    split = int(len(rows) * .8)
    gap = max(3, max(int(r.get("outcome_horizon_bars") or 3) for r in rows))
    test_rows = rows[split:]
    cutoff = float(test_rows[0]["bar_epoch"])
    train_rows = [r for r in rows[:max(0, split-gap)] if r.get("future_epoch") is not None and float(r["future_epoch"]) < cutoff]
    if len(train_rows) < 50 or len(test_rows) < 20:
        return {"status": "InsufficientData", "reason": "Not enough separated train/test examples"}
    x_train, y_train = [_vector(r) for r in train_rows], [int(r["future_direction"] == 1) for r in train_rows]
    x_test, y_test = [_vector(r) for r in test_rows], [int(r["future_direction"] == 1) for r in test_rows]
    if len(set(y_train)) < 2 or len(set(y_test)) < 2:
        return {"status": "InsufficientClasses", "reason": "Both directions required in train and test"}
    model = XGBClassifier(n_estimators=150, max_depth=3, learning_rate=.05,
                          subsample=.8, colsample_bytree=.8, eval_metric="logloss",
                          random_state=42, n_jobs=2)
    model.fit(x_train, y_train)
    probs = model.predict_proba(x_test)[:, 1]
    metrics = {"accuracy": round(float(accuracy_score(y_test, probs >= .5)), 4),
               "brier": round(float(brier_score_loss(y_test, probs)), 4),
               "logLoss": round(float(log_loss(y_test, probs)), 4),
               "majorityBaselineAccuracy": round(max(sum(y_test)/len(y_test), 1-sum(y_test)/len(y_test)), 4)}
    if previous:
        # Compare only on observations occurring after the previous model dataset.
        if prior.get("lastBarEpoch") is None or prior.get("features") != list(FEATURES):
            return {"status": "PriorModelNeedsReview"}
        fresh = [i for i, r in enumerate(test_rows) if float(r["bar_epoch"]) > float(prior["lastBarEpoch"])]
        if len(fresh) < 30 or len({y_test[i] for i in fresh}) < 2:
            return {"status": "InsufficientFreshValidation"}
        old = XGBClassifier()
        old.load_model(bytearray(previous["model_json"].encode("utf-8")))
        fresh_x = [x_test[i] for i in fresh]
        fresh_y = [y_test[i] for i in fresh]
        old_loss = float(log_loss(fresh_y, old.predict_proba(fresh_x)[:, 1]))
        new_loss = float(log_loss(fresh_y, [probs[i] for i in fresh]))
        if new_loss >= old_loss:
            return {"status": "RetainedPriorModel", "oldLogLoss": old_loss, "newLogLoss": new_loss}
        metrics.update({"comparisonRows": len(fresh), "priorLogLoss": old_loss, "candidateLogLoss": new_loss})
    metadata = {"status": "TrainedResearchOnly", "symbol": "BTCUSD", "timeframe": timeframe,
                "features": list(FEATURES), "trainRows": len(train_rows),
                "holdoutRows": len(test_rows), "embargoRows": gap, "metrics": metrics,
                "lastBarEpoch": float(rows[-1]["bar_epoch"]),
                "trainedAt": datetime.now(timezone.utc).isoformat(),
                "warning": "Holdout metrics are not proof of profitable trading. No order authorization."}
    _save_artifact(timeframe, model, metadata)
    return metadata


def walk_forward_validation(timeframe="1m", folds=4, test_size=40):
    """Research-only expanding-window validation with outcome-time purging."""
    if timeframe not in ("1m", "3m", "5m", "10m", "15m", "30m", "1h"):
        return {"status": "Rejected", "reason": "Unsupported timeframe", "researchOnly": True}
    if os.getenv("BTCUSD_XGB_TRAINING_ENABLED", "false").lower() != "true":
        return {"status": "Disabled", "researchOnly": True}
    try:
        from xgboost import XGBClassifier
        from sklearn.metrics import accuracy_score, log_loss, brier_score_loss
    except ImportError:
        return {"status": "Unavailable", "reason": "Missing ML dependencies", "researchOnly": True}
    folds = max(2, min(int(folds), 8))
    test_size = max(30, min(int(test_size), 500))
    rows = _rows(timeframe, limit=50000)
    min_train = max(150, MIN_ROWS // 2)
    if len(rows) < min_train + folds * test_size:
        return {"status": "InsufficientData", "resolvedRows": len(rows),
                "requiredRows": min_train + folds * test_size, "researchOnly": True}
    results = []
    # Use the most recent consecutive non-overlapping test windows.
    start = len(rows) - folds * test_size
    for fold in range(folds):
        test_start = start + fold * test_size
        test = rows[test_start:test_start + test_size]
        cutoff = float(test[0]["bar_epoch"])
        embargo = max(3, max(int(r.get("outcome_horizon_bars") or 3) for r in rows[:test_start + test_size]))
        train = [r for r in rows[:max(0, test_start - embargo)]
                 if r.get("future_epoch") is not None and float(r["future_epoch"]) < cutoff]
        if len(train) < min_train:
            return {"status": "InsufficientPurgedTrainingData", "fold": fold + 1,
                    "trainRows": len(train), "researchOnly": True}
        y_train = [int(r["future_direction"] == 1) for r in train]
        y_test = [int(r["future_direction"] == 1) for r in test]
        if len(set(y_train)) < 2 or len(set(y_test)) < 2:
            return {"status": "InsufficientClasses", "fold": fold + 1, "researchOnly": True}
        model = XGBClassifier(n_estimators=150, max_depth=3, learning_rate=.05,
                              subsample=.8, colsample_bytree=.8, eval_metric="logloss",
                              random_state=42, n_jobs=2)
        model.fit([_vector(r) for r in train], y_train)
        probs = model.predict_proba([_vector(r) for r in test])[:, 1]
        baseline_probability = sum(y_train) / len(y_train)
        baseline_prediction = int(baseline_probability >= .5)
        results.append({"fold": fold + 1, "trainRows": len(train), "testRows": len(test),
            "testStartEpoch": cutoff, "testEndEpoch": float(test[-1]["bar_epoch"]),
            "embargoRows": embargo,
            "accuracy": round(float(accuracy_score(y_test, probs >= .5)), 4),
            "logLoss": round(float(log_loss(y_test, probs, labels=[0, 1])), 4),
            "brier": round(float(brier_score_loss(y_test, probs)), 4),
            "baselineAccuracy": round(float(accuracy_score(y_test, [baseline_prediction] * len(y_test))), 4),
            "baselineLogLoss": round(float(log_loss(y_test, [baseline_probability] * len(y_test), labels=[0, 1])), 4)})
    return {"status": "EvaluatedResearchOnly", "symbol": "BTCUSD", "timeframe": timeframe,
        "folds": results, "meanAccuracy": round(sum(f["accuracy"] for f in results) / folds, 4),
        "meanBaselineAccuracy": round(sum(f["baselineAccuracy"] for f in results) / folds, 4),
        "meanLogLoss": round(sum(f["logLoss"] for f in results) / folds, 4),
        "meanBaselineLogLoss": round(sum(f["baselineLogLoss"] for f in results) / folds, 4),
        "researchOnly": True, "allowedToTrade": False,
        "warning": "No model promotion or trading authorization. Overlapping test-label horizons may make fold estimates dependent."}


def _artifact_table(db):
    db.execute("""CREATE TABLE IF NOT EXISTS btcusd_xgb_models (
        timeframe TEXT PRIMARY KEY, model_json TEXT NOT NULL, metadata_json TEXT NOT NULL
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS btcusd_xgb_model_versions (
        id TEXT PRIMARY KEY, timeframe TEXT NOT NULL, trained_at TEXT NOT NULL,
        model_json TEXT NOT NULL, metadata_json TEXT NOT NULL
    )""")
    db.execute("""CREATE INDEX IF NOT EXISTS idx_btcusd_xgb_versions_time
        ON btcusd_xgb_model_versions(timeframe, trained_at)""")


def _save_artifact(timeframe, model, metadata):
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "model.json"
        model.save_model(str(path))
        artifact = path.read_text()
    with connect_ml_feature_store() as db:
        _artifact_table(db)
        # Archive every promoted research model in the same transaction as the
        # current-model upsert. Never overwrite historical model versions.
        import uuid
        db.execute("""INSERT INTO btcusd_xgb_model_versions
            (id, timeframe, trained_at, model_json, metadata_json)
            VALUES (?, ?, ?, ?, ?)""",
            (str(uuid.uuid4()), timeframe, metadata["trainedAt"], artifact, json.dumps(metadata)))
        db.execute("""INSERT INTO btcusd_xgb_models (timeframe, model_json, metadata_json)
            VALUES (?, ?, ?) ON CONFLICT(timeframe) DO UPDATE SET
            model_json=excluded.model_json, metadata_json=excluded.metadata_json""",
            (timeframe, artifact, json.dumps(metadata)))
        db.commit()


def _load_artifact(timeframe):
    with connect_ml_feature_store() as db:
        _artifact_table(db)
        row = db.execute("SELECT model_json, metadata_json FROM btcusd_xgb_models WHERE timeframe=?", (timeframe,)).fetchone()
        db.commit()
    return dict(row) if row else None


def backfill_current_model_version(timeframe="1m"):
    """Idempotently archive the current research model without modifying it."""
    if timeframe not in ("1m", "3m", "5m", "10m", "15m", "30m", "1h"):
        return {"status": "Rejected", "reason": "Unsupported timeframe"}
    import uuid
    with connect_ml_feature_store() as db:
        _artifact_table(db)
        current = db.execute("""SELECT model_json, metadata_json
            FROM btcusd_xgb_models WHERE timeframe=?""", (timeframe,)).fetchone()
        if not current:
            return {"status": "NoCurrentModel", "timeframe": timeframe}
        metadata = json.loads(current["metadata_json"])
        trained_at = metadata.get("trainedAt")
        if not trained_at:
            return {"status": "MissingTrainingTimestamp", "timeframe": timeframe}
        existing = db.execute("""SELECT id FROM btcusd_xgb_model_versions
            WHERE timeframe=? AND trained_at=? AND model_json=? LIMIT 1""",
            (timeframe, trained_at, current["model_json"])).fetchone()
        if existing:
            return {"status": "AlreadyArchived", "timeframe": timeframe}
        db.execute("""INSERT INTO btcusd_xgb_model_versions
            (id, timeframe, trained_at, model_json, metadata_json)
            VALUES (?, ?, ?, ?, ?)""",
            (str(uuid.uuid4()), timeframe, trained_at,
             current["model_json"], current["metadata_json"]))
        db.commit()
    return {"status": "Archived", "timeframe": timeframe, "trainedAt": trained_at,
            "researchOnly": True}


def model_versions(timeframe="1m", limit=20):
    """Read-only, metadata-only history; never expose full serialized models."""
    if timeframe not in ("1m", "3m", "5m", "10m", "15m", "30m", "1h"):
        return {"status": "Rejected", "reason": "Unsupported timeframe"}
    with connect_ml_feature_store() as db:
        _artifact_table(db)
        rows = db.execute("""SELECT metadata_json FROM btcusd_xgb_model_versions
            WHERE timeframe=? ORDER BY trained_at DESC LIMIT ?""",
            (timeframe, max(1, min(int(limit), 100)))).fetchall()
        db.commit()
    return {"timeframe": timeframe, "versions": [json.loads(row["metadata_json"]) for row in rows],
            "researchOnly": True}


def model_status(timeframe="5m"):
    try:
        artifact = _load_artifact(timeframe)
        count = len(_rows(timeframe, limit=50000))
        readiness = {"resolvedRows": count, "requiredRows": MIN_ROWS,
                     "minimumRowsReached": count >= MIN_ROWS, "timeframe": timeframe,
                     "storage": "neon_postgres" if os.getenv("DATABASE_URL") else "local_sqlite",
                     "researchOnly": True}
        if not artifact:
            return {**readiness, "status": "NotTrained", "symbol": "BTCUSD"}
        return {**json.loads(artifact["metadata_json"]), **readiness}
    except Exception:
        return {"status": "StorageUnavailable", "researchOnly": True}


def predict_btcusd(timeframe="5m"):
    metadata = model_status(timeframe)
    if metadata.get("status") != "TrainedResearchOnly" or metadata.get("timeframe") != timeframe:
        return {"status": "Unavailable", "reason": "No trained model for requested timeframe", "researchOnly": True}
    try:
        from xgboost import XGBClassifier
        with connect_ml_feature_store() as db:
            row = db.execute("""SELECT * FROM ml_feature_snapshots
                WHERE symbol='BTCUSD' AND provider='alpaca' AND timeframe=? ORDER BY bar_epoch DESC LIMIT 1""", (timeframe,)).fetchone()
        if not row:
            return {"status": "NoFeatures", "researchOnly": True}
        data = dict(row)
        # Only show a prediction on recent feature snapshots.
        age = datetime.now(timezone.utc).timestamp() - float(data["bar_epoch"])
        if age < -5 or age > 3 * {"1m":60,"3m":180,"5m":300,"10m":600,"15m":900,"30m":1800,"1h":3600}[timeframe]:
            return {"status": "StaleFeatures", "ageSeconds": round(age), "researchOnly": True}
        model = XGBClassifier()
        artifact = _load_artifact(timeframe)
        if not artifact or json.loads(artifact["metadata_json"]).get("features") != list(FEATURES):
            return {"status": "IncompatibleModel", "researchOnly": True}
        model.load_model(bytearray(artifact["model_json"].encode("utf-8")))
        probability = float(model.predict_proba([_vector(data)])[0][1])
        return {"status": "ResearchPrediction", "symbol": "BTCUSD", "timeframe": timeframe,
                "upProbability": round(probability, 4), "downProbability": round(1-probability, 4),
                "featureBarTime": data["bar_time"], "researchOnly": True,
                "allowedToTrade": False}
    except (ImportError, OSError, ValueError, sqlite3.Error) as exc:
        return {"status": "Unavailable", "reason": str(exc)[:150], "researchOnly": True}


def explain_btcusd(snapshot):
    """Opt-in Qwen via OpenAI-compatible API; no keys or trading actions in prompt."""
    if os.getenv("BTCUSD_LLM_ENABLED", "false").lower() != "true":
        return {"status": "Disabled", "reason": "BTCUSD_LLM_ENABLED is false", "researchOnly": True}
    url = os.getenv("BTCUSD_LLM_BASE_URL", "").rstrip("/")
    model = os.getenv("BTCUSD_LLM_MODEL", "")
    key = os.getenv("BTCUSD_LLM_API_KEY", "")
    if not url.startswith("https://") or not model or not key:
        return {"status": "Unconfigured", "reason": "HTTPS LLM endpoint, model, and API key required", "researchOnly": True}
    safe = {k: snapshot.get(k) for k in ("symbol", "timeframe", "status", "upProbability",
            "downProbability", "featureBarTime", "researchOnly") if k in snapshot}
    if safe.get("symbol") != "BTCUSD":
        return {"status": "Rejected", "reason": "BTCUSD only", "researchOnly": True}
    body = {"model": model, "temperature": 0.2, "max_tokens": 350,
            "messages": [{"role": "system", "content": "You are a cautious BTCUSD market research assistant. Explain only supplied numerical evidence. Never authorize orders, invent prices, or promise profit."},
                         {"role": "user", "content": json.dumps(safe)}]}
    request = urllib.request.Request(url + "/chat/completions", data=json.dumps(body).encode(),
              headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            data = json.loads(response.read(65536))
        return {"status": "Explained", "analysis": str(data["choices"][0]["message"]["content"])[:3000],
                "model": model, "researchOnly": True, "allowedToTrade": False}
    except Exception:
        return {"status": "Unavailable", "reason": "LLM request failed", "researchOnly": True}


def indicator_contribution_analysis(timeframe="1m", folds=4, test_size=40):
    """Research-only chronological feature-group ablation; no model persistence."""
    if timeframe not in ("1m", "3m", "5m", "10m", "15m", "30m", "1h"):
        return {"status": "Rejected", "reason": "Unsupported timeframe", "researchOnly": True}
    if os.getenv("BTCUSD_XGB_TRAINING_ENABLED", "false").lower() != "true":
        return {"status": "Disabled", "researchOnly": True}
    try:
        from xgboost import XGBClassifier
        from sklearn.metrics import accuracy_score, log_loss, brier_score_loss
    except ImportError:
        return {"status": "Unavailable", "reason": "Missing ML dependencies", "researchOnly": True}

    folds = max(2, min(int(folds), 8))
    test_size = max(30, min(int(test_size), 500))
    rows = _rows(timeframe, limit=50000)  # one database read for every variant
    min_train = max(150, MIN_ROWS // 2)
    if len(rows) < min_train + folds * test_size:
        return {"status": "InsufficientData", "resolvedRows": len(rows),
                "requiredRows": min_train + folds * test_size, "researchOnly": True}

    groups = {
        "Price and volume": ("open", "high", "low", "close", "volume"),
        "Directional sentiment": ("bull_score", "bear_score", "net_bias", "overall_direction"),
        "Signal confirmation": ("signal_confidence", "overall_confirmation_score", "overall_conflict_score"),
        "Smart money and liquidity": ("smc_quality_score", "order_block_quality_score",
                                       "pd_quality_score", "liquidity_profile_quality_score"),
        "NRTR direction": ("nrtr_direction",),
        "Ghost forecast": ("ghost_direction", "ghost_confidence"),
    }
    variants = {"All existing features": tuple(FEATURES)}
    for name, removed in groups.items():
        variants["Without " + name] = tuple(f for f in FEATURES if f not in removed)
    for name, included in groups.items():
        variants["Only " + name] = tuple(included)

    start = len(rows) - folds * test_size
    windows = []
    for fold in range(folds):
        test_start = start + fold * test_size
        test = rows[test_start:test_start + test_size]
        cutoff = float(test[0]["bar_epoch"])
        embargo = max(3, max(int(r.get("outcome_horizon_bars") or 3)
                             for r in rows[:test_start + test_size]))
        train = [r for r in rows[:max(0, test_start - embargo)]
                 if r.get("future_epoch") is not None and float(r["future_epoch"]) < cutoff]
        if len(train) < min_train:
            return {"status": "InsufficientPurgedTrainingData", "fold": fold + 1,
                    "trainRows": len(train), "researchOnly": True}
        y_train = [int(r["future_direction"] == 1) for r in train]
        y_test = [int(r["future_direction"] == 1) for r in test]
        if len(set(y_train)) < 2 or len(set(y_test)) < 2:
            return {"status": "InsufficientClasses", "fold": fold + 1, "researchOnly": True}
        windows.append((train, test, y_train, y_test))

    results = []
    for name, selected in variants.items():
        metrics = []
        for train, test, y_train, y_test in windows:
            model = XGBClassifier(n_estimators=150, max_depth=3, learning_rate=.05,
                                  subsample=.8, colsample_bytree=.8, eval_metric="logloss",
                                  random_state=42, n_jobs=2)
            model.fit([[float(r.get(k) or 0) for k in selected] for r in train], y_train)
            probabilities = model.predict_proba(
                [[float(r.get(k) or 0) for k in selected] for r in test])[:, 1]
            metrics.append({
                "accuracy": float(accuracy_score(y_test, probabilities >= .5)),
                "logLoss": float(log_loss(y_test, probabilities, labels=[0, 1])),
                "brier": float(brier_score_loss(y_test, probabilities)),
            })
        results.append({
            "variant": name, "featureCount": len(selected),
            "meanAccuracy": round(sum(m["accuracy"] for m in metrics) / folds, 4),
            "meanLogLoss": round(sum(m["logLoss"] for m in metrics) / folds, 4),
            "meanBrier": round(sum(m["brier"] for m in metrics) / folds, 4),
            "folds": [{k: round(v, 4) for k, v in m.items()} for m in metrics],
        })
    reference = results[0]
    for result in results:
        result["accuracyDifferencePp"] = round(
            (result["meanAccuracy"] - reference["meanAccuracy"]) * 100, 2)
    return {
        "status": "EvaluatedResearchOnly", "symbol": "BTCUSD", "timeframe": timeframe,
        "resolvedRows": len(rows), "foldCount": folds, "testRowsPerFold": test_size,
        "featureGroups": {name: list(keys) for name, keys in groups.items()},
        "results": results, "researchOnly": True, "allowedToTrade": False,
        "warning": "Exploratory comparisons only. Test periods overlap across variants; "
                   "repeated selection on the same folds risks overfitting. "
                   "No model promotion, saved-model replacement, or trading authorization.",
    }
