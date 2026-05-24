from fastapi import FastAPI, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Any, Dict
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="Trading Intelligence API",
    description="Backend for receiving TradingView webhook alerts and serving live trading signals",
    version="1.0.0",
)

origins = [
    "https://trading-intelligence-dashboard.vercel.app",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET")
ALPACA_API_KEY = os.getenv("ALPACA_API_KEY")
ALPACA_SECRET_KEY = os.getenv("ALPACA_SECRET_KEY")


class CandleData(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: Optional[float] = 0.0
    symbol: str
    timeframe: str
    createdAt: Optional[str] = None


class SentimentData(BaseModel):
    eventType: str = "SENTIMENT_UPDATE"
    symbol: str
    timeframe: str
    sentiment: float
    sentimentStatus: str
    bearCount: int
    neutralCount: int
    bullCount: int
    bearPct: float
    neutralPct: float
    bullPct: float
    activeCount: int
    price: Optional[float] = 0.0
    time: Optional[int] = None
    createdAt: Optional[str] = None


class TradingSignal(BaseModel):
    eventType: str = "TRADE_SIGNAL"
    status: str = "Open"

    symbol: str
    timeframe: str
    signal: str

    confidence: int
    bullScore: int
    bearScore: int
    netBias: int

    price: float
    entry: Optional[float] = None
    current: Optional[float] = None
    pnl: Optional[float] = 0.0
    percent: Optional[float] = 0.0

    time: Optional[int] = None
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    close: Optional[float] = None
    volume: Optional[float] = 0.0

    smc: str
    alphax: str
    ghost: str
    chartOverlays: Optional[str] = None
    openInterest: str
    footprint: str
    session: str
    fredMacro: str
    finraShortVolume: str
    cot: str

    warnings: List[str]
    createdAt: Optional[str] = None


class WebhookPayload(BaseModel):
    secret: Optional[str] = None

    eventType: Optional[str] = "TRADE_SIGNAL"
    symbol: str
    timeframe: str
    price: Optional[float] = 0.0
    time: Optional[int] = None

    status: Optional[str] = "Open"
    signal: Optional[str] = None
    confidence: Optional[int] = None
    bullScore: Optional[int] = None
    bearScore: Optional[int] = None
    netBias: Optional[int] = None
    entry: Optional[float] = None
    current: Optional[float] = None
    pnl: Optional[float] = 0.0
    percent: Optional[float] = 0.0

    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    close: Optional[float] = None
    volume: Optional[float] = 0.0

    smc: Optional[str] = None
    alphax: Optional[str] = None
    ghost: Optional[str] = None
    chartOverlays: Optional[str] = None
    openInterest: Optional[str] = None
    footprint: Optional[str] = None
    session: Optional[str] = None
    fredMacro: Optional[str] = None
    finraShortVolume: Optional[str] = None
    cot: Optional[str] = None
    warnings: Optional[List[str]] = []

    sentiment: Optional[float] = None
    sentimentStatus: Optional[str] = None
    bearCount: Optional[int] = None
    neutralCount: Optional[int] = None
    bullCount: Optional[int] = None
    bearPct: Optional[float] = None
    neutralPct: Optional[float] = None
    bullPct: Optional[float] = None
    activeCount: Optional[int] = None


class HealthResponse(BaseModel):
    status: str
    service: str


class WebhookResponse(BaseModel):
    ok: bool
    message: str


latest_signal: Optional[TradingSignal] = None
recent_signals: List[TradingSignal] = []
recent_candles: List[CandleData] = []
latest_sentiment: Optional[SentimentData] = None


DEFAULT_WAITING_SIGNAL = TradingSignal(
    eventType="WAITING",
    status="Waiting",
    symbol="WAITING",
    timeframe="Waiting",
    signal="NEUTRAL",
    confidence=0,
    bullScore=50,
    bearScore=50,
    netBias=0,
    price=0.0,
    entry=0.0,
    current=0.0,
    pnl=0.0,
    percent=0.0,
    time=None,
    open=None,
    high=None,
    low=None,
    close=None,
    volume=0.0,
    smc="Awaiting signal",
    alphax="Awaiting signal",
    ghost="Awaiting signal",
    chartOverlays=None,
    openInterest="Awaiting signal",
    footprint="Awaiting signal",
    session="Market awaiting alert",
    fredMacro="Neutral",
    finraShortVolume="Awaiting signal",
    cot="Awaiting signal",
    warnings=["No signal received yet"],
    createdAt=datetime.now(timezone.utc).isoformat(),
)


DEFAULT_SENTIMENT = SentimentData(
    eventType="SENTIMENT_UPDATE",
    symbol="WAITING",
    timeframe="Waiting",
    sentiment=50.0,
    sentimentStatus="Waiting",
    bearCount=0,
    neutralCount=0,
    bullCount=0,
    bearPct=0.0,
    neutralPct=0.0,
    bullPct=0.0,
    activeCount=0,
    price=0.0,
    time=None,
    createdAt=datetime.now(timezone.utc).isoformat(),
)


def normalize_symbol(symbol: str) -> str:
    return (symbol or "").replace(" ", "").upper()


def normalize_timeframe(timeframe: str) -> str:
    return str(timeframe or "").replace(" ", "").lower()


def normalize_timeframe_for_matching(timeframe: str) -> str:
    tf = normalize_timeframe(timeframe)
    mapping = {
        "1": "1m",
        "3": "3m",
        "5": "5m",
        "15": "15m",
        "30": "30m",
        "60": "1h",
        "120": "2h",
        "240": "4h",
        "d": "1d",
        "1d": "1d",
        "w": "1w",
        "1w": "1w",
    }
    return mapping.get(tf, tf)


def alpaca_timeframe(timeframe: str) -> str:
    tf = normalize_timeframe_for_matching(timeframe)
    mapping = {
        "1m": "1Min",
        "3m": "3Min",
        "5m": "5Min",
        "15m": "15Min",
        "30m": "30Min",
        "1h": "1Hour",
        "2h": "2Hour",
        "4h": "4Hour",
        "1d": "1Day",
    }
    if tf not in mapping:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported timeframe for Alpaca preload: {timeframe}",
        )
    return mapping[tf]


def timeframe_minutes(timeframe: str) -> int:
    tf = normalize_timeframe_for_matching(timeframe)
    mapping = {
        "1m": 1,
        "3m": 3,
        "5m": 5,
        "15m": 15,
        "30m": 30,
        "1h": 60,
        "2h": 120,
        "4h": 240,
        "1d": 1440,
    }
    return mapping.get(tf, 1)


def is_crypto_symbol(symbol: str) -> bool:
    normalized = normalize_symbol(symbol)
    return "BTC" in normalized or "ETH" in normalized


def map_crypto_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)
    if "BTC" in normalized:
        return "BTC/USD"
    if "ETH" in normalized:
        return "ETH/USD"
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Unsupported crypto symbol for Alpaca preload: {symbol}",
    )


