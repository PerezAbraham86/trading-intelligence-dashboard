from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

try:
    import databento as db
except Exception:  # pragma: no cover - handled at runtime
    db = None


DATABENTO_API_KEY = os.getenv("DATABENTO_API_KEY", "")
DATABENTO_DATASET = os.getenv("DATABENTO_DATASET", "GLBX.MDP3")
DATABENTO_SCHEMA = os.getenv("DATABENTO_SCHEMA", "ohlcv-1m")
DATABENTO_HISTORY_DAYS = int(os.getenv("DATABENTO_HISTORY_DAYS", "21"))
DATABENTO_STYPE_IN = os.getenv("DATABENTO_STYPE_IN", "parent")


DATABENTO_PARENT_SYMBOLS = {
    "MES": "MES.FUT",
    "MES1": "MES.FUT",
    "MES1!": "MES.FUT",
    "CME_MINI:MES1!": "MES.FUT",
    "ES": "ES.FUT",
    "ES1": "ES.FUT",
    "ES1!": "ES.FUT",
    "CME_MINI:ES1!": "ES.FUT",
    "NQ": "NQ.FUT",
    "NQ1": "NQ.FUT",
    "NQ1!": "NQ.FUT",
    "MNQ": "MNQ.FUT",
    "MNQ1": "MNQ.FUT",
    "MNQ1!": "MNQ.FUT",
    "RTY": "RTY.FUT",
    "RTY1": "RTY.FUT",
    "RTY1!": "RTY.FUT",
    "M2K": "M2K.FUT",
    "M2K1": "M2K.FUT",
    "M2K1!": "M2K.FUT",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_symbol(symbol: str) -> str:
    text = str(symbol or "").strip().upper()
    if text in {"MES", "MES1", "MES1!", "CME_MINI:MES1!"}:
        return "MES1!"
    if text in {"ES", "ES1", "ES1!", "CME_MINI:ES1!"}:
        return "ES1!"
    if text in {"NQ", "NQ1", "NQ1!"}:
        return "NQ1!"
    if text in {"MNQ", "MNQ1", "MNQ1!"}:
        return "MNQ1!"
    if text in {"RTY", "RTY1", "RTY1!"}:
        return "RTY1!"
    if text in {"M2K", "M2K1", "M2K1!"}:
        return "M2K1!"
    return text or "MES1!"


def databento_parent_symbol(symbol: str) -> str:
    key = str(symbol or "").strip().upper()
    return DATABENTO_PARENT_SYMBOLS.get(key, DATABENTO_PARENT_SYMBOLS.get(_normalize_symbol(key), key))


def _timeframe_seconds(timeframe: str) -> int:
    text = str(timeframe or "1m").strip().lower()
    try:
        value = int(text[:-1])
    except Exception:
        value = 1
    if text.endswith("s"):
        return max(1, value)
    if text.endswith("h"):
        return max(1, value) * 3600
    return max(1, value) * 60


def _schema_for_timeframe(timeframe: str) -> str:
    # Databento offers standard OHLCV intervals like 1s, 1m, 1h, 1d.
    # For dashboard 3m/5m/10m, request ohlcv-1m and resample locally.
    seconds = _timeframe_seconds(timeframe)
    if seconds <= 1:
        return "ohlcv-1s"
    if seconds < 3600:
        return "ohlcv-1m"
    if seconds == 3600:
        return "ohlcv-1h"
    return "ohlcv-1m"


def _parse_start(start: Optional[str] = None, start_ym: Optional[str] = None) -> str:
    """Build a Databento-safe start value.

    Databento can reject open-ended requests like:
    "data_start_too_precise_to_forward_fill" when start is a full timestamp
    and end is omitted. For month tests, use date-only values like 2026-06-01.
    For default lookback, also use date-only UTC so the request is stable.
    """
    if start:
        text = str(start).strip()
        # If caller gives YYYY-MM-DD, keep it date-only.
        if len(text) == 10 and text.count("-") == 2:
            return text
        return text

    if start_ym:
        text = str(start_ym).strip()
        if len(text) == 7:
            return f"{text}-01"
        if len(text) == 10 and text.count("-") == 2:
            return text
        return text

    days = max(1, DATABENTO_HISTORY_DAYS)
    start_dt = datetime.now(timezone.utc) - timedelta(days=days)
    return start_dt.date().isoformat()


def _parse_end(end: Optional[str] = None) -> str:
    """Build a Databento-safe end value.

    Always send end for our dashboard trial routes. This avoids Databento treating
    an open-ended precise start as a forward-fill query.
    """
    if end:
        text = str(end).strip()
        if len(text) == 10 and text.count("-") == 2:
            return text
        return text

    # Round down to the current UTC minute. Databento accepts this for historical
    # ranges and it prevents future timestamps with seconds/microseconds noise.
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    return now.isoformat().replace("+00:00", "Z")


def _get_client():
    if db is None:
        raise RuntimeError("databento package is not installed. Add 'databento' to api/requirements.txt and redeploy.")
    if not DATABENTO_API_KEY:
        raise RuntimeError("DATABENTO_API_KEY is missing in Render Environment.")
    return db.Historical(DATABENTO_API_KEY)


def _coerce_price(value: Any) -> float:
    try:
        number = float(value)
    except Exception:
        return 0.0

    # Some DBN paths expose fixed precision integers. Pandas normally returns decimals,
    # but this keeps the route safe if a future client version exposes raw integers.
    if abs(number) > 1_000_000:
        number = number / 1_000_000_000.0
    return float(number)


def _coerce_volume(value: Any) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


def _dataframe_from_store(store: Any) -> pd.DataFrame:
    if hasattr(store, "to_df"):
        return store.to_df()
    if isinstance(store, pd.DataFrame):
        return store
    raise RuntimeError("Databento response could not be converted to a DataFrame.")


def _pick_time_column(df: pd.DataFrame) -> Tuple[pd.DataFrame, str]:
    if isinstance(df.index, pd.DatetimeIndex):
        work = df.copy()
        work["_db_time"] = work.index
        return work, "_db_time"

    for column in ("ts_event", "ts_recv", "time", "timestamp"):
        if column in df.columns:
            work = df.copy()
            work["_db_time"] = pd.to_datetime(work[column], utc=True, errors="coerce")
            return work, "_db_time"

    raise RuntimeError("Databento DataFrame has no timestamp index or timestamp column.")


def _normalize_ohlcv_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])

    work, time_col = _pick_time_column(df)
    work = work.copy()
    work[time_col] = pd.to_datetime(work[time_col], utc=True, errors="coerce")
    work = work.dropna(subset=[time_col])

    column_map = {}
    lower_to_original = {str(col).lower(): col for col in work.columns}
    for canonical in ("open", "high", "low", "close", "volume"):
        if canonical in lower_to_original:
            column_map[lower_to_original[canonical]] = canonical

    work = work.rename(columns=column_map)

    missing = [name for name in ("open", "high", "low", "close") if name not in work.columns]
    if missing:
        raise RuntimeError(f"Databento OHLCV response missing required columns: {', '.join(missing)}")

    if "volume" not in work.columns:
        work["volume"] = 0

    out = pd.DataFrame({
        "time": work[time_col],
        "open": work["open"].map(_coerce_price),
        "high": work["high"].map(_coerce_price),
        "low": work["low"].map(_coerce_price),
        "close": work["close"].map(_coerce_price),
        "volume": work["volume"].map(_coerce_volume),
    })

    out = out[out["close"] > 0]
    out = out.sort_values("time")
    out = out.drop_duplicates(subset=["time"], keep="last")
    return out.reset_index(drop=True)


