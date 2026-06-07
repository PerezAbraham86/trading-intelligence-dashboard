from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

DB = Path(os.getenv("ML_FEATURE_STORE_FILE", "/tmp/trading_dashboard_ml_features.sqlite3"))
HORIZON = int(os.getenv("ML_FEATURE_STORE_HORIZON_BARS", "3"))
MAX_PENDING = int(os.getenv("ML_FEATURE_STORE_MAX_PENDING", "500"))

def now_iso() -> str:
