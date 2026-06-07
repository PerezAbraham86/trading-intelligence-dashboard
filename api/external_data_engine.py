from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


# ─────────────────────────────────────────────────────────────────────────────
# EXTERNAL DATA ENGINE
#
# v3 update:
# - Keeps Massive options/crypto probes
# - Adds FREE Binance Futures fallback for BTCUSD/ETHUSD:
#   1) Open Interest from /fapi/v1/openInterest
#   2) Footprint proxy from /futures/data/takerlongshortRatio
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

    # Binance futures data endpoints support limited periods.
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


def massive_crypto_ticker(symbol: str) -> str:
    normalized = normalize_symbol(symbol)

    if normalized == "BTCUSD":
        return "X:BTCUSD"

    if normalized == "ETHUSD":
        return "X:ETHUSD"

    return normalized


def massive_equity_ticker(symbol: str) -> str:
    return normalize_symbol(symbol).replace("!", "")


def binance_futures_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)

    if normalized == "BTCUSD":
        return "BTCUSDT"

    if normalized == "ETHUSD":
        return "ETHUSDT"

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
    if MASSIVE_API_KEY:
        return value.replace(MASSIVE_API_KEY, "***")

    return value


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
            "body": redact_key_from_text(body[:1000]),
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


def extract_results(result: Dict[str, Any]) -> List[Dict[str, Any]]:
    data = result.get("data") if isinstance(result, dict) else None

    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]

    if not isinstance(data, dict):
        return []

    rows = data.get("results")

    if isinstance(rows, list):
        return [row for row in rows if isinstance(row, dict)]

    if isinstance(rows, dict):
        return [rows]

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

    current = binance_request(
        "/fapi/v1/openInterest",
        {
            "symbol": binance_symbol,
        },
    )

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

    if open_interest <= 0:
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
        reason = "current_open_interest_available"

    payload = {
        "status": status,
        "label": label,
        "source": "binance_futures_open_interest",
        "symbol": normalized,
        "timeframe": normalized_timeframe,
        "binanceSymbol": binance_symbol,
        "direction": direction,
        "strength": strength,
        "openInterest": open_interest,
        "openInterestTime": data.get("time"),
        "reason": reason,
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

    if not taker.get("ok"):
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

    row = rows[0] if rows else {}

    buy_volume = to_float(row.get("buyVol") or row.get("buyVolume"), 0.0)
    sell_volume = to_float(row.get("sellVol") or row.get("sellVolume"), 0.0)
    ratio = to_float(row.get("buySellRatio"), 1.0)

    total = buy_volume + sell_volume
    delta = buy_volume - sell_volume
    delta_pct = delta / max(total, 1.0) * 100.0
    strength = clamp(abs(delta_pct))

    if total <= 0:
        status = "unavailable"
        direction = "neutral"
        label = "Footprint Delta Empty"
        strength = 0
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
        "strength": round(strength),
        "buyVolume": round(buy_volume, 6),
        "sellVolume": round(sell_volume, 6),
        "delta": round(delta, 6),
        "deltaPct": round(delta_pct, 2),
        "buySellRatio": round(ratio, 6),
        "timestamp": row.get("timestamp"),
        "reason": reason,
        "probe": summarize_result("binance_taker_ratio", taker),
        "createdAt": utc_now_iso(),
    }

    return cache_set(cache_key, payload)


def build_massive_crypto_footprint_context(symbol: str, timeframe: str = "1m") -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    if not is_crypto_symbol(normalized):
        return inactive_factor(
            symbol=normalized,
            timeframe=normalized_timeframe,
            name="Crypto Footprint Not Applicable",
            source="massive_crypto_trades",
            status="not_applicable",
            reason=f"Crypto trade footprint is not applicable for {normalized}",
        )

    ticker = massive_crypto_ticker(normalized)
    cache_key = f"massive:crypto-footprint:{ticker}:{normalized_timeframe}"
    cached = cache_get(cache_key)

    if cached:
        return cached

    trades = massive_request(
        f"/v3/trades/{ticker}",
        {
            "limit": 100,
            "order": "desc",
            "sort": "timestamp",
        },
    )

    rows = extract_results(trades)

    if not trades.get("ok"):
        payload = {
            "status": "unavailable",
            "label": "Crypto Footprint Unavailable",
            "source": "massive_crypto_trades",
            "symbol": normalized,
            "timeframe": normalized_timeframe,
            "ticker": ticker,
            "direction": "neutral",
            "strength": 0,
            "reason": trades.get("error") or trades.get("body") or "massive_crypto_trades_failed",
            "probe": summarize_result("crypto_trades", trades),
            "createdAt": utc_now_iso(),
        }
        return cache_set(cache_key, payload)

    prices: List[float] = []
    sizes: List[float] = []

    for row in rows:
        price = to_float(row.get("price") or row.get("p"), 0)
        size = to_float(row.get("size") or row.get("s") or row.get("volume"), 0)

        if price > 0:
            prices.append(price)
            sizes.append(size if size > 0 else 1.0)

    if len(prices) < 2:
        payload = {
            "status": "unavailable",
            "label": "Crypto Footprint Unavailable",
            "source": "massive_crypto_trades",
            "symbol": normalized,
            "timeframe": normalized_timeframe,
            "ticker": ticker,
            "direction": "neutral",
            "strength": 0,
            "reason": "not_enough_trades_for_delta_proxy",
            "tradeCount": len(rows),
            "probe": summarize_result("crypto_trades", trades),
            "createdAt": utc_now_iso(),
        }
        return cache_set(cache_key, payload)

    buy_proxy = 0.0
    sell_proxy = 0.0

    for index in range(1, len(prices)):
        size = sizes[index]

        if prices[index] >= prices[index - 1]:
            buy_proxy += size
        else:
            sell_proxy += size

    total_proxy = buy_proxy + sell_proxy
    delta = buy_proxy - sell_proxy
    delta_pct = delta / max(total_proxy, 1.0) * 100.0
    strength = clamp(abs(delta_pct))

    if delta_pct > 8:
        direction = "bullish"
        label = "Bullish Footprint Delta Proxy"
    elif delta_pct < -8:
        direction = "bearish"
        label = "Bearish Footprint Delta Proxy"
    else:
        direction = "active"
        label = "Balanced Footprint Delta Proxy"

    payload = {
        "status": "active",
        "label": label,
        "source": "massive_crypto_trades_delta_proxy",
        "symbol": normalized,
        "timeframe": normalized_timeframe,
        "ticker": ticker,
        "direction": direction,
        "strength": round(strength),
        "tradeCount": len(rows),
        "buyVolumeProxy": round(buy_proxy, 4),
        "sellVolumeProxy": round(sell_proxy, 4),
        "deltaProxy": round(delta, 4),
        "deltaPct": round(delta_pct, 2),
        "reason": "price_tick_direction_proxy_not_true_bid_ask_footprint",
        "probe": summarize_result("crypto_trades", trades),
        "createdAt": utc_now_iso(),
    }

    return cache_set(cache_key, payload)