def _resample_ohlcv(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    seconds = _timeframe_seconds(timeframe)
    if df.empty or seconds <= 60:
        return df

    work = df.copy()
    work["time"] = pd.to_datetime(work["time"], utc=True, errors="coerce")
    work = work.dropna(subset=["time"]).set_index("time").sort_index()

    rule = f"{int(seconds / 60)}min" if seconds % 60 == 0 else f"{seconds}s"
    resampled = work.resample(rule, label="left", closed="left").agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    })
    resampled = resampled.dropna(subset=["open", "high", "low", "close"])
    resampled = resampled.reset_index()
    return resampled


def _df_to_candles(df: pd.DataFrame, symbol: str, timeframe: str, limit: int = 0) -> List[Dict[str, Any]]:
    normalized_symbol = _normalize_symbol(symbol)
    normalized_timeframe = str(timeframe or "1m").strip().lower() or "1m"

    if df.empty:
        return []

    rows: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        ts = pd.to_datetime(row["time"], utc=True, errors="coerce")
        if pd.isna(ts):
            continue
        epoch = int(ts.timestamp())
        formatted = ts.isoformat().replace("+00:00", "Z")
        open_price = _coerce_price(row["open"])
        high_price = _coerce_price(row["high"])
        low_price = _coerce_price(row["low"])
        close_price = _coerce_price(row["close"])
        volume = _coerce_volume(row.get("volume", 0))

        if close_price <= 0:
            continue

        rows.append({
            "time": formatted,
            "timestamp": formatted,
            "epoch": epoch,
            "open": round(open_price, 8),
            "high": round(max(high_price, open_price, close_price), 8),
            "low": round(min(low_price, open_price, close_price), 8),
            "close": round(close_price, 8),
            "volume": round(volume, 8),
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "provider": "databento",
            "source": "databento_glbx_mdp3_ohlcv",
            "createdAt": _now_iso(),
        })

    if limit and limit > 0:
        rows = rows[-int(limit):]
    return rows


def get_databento_ohlcv(
    symbol: str = "MES1!",
    timeframe: str = "5m",
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    start_ym: Optional[str] = None,
    limit: int = 0,
) -> Dict[str, Any]:
    normalized_symbol = _normalize_symbol(symbol)
    normalized_timeframe = str(timeframe or "1m").strip().lower() or "1m"
    parent_symbol = databento_parent_symbol(normalized_symbol)
    schema = _schema_for_timeframe(normalized_timeframe)
    request_start = _parse_start(start=start, start_ym=start_ym)
    request_end = _parse_end(end=end)

    client = _get_client()

    kwargs = {
        "dataset": DATABENTO_DATASET,
        "schema": schema,
        "symbols": [parent_symbol],
        "stype_in": DATABENTO_STYPE_IN,
        "start": request_start,
    }
    if request_end:
        kwargs["end"] = request_end

    store = client.timeseries.get_range(**kwargs)
    df = _dataframe_from_store(store)
    normalized = _normalize_ohlcv_df(df)
    resampled = _resample_ohlcv(normalized, normalized_timeframe)
    candles = _df_to_candles(resampled, normalized_symbol, normalized_timeframe, limit=limit)

    return {
        "eventType": "DATABENTO_HISTORICAL_OHLCV",
        "status": "Live" if candles else "Waiting",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "providerSymbol": parent_symbol,
        "dataset": DATABENTO_DATASET,
        "schema": schema,
        "stypeIn": DATABENTO_STYPE_IN,
        "requestedStart": request_start,
        "requestedEnd": request_end,
        "count": len(candles),
        "candles": candles,
        "firstCandleTime": candles[0]["time"] if candles else None,
        "lastCandleTime": candles[-1]["time"] if candles else None,
        "lastClose": candles[-1]["close"] if candles else None,
        "provider": "databento",
        "source": "databento_glbx_mdp3_ohlcv",
        "createdAt": _now_iso(),
    }


def databento_status() -> Dict[str, Any]:
    return {
        "eventType": "DATABENTO_STATUS",
        "status": "Configured" if bool(DATABENTO_API_KEY) else "MissingKey",
        "hasApiKey": bool(DATABENTO_API_KEY),
        "dataset": DATABENTO_DATASET,
        "schemaDefault": DATABENTO_SCHEMA,
        "stypeIn": DATABENTO_STYPE_IN,
        "historyDays": DATABENTO_HISTORY_DAYS,
        "packageInstalled": db is not None,
        "createdAt": _now_iso(),
    }


def estimate_databento_cost(
    symbol: str = "MES1!",
    timeframe: str = "5m",
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    start_ym: Optional[str] = None,
) -> Dict[str, Any]:
    normalized_symbol = _normalize_symbol(symbol)
    normalized_timeframe = str(timeframe or "1m").strip().lower() or "1m"
    parent_symbol = databento_parent_symbol(normalized_symbol)
    schema = _schema_for_timeframe(normalized_timeframe)
    request_start = _parse_start(start=start, start_ym=start_ym)
    request_end = _parse_end(end=end)

    client = _get_client()

    kwargs = {
        "dataset": DATABENTO_DATASET,
        "symbols": [parent_symbol],
        "stype_in": DATABENTO_STYPE_IN,
        "schema": schema,
        "start": request_start,
    }
    if request_end:
        kwargs["end"] = request_end

    cost = client.metadata.get_cost(**kwargs)

    return {
        "eventType": "DATABENTO_COST_ESTIMATE",
        "status": "Ready",
        "symbol": normalized_symbol,
        "providerSymbol": parent_symbol,
        "timeframe": normalized_timeframe,
        "dataset": DATABENTO_DATASET,
        "schema": schema,
        "requestedStart": request_start,
        "requestedEnd": request_end,
        "estimatedCost": cost,
        "createdAt": _now_iso(),
    }from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

try:
    import databento as db
except Exception:  # pragma: no cover - handled at runtime
    db = None


DATABENTO_API_KEY = os.getenv("DATABENTO_API_KEY", "")
DATABENTO_DATASET = os.getenv("DATABENTO_DATASET", "GLBX.MDP3")
DATABENTO_SCHEMA = os.getenv("DATABENTO_SCHEMA", "ohlcv-1m")
DATABENTO_HISTORY_DAYS = int(os.getenv("DATABENTO_HISTORY_DAYS", "21"))
DATABENTO_STYPE_IN = os.getenv("DATABENTO_STYPE_IN", "parent")


