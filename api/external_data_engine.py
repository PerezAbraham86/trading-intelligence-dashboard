from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


# ─────────────────────────────────────────────────────────────────────────────
# EXTERNAL DATA ENGINE
#
# v8 update:
# - Keeps Massive options-chain probe for equities.
# - Keeps OKX public SWAP data for BTCUSD/ETHUSD open interest + footprint.
# - Keeps Binance Futures as secondary crypto fallback.
# - Keeps FRED macro using DGS10, T10Y2Y, DFF, VIXCLS.
# - Keeps FINRA daily CNMS short-sale volume for equities/ETFs.
# - Fixes FINRA parser to support Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market rows.
# - Adds Databento MBP-1 probe for MES/ES estimated footprint delta.
#
# This file intentionally does NOT fake unavailable data.
# If a source cannot provide a real value, it returns not_applicable/unavailable.
# ─────────────────────────────────────────────────────────────────────────────

MASSIVE_API_KEY = os.getenv("MASSIVE_API_KEY", "").strip()
MASSIVE_BASE_URL = os.getenv("MASSIVE_BASE_URL", "https://api.polygon.io").rstrip("/")
MASSIVE_TIMEOUT_SECONDS = float(os.getenv("MASSIVE_TIMEOUT_SECONDS", "12"))
MASSIVE_CACHE_TTL_SECONDS = int(os.getenv("MASSIVE_CACHE_TTL_SECONDS", "45"))

BINANCE_FUTURES_BASE_URL = os.getenv("BINANCE_FUTURES_BASE_URL", "https://fapi.binance.com").rstrip("/")
BINANCE_TIMEOUT_SECONDS = float(os.getenv("BINANCE_TIMEOUT_SECONDS", "12"))

OKX_BASE_URL = os.getenv("OKX_BASE_URL", "https://www.okx.com").rstrip("/")
OKX_TIMEOUT_SECONDS = float(os.getenv("OKX_TIMEOUT_SECONDS", "12"))

FRED_API_KEY = os.getenv("FRED_API_KEY", "").strip()
FRED_BASE_URL = os.getenv("FRED_BASE_URL", "https://api.stlouisfed.org").rstrip("/")
FRED_TIMEOUT_SECONDS = float(os.getenv("FRED_TIMEOUT_SECONDS", "12"))
FRED_CACHE_TTL_SECONDS = int(os.getenv("FRED_CACHE_TTL_SECONDS", "1800"))

FINRA_BASE_URL = os.getenv("FINRA_BASE_URL", "https://cdn.finra.org").rstrip("/")
FINRA_TIMEOUT_SECONDS = float(os.getenv("FINRA_TIMEOUT_SECONDS", "12"))
FINRA_CACHE_TTL_SECONDS = int(os.getenv("FINRA_CACHE_TTL_SECONDS", "21600"))

_EXTERNAL_DATA_CACHE: Dict[str, Dict[str, Any]] = {}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None:
            return fallback
        parsed = float(value)
        if parsed != parsed:
            return fallback
        return parsed
    except Exception:
        return fallback


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def normalize_symbol(symbol: str) -> str:
    raw = str(symbol or "BTCUSD").strip().upper()

    for prefix in [
        "BINANCE:",
        "COINBASE:",
        "CRYPTO:",
        "CME_MINI:",
        "CME:",
        "AMEX:",
        "NASDAQ:",
        "NYSE:",
    ]:
        raw = raw.replace(prefix, "")

    raw = raw.replace("-", "").replace("_", "").replace("/", "")

    if raw in {"BTCUSD", "BTCUSDT", "XBTUSD"}:
        return "BTCUSD"

    if raw in {"ETHUSD", "ETHUSDT"}:
        return "ETHUSD"

    if raw in {"MES", "MES1", "MES1!", "MESF"}:
        return "MES1!"

    if raw in {"ES", "ES1", "ES1!", "ESF"}:
        return "ES1!"

    if raw in {"SPY", "QQQ", "IWM", "AAPL", "TSLA", "NVDA", "MSFT", "AMD"}:
        return raw

    return raw or "BTCUSD"


def normalize_timeframe(timeframe: str) -> str:
    raw = str(timeframe or "1m").strip().lower()

    mapping = {
        "1": "1m",
        "1m": "1m",
        "1min": "1m",
        "3": "3m",
        "3m": "3m",
        "5": "5m",
        "5m": "5m",
        "10": "10m",
        "10m": "10m",
        "15": "15m",
        "15m": "15m",
        "30": "30m",
        "30m": "30m",
        "60": "1h",
        "60m": "1h",
        "1h": "1h",
        "d": "1d",
        "1d": "1d",
    }

    return mapping.get(raw, raw or "1m")


def binance_period_from_timeframe(timeframe: str) -> str:
    tf = normalize_timeframe(timeframe)

    if tf in {"1m", "3m", "5m"}:
        return "5m"

    if tf in {"10m", "15m"}:
        return "15m"

    if tf == "30m":
        return "30m"

    if tf == "1h":
        return "1h"

    return "5m"


def is_crypto_symbol(symbol: str) -> bool:
    return normalize_symbol(symbol) in {"BTCUSD", "ETHUSD"}


def is_equity_symbol(symbol: str) -> bool:
    return normalize_symbol(symbol) in {
        "SPY",
        "QQQ",
        "IWM",
        "AAPL",
        "TSLA",
        "NVDA",
        "MSFT",
        "AMD",
    }


def is_futures_symbol(symbol: str) -> bool:
    return normalize_symbol(symbol) in {"MES1!", "ES1!"}


def massive_equity_ticker(symbol: str) -> str:
    return normalize_symbol(symbol).replace("!", "")


def massive_crypto_ticker(symbol: str) -> str:
    normalized = normalize_symbol(symbol)

    if normalized == "BTCUSD":
        return "X:BTCUSD"

    if normalized == "ETHUSD":
        return "X:ETHUSD"

    return normalized


def binance_futures_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)

    if normalized == "BTCUSD":
        return "BTCUSDT"

    if normalized == "ETHUSD":
        return "ETHUSDT"

    return normalized


def okx_swap_inst_id(symbol: str) -> str:
    normalized = normalize_symbol(symbol)

    if normalized == "BTCUSD":
        return "BTC-USDT-SWAP"

    if normalized == "ETHUSD":
        return "ETH-USDT-SWAP"

    return normalized


def cache_get(key: str) -> Optional[Dict[str, Any]]:
    cached = _EXTERNAL_DATA_CACHE.get(key)

    if not isinstance(cached, dict):
        return None

    created_epoch = to_float(cached.get("_cacheEpoch"), 0)

    if created_epoch <= 0:
        return None

    age = time.time() - created_epoch

    if age > MASSIVE_CACHE_TTL_SECONDS:
        return None

    payload = dict(cached)
    payload.pop("_cacheEpoch", None)
    payload["cache"] = "hit"
    payload["cacheAgeSeconds"] = round(age, 2)

    return payload


