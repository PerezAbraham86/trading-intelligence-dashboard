from __future__ import annotations

import json
import os
import signal
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

"""
api/cache_worker.py

Background cache warmer for the Trading Intelligence Dashboard.

Important design:
- This worker DOES NOT write directly to SQLite.
- It calls the Render backend API endpoints.
- The backend writes candles/settings/signals/scorecards into its own cache/database.
- This avoids the problem of separate Render services not sharing a local SQLite file.

Render worker command:
    python -m api.cache_worker
"""

DEFAULT_SYMBOLS = "MES1!,BTCUSD,ETHUSD,SPY"
DEFAULT_TIMEFRAMES = "1m,5m,15m"
DEFAULT_LIMIT = 500
DEFAULT_INTERVAL_SECONDS = 60

_STOP = False


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(message: str, payload: Any | None = None) -> None:
    prefix = f"[cache-worker {now_iso()}]"
    if payload is None:
        print(f"{prefix} {message}", flush=True)
    else:
        try:
            print(f"{prefix} {message} {json.dumps(payload, default=str)[:1200]}", flush=True)
        except Exception:
            print(f"{prefix} {message} {payload}", flush=True)


def env_bool(name: str, default: bool = False) -> bool:
    value = str(os.getenv(name, "")).strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "y", "on"}


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(float(os.getenv(name, str(default))))
        return max(minimum, min(maximum, value))
    except Exception:
        return default


def split_csv(value: str, fallback: str) -> List[str]:
    raw = value or fallback
    return [item.strip() for item in raw.split(",") if item.strip()]


def normalize_base_url(value: str) -> str:
    base = str(value or "").strip().rstrip("/")
    if not base:
        # This default is only useful for local development.
        # On Render, set BACKEND_BASE_URL to your web service URL.
        return "http://127.0.0.1:8000"
    return base


def http_get_json(url: str, timeout: int = 40) -> Dict[str, Any]:
    request = Request(
        url,
        headers={
            "User-Agent": "MARKETBOS-cache-worker/1.0",
            "Accept": "application/json",
        },
    )
    with urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", errors="ignore")
        return json.loads(body) if body else {}


def safe_get_json(url: str, timeout: int = 40) -> Dict[str, Any]:
    try:
        return http_get_json(url, timeout=timeout)
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="ignore") if error.fp else ""
        log(f"HTTP error {error.code} for {url}", {"body": body[:500]})
    except URLError as error:
        log(f"URL error for {url}", {"reason": str(error.reason)})
    except Exception as error:
        log(f"request failed for {url}", {"error": str(error)})
    return {}


def build_url(base_url: str, path: str, params: Dict[str, Any] | None = None) -> str:
    params = params or {}
    query = urlencode({key: value for key, value in params.items() if value is not None})
    return f"{base_url}{path}{'?' + query if query else ''}"


def warm_candle_cache(base_url: str, symbols: List[str], timeframes: List[str], limit: int, force: bool) -> Dict[str, Any]:
    url = build_url(
        base_url,
        "/api/warm-candle-cache",
        {
            "symbols": ",".join(symbols),
            "timeframes": ",".join(timeframes),
            "limit": limit,
            "force": str(force).lower(),
        },
    )
    return safe_get_json(url, timeout=120)


def touch_live_context(base_url: str, symbols: List[str], timeframes: List[str]) -> None:
    """
    Light calls that keep live/latest context populated without doing heavy work.
    These calls are intentionally best-effort.
    """
    for symbol in symbols:
        primary_tf = timeframes[0] if timeframes else "1m"
        safe_get_json(build_url(base_url, "/api/live-price", {"symbol": symbol, "timeframe": primary_tf}), timeout=20)
        safe_get_json(build_url(base_url, "/api/latest-signal", {"symbol": symbol, "timeframe": primary_tf, "limit": 500}), timeout=40)


def worker_loop() -> None:
    base_url = normalize_base_url(os.getenv("BACKEND_BASE_URL", ""))
    symbols = split_csv(os.getenv("CACHE_WORKER_SYMBOLS", DEFAULT_SYMBOLS), DEFAULT_SYMBOLS)
    timeframes = split_csv(os.getenv("CACHE_WORKER_TIMEFRAMES", DEFAULT_TIMEFRAMES), DEFAULT_TIMEFRAMES)
    limit = env_int("CACHE_WORKER_LIMIT", DEFAULT_LIMIT, 50, 5000)
    interval_seconds = env_int("CACHE_WORKER_INTERVAL_SECONDS", DEFAULT_INTERVAL_SECONDS, 15, 3600)
    force_first = env_bool("CACHE_WORKER_FORCE_FIRST_RUN", True)
    force_each = env_bool("CACHE_WORKER_FORCE_EACH_RUN", False)
    touch_context = env_bool("CACHE_WORKER_TOUCH_CONTEXT", True)

    log("started", {
        "baseUrl": base_url,
        "symbols": symbols,
        "timeframes": timeframes,
        "limit": limit,
        "intervalSeconds": interval_seconds,
        "forceFirstRun": force_first,
        "forceEachRun": force_each,
        "touchContext": touch_context,
    })

    iteration = 0
    while not _STOP:
        iteration += 1
        force = force_each or (force_first and iteration == 1)

        health = safe_get_json(build_url(base_url, "/health"), timeout=20)
        if health:
            log("backend health", {
                "status": health.get("status"),
                "alpacaKeyPresent": health.get("alpacaKeyPresent"),
                "insightsentryKeyPresent": health.get("insightsentryKeyPresent"),
            })

        result = warm_candle_cache(base_url, symbols, timeframes, limit, force=force)
        log("warm-candle-cache result", {
            "eventType": result.get("eventType"),
            "status": result.get("status"),
            "count": result.get("count"),
            "results": result.get("results", [])[:12],
        })

        if touch_context:
            touch_live_context(base_url, symbols, timeframes)

        status = safe_get_json(build_url(base_url, "/api/site-cache/status"), timeout=30)
        if status:
            log("site-cache status", {
                "status": status.get("status"),
                "candlePayloads": status.get("candlePayloads"),
                "chartSettings": status.get("chartSettings"),
                "recentSignals": status.get("recentSignals"),
                "scorecards": status.get("scorecards"),
            })

        slept = 0
        while slept < interval_seconds and not _STOP:
            step = min(5, interval_seconds - slept)
            time.sleep(step)
            slept += step

    log("stopped")


def _handle_stop(signum: int, frame: Any) -> None:
    global _STOP
    _STOP = True
    log(f"received signal {signum}; shutting down")


def main() -> int:
    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)
    try:
        worker_loop()
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        log("fatal worker error", {"error": str(error)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
