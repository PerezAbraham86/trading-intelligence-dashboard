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
    try