def cache_set(key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    stored = dict(payload)
    stored["_cacheEpoch"] = time.time()
    stored["cache"] = "stored"
    _EXTERNAL_DATA_CACHE[key] = stored

    public_payload = dict(stored)
    public_payload.pop("_cacheEpoch", None)

    return public_payload


def redact_key_from_text(value: str) -> str:
    redacted = str(value or "")
    for secret in [MASSIVE_API_KEY, FRED_API_KEY, DATABENTO_API_KEY]:
        if secret:
            redacted = redacted.replace(secret, "***")
    return redacted


def http_json_request(
    url: str,
    *,
    timeout: float,
    headers: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    request = Request(
        url,
        headers=headers
        or {
            "Accept": "application/json",
            "User-Agent": "trading-intelligence-dashboard/1.0",
        },
        method="GET",
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            data = json.loads(body) if body else {}

            return {
                "ok": True,
                "status": int(getattr(response, "status", 200)),
                "url": redact_key_from_text(url),
                "data": data,
                "createdAt": utc_now_iso(),
            }

    except HTTPError as error:
        try:
            body = error.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""

        return {
            "ok": False,
            "status": int(getattr(error, "code", 0) or 0),
            "url": redact_key_from_text(url),
            "error": str(error),
            "body": redact_key_from_text(body[:1200]),
            "createdAt": utc_now_iso(),
        }

    except URLError as error:
        return {
            "ok": False,
            "status": 0,
            "url": redact_key_from_text(url),
            "error": str(error),
            "createdAt": utc_now_iso(),
        }

    except Exception as error:
        return {
            "ok": False,
            "status": 0,
            "url": redact_key_from_text(url),
            "error": str(error),
            "createdAt": utc_now_iso(),
        }


def http_text_request(
    url: str,
    *,
    timeout: float,
    headers: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    request = Request(
        url,
        headers=headers
        or {
            "Accept": "text/plain,*/*",
            "User-Agent": "trading-intelligence-dashboard/1.0",
        },
        method="GET",
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")

            return {
                "ok": True,
                "status": int(getattr(response, "status", 200)),
                "url": redact_key_from_text(url),
                "text": body,
                "createdAt": utc_now_iso(),
            }

    except HTTPError as error:
        try:
            body = error.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""

        return {
            "ok": False,
            "status": int(getattr(error, "code", 0) or 0),
            "url": redact_key_from_text(url),
            "error": str(error),
            "body": redact_key_from_text(body[:1200]),
            "createdAt": utc_now_iso(),
        }

    except URLError as error:
        return {
            "ok": False,
            "status": 0,
            "url": redact_key_from_text(url),
            "error": str(error),
            "createdAt": utc_now_iso(),
        }

    except Exception as error:
        return {
            "ok": False,
            "status": 0,
            "url": redact_key_from_text(url),
            "error": str(error),
            "createdAt": utc_now_iso(),
        }


def massive_request(path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if not MASSIVE_API_KEY:
        return {
            "ok": False,
            "status": 0,
            "path": path,
            "error": "MASSIVE_API_KEY missing",
            "createdAt": utc_now_iso(),
        }

    safe_params = {
        key: value
        for key, value in (params or {}).items()
        if value is not None and value != ""
    }

    safe_params.setdefault("apiKey", MASSIVE_API_KEY)

    query = urlencode(safe_params, doseq=True)
    url = f"{MASSIVE_BASE_URL}{path}"

    if query:
        url = f"{url}?{query}"

    headers = {
        "Accept": "application/json",
        "User-Agent": "trading-intelligence-dashboard/1.0",
        "Authorization": f"Bearer {MASSIVE_API_KEY}",
    }

    result = http_json_request(url, timeout=MASSIVE_TIMEOUT_SECONDS, headers=headers)
    result["path"] = path
    return result


def binance_request(path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    safe_params = {
        key: value
        for key, value in (params or {}).items()
        if value is not None and value != ""
    }

    query = urlencode(safe_params, doseq=True)
    url = f"{BINANCE_FUTURES_BASE_URL}{path}"

    if query:
        url = f"{url}?{query}"

    result = http_json_request(url, timeout=BINANCE_TIMEOUT_SECONDS)
    result["path"] = path
    return result


def okx_request(path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    safe_params = {
        key: value
        for key, value in (params or {}).items()
        if value is not None and value != ""
    }

    query = urlencode(safe_params, doseq=True)
    url = f"{OKX_BASE_URL}{path}"

    if query:
        url = f"{url}?{query}"

    result = http_json_request(url, timeout=OKX_TIMEOUT_SECONDS)
    result["path"] = path
    return result


def fred_request(series_id: str, limit: int = 8) -> Dict[str, Any]:
    if not FRED_API_KEY:
        return {
            "ok": False,
            "status": 0,
            "path": "/fred/series/observations",
            "seriesId": series_id,
            "error": "FRED_API_KEY missing",
            "createdAt": utc_now_iso(),
        }

    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "sort_order": "desc",
        "limit": max(2, min(int(limit or 8), 30)),
    }

    query = urlencode(params, doseq=True)
    url = f"{FRED_BASE_URL}/fred/series/observations?{query}"

    result = http_json_request(url, timeout=FRED_TIMEOUT_SECONDS)
    result["path"] = "/fred/series/observations"
    result["seriesId"] = series_id
    return result


def finra_daily_file_request(date_value: datetime) -> Dict[str, Any]:
    date_token = date_value.strftime("%Y%m%d")
    path = f"/equity/regsho/daily/CNMSshvol{date_token}.txt"
    url = f"{FINRA_BASE_URL}{path}"

    result = http_text_request(url, timeout=FINRA_TIMEOUT_SECONDS)
    result["path"] = path
    result["fileDate"] = date_value.strftime("%Y-%m-%d")
    return result


def extract_results(result: Dict[str, Any]) -> List[Dict[str, Any]]:
    data = result.get("data") if isinstance(result, dict) else None

    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]

    if not isinstance(data, dict):
        return []

    # Polygon / Massive
    rows = data.get("results")
    if isinstance(rows, list):
        return [row for row in rows if isinstance(row, dict)]
    if isinstance(rows, dict):
        return [rows]

    # OKX
    okx_rows = data.get("data")
    if isinstance(okx_rows, list):
        return [row for row in okx_rows if isinstance(row, dict)]
    if isinstance(okx_rows, dict):
        return [okx_rows]

    return []


def summarize_result(name: str, result: Dict[str, Any]) -> Dict[str, Any]:
    rows = extract_results(result)
    sample_keys: List[str] = []

    if rows:
        sample_keys = list(rows[0].keys())[:30]
    elif isinstance(result.get("data"), dict):
        sample_keys = list(result["data"].keys())[:30]
    elif isinstance(result.get("data"), list) and result["data"]:
        first = result["data"][0]
        if isinstance(first, dict):
            sample_keys = list(first.keys())[:30]

    return {
        "name": name,
        "ok": bool(result.get("ok")),
        "status": result.get("status"),
        "path": result.get("path"),
        "count": len(rows),
        "sampleKeys": sample_keys,
        "error": result.get("error"),
        "body": result.get("body"),
    }


def inactive_factor(
    *,
    symbol: str,
    timeframe: str,
    name: str,
    source: str,
    status: str,
    reason: str,
) -> Dict[str, Any]:
    return {
        "status": status,
        "label": name,
        "source": source,
        "symbol": normalize_symbol(symbol),
        "timeframe": normalize_timeframe(timeframe),
        "direction": "neutral",
        "strength": 0,
        "reason": reason,
        "createdAt": utc_now_iso(),
    }


def signal_text_from_factor(factor: Dict[str, Any]) -> Optional[str]:
    if not isinstance(factor, dict):
        return None

    status = str(factor.get("status") or "").lower()
    direction = str(factor.get("direction") or "").lower()
    label = str(factor.get("label") or "").strip()

    if status not in {"active", "live"}:
        return None

    if direction in {"bullish", "bearish"}:
        return label or direction

    if direction == "active":
        return label or "Active"

    return None


def factor_strength(factor: Dict[str, Any]) -> float:
    if not isinstance(factor, dict):
        return 0.0

    return clamp(to_float(factor.get("strength"), 0))


def build_massive_options_chain_context(symbol: str, timeframe: str = "1m") -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    underlying = massive_equity_ticker(normalized)

    if not is_equity_symbol(underlying):
        return inactive_factor(
            symbol=normalized,
            timeframe=normalized_timeframe,
            name="Options Chain Not Applicable",
            source="massive_options_contracts",
            status="not_applicable",
            reason=f"Options chain is not applicable for {normalized}",
        )

    cache_key = f"massive:options-chain:{underlying}:{normalized_timeframe}"
    cached = cache_get(cache_key)

    if cached:
        return cached

    contracts = massive_request(
        "/v3/reference/options/contracts",
        {
            "underlying_ticker": underlying,
            "limit": 250,
            "expired": "false",
            "order": "asc",
            "sort": "expiration_date",
        },
    )

    rows = extract_results(contracts)

    if not contracts.get("ok"):
        payload = {
            "status": "unavailable",
            "label": "Options Chain Unavailable",
            "source": "massive_options_contracts",
            "symbol": normalized,
            "timeframe": normalized_timeframe,
            "underlying": underlying,
            "direction": "neutral",
            "strength": 0,
            "reason": contracts.get("error") or contracts.get("body") or "massive_options_contracts_failed",
            "probe": summarize_result("options_contracts", contracts),
            "createdAt": utc_now_iso(),
        }
        return cache_set(cache_key, payload)

    call_count = 0
    put_count = 0
    expirations = set()

    for row in rows:
        contract_type = str(row.get("contract_type") or row.get("type") or "").lower()

        if "call" in contract_type:
            call_count += 1
        elif "put" in contract_type:
            put_count += 1

        expiration = row.get("expiration_date")
        if expiration:
            expirations.add(str(expiration))

    total = call_count + put_count
    call_share = call_count / max(total, 1) * 100
    put_share = put_count / max(total, 1) * 100

    if total <= 0:
        direction = "neutral"
        strength = 0
        label = "Options Chain Empty"
        status = "unavailable"
        reason = "no_contracts_returned"
    elif call_share > put_share + 8:
        direction = "bullish"
        strength = clamp(call_share)
        label = "Bullish Options Chain"
        status = "active"
        reason = "ok"
    elif put_share > call_share + 8:
        direction = "bearish"
        strength = clamp(put_share)
        label = "Bearish Options Chain"
        status = "active"
        reason = "ok"
    else:
        direction = "active"
        strength = clamp(max(call_share, put_share, 40))
        label = "Balanced Options Chain"
        status = "active"
        reason = "ok"

    payload = {
        "status": status,
        "label": label,
        "source": "massive_options_contracts",
        "symbol": normalized,
        "timeframe": normalized_timeframe,
        "underlying": underlying,
        "direction": direction,
        "strength": round(strength),
        "contractsCount": len(rows),
        "callContracts": call_count,
        "putContracts": put_count,
        "callShare": round(call_share, 2),
        "putShare": round(put_share, 2),
        "expirationCount": len(expirations),
        "reason": reason,
        "probe": summarize_result("options_contracts", contracts),
        "createdAt": utc_now_iso(),
    }

    return cache_set(cache_key, payload)


def build_okx_open_interest_context(symbol: str, timeframe: str = "1m") -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    if not is_crypto_symbol(normalized):
        return inactive_factor(
            symbol=normalized,
            timeframe=normalized_timeframe,
            name="Open Interest Not Applicable",
            source="okx_public_open_interest",
            status="not_applicable",
            reason=f"OKX swap open interest is only used for crypto symbols, not {normalized}",
        )

    inst_id = okx_swap_inst_id(normalized)
    cache_key = f"okx:open-interest:{inst_id}:{normalized_timeframe}"
    cached = cache_get(cache_key)

    if cached:
        return cached

    response = okx_request(
        "/api/v5/public/open-interest",
        {
            "instType": "SWAP",
            "instId": inst_id,
        },
    )

    rows = extract_results(response)

    if not response.get("ok") or not rows:
        payload = {
            "status": "unavailable",
            "label": "Open Interest Unavailable",
            "source": "okx_public_open_interest",
            "symbol": normalized,
            "timeframe": normalized_timeframe,
            "okxInstId": inst_id,
            "direction": "neutral",
            "strength": 0,
            "reason": response.get("error") or response.get("body") or "okx_open_interest_failed",
            "probe": summarize_result("okx_open_interest", response),
            "createdAt": utc_now_iso(),
        }
        return cache_set(cache_key, payload)

    row = rows[0]
    open_interest = to_float(row.get("oi"), 0.0)
    open_interest_ccy = to_float(row.get("oiCcy"), 0.0)

    if open_interest <= 0 and open_interest_ccy <= 0:
        label = "Open Interest Empty"
        status = "unavailable"
        direction = "neutral"
        strength = 0
        reason = "zero_open_interest"
    else:
        label = "Open Interest Active"
        status = "active"
        direction = "active"
        strength = 65
        reason = "okx_current_open_interest_available"

    payload = {
        "status": status,
        "label": label,
        "source": "okx_public_open_interest",
        "symbol": normalized,
        "timeframe": normalized_timeframe,
        "okxInstId": inst_id,
        "direction": direction,
        "strength": strength,
        "openInterest": open_interest,
        "openInterestCurrency": open_interest_ccy,
        "timestamp": row.get("ts"),
        "reason": reason,
        "probe": summarize_result("okx_open_interest", response),
        "createdAt": utc_now_iso(),
    }

    return cache_set(cache_key, payload)


def build_okx_footprint_context(symbol: str, timeframe: str = "1m") -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    if not is_crypto_symbol(normalized):
        return inactive_factor(
            symbol=normalized,
            timeframe=normalized_timeframe,
            name="Footprint Delta Not Applicable",
            source="okx_public_trades_side_delta",
            status="not_applicable",
            reason=f"OKX swap trade-side footprint is only used for crypto symbols, not {normalized}",
        )

    inst_id = okx_swap_inst_id(normalized)
    cache_key = f"okx:footprint:{inst_id}:{normalized_timeframe}"
    cached = cache_get(cache_key)

    if cached:
        return cached

    response = okx_request(
        "/api/v5/market/trades",
        {
            "instId": inst_id,
            "limit": 100,
        },
    )

    rows = extract_results(response)

    if not response.get("ok") or not rows:
        payload = {
            "status": "unavailable",
            "label": "Footprint Delta Unavailable",
            "source": "okx_public_trades_side_delta",
            "symbol": normalized,
            "timeframe": normalized_timeframe,
            "okxInstId": inst_id,
            "direction": "neutral",
            "strength": 0,
            "reason": response.get("error") or response.get("body") or "okx_trades_failed",
            "probe": summarize_result("okx_trades", response),
            "createdAt": utc_now_iso(),
        }
        return cache_set(cache_key, payload)

    buy_volume = 0.0
    sell_volume = 0.0

    for row in rows:
        side = str(row.get("side") or "").lower()
        size = to_float(row.get("sz"), 0.0)

        if side == "buy":
            buy_volume += size
        elif side == "sell":
            sell_volume += size

    total = buy_volume + sell_volume
    delta = buy_volume - sell_volume
    delta_pct = delta / max(total, 1.0) * 100.0
    strength = clamp(abs(delta_pct))

    if total <= 0:
        status = "unavailable"
        direction = "neutral"
        label = "Footprint Delta Empty"
        strength = 0
        reason = "zero_trade_side_volume"
    elif delta_pct > 5:
        status = "active"
        direction = "bullish"
        label = "Bullish Footprint Delta"
        reason = "okx_buy_side_volume_above_sell_side_volume"
    elif delta_pct < -5:
        status = "active"
        direction = "bearish"
        label = "Bearish Footprint Delta"
        reason = "okx_sell_side_volume_above_buy_side_volume"
    else:
        status = "active"
        direction = "active"
        label = "Balanced Footprint Delta"
        reason = "okx_buy_sell_side_volume_balanced"

    payload = {
        "status": status,
        "label": label,
        "source": "okx_public_trades_side_delta",
        "symbol": normalized,
        "timeframe": normalized_timeframe,
        "okxInstId": inst_id,
        "direction": direction,
        "strength": round(strength),
        "buyVolume": round(buy_volume, 6),
        "sellVolume": round(sell_volume, 6),
        "delta": round(delta, 6),
        "deltaPct": round(delta_pct, 2),
        "tradeCount": len(rows),
        "reason": reason,
        "probe": summarize_result("okx_trades", response),
        "createdAt": utc_now_iso(),
    }

    return cache_set(cache_key, payload)


def build_binance_open_interest_context(symbol: str, timeframe: str = "1m") -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    if not is_crypto_symbol(normalized):
        return inactive_factor(
            symbol=normalized,
            timeframe=normalized_timeframe,
            name="Open Interest Not Applicable",
            source="binance_futures_open_interest",
            status="not_applicable",
            reason=f"Binance futures open interest is only used for crypto symbols, not {normalized}",
        )

    binance_symbol = binance_futures_symbol(normalized)
    cache_key = f"binance:open-interest:{binance_symbol}:{normalized_timeframe}"
    cached = cache_get(cache_key)

    if cached:
        return cached

    current = binance_request("/fapi/v1/openInterest", {"symbol": binance_symbol})

    if not current.get("ok"):
        payload = {
            "status": "unavailable",
            "label": "Open Interest Unavailable",
            "source": "binance_futures_open_interest",
            "symbol": normalized,
            "timeframe": normalized_timeframe,
            "binanceSymbol": binance_symbol,
            "direction": "neutral",
            "strength": 0,
            "reason": current.get("error") or current.get("body") or "binance_open_interest_failed",
            "probe": summarize_result("binance_open_interest", current),
            "createdAt": utc_now_iso(),
        }
        return cache_set(cache_key, payload)

    data = current.get("data") if isinstance(current.get("data"), dict) else {}
    open_interest = to_float(data.get("openInterest"), 0.0)

    payload = {
        "status": "active" if open_interest > 0 else "unavailable",
        "label": "Open Interest Active" if open_interest > 0 else "Open Interest Empty",
        "source": "binance_futures_open_interest",
        "symbol": normalized,
        "timeframe": normalized_timeframe,
        "binanceSymbol": binance_symbol,
        "direction": "active" if open_interest > 0 else "neutral",
        "strength": 65 if open_interest > 0 else 0,
        "openInterest": open_interest,
        "openInterestTime": data.get("time"),
        "reason": "current_open_interest_available" if open_interest > 0 else "zero_open_interest",
        "probe": summarize_result("binance_open_interest", current),
        "createdAt": utc_now_iso(),
    }

    return cache_set(cache_key, payload)


def build_binance_footprint_context(symbol: str, timeframe: str = "1m") -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    if not is_crypto_symbol(normalized):
        return inactive_factor(
            symbol=normalized,
            timeframe=normalized_timeframe,
            name="Footprint Delta Not Applicable",
            source="binance_futures_taker_buy_sell",
            status="not_applicable",
            reason=f"Binance futures footprint proxy is only used for crypto symbols, not {normalized}",
        )

    binance_symbol = binance_futures_symbol(normalized)
    period = binance_period_from_timeframe(normalized_timeframe)
    cache_key = f"binance:footprint:{binance_symbol}:{period}"
    cached = cache_get(cache_key)

    if cached:
        return cached

    taker = binance_request(
        "/futures/data/takerlongshortRatio",
        {
            "symbol": binance_symbol,
            "period": period,
            "limit": 1,
        },
    )

    rows = extract_results(taker)

    if not taker.get("ok") or not rows:
        payload = {
            "status": "unavailable",
            "label": "Footprint Delta Unavailable",
            "source": "binance_futures_taker_buy_sell",
            "symbol": normalized,
            "timeframe": normalized_timeframe,
            "binanceSymbol": binance_symbol,
            "period": period,
            "direction": "neutral",
            "strength": 0,
            "reason": taker.get("error") or taker.get("body") or "binance_taker_ratio_failed",
            "probe": summarize_result("binance_taker_ratio", taker),
            "createdAt": utc_now_iso(),
        }
        return cache_set(cache_key, payload)

    row = rows[0]
    buy_volume = to_float(row.get("buyVol") or row.get("buyVolume"), 0.0)
    sell_volume = to_float(row.get("sellVol") or row.get("sellVolume"), 0.0)
    total = buy_volume + sell_volume
    delta = buy_volume - sell_volume
    delta_pct = delta / max(total, 1.0) * 100.0
    strength = clamp(abs(delta_pct))

    if total <= 0:
        status = "unavailable"
        direction = "neutral"
        label = "Footprint Delta Empty"
        reason = "zero_buy_sell_volume"
    elif delta_pct > 5:
        status = "active"
        direction = "bullish"
        label = "Bullish Footprint Delta"
        reason = "taker_buy_volume_above_sell_volume"
    elif delta_pct < -5:
        status = "active"
        direction = "bearish"
        label = "Bearish Footprint Delta"
        reason = "taker_sell_volume_above_buy_volume"
    else:
        status = "active"
        direction = "active"
        label = "Balanced Footprint Delta"
        reason = "taker_buy_sell_balanced"

    payload = {
        "status": status,
        "label": label,
        "source": "binance_futures_taker_buy_sell",
        "symbol": normalized,
        "timeframe": normalized_timeframe,
        "binanceSymbol": binance_symbol,
        "period": period,
        "direction": direction,
        "strength": round(strength) if total > 0 else 0,
        "buyVolume": round(buy_volume, 6),
        "sellVolume": round(sell_volume, 6),
        "delta": round(delta, 6),
        "deltaPct": round(delta_pct, 2),
        "timestamp": row.get("timestamp"),
        "reason": reason,
        "probe": summarize_result("binance_taker_ratio", taker),
        "createdAt": utc_now_iso(),
    }

    return cache_set(cache_key, payload)


def build_crypto_open_interest_context(symbol: str, timeframe: str = "1m") -> Dict[str, Any]:
    okx_factor = build_okx_open_interest_context(symbol, timeframe)

    if okx_factor.get("status") == "active":
        return okx_factor

    binance_factor = build_binance_open_interest_context(symbol, timeframe)

    if binance_factor.get("status") == "active":
        return binance_factor

    combined = dict(okx_factor)
    combined["fallbackProbe"] = binance_factor
    return combined


def build_crypto_footprint_context(symbol: str, timeframe: str = "1m") -> Dict[str, Any]:
    okx_factor = build_okx_footprint_context(symbol, timeframe)

    if okx_factor.get("status") == "active":
        return okx_factor

    binance_factor = build_binance_footprint_context(symbol, timeframe)

    if binance_factor.get("status") == "active":
        return binance_factor

    combined = dict(okx_factor)
    combined["fallbackProbe"] = binance_factor
    return combined



def latest_fred_values(response: Dict[str, Any]) -> Dict[str, Any]:
    data = response.get("data") if isinstance(response, dict) else None

    if not isinstance(data, dict):
        return {
            "latest": None,
            "previous": None,
            "latestDate": None,
            "previousDate": None,
            "count": 0,
        }

    observations = data.get("observations")
    if not isinstance(observations, list):
        return {
            "latest": None,
            "previous": None,
            "latestDate": None,
            "previousDate": None,
            "count": 0,
        }

    cleaned: List[Dict[str, Any]] = []

    for observation in observations:
        if not isinstance(observation, dict):
            continue

        value_raw = observation.get("value")
        if value_raw in {None, "", "."}:
            continue

        value = to_float(value_raw, float("nan"))
        if value != value:
            continue

        cleaned.append(
            {
                "date": observation.get("date"),
                "value": value,
            }
        )

    latest = cleaned[0] if len(cleaned) >= 1 else None
    previous = cleaned[1] if len(cleaned) >= 2 else None

    return {
        "latest": latest.get("value") if latest else None,
        "previous": previous.get("value") if previous else None,
        "latestDate": latest.get("date") if latest else None,
        "previousDate": previous.get("date") if previous else None,
        "count": len(cleaned),
    }


def build_fred_macro_context(symbol: str, timeframe: str = "1m") -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    cache_key = f"fred:macro:{normalized}:{normalized_timeframe}"
    cached = cache_get(cache_key)

    if cached:
        return cached

    if not FRED_API_KEY:
        return cache_set(
            cache_key,
            inactive_factor(
                symbol=normalized,
                timeframe=normalized_timeframe,
                name="FRED Macro Missing Key",
                source="fred_api",
                status="missing_key",
                reason="Add FRED_API_KEY in Render Environment Variables to enable FRED macro.",
            ),
        )

    # Series used:
    # DGS10   = 10-Year Treasury Constant Maturity Rate
    # T10Y2Y  = 10-Year Treasury minus 2-Year Treasury spread
    # DFF     = Effective Federal Funds Rate
    # VIXCLS  = CBOE Volatility Index
    series_config = {
        "DGS10": {
            "label": "10Y Yield",
            "riskWhen": "rising",
            "threshold": 0.02,
            "weight": 22,
        },
        "T10Y2Y": {
            "label": "10Y-2Y Curve",
            "riskWhen": "falling_or_inverted",
            "threshold": 0.03,
            "weight": 22,
        },
        "DFF": {
            "label": "Fed Funds",
            "riskWhen": "rising",
            "threshold": 0.01,
            "weight": 16,
        },
        "VIXCLS": {
            "label": "VIX",
            "riskWhen": "rising",
            "threshold": 0.50,
            "weight": 40,
        },
    }

    series_results: Dict[str, Any] = {}
    bull_score = 0.0
    bear_score = 0.0
    active_count = 0
    warnings: List[str] = []

    for series_id, config in series_config.items():
        response = fred_request(series_id, limit=8)
        values = latest_fred_values(response)
        latest = values.get("latest")
        previous = values.get("previous")
        delta = None

        if isinstance(latest, (int, float)) and isinstance(previous, (int, float)):
            delta = latest - previous

        item = {
            "seriesId": series_id,
            "label": config["label"],
            "ok": bool(response.get("ok")),
            "status": response.get("status"),
            "latest": latest,
            "previous": previous,
            "delta": delta,
            "latestDate": values.get("latestDate"),
            "previousDate": values.get("previousDate"),
            "count": values.get("count"),
            "error": response.get("error"),
            "body": response.get("body"),
        }

        if latest is None:
            warnings.append(f"{series_id} unavailable")
            series_results[series_id] = item
            continue

        active_count += 1
        threshold = to_float(config.get("threshold"), 0)
        weight = to_float(config.get("weight"), 0)
        risk_when = str(config.get("riskWhen") or "")

        if series_id == "T10Y2Y":
            # Inverted or deeply negative curve is risk-off.
            # Improving / positive curve is risk-on.
            if latest < -0.25:
                bear_score += weight
                item["macroSignal"] = "bearish"
                item["macroReason"] = "yield_curve_inverted"
            elif latest > 0.25:
                bull_score += weight * 0.70
                item["macroSignal"] = "bullish"
                item["macroReason"] = "yield_curve_positive"
            elif delta is not None and delta > threshold:
                bull_score += weight * 0.45
                item["macroSignal"] = "bullish"
                item["macroReason"] = "yield_curve_improving"
            elif delta is not None and delta < -threshold:
                bear_score += weight * 0.45
                item["macroSignal"] = "bearish"
                item["macroReason"] = "yield_curve_worsening"
            else:
                item["macroSignal"] = "neutral"
                item["macroReason"] = "yield_curve_mixed"

        elif risk_when == "rising":
            if delta is not None and delta > threshold:
                bear_score += weight
                item["macroSignal"] = "bearish"
                item["macroReason"] = f"{series_id}_rising"
            elif delta is not None and delta < -threshold:
                bull_score += weight
                item["macroSignal"] = "bullish"
                item["macroReason"] = f"{series_id}_falling"
            else:
                item["macroSignal"] = "neutral"
                item["macroReason"] = f"{series_id}_flat_or_mixed"

        else:
            item["macroSignal"] = "neutral"
            item["macroReason"] = "not_scored"

        series_results[series_id] = item

    if active_count <= 0:
        payload = {
            "status": "unavailable",
            "label": "FRED Macro Unavailable",
            "source": "fred_api_series_observations",
            "symbol": normalized,
            "timeframe": normalized_timeframe,
            "direction": "neutral",
            "strength": 0,
            "reason": "; ".join(warnings) or "no_fred_series_available",
            "series": series_results,
            "createdAt": utc_now_iso(),
        }
        return cache_set(cache_key, payload)

    net = bull_score - bear_score
    max_side = max(bull_score, bear_score)
    strength = clamp(max_side)

    if net > 12:
        direction = "bullish"
        label = "Bullish FRED Macro"
        reason = "macro_risk_on"
    elif net < -12:
        direction = "bearish"
        label = "Bearish FRED Macro"
        reason = "macro_risk_off"
    else:
        direction = "active"
        label = "Neutral FRED Macro"
        reason = "macro_mixed"

    payload = {
        "status": "active",
        "label": label,
        "source": "fred_api_series_observations",
        "symbol": normalized,
        "timeframe": normalized_timeframe,
        "direction": direction,
        "strength": strength,
        "bullScore": round(bull_score, 2),
        "bearScore": round(bear_score, 2),
        "netScore": round(net, 2),
        "activeSeries": active_count,
        "series": series_results,
        "reason": reason,
        "createdAt": utc_now_iso(),
    }

    return cache_set(cache_key, payload)



def parse_finra_short_volume_file(text: str, target_symbol: str) -> Optional[Dict[str, Any]]:
    target = normalize_symbol(target_symbol).replace("!", "")

    for line in str(text or "").splitlines():
        clean_line = line.strip()

        if not clean_line:
            continue

        lower_line = clean_line.lower()

        if lower_line.startswith("symbol|") or lower_line.startswith("date|"):
            continue

        parts = [part.strip() for part in clean_line.split("|")]

        # FINRA files can appear as either:
        # Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market
        # or:
        # Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market
        if len(parts) >= 6 and parts[0].isdigit() and len(parts[0]) == 8:
            file_date = parts[0]
            symbol = parts[1].upper()
            short_volume = to_float(parts[2], 0)
            short_exempt_volume = to_float(parts[3], 0)
            total_volume = to_float(parts[4], 0)
            market = parts[5] if len(parts) >= 6 else "FINRA"
        elif len(parts) >= 5:
            file_date = None
            symbol = parts[0].upper()
            short_volume = to_float(parts[1], 0)
            short_exempt_volume = to_float(parts[2], 0)
            total_volume = to_float(parts[3], 0)
            market = parts[4] if len(parts) >= 5 else "FINRA"
        else:
            continue

        if symbol != target:
            continue

        short_pct = short_volume / max(total_volume, 1) * 100
        short_exempt_pct = short_exempt_volume / max(total_volume, 1) * 100

        return {
            "symbol": symbol,
            "fileDateRaw": file_date,
            "shortVolume": short_volume,
            "shortExemptVolume": short_exempt_volume,
            "totalVolume": total_volume,
            "shortPct": short_pct,
            "shortExemptPct": short_exempt_pct,
            "market": market,
        }

    return None


def recent_market_dates(max_days: int = 10) -> List[datetime]:
    now_et = datetime.now(timezone.utc)
    dates: List[datetime] = []

    for offset in range(0, max_days):
        candidate = now_et - timedelta(days=offset)

        # FINRA files are daily and business-day based.
        if candidate.weekday() >= 5:
            continue

        dates.append(candidate)

    return dates


def build_finra_short_volume_context(symbol: str, timeframe: str = "1m") -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    if not is_equity_symbol(normalized):
        return inactive_factor(
            symbol=normalized,
            timeframe=normalized_timeframe,
            name="FINRA Short Volume Not Applicable",
            source="finra_regsho_daily_short_volume",
            status="not_applicable",
            reason=f"FINRA short volume is equity/ETF data and is not applicable for {normalized}.",
        )

    cache_key = f"finra:short-volume:{normalized}:{normalized_timeframe}"
    cached = cache_get(cache_key)

    if cached:
        return cached

    probes: List[Dict[str, Any]] = []
    matched_row: Optional[Dict[str, Any]] = None
    matched_file_date: Optional[str] = None

    for candidate in recent_market_dates(12):
        response = finra_daily_file_request(candidate)
        probes.append(
            {
                "ok": response.get("ok"),
                "status": response.get("status"),
                "path": response.get("path"),
                "fileDate": response.get("fileDate"),
                "error": response.get("error"),
                "body": response.get("body"),
            }
        )

        if not response.get("ok"):
            continue

        row = parse_finra_short_volume_file(response.get("text", ""), normalized)

        if row:
            matched_row = row
            matched_file_date = response.get("fileDate")
            break

    if not matched_row:
        payload = {
            "status": "unavailable",
            "label": "FINRA Short Volume Unavailable",
            "source": "finra_regsho_daily_short_volume",
            "symbol": normalized,
            "timeframe": normalized_timeframe,
            "direction": "neutral",
            "strength": 0,
            "reason": "No matching FINRA CNMS short-volume row found in recent daily files.",
            "probes": probes[:8],
            "createdAt": utc_now_iso(),
        }
        return cache_set(cache_key, payload)

    short_pct = to_float(matched_row.get("shortPct"), 0)

    if short_pct >= 55:
        direction = "bearish"
        label = "Bearish FINRA Short Volume"
        strength = clamp(50 + (short_pct - 50) * 2)
        reason = "elevated_short_volume_share"
    elif short_pct <= 35:
        direction = "bullish"
        label = "Bullish FINRA Short Volume"
        strength = clamp(50 + (50 - short_pct))
        reason = "low_short_volume_share"
    else:
        direction = "active"
        label = "Neutral FINRA Short Volume"
        strength = clamp(45 + abs(short_pct - 50))
        reason = "balanced_short_volume_share"

    payload = {
        "status": "active",
        "label": label,
        "source": "finra_regsho_daily_short_volume",
        "symbol": normalized,
        "timeframe": normalized_timeframe,
        "direction": direction,
        "strength": strength,
        "fileDate": matched_file_date,
        "shortVolume": matched_row.get("shortVolume"),
        "shortExemptVolume": matched_row.get("shortExemptVolume"),
        "totalVolume": matched_row.get("totalVolume"),
        "shortPct": round(short_pct, 2),
        "shortExemptPct": round(to_float(matched_row.get("shortExemptPct"), 0), 4),
        "market": matched_row.get("market"),
        "reason": reason,
        "probes": probes[:4],
        "createdAt": utc_now_iso(),
    }

    return cache_set(cache_key, payload)



def databento_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)

    if normalized == "MES1!":
        return DATABENTO_MES_SYMBOL or "MES.c.0"

    if normalized == "ES1!":
        return DATABENTO_ES_SYMBOL or "ES.c.0"

    return normalized.replace("!", "")


def find_first_column(columns: List[str], candidates: List[str]) -> Optional[str]:
    lowered = {str(column).lower(): str(column) for column in columns}

    for candidate in candidates:
        key = str(candidate).lower()
        if key in lowered:
            return lowered[key]

    for column in columns:
        col_lower = str(column).lower()
        for candidate in candidates:
            if str(candidate).lower() in col_lower:
                return str(column)

    return None


def build_databento_mbp1_footprint_context(symbol: str, timeframe: str = "1m") -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    if not is_futures_symbol(normalized):
        return inactive_factor(
            symbol=normalized,
            timeframe=normalized_timeframe,
            name="Databento Footprint Not Applicable",
            source="databento_mbp1_top_of_book",
            status="not_applicable",
            reason=f"Databento MES/ES MBP-1 footprint is only used for futures symbols, not {normalized}.",
        )

    cache_key = f"databento:mbp1-footprint:{normalized}:{normalized_timeframe}"
    cached = cache_get(cache_key)

    if cached:
        return cached

    if not DATABENTO_API_KEY:
        return cache_set(
            cache_key,
            inactive_factor(
                symbol=normalized,
                timeframe=normalized_timeframe,
                name="Databento Missing Key",
                source="databento_mbp1_top_of_book",
                status="missing_key",
                reason="Add DATABENTO_API_KEY in Render Environment Variables to enable MES/ES MBP-1 footprint probe.",
            ),
        )

    try:
        import databento as db  # type: ignore
    except Exception as error:
        payload = {
            "status": "unavailable",
            "label": "Databento Package Missing",
            "source": "databento_mbp1_top_of_book",
            "symbol": normalized,
            "timeframe": normalized_timeframe,
            "direction": "neutral",
            "strength": 0,
            "reason": "databento_python_package_missing_add_databento_to_api_requirements",
            "error": str(error),
            "createdAt": utc_now_iso(),
        }
        return cache_set(cache_key, payload)

    dataset = DATABENTO_DATASET or "GLBX.MDP3"
    schema = DATABENTO_SCHEMA or "mbp-1"
    db_symbol = databento_symbol(normalized)
    lookback_minutes = max(1, min(int(DATABENTO_LOOKBACK_MINUTES or 5), 60))
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(minutes=lookback_minutes)

    try:
        client = db.Historical(DATABENTO_API_KEY)
        store = client.timeseries.get_range(
            dataset=dataset,
            symbols=[db_symbol],
            schema=schema,
            start=start_dt.isoformat(),
            end=end_dt.isoformat(),
        )

        try:
            frame = store.to_df()
        except Exception:
            frame = None

        if frame is None or getattr(frame, "empty", True):
            payload = {
                "status": "unavailable",
                "label": "Databento MBP-1 Empty",
                "source": "databento_mbp1_top_of_book",
                "symbol": normalized,
                "timeframe": normalized_timeframe,
                "databentoSymbol": db_symbol,
                "dataset": dataset,
                "schema": schema,
                "direction": "neutral",
                "strength": 0,
                "reason": "no_databento_records_returned_for_recent_window",
                "start": start_dt.isoformat(),
                "end": end_dt.isoformat(),
                "createdAt": utc_now_iso(),
            }
            return cache_set(cache_key, payload)

        if len(frame) > DATABENTO_MAX_RECORDS:
            frame = frame.tail(DATABENTO_MAX_RECORDS)

        columns = [str(column) for column in list(frame.columns)]
        bid_px_col = find_first_column(columns, ["bid_px_00", "bid_px", "bid_price", "bid"])
        ask_px_col = find_first_column(columns, ["ask_px_00", "ask_px", "ask_price", "ask"])
        bid_sz_col = find_first_column(columns, ["bid_sz_00", "bid_size_00", "bid_sz", "bid_size", "bid_qty", "bid"])
        ask_sz_col = find_first_column(columns, ["ask_sz_00", "ask_size_00", "ask_sz", "ask_size", "ask_qty", "ask"])

        if not bid_px_col or not ask_px_col:
            payload = {
                "status": "unavailable",
                "label": "Databento MBP-1 No Bid/Ask",
                "source": "databento_mbp1_top_of_book",
                "symbol": normalized,
                "timeframe": normalized_timeframe,
                "databentoSymbol": db_symbol,
                "dataset": dataset,
                "schema": schema,
                "direction": "neutral",
                "strength": 0,
                "reason": "databento_response_missing_bid_ask_columns",
                "columns": columns[:40],
                "records": int(len(frame)),
                "createdAt": utc_now_iso(),
            }
            return cache_set(cache_key, payload)

        bid_px = frame[bid_px_col].apply(lambda value: to_float(value, 0.0))
        ask_px = frame[ask_px_col].apply(lambda value: to_float(value, 0.0))
        mid_px = (bid_px + ask_px) / 2.0

        if bid_sz_col and ask_sz_col:
            bid_sz = frame[bid_sz_col].apply(lambda value: to_float(value, 0.0))
            ask_sz = frame[ask_sz_col].apply(lambda value: to_float(value, 0.0))
            bid_size_sum = float(bid_sz.sum())
            ask_size_sum = float(ask_sz.sum())
        else:
            bid_size_sum = 0.0
            ask_size_sum = 0.0

        size_total = bid_size_sum + ask_size_sum
        imbalance_pct = (bid_size_sum - ask_size_sum) / max(size_total, 1.0) * 100.0

        first_mid = to_float(mid_px.iloc[0], 0.0) if len(mid_px) else 0.0
        last_mid = to_float(mid_px.iloc[-1], 0.0) if len(mid_px) else 0.0
        mid_change = last_mid - first_mid if first_mid and last_mid else 0.0

        # MBP-1 is top-of-book, not true executed trade-side footprint.
        # Use top-of-book size imbalance + mid-price change as an estimated pressure signal.
        estimate = imbalance_pct
        if mid_change > 0:
            estimate += 10
        elif mid_change < 0:
            estimate -= 10

        estimate = max(-100.0, min(100.0, estimate))
        strength = clamp(abs(estimate))

        if estimate > 8:
            direction = "bullish"
            label = "Bullish Estimated MES Footprint"
            reason = "databento_mbp1_bid_pressure_above_ask_pressure"
        elif estimate < -8:
            direction = "bearish"
            label = "Bearish Estimated MES Footprint"
            reason = "databento_mbp1_ask_pressure_above_bid_pressure"
        else:
            direction = "active"
            label = "Balanced Estimated MES Footprint"
            reason = "databento_mbp1_top_of_book_balanced"

        payload = {
            "status": "active",
            "label": label,
            "source": "databento_mbp1_top_of_book",
            "symbol": normalized,
            "timeframe": normalized_timeframe,
            "databentoSymbol": db_symbol,
            "dataset": dataset,
            "schema": schema,
            "direction": direction,
            "strength": round(strength, 2),
            "deltaPct": round(estimate, 2),
            "bookImbalancePct": round(imbalance_pct, 2),
            "bidSizeSum": round(bid_size_sum, 2),
            "askSizeSum": round(ask_size_sum, 2),
            "midFirst": round(first_mid, 4),
            "midLast": round(last_mid, 4),
            "midChange": round(mid_change, 4),
            "records": int(len(frame)),
            "columns": columns[:40],
            "start": start_dt.isoformat(),
            "end": end_dt.isoformat(),
            "reason": reason,
            "note": "MBP-1 is top-of-book. This is estimated footprint pressure, not true executed trade aggressor delta.",
            "createdAt": utc_now_iso(),
        }
        return cache_set(cache_key, payload)

    except Exception as error:
        payload = {
            "status": "unavailable",
            "label": "Databento MBP-1 Unavailable",
            "source": "databento_mbp1_top_of_book",
            "symbol": normalized,
            "timeframe": normalized_timeframe,
            "databentoSymbol": db_symbol,
            "dataset": dataset,
            "schema": schema,
            "direction": "neutral",
            "strength": 0,
            "reason": "databento_mbp1_request_failed",
            "error": redact_key_from_text(str(error)),
            "start": start_dt.isoformat(),
            "end": end_dt.isoformat(),
            "createdAt": utc_now_iso(),
        }
        return cache_set(cache_key, payload)


def build_external_data_context(symbol: str = "BTCUSD", timeframe: str = "1m") -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    options_chain = build_massive_options_chain_context(normalized, normalized_timeframe)

    if is_crypto_symbol(normalized):
        open_interest = build_crypto_open_interest_context(normalized, normalized_timeframe)
        footprint = build_crypto_footprint_context(normalized, normalized_timeframe)
    elif is_futures_symbol(normalized):
        open_interest = inactive_factor(
            symbol=normalized,
            timeframe=normalized_timeframe,
            name="Futures Open Interest Pending",
            source="futures_open_interest_pending",
            status="not_wired_in_this_step",
            reason="MES/ES open interest will need a futures statistics/open-interest source. Databento MBP-1 does not provide OI.",
        )
        footprint = build_databento_mbp1_footprint_context(normalized, normalized_timeframe)
    else:
        open_interest = options_chain
        footprint = inactive_factor(
            symbol=normalized,
            timeframe=normalized_timeframe,
            name="Footprint Delta Pending",
            source="equity_futures_footprint_pending",
            status="not_wired_in_this_step",
            reason="Equity footprint needs quote/trade classification. MES/ES uses Databento MBP-1 when DATABENTO_API_KEY is configured.",
        )

    fred_macro = build_fred_macro_context(normalized, normalized_timeframe)

    finra_short_volume = build_finra_short_volume_context(normalized, normalized_timeframe)

    cot = inactive_factor(
        symbol=normalized,
        timeframe=normalized_timeframe,
        name="COT Pending",
        source="cftc_pending",
        status="not_wired_in_this_step",
        reason="CFTC COT will be wired in the next backend step.",
    )

    factors = {
        "optionsFlow": options_chain,
        "openInterest": open_interest,
        "footprint": footprint,
        "fredMacro": fred_macro,
        "finraShortVolume": finra_short_volume,
        "cot": cot,
    }

    signal_fields = {
        key: signal_text_from_factor(value)
        for key, value in factors.items()
        if isinstance(value, dict)
    }

    scalars = {
        "optionsFlowStrength": factor_strength(options_chain),
        "openInterestStrength": factor_strength(open_interest),
        "footprintStrength": factor_strength(footprint),
        "fredMacroStrength": factor_strength(fred_macro),
        "finraShortVolumeStrength": factor_strength(finra_short_volume),
        "finraShortVolumePct": to_float(finra_short_volume.get("shortPct"), 0) if isinstance(finra_short_volume, dict) else 0,
        "cotStrength": factor_strength(cot),
        "optionsBullPressure": to_float(options_chain.get("callShare"), 0) if isinstance(options_chain, dict) else 0,
        "optionsBearPressure": to_float(options_chain.get("putShare"), 0) if isinstance(options_chain, dict) else 0,
        "footprintDeltaPct": to_float(footprint.get("deltaPct"), 0) if isinstance(footprint, dict) else 0,
        "openInterest": to_float(open_interest.get("openInterest"), 0) if isinstance(open_interest, dict) else 0,
        "openInterestCurrency": to_float(open_interest.get("openInterestCurrency"), 0) if isinstance(open_interest, dict) else 0,
    }

    return {
        "eventType": "EXTERNAL_DATA_CONTEXT",
        "status": "live",
        "symbol": normalized,
        "timeframe": normalized_timeframe,
        "providerStatus": {
            "massive": {
                "configured": bool(MASSIVE_API_KEY),
                "enabled": bool(MASSIVE_API_KEY),
                "baseUrl": MASSIVE_BASE_URL,
                "cacheTtlSeconds": MASSIVE_CACHE_TTL_SECONDS,
            },
            "fred": {
                "configured": bool(FRED_API_KEY),
                "enabled": bool(FRED_API_KEY),
                "baseUrl": FRED_BASE_URL,
                "cacheTtlSeconds": FRED_CACHE_TTL_SECONDS,
                "series": ["DGS10", "T10Y2Y", "DFF", "VIXCLS"],
            },
            "finra": {
                "configured": True,
                "enabled": True,
                "baseUrl": FINRA_BASE_URL,
                "cacheTtlSeconds": FINRA_CACHE_TTL_SECONDS,
                "usedFor": ["SPY short volume", "QQQ short volume", "IWM short volume", "equity/ETF short volume"],
            },
            "databento": {
                "configured": bool(DATABENTO_API_KEY),
                "enabled": bool(DATABENTO_API_KEY),
                "dataset": DATABENTO_DATASET,
                "schema": DATABENTO_SCHEMA,
                "cacheTtlSeconds": DATABENTO_CACHE_TTL_SECONDS,
                "usedFor": ["MES1! estimated footprint", "ES1! estimated footprint"],
                "symbols": {"MES1!": DATABENTO_MES_SYMBOL, "ES1!": DATABENTO_ES_SYMBOL},
            },
            "okx": {
                "configured": True,
                "enabled": True,
                "baseUrl": OKX_BASE_URL,
                "usedFor": ["BTCUSD openInterest", "BTCUSD footprint", "ETHUSD openInterest", "ETHUSD footprint"],
            },
            "binanceFutures": {
                "configured": True,
                "enabled": True,
                "baseUrl": BINANCE_FUTURES_BASE_URL,
                "usedFor": ["secondary fallback if OKX fails"],
            },
        },
        "factors": factors,
        "signalFields": signal_fields,
        "scalars": scalars,
        "source": "external_data_engine_v8_databento_mbp1",
        "createdAt": utc_now_iso(),
    }


def build_external_data_status(symbol: str = "BTCUSD", timeframe: str = "1m") -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    context = build_external_data_context(normalized, normalized_timeframe)

    return {
        "eventType": "EXTERNAL_DATA_STATUS",
        "status": context.get("status", "unknown"),
        "source": "external_data_engine_v8_databento_mbp1",
        "symbol": normalized,
        "timeframe": normalized_timeframe,
        "massiveKeyPresent": bool(MASSIVE_API_KEY),
        "providers": context.get("providerStatus", {}),
        "factors": context.get("factors", {}),
        "signalFields": context.get("signalFields", {}),
        "scalars": context.get("scalars", {}),
        "createdAt": utc_now_iso(),
    }
