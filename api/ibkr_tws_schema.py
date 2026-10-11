"""Strict, credential-free wire schema for the SPY TWS relay."""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SOURCE = "ibkr_tws"
STATES = Literal["connected", "gateway_disconnected", "authentication_required", "subscription_required", "waiting_for_data", "pacing_limited", "contract_error", "data_error"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Candle(StrictModel):
    epoch: int = Field(ge=946684800)
    open: float = Field(gt=0, le=1e12)
    high: float = Field(gt=0, le=1e12)
    low: float = Field(gt=0, le=1e12)
    close: float = Field(gt=0, le=1e12)
    volume: float = Field(ge=0, le=1e15)
    completed: bool
    updatedAt: float = Field(gt=0)

    @model_validator(mode="after")
    def valid_bar(self):
        values = (self.open, self.high, self.low, self.close, self.volume, self.updatedAt)
        if not all(math.isfinite(v) for v in values):
            raise ValueError("Non-finite candle field")
        if self.epoch % 60 or self.high < max(self.open, self.close) or self.low > min(self.open, self.close) or self.high < self.low:
            raise ValueError("Invalid one-minute OHLC interval")
        now = datetime.now(timezone.utc).timestamp()
        if self.epoch > now + 5 or self.updatedAt > now + 30 or self.updatedAt < self.epoch:
            raise ValueError("Future candle or inconsistent update timestamp")
        if self.completed and self.epoch + 60 > now + 5:
            raise ValueError("Current minute cannot be completed")
        return self

    def normalized(self, conid: int) -> dict:
        stamp = datetime.fromtimestamp(self.epoch, timezone.utc).isoformat()
        return {**self.model_dump(), "time": stamp, "timestamp": stamp, "symbol": "SPY", "timeframe": "1m", "provider": "ibkr", "source": SOURCE, "conid": conid}


class TradingDay(StrictModel):
    start: int
    end: int
    intervals: list[list[int]] = Field(max_length=8)

    @model_validator(mode="after")
    def valid_day(self):
        if self.end <= self.start or self.end - self.start > 90000:
            raise ValueError("Invalid trading-day coverage")
        for interval in self.intervals:
            if len(interval) != 2 or not self.start <= interval[0] < interval[1] <= self.end:
                raise ValueError("Invalid session interval")
        return self


class RelayPayload(StrictModel):
    version: Literal[1] = 1
    source: Literal["ibkr_tws"] = SOURCE
    connectorId: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    bootId: str = Field(pattern=r"^[a-f0-9]{32}$")
    sequence: int = Field(ge=1, le=9223372036854775807)
    symbol: Literal["SPY"] = "SPY"
    timeframe: Literal["1m"] = "1m"
    secType: Literal["STK"] = "STK"
    exchange: Literal["SMART"] = "SMART"
    currency: Literal["USD"] = "USD"
    conid: int = Field(ge=0, le=2147483647)
    environment: Literal["live", "paper"]
    useRTH: bool
    state: STATES
    connected: bool
    subscribed: bool
    errorCode: int | None = None
    lastDataUpdate: float | None = None
    schedule: list[TradingDay] = Field(default_factory=list, max_length=14)
    candles: list[Candle] = Field(default_factory=list, max_length=500)
    gapRecoveryLimited: bool = False

    @field_validator("lastDataUpdate")
    @classmethod
    def data_stamp(cls, value):
        if value is not None and (not math.isfinite(value) or value <= 0 or value > datetime.now(timezone.utc).timestamp() + 30):
            raise ValueError("Invalid data freshness timestamp")
        return value

    @model_validator(mode="after")
    def consistency(self):
        epochs = [bar.epoch for bar in self.candles]
        if len(epochs) != len(set(epochs)):
            raise ValueError("Duplicate candle in batch")
        if self.candles and self.lastDataUpdate is None:
            raise ValueError("Candles require provider receive timestamp")
        if self.candles and self.conid <= 0:
            raise ValueError("Candles require a qualified contract")
        if self.subscribed and (not self.connected or not self.conid):
            raise ValueError("Subscription requires connected, qualified contract")
        if self.lastDataUpdate is not None and self.candles and max(bar.updatedAt for bar in self.candles) > self.lastDataUpdate + 1:
            raise ValueError("Candle timestamp exceeds data update timestamp")
        return self
