from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize FastAPI app
app = FastAPI(
    title="Trading Intelligence API",
    description="Backend for receiving TradingView webhook alerts and serving live trading signals",
    version="1.0.0"
)

# CORS configuration
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

# Environment variables
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET")

# Pydantic models
class TradingSignal(BaseModel):
    symbol: str
    timeframe: str
    signal: str  # BUY or SELL
    confidence: int
    bullScore: int
    bearScore: int
    netBias: int
    price: float
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
    symbol: str
    timeframe: str
    signal: str  # BUY or SELL
    confidence: int
    bullScore: int
    bearScore: int
    netBias: int
    price: float
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


# In-memory storage
latest_signal: Optional[TradingSignal] = None
recent_signals: List[TradingSignal] = []

# Default waiting signal
DEFAULT_WAITING_SIGNAL = TradingSignal(
    symbol="WAITING",
    timeframe="1d",
    signal="NEUTRAL",
    confidence=0,
    bullScore=50,
    bearScore=50,
    netBias=0,
    price=0.0,
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
    createdAt=datetime.now(timezone.utc).isoformat()
)


@app.get("/", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "Trading Intelligence API"
    }


@app.post("/webhook/tradingview", response_model=WebhookResponse)
async def receive_tradingview_webhook(signal_data: TradingSignalWithOptionalSecret):
    """
    Receive TradingView webhook alerts.
    
    Validates optional secret if WEBHOOK_SECRET is set.
    Stores the latest signal and appends to recent signals list.
    Keeps only the latest 50 signals.
    """
    global latest_signal, recent_signals
    
    # Validate secret if configured
    if WEBHOOK_SECRET:
        if not signal_data.secret or signal_data.secret != WEBHOOK_SECRET:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing webhook secret"
            )
    
    # Create signal object with timestamp
    signal = TradingSignal(
        symbol=signal_data.symbol,
        timeframe=signal_data.timeframe,
        signal=signal_data.signal,
        confidence=signal_data.confidence,
        bullScore=signal_data.bullScore,
        bearScore=signal_data.bearScore,
        netBias=signal_data.netBias,
        price=signal_data.price,
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
        createdAt=datetime.now(timezone.utc).isoformat()
    )
    
    # Store latest signal
    latest_signal = signal
    
    # Append to recent signals and keep only latest 50
    recent_signals.insert(0, signal)
    if len(recent_signals) > 50:
        recent_signals = recent_signals[:50]
    
    return {
        "ok": True,
        "message": "signal received"
    }


@app.get("/api/latest-signal", response_model=TradingSignal)
async def get_latest_signal():
    """Get the latest trading signal. Returns default waiting signal if none exists."""
    if latest_signal is None:
        return DEFAULT_WAITING_SIGNAL
    return latest_signal


@app.get("/api/recent-signals", response_model=List[TradingSignal])
async def get_recent_signals():
    """Get list of up to 50 most recent trading signals."""
    return recent_signals
