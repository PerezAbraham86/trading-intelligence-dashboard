from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from api.ibkr_client import get_quote as get_ibkr_quote, connection_status

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


def build_ibkr_l1_quote_context(symbol: str, timeframe: str = "1m") -> Dict[str, Any]:
    try:
        quote = get_ibkr_quote(symbol, timeframe)
        return {**quote, "status": "active" if quote.get("isRealtime") else "unavailable", "label": "IBKR L1 Quote", "direction": "neutral", "strength": 0, "reason": "IBKR top-of-book snapshot", "createdAt": utc_now_iso()}
    except Exception:
        return inactive_factor(symbol=symbol, timeframe=timeframe, name="IBKR L1 Quote Unavailable", source="ibkr_live_quote", status="unavailable", reason="Configure and authenticate the IBKR gateway and contract mapping.")


def build_ibkr_l1_footprint_proxy_context(
    symbol: str,
    timeframe: str = "1m",
    quote_factor: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    if not is_futures_symbol(normalized):
        return inactive_factor(
            symbol=normalized,
            timeframe=normalized_timeframe,
            name="L1 Footprint Proxy Not Applicable",
            source="ibkr_quotes_l1_top_of_book_proxy",
            status="not_applicable",
            reason=f"IBKR L1 footprint proxy is only used for MES/ES futures, not {normalized}.",
        )

    quote = quote_factor if isinstance(quote_factor, dict) else build_ibkr_l1_quote_context(normalized, normalized_timeframe)

    if str(quote.get("status") or "").lower() not in {"active", "live"}:
        payload = dict(quote)
        payload.update(
            {
                "status": "unavailable",
                "label": "L1 Footprint Proxy Unavailable",
                "source": "ibkr_quotes_l1_top_of_book_proxy",
                "symbol": normalized,
                "timeframe": normalized_timeframe,
                "direction": "neutral",
                "strength": 0,
                "deltaPct": 0,
                "reason": f"quote_not_active: {quote.get('reason')}",
                "createdAt": utc_now_iso(),
            }
        )
        return payload

    bid_size = to_float(quote.get("bidSize"), 0.0)
    ask_size = to_float(quote.get("askSize"), 0.0)
    bid = to_float(quote.get("bid"), 0.0)
    ask = to_float(quote.get("ask"), 0.0)
    total_size = bid_size + ask_size
    delta = bid_size - ask_size
    delta_pct = delta / max(total_size, 1.0) * 100.0
    strength = clamp(abs(delta_pct))

    if total_size <= 0:
        direction = "active"
        label = "L1 Footprint Proxy Active"
        reason = "l1_quote_active_without_bid_ask_size"
        strength = 35.0
    elif delta_pct > 10:
        direction = "bullish"
        label = "Bullish L1 Footprint Proxy"
        reason = "bid_size_pressure_above_ask_size"
        strength = max(strength, 45.0)
    elif delta_pct < -10:
        direction = "bearish"
        label = "Bearish L1 Footprint Proxy"
        reason = "ask_size_pressure_above_bid_size"
        strength = max(strength, 45.0)
    else:
        direction = "active"
        label = "Balanced L1 Footprint Proxy"
        reason = "top_of_book_bid_ask_size_balanced"
        strength = max(strength, 35.0)

    return {
        "status": "active",
        "label": label,
        "source": "ibkr_quotes_l1_top_of_book_proxy",
        "symbol": normalized,
        "timeframe": normalized_timeframe,
        "underlying": quote.get("underlying"),
        "direction": direction,
        "strength": round(strength, 2),
        "bid": bid,
        "ask": ask,
        "bidSize": bid_size,
        "askSize": ask_size,
        "delta": round(delta, 6),
        "deltaPct": round(delta_pct, 2),
        "spread": quote.get("spread"),
        "spreadPct": quote.get("spreadPct"),
        "lastPrice": quote.get("lastPrice"),
        "delaySeconds": quote.get("delaySeconds"),
        "quoteStatus": quote.get("quoteStatus"),
        "reason": reason,
        "note": "This is a live L1 top-of-book pressure proxy, not true executed footprint delta. Add trades/tick data for true footprint.",
        "createdAt": utc_now_iso(),
    }


def build_ibkr_futures_options_context(symbol: str, timeframe: str = "1m", options_factor=None) -> Dict[str, Any]:
    return inactive_factor(symbol=symbol, timeframe=timeframe, name="Futures Options Flow Unavailable", source="ibkr", status="unavailable", reason="IBKR options-chain analytics are not configured. No options pressure or OI is inferred from a futures quote.")


def build_ibkr_futures_open_interest_context(symbol: str, timeframe: str = "1m", options_factor=None) -> Dict[str, Any]:
    return inactive_factor(symbol=symbol, timeframe=timeframe, name="Futures Options Open Interest Unavailable", source="ibkr", status="unavailable", reason="IBKR options-chain analytics are not configured. No options pressure or OI is inferred from a futures quote.")


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


def build_external_data_context(symbol: str = "BTCUSD", timeframe: str = "1m") -> Dict[str, Any]:
    normalized = normalize_symbol(symbol)
    tf = normalize_timeframe(timeframe)
    def unavailable(name):
        return inactive_factor(symbol=normalized, timeframe=tf, name=name + " Unavailable", source="ibkr", status="unavailable", reason="Required IBKR data is not configured; no external fallback is used.")
    quote = build_ibkr_l1_quote_context(normalized, tf)
    factors = {
        "optionsFlow": build_ibkr_futures_options_context(normalized, tf),
        "openInterest": unavailable("Open Interest"),
        "footprint": build_ibkr_l1_footprint_proxy_context(normalized, tf, quote),
        "fredMacro": unavailable("Macro Data"),
        "finraShortVolume": unavailable("Short Volume"),
        "cot": unavailable("COT"),
        "liveQuote": quote,
    }
    if is_futures_symbol(normalized) and quote.get("status") == "active" and quote.get("openInterest") is not None:
        factors["openInterest"] = {"status": "active", "label": "IBKR Futures Open Interest", "source": "ibkr", "symbol": normalized, "timeframe": tf, "openInterest": quote["openInterest"], "direction": "neutral", "strength": 0, "reason": "Reported futures OI, with no directional pressure inferred."}
    scalars = {key: 0 for key in ("optionsFlowStrength", "openInterestStrength", "footprintStrength", "fredMacroStrength", "finraShortVolumeStrength", "finraShortVolumePct", "cotStrength", "optionsBullPressure", "optionsBearPressure", "footprintDeltaPct", "openInterest", "openInterestCurrency", "l1QuoteStrength", "l1LastPrice", "l1Bid", "l1Ask", "l1BidSize", "l1AskSize", "l1Spread", "l1DelaySeconds")}
    scalars.update(footprintStrength=factor_strength(factors["footprint"]), footprintDeltaPct=to_float(factors["footprint"].get("deltaPct")), openInterest=to_float(factors["openInterest"].get("openInterest")))
    if quote.get("status") == "active":
        scalars.update({"l1LastPrice": to_float(quote.get("lastPrice")), "l1Bid": to_float(quote.get("bid")), "l1Ask": to_float(quote.get("ask")), "l1BidSize": to_float(quote.get("bidSize")), "l1AskSize": to_float(quote.get("askSize")), "l1Spread": to_float(quote.get("spread"))})
    connection = connection_status(normalized)
    return {"eventType": "EXTERNAL_DATA_CONTEXT", "status": connection["status"], "symbol": normalized, "timeframe": tf, "providerStatus": {"ibkr": connection}, "factors": factors, "signalFields": {k: signal_text_from_factor(v) for k, v in factors.items()}, "scalars": scalars, "source": "ibkr", "createdAt": utc_now_iso()}


def build_external_data_status(symbol: str = "BTCUSD", timeframe: str = "1m") -> Dict[str, Any]:
    context = build_external_data_context(symbol, timeframe)
    return {**context, "eventType": "EXTERNAL_DATA_STATUS", "providers": context["providerStatus"]}