def map_stock_symbol(symbol: str) -> str:
    normalized = normalize_symbol(symbol)
    if ":" in normalized:
        normalized = normalized.split(":")[-1]
    if normalized in {"SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "TSLA"}:
        return normalized
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            f"Unsupported symbol for Alpaca preload: {symbol}. "
            "Currently supports BTCUSD, ETHUSD, and basic stock symbols like SPY. "
            "MES1!/ES1! futures preload will be added later with a futures data provider."
        ),
    )


def epoch_seconds_from_alpaca_time(value: Any) -> int:
    if isinstance(value, (int, float)):
        return int(value / 1000) if value > 1000000000000 else int(value)
    text = str(value or "").replace("Z", "+00:00")
    try:
        return int(datetime.fromisoformat(text).timestamp())
    except ValueError:
        return int(datetime.now(timezone.utc).timestamp())


def alpaca_headers() -> Dict[str, str]:
    headers = {"Accept": "application/json"}
    if ALPACA_API_KEY and ALPACA_SECRET_KEY:
        headers["APCA-API-KEY-ID"] = ALPACA_API_KEY
        headers["APCA-API-SECRET-KEY"] = ALPACA_SECRET_KEY
    return headers


def request_json(url: str, headers: Optional[Dict[str, str]] = None) -> Any:
    req = Request(url, headers=headers or {"Accept": "application/json"})
    try:
        with urlopen(req, timeout=20) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw)
    except HTTPError as error:
        try:
            body = error.read().decode("utf-8")
        except Exception:
            body = str(error)
        raise HTTPException(
            status_code=error.code,
            detail=f"Alpaca request failed: {body}",
        )
    except URLError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Alpaca connection failed: {error}",
        )


