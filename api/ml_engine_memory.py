"""Shared persistence for ML engine JSON state."""
import json
import os
from pathlib import Path
from typing import Any

ENGINE_NAMES = frozenset(("ghost_ml", "target_ml", "entry_ml", "projection_engine", "unified_intelligence"))

def _validate(name: str) -> None:
    if name not in ENGINE_NAMES:
        raise ValueError("Unknown ML engine")

def _connect():
    import psycopg
    return psycopg.connect(os.environ["DATABASE_URL"].strip(), connect_timeout=10, prepare_threshold=None)

def _initialize(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS ml_engine_memory (
        engine_name TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")

def initialize_ml_engine_memory():
    if os.getenv("DATABASE_URL", "").strip():
        with _connect() as conn:
            _initialize(conn)

def load_engine_memory(name: str, path: Path, default: Any) -> Any:
    _validate(name)
    if os.getenv("DATABASE_URL", "").strip():
        with _connect() as conn:
            _initialize(conn)
            row = conn.execute("SELECT state_json FROM ml_engine_memory WHERE engine_name = %s", (name,)).fetchone()
            if row is not None:
                return json.loads(row[0])
            if not Path(path).exists():
                return default
            state = json.loads(Path(path).read_text(encoding="utf-8"))
            conn.execute("INSERT INTO ml_engine_memory (engine_name, state_json) VALUES (%s, %s) ON CONFLICT (engine_name) DO NOTHING", (name, json.dumps(state, allow_nan=False)))
            row = conn.execute("SELECT state_json FROM ml_engine_memory WHERE engine_name = %s", (name,)).fetchone()
            return json.loads(row[0])
    if Path(path).exists():
        return json.loads(Path(path).read_text(encoding="utf-8"))
    return default

def save_engine_memory(name: str, path: Path, state: Any) -> None:
    _validate(name)
    payload = json.dumps(state, allow_nan=False)
    if os.getenv("DATABASE_URL", "").strip():
        with _connect() as conn:
            _initialize(conn)
            conn.execute("""INSERT INTO ml_engine_memory (engine_name, state_json)
                VALUES (%s, %s) ON CONFLICT (engine_name) DO UPDATE
                SET state_json = EXCLUDED.state_json, updated_at = CURRENT_TIMESTAMP""", (name, payload))
        return
    import tempfile
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        tmp = Path(handle.name)
        try:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        except Exception:
            tmp.unlink(missing_ok=True)
            raise
    try:
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
