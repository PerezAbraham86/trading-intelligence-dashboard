from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
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

    # Shared
    eventType: Optional[str] = "TRADE_SIGNAL"
    symbol: str
    timeframe: str
    price: Optional[float] = 0.0
    time: Optional[int] = None

    # Trading signal fields
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

    # Sentiment fields
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
    """
    Keeps matching stable for TradingView formats like:
    BTCUSD, BINANCE:BTCUSD, CME_MINI:MES1!, MES1!
    """
    return (symbol or "").replace(" ", "").upper()


def normalize_timeframe(timeframe: str) -> str:
    return str(timeframe or "").replace(" ", "").lower()


def upsert_recent_signal(signal: TradingSignal, max_items: int = 300) -> None:
    """
    Store all live updates and trade signals in recent_signals.

    Previous version only inserted eventType == TRADE_SIGNAL.
    That caused /api/recent-signals to return [] during LIVE_UPDATE alerts,
    even though /api/latest-signal was updating correctly.
    """
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


@app.get("/", response_model=HealthResponse)
async def health_check():
    return {
        "status": "ok",
        "service": "Trading Intelligence API",
    }


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

    # ─────────────────────────────────────────────
    # SENTIMENT UPDATE
    # Separate Market Sentiment gauge alert
    # ─────────────────────────────────────────────
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

        return {
            "ok": True,
            "message": "SENTIMENT_UPDATE received",
        }

    # ─────────────────────────────────────────────
    # TRADING SIGNAL / LIVE UPDATE
    # SMC + AlphaX + Ghost alert
    # ─────────────────────────────────────────────
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

    # Store all TRADE_SIGNAL and LIVE_UPDATE events in /api/recent-signals.
    # This is what the frontend chart currently uses to build live candles.
    upsert_recent_signal(signal)

    # Also keep a clean candle-only history in /api/recent-candles.
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

    return {
        "ok": True,
        "message": f"{event_type} received",
    }


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


@app.get("/api/latest-sentiment", response_model=SentimentData)
async def get_latest_sentiment():
    if latest_sentiment is None:
        return DEFAULT_SENTIMENT

    return latest_sentiment