DATABENTO_PARENT_SYMBOLS = {
    "MES": "MES.FUT",
    "MES1": "MES.FUT",
    "MES1!": "MES.FUT",
    "CME_MINI:MES1!": "MES.FUT",
    "ES": "ES.FUT",
    "ES1": "ES.FUT",
    "ES1!": "ES.FUT",
    "CME_MINI:ES1!": "ES.FUT",
    "NQ": "NQ.FUT",
    "NQ1": "NQ.FUT",
    "NQ1!": "NQ.FUT",
    "MNQ": "MNQ.FUT",
    "MNQ1": "MNQ.FUT",
    "MNQ1!": "MNQ.FUT",
    "RTY": "RTY.FUT",
    "RTY1": "RTY.FUT",
    "RTY1!": "RTY.FUT",
    "M2K": "M2K.FUT",
    "M2K1": "M2K.FUT",
    "M2K1!": "M2K.FUT",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_symbol(symbol: str) -> str:
    text = str(symbol or "").strip().upper()
    if text in {"MES", "MES1", "MES1!", "CME_MINI:MES1!"}:
        return "MES1!"
    if text in {"ES", "ES1", "ES1!", "CME_MINI:ES1!"}:
        return "ES1!"
    if text in {"NQ", "NQ1", "NQ1!"}:
        return "NQ1!"
    if text in {"MNQ", "MNQ1", "MNQ1!"}:
        return "MNQ1!"
    if text in {"RTY", "RTY1", "RTY1!"}:
        return "RTY1!"
    if text in {"M2K", "M2K1", "M2K1!"}:
        return "M2K1!"
    return text or "MES1!"


def databento_parent_symbol(symbol: str) -> str:
    key = str(symbol or "").strip().upper()
    return DATABENTO_PARENT_SYMBOLS.get(key, DATABENTO_PARENT_SYMBOLS.get(_normalize_symbol(key), key))


def _timeframe_seconds(timeframe: str) -> int:
    text = str(timeframe or "1m").strip().lower()
    try:
        value = int(text[:-1])
    except Exception:
        value = 1
    if text.endswith("s"):
        return max(1, value)
    if text.endswith("h"):
        return max(1, value) * 3600
    return max(1, value) * 60


def _schema_for_timeframe(timeframe: str) -> str:
    # Databento offers standard OHLCV intervals like 1s, 1m, 1h, 1d.
    # For dashboard 3m/5m/10m, request ohlcv-1m and resample locally.
    seconds = _timeframe_seconds(timeframe)
    if seconds <= 1:
        return "ohlcv-1s"
    if seconds < 3600:
        return "ohlcv-1m"
    if seconds == 3600:
        return "ohlcv-1h"
    return "ohlcv-1m"


def _parse_start(start: Optional[str] = None, start_ym: Optional[str] = None) -> str:
    """Build a Databento-safe start value.

    Databento can reject open-ended requests like:
    "data_start_too_precise_to_forward_fill" when start is a full timestamp
    and end is omitted. For month tests, use date-only values like 2026-06-01.
    For default lookback, also use date-only UTC so the request is stable.
    """
    if start:
        text = str(start).strip()
        # If caller gives YYYY-MM-DD, keep it date-only.
        if len(text) == 10 and text.count("-") == 2:
            return text
        return text

    if start_ym:
        text = str(start_ym).strip()
        if len(text) == 7:
            return f"{text}-01"
        if len(text) == 10 and text.count("-") == 2:
            return text
        return text

    days = max(1, DATABENTO_HISTORY_DAYS)
    start_dt = datetime.now(timezone.utc) - timedelta(days=days)
    return start_dt.date().isoformat()


def _parse_end(end: Optional[str] = None) -> str:
    """Build a Databento-safe end value.

    Always send end for our dashboard trial routes. This avoids Databento treating
    an open-ended precise start as a forward-fill query.
    """
    if end:
        text = str(end).strip()
        if len(text) == 10 and text.count("-") == 2:
            return text
        return text

    # Round down to the current UTC minute. Databento accepts this for historical
    # ranges and it prevents future timestamps with seconds/microseconds noise.
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    return now.isoformat().replace("+00:00", "Z")


def _get_client():
    if db is None:
        raise RuntimeError("databento package is not installed. Add 'databento' to api/requirements.txt and redeploy.")
    if not DATABENTO_API_KEY:
        raise RuntimeError("DATABENTO_API_KEY is missing in Render Environment.")
    return db.Historical(DATABENTO_API_KEY)


def _coerce_price(value: Any) -> float:
    try:
        number = float(value)
    except Exception:
        return 0.0

    # Some DBN paths expose fixed precision integers. Pandas normally returns decimals,
    # but this keeps the route safe if a future client version exposes raw integers.
    if abs(number) > 1_000_000:
        number = number / 1_000_000_000.0
    return float(number)


def _coerce_volume(value: Any) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


def _dataframe_from_store(store: Any) -> pd.DataFrame:
    if hasattr(store, "to_df"):
        return store.to_df()
    if isinstance(store, pd.DataFrame):
        return store
    raise RuntimeError("Databento response could not be converted to a DataFrame.")


def _pick_time_column(df: pd.DataFrame) -> Tuple[pd.DataFrame, str]:
    if isinstance(df.index, pd.DatetimeIndex):
        work = df.copy()
        work["_db_time"] = work.index
        return work, "_db_time"

    for column in ("ts_event", "ts_recv", "time", "timestamp"):
        if column in df.columns:
            work = df.copy()
            work["_db_time"] = pd.to_datetime(work[column], utc=True, errors="coerce")
            return work, "_db_time"

    raise RuntimeError("Databento DataFrame has no timestamp index or timestamp column.")


def _normalize_ohlcv_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])

    work, time_col = _pick_time_column(df)
    work = work.copy()
    work[time_col] = pd.to_datetime(work[time_col], utc=True, errors="coerce")
    work = work.dropna(subset=[time_col])

    column_map = {}
    lower_to_original = {str(col).lower(): col for col in work.columns}
    for canonical in ("open", "high", "low", "close", "volume"):
        if canonical in lower_to_original:
            column_map[lower_to_original[canonical]] = canonical

    work = work.rename(columns=column_map)

    missing = [name for name in ("open", "high", "low", "close") if name not in work.columns]
    if missing:
        raise RuntimeError(f"Databento OHLCV response missing required columns: {', '.join(missing)}")

    if "volume" not in work.columns:
        work["volume"] = 0

    out = pd.DataFrame({
        "time": work[time_col],
        "open": work["open"].map(_coerce_price),
        "high": work["high"].map(_coerce_price),
        "low": work["low"].map(_coerce_price),
        "close": work["close"].map(_coerce_price),
        "volume": work["volume"].map(_coerce_volume),
    })

    out = out[out["close"] > 0]
    out = out.sort_values("time")
    out = out.drop_duplicates(subset=["time"], keep="last")
    return out.reset_index(drop=True)


