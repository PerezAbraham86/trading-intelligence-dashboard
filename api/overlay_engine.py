from __future__ import annotations

"""
api/overlay_engine.py

Purpose:
- Recreate TradingView-style SMC + AlphaX DLM visual overlay data directly
  from raw OHLCV candles on the Python dashboard backend.
- No TradingView webhook overlay dependency.
- TradingView/Pine is only the visual reference.

Dashboard rule:
Raw OHLCV candles = source of truth
Python backend = calculates overlays
React dashboard = renders overlays
TradingView = visual reference only

This engine returns chart-ready overlay JSON:

{
    "smcEvents": [...],
    "zones": [...],
    "liquidityEvents": [...],
    "dlmLevels": [...],
    "liquidityProfileBins": [...],
    "summary": {...}
}

Main visuals supported:
- Internal / swing BOS
- Internal / swing CHoCH
- Internal / swing order blocks
- Premium / Equilibrium / Discount
- AlphaX DLM profile bins
- AlphaX POC
- DLM buy liquidity level
- DLM sell liquidity level
"""

from dataclasses import dataclass
from math import floor, isfinite
from typing import Any, Literal, Optional


Direction = Literal["bullish", "bearish", "neutral"]
ZoneKind = Literal[
    "internal_ob",
    "swing_ob",
    "fvg",
    "premium",
    "equilibrium",
    "discount",
]
EventScope = Literal["internal", "swing"]


# ─────────────────────────────────────────────────────────────────────────────
# Data models
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Candle:
    time: int | float | str
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


@dataclass
class Pivot:
    price: float
    time: int | float | str
    index: int
    kind: Literal["high", "low"]
    crossed: bool = False


@dataclass
class OrderBlock:
    start_time: int | float | str
    end_time: int | float | str
    high: float
    low: float
    direction: Direction
    kind: Literal["internal_ob", "swing_ob"]


@dataclass
class StructureState:
    last_high: Optional[Pivot] = None
    last_low: Optional[Pivot] = None
    trend: Direction = "neutral"


# ─────────────────────────────────────────────────────────────────────────────
# Basic helpers
# ─────────────────────────────────────────────────────────────────────────────