def parse_alpaca_bar(symbol: str, timeframe: str, bar: Dict[str, Any]) -> CandleData:
    return CandleData(
        time=epoch_seconds_from_alpaca_time(bar.get("t")),
        open=float(bar.get("o", 0.0)),
        high=float(bar.get("h", 0.0)),
        low=float(bar.get("l", 0.0)),
        close=float(bar.get("c", 0.0)),
        volume=float(bar.get("v", 0.0) or 0.0),
        symbol=symbol,
        timeframe=timeframe,
        createdAt=datetime.now(timezone.utc).isoformat(),
    )


def fetch_alpaca_historical_candles(symbol: str, timeframe: str, limit: int = 300) -> List[CandleData]:
    clean_limit = max(1, min(int(limit or 300), 1000))
    alpaca_tf = alpaca_timeframe(timeframe)
    minutes = timeframe_minutes(timeframe)
    lookback_minutes = max(clean_limit * minutes * 3, 240)
    end_dt = datetime.now(timezone.utc) - timedelta(minutes=1)
    start_dt = end_dt - timedelta(minutes=lookback_minutes)
    start = start_dt.isoformat().replace("+00:00", "Z")
    end = end_dt.isoformat().replace("+00:00", "Z")

    if is_crypto_symbol(symbol):
        alpaca_symbol = map_crypto_symbol(symbol)
        params = urlencode(
            {
                "symbols": alpaca_symbol,
                "timeframe": alpaca_tf,
                "start": start,
                "end": end,
                "limit": clean_limit,
            }
        )
        url = f"https://data.alpaca.markets/v1beta3/crypto/us/bars?{params}"
        payload = request_json(url, headers=alpaca_headers())
        bars_by_symbol = payload.get("bars", {})
        bars = bars_by_symbol.get(alpaca_symbol, [])
        candles = [parse_alpaca_bar(symbol=symbol, timeframe=timeframe, bar=bar) for bar in bars]
        candles.sort(key=lambda item: item.time)
        return candles[-clean_limit:]

    alpaca_symbol = map_stock_symbol(symbol)
    params = urlencode(
        {
            "symbols": alpaca_symbol,
            "timeframe": alpaca_tf,
            "start": start,
            "end": end,
            "limit": clean_limit,
            "feed": "iex",
        }
    )
    url = f"https://data.alpaca.markets/v2/stocks/bars?{params}"
    payload = request_json(url, headers=alpaca_headers())
    bars_by_symbol = payload.get("bars", {})
    bars = bars_by_symbol.get(alpaca_symbol, [])
    candles = [parse_alpaca_bar(symbol=symbol, timeframe=timeframe, bar=bar) for bar in bars]
    candles.sort(key=lambda item: item.time)
    return candles[-clean_limit:]