def _resample_ohlcv(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    seconds = _timeframe_seconds(timeframe)
    if df.empty or seconds <= 60:
        return df

    work = df.copy()
    work["time"] = pd.to_datetime(work["time"], utc=True, errors="coerce")
    work = work.dropna(subset=["time"]).set_index("time").sort_index()

    rule = f"{int(seconds / 60)}min" if seconds % 60 == 0 else f"{seconds}s"
    resampled = work.resample(rule, label="left", closed="left").agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    })
    resampled = resampled.dropna(subset=["open", "high", "low", "close"])
    resampled = resampled.reset_index()
    return resampled


def _df_to_candles(df: pd.DataFrame, symbol: str, timeframe: str, limit: int = 0) -> List[Dict[str, Any]]:
    normalized_symbol = _normalize_symbol(symbol)
    normalized_timeframe = str(timeframe or "1m").strip().lower() or "1m"

    if df.empty:
        return []

    rows: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        ts = pd.to_datetime(row["time"], utc=True, errors="coerce")
        if pd.isna(ts):
            continue
        epoch = int(ts.timestamp())
        formatted = ts.isoformat().replace("+00:00", "Z")
        open_price = _coerce_price(row["open"])
        high_price = _coerce_price(row["high"])
        low_price = _coerce_price(row["low"])
        close_price = _coerce_price(row["close"])
        volume = _coerce_volume(row.get("volume", 0))

        if close_price <= 0:
            continue

        rows.append({
            "time": formatted,
            "timestamp": formatted,
            "epoch": epoch,
            "open": round(open_price, 8),
            "high": round(max(high_price, open_price, close_price), 8),
            "low": round(min(low_price, open_price, close_price), 8),
            "close": round(close_price, 8),
            "volume": round(volume, 8),
            "symbol": normalized_symbol,
            "timeframe": normalized_timeframe,
            "provider": "databento",
            "source": "databento_glbx_mdp3_ohlcv",
            "createdAt": _now_iso(),
        })

    if limit and limit > 0:
        rows = rows[-int(limit):]
    return rows


