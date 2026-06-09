from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

DB_PATH = Path(
    os.getenv(
        "SITE_CACHE_DB_FILE",
        os.getenv("CANDLE_CACHE_DB_FILE", "/tmp/trading_dashboard_site_cache.sqlite3"),
    )
)
CACHE_MAX_PAYLOAD_CHARS = int(os.getenv("SITE_CACHE_MAX_PAYLOAD_CHARS", "8000000"))

_LOCK = threading.RLock()
_INITIALIZED = False


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(DB_PATH), timeout=30, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


def init_site_cache_store() -> Dict[str, Any]:
    global _INITIALIZED
    with _LOCK:
        with _connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS candle_payload_cache (
                    cache_key TEXT PRIMARY KEY,
                    route TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    timeframe TEXT NOT NULL,
                    limit_value INTEGER NOT NULL,
                    provider TEXT,
                    source TEXT,
                    count_value INTEGER NOT NULL DEFAULT 0,
                    latest_epoch REAL NOT NULL DEFAULT 0,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_candle_payload_cache_symbol_tf
                ON candle_payload_cache(symbol, timeframe, route)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS chart_settings_cache (
                    user_key TEXT NOT NULL,
                    chart_key TEXT NOT NULL,
                    settings_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(user_key, chart_key)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS recent_signal_cache (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_key TEXT NOT NULL DEFAULT 'default',
                    symbol TEXT,
                    timeframe TEXT,
                    signal_type TEXT,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_recent_signal_cache_user_symbol_tf
                ON recent_signal_cache(user_key, symbol, timeframe, created_at DESC)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS scorecard_snapshot_cache (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_key TEXT NOT NULL DEFAULT 'default',
                    chart_key TEXT NOT NULL DEFAULT 'main',
                    symbol TEXT,
                    timeframe TEXT,
                    scorecard_type TEXT,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_scorecard_snapshot_cache_user_chart
                ON scorecard_snapshot_cache(user_key, chart_key, symbol, timeframe, created_at DESC)
                """
            )
        _INITIALIZED = True
    return {
        "enabled": True,
        "dbFile": str(DB_PATH),
        "createdAt": now_iso(),
    }


def ensure_site_cache_store() -> None:
    if not _INITIALIZED:
        init_site_cache_store()


def _safe_json_dumps(value: Any) -> str:
    text = json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str)
    if len(text) > CACHE_MAX_PAYLOAD_CHARS:
        raise ValueError(f"Payload too large for site cache: {len(text)} chars")
    return text


def _safe_json_loads(text: str, fallback: Any = None) -> Any:
    try:
        return json.loads(text)
    except Exception:
        return fallback


def _payload_latest_epoch(payload: Dict[str, Any]) -> float:
    candles = payload.get("candles")
    if not isinstance(candles, list) or not candles:
        return 0.0

    latest = 0.0
    for candle in candles:
        if not isinstance(candle, dict):
            continue
        raw = candle.get("epoch") or candle.get("time") or candle.get("timestamp")
        try:
            if isinstance(raw, (int, float)):
                epoch = float(raw)
            else:
                parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                epoch = parsed.timestamp()
            if epoch > 10_000_000_000:
                epoch = epoch / 1000.0
            latest = max(latest, epoch)
        except Exception:
            continue
    return latest


def site_cache_age_seconds(payload: Dict[str, Any]) -> Optional[float]:
    try:
        created_at = datetime.fromisoformat(str(payload.get("createdAt") or payload.get("updatedAt") or "").replace("Z", "+00:00"))
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - created_at).total_seconds()
    except Exception:
        return None


def get_candle_payload(cache_key: str, max_age_seconds: int) -> Optional[Dict[str, Any]]:
    ensure_site_cache_store()
    with _LOCK:
        with _connect() as connection:
            row = connection.execute(
                "SELECT payload_json, updated_at FROM candle_payload_cache WHERE cache_key = ?",
                (cache_key,),
            ).fetchone()

    if row is None:
        return None

    payload = _safe_json_loads(str(row["payload_json"]), {})
    if not isinstance(payload, dict):
        return None

    age = site_cache_age_seconds(payload)
    cache_label = "site_db_cached"
    if age is not None and age > max_age_seconds:
        cache_label = "site_db_cached_stale"

    payload = dict(payload)
    payload["cache"] = cache_label
    payload["siteCache"] = True
    payload["siteCacheDb"] = True
    payload["siteCacheAgeSeconds"] = age
    payload["siteCacheDbFile"] = str(DB_PATH)
    return payload


def set_candle_payload(
    *,
    cache_key: str,
    route: str,
    symbol: str,
    timeframe: str,
    limit_value: int,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    ensure_site_cache_store()
    stored = dict(payload)
    timestamp = now_iso()
    stored["createdAt"] = timestamp
    stored["updatedAt"] = timestamp
    stored["cache"] = "stored_db"
    stored["siteCache"] = True
    stored["siteCacheDb"] = True
    stored["siteCacheDbFile"] = str(DB_PATH)

    candles = stored.get("candles")
    count_value = len(candles) if isinstance(candles, list) else int(stored.get("count") or 0)
    latest_epoch = _payload_latest_epoch(stored)
    payload_json = _safe_json_dumps(stored)

    with _LOCK:
        with _connect() as connection:
            connection.execute(
                """
                INSERT INTO candle_payload_cache (
                    cache_key, route, symbol, timeframe, limit_value, provider, source,
                    count_value, latest_epoch, payload_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    route = excluded.route,
                    symbol = excluded.symbol,
                    timeframe = excluded.timeframe,
                    limit_value = excluded.limit_value,
                    provider = excluded.provider,
                    source = excluded.source,
                    count_value = excluded.count_value,
                    latest_epoch = excluded.latest_epoch,
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (
                    cache_key,
                    route,
                    symbol,
                    timeframe,
                    int(limit_value),
                    str(stored.get("provider") or ""),
                    str(stored.get("source") or ""),
                    int(count_value),
                    float(latest_epoch),
                    payload_json,
                    timestamp,
                    timestamp,
                ),
            )
    return stored


def get_stale_candle_payload(cache_key: str) -> Optional[Dict[str, Any]]:
    ensure_site_cache_store()
    with _LOCK:
        with _connect() as connection:
            row = connection.execute(
                "SELECT payload_json FROM candle_payload_cache WHERE cache_key = ?",
                (cache_key,),
            ).fetchone()
    if row is None:
        return None
    payload = _safe_json_loads(str(row["payload_json"]), {})
    if not isinstance(payload, dict):
        return None
    payload = dict(payload)
    payload["cache"] = "site_db_cached_stale"
    payload["siteCache"] = True
    payload["siteCacheDb"] = True
    payload["siteCacheAgeSeconds"] = site_cache_age_seconds(payload)
    payload["siteCacheDbFile"] = str(DB_PATH)
    return payload



def get_best_candle_payload(
    *,
    route: str,
    symbol: str,
    timeframe: str,
    min_limit_value: int = 500,
    max_age_seconds: int = 86400,
    allow_stale: bool = True,
) -> Optional[Dict[str, Any]]:
    """Return the best cached candle payload for a route/symbol/timeframe even when the exact limit differs.

    This is important because the dashboard may ask for 500, 600, 1000, or 4000 candles from
    different panels. One good cached 1000-candle payload should be reused instead of forcing
    the provider to refetch for every exact limit.
    """
    ensure_site_cache_store()
    safe_route = str(route or "dashboard")
    safe_symbol = str(symbol or "").upper().strip()
    safe_timeframe = str(timeframe or "1m").lower().strip()
    safe_min_limit = max(1, int(min_limit_value or 500))

    with _LOCK:
        with _connect() as connection:
            row = connection.execute(
                """
                SELECT payload_json, count_value, limit_value, updated_at
                FROM candle_payload_cache
                WHERE route = ?
                  AND symbol = ?
                  AND timeframe = ?
                  AND count_value > 0
                ORDER BY
                  CASE WHEN limit_value >= ? THEN 0 ELSE 1 END,
                  count_value DESC,
                  updated_at DESC
                LIMIT 1
                """,
                (safe_route, safe_symbol, safe_timeframe, safe_min_limit),
            ).fetchone()

    if row is None:
        return None

    payload = _safe_json_loads(str(row["payload_json"]), {})
    if not isinstance(payload, dict):
        return None

    age = site_cache_age_seconds(payload)
    is_stale = age is not None and age > max_age_seconds
    if is_stale and not allow_stale:
        return None

    payload = dict(payload)
    payload["cache"] = "site_db_cached_best_match_stale" if is_stale else "site_db_cached_best_match"
    payload["siteCache"] = True
    payload["siteCacheDb"] = True
    payload["siteCacheAgeSeconds"] = age
    payload["siteCacheDbFile"] = str(DB_PATH)
    payload["siteCacheBestMatch"] = True
    payload["siteCacheStoredLimit"] = int(row["limit_value"] or 0)
    payload["siteCacheStoredCount"] = int(row["count_value"] or 0)
    return payload

def list_candle_cache_entries(limit: int = 200) -> List[Dict[str, Any]]:
    ensure_site_cache_store()
    safe_limit = max(1, min(int(limit or 200), 1000))
    with _LOCK:
        with _connect() as connection:
            rows = connection.execute(
                """
                SELECT cache_key, route, symbol, timeframe, limit_value, provider, source,
                       count_value, latest_epoch, created_at, updated_at
                FROM candle_payload_cache
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (safe_limit,),
            ).fetchall()
    now_epoch = datetime.now(timezone.utc).timestamp()
    return [
        {
            "key": row["cache_key"],
            "route": row["route"],
            "symbol": row["symbol"],
            "timeframe": row["timeframe"],
            "limit": row["limit_value"],
            "provider": row["provider"],
            "source": row["source"],
            "count": row["count_value"],
            "latestEpoch": row["latest_epoch"],
            "latestAgeSeconds": round(now_epoch - float(row["latest_epoch"]), 2) if float(row["latest_epoch"] or 0) > 0 else None,
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def get_site_cache_summary() -> Dict[str, Any]:
    ensure_site_cache_store()
    with _LOCK:
        with _connect() as connection:
            candle_count = int(connection.execute("SELECT COUNT(*) FROM candle_payload_cache").fetchone()[0])
            settings_count = int(connection.execute("SELECT COUNT(*) FROM chart_settings_cache").fetchone()[0])
            signals_count = int(connection.execute("SELECT COUNT(*) FROM recent_signal_cache").fetchone()[0])
            scorecards_count = int(connection.execute("SELECT COUNT(*) FROM scorecard_snapshot_cache").fetchone()[0])
    return {
        "enabled": True,
        "dbFile": str(DB_PATH),
        "candlePayloads": candle_count,
        "chartSettings": settings_count,
        "recentSignals": signals_count,
        "scorecards": scorecards_count,
        "createdAt": now_iso(),
    }


def save_chart_settings(user_key: str, chart_key: str, settings: Dict[str, Any]) -> Dict[str, Any]:
    ensure_site_cache_store()
    safe_user = str(user_key or "default").strip() or "default"
    safe_chart = str(chart_key or "main").strip() or "main"
    timestamp = now_iso()
    with _LOCK:
        with _connect() as connection:
            connection.execute(
                """
                INSERT INTO chart_settings_cache (user_key, chart_key, settings_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_key, chart_key) DO UPDATE SET
                    settings_json = excluded.settings_json,
                    updated_at = excluded.updated_at
                """,
                (safe_user, safe_chart, _safe_json_dumps(settings), timestamp, timestamp),
            )
    return {"ok": True, "userKey": safe_user, "chartKey": safe_chart, "settings": settings, "updatedAt": timestamp}


def load_chart_settings(user_key: str = "default") -> Dict[str, Any]:
    ensure_site_cache_store()
    safe_user = str(user_key or "default").strip() or "default"
    with _LOCK:
        with _connect() as connection:
            rows = connection.execute(
                "SELECT chart_key, settings_json, updated_at FROM chart_settings_cache WHERE user_key = ?",
                (safe_user,),
            ).fetchall()
    return {
        "userKey": safe_user,
        "charts": {
            row["chart_key"]: {
                "settings": _safe_json_loads(str(row["settings_json"]), {}),
                "updatedAt": row["updated_at"],
            }
            for row in rows
        },
        "createdAt": now_iso(),
    }



def save_recent_signal(user_key: str, symbol: str, timeframe: str, signal_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    ensure_site_cache_store()
    safe_user = str(user_key or "default").strip() or "default"
    timestamp = now_iso()
    with _LOCK:
        with _connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO recent_signal_cache (user_key, symbol, timeframe, signal_type, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    safe_user,
                    str(symbol or ""),
                    str(timeframe or ""),
                    str(signal_type or ""),
                    _safe_json_dumps(payload),
                    timestamp,
                ),
            )
            row_id = int(cursor.lastrowid or 0)
    return {"ok": True, "id": row_id, "userKey": safe_user, "createdAt": timestamp}


def load_recent_signals(user_key: str = "default", symbol: str = "", timeframe: str = "", limit: int = 50) -> Dict[str, Any]:
    ensure_site_cache_store()
    safe_user = str(user_key or "default").strip() or "default"
    safe_limit = max(1, min(int(limit or 50), 500))
    clauses = ["user_key = ?"]
    params: List[Any] = [safe_user]
    if symbol:
        clauses.append("symbol = ?")
        params.append(symbol)
    if timeframe:
        clauses.append("timeframe = ?")
        params.append(timeframe)
    params.append(safe_limit)

    with _LOCK:
        with _connect() as connection:
            rows = connection.execute(
                f"""
                SELECT id, symbol, timeframe, signal_type, payload_json, created_at
                FROM recent_signal_cache
                WHERE {' AND '.join(clauses)}
                ORDER BY created_at DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()

    return {
        "userKey": safe_user,
        "count": len(rows),
        "signals": [
            {
                "id": row["id"],
                "symbol": row["symbol"],
                "timeframe": row["timeframe"],
                "signalType": row["signal_type"],
                "payload": _safe_json_loads(str(row["payload_json"]), {}),
                "createdAt": row["created_at"],
            }
            for row in rows
        ],
        "createdAt": now_iso(),
    }


def save_scorecard_snapshot(
    user_key: str,
    chart_key: str,
    symbol: str,
    timeframe: str,
    scorecard_type: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    ensure_site_cache_store()
    safe_user = str(user_key or "default").strip() or "default"
    safe_chart = str(chart_key or "main").strip() or "main"
    timestamp = now_iso()
    with _LOCK:
        with _connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO scorecard_snapshot_cache (
                    user_key, chart_key, symbol, timeframe, scorecard_type, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    safe_user,
                    safe_chart,
                    str(symbol or ""),
                    str(timeframe or ""),
                    str(scorecard_type or "scorecard"),
                    _safe_json_dumps(payload),
                    timestamp,
                ),
            )
            row_id = int(cursor.lastrowid or 0)
    return {"ok": True, "id": row_id, "userKey": safe_user, "chartKey": safe_chart, "createdAt": timestamp}


def load_scorecard_snapshots(
    user_key: str = "default",
    chart_key: str = "",
    symbol: str = "",
    timeframe: str = "",
    limit: int = 50,
) -> Dict[str, Any]:
    ensure_site_cache_store()
    safe_user = str(user_key or "default").strip() or "default"
    safe_limit = max(1, min(int(limit or 50), 500))
    clauses = ["user_key = ?"]
    params: List[Any] = [safe_user]
    if chart_key:
        clauses.append("chart_key = ?")
        params.append(chart_key)
    if symbol:
        clauses.append("symbol = ?")
        params.append(symbol)
    if timeframe:
        clauses.append("timeframe = ?")
        params.append(timeframe)
    params.append(safe_limit)

    with _LOCK:
        with _connect() as connection:
            rows = connection.execute(
                f"""
                SELECT id, chart_key, symbol, timeframe, scorecard_type, payload_json, created_at
                FROM scorecard_snapshot_cache
                WHERE {' AND '.join(clauses)}
                ORDER BY created_at DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()

    return {
        "userKey": safe_user,
        "count": len(rows),
        "scorecards": [
            {
                "id": row["id"],
                "chartKey": row["chart_key"],
                "symbol": row["symbol"],
                "timeframe": row["timeframe"],
                "scorecardType": row["scorecard_type"],
                "payload": _safe_json_loads(str(row["payload_json"]), {}),
                "createdAt": row["created_at"],
            }
            for row in rows
        ],
        "createdAt": now_iso(),
    }
