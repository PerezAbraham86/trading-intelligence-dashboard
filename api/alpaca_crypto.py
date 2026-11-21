"""Read-only Alpaca BTC/USD crypto market-data adapter.

No order endpoints, no brokerage session, and no alternative market-data providers.
API credentials are optional for Alpaca's public crypto market-data endpoints.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone, timedelta

import requests
from fastapi import HTTPException

BASE_URL = "https://data.alpaca.markets"
SYMBOL = "BTCUSD"
SUPPORTED_TIMEFRAMES = {"1m": ("1Min", 60), "3m": ("1Min", 180), "5m": ("5Min", 300),
                        "10m": ("5Min", 600), "15m": ("15Min", 900), "30m": ("15Min", 1800),
                        "1h": ("1Hour", 3600), "2h": ("1Hour", 7200),
                        "4h": ("1Hour", 14400), "1d": ("1Day", 86400)}
_SESSION = requests.Session()
_CACHE = {}


def normalize_symbol(symbol="BTCUSD"):
    raw = str(symbol or SYMBOL).upper().replace("/", "").replace("-", "").strip()
    if raw != SYMBOL:
        raise HTTPException(422, "Only BTCUSD is supported.")
    return SYMBOL


def _request(path, params=None):
    headers = {}
    if os.getenv("ALPACA_API_KEY") and os.getenv("ALPACA_API_SECRET"):
        headers = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"],
                   "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"]}
    try:
        response = _SESSION.get(BASE_URL + path, params=params, headers=headers, timeout=12)
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError) as exc:
        raise HTTPException(503, "Alpaca crypto market data unavailable.") from exc


def _bars(timeframe, limit):
    source_tf, seconds = SUPPORTED_TIMEFRAMES[timeframe]
    source_seconds = {"1Min": 60, "5Min": 300, "15Min": 900, "1Hour": 3600, "1Day": 86400}[source_tf]
    factor = seconds // source_seconds
    requested = min(10000, max(10, int(limit or 300) * factor + factor))
    # Bound the query to the most recent bars; avoid silently serving an old window.\n    end = datetime.now(timezone.utc)\n    start = (end - timedelta(seconds=requested * source_seconds * 3)).isoformat()
    rows = []
    token = None
    while len(rows) < requested:
        params = {"symbols": "BTC/USD", "timeframe": source_tf, "start": start,
                  "limit": min(1000, requested - len(rows)), "sort": "desc"}
        if token:
            params["page_token"] = token
        payload = _request("/v1beta3/crypto/us/bars", params)
        batch = payload.get("bars", {}).get("BTC/USD", [])
        rows.extend(batch)
        token = payload.get("next_page_token")
        if not token or not batch:
            break
    groups = {}
    # Alpaca returns newest first; aggregate oldest to newest for correct OHLC.
    for bar in reversed(rows):
        try:
            epoch = int(datetime.fromisoformat(bar["t"].replace("Z", "+00:00")).timestamp())
            bucket = epoch // seconds * seconds
            group = groups.setdefault(bucket, {"open": float(bar["o"]), "high": float(bar["h"]),
                                                 "low": float(bar["l"]), "close": float(bar["c"]),
                                                 "volume": 0.0})
            group["high"] = max(group["high"], float(bar["h"]))
            group["low"] = min(group["low"], float(bar["l"]))
            group["close"] = float(bar["c"])
            group["volume"] += float(bar.get("v") or 0)
        except (KeyError, TypeError, ValueError):
            continue
    result = []
    for epoch, bar in sorted(groups.items()):
        iso = datetime.fromtimestamp(epoch, timezone.utc).isoformat()
        result.append({**bar, "epoch": epoch, "time": iso, "timestamp": iso,
                       "symbol": SYMBOL, "timeframe": timeframe,
                       "provider": "alpaca", "source": "alpaca_crypto_bars"})
    return result[-int(limit or 300):]


def get_historical_ohlcv(symbol=SYMBOL, timeframe="1m", limit=300, force=False, **kwargs):
    normalize_symbol(symbol)
    if timeframe not in SUPPORTED_TIMEFRAMES:
        raise HTTPException(422, "Unsupported BTCUSD timeframe.")
    key = (timeframe, int(limit or 300))
    cached = _CACHE.get(key)
    if not force and cached and time.monotonic() - cached[0] < 20:
        candles = cached[1]
    else:
        candles = _bars(timeframe, limit)
        _CACHE[key] = (time.monotonic(), candles)
    latest_epoch = int(datetime.fromisoformat(candles[-1]["time"]).timestamp()) if candles else 0\n    age_seconds = max(0, int(time.time()) - latest_epoch) if latest_epoch else None\n    return {"provider": "alpaca", "source": "alpaca_crypto_bars", "symbol": SYMBOL,\n            "latestCandleTime": candles[-1]["time"] if candles else None,\n            "dataAgeSeconds": age_seconds, "isFresh": age_seconds is not None and age_seconds <= max(180, SUPPORTED_TIMEFRAMES[timeframe][1] * 2),
            "timeframe": timeframe, "status": "available" if candles else "waiting",
            "candles": candles, "count": len(candles), "candleCount": len(candles),
            "isRealtime": False, "isLive": False}


def get_quote(symbol=SYMBOL, timeframe="1m"):
    normalize_symbol(symbol)
    payload = _request("/v1beta3/crypto/us/latest/trades", {"symbols": "BTC/USD"})
    trade = payload.get("trades", {}).get("BTC/USD") or {}
    price = float(trade["p"]) if trade.get("p") is not None else None
    stamp = trade.get("t")
    trade_epoch = datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() if stamp else None\n    trade_age = max(0, time.time() - trade_epoch) if trade_epoch is not None else None\n    fresh = price is not None and trade_age is not None and trade_age <= 120\n    return {"provider": "alpaca", "source": "alpaca_crypto_latest_trade", "symbol": SYMBOL,\n            "tradeAgeSeconds": round(trade_age, 1) if trade_age is not None else None, "isFresh": fresh,
            "timeframe": timeframe, "price": price, "lastPrice": price, "close": price,
            "time": stamp, "status": "Live" if price is not None else "Waiting",
            "isRealtime": price is not None, "isLive": price is not None}


def connection_status(symbol=SYMBOL):
    normalize_symbol(symbol)
    try:
        quote = get_quote(symbol)
        ready = quote["price"] is not None
        return {"provider": "alpaca", "symbol": SYMBOL, "configured": True,
                "ready": ready, "status": "Connected" if quote["isFresh"] else quote["status"],\n                "isFresh": quote["isFresh"],\n                "tradeAgeSeconds": quote.get("tradeAgeSeconds"),
                "readOnly": True, "retryAfterSeconds": 15}
    except HTTPException:
        return {"provider": "alpaca", "symbol": SYMBOL, "configured": True,
                "ready": False, "status": "Alpaca unavailable",
                "readOnly": True, "retryAfterSeconds": 30}


def get_latest_live_snapshot(symbol=SYMBOL, timeframe="1m"):
    quote = get_quote(symbol, timeframe)
    return {"eventType": "LIVE_FEED_LATEST", "symbol": SYMBOL, "timeframe": timeframe,
            "provider": "alpaca", "source": "alpaca_crypto_latest_trade",
            "status": quote["status"], "price": quote, "candle": None, "history": []}
