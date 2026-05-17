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
    openInterest: str
    footprint: str
    session: str
    fredMacro: str
    finraShortVolume: str
    cot: str

    warnings: List[str]
    createdAt: Optional[str] = None


class TradingSignalWithOptionalSecret(BaseModel):
    secret: Optional[str] = None

    eventType: Optional[str] = "TRADE_SIGNAL"
    status: Optional[str] = "Open"

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
    openInterest: str
    footprint: str
    session: str
    fredMacro: str
    finraShortVolume: str
    cot: str

    warnings: List[str]


class HealthResponse(BaseModel):
    status: str
    service: str


class WebhookResponse(BaseModel):
    ok: bool
    message: str


latest_signal: Optional[TradingSignal] = None
recent_signals: List[TradingSignal] = []
recent_candles: List[CandleData] = []


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
    openInterest="Awaiting signal",
    footprint="Awaiting signal",
    session="Market awaiting alert",
    fredMacro="Neutral",
    finraShortVolume="Awaiting signal",
    cot="Awaiting signal",
    warnings=["No signal received yet"],
    createdAt=datetime.now(timezone.utc).isoformat(),
)


@app.get("/", response_model=HealthResponse)
async def health_check():
    return {
        "status": "ok",
        "service": "Trading Intelligence API",
    }


@app.post("/webhook/tradingview", response_model=WebhookResponse)
async def receive_tradingview_webhook(signal_data: TradingSignalWithOptionalSecret):
    global latest_signal, recent_signals, recent_candles

    if WEBHOOK_SECRET:
        if not signal_data.secret or signal_data.secret != WEBHOOK_SECRET:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing webhook secret",
            )

    event_type = signal_data.eventType or "TRADE_SIGNAL"
    created_at = datetime.now(timezone.utc).isoformat()

    signal = TradingSignal(
        eventType=event_type,
        status=signal_data.status or ("Open" if event_type == "TRADE_SIGNAL" else "Live"),
        symbol=signal_data.symbol,
        timeframe=signal_data.timeframe,
        signal=signal_data.signal,
        confidence=signal_data.confidence,
        bullScore=signal_data.bullScore,
        bearScore=signal_data.bearScore,
        netBias=signal_data.netBias,
        price=signal_data.price,
        entry=signal_data.entry if signal_data.entry is not None else signal_data.price,
        current=signal_data.current if signal_data.current is not None else signal_data.price,
        pnl=signal_data.pnl if signal_data.pnl is not None else 0.0,
        percent=signal_data.percent if signal_data.percent is not None else 0.0,
        time=signal_data.time,
        open=signal_data.open,
        high=signal_data.high,
        low=signal_data.low,
        close=signal_data.close,
        volume=signal_data.volume if signal_data.volume is not None else 0.0,
        smc=signal_data.smc,
        alphax=signal_data.alphax,
        ghost=signal_data.ghost,
        openInterest=signal_data.openInterest,
        footprint=signal_data.footprint,
        session=signal_data.session,
        fredMacro=signal_data.fredMacro,
        finraShortVolume=signal_data.finraShortVolume,
        cot=signal_data.cot,
        warnings=signal_data.warnings,
        createdAt=created_at,
    )

    latest_signal = signal

    if (
        signal_data.time is not None
        and signal_data.open is not None
        and signal_data.high is not None
        and signal_data.low is not None
        and signal_data.close is not None
    ):
        candle = CandleData(
            time=signal_data.time,
            open=signal_data.open,
            high=signal_data.high,
            low=signal_data.low,
            close=signal_data.close,
            volume=signal_data.volume if signal_data.volume is not None else 0.0,
            symbol=signal_data.symbol,
            timeframe=signal_data.timeframe,
        )

        # Replace candle if same timestamp already exists
        existing_index = next(
            (i for i, item in enumerate(recent_candles) if item.time == candle.time),
            None,
        )

        if existing_index is not None:
            recent_candles[existing_index] = candle
        else:
            recent_candles.append(candle)

        recent_candles = recent_candles[-300:]

    if event_type == "TRADE_SIGNAL":
        recent_signals.insert(0, signal)

        if len(recent_signals) > 50:
            recent_signals = recent_signals[:50]

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