def upsert_recent_signal(signal: TradingSignal, max_items: int = 300) -> None:
    global recent_signals
    signal_symbol = normalize_symbol(signal.symbol)
    signal_timeframe = normalize_timeframe(signal.timeframe)
    existing_index = next(
        (
            i
            for i, item in enumerate(recent_signals)
            if item.time == signal.time
            and normalize_symbol(item.symbol) == signal_symbol
            and normalize_timeframe(item.timeframe) == signal_timeframe
        ),
        None,
    )
    if existing_index is not None:
        recent_signals[existing_index] = signal
    else:
        recent_signals.insert(0, signal)
    recent_signals = recent_signals[:max_items]


def upsert_recent_candle(candle: CandleData, max_items: int = 300) -> None:
    global recent_candles
    candle_symbol = normalize_symbol(candle.symbol)
    candle_timeframe = normalize_timeframe(candle.timeframe)
    existing_index = next(
        (
            i
            for i, item in enumerate(recent_candles)
            if item.time == candle.time
            and normalize_symbol(item.symbol) == candle_symbol
            and normalize_timeframe(item.timeframe) == candle_timeframe
        ),
        None,
    )
    if existing_index is not None:
        recent_candles[existing_index] = candle
    else:
        recent_candles.insert(0, candle)
    recent_candles = recent_candles[:max_items]


def filter_candles(symbol: str, timeframe: str, candles: List[CandleData]) -> List[CandleData]:
    selected_symbol = normalize_symbol(symbol)
    selected_tf = normalize_timeframe_for_matching(timeframe)
    filtered = [
        candle
        for candle in candles
        if (
            normalize_symbol(candle.symbol) == selected_symbol
            or normalize_symbol(candle.symbol).endswith(selected_symbol)
            or selected_symbol.endswith(normalize_symbol(candle.symbol))
        )
        and normalize_timeframe_for_matching(candle.timeframe) == selected_tf
    ]
    filtered.sort(key=lambda item: item.time)
    return filtered


def merge_candles(historical: List[CandleData], live: List[CandleData], limit: int = 300) -> List[CandleData]:
    merged: Dict[str, CandleData] = {}
    for candle in historical + live:
        key = f"{normalize_symbol(candle.symbol)}:{normalize_timeframe_for_matching(candle.timeframe)}:{candle.time}"
        merged[key] = candle
    output = list(merged.values())
    output.sort(key=lambda item: item.time)
    return output[-max(1, min(limit, 1000)):]


@app.get("/", response_model=HealthResponse)
async def health_check():
    return {"status": "ok", "service": "Trading Intelligence API"}


