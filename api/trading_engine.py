"""
api/trading_engine.py

Phase 2 Python engine for the Trading Intelligence Dashboard.

Blueprint source:
- Your Pine layout:
  SMC Pro Phase 4 + AlphaX DLM + HA Ghost Candles
- This Python version keeps the same visual/data layout names so the frontend
  can render Pine-style objects without needing TradingView alerts.

Phase 1:
- Heikin Ashi candles
- internal/swing pivots
- BOS / CHoCH
- trend bias

Phase 2:
- internal/swing order block zones
- fair value gaps
- premium/equilibrium/discount zones
- EQH/EQL liquidity levels
- liquidity sweeps
- liquidity pools
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
    # Pine defaults
    "internal_pivot_len": 5,
    "swing_pivot_len": 50,
    "internal_equal_pivot_len": 3,
    "swing_equal_pivot_len": 3,

    "show_internal_structure": True,
    "show_swing_structure": True,

    # Order blocks
    "show_internal_order_blocks": True,
    "show_swing_order_blocks": False,
    "internal_order_blocks_size": 5,
    "swing_order_blocks_size": 5,
    "order_block_filter": "Atr",
    "order_block_mitigation": "High/Low",

    # FVG
    "show_fair_value_gaps": True,
    "fair_value_gaps_auto_threshold": True,
    "fair_value_gaps_extend": 1,
    "max_fair_value_gaps": 8,

    # Equal highs/lows and sweeps
    "show_equal_highs_lows": True,
    "equal_highs_lows_threshold": 0.10,
    "show_internal_sweeps": True,
    "show_swing_sweeps": True,
    "sweep_require_close_back": True,
    "sweep_use_wick_only": True,
    "sweep_atr_buffer": 0.05,

    # Premium / discount
    "show_premium_discount_zones": True,

    # Liquidity pools
    "show_liquidity_pools": True,
    "liquidity_lookback": 50,
    "liquidity_cluster_threshold_atr": 0.15,

    # Output limits
    "max_events": 150,
    "max_zones": 80,
    "max_liquidity_events": 120,
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
    tag: Literal["BOS", "CHoCH", "iBOS", "iCHoCH", "HH", "HL", "LH", "LL"]
    direction: Direction
    scope: Scope
    fromIndex: int
    toIndex: int


@dataclass
class SmcZone:
    startTime: int | str
    endTime: int | str
    top: float
    bottom: float
    label: str
    direction: Direction
    kind: Literal[
        "internal_ob",
        "swing_ob",
        "fvg",
        "premium",
        "equilibrium",
        "discount",
    ]


@dataclass
class LiquidityEvent:
    time: int | str
    fromTime: Optional[int | str]
    price: float
    label: str
    direction: Direction
    kind: Literal[
        "eqh",
        "eql",
        "internal_sweep",
        "swing_sweep",
        "liquidity_pool",
        "inducement",
    ]
    touches: Optional[int] = None


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
        if parsed != parsed:
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
# BASIC INDICATORS
# ─────────────────────────────────────────────────────────────────────────────

def calculate_true_range(candles: List[Candle]) -> List[float]:
    tr_values: List[float] = []

    for i, candle in enumerate(candles):
        if i == 0:
            tr_values.append(max(candle.high - candle.low, 0.0))
            continue

        prev_close = candles[i - 1].close
        tr = max(
            candle.high - candle.low,
            abs(candle.high - prev_close),
            abs(candle.low - prev_close),
        )
        tr_values.append(max(tr, 0.0))

    return tr_values


def calculate_atr(candles: List[Candle], length: int = 200) -> List[float]:
    tr_values = calculate_true_range(candles)
    atr: List[float] = []

    running_sum = 0.0

    for i, tr in enumerate(tr_values):
        running_sum += tr

        if i >= length:
            running_sum -= tr_values[i - length]
            atr.append(running_sum / length)
        else:
            atr.append(running_sum / max(i + 1, 1))

    return atr


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
# PIVOTS
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
            highs.append(PivotPoint(index=index, time=candle.time, price=candle.high, kind="high"))

        if _is_pivot_low(candles, index, length):
            lows.append(PivotPoint(index=index, time=candle.time, price=candle.low, kind="low"))

    return highs, lows


# ─────────────────────────────────────────────────────────────────────────────
# STRUCTURE EVENTS
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
    events: List[SMCEvent] = []

    highs_by_index: Dict[int, PivotPoint] = {pivot.index: pivot for pivot in pivot_highs}
    lows_by_index: Dict[int, PivotPoint] = {pivot.index: pivot for pivot in pivot_lows}

    active_high: Optional[PivotPoint] = None
    active_low: Optional[PivotPoint] = None
    crossed_high_indexes: set[int] = set()
    crossed_low_indexes: set[int] = set()

    trend_bias = 0

    for index, candle in enumerate(candles):
        if index in highs_by_index:
            active_high = highs_by_index[index]

        if index in lows_by_index:
            active_low = lows_by_index[index]

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


def build_swing_point_events(
    pivot_highs: List[PivotPoint],
    pivot_lows: List[PivotPoint],
    max_events: int = 80,
) -> List[SMCEvent]:
    events: List[SMCEvent] = []

    last_high: Optional[PivotPoint] = None
    last_low: Optional[PivotPoint] = None

    merged = sorted([*pivot_highs, *pivot_lows], key=lambda p: p.index)

    for pivot in merged:
        if pivot.kind == "high":
            tag: Literal["HH", "LH"] = "HH" if last_high is None or pivot.price > last_high.price else "LH"
            events.append(
                SMCEvent(
                    time=pivot.time,
                    fromTime=last_high.time if last_high else pivot.time,
                    price=pivot.price,
                    tag=tag,
                    direction="bearish",
                    scope="swing",
                    fromIndex=last_high.index if last_high else pivot.index,
                    toIndex=pivot.index,
                )
            )
            last_high = pivot

        if pivot.kind == "low":
            tag2: Literal["HL", "LL"] = "HL" if last_low is None or pivot.price > last_low.price else "LL"
            events.append(
                SMCEvent(
                    time=pivot.time,
                    fromTime=last_low.time if last_low else pivot.time,
                    price=pivot.price,
                    tag=tag2,
                    direction="bullish" if tag2 == "HL" else "bearish",
                    scope="swing",
                    fromIndex=last_low.index if last_low else pivot.index,
                    toIndex=pivot.index,
                )
            )
            last_low = pivot

    return events[-max_events:]


# ─────────────────────────────────────────────────────────────────────────────
# ORDER BLOCKS
# ─────────────────────────────────────────────────────────────────────────────

def _parsed_high_low(candle: Candle, atr_value: float, range_method_value: float, use_atr: bool) -> Tuple[float, float]:
    volatility_measure = atr_value if use_atr else range_method_value
    high_volatility = (candle.high - candle.low) >= 2.0 * max(volatility_measure, 1e-12)

    parsed_high = candle.low if high_volatility else candle.high
    parsed_low = candle.high if high_volatility else candle.low

    return parsed_high, parsed_low


def build_order_blocks(
    candles: List[Candle],
    structure_events: List[SMCEvent],
    scope: Scope,
    max_blocks: int,
    use_atr_filter: bool,
    atr_values: List[float],
) -> List[SmcZone]:
    zones: List[SmcZone] = []

    if not candles:
        return zones

    tr_values = calculate_true_range(candles)
    cumulative_tr = 0.0
    range_method_values: List[float] = []

    for i, tr in enumerate(tr_values):
        cumulative_tr += tr
        range_method_values.append(cumulative_tr / max(i + 1, 1))

    for event in structure_events:
        if event.fromIndex < 0 or event.toIndex <= event.fromIndex:
            continue

        search = candles[event.fromIndex:event.toIndex + 1]
        if not search:
            continue

        parsed_candidates: List[Tuple[int, float, float]] = []

        for local_index, candle in enumerate(search):
            global_index = event.fromIndex + local_index
            parsed_high, parsed_low = _parsed_high_low(
                candle,
                atr_values[global_index] if global_index < len(atr_values) else 0.0,
                range_method_values[global_index] if global_index < len(range_method_values) else 0.0,
                use_atr_filter,
            )
            parsed_candidates.append((global_index, parsed_high, parsed_low))

        if event.direction == "bullish":
            # Pine stores bullish OB from the lowest parsed low between pivot and break.
            selected = min(parsed_candidates, key=lambda item: item[2])
            direction: Direction = "bullish"
            label = "Internal Bullish OB" if scope == "internal" else "Swing Bullish OB"
        else:
            # Pine stores bearish OB from the highest parsed high.
            selected = max(parsed_candidates, key=lambda item: item[1])
            direction = "bearish"
            label = "Internal Bearish OB" if scope == "internal" else "Swing Bearish OB"

        selected_index, selected_high, selected_low = selected

        top = max(selected_high, selected_low)
        bottom = min(selected_high, selected_low)

        zones.append(
            SmcZone(
                startTime=candles[selected_index].time,
                endTime=candles[-1].time,
                top=top,
                bottom=bottom,
                label=label,
                direction=direction,
                kind="internal_ob" if scope == "internal" else "swing_ob",
            )
        )

    # De-dupe by start/kind/top/bottom while preserving latest.
    unique: Dict[str, SmcZone] = {}
    for zone in zones:
        key = f"{zone.kind}:{zone.startTime}:{round(zone.top, 8)}:{round(zone.bottom, 8)}"
        unique[key] = zone

    return list(unique.values())[-max_blocks:]


def filter_mitigated_order_blocks(
    candles: List[Candle],
    zones: List[SmcZone],
    mitigation: str,
) -> List[SmcZone]:
    if not candles:
        return zones

    kept: List[SmcZone] = []

    for zone in zones:
        try:
            start_index = next(i for i, candle in enumerate(candles) if candle.time == zone.startTime)
        except StopIteration:
            start_index = 0

        mitigated = False

        for candle in candles[start_index + 1:]:
            bearish_source = candle.close if mitigation == "Close" else candle.high
            bullish_source = candle.close if mitigation == "Close" else candle.low

            if zone.direction == "bearish" and bearish_source > zone.top:
                mitigated = True
                break

            if zone.direction == "bullish" and bullish_source < zone.bottom:
                mitigated = True
                break

        if not mitigated:
            kept.append(zone)

    return kept


# ─────────────────────────────────────────────────────────────────────────────
# FVG
# ─────────────────────────────────────────────────────────────────────────────

def detect_fair_value_gaps(
    candles: List[Candle],
    max_fvgs: int = 8,
    auto_threshold: bool = True,
) -> List[SmcZone]:
    zones: List[SmcZone] = []

    if len(candles) < 3:
        return zones

    # Pine threshold is based on a cum average. For Python, keep a stable threshold
    # that avoids tiny gaps but still plots most meaningful FVGs.
    body_percentages: List[float] = []

    for i in range(1, len(candles)):
        prev = candles[i - 1]
        if prev.open != 0:
            body_percentages.append(abs(prev.close - prev.open) / abs(prev.open) * 100.0)

    avg_body_pct = sum(body_percentages) / max(len(body_percentages), 1)
    threshold = avg_body_pct * 0.25 if auto_threshold else 0.0

    for i in range(2, len(candles)):
        current = candles[i]
        prev = candles[i - 1]
        two_back = candles[i - 2]

        prev_delta_pct = abs(prev.close - prev.open) / abs(prev.open) * 100.0 if prev.open != 0 else 0.0

        bullish = current.low > two_back.high and prev.close > two_back.high and prev_delta_pct >= threshold
        bearish = current.high < two_back.low and prev.close < two_back.low and prev_delta_pct >= threshold

        if bullish:
            zones.append(
                SmcZone(
                    startTime=two_back.time,
                    endTime=candles[-1].time,
                    top=current.low,
                    bottom=two_back.high,
                    label="Bullish FVG",
                    direction="bullish",
                    kind="fvg",
                )
            )

        if bearish:
            zones.append(
                SmcZone(
                    startTime=two_back.time,
                    endTime=candles[-1].time,
                    top=two_back.low,
                    bottom=current.high,
                    label="Bearish FVG",
                    direction="bearish",
                    kind="fvg",
                )
            )

    # Remove mitigated FVGs.
    active: List[SmcZone] = []

    for zone in zones:
        try:
            start_index = next(i for i, candle in enumerate(candles) if candle.time == zone.startTime)
        except StopIteration:
            start_index = 0

        mitigated = False

        for candle in candles[start_index + 2:]:
            if zone.direction == "bullish" and candle.low <= zone.bottom:
                mitigated = True
                break
            if zone.direction == "bearish" and candle.high >= zone.top:
                mitigated = True
                break

        if not mitigated:
            active.append(zone)

    return active[-max_fvgs:]


# ─────────────────────────────────────────────────────────────────────────────
# PREMIUM / DISCOUNT
# ─────────────────────────────────────────────────────────────────────────────

def build_premium_discount_zones(
    candles: List[Candle],
    swing_highs: List[PivotPoint],
    swing_lows: List[PivotPoint],
) -> List[SmcZone]:
    if not candles:
        return []

    if swing_highs:
        top_pivot = max(swing_highs[-5:], key=lambda p: p.price)
        top = top_pivot.price
        top_time = top_pivot.time
    else:
        top = max(c.high for c in candles)
        top_time = candles[0].time

    if swing_lows:
        bottom_pivot = min(swing_lows[-5:], key=lambda p: p.price)
        bottom = bottom_pivot.price
        bottom_time = bottom_pivot.time
    else:
        bottom = min(c.low for c in candles)
        bottom_time = candles[0].time

    if top <= bottom:
        return []

    start_time = top_time if str(top_time) < str(bottom_time) else bottom_time
    end_time = candles[-1].time

    # Mirrors Pine proportions:
    # premium: top to 0.95 top + 0.05 bottom
    # equilibrium: 0.525 top + 0.475 bottom to 0.525 bottom + 0.475 top
    # discount: 0.95 bottom + 0.05 top to bottom
    premium_bottom = 0.95 * top + 0.05 * bottom
    eq_top = 0.525 * top + 0.475 * bottom
    eq_bottom = 0.525 * bottom + 0.475 * top
    discount_top = 0.95 * bottom + 0.05 * top

    return [
        SmcZone(
            startTime=start_time,
            endTime=end_time,
            top=top,
            bottom=premium_bottom,
            label="Premium",
            direction="bearish",
            kind="premium",
        ),
        SmcZone(
            startTime=start_time,
            endTime=end_time,
            top=eq_top,
            bottom=eq_bottom,
            label="Equilibrium",
            direction="neutral",
            kind="equilibrium",
        ),
        SmcZone(
            startTime=start_time,
            endTime=end_time,
            top=discount_top,
            bottom=bottom,
            label="Discount",
            direction="bullish",
            kind="discount",
        ),
    ]


# ─────────────────────────────────────────────────────────────────────────────
# LIQUIDITY EVENTS: EQH/EQL, SWEEPS, POOLS
# ─────────────────────────────────────────────────────────────────────────────

def detect_equal_highs_lows(
    pivot_highs: List[PivotPoint],
    pivot_lows: List[PivotPoint],
    atr_values: List[float],
    threshold_mult: float,
    max_events: int = 60,
) -> List[LiquidityEvent]:
    events: List[LiquidityEvent] = []

    for pivots, kind, label, direction in [
        (pivot_highs, "eqh", "EQH", "bearish"),
        (pivot_lows, "eql", "EQL", "bullish"),
    ]:
        for i in range(1, len(pivots)):
            prev = pivots[i - 1]
            curr = pivots[i]

            atr_index = min(curr.index, len(atr_values) - 1)
            atr = atr_values[atr_index] if atr_values else 0.0
            threshold = atr * threshold_mult

            if abs(curr.price - prev.price) <= threshold:
                events.append(
                    LiquidityEvent(
                        time=curr.time,
                        fromTime=prev.time,
                        price=(curr.price + prev.price) / 2.0,
                        label=label,
                        direction=direction,  # type: ignore[arg-type]
                        kind=kind,  # type: ignore[arg-type]
                        touches=2,
                    )
                )

    events.sort(key=lambda event: str(event.time))
    return events[-max_events:]


def detect_liquidity_sweeps(
    candles: List[Candle],
    equal_events: List[LiquidityEvent],
    atr_values: List[float],
    cfg: Dict[str, Any],
    max_events: int = 80,
) -> List[LiquidityEvent]:
    sweeps: List[LiquidityEvent] = []

    for event in equal_events:
        try:
            start_index = next(i for i, candle in enumerate(candles) if candle.time == event.time)
        except StopIteration:
            start_index = 0

        for i in range(start_index + 1, len(candles)):
            candle = candles[i]
            atr = atr_values[i] if i < len(atr_values) else 0.0
            buffer = atr * float(cfg["sweep_atr_buffer"])

            if event.kind == "eql":
                wick_through = candle.low < event.price - buffer
                close_back = candle.close > event.price
                valid = (wick_through if cfg["sweep_use_wick_only"] else candle.low <= event.price) and (
                    close_back if cfg["sweep_require_close_back"] else True
                )

                if valid:
                    sweeps.append(
                        LiquidityEvent(
                            time=candle.time,
                            fromTime=event.fromTime,
                            price=event.price,
                            label="iLS" if event.label == "EQL" else "LSL",
                            direction="bullish",
                            kind="internal_sweep",
                        )
                    )
                    break

            if event.kind == "eqh":
                wick_through = candle.high > event.price + buffer
                close_back = candle.close < event.price
                valid = (wick_through if cfg["sweep_use_wick_only"] else candle.high >= event.price) and (
                    close_back if cfg["sweep_require_close_back"] else True
                )

                if valid:
                    sweeps.append(
                        LiquidityEvent(
                            time=candle.time,
                            fromTime=event.fromTime,
                            price=event.price,
                            label="iHS" if event.label == "EQH" else "LSH",
                            direction="bearish",
                            kind="internal_sweep",
                        )
                    )
                    break

    return sweeps[-max_events:]


def detect_liquidity_pools(
    candles: List[Candle],
    atr_values: List[float],
    lookback: int,
    cluster_threshold_atr: float,
) -> List[LiquidityEvent]:
    if len(candles) < max(lookback, 5):
        return []

    recent = candles[-lookback:]
    latest_atr = atr_values[-1] if atr_values else 0.0
    threshold = latest_atr * cluster_threshold_atr

    recent_low = min(c.low for c in recent)
    recent_high = max(c.high for c in recent)

    low_touches = [
        c for c in recent
        if abs(c.low - recent_low) <= threshold
    ]

    high_touches = [
        c for c in recent
        if abs(c.high - recent_high) <= threshold
    ]

    events: List[LiquidityEvent] = []

    if len(low_touches) >= 2:
        events.append(
            LiquidityEvent(
                time=low_touches[-1].time,
                fromTime=low_touches[0].time,
                price=recent_low,
                label="Sell-Side Pool",
                direction="bullish",
                kind="liquidity_pool",
                touches=len(low_touches),
            )
        )

    if len(high_touches) >= 2:
        events.append(
            LiquidityEvent(
                time=high_touches[-1].time,
                fromTime=high_touches[0].time,
                price=recent_high,
                label="Buy-Side Pool",
                direction="bearish",
                kind="liquidity_pool",
                touches=len(high_touches),
            )
        )

    return events


# ─────────────────────────────────────────────────────────────────────────────
# SCORE / SIGNAL SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

def calculate_phase2_scores(
    internal_state: StructureState,
    swing_state: StructureState,
    smc_events: List[SMCEvent],
    zones: List[SmcZone],
    liquidity_events: List[LiquidityEvent],
    candles: List[Candle],
) -> Dict[str, Any]:
    latest_event = smc_events[-1] if smc_events else None
    latest_close = candles[-1].close if candles else 0.0

    bull_score = 50
    bear_score = 50

    if swing_state.bias == "bullish":
        bull_score += 18
        bear_score -= 18
    elif swing_state.bias == "bearish":
        bull_score -= 18
        bear_score += 18

    if internal_state.bias == "bullish":
        bull_score += 10
        bear_score -= 10
    elif internal_state.bias == "bearish":
        bull_score -= 10
        bear_score += 10

    if latest_event is not None:
        if latest_event.direction == "bullish":
            bull_score += 8
            bear_score -= 8
        elif latest_event.direction == "bearish":
            bull_score -= 8
            bear_score += 8

    # Zone confluence.
    for zone in zones[-12:]:
        inside_zone = zone.bottom <= latest_close <= zone.top

        if not inside_zone:
            continue

        if zone.direction == "bullish":
            bull_score += 5
        elif zone.direction == "bearish":
            bear_score += 5

    # Liquidity confluence.
    for event in liquidity_events[-10:]:
        if event.direction == "bullish":
            bull_score += 3
        elif event.direction == "bearish":
            bear_score += 3

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
        "activeZones": len(zones),
        "activeLiquidityEvents": len(liquidity_events),
    }


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC ENGINE ENTRY
# ─────────────────────────────────────────────────────────────────────────────

def run_phase1_engine(
    raw_candles: List[Any],
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Function name remains run_phase1_engine so api/main.py does not need a change.
    The response phase now reports phase_2_python_zones.
    """

    cfg = {**DEFAULT_ENGINE_CONFIG, **(config or {})}

    candles = normalize_candles(raw_candles)
    ha_candles = calculate_heikin_ashi(candles)
    atr_values = calculate_atr(candles, 200)

    internal_highs, internal_lows = detect_pivots(candles, int(cfg["internal_pivot_len"]))
    swing_highs, swing_lows = detect_pivots(candles, int(cfg["swing_pivot_len"]))

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

    swing_point_events = build_swing_point_events(swing_highs, swing_lows, max_events=60)

    smc_events: List[SMCEvent] = []

    if cfg["show_internal_structure"]:
        smc_events.extend(internal_events)

    if cfg["show_swing_structure"]:
        smc_events.extend(swing_events)
        smc_events.extend(swing_point_events)

    smc_events.sort(key=lambda event: event.toIndex)

    if len(smc_events) > int(cfg["max_events"]):
        smc_events = smc_events[-int(cfg["max_events"]):]

    zones: List[SmcZone] = []

    use_atr_filter = str(cfg["order_block_filter"]).lower() == "atr"
    mitigation = str(cfg["order_block_mitigation"])

    if cfg["show_internal_order_blocks"]:
        internal_obs = build_order_blocks(
            candles,
            internal_events,
            "internal",
            int(cfg["internal_order_blocks_size"]),
            use_atr_filter,
            atr_values,
        )
        zones.extend(filter_mitigated_order_blocks(candles, internal_obs, mitigation))

    if cfg["show_swing_order_blocks"]:
        swing_obs = build_order_blocks(
            candles,
            swing_events,
            "swing",
            int(cfg["swing_order_blocks_size"]),
            use_atr_filter,
            atr_values,
        )
        zones.extend(filter_mitigated_order_blocks(candles, swing_obs, mitigation))

    if cfg["show_fair_value_gaps"]:
        zones.extend(
            detect_fair_value_gaps(
                candles,
                max_fvgs=int(cfg["max_fair_value_gaps"]),
                auto_threshold=bool(cfg["fair_value_gaps_auto_threshold"]),
            )
        )

    if cfg["show_premium_discount_zones"]:
        zones.extend(build_premium_discount_zones(candles, swing_highs, swing_lows))

    if len(zones) > int(cfg["max_zones"]):
        zones = zones[-int(cfg["max_zones"]):]

    liquidity_events: List[LiquidityEvent] = []

    if cfg["show_equal_highs_lows"]:
        equal_internal = detect_equal_highs_lows(
            internal_highs,
            internal_lows,
            atr_values,
            float(cfg["equal_highs_lows_threshold"]),
            max_events=60,
        )

        equal_swing = detect_equal_highs_lows(
            swing_highs,
            swing_lows,
            atr_values,
            float(cfg["equal_highs_lows_threshold"]),
            max_events=40,
        )

        liquidity_events.extend(equal_internal)
        liquidity_events.extend(equal_swing)

    if cfg["show_internal_sweeps"] or cfg["show_swing_sweeps"]:
        liquidity_events.extend(
            detect_liquidity_sweeps(
                candles,
                liquidity_events,
                atr_values,
                cfg,
                max_events=80,
            )
        )

    if cfg["show_liquidity_pools"]:
        liquidity_events.extend(
            detect_liquidity_pools(
                candles,
                atr_values,
                int(cfg["liquidity_lookback"]),
                float(cfg["liquidity_cluster_threshold_atr"]),
            )
        )

    # Keep chronological-ish order and cap.
    liquidity_events.sort(key=lambda event: str(event.time))

    if len(liquidity_events) > int(cfg["max_liquidity_events"]):
        liquidity_events = liquidity_events[-int(cfg["max_liquidity_events"]):]

    scores = calculate_phase2_scores(
        internal_state,
        swing_state,
        smc_events,
        zones,
        liquidity_events,
        candles,
    )

    return {
        "engine": "python_smc_alpha_ghost",
        "phase": "phase_2_python_zones",
        "candles": [asdict(candle) for candle in candles],
        "heikinAshiCandles": [asdict(candle) for candle in ha_candles],

        # Dashboard chart overlays:
        "smcEvents": [asdict(event) for event in smc_events],
        "zones": [asdict(zone) for zone in zones],
        "liquidityEvents": [asdict(event) for event in liquidity_events],

        # AlphaX/Ghost come next.
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


if __name__ == "__main__":
    sample = [
        {
            "time": i,
            "open": 100 + i * 0.1,
            "high": 101 + i * 0.1,
            "low": 99 + i * 0.1,
            "close": 100.5 + i * 0.1,
            "volume": 1000,
            "symbol": "TEST",
            "timeframe": "1m",
        }
        for i in range(300)
    ]

    result = run_phase1_engine(sample)
    print(
        {
            "phase": result["phase"],
            "smcEvents": len(result["smcEvents"]),
            "zones": len(result["zones"]),
            "liquidityEvents": len(result["liquidityEvents"]),
            "signal": result["signal"],
        }
    )
