from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import HTTPException


# ─────────────────────────────────────────────────────────────────────────────
# MARKETBOS PHASE 8.7 — INSIGHTSENTRY SESSION INFORMATION
# ─────────────────────────────────────────────────────────────────────────────
#
# Confirmed RapidAPI endpoint:
#
#   GET https://insightsentry.p.rapidapi.com/v3/symbols/{symbol_code}/session
#
# Confirmed MES path param:
#
#   CME_MINI:MES1!
#
# Confirmed response fields:
#
#   {
#     "last_update": 1781240342458,
#     "code": "CME_MINI:MES1!",
#     "holidays": ["20000117", ...],
#     "name": "Micro E-mini S&P 500 Index Futures",
#     "type": "FUTURES",
#     "tick_size": 0.25,
#     "timezone": "America/Chicago",
#     "session_correction": [
#       {"start_hour":"0830","end_hour":"1215","dates":[...]}
#     ]
#   }
#
# This module normalizes the response for the dashboard.
# It does NOT use L1 quotes or fallback feeds.


# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────

INSIGHTSENTRY_API_KEY = (
    os.getenv("INSIGHTSENTRY_API_KEY")
    or os.getenv("RAPIDAPI_KEY")
    or os.getenv("NEXT_PUBLIC_INSIGHTSENTRY_API_KEY")
    or ""
)

INSIGHTSENTRY_HOST = (
    os.getenv("INSIGHTSENTRY_HOST")
    or os.getenv("RAPIDAPI_HOST")
    or "insightsentry.p.rapidapi.com"
)

INSIGHTSENTRY_BASE_URL = (
    os.getenv("INSIGHTSENTRY_BASE_URL")
    or f"https://{INSIGHTSENTRY_HOST}"
).rstrip("/")

INSIGHTSENTRY_SESSION_TIMEOUT_SECONDS = float(os.getenv("INSIGHTSENTRY_SESSION_TIMEOUT_SECONDS", "12"))
INSIGHTSENTRY_SESSION_CACHE_SECONDS = float(os.getenv("INSIGHTSENTRY_SESSION_CACHE_SECONDS", "3600"))

_SESSION_CACHE: Dict[str, Dict[str, Any]] = {}


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
        if parsed == parsed and parsed not in (float("inf"), float("-inf")):
            return parsed
    except Exception:
        pass
    return fallback


def to_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(float(value))
    except Exception:
        return fallback


def normalize_symbol(value: Any = "MES1!") -> str:
    raw = str(value or "MES1!").strip().upper()
    raw = (
        raw.replace("CME_MINI:", "")
        .replace("CME:", "")
        .replace("NASDAQ:", "")
        .replace("NYSE:", "")
        .replace("AMEX:", "")
        .replace("BINANCE:", "")
        .replace("COINBASE:", "")
    )

    if raw in {"MES", "MES1", "MES1!"} or "MES" in raw:
        return "MES1!"
    if raw in {"ES", "ES1", "ES1!"} or raw.startswith("ES"):
        return "ES1!"
    if raw in {"NQ", "NQ1", "NQ1!"} or raw.startswith("NQ"):
        return "NQ1!"
    if "BTC" in raw:
        return "BTCUSD"
    if "ETH" in raw:
        return "ETHUSD"
    if raw == "SPY":
        return "SPY"
    if raw == "QQQ":
        return "QQQ"

    return raw or "MES1!"


def provider_symbol(symbol: Any = "MES1!") -> str:
    normalized = normalize_symbol(symbol)

    if normalized == "MES1!":
        return "CME_MINI:MES1!"
    if normalized == "ES1!":
        return "CME_MINI:ES1!"
    if normalized == "NQ1!":
        return "CME_MINI:NQ1!"
    if normalized == "SPY":
        return "AMEX:SPY"
    if normalized == "QQQ":
        return "NASDAQ:QQQ"
    if normalized == "BTCUSD":
        return "BINANCE:BTCUSDT"
    if normalized == "ETHUSD":
        return "BINANCE:ETHUSDT"

    text = str(symbol or "").strip().upper()
    if ":" in text:
        return text

    return normalized


def rapidapi_headers() -> Dict[str, str]:
    if not INSIGHTSENTRY_API_KEY:
        raise HTTPException(status_code=500, detail="INSIGHTSENTRY_API_KEY is missing")

    return {
        "x-rapidapi-key": INSIGHTSENTRY_API_KEY,
        "x-rapidapi-host": INSIGHTSENTRY_HOST,
        "accept": "application/json",
        "content-type": "application/json",
    }


def request_json(path: str) -> Any:
    url = f"{INSIGHTSENTRY_BASE_URL}{path}"
    request = Request(url, headers=rapidapi_headers(), method="GET")

    try:
        with urlopen(request, timeout=INSIGHTSENTRY_SESSION_TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except HTTPError as error:
        raise HTTPException(status_code=error.code, detail=f"InsightSentry session error: {error.reason}") from error
    except URLError as error:
        raise HTTPException(status_code=502, detail=f"InsightSentry session URL error: {error.reason}") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"InsightSentry session request failed: {error}") from error


