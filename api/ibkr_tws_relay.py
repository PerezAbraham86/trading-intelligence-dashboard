"""Authenticated outbound relay ingestion and isolated TWS candle warehouse.

SQLite transactions keep nonce/sequence validation atomic across backend workers.
No brokerage credentials, socket requests or trading functions live on Render.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from api.ibkr_tws_schema import RelayPayload, SOURCE
from api.ibkr_relay_auth import PATH, sign

router = APIRouter()
MAX_BODY = 256 * 1024
DB_PATH = Path(os.getenv("IBKR_RELAY_DB_PATH", ".data/ibkr_tws_relay.sqlite3"))
WINDOW = 90


def enabled():
    return os.getenv("IBKR_RELAY_ENABLED", "false").lower() == "true"


def secret():
    value = os.getenv("IBKR_RELAY_SECRET", "")
    if not enabled() or len(value) < 32:
        raise HTTPException(503, "TWS relay disabled or dedicated relay secret not configured.")
    return value


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.executescript('''
    CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, received REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS boots (connector TEXT, boot TEXT, PRIMARY KEY(connector,boot));
    CREATE TABLE IF NOT EXISTS state (symbol TEXT PRIMARY KEY, connector TEXT, boot TEXT, seq INTEGER, issued INTEGER, received REAL, payload TEXT);
    CREATE TABLE IF NOT EXISTS bars (symbol TEXT, conid INTEGER, environment TEXT, rth INTEGER, epoch INTEGER, updated REAL, payload TEXT, PRIMARY KEY(symbol,conid,environment,rth,epoch));
    ''')
    try:
        yield db
    finally:
        db.close()


def ingest(body: bytes, headers, now=None):
    key = secret()
    now = time.time() if now is None else now
    if len(body) > MAX_BODY:
        raise HTTPException(413, "Relay payload too large.")
    stamp, nonce, signature = (headers.get(k, "") for k in ("x-ibkr-timestamp", "x-ibkr-nonce", "x-ibkr-signature"))
    if not re.fullmatch(r"[0-9]{10}", stamp) or abs(now - int(stamp)) > WINDOW or not re.fullmatch(r"[a-f0-9]{32}", nonce):
        raise HTTPException(401, "Invalid or expired relay authentication.")
    if not re.fullmatch(r"[a-f0-9]{64}", signature) or not hmac.compare_digest(sign(body, stamp, nonce, key), signature):
        raise HTTPException(401, "Invalid relay authentication.")
    try:
        payload = RelayPayload.model_validate_json(body)
    except (ValidationError, ValueError):
        raise HTTPException(422, "Invalid TWS relay payload.") from None
    expected_connector = os.getenv("IBKR_RELAY_CONNECTOR_ID", "marketbos-spy")
    if payload.connectorId != expected_connector:
        raise HTTPException(403, "Connector is not authorized.")
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM nonces WHERE received < ?", (now - WINDOW * 2,))
        if db.execute("SELECT 1 FROM nonces WHERE nonce=?", (nonce,)).fetchone():
            raise HTTPException(409, "Relay replay rejected.")
        previous = db.execute("SELECT * FROM state WHERE symbol=?", (payload.symbol,)).fetchone()
        if previous:
            if previous["connector"] != payload.connectorId or int(stamp) < previous["issued"]:
                raise HTTPException(409, "Out-of-order relay submission.")
            if previous["boot"] == payload.bootId and payload.sequence <= previous["seq"]:
                raise HTTPException(409, "Out-of-order relay sequence.")
            if previous["boot"] != payload.bootId and db.execute("SELECT 1 FROM boots WHERE connector=? AND boot=?", (payload.connectorId, payload.bootId)).fetchone():
                raise HTTPException(409, "Retired connector session.")
        db.execute("INSERT INTO nonces VALUES (?,?)", (nonce, now))
        db.execute("INSERT OR IGNORE INTO boots VALUES (?,?)", (payload.connectorId, payload.bootId))
        changed = 0
        for bar in payload.candles:
            normalized = bar.normalized(payload.conid)
            content = json.dumps(normalized, sort_keys=True)
            existing = db.execute("SELECT updated,payload FROM bars WHERE symbol=? AND conid=? AND environment=? AND rth=? AND epoch=?", (payload.symbol, payload.conid, payload.environment, int(payload.useRTH), bar.epoch)).fetchone()
            if existing and bar.updatedAt < existing["updated"]:
                raise HTTPException(409, "Older candle revision rejected.")
            if existing and json.loads(existing["payload"])["completed"] and not bar.completed:
                raise HTTPException(409, "Completed candle cannot become forming.")
            if existing and existing["payload"] == content:
                continue
            db.execute("INSERT OR REPLACE INTO bars VALUES (?,?,?,?,?,?,?)", (payload.symbol, payload.conid, payload.environment, int(payload.useRTH), bar.epoch, bar.updatedAt, content))
            changed += 1
        db.execute("INSERT OR REPLACE INTO state VALUES (?,?,?,?,?,?,?)", (payload.symbol, payload.connectorId, payload.bootId, payload.sequence, int(stamp), now, json.dumps({**payload.model_dump(exclude={"candles"}), "conid": payload.conid or (json.loads(previous["payload"])["conid"] if previous else 0)})))
        db.execute("DELETE FROM bars WHERE rowid IN (SELECT rowid FROM bars WHERE symbol=? AND conid=? AND environment=? AND rth=? ORDER BY epoch DESC LIMIT -1 OFFSET 20000)", (payload.symbol, payload.conid, payload.environment, int(payload.useRTH)))
        count = db.execute("SELECT COUNT(*) FROM bars WHERE symbol=? AND conid=? AND environment=? AND rth=?", (payload.symbol, payload.conid, payload.environment, int(payload.useRTH))).fetchone()[0]
        db.commit()
    return {"needsBackfill": count == 0, "accepted": True, "changed": changed, "sequence": payload.sequence, "source": SOURCE}


@router.post(PATH)
async def relay_submission(request: Request):
    # Enforce the limit while streaming, including requests without Content-Length.
    secret()
    if request.url.scheme != "https":
        raise HTTPException(400, "Relay submissions require HTTPS.")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY:
            raise HTTPException(413, "Relay payload too large.")
        chunks.append(chunk)
    import asyncio
    return await asyncio.to_thread(ingest, b"".join(chunks), request.headers)


def snapshot(symbol="SPY", limit=0):
    if not DB_PATH.exists():
        return None, []
    with connect() as db:
        # A read transaction prevents status and candles from different batches.
        db.execute("BEGIN")
        row = db.execute("SELECT * FROM state WHERE symbol=?", (symbol,)).fetchone()
        if not row:
            return None, []
        metadata = json.loads(row["payload"])
        metadata["receivedAt"] = row["received"]
        query = "SELECT payload FROM bars WHERE symbol=? AND conid=? AND environment=? AND rth=? ORDER BY epoch DESC"
        parameters = (symbol, metadata["conid"], metadata["environment"], int(metadata["useRTH"]))
        if limit > 0:
            query += " LIMIT ?"
            parameters += (int(limit),)
        bars = list(reversed(db.execute(query, parameters).fetchall()))
    return metadata, [json.loads(bar["payload"]) for bar in bars]


def market_closed(schedule, now):
    for day in schedule:
        if day["start"] <= now < day["end"]:
            return not any(start <= now < end for start, end in day["intervals"])
    return None  # Unknown exchange hours are never labeled closed by guessing.


def status(symbol="SPY", metadata=None, bars=None, now=None):
    now = time.time() if now is None else now
    base = {"provider": "ibkr", "source": SOURCE, "transport": "tws_relay", "readOnly": True, "ready": False, "isRealtime": False, "isLive": False, "configured": enabled() and len(os.getenv("IBKR_RELAY_SECRET", "")) >= 32, "retryAfterSeconds": 60, "symbol": symbol}
    if symbol != "SPY":
        return {**base, "status": "Waiting for data", "reason": "TWS connector currently subscribes to SPY only; no REST substitution."}
    if not base["configured"]:
        return {**base, "status": "IBKR Not Connected", "reason": "TWS relay is disabled or missing relay configuration."}
    if metadata is None:
        metadata, bars = snapshot(symbol, limit=1)
    if not metadata or now - metadata["receivedAt"] > float(os.getenv("IBKR_RELAY_OFFLINE_SECONDS", "75")):
        return {**base, "status": "Connector offline", "reason": "No recent authenticated connector heartbeat."}
    names = {"gateway_disconnected": "Gateway disconnected", "authentication_required": "Authentication required", "subscription_required": "Market-data subscription required", "pacing_limited": "Waiting for data", "contract_error": "Waiting for data", "data_error": "Waiting for data"}
    info = {"conid": metadata["conid"], "connected": metadata["connected"], "authenticated": metadata["connected"] and metadata["state"] != "authentication_required", "lastUpdateAt": metadata["lastDataUpdate"], "relayReceivedAt": metadata["receivedAt"], "errorCode": metadata.get("errorCode"), "environment": metadata["environment"], "gapRecoveryLimited": metadata.get("gapRecoveryLimited", False)}
    if not metadata["connected"] or metadata["state"] in names:
        label = names.get(metadata["state"], "Gateway disconnected")
        return {**base, **info, "status": label, "reason": label}
    if not metadata["subscribed"]:
        return {**base, **info, "status": "Waiting for data", "reason": "Historical subscription not established."}
    base["ready"] = True
    closed = market_closed(metadata["schedule"], now)
    if closed is True:
        return {**base, **info, "status": "Market closed", "reason": "IBKR-reported exchange session is closed.", "marketClosed": True}
    last = bars[-1] if bars else None
    fresh = bool(last and metadata["lastDataUpdate"] and now - metadata["lastDataUpdate"] <= 90 and now - last["epoch"] <= 180 and not last["completed"])
    label = "Live market data" if fresh else "Stale market data" if last else "Waiting for data"
    return {**base, **info, "status": label, "isRealtime": fresh, "isLive": fresh, "marketClosed": closed, "reason": None if fresh else "No fresh forming candle; saved history is not live."}


def aggregate(bars, timeframe, now):
    if timeframe == "1m":
        return bars
    seconds = {"3m": 180, "5m": 300, "10m": 600, "15m": 900, "30m": 1800, "1h": 3600, "2h": 7200, "4h": 14400, "1d": 86400, "1w": 604800}.get(timeframe)
    if not seconds:
        raise HTTPException(422, "Unsupported TWS chart timeframe.")
    groups = {}
    for bar in bars:
        if timeframe in {"1d", "1w"}:
            local = datetime.fromtimestamp(bar["epoch"], ZoneInfo("America/New_York"))
            if timeframe == "1w":
                from datetime import timedelta
                local -= timedelta(days=local.weekday())
            bucket = int(local.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
        else:
            bucket = bar["epoch"] // seconds * seconds
        groups.setdefault(bucket, []).append(bar)
    result = []
    for bucket, rows in sorted(groups.items()):
        bucket_end = bucket + seconds
        if timeframe in {"1d", "1w"}:
            from datetime import timedelta
            local_start = datetime.fromtimestamp(bucket, ZoneInfo("America/New_York"))
            bucket_end = int((local_start + timedelta(days=7 if timeframe == "1w" else 1)).timestamp())
        row = {**rows[0], "epoch": bucket, "time": datetime.fromtimestamp(bucket, timezone.utc).isoformat(), "timestamp": datetime.fromtimestamp(bucket, timezone.utc).isoformat(), "timeframe": timeframe, "high": max(r["high"] for r in rows), "low": min(r["low"] for r in rows), "close": rows[-1]["close"], "volume": sum(r["volume"] for r in rows), "updatedAt": max(r["updatedAt"] for r in rows), "completed": all(r["completed"] for r in rows) and bucket_end <= now, "source": SOURCE + "_aggregated_1m", "observedMinutes": len(rows), "partial": len(rows) < seconds // 60}
        result.append(row)
    return result


def historical(symbol="SPY", timeframe="1m", limit=0, **kwargs):
    metadata, bars = snapshot(symbol, limit=max(0, int(limit)) if timeframe == "1m" else 0)
    connection = status(symbol, metadata, bars)
    now = time.time()
    bars = aggregate(bars, timeframe, now)
    if int(limit) > 0:
        bars = bars[-int(limit):]
    return {"provider": "ibkr", "source": SOURCE, "transport": "tws_relay", "symbol": symbol, "timeframe": timeframe, "conid": connection.get("conid"), "status": connection["status"], "reason": connection.get("reason"), "connection": connection, "candles": bars, "count": len(bars), "candleCount": len(bars), "isLive": connection["isLive"], "isRealtime": connection["isRealtime"], "historicalOnly": not connection["isLive"], "lastUpdateAt": connection.get("lastUpdateAt"), "freshness": "live" if connection["isLive"] else "historical" if bars else "unavailable", "cache": "tws_warehouse", "gapRecoveryLimited": connection.get("gapRecoveryLimited", False), "firstCandleTime": bars[0]["time"] if bars else None, "lastCandleTime": bars[-1]["time"] if bars else None}


def quote_from_history(history, symbol, timeframe):
    connection = history["connection"]
    last = history["candles"][-1] if history["candles"] else None
    live = bool(last and connection["isLive"])
    return {**connection, "symbol": symbol, "timeframe": timeframe, "price": last["close"] if live else None, "lastPrice": last["close"] if live else None, "close": last["close"] if live else None, "time": last["time"] if live else None, "epoch": last["epoch"] if live else None, "bid": None, "ask": None, "bidSize": None, "askSize": None, "spread": None, "quoteAgeSeconds": time.time() - last["updatedAt"] if live else None, "priceType": "forming_trade_bar_close", "marketDataAvailability": "R" if live else "unavailable"}


def quote(symbol="SPY", timeframe="1m"):
    return quote_from_history(historical(symbol, timeframe, limit=1), symbol, timeframe)


def latest(symbol="SPY", timeframe="1m"):
    history = historical(symbol, timeframe, limit=1)
    price = quote_from_history(history, symbol, timeframe)
    candle = history["candles"][-1] if history["candles"] and history["isLive"] else None
    return {"eventType": "LIVE_FEED_LATEST", "provider": "ibkr", "source": SOURCE, "symbol": symbol, "timeframe": timeframe, "status": history["status"], "connection": history["connection"], "isRealtime": bool(candle), "price": price, "candle": candle, "history": [candle] if candle else []}


@router.get("/api/ibkr/tws/status")
def tws_status(symbol: str = "SPY"):
    return status(symbol.upper())