def _num(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
        return parsed if isfinite(parsed) else fallback
    except (TypeError, ValueError):
        return fallback


def _is_valid_candle(candle: Any) -> bool:
    if isinstance(candle, Candle):
        return all(
            isfinite(value)
            for value in [candle.open, candle.high, candle.low, candle.close]
        )

    if not isinstance(candle, dict):
        return False

    return all(
        key in candle and isfinite(_num(candle.get(key), float("nan")))
        for key in ["open", "high", "low", "close"]
    )


def normalize_candles(raw_candles: list[dict[str, Any] | Candle]) -> list[Candle]:
    """
    Accepts backend candle dictionaries or Candle objects.

    Supported time keys:
    - time
    - timestamp
    - t
    """

    candles: list[Candle] = []

    for item in raw_candles or []:
        if isinstance(item, Candle):
            if _is_valid_candle(item):
                candles.append(item)
            continue

        if not _is_valid_candle(item):
            continue

        time_value = item.get("time", item.get("timestamp", item.get("t")))

        if time_value is None:
            continue

        candles.append(
            Candle(
                time=time_value,
                open=_num(item.get("open")),
                high=_num(item.get("high")),
                low=_num(item.get("low")),
                close=_num(item.get("close")),
                volume=_num(item.get("volume", item.get("v", 0.0))),
            )
        )

    return candles


def _average_true_range(candles: list[Candle], period: int = 200) -> list[float]:
    if not candles:
        return []

    trs: list[float] = []

    for index, candle in enumerate(candles):
        if index == 0:
            trs.append(max(candle.high - candle.low, 0.0))
            continue

        previous_close = candles[index - 1].close

        true_range = max(
            candle.high - candle.low,
            abs(candle.high - previous_close),
            abs(candle.low - previous_close),
            0.0,
        )
        trs.append(true_range)

    atrs: list[float] = []

    for index in range(len(trs)):
        start = max(0, index - period + 1)
        window = trs[start : index + 1]
        atrs.append(sum(window) / max(len(window), 1))

    return atrs


def _rolling_mean(values: list[float], end_index: int, length: int) -> float:
    start = max(0, end_index - length + 1)
    window = values[start : end_index + 1]
    return sum(window) / max(len(window), 1)


def _format_time(time_value: int | float | str) -> int | float | str:
    """
    Keep the exact chart candle time. React/Lightweight Charts can map this
    if candle times and overlay times use the same source.
    """
    return time_value


def _direction_from_bias(bias: int) -> Direction:
    if bias > 0:
        return "bullish"
    if bias < 0:
        return "bearish"
    return "neutral"


# ─────────────────────────────────────────────────────────────────────────────
# Pivots / structure
# ─────────────────────────────────────────────────────────────────────────────


def _detect_pivots(candles: list[Candle], length: int) -> list[Pivot]:
    """
    Pine-style delayed pivots:
    A pivot high is high[length] greater than highs around it.
    A pivot low is low[length] lower than lows around it.

    The pivot is confirmed `length` bars after the pivot candle.
    """

    if len(candles) < length * 2 + 1:
        return []

    pivots: list[Pivot] = []

    for index in range(length, len(candles) - length):
        center = candles[index]
        left = candles[index - length : index]
        right = candles[index + 1 : index + length + 1]

        if all(center.high > candle.high for candle in left + right):
            pivots.append(
                Pivot(
                    price=center.high,
                    time=center.time,
                    index=index,
                    kind="high",
                )
            )

        if all(center.low < candle.low for candle in left + right):
            pivots.append(
                Pivot(
                    price=center.low,
                    time=center.time,
                    index=index,
                    kind="low",
                )
            )

    pivots.sort(key=lambda pivot: pivot.index)
    return pivots


def _find_latest_pivot_before(
    pivots: list[Pivot],
    kind: Literal["high", "low"],
    index: int,
) -> Optional[Pivot]:
    for pivot in reversed(pivots):
        if pivot.kind == kind and pivot.index < index:
            return Pivot(
                price=pivot.price,
                time=pivot.time,
                index=pivot.index,
                kind=pivot.kind,
                crossed=pivot.crossed,
            )

    return None


def _find_order_block_between(
    candles: list[Candle],
    start_index: int,
    end_index: int,
    direction: Direction,
    kind: Literal["internal_ob", "swing_ob"],
    end_time: int | float | str,
    atrs: Optional[list[float]] = None,
) -> Optional[OrderBlock]:
    """
    TradingView-style order block approximation.

    Correct behavior:
    - Bullish break: select the latest bearish candle before the break.
    - Bearish break: select the latest bullish candle before the break.
    - Extend the block to the latest candle / active chart area, not just the break candle.
    - Avoid tiny doji candles and obvious abnormal spike candles.
    """

    if not candles:
        return None

    start = max(0, min(start_index, end_index))
    end = min(len(candles) - 1, max(start_index, end_index))

    if end < start:
        return None

    selected_index: Optional[int] = None

    # Prefer the closest valid opposite candle before the break.
    for idx in range(end, start - 1, -1):
        candle = candles[idx]
        body = abs(candle.close - candle.open)
        full_range = max(candle.high - candle.low, 1e-12)
        body_pct = body / full_range

        if body_pct < 0.20:
            continue

        if atrs:
            atr = atrs[idx] if idx < len(atrs) else 0.0
            if atr > 0 and full_range > atr * 2.75:
                continue

        is_bearish_candle = candle.close < candle.open
        is_bullish_candle = candle.close > candle.open

        if direction == "bullish" and is_bearish_candle:
            selected_index = idx
            break

        if direction == "bearish" and is_bullish_candle:
            selected_index = idx
            break

    # Fallback to the most extreme candle in the pivot-to-break range.
    if selected_index is None:
        candidate_indexes = list(range(start, end + 1))

        if direction == "bullish":
            selected_index = min(candidate_indexes, key=lambda i: candles[i].low)
        else:
            selected_index = max(candidate_indexes, key=lambda i: candles[i].high)

    selected = candles[selected_index]

    return OrderBlock(
        start_time=selected.time,
        end_time=end_time,
        high=selected.high,
        low=selected.low,
        direction=direction,
        kind=kind,
    )


def _structure_event(
    *,
    candle: Candle,
    pivot: Pivot,
    tag: str,
    direction: Direction,
    scope: EventScope,
) -> dict[str, Any]:
    return {
        "time": _format_time(candle.time),
        "fromTime": _format_time(pivot.time),
        "price": pivot.price,
        "tag": tag,
        "direction": direction,
        "scope": scope,
        "pivotIndex": pivot.index,
    }


def _order_block_zone(order_block: OrderBlock) -> dict[str, Any]:
    if order_block.kind == "internal_ob":
        label = (
            "Internal Bullish OB"
            if order_block.direction == "bullish"
            else "Internal Bearish OB"
        )
    else:
        label = (
            "Swing Bullish OB"
            if order_block.direction == "bullish"
            else "Swing Bearish OB"
        )

    return {
        "startTime": _format_time(order_block.start_time),
        "endTime": _format_time(order_block.end_time),
        "top": order_block.high,
        "bottom": order_block.low,
        "label": label,
        "direction": order_block.direction,
        "kind": order_block.kind,
    }


def _detect_structure_for_scope(
    candles: list[Candle],
    pivots: list[Pivot],
    scope: EventScope,
    max_order_blocks: int,
    atrs: list[float],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], StructureState]:
    events: list[dict[str, Any]] = []
    zones: list[dict[str, Any]] = []
    state = StructureState()

    pivot_high = _find_latest_pivot_before(pivots, "high", 1)
    pivot_low = _find_latest_pivot_before(pivots, "low", 1)

    if pivot_high:
        state.last_high = pivot_high

    if pivot_low:
        state.last_low = pivot_low

    used_high_breaks: set[int] = set()
    used_low_breaks: set[int] = set()

    for index, candle in enumerate(candles):
        confirmed_pivots = [pivot for pivot in pivots if pivot.index == index]

        for pivot in confirmed_pivots:
            if pivot.kind == "high":
                state.last_high = Pivot(
                    price=pivot.price,
                    time=pivot.time,
                    index=pivot.index,
                    kind="high",
                )
            else:
                state.last_low = Pivot(
                    price=pivot.price,
                    time=pivot.time,
                    index=pivot.index,
                    kind="low",
                )

        if state.last_high and state.last_high.index not in used_high_breaks:
            if candle.close > state.last_high.price:
                direction: Direction = "bullish"
                tag = "CHoCH" if state.trend == "bearish" else "BOS"

                events.append(
                    _structure_event(
                        candle=candle,
                        pivot=state.last_high,
                        tag="i" + tag if scope == "internal" else tag,
                        direction=direction,
                        scope=scope,
                    )
                )

                order_block = _find_order_block_between(
                    candles=candles,
                    start_index=state.last_high.index,
                    end_index=index,
                    direction=direction,
                    kind="internal_ob" if scope == "internal" else "swing_ob",
                    end_time=candles[-1].time,
                    atrs=atrs,
                )

                if order_block:
                    zones.append(_order_block_zone(order_block))

                used_high_breaks.add(state.last_high.index)
                state.trend = "bullish"

        if state.last_low and state.last_low.index not in used_low_breaks:
            if candle.close < state.last_low.price:
                direction = "bearish"
                tag = "CHoCH" if state.trend == "bullish" else "BOS"

                events.append(
                    _structure_event(
                        candle=candle,
                        pivot=state.last_low,
                        tag="i" + tag if scope == "internal" else tag,
                        direction=direction,
                        scope=scope,
                    )
                )

                order_block = _find_order_block_between(
                    candles=candles,
                    start_index=state.last_low.index,
                    end_index=index,
                    direction=direction,
                    kind="internal_ob" if scope == "internal" else "swing_ob",
                    end_time=candles[-1].time,
                    atrs=atrs,
                )

                if order_block:
                    zones.append(_order_block_zone(order_block))

                used_low_breaks.add(state.last_low.index)
                state.trend = "bearish"

    return events, zones[-max_order_blocks:], state


