"""
api/trading_engine.py

Phase 1 Python engine for the Trading Intelligence Dashboard.

Goal:
- Move the first part of the Pine SMC logic into Python.
- Calculate Heikin Ashi candles.
- Detect internal and swing pivots.
- Detect BOS / CHoCH events.
- Return dashboard-ready overlay objects.

This file is intentionally self-contained so it can be added safely without
breaking your current webhook/API flow.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Literal, Optional, Tuple


Direction = Literal["bullish", "bearish", "neutral"]
Scope = Literal["internal", "swing"]


# ─────────────────────────────────────────────────────────────────────────────
# CONFIG — based on your Pine script inputs
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_ENGINE_CONFIG: Dict[str, Any] = {
    # Same defaults as your Pine script:
    # internalPivotLenInput = 5
    # swingPivotLenInput = 50
    "internal_pivot_len": 5,
    "swing_pivot_len": 50,

    # Same concept as Pine:
    # showInternalsInput = true
    # showStructureInput = true
    "show_internal_structure": True,
    "show_swing_structure": True,

    # Phase 1 only calculates structure.
    # Zones/FVG/OB/liquidity come in later phases.
    "max_events": 150,
}


# ─────────────────────────────────────────────────────────────────────────────
# DATA MODELS
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Candle:
    time: int | str
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0
    symbol: str = ""
    timeframe: str = ""
    createdAt: Optional[str] = None


@dataclass
class HeikinAshiCandle:
    time: int | str
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0
    symbol: str = ""
    timeframe: str = ""


@dataclass
class PivotPoint:
    index: int
    time: int | str
    price: float
    kind: Literal["high", "low"]


@dataclass
class SMCEvent:
    time: int | str
    fromTime: int | str
    price: float
    tag: Literal["BOS", "CHoCH", "iBOS", "iCHoCH"]
    direction: Direction
    scope: Scope
    fromIndex: int
    toIndex: int


@dataclass
class StructureState:
    scope: Scope
    bias: Direction
    lastHigh: Optional[float]
    lastLow: Optional[float]
    lastHighTime: Optional[int | str]
    lastLowTime: Optional[int | str]


# ─────────────────────────────────────────────────────────────────────────────
# SAFE PARSING
# ─────────────────────────────────────────────────────────────────────────────

def _to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None:
            return fallback
        parsed = float(value)
        if parsed != parsed:  # NaN check
            return fallback
        return parsed
    except Exception:
        return fallback


def _normalize_candle(raw: Any) -> Optional[Candle]:
    if raw is None:
        return None

    if isinstance(raw, Candle):
        return raw

    if not isinstance(raw, dict):
        return None

    if not all(key in raw for key in ("open", "high", "low", "close")):
        return None

    return Candle(
        time=raw.get("time") or raw.get("timestamp") or raw.get("createdAt") or "",
        open=_to_float(raw.get("open")),
        high=_to_float(raw.get("high")),
        low=_to_float(raw.get("low")),
        close=_to_float(raw.get("close")),
        volume=_to_float(raw.get("volume"), 0.0),
        symbol=str(raw.get("symbol") or ""),
        timeframe=str(raw.get("timeframe") or ""),
        createdAt=raw.get("createdAt"),
    )


def normalize_candles(raw_candles: List[Any]) -> List[Candle]:
    candles: List[Candle] = []

    for raw in raw_candles or []:
        candle = _normalize_candle(raw)
        if candle is not None:
            candles.append(candle)

    # Keep original order if already chronological.
    # If times are unix timestamps or numeric strings, sort safely.
    def sort_key(c: Candle) -> Any:
        try:
            return float(c.time)
        except Exception:
            return str(c.time)

    try:
        candles.sort(key=sort_key)
    except Exception:
        pass

    return candles


# ─────────────────────────────────────────────────────────────────────────────
# HEIKIN ASHI
# ─────────────────────────────────────────────────────────────────────────────

def calculate_heikin_ashi(candles: List[Candle]) -> List[HeikinAshiCandle]:
    ha: List[HeikinAshiCandle] = []

    for index, candle in enumerate(candles):
        ha_close = (candle.open + candle.high + candle.low + candle.close) / 4.0

        if index == 0:
            ha_open = (candle.open + candle.close) / 2.0
        else:
            prev = ha[-1]
            ha_open = (prev.open + prev.close) / 2.0

        ha_high = max(candle.high, ha_open, ha_close)
        ha_low = min(candle.low, ha_open, ha_close)

        ha.append(
            HeikinAshiCandle(
                time=candle.time,
                open=ha_open,
                high=ha_high,
                low=ha_low,
                close=ha_close,
                volume=candle.volume,
                symbol=candle.symbol,
                timeframe=candle.timeframe,
            )
        )

    return ha


# ─────────────────────────────────────────────────────────────────────────────
# PIVOT DETECTION
# ─────────────────────────────────────────────────────────────────────────────

def _is_pivot_high(candles: List[Candle], index: int, length: int) -> bool:
    if index - length < 0 or index + length >= len(candles):
        return False

    current = candles[index].high

    for i in range(index - length, index + length + 1):
        if i == index:
            continue
        if candles[i].high >= current:
            return False

    return True


def _is_pivot_low(candles: List[Candle], index: int, length: int) -> bool:
    if index - length < 0 or index + length >= len(candles):
        return False

    current = candles[index].low

    for i in range(index - length, index + length + 1):
        if i == index:
            continue
        if candles[i].low <= current:
            return False

    return True


def detect_pivots(candles: List[Candle], length: int) -> Tuple[List[PivotPoint], List[PivotPoint]]:
    highs: List[PivotPoint] = []
    lows: List[PivotPoint] = []

    if length < 1 or len(candles) < length * 2 + 1:
        return highs, lows

    for index in range(length, len(candles) - length):
        candle = candles[index]

        if _is_pivot_high(candles, index, length):
            highs.append(
                PivotPoint(
                    index=index,
                    time=candle.time,
                    price=candle.high,
                    kind="high",
                )
            )

        if _is_pivot_low(candles, index, length):
            lows.append(
                PivotPoint(
                    index=index,
                    time=candle.time,
                    price=candle.low,
                    kind="low",
                )
            )

    return highs, lows


# ─────────────────────────────────────────────────────────────────────────────
# SMC BOS / CHoCH ENGINE
# ─────────────────────────────────────────────────────────────────────────────

def _event_tag(scope: Scope, event_type: Literal["BOS", "CHoCH"]) -> Literal["BOS", "CHoCH", "iBOS", "iCHoCH"]:
    if scope == "internal":
        return "iBOS" if event_type == "BOS" else "iCHoCH"
    return event_type


def detect_structure_events(
    candles: List[Candle],
    pivot_highs: List[PivotPoint],
    pivot_lows: List[PivotPoint],
    scope: Scope,
    max_events: int = 150,
) -> Tuple[List[SMCEvent], StructureState]:
    """
    Pine layout reference:
    - close crossing above the active pivot high = bullish structure break
    - close crossing below the active pivot low = bearish structure break
    - if previous trend was opposite, the break is CHoCH
    - otherwise it is BOS
    """

    events: List[SMCEvent] = []

    highs_by_index: Dict[int, PivotPoint] = {pivot.index: pivot for pivot in pivot_highs}
    lows_by_index: Dict[int, PivotPoint] = {pivot.index: pivot for pivot in pivot_lows}

    active_high: Optional[PivotPoint] = None
    active_low: Optional[PivotPoint] = None
    crossed_high_indexes: set[int] = set()
    crossed_low_indexes: set[int] = set()

    # 0 = neutral, +1 = bullish, -1 = bearish
    trend_bias = 0

    for index, candle in enumerate(candles):
        if index in highs_by_index:
            active_high = highs_by_index[index]

        if index in lows_by_index:
            active_low = lows_by_index[index]

        # Bullish break above last active pivot high.
        if (
            active_high is not None
            and active_high.index not in crossed_high_indexes
            and candle.close > active_high.price
            and index > active_high.index
        ):
            event_type: Literal["BOS", "CHoCH"] = "CHoCH" if trend_bias == -1 else "BOS"
            trend_bias = 1
            crossed_high_indexes.add(active_high.index)

            events.append(
                SMCEvent(
                    time=candle.time,
                    fromTime=active_high.time,
                    price=active_high.price,
                    tag=_event_tag(scope, event_type),
                    direction="bullish",
                    scope=scope,
                    fromIndex=active_high.index,
                    toIndex=index,
                )
            )

        # Bearish break below last active pivot low.
        if (
            active_low is not None
            and active_low.index not in crossed_low_indexes
            and candle.close < active_low.price
            and index > active_low.index
        ):
            event_type = "CHoCH" if trend_bias == 1 else "BOS"
            trend_bias = -1
            crossed_low_indexes.add(active_low.index)

            events.append(
                SMCEvent(
                    time=candle.time,
                    fromTime=active_low.time,
                    price=active_low.price,
                    tag=_event_tag(scope, event_type),
                    direction="bearish",
                    scope=scope,
                    fromIndex=active_low.index,
                    toIndex=index,
                )
            )

    if len(events) > max_events:
        events = events[-max_events:]

    state = StructureState(
        scope=scope,
        bias="bullish" if trend_bias == 1 else "bearish" if trend_bias == -1 else "neutral",
        lastHigh=active_high.price if active_high else None,
        lastLow=active_low.price if active_low else None,
        lastHighTime=active_high.time if active_high else None,
        lastLowTime=active_low.time if active_low else None,
    )

    return events, state


# ─────────────────────────────────────────────────────────────────────────────
# SCORE / SIGNAL SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

def calculate_phase1_scores(
    internal_state: StructureState,
    swing_state: StructureState,
    smc_events: List[SMCEvent],
) -> Dict[str, Any]:
    latest_event = smc_events[-1] if smc_events else None

    bull_score = 50
    bear_score = 50

    if swing_state.bias == "bullish":
        bull_score += 20
        bear_score -= 20
    elif swing_state.bias == "bearish":
        bull_score -= 20
        bear_score += 20

    if internal_state.bias == "bullish":
        bull_score += 10
        bear_score -= 10
    elif internal_state.bias == "bearish":
        bull_score -= 10
        bear_score += 10

    if latest_event is not None:
        if latest_event.direction == "bullish":
            bull_score += 10
            bear_score -= 10
        elif latest_event.direction == "bearish":
            bull_score -= 10
            bear_score += 10

    bull_score = max(0, min(100, bull_score))
    bear_score = max(0, min(100, bear_score))
    net_bias = bull_score - bear_score

    signal = "BUY" if net_bias > 15 else "SELL" if net_bias < -15 else "NEUTRAL"
    confidence = min(100, abs(net_bias))

    return {
        "signal": signal,
        "confidence": confidence,
        "bullScore": bull_score,
        "bearScore": bear_score,
        "netBias": net_bias,
        "latestSmcEvent": asdict(latest_event) if latest_event else None,
        "internalBias": internal_state.bias,
        "swingBias": swing_state.bias,
    }


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC ENGINE ENTRY
# ─────────────────────────────────────────────────────────────────────────────

def run_phase1_engine(
    raw_candles: List[Any],
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    cfg = {**DEFAULT_ENGINE_CONFIG, **(config or {})}

    candles = normalize_candles(raw_candles)
    ha_candles = calculate_heikin_ashi(candles)

    internal_highs, internal_lows = detect_pivots(
        candles,
        int(cfg["internal_pivot_len"]),
    )

    swing_highs, swing_lows = detect_pivots(
        candles,
        int(cfg["swing_pivot_len"]),
    )

    internal_events, internal_state = detect_structure_events(
        candles,
        internal_highs,
        internal_lows,
        "internal",
        max_events=int(cfg["max_events"]),
    )

    swing_events, swing_state = detect_structure_events(
        candles,
        swing_highs,
        swing_lows,
        "swing",
        max_events=int(cfg["max_events"]),
    )

    smc_events: List[SMCEvent] = []

    if cfg["show_internal_structure"]:
        smc_events.extend(internal_events)

    if cfg["show_swing_structure"]:
        smc_events.extend(swing_events)

    # Keep chronological order by toIndex.
    smc_events.sort(key=lambda event: event.toIndex)

    if len(smc_events) > int(cfg["max_events"]):
        smc_events = smc_events[-int(cfg["max_events"]):]

    scores = calculate_phase1_scores(internal_state, swing_state, smc_events)

    return {
        "engine": "python_smc_alpha_ghost",
        "phase": "phase_1_smc_core",
        "candles": [asdict(candle) for candle in candles],
        "heikinAshiCandles": [asdict(candle) for candle in ha_candles],

        # Dashboard chart overlays:
        "smcEvents": [asdict(event) for event in smc_events],
        "zones": [],
        "liquidityEvents": [],
        "dlmLevels": [],
        "dlmConfluenceMarkers": [],
        "scoreMarkers": [],

        # Debug/state:
        "pivots": {
            "internalHighs": [asdict(pivot) for pivot in internal_highs[-50:]],
            "internalLows": [asdict(pivot) for pivot in internal_lows[-50:]],
            "swingHighs": [asdict(pivot) for pivot in swing_highs[-25:]],
            "swingLows": [asdict(pivot) for pivot in swing_lows[-25:]],
        },
        "structureState": {
            "internal": asdict(internal_state),
            "swing": asdict(swing_state),
        },
        "scores": scores,
        "signal": {
            "symbol": candles[-1].symbol if candles else "",
            "timeframe": candles[-1].timeframe if candles else "",
            "signal": scores["signal"],
            "confidence": scores["confidence"],
            "bullScore": scores["bullScore"],
            "bearScore": scores["bearScore"],
            "netBias": scores["netBias"],
            "price": candles[-1].close if candles else 0,
            "smc": (
                f"{scores['latestSmcEvent']['tag']} {scores['latestSmcEvent']['direction']}"
                if scores["latestSmcEvent"]
                else "No SMC event"
            ),
            "alphax": "Phase 3 pending",
            "ghost": "Phase 4 pending",
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# QUICK LOCAL TEST
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    sample = [
        {"time": i, "open": 100 + i * 0.1, "high": 101 + i * 0.1, "low": 99 + i * 0.1, "close": 100.5 + i * 0.1, "volume": 1000}
        for i in range(200)
    ]
    result = run_phase1_engine(sample)
    print(
        {
            "phase": result["phase"],
            "events": len(result["smcEvents"]),
            "signal": result["signal"],
        }
    )