def get_databento_ohlcv(
    symbol: str = "MES1!",
    timeframe: str = "5m",
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    start_ym: Optional[str] = None,
    limit: int = 0,
) -> Dict[str, Any]:
    normalized_symbol = _normalize_symbol(symbol)
    normalized_timeframe = str(timeframe or "1m").strip().lower() or "1m"
    parent_symbol = databento_parent_symbol(normalized_symbol)
    schema = _schema_for_timeframe(normalized_timeframe)
    request_start = _parse_start(start=start, start_ym=start_ym)
    request_end = _parse_end(end=end)

    client = _get_client()

    kwargs = {
        "dataset": DATABENTO_DATASET,
        "schema": schema,
        "symbols": [parent_symbol],
        "stype_in": DATABENTO_STYPE_IN,
        "start": request_start,
    }
    if request_end:
        kwargs["end"] = request_end

    store = client.timeseries.get_range(**kwargs)
    df = _dataframe_from_store(store)
    normalized = _normalize_ohlcv_df(df)
    resampled = _resample_ohlcv(normalized, normalized_timeframe)
    candles = _df_to_candles(resampled, normalized_symbol, normalized_timeframe, limit=limit)

    return {
        "eventType": "DATABENTO_HISTORICAL_OHLCV",
        "status": "Live" if candles else "Waiting",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "providerSymbol": parent_symbol,
        "dataset": DATABENTO_DATASET,
        "schema": schema,
        "stypeIn": DATABENTO_STYPE_IN,
        "requestedStart": request_start,
        "requestedEnd": request_end,
        "count": len(candles),
        "candles": candles,
        "firstCandleTime": candles[0]["time"] if candles else None,
        "lastCandleTime": candles[-1]["time"] if candles else None,
        "lastClose": candles[-1]["close"] if candles else None,
        "provider": "databento",
        "source": "databento_glbx_mdp3_ohlcv",
        "createdAt": _now_iso(),
    }


def databento_status() -> Dict[str, Any]:
    return {
        "eventType": "DATABENTO_STATUS",
        "status": "Configured" if bool(DATABENTO_API_KEY) else "MissingKey",
        "hasApiKey": bool(DATABENTO_API_KEY),
        "dataset": DATABENTO_DATASET,
        "schemaDefault": DATABENTO_SCHEMA,
        "stypeIn": DATABENTO_STYPE_IN,
        "historyDays": DATABENTO_HISTORY_DAYS,
        "packageInstalled": db is not None,
        "createdAt": _now_iso(),
    }


def estimate_databento_cost(
    symbol: str = "MES1!",
    timeframe: str = "5m",
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    start_ym: Optional[str] = None,
) -> Dict[str, Any]:
    normalized_symbol = _normalize_symbol(symbol)
    normalized_timeframe = str(timeframe or "1m").strip().lower() or "1m"
    parent_symbol = databento_parent_symbol(normalized_symbol)
    schema = _schema_for_timeframe(normalized_timeframe)
    request_start = _parse_start(start=start, start_ym=start_ym)
    request_end = _parse_end(end=end)

    client = _get_client()

    kwargs = {
        "dataset": DATABENTO_DATASET,
        "symbols": [parent_symbol],
        "stype_in": DATABENTO_STYPE_IN,
        "schema": schema,
        "start": request_start,
    }
    if request_end:
        kwargs["end"] = request_end

    cost = client.metadata.get_cost(**kwargs)

    return {
        "eventType": "DATABENTO_COST_ESTIMATE",
        "status": "Ready",
        "symbol": normalized_symbol,
        "providerSymbol": parent_symbol,
        "timeframe": normalized_timeframe,
        "dataset": DATABENTO_DATASET,
        "schema": schema,
        "requestedStart": request_start,
        "requestedEnd": request_end,
        "estimatedCost": cost,
        "createdAt": _now_iso(),
    }