def choose_crypto_footprint_context(symbol: str, timeframe: str = "1m") -> Dict[str, Any]:
    # Prefer free Binance futures taker buy/sell volume for BTCUSD/ETHUSD.
    binance_factor = build_binance_footprint_context(symbol, timeframe)

    if binance_factor.get("status") == "active":
        return binance_factor

    # Keep Massive as a secondary probe if the account later gets crypto trade entitlement.
    massive_factor = build_massive_crypto_footprint_context(symbol, timeframe)

    if massive_factor.get("status") == "active":
        return massive_factor

    combined = dict(binance_factor)
    combined["fallbackProbe"] = massive_factor
    return combined


def build_external_data_context(symbol: str = "BTCUSD", timeframe: str = "1m") -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    options_chain = build_massive_options_chain_context(normalized, normalized_timeframe)

    if is_crypto_symbol(normalized):
        open_interest = build_binance_open_interest_context(normalized, normalized_timeframe)
        footprint = choose_crypto_footprint_context(normalized, normalized_timeframe)
    else:
        open_interest = options_chain
        footprint = inactive_factor(
            symbol=normalized,
            timeframe=normalized_timeframe,
            name="Footprint Delta Pending",
            source="equity_futures_footprint_pending",
            status="not_wired_in_this_step",
            reason="Equity/futures footprint needs quote/trade classification and will be wired after crypto proof.",
        )

    fred_macro = inactive_factor(
        symbol=normalized,
        timeframe=normalized_timeframe,
        name="FRED Macro Pending",
        source="fred_api_pending_external_data_engine",
        status="not_wired_in_this_step",
        reason="FRED macro will be wired in the next backend step.",
    )

    finra_short_volume = inactive_factor(
        symbol=normalized,
        timeframe=normalized_timeframe,
        name="FINRA Short Volume Pending",
        source="finra_pending",
        status="not_wired_in_this_step",
        reason="FINRA short volume will be wired in the next backend step.",
    )

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
        "cotStrength": factor_strength(cot),
        "optionsBullPressure": to_float(options_chain.get("callShare"), 0) if isinstance(options_chain, dict) else 0,
        "optionsBearPressure": to_float(options_chain.get("putShare"), 0) if isinstance(options_chain, dict) else 0,
        "footprintDeltaPct": to_float(footprint.get("deltaPct"), 0) if isinstance(footprint, dict) else 0,
        "openInterest": to_float(open_interest.get("openInterest"), 0) if isinstance(open_interest, dict) else 0,
    }

    return {
        "eventType": "EXTERNAL_DATA_CONTEXT",
        "status": "live" if MASSIVE_API_KEY else "partial_live",
        "symbol": normalized,
        "timeframe": normalized_timeframe,
        "providerStatus": {
            "massive": {
                "configured": bool(MASSIVE_API_KEY),
                "enabled": bool(MASSIVE_API_KEY),
                "baseUrl": MASSIVE_BASE_URL,
                "cacheTtlSeconds": MASSIVE_CACHE_TTL_SECONDS,
            },
            "binanceFutures": {
                "configured": True,
                "enabled": True,
                "baseUrl": BINANCE_FUTURES_BASE_URL,
                "usedFor": ["BTCUSD openInterest", "BTCUSD footprint", "ETHUSD openInterest", "ETHUSD footprint"],
            },
        },
        "factors": factors,
        "signalFields": signal_fields,
        "scalars": scalars,
        "source": "external_data_engine_v3_binance_crypto",
        "createdAt": utc_now_iso(),
    }


def build_external_data_status(symbol: str = "BTCUSD", timeframe: str = "1m") -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)
    context = build_external_data_context(normalized, normalized_timeframe)

    return {
        "eventType": "EXTERNAL_DATA_STATUS",
        "status": context.get("status", "unknown"),
        "source": "external_data_engine_v3_binance_crypto",
        "symbol": normalized,
        "timeframe": normalized_timeframe,
        "massiveKeyPresent": bool(MASSIVE_API_KEY),
        "providers": context.get("providerStatus", {}),
        "factors": context.get("factors", {}),
        "signalFields": context.get("signalFields", {}),
        "scalars": context.get("scalars", {}),
        "createdAt": utc_now_iso(),
    }