# ─────────────────────────────────────────────────────────────────────────────
# Liquidity sweeps / pools
# ─────────────────────────────────────────────────────────────────────────────


def _detect_liquidity_events(
    candles: list[Candle],
    internal_pivots: list[Pivot],
    swing_pivots: list[Pivot],
    atrs: list[float],
    atr_buffer: float = 0.05,
    max_events: int = 20,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []

    def scan_pivots(pivots: list[Pivot], prefix: str) -> None:
        for pivot in pivots:
            for index in range(pivot.index + 1, len(candles)):
                candle = candles[index]
                atr = atrs[index] if index < len(atrs) else 0.0
                buffer = atr * atr_buffer

                if pivot.kind == "low":
                    wick_through = candle.low < pivot.price - buffer
                    close_back = candle.close > pivot.price

                    if wick_through and close_back:
                        events.append(
                            {
                                "time": _format_time(candle.time),
                                "price": pivot.price,
                                "label": "iLS" if prefix == "internal" else "LSL",
                                "direction": "bullish",
                                "kind": f"{prefix}_sweep",
                            }
                        )
                        break

                if pivot.kind == "high":
                    wick_through = candle.high > pivot.price + buffer
                    close_back = candle.close < pivot.price

                    if wick_through and close_back:
                        events.append(
                            {
                                "time": _format_time(candle.time),
                                "price": pivot.price,
                                "label": "iHS" if prefix == "internal" else "LSH",
                                "direction": "bearish",
                                "kind": f"{prefix}_sweep",
                            }
                        )
                        break

    scan_pivots(internal_pivots[-60:], "internal")
    scan_pivots(swing_pivots[-30:], "swing")

    return events[-max_events:]


# ─────────────────────────────────────────────────────────────────────────────
# Premium / equilibrium / discount
# ─────────────────────────────────────────────────────────────────────────────


def _premium_discount_zones(
    candles: list[Candle],
    swing_pivots: list[Pivot],
) -> list[dict[str, Any]]:
    if not candles:
        return []

    latest_high = _find_latest_pivot_before(swing_pivots, "high", len(candles))
    latest_low = _find_latest_pivot_before(swing_pivots, "low", len(candles))

    if not latest_high or not latest_low:
        lookback = candles[-200:] if len(candles) > 200 else candles
        top = max(candle.high for candle in lookback)
        bottom = min(candle.low for candle in lookback)
        start_time = lookback[0].time
    else:
        top = latest_high.price
        bottom = latest_low.price
        start_time = latest_high.time if latest_high.index > latest_low.index else latest_low.time

    if not isfinite(top) or not isfinite(bottom) or top <= bottom:
        return []

    mid = (top + bottom) * 0.5
    last_time = candles[-1].time
    thickness = max((top - bottom) * 0.015, 0.0001)

    return [
        {
            "startTime": _format_time(start_time),
            "endTime": _format_time(last_time),
            "top": top,
            "bottom": mid + thickness,
            "label": "Premium",
            "direction": "bearish",
            "kind": "premium",
        },
        {
            "startTime": _format_time(start_time),
            "endTime": _format_time(last_time),
            "top": mid + thickness,
            "bottom": mid - thickness,
            "label": "Equilibrium",
            "direction": "neutral",
            "kind": "equilibrium",
        },
        {
            "startTime": _format_time(start_time),
            "endTime": _format_time(last_time),
            "top": mid - thickness,
            "bottom": bottom,
            "label": "Discount",
            "direction": "bullish",
            "kind": "discount",
        },
    ]


# ─────────────────────────────────────────────────────────────────────────────
# AlphaX DLM profile
# ─────────────────────────────────────────────────────────────────────────────


def _build_dlm_profile(
    candles: list[Candle],
    lookback: int = 300,
    bins: int = 50,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """
    Python version of the Pine DLM bridge:

    - highest high / lowest low over lookback
    - divide into bins
    - add volume to total, buy, or sell bins by HLC3 location
    - find POC, strongest buy, strongest sell
    - return render-ready profile bins
    """

    if not candles:
        return [], [], {}

    recent = candles[-lookback:] if len(candles) > lookback else candles

    top = max(candle.high for candle in recent)
    bottom = min(candle.low for candle in recent)

    if not isfinite(top) or not isfinite(bottom) or top <= bottom:
        return [], [], {}

    bin_count = max(10, int(bins))
    step = (top - bottom) / bin_count

    total_bins = [0.0 for _ in range(bin_count)]
    buy_bins = [0.0 for _ in range(bin_count)]
    sell_bins = [0.0 for _ in range(bin_count)]

    for candle in recent:
        hlc3 = (candle.high + candle.low + candle.close) / 3.0
        raw_index = int(floor((hlc3 - bottom) / step))
        idx = max(0, min(bin_count - 1, raw_index))
        volume = max(candle.volume, 0.0)

        if volume == 0:
            volume = 1.0

        total_bins[idx] += volume

        if candle.close >= candle.open:
            buy_bins[idx] += volume
        else:
            sell_bins[idx] += volume

    max_total = max(total_bins) if total_bins else 0.0
    max_buy = max(buy_bins) if buy_bins else 0.0
    max_sell = max(sell_bins) if sell_bins else 0.0

    if max_total <= 0:
        return [], [], {}

    poc_index = total_bins.index(max_total)
    buy_index = buy_bins.index(max_buy) if max_buy > 0 else poc_index
    sell_index = sell_bins.index(max_sell) if max_sell > 0 else poc_index

    def level_for(index: int) -> float:
        return bottom + step * index + step * 0.5

    profile_bins: list[dict[str, Any]] = []

    for idx in range(bin_count):
        total = total_bins[idx]

        if total <= 0:
            continue

        buy_volume = buy_bins[idx]
        sell_volume = sell_bins[idx]
        buy_pct = buy_volume / total * 100.0 if total > 0 else 0.0
        sell_pct = sell_volume / total * 100.0 if total > 0 else 0.0
        width_pct = total / max_total * 100.0

        profile_bins.append(
            {
                "price": level_for(idx),
                "low": bottom + step * idx,
                "high": bottom + step * (idx + 1),
                "volume": total,
                "buyVolume": buy_volume,
                "sellVolume": sell_volume,
                "buyPct": round(buy_pct, 2),
                "sellPct": round(sell_pct, 2),
                "widthPct": round(width_pct, 2),
                "dominantSide": "buy" if buy_volume >= sell_volume else "sell",
                "isPOC": idx == poc_index,
                "isBuyLiquidity": idx == buy_index,
                "isSellLiquidity": idx == sell_index,
            }
        )

    dlm_levels = [
        {
            "label": "AlphaX POC",
            "price": level_for(poc_index),
            "direction": "neutral",
        },
        {
            "label": "DLM Buy Liquidity",
            "price": level_for(buy_index),
            "direction": "bullish",
        },
        {
            "label": "DLM Sell Liquidity",
            "price": level_for(sell_index),
            "direction": "bearish",
        },
    ]

    total_directional = max_buy + max_sell
    bull_pressure = max_buy / total_directional * 100.0 if total_directional > 0 else 50.0
    bear_pressure = max_sell / total_directional * 100.0 if total_directional > 0 else 50.0

    summary = {
        "poc": level_for(poc_index),
        "buyLiquidity": level_for(buy_index),
        "sellLiquidity": level_for(sell_index),
        "bullPressurePct": round(bull_pressure, 2),
        "bearPressurePct": round(bear_pressure, 2),
        "top": top,
        "bottom": bottom,
        "binCount": bin_count,
        "lookback": len(recent),
    }

    return profile_bins, dlm_levels, summary


# ─────────────────────────────────────────────────────────────────────────────
# Main overlay builder
# ─────────────────────────────────────────────────────────────────────────────


def build_overlay_payload(
    raw_candles: list[dict[str, Any] | Candle],
    *,
    internal_pivot_length: int = 5,
    swing_pivot_length: int = 50,
    internal_order_blocks: int = 5,
    swing_order_blocks: int = 5,
    dlm_lookback: int = 300,
    dlm_bins: int = 50,
) -> dict[str, Any]:
    """
    Main public function.

    Call this from api/main.py after loading candles for the active symbol/timeframe.
    """

    candles = normalize_candles(raw_candles)

    if len(candles) < max(internal_pivot_length * 2 + 5, 30):
        return {
            "smcEvents": [],
            "zones": [],
            "liquidityEvents": [],
            "dlmLevels": [],
            "liquidityProfileBins": [],
            "summary": {
                "status": "not_enough_candles",
                "candles": len(candles),
            },
        }

    atrs = _average_true_range(candles, period=200)
    internal_pivots = _detect_pivots(candles, internal_pivot_length)
    swing_pivots = _detect_pivots(candles, swing_pivot_length)

    internal_events, internal_zones, internal_state = _detect_structure_for_scope(
        candles=candles,
        pivots=internal_pivots,
        scope="internal",
        max_order_blocks=internal_order_blocks,
        atrs=atrs,
    )

    swing_events, swing_zones, swing_state = _detect_structure_for_scope(
        candles=candles,
        pivots=swing_pivots,
        scope="swing",
        max_order_blocks=swing_order_blocks,
        atrs=atrs,
    )

    pd_zones = _premium_discount_zones(candles, swing_pivots)

    liquidity_events = _detect_liquidity_events(
        candles=candles,
        internal_pivots=internal_pivots,
        swing_pivots=swing_pivots,
        atrs=atrs,
    )

    liquidity_profile_bins, dlm_levels, dlm_summary = _build_dlm_profile(
        candles=candles,
        lookback=dlm_lookback,
        bins=dlm_bins,
    )

    smc_events = [*internal_events, *swing_events]
    smc_events.sort(key=lambda item: str(item.get("time", "")))

    zones = [*internal_zones, *swing_zones, *pd_zones]

    trend = swing_state.trend if swing_state.trend != "neutral" else internal_state.trend

    return {
        "smcEvents": smc_events[-80:],
        "zones": zones[-30:],
        "liquidityEvents": liquidity_events[-30:],
        "dlmLevels": dlm_levels,
        "liquidityProfileBins": liquidity_profile_bins,
        "summary": {
            "status": "ok",
            "candles": len(candles),
            "trend": trend,
            "internalTrend": internal_state.trend,
            "swingTrend": swing_state.trend,
            "internalPivotCount": len(internal_pivots),
            "swingPivotCount": len(swing_pivots),
            "smcEventCount": len(smc_events),
            "zoneCount": len(zones),
            "liquidityEventCount": len(liquidity_events),
            "dlm": dlm_summary,
        },
    }


# Backwards-compatible alias names for easy imports.
build_chart_overlays = build_overlay_payload
calculate_overlay_payload = build_overlay_payload


if __name__ == "__main__":
    # Minimal smoke test.
    sample: list[dict[str, Any]] = []

    price = 100.0

    for i in range(400):
        drift = 0.15 if i < 180 else -0.12
        open_price = price
        close_price = price + drift + ((i % 7) - 3) * 0.03
        high = max(open_price, close_price) + 0.25
        low = min(open_price, close_price) - 0.25
        volume = 1000 + (i % 20) * 50

        sample.append(
            {
                "time": i,
                "open": open_price,
                "high": high,
                "low": low,
                "close": close_price,
                "volume": volume,
            }
        )

        price = close_price

    payload = build_overlay_payload(sample, swing_pivot_length=20)

    print(
        {
            "smcEvents": len(payload["smcEvents"]),
            "zones": len(payload["zones"]),
            "liquidityProfileBins": len(payload["liquidityProfileBins"]),
            "dlmLevels": payload["dlmLevels"],
            "summary": payload["summary"],
        }
    )
