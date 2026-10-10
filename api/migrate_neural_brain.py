"""Explicit, offline import of former Next.js JSONL snapshots and logistic weights.

Run with the existing backend's data directory; source files remain untouched.
"""
import argparse
import json
import sqlite3
from pathlib import Path
from api import neural_brain_fastapi as brain
from api.neural_brain_online import TASKS


def import_memory(snapshots_path=None, model_path=None):
    rows = []
    if snapshots_path:
        text = Path(snapshots_path).read_text()
        if text.lstrip().startswith('{') and '"snapshots"' in text:
            backup = json.loads(text)
            rows = backup["snapshots"]
        else:
            backup = {}
            rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    model = json.loads(Path(model_path).read_text()) if model_path else (backup.get("onlineModel") if snapshots_path else None)
    if model is not None:
        if model.get("modelType") != "river_style_online_logistic" or any(
            not isinstance(model.get("tasks", {}).get(key, {}).get("weights"), dict) for key in TASKS
        ):
            raise ValueError("Expected the original feature-based logistic model; refusing a reduced model.")
    brain.ensure_db()
    if model is not None:
        with sqlite3.connect(brain.DB_PATH) as connection:
            if connection.execute("SELECT 1 FROM neural_brain_models WHERE name = 'logistic'").fetchone():
                raise ValueError("A logistic model already exists; refusing to replace learned weights.")
    for row in rows:
        result = brain.save_neural_brain_snapshot(row)
        if row.get("outcome"):
            # Import labels without training again: model weights are imported separately.
            with sqlite3.connect(brain.DB_PATH) as connection:
                connection.execute("UPDATE neural_brain_snapshots SET outcome_json = ?, labeled_at = ? WHERE id = ? AND outcome_json IS NULL",
                                   (brain.safe_json(row["outcome"]), row["outcome"].get("labeledAt"), result["id"]))
    if model is not None:
        with sqlite3.connect(brain.DB_PATH) as connection:
            brain.save_logistic_state(connection, model)
    if snapshots_path and backup.get("scopeStatistics"):
        if brain.get_online_brain_status().get("trainedExamples", 0):
            raise ValueError("Existing scope statistics are trained; refusing to replace them.")
        brain._save_online_model(backup["scopeStatistics"])
    return {"importedSnapshots": len(rows), "importedModel": model is not None}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshots", help="Former JSONL snapshots or the FastAPI /export JSON backup")
    parser.add_argument("--model", help="Former neural_brain_online_model.json")
    args = parser.parse_args()
    if not args.snapshots and not args.model:
        parser.error("Provide --snapshots and/or --model")
    print(json.dumps(import_memory(args.snapshots, args.model)))