@app.post("/webhook/tradingview", response_model=WebhookResponse)
async def receive_tradingview_webhook(payload: WebhookPayload):
    global latest_signal, latest_sentiment

    if WEBHOOK_SECRET:
        if not payload.secret or payload.secret != WEBHOOK_SECRET:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing webhook secret",
            )

    event_type = payload.eventType or "TRADE_SIGNAL"
    created_at = datetime.now(timezone.utc).isoformat()

    if event_type == "SENTIMENT_UPDATE":
        sentiment = SentimentData(
            eventType="SENTIMENT_UPDATE",
            symbol=payload.symbol,
            timeframe=payload.timeframe,
            sentiment=payload.sentiment if payload.sentiment is not None else 50.0,
            sentimentStatus=payload.sentimentStatus or "Waiting",
            bearCount=payload.bearCount if payload.bearCount is not None else 0,
            neutralCount=payload.neutralCount if payload.neutralCount is not None else 0,
            bullCount=payload.bullCount if payload.bullCount is not None else 0,
            bearPct=payload.bearPct if payload.bearPct is not None else 0.0,
            neutralPct=payload.neutralPct if payload.neutralPct is not None else 0.0,
            bullPct=payload.bullPct if payload.bullPct is not None else 0.0,
            activeCount=payload.activeCount if payload.activeCount is not None else 0,
            price=payload.price if payload.price is not None else 0.0,
            time=payload.time,
            createdAt=created_at,
        )
        latest_sentiment = sentiment
        return {"ok": True, "message": "SENTIMENT_UPDATE received"}

    signal = TradingSignal(
        eventType=event_type,
        status=payload.status or ("Open" if event_type == "TRADE_SIGNAL" else "Live"),
        symbol=payload.symbol,
        timeframe=payload.timeframe,
        signal=payload.signal or "NEUTRAL",
        confidence=payload.confidence if payload.confidence is not None else 0,
        bullScore=payload.bullScore if payload.bullScore is not None else 50,
        bearScore=payload.bearScore if payload.bearScore is not None else 50,
        netBias=payload.netBias if payload.netBias is not None else 0,
        price=payload.price if payload.price is not None else 0.0,
        entry=payload.entry if payload.entry is not None else payload.price,
        current=payload.current if payload.current is not None else payload.price,
        pnl=payload.pnl if payload.pnl is not None else 0.0,
        percent=payload.percent if payload.percent is not None else 0.0,
        time=payload.time,
        open=payload.open,
        high=payload.high,
        low=payload.low,
        close=payload.close,
        volume=payload.volume if payload.volume is not None else 0.0,
        smc=payload.smc or "Awaiting signal",
        alphax=payload.alphax or "Awaiting signal",
        ghost=payload.ghost or "Awaiting signal",
        chartOverlays=payload.chartOverlays,
        openInterest=payload.openInterest or "Awaiting signal",
        footprint=payload.footprint or "Awaiting signal",
        session=payload.session or "Live Market",
        fredMacro=payload.fredMacro or "Neutral",
        finraShortVolume=payload.finraShortVolume or "Awaiting signal",
        cot=payload.cot or "Awaiting signal",
        warnings=payload.warnings or [],
        createdAt=created_at,
    )

    latest_signal = signal
    upsert_recent_signal(signal)

    if (
        payload.time is not None
        and payload.open is not None
        and payload.high is not None
        and payload.low is not None
        and payload.close is not None
    ):
        candle = CandleData(
            time=payload.time,
            open=payload.open,
            high=payload.high,
            low=payload.low,
            close=payload.close,
            volume=payload.volume if payload.volume is not None else 0.0,
            symbol=payload.symbol,
            timeframe=payload.timeframe,
            createdAt=created_at,
        )
        upsert_recent_candle(candle)

    return {"ok": True, "message": f"{event_type} received"}


@app.get("/api/latest-signal", response_model=TradingSignal)
async def get_latest_signal():
    if latest_signal is None:
        return DEFAULT_WAITING_SIGNAL
    return latest_signal


@app.get("/api/recent-signals", response_model=List[TradingSignal])
async def get_recent_signals():
    return recent_signals


@app.get("/api/recent-candles", response_model=List[CandleData])
async def get_recent_candles():
    return recent_candles


@app.get("/api/historical-candles", response_model=List[CandleData])
async def get_historical_candles(
    symbol: str = Query(..., description="Example: BTCUSD, ETHUSD, SPY"),
    timeframe: str = Query("1m", description="Example: 1m, 5m, 15m, 1h, 4h, 1D"),
    limit: int = Query(300, ge=1, le=1000),
):
    return fetch_alpaca_historical_candles(symbol=symbol, timeframe=timeframe, limit=limit)


@app.get("/api/merged-candles", response_model=List[CandleData])
async def get_merged_candles(
    symbol: str = Query(..., description="Example: BTCUSD, ETHUSD, SPY"),
    timeframe: str = Query("1m", description="Example: 1m, 5m, 15m, 1h, 4h, 1D"),
    limit: int = Query(300, ge=1, le=1000),
):
    historical = fetch_alpaca_historical_candles(symbol=symbol, timeframe=timeframe, limit=limit)
    live = filter_candles(symbol=symbol, timeframe=timeframe, candles=recent_candles)
    return merge_candles(historical=historical, live=live, limit=limit)


@app.get("/api/latest-sentiment", response_model=SentimentData)
async def get_latest_sentiment():
    if latest_sentiment is None:
        return DEFAULT_SENTIMENT
    return latest_sentiment