def yyyymmdd_now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d")


def normalize_holidays(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []

    holidays: List[str] = []
    for item in value:
        text = str(item or "").strip()
        if text:
            holidays.append(text)

    return holidays


def normalize_session_corrections(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []

    rows: List[Dict[str, Any]] = []

    for item in value:
        if not isinstance(item, dict):
            continue

        dates = item.get("dates")
        if not isinstance(dates, list):
            dates = []

        rows.append(
            {
                "startHour": str(item.get("start_hour") or item.get("startHour") or "").strip(),
                "endHour": str(item.get("end_hour") or item.get("endHour") or "").strip(),
                "dates": [str(date or "").strip() for date in dates if str(date or "").strip()],
                "raw": item,
            }
        )

    return rows


def find_today_session_correction(corrections: List[Dict[str, Any]], today_yyyymmdd: str) -> Optional[Dict[str, Any]]:
    for item in corrections:
        dates = item.get("dates")
        if isinstance(dates, list) and today_yyyymmdd in dates:
            return item

    return None


def normalize_session_response(payload: Any, *, symbol: str, provider_code: str) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="InsightSentry session returned non-object response")

    holidays = normalize_holidays(payload.get("holidays"))
    corrections = normalize_session_corrections(payload.get("session_correction"))

    today = yyyymmdd_now_utc()
    is_holiday_today = today in set(holidays)
    today_correction = find_today_session_correction(corrections, today)

    raw_last_update = payload.get("last_update")
    last_update_ms = to_int(raw_last_update, 0)

    # InsightSentry value is milliseconds. Keep both raw and readable.
    last_update_iso = None
    if last_update_ms > 0:
        try:
            last_update_iso = datetime.fromtimestamp(last_update_ms / 1000, tz=timezone.utc).isoformat()
        except Exception:
            last_update_iso = None

    status_label = "Holiday" if is_holiday_today else "Session data available"

    return {
        "eventType": "INSIGHTSENTRY_SESSION",
        "status": "OK",
        "sessionStatus": status_label,
        "symbol": normalize_symbol(symbol),
        "providerCode": provider_code,
        "code": payload.get("code") or provider_code,
        "name": payload.get("name"),
        "assetType": payload.get("type"),
        "tickSize": to_float(payload.get("tick_size"), 0.0) or None,
        "timezone": payload.get("timezone"),
        "today": today,
        "isHolidayToday": is_holiday_today,
        "todaySessionCorrection": today_correction,
        "holidays": holidays,
        "holidayCount": len(holidays),
        "sessionCorrections": corrections,
        "sessionCorrectionCount": len(corrections),
        "lastUpdate": raw_last_update,
        "lastUpdateIso": last_update_iso,
        "source": "insightsentry_v3_session",
        "createdAt": now_iso(),
        "raw": payload,
    }


def cache_key(symbol: str) -> str:
    return provider_symbol(symbol)


def get_insightsentry_session(
    symbol: str = "MES1!",
    force: bool = False,
) -> Dict[str, Any]:
    normalized_symbol = normalize_symbol(symbol)
    code = provider_symbol(symbol)
    key = cache_key(normalized_symbol)

    cached = _SESSION_CACHE.get(key)
    if (
        not force
        and cached
        and time.time() - float(cached.get("cachedAtEpoch", 0.0)) <= INSIGHTSENTRY_SESSION_CACHE_SECONDS
    ):
        response = dict(cached.get("response") or {})
        response["cache"] = "HIT"
        response["createdAt"] = now_iso()
        return response

    path = f"/v3/symbols/{quote(code, safe='')}/session"
    payload = request_json(path)

    response = normalize_session_response(
        payload,
        symbol=normalized_symbol,
        provider_code=code,
    )
    response["request"] = {
        "path": path,
        "providerCode": code,
    }
    response["cache"] = "MISS"

    _SESSION_CACHE[key] = {
        "cachedAtEpoch": time.time(),
        "response": response,
    }

    return response


def insightsentry_session_status() -> Dict[str, Any]:
    return {
        "eventType": "INSIGHTSENTRY_SESSION_STATUS",
        "status": "OK",
        "baseUrl": INSIGHTSENTRY_BASE_URL,
        "host": INSIGHTSENTRY_HOST,
        "hasApiKey": bool(INSIGHTSENTRY_API_KEY),
        "cacheSize": len(_SESSION_CACHE),
        "cacheSeconds": INSIGHTSENTRY_SESSION_CACHE_SECONDS,
        "createdAt": now_iso(),
        "source": "insightsentry_v3_session",
    }
