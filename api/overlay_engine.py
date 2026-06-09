from __future__ import annotations

"""
api/overlay_engine.py

Unified dashboard overlay engine.

Final architecture:
- Raw OHLCV candles are the source of truth.
- Python calculates one unified overlayPayload per candle response.
- React / Lightweight Charts only renders the payload.
- TradingView is only a visual reference, not a dashboard data source.

Returned payload shape:

{
    "lines": [...],                 # BOS / CHoCH / MSS structure lines
    "zones": [...],                 # order blocks + premium/equilibrium/discount
    "markers": [...],               # optional lightweight labels
    "smcEvents": [...],             # raw SMC events for panels/debugging
    "orderBlocks": [...],           # raw order block objects for panels/debugging
    "liquidityProfileBins": [...],  # AlphaX-style DLM profile bars
    "dlmLevels": [...],             # AlphaX POC / buy liquidity / sell liquidity
    "ghostCandles": [...],          # reserved / passthrough placeholder
    "summary": {...}
}

Main rules:
- Candles render from real OHLCV.
- Heikin Ashi remains visual only on frontend.
- Entries/exits/backend validation should use real prices.
"""

from dataclasses import dataclass
from math import floor, isfinite
from typing import Any, Literal, Optional


Direction = Literal["bullish", "bearish", "neutral"]
PivotKind = Literal["high", "low"]
Scope = Literal["internal", "swing"]


# ─────────────────────────────────────────────────────────────────────────────
# Models
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
    kind: PivotKind
    crossed: bool = False


@dataclass
class StructureState:
    last_high: Optional[Pivot] = None
    last_low: Optional[Pivot] = None
    trend: Direction = "neutral"


@dataclass
class OrderBlock:
    id: str
    start_time: int | float | str
    end_time: int | float | str
    start_index: int
    end_index: int
    high: float
    low: float
    direction: Direction
    scope: Scope
    source_event: str
    mitigated: bool = False


# ─────────────────────────────────────────────────────────────────────────────
# Utility helpers
# ─────────────────────────────────────────────────────────────────────────────


def _num(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
        return parsed if isfinite(parsed) else fallback
    except (TypeError, ValueError):
        return fallback


def _time_value(item: dict[str, Any]) -> int | float | str | None:
    return item.get("time", item.get("timestamp", item.get("t")))


def _is_valid_ohlc(item: dict[str, Any]) -> bool:
    return all(
        key in item and isfinite(_num(item.get(key), float("nan")))
        for key in ("open", "high", "low", "close")
    )


def normalize_candles(raw_candles: list[dict[str, Any] | Candle]) -> list[Candle]:
    candles: list[Candle] = []

    for item in raw_candles or []:
        if isinstance(item, Candle):
            if all(isfinite(v) for v in (item.open, item.high, item.low, item.close)):
                candles.append(item)
            continue

        if not isinstance(item, dict):
            continue

        if not _is_valid_ohlc(item):
            continue

        time_value = _time_value(item)
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

    true_ranges: list[float] = []

    for index, candle in enumerate(candles):
        if index == 0:
            true_ranges.append(max(candle.high - candle.low, 0.0))
            continue

        previous_close = candles[index - 1].close
        true_ranges.append(
            max(
                candle.high - candle.low,
                abs(candle.high - previous_close),
                abs(candle.low - previous_close),
                0.0,
            )
        )

    atrs: list[float] = []
    for index in range(len(true_ranges)):
        start = max(0, index - period + 1)
        window = true_ranges[start : index + 1]
        atrs.append(sum(window) / max(len(window), 1))

    return atrs


def _parsed_high_low(candle: Candle, atr: float) -> tuple[float, float]:
    """
    Pine reference:
    highVolatilityBar = (high - low) >= 2 * volatilityMeasure
    parsedHigh = highVolatilityBar ? low : high
    parsedLow  = highVolatilityBar ? high : low

    This helps avoid abnormal spike candles dominating order block selection.
    """
    full_range = candle.high - candle.low
    high_volatility = atr > 0 and full_range >= 2.0 * atr

    if high_volatility:
        return candle.low, candle.high

    return candle.high, candle.low


def _direction_from_bias(value: int) -> Direction:
    if value > 0:
        return "bullish"
    if value < 0:
        return "bearish"
    return "neutral"


def _line_type_from_tag(tag: str) -> str:
    upper = tag.upper()

    if "CHOCH" in upper:
        return "choch"
    if "MSS" in upper:
        return "mss"
    return "bos"


def _safe_round(value: float, decimals: int = 2) -> float:
    if not isfinite(value):
        return 0.0
    return round(value, decimals)


# ─────────────────────────────────────────────────────────────────────────────
# Pivot and structure logic
# ─────────────────────────────────────────────────────────────────────────────


def _detect_pivots(candles: list[Candle], length: int) -> list[Pivot]:
    """
    Pivot detection matching TradingView-style delayed pivots.

    A pivot is confirmed after `length` candles to the right.
    """
    if len(candles) < length * 2 + 1:
        return []

    pivots: list[Pivot] = []

    for index in range(length, len(candles) - length):
        center = candles[index]
        left = candles[index - length : index]
        right = candles[index + 1 : index + length + 1]

        if all(center.high > candle.high for candle in left + right):
            pivots.append(Pivot(center.high, center.time, index, "high"))

        if all(center.low < candle.low for candle in left + right):
            pivots.append(Pivot(center.low, center.time, index, "low"))

    pivots.sort(key=lambda pivot: pivot.index)
    return pivots


def _make_structure_event(
    *,
    candle: Candle,
    pivot: Pivot,
    tag: str,
    direction: Direction,
    scope: Scope,
    break_index: int,
) -> dict[str, Any]:
    price = pivot.price

    return {
        "id": f"{scope}-{tag}-{pivot.index}-{break_index}",
        "time": candle.time,
        "fromTime": pivot.time,
        "price": price,
        "brokenLevel": price,
        "tag": tag,
        "label": tag,
        "direction": direction,
        "scope": scope,
        "index": break_index,
        "breakIndex": break_index,
        "pivotIndex": pivot.index,
        "fromIndex": pivot.index,
    }


def _make_structure_line(event: dict[str, Any]) -> dict[str, Any]:
    tag = str(event.get("tag", event.get("label", "BOS")))
    price = _num(event.get("brokenLevel", event.get("price")), 0.0)

    return {
        "id": f"line-{event.get('id', tag)}",
        "type": _line_type_from_tag(tag),
        "label": tag,
        "price": price,
        "brokenLevel": price,
        "time": event.get("time"),
        "fromTime": event.get("fromTime"),
        "direction": event.get("direction", "neutral"),
        "scope": event.get("scope", "internal" if tag.startswith("i") else "swing"),
        "index": event.get("index", event.get("breakIndex")),
        "breakIndex": event.get("breakIndex", event.get("index")),
        "pivotIndex": event.get("pivotIndex", event.get("fromIndex")),
        "fromIndex": event.get("fromIndex", event.get("pivotIndex")),
    }


def _make_structure_marker(event: dict[str, Any]) -> dict[str, Any]:
    tag = str(event.get("tag", event.get("label", "BOS")))
    price = _num(event.get("brokenLevel", event.get("price")), 0.0)

    return {
        "id": f"marker-{event.get('id', tag)}",
        "time": event.get("time"),
        "price": price,
        "label": tag,
        "direction": event.get("direction", "neutral"),
        "type": "CHoCH" if "CHOCH" in tag.upper() else "MSS" if "MSS" in tag.upper() else "BOS",
        "index": event.get("index", event.get("breakIndex")),
        "breakIndex": event.get("breakIndex", event.get("index")),
        "pivotIndex": event.get("pivotIndex", event.get("fromIndex")),
        "fromIndex": event.get("fromIndex", event.get("pivotIndex")),
        "fromTime": event.get("fromTime"),
        "scope": event.get("scope", "internal" if tag.startswith("i") else "swing"),
    }


def _order_block_from_range(
    *,
    candles: list[Candle],
    atrs: list[float],
    pivot_index: int,
    break_index: int,
    direction: Direction,
    scope: Scope,
    source_event: str,
    end_index: int,
) -> Optional[OrderBlock]:
    """
    Pine-style order block selection.

    Reference behavior:
    - Bullish break: select the lowest parsed low between pivot and break.
    - Bearish break: select the highest parsed high between pivot and break.
    - OB starts at selected candle time and extends to latest candle.
    """
    if not candles:
        return None

    start = max(0, min(pivot_index, break_index))
    end = max(0, min(max(pivot_index, break_index), len(candles) - 1))

    if end < start:
        return None

    selected_index: Optional[int] = None

    if direction == "bullish":
        best_value = float("inf")

        for index in range(start, end + 1):
            atr = atrs[index] if index < len(atrs) else 0.0
            _, parsed_low = _parsed_high_low(candles[index], atr)

            if parsed_low < best_value:
                best_value = parsed_low
                selected_index = index

    else:
        best_value = -float("inf")

        for index in range(start, end + 1):
            atr = atrs[index] if index < len(atrs) else 0.0
            parsed_high, _ = _parsed_high_low(candles[index], atr)

            if parsed_high > best_value:
                best_value = parsed_high
                selected_index = index

    if selected_index is None:
        return None

    selected = candles[selected_index]

    return OrderBlock(
        id=f"{scope}-ob-{direction}-{selected_index}-{break_index}",
        start_time=selected.time,
        end_time=candles[end_index].time,
        start_index=selected_index,
        end_index=end_index,
        high=selected.high,
        low=selected.low,
        direction=direction,
        scope=scope,
        source_event=source_event,
    )


def _is_order_block_mitigated(
    block: OrderBlock,
    candles: list[Candle],
    order_block_mitigation: Literal["High/Low", "Close"] = "High/Low",
) -> bool:
    """
    Pine reference:
    bearishOrderBlockMitigationSource = close or high
    bullishOrderBlockMitigationSource = close or low

    Bearish OB is mitigated when price trades above block high.
    Bullish OB is mitigated when price trades below block low.
    """
    if block.start_index >= len(candles) - 1:
        return False

    for candle in candles[block.start_index + 1 :]:
        bearish_source = candle.close if order_block_mitigation == "Close" else candle.high
        bullish_source = candle.close if order_block_mitigation == "Close" else candle.low

        if block.direction == "bearish" and bearish_source > block.high:
            return True

        if block.direction == "bullish" and bullish_source < block.low:
            return True

    return False


def _order_block_to_zone(block: OrderBlock) -> dict[str, Any]:
    scope_label = "Internal" if block.scope == "internal" else "Swing"
    direction_label = "Bullish" if block.direction == "bullish" else "Bearish"

    return {
        "id": block.id,
        "type": "orderBlock",
        "kind": f"{block.scope}_ob",
        "label": f"{direction_label} OB",
        "fullLabel": f"{scope_label} {direction_label} OB",
        "direction": block.direction,
        "sourceEvent": block.source_event,
        "startTime": block.start_time,
        "endTime": block.end_time,
        "startIndex": block.start_index,
        "endIndex": block.end_index,
        "high": block.high,
        "low": block.low,
        "top": block.high,
        "bottom": block.low,
    }


def _detect_structure_and_order_blocks(
    *,
    candles: list[Candle],
    pivots: list[Pivot],
    scope: Scope,
    atrs: list[float],
    max_order_blocks: int,
    include_mitigated_blocks: bool,
) -> tuple[list[dict[str, Any]], list[OrderBlock], StructureState]:
    events: list[dict[str, Any]] = []
    order_blocks: list[OrderBlock] = []
    state = StructureState()

    used_high_breaks: set[int] = set()
    used_low_breaks: set[int] = set()
    pivots_by_index: dict[int, list[Pivot]] = {}

    for pivot in pivots:
        pivots_by_index.setdefault(pivot.index, []).append(pivot)

    for index, candle in enumerate(candles):
        for pivot in pivots_by_index.get(index, []):
            if pivot.kind == "high":
                state.last_high = Pivot(pivot.price, pivot.time, pivot.index, pivot.kind)
            else:
                state.last_low = Pivot(pivot.price, pivot.time, pivot.index, pivot.kind)

        if state.last_high and state.last_high.index not in used_high_breaks:
            if candle.close > state.last_high.price:
                direction: Direction = "bullish"
                tag = "CHoCH" if state.trend == "bearish" else "BOS"
                tag = f"i{tag}" if scope == "internal" else tag

                event = _make_structure_event(
                    candle=candle,
                    pivot=state.last_high,
                    tag=tag,
                    direction=direction,
                    scope=scope,
                    break_index=index,
                )
                events.append(event)

                block = _order_block_from_range(
                    candles=candles,
                    atrs=atrs,
                    pivot_index=state.last_high.index,
                    break_index=index,
                    direction=direction,
                    scope=scope,
                    source_event=tag,
                    end_index=len(candles) - 1,
                )

                if block:
                    block.mitigated = _is_order_block_mitigated(block, candles)
                    if include_mitigated_blocks or not block.mitigated:
                        order_blocks.append(block)

                used_high_breaks.add(state.last_high.index)
                state.trend = "bullish"

        if state.last_low and state.last_low.index not in used_low_breaks:
            if candle.close < state.last_low.price:
                direction = "bearish"
                tag = "CHoCH" if state.trend == "bullish" else "BOS"
                tag = f"i{tag}" if scope == "internal" else tag

                event = _make_structure_event(
                    candle=candle,
                    pivot=state.last_low,
                    tag=tag,
                    direction=direction,
                    scope=scope,
                    break_index=index,
                )
                events.append(event)

                block = _order_block_from_range(
                    candles=candles,
                    atrs=atrs,
                    pivot_index=state.last_low.index,
                    break_index=index,
                    direction=direction,
                    scope=scope,
                    source_event=tag,
                    end_index=len(candles) - 1,
                )

                if block:
                    block.mitigated = _is_order_block_mitigated(block, candles)
                    if include_mitigated_blocks or not block.mitigated:
                        order_blocks.append(block)

                used_low_breaks.add(state.last_low.index)
                state.trend = "bearish"

    return events, order_blocks[-max_order_blocks:], state


# ─────────────────────────────────────────────────────────────────────────────
# Premium / equilibrium / discount zones
# ─────────────────────────────────────────────────────────────────────────────


def _latest_swing_range(candles: list[Candle], swing_pivots: list[Pivot]) -> tuple[float, float, int, int | float | str]:
    if len(candles) == 0:
        return 0.0, 0.0, 0, ""

    latest_high: Optional[Pivot] = None
    latest_low: Optional[Pivot] = None

    for pivot in reversed(swing_pivots):
        if not latest_high and pivot.kind == "high":
            latest_high = pivot
        if not latest_low and pivot.kind == "low":
            latest_low = pivot
        if latest_high and latest_low:
            break

    if latest_high and latest_low:
        top = max(latest_high.price, latest_low.price)
        bottom = min(latest_high.price, latest_low.price)
        start_index = min(latest_high.index, latest_low.index)
        start_time = candles[start_index].time
        return top, bottom, start_index, start_time

    lookback_count = min(len(candles), 200)
    recent = candles[-lookback_count:]
    top = max(candle.high for candle in recent)
    bottom = min(candle.low for candle in recent)
    start_index = len(candles) - lookback_count
    start_time = candles[start_index].time
    return top, bottom, start_index, start_time


def _premium_discount_zones(candles: list[Candle], swing_pivots: list[Pivot]) -> list[dict[str, Any]]:
    if not candles:
        return []

    top, bottom, start_index, start_time = _latest_swing_range(candles, swing_pivots)

    if not isfinite(top) or not isfinite(bottom) or top <= bottom:
        return []

    # Pine-style narrow bands.
    premium_bottom = 0.95 * top + 0.05 * bottom
    equilibrium_top = 0.525 * top + 0.475 * bottom
    equilibrium_bottom = 0.525 * bottom + 0.475 * top
    discount_top = 0.95 * bottom + 0.05 * top

    end_index = len(candles) - 1
    end_time = candles[end_index].time

    return [
        {
            "id": "pd-premium",
            "type": "premium",
            "kind": "premium",
            "label": "Premium",
            "direction": "bearish",
            "startTime": start_time,
            "endTime": end_time,
            "startIndex": start_index,
            "endIndex": end_index,
            "high": top,
            "low": premium_bottom,
            "top": top,
            "bottom": premium_bottom,
        },
        {
            "id": "pd-equilibrium",
            "type": "equilibrium",
            "kind": "equilibrium",
            "label": "Equilibrium",
            "direction": "neutral",
            "startTime": start_time,
            "endTime": end_time,
            "startIndex": start_index,
            "endIndex": end_index,
            "high": max(equilibrium_top, equilibrium_bottom),
            "low": min(equilibrium_top, equilibrium_bottom),
            "top": max(equilibrium_top, equilibrium_bottom),
            "bottom": min(equilibrium_top, equilibrium_bottom),
        },
        {
            "id": "pd-discount",
            "type": "discount",
            "kind": "discount",
            "label": "Discount",
            "direction": "bullish",
            "startTime": start_time,
            "endTime": end_time,
            "startIndex": start_index,
            "endIndex": end_index,
            "high": discount_top,
            "low": bottom,
            "top": discount_top,
            "bottom": bottom,
        },
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Liquidity sweeps
# ─────────────────────────────────────────────────────────────────────────────


def _detect_liquidity_sweeps(
    candles: list[Candle],
    pivots: list[Pivot],
    atrs: list[float],
    scope: Scope,
    max_events: int = 500,
    atr_buffer: float = 0.05,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []

    for pivot in pivots[-500:]:
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
                            "id": f"{scope}-sweep-low-{pivot.index}-{index}",
                            "time": candle.time,
                            "price": pivot.price,
                            "label": "iLS" if scope == "internal" else "LSL",
                            "direction": "bullish",
                            "kind": f"{scope}_sweep",
                            "index": index,
                            "pivotIndex": pivot.index,
                        }
                    )
                    break

            if pivot.kind == "high":
                wick_through = candle.high > pivot.price + buffer
                close_back = candle.close < pivot.price

                if wick_through and close_back:
                    events.append(
                        {
                            "id": f"{scope}-sweep-high-{pivot.index}-{index}",
                            "time": candle.time,
                            "price": pivot.price,
                            "label": "iHS" if scope == "internal" else "LSH",
                            "direction": "bearish",
                            "kind": f"{scope}_sweep",
                            "index": index,
                            "pivotIndex": pivot.index,
                        }
                    )
                    break

    return events[-max_events:]


# ─────────────────────────────────────────────────────────────────────────────
# AlphaX-style DLM profile
# ─────────────────────────────────────────────────────────────────────────────


def _build_dlm_profile(
    candles: list[Candle],
    lookback: int = 300,
    bins: int = 50,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    if not candles:
        return [], [], {}

    recent = candles[-lookback:] if len(candles) > lookback else candles

    top = max(candle.high for candle in recent)
    bottom = min(candle.low for candle in recent)

    if not isfinite(top) or not isfinite(bottom) or top <= bottom:
        return [], [], {}

    bin_count = max(10, int(bins))
    step = max((top - bottom) / bin_count, 1e-12)

    total_bins = [0.0 for _ in range(bin_count)]
    buy_bins = [0.0 for _ in range(bin_count)]
    sell_bins = [0.0 for _ in range(bin_count)]

    for candle in recent:
        hlc3 = (candle.high + candle.low + candle.close) / 3.0
        raw_index = int(floor((hlc3 - bottom) / step))
        index = max(0, min(bin_count - 1, raw_index))
        volume = max(candle.volume, 0.0) or 1.0

        total_bins[index] += volume

        if candle.close >= candle.open:
            buy_bins[index] += volume
        else:
            sell_bins[index] += volume

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

    for index in range(bin_count):
        total = total_bins[index]

        if total <= 0:
            continue

        buy_volume = buy_bins[index]
        sell_volume = sell_bins[index]
        buy_pct = buy_volume / total * 100.0
        sell_pct = sell_volume / total * 100.0
        width_pct = total / max_total * 100.0

        profile_bins.append(
            {
                "id": f"dlm-bin-{index}",
                "price": level_for(index),
                "low": bottom + step * index,
                "high": bottom + step * (index + 1),
                "volume": total,
                "buyVolume": buy_volume,
                "sellVolume": sell_volume,
                "buyPct": _safe_round(buy_pct, 2),
                "sellPct": _safe_round(sell_pct, 2),
                "widthPct": _safe_round(width_pct, 2),
                "dominantSide": "buy" if buy_volume >= sell_volume else "sell",
                "isPOC": index == poc_index,
                "isBuyLiquidity": index == buy_index,
                "isSellLiquidity": index == sell_index,
            }
        )

    dlm_levels = [
        {
            "id": "dlm-poc",
            "label": "AlphaX POC",
            "price": level_for(poc_index),
            "direction": "neutral",
            "kind": "poc",
        },
        {
            "id": "dlm-buy-liquidity",
            "label": "DLM Buy Liquidity",
            "price": level_for(buy_index),
            "direction": "bullish",
            "kind": "buy_liquidity",
        },
        {
            "id": "dlm-sell-liquidity",
            "label": "DLM Sell Liquidity",
            "price": level_for(sell_index),
            "direction": "bearish",
            "kind": "sell_liquidity",
        },
    ]

    total_directional = max_buy + max_sell
    bull_pressure = max_buy / total_directional * 100.0 if total_directional > 0 else 50.0
    bear_pressure = max_sell / total_directional * 100.0 if total_directional > 0 else 50.0

    summary = {
        "poc": level_for(poc_index),
        "buyLiquidity": level_for(buy_index),
        "sellLiquidity": level_for(sell_index),
        "bullPressurePct": _safe_round(bull_pressure, 2),
        "bearPressurePct": _safe_round(bear_pressure, 2),
        "top": top,
        "bottom": bottom,
        "binCount": bin_count,
        "lookback": len(recent),
    }

    return profile_bins, dlm_levels, summary


# ─────────────────────────────────────────────────────────────────────────────
# Ghost candle placeholder / passthrough
# ─────────────────────────────────────────────────────────────────────────────


def _normalize_ghost_candles(raw_ghost_candles: Optional[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    if not raw_ghost_candles:
        return []

    normalized: list[dict[str, Any]] = []

    for index, ghost in enumerate(raw_ghost_candles):
        if not isinstance(ghost, dict):
            continue

        normalized.append(
            {
                "id": ghost.get("id", f"ghost-{index + 1}"),
                "time": ghost.get("time"),
                "open": _num(ghost.get("open")),
                "high": _num(ghost.get("high")),
                "low": _num(ghost.get("low")),
                "close": _num(ghost.get("close")),
                "direction": ghost.get("direction", "neutral"),
                "confidence": _num(ghost.get("confidence", 0.0)),
            }
        )

    return normalized



# ─────────────────────────────────────────────────────────────────────────────
# EQH / EQL, FVG, Displacement, Inducement
# ─────────────────────────────────────────────────────────────────────────────


def _detect_equal_highs_lows(
    candles: list[Candle],
    *,
    length: int = 3,
    threshold_atr: float = 0.10,
    atrs: list[float],
    max_events: int = 500,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Pine-style EQH/EQL approximation.

    Pine logic:
    - Uses an equal pivot length.
    - Compares the new pivot against the previous pivot.
    - If distance < threshold * ATR, draw a dotted line and label EQH/EQL.

    Dashboard output:
    - line objects draw dotted horizontal equal high/low levels.
    - marker objects draw EQH/EQL labels.
    """
    equal_pivots = _detect_pivots(candles, length)
    last_high: Optional[Pivot] = None
    last_low: Optional[Pivot] = None
    lines: list[dict[str, Any]] = []
    markers: list[dict[str, Any]] = []

    for pivot in equal_pivots:
        atr = atrs[pivot.index] if pivot.index < len(atrs) else 0.0
        tolerance = max(atr * threshold_atr, 0.0)

        if pivot.kind == "high":
            if last_high and abs(last_high.price - pivot.price) <= tolerance:
                price = (last_high.price + pivot.price) * 0.5
                event_id = f"eqh-{last_high.index}-{pivot.index}"
                lines.append(
                    {
                        "id": event_id,
                        "type": "eqh",
                        "label": "EQH",
                        "price": price,
                        "brokenLevel": price,
                        "fromTime": last_high.time,
                        "time": pivot.time,
                        "fromIndex": last_high.index,
                        "pivotIndex": last_high.index,
                        "breakIndex": pivot.index,
                        "index": pivot.index,
                        "direction": "bearish",
                        "scope": "equal",
                    }
                )
                markers.append(
                    {
                        "id": f"marker-{event_id}",
                        "type": "EQH",
                        "label": "EQH",
                        "time": pivot.time,
                        "price": price,
                        "direction": "bearish",
                        "index": pivot.index,
                        "fromIndex": last_high.index,
                    }
                )

            last_high = pivot

        if pivot.kind == "low":
            if last_low and abs(last_low.price - pivot.price) <= tolerance:
                price = (last_low.price + pivot.price) * 0.5
                event_id = f"eql-{last_low.index}-{pivot.index}"
                lines.append(
                    {
                        "id": event_id,
                        "type": "eql",
                        "label": "EQL",
                        "price": price,
                        "brokenLevel": price,
                        "fromTime": last_low.time,
                        "time": pivot.time,
                        "fromIndex": last_low.index,
                        "pivotIndex": last_low.index,
                        "breakIndex": pivot.index,
                        "index": pivot.index,
                        "direction": "bullish",
                        "scope": "equal",
                    }
                )
                markers.append(
                    {
                        "id": f"marker-{event_id}",
                        "type": "EQL",
                        "label": "EQL",
                        "time": pivot.time,
                        "price": price,
                        "direction": "bullish",
                        "index": pivot.index,
                        "fromIndex": last_low.index,
                    }
                )

            last_low = pivot

    return lines[-max_events:], markers[-max_events:]


def _detect_fair_value_gaps(
    candles: list[Candle],
    *,
    max_zones: int = 500,
    extend_to_latest: bool = True,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Pine/LuxAlgo-style 3-candle FVG approximation.

    Bullish FVG:
    - low[current] > high[2 bars back]

    Bearish FVG:
    - high[current] < low[2 bars back]

    The zone extends from the middle/confirmation candle area to the latest
    candle, matching the dashboard's extended-box style.
    """
    if len(candles) < 3:
        return [], []

    zones: list[dict[str, Any]] = []
    markers: list[dict[str, Any]] = []
    latest = len(candles) - 1

    for index in range(2, len(candles)):
        current = candles[index]
        two_back = candles[index - 2]

        bullish_gap = current.low > two_back.high
        bearish_gap = current.high < two_back.low

        if bullish_gap:
            top = current.low
            bottom = two_back.high
            if top > bottom:
                zone_id = f"fvg-bullish-{index}"
                zones.append(
                    {
                        "id": zone_id,
                        "type": "imbalance",
                        "kind": "fvg",
                        "label": "Bullish FVG",
                        "direction": "bullish",
                        "startTime": candles[index - 2].time,
                        "endTime": candles[latest].time if extend_to_latest else current.time,
                        "startIndex": index - 2,
                        "endIndex": latest if extend_to_latest else index,
                        "high": top,
                        "low": bottom,
                        "top": top,
                        "bottom": bottom,
                    }
                )
                markers.append(
                    {
                        "id": f"marker-{zone_id}",
                        "type": "FVG",
                        "label": "FVG",
                        "time": current.time,
                        "price": bottom,
                        "direction": "bullish",
                        "index": index,
                    }
                )

        if bearish_gap:
            top = two_back.low
            bottom = current.high
            if top > bottom:
                zone_id = f"fvg-bearish-{index}"
                zones.append(
                    {
                        "id": zone_id,
                        "type": "imbalance",
                        "kind": "fvg",
                        "label": "Bearish FVG",
                        "direction": "bearish",
                        "startTime": candles[index - 2].time,
                        "endTime": candles[latest].time if extend_to_latest else current.time,
                        "startIndex": index - 2,
                        "endIndex": latest if extend_to_latest else index,
                        "high": top,
                        "low": bottom,
                        "top": top,
                        "bottom": bottom,
                    }
                )
                markers.append(
                    {
                        "id": f"marker-{zone_id}",
                        "type": "FVG",
                        "label": "FVG",
                        "time": current.time,
                        "price": top,
                        "direction": "bearish",
                        "index": index,
                    }
                )

    return zones[-max_zones:], markers[-max_zones:]


def _detect_displacement_markers(
    candles: list[Candle],
    atrs: list[float],
    *,
    atr_mult: float = 1.0,
    body_ratio_min: float = 0.60,
    max_markers: int = 500,
) -> list[dict[str, Any]]:
    """
    Pine logic:
    - Bull displacement: close > open, range > ATR * mult, body/range >= min
    - Bear displacement: close < open, range > ATR * mult, body/range >= min
    """
    markers: list[dict[str, Any]] = []

    for index, candle in enumerate(candles):
        atr = atrs[index] if index < len(atrs) else 0.0
        candle_range = max(candle.high - candle.low, 1e-12)
        body = abs(candle.close - candle.open)
        body_ratio = body / candle_range

        if atr <= 0:
            continue

        strong_range = candle_range > atr * atr_mult
        strong_body = body_ratio >= body_ratio_min

        if strong_range and strong_body and candle.close > candle.open:
            markers.append(
                {
                    "id": f"disp-bullish-{index}",
                    "type": "Displacement",
                    "label": "DISP",
                    "time": candle.time,
                    "price": candle.low,
                    "direction": "bullish",
                    "index": index,
                    "bodyRatio": body_ratio,
                    "rangeAtr": candle_range / atr,
                }
            )

        if strong_range and strong_body and candle.close < candle.open:
            markers.append(
                {
                    "id": f"disp-bearish-{index}",
                    "type": "Displacement",
                    "label": "DISP",
                    "time": candle.time,
                    "price": candle.high,
                    "direction": "bearish",
                    "index": index,
                    "bodyRatio": body_ratio,
                    "rangeAtr": candle_range / atr,
                }
            )

    return markers[-max_markers:]


def _liquidity_events_to_markers(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    markers: list[dict[str, Any]] = []

    for event in events:
        markers.append(
            {
                "id": f"marker-{event.get('id', event.get('label', 'sweep'))}",
                "type": "Sweep" if "sweep" in str(event.get("kind", "")).lower() else "Liquidity",
                "label": event.get("label", "Sweep"),
                "time": event.get("time"),
                "price": event.get("price"),
                "direction": event.get("direction", "neutral"),
                "index": event.get("index"),
                "pivotIndex": event.get("pivotIndex"),
                "kind": event.get("kind"),
            }
        )

    return markers


def _detect_inducement_markers(
    candles: list[Candle],
    structure_events: list[dict[str, Any]],
    *,
    lookback: int = 20,
    max_markers: int = 500,
) -> list[dict[str, Any]]:
    """
    First-pass inducement approximation.

    Pine inducement logic is tied to the broader scoring / sweep state.
    For dashboard calculations, mark the last opposing liquidity point before
    a BOS/CHoCH:
    - bullish structure event: lowest low in the previous lookback bars
    - bearish structure event: highest high in the previous lookback bars
    """
    markers: list[dict[str, Any]] = []

    for event in structure_events:
        break_index = int(_num(event.get("breakIndex", event.get("index")), -1))
        direction = str(event.get("direction", "neutral"))

        if break_index <= 1 or break_index >= len(candles):
            continue

        start = max(0, break_index - lookback)
        window = candles[start:break_index]

        if not window:
            continue

        if direction == "bullish":
            local_offset, inducement_candle = min(
                enumerate(window),
                key=lambda pair: pair[1].low,
            )
            inducement_index = start + local_offset
            markers.append(
                {
                    "id": f"ind-bullish-{inducement_index}-{break_index}",
                    "type": "Inducement",
                    "label": "IND",
                    "time": inducement_candle.time,
                    "price": inducement_candle.low,
                    "direction": "bullish",
                    "index": inducement_index,
                    "breakIndex": break_index,
                }
            )

        if direction == "bearish":
            local_offset, inducement_candle = max(
                enumerate(window),
                key=lambda pair: pair[1].high,
            )
            inducement_index = start + local_offset
            markers.append(
                {
                    "id": f"ind-bearish-{inducement_index}-{break_index}",
                    "type": "Inducement",
                    "label": "IND",
                    "time": inducement_candle.time,
                    "price": inducement_candle.high,
                    "direction": "bearish",
                    "index": inducement_index,
                    "breakIndex": break_index,
                }
            )

    return markers[-max_markers:]



# ─────────────────────────────────────────────────────────────────────────────
# Hidden feature influence scoring
# ─────────────────────────────────────────────────────────────────────────────


def _nearest_price_distance(price: float, levels: list[float]) -> float:
    if not levels:
        return float("inf")
    return min(abs(price - level) for level in levels)


def _events_before_index(events: list[dict[str, Any]], index: int, lookback: int) -> list[dict[str, Any]]:
    start = max(0, index - lookback)
    result: list[dict[str, Any]] = []

    for event in events:
        event_index = int(_num(event.get("index", event.get("breakIndex")), -1))
        if start <= event_index <= index:
            result.append(event)

    return result


def _zones_near_price(zones: list[dict[str, Any]], price: float, atr: float, atr_mult: float = 0.75) -> list[dict[str, Any]]:
    if atr <= 0:
        return []

    nearby: list[dict[str, Any]] = []
    threshold = atr * atr_mult

    for zone in zones:
        high = _num(zone.get("high", zone.get("top")), 0.0)
        low = _num(zone.get("low", zone.get("bottom")), 0.0)
        top = max(high, low)
        bottom = min(high, low)

        inside = bottom <= price <= top
        near = min(abs(price - top), abs(price - bottom)) <= threshold

        if inside or near:
            nearby.append(zone)

    return nearby


def _pd_location(price: float, pd_zones: list[dict[str, Any]]) -> str:
    for zone in pd_zones:
        label = str(zone.get("label", "")).lower()
        high = _num(zone.get("high", zone.get("top")), 0.0)
        low = _num(zone.get("low", zone.get("bottom")), 0.0)
        top = max(high, low)
        bottom = min(high, low)

        if bottom <= price <= top:
            if "premium" in label:
                return "premium"
            if "discount" in label:
                return "discount"
            if "equilibrium" in label:
                return "equilibrium"

    return "neutral"


def _score_structure_event(
    event: dict[str, Any],
    *,
    candles: list[Candle],
    atrs: list[float],
    equal_lines: list[dict[str, Any]],
    fvg_zones: list[dict[str, Any]],
    liquidity_events: list[dict[str, Any]],
    displacement_markers: list[dict[str, Any]],
    inducement_markers: list[dict[str, Any]],
    pd_zones: list[dict[str, Any]],
) -> dict[str, Any]:
    index = int(_num(event.get("breakIndex", event.get("index")), -1))
    price = _num(event.get("price", event.get("brokenLevel")), 0.0)
    direction = str(event.get("direction", "neutral"))

    atr = atrs[index] if 0 <= index < len(atrs) else 0.0
    lookback = 20

    sweep_before = _events_before_index(liquidity_events, index, lookback)
    displacement_before = _events_before_index(displacement_markers, index, 5)
    inducement_before = _events_before_index(inducement_markers, index, lookback)
    nearby_fvg = _zones_near_price(fvg_zones, price, atr, 0.75)

    equal_levels = [_num(line.get("price"), 0.0) for line in equal_lines]
    liquidity_taken = _nearest_price_distance(price, equal_levels) <= max(atr * 0.35, 1e-12) if atr > 0 else False

    pd = _pd_location(price, pd_zones)
    pd_aligned = (
        (direction == "bullish" and pd in {"discount", "equilibrium"}) or
        (direction == "bearish" and pd in {"premium", "equilibrium"})
    )

    score = 3
    reasons: list[str] = []

    if sweep_before:
        score += 2
        reasons.append("sweep-before-break")
    if displacement_before:
        score += 2
        reasons.append("displacement-confirmed")
    if inducement_before:
        score += 1
        reasons.append("inducement-before-break")
    if nearby_fvg:
        score += 1
        reasons.append("near-fvg")
    if liquidity_taken:
        score += 1
        reasons.append("eqh-eql-liquidity")
    if pd_aligned:
        score += 1
        reasons.append(f"{pd}-aligned")

    quality = max(1, min(10, score))

    return {
        **event,
        "qualityScore": quality,
        "quality": "high" if quality >= 8 else "medium" if quality >= 5 else "low",
        "influence": {
            "hasSweepBefore": bool(sweep_before),
            "hasDisplacement": bool(displacement_before),
            "hasInducement": bool(inducement_before),
            "hasNearbyFvg": bool(nearby_fvg),
            "hasEqhEqlLiquidity": bool(liquidity_taken),
            "pdLocation": pd,
            "pdAligned": pd_aligned,
            "reasons": reasons,
        },
    }


def _score_order_block_zone(
    zone: dict[str, Any],
    *,
    atrs: list[float],
    fvg_zones: list[dict[str, Any]],
    liquidity_events: list[dict[str, Any]],
    displacement_markers: list[dict[str, Any]],
    inducement_markers: list[dict[str, Any]],
    pd_zones: list[dict[str, Any]],
    dlm_levels: list[dict[str, Any]],
) -> dict[str, Any]:
    start_index = int(_num(zone.get("startIndex"), -1))
    end_index = int(_num(zone.get("endIndex"), start_index))
    high = _num(zone.get("high", zone.get("top")), 0.0)
    low = _num(zone.get("low", zone.get("bottom")), 0.0)
    mid = (high + low) * 0.5
    direction = str(zone.get("direction", "neutral"))

    atr = atrs[start_index] if 0 <= start_index < len(atrs) else 0.0
    sweep_near = _events_before_index(liquidity_events, end_index, 30)
    displacement_near = _events_before_index(displacement_markers, end_index, 10)
    inducement_near = _events_before_index(inducement_markers, end_index, 30)
    fvg_near = _zones_near_price(fvg_zones, mid, atr, 0.75)

    pd = _pd_location(mid, pd_zones)
    pd_aligned = (
        (direction == "bullish" and pd in {"discount", "equilibrium"}) or
        (direction == "bearish" and pd in {"premium", "equilibrium"})
    )

    dlm_prices = [_num(level.get("price"), 0.0) for level in dlm_levels]
    dlm_confirmed = _nearest_price_distance(mid, dlm_prices) <= max(atr * 0.75, 1e-12) if atr > 0 else False

    score = 3
    reasons: list[str] = []

    if fvg_near:
        score += 2
        reasons.append("fvg-confluence")
    if sweep_near:
        score += 1
        reasons.append("sweep-context")
    if displacement_near:
        score += 2
        reasons.append("displacement-away")
    if inducement_near:
        score += 1
        reasons.append("inducement-context")
    if pd_aligned:
        score += 1
        reasons.append(f"{pd}-aligned")
    if dlm_confirmed:
        score += 1
        reasons.append("dlm-confirmed")

    quality = max(1, min(10, score))

    return {
        **zone,
        "qualityScore": quality,
        "quality": "high" if quality >= 8 else "medium" if quality >= 5 else "low",
        "influence": {
            "hasFvgConfluence": bool(fvg_near),
            "hasSweepContext": bool(sweep_near),
            "hasDisplacementAway": bool(displacement_near),
            "hasInducementContext": bool(inducement_near),
            "pdLocation": pd,
            "pdAligned": pd_aligned,
            "dlmConfirmed": dlm_confirmed,
            "reasons": reasons,
        },
    }


def _score_pd_zone(
    zone: dict[str, Any],
    *,
    equal_lines: list[dict[str, Any]],
    fvg_zones: list[dict[str, Any]],
    liquidity_events: list[dict[str, Any]],
    displacement_markers: list[dict[str, Any]],
) -> dict[str, Any]:
    high = _num(zone.get("high", zone.get("top")), 0.0)
    low = _num(zone.get("low", zone.get("bottom")), 0.0)
    top = max(high, low)
    bottom = min(high, low)

    def price_in_zone(price: float) -> bool:
        return bottom <= price <= top

    eq_inside = [line for line in equal_lines if price_in_zone(_num(line.get("price"), 0.0))]
    fvg_inside = [
        fvg for fvg in fvg_zones
        if price_in_zone((_num(fvg.get("high", fvg.get("top")), 0.0) + _num(fvg.get("low", fvg.get("bottom")), 0.0)) * 0.5)
    ]
    sweeps_inside = [event for event in liquidity_events if price_in_zone(_num(event.get("price"), 0.0))]
    displacement_inside = [marker for marker in displacement_markers if price_in_zone(_num(marker.get("price"), 0.0))]

    score = 3
    reasons: list[str] = []

    if eq_inside:
        score += 2
        reasons.append("eqh-eql-inside")
    if fvg_inside:
        score += 1
        reasons.append("fvg-inside")
    if sweeps_inside:
        score += 2
        reasons.append("sweep-inside")
    if displacement_inside:
        score += 1
        reasons.append("displacement-inside")

    quality = max(1, min(10, score))

    return {
        **zone,
        "qualityScore": quality,
        "quality": "high" if quality >= 8 else "medium" if quality >= 5 else "low",
        "influence": {
            "eqhEqlCount": len(eq_inside),
            "fvgCount": len(fvg_inside),
            "sweepCount": len(sweeps_inside),
            "displacementCount": len(displacement_inside),
            "reasons": reasons,
        },
    }


def _score_profile_bins(
    bins: list[dict[str, Any]],
    *,
    equal_lines: list[dict[str, Any]],
    liquidity_events: list[dict[str, Any]],
    fvg_zones: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not bins:
        return bins

    scored: list[dict[str, Any]] = []

    for bin_item in bins:
        price = _num(bin_item.get("price"), (_num(bin_item.get("high"), 0.0) + _num(bin_item.get("low"), 0.0)) * 0.5)
        low = _num(bin_item.get("low"), price)
        high = _num(bin_item.get("high"), price)
        height = max(abs(high - low), 1e-12)

        eq_near = [
            line for line in equal_lines
            if abs(_num(line.get("price"), 0.0) - price) <= height * 2
        ]
        sweep_near = [
            event for event in liquidity_events
            if abs(_num(event.get("price"), 0.0) - price) <= height * 2
        ]
        fvg_near = [
            zone for zone in fvg_zones
            if min(
                abs(_num(zone.get("high", zone.get("top")), 0.0) - price),
                abs(_num(zone.get("low", zone.get("bottom")), 0.0) - price),
            ) <= height * 2
        ]

        liquidity_score = 0
        reasons: list[str] = []

        if eq_near:
            liquidity_score += 2
            reasons.append("eqh-eql-cluster")
        if sweep_near:
            liquidity_score += 2
            reasons.append("sweep-tested")
        if fvg_near:
            liquidity_score += 1
            reasons.append("near-fvg")

        scored.append(
            {
                **bin_item,
                "liquidityScore": liquidity_score,
                "influence": {
                    "eqhEqlNear": bool(eq_near),
                    "sweepTested": bool(sweep_near),
                    "nearFvg": bool(fvg_near),
                    "reasons": reasons,
                },
            }
        )

    return scored

# ─────────────────────────────────────────────────────────────────────────────
# Main public builder
# ─────────────────────────────────────────────────────────────────────────────


def build_overlay_payload(
    raw_candles: list[dict[str, Any] | Candle],
    *,
    internal_pivot_length: int = 5,
    swing_pivot_length: int = 50,
    internal_order_blocks: int = 500,
    swing_order_blocks: int = 500,
    include_mitigated_blocks: bool = False,
    dlm_lookback: int = 300,
    dlm_bins: int = 50,
    show_equal_highs_lows: bool = True,
    equal_pivot_length: int = 3,
    equal_threshold_atr: float = 0.10,
    show_fair_value_gaps: bool = True,
    show_sweeps: bool = True,
    show_displacement: bool = True,
    displacement_atr_mult: float = 1.0,
    displacement_body_ratio: float = 0.60,
    show_inducement: bool = True,
    inducement_lookback: int = 20,
    ghost_candles: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    candles = normalize_candles(raw_candles)

    if len(candles) < max(internal_pivot_length * 2 + 5, 30):
        return {
            "lines": [],
            "zones": [],
            "markers": [],
            "smcEvents": [],
            "orderBlocks": [],
            "liquidityEvents": [],
            "liquidityProfileBins": [],
            "dlmLevels": [],
            "ghostCandles": _normalize_ghost_candles(ghost_candles),
            "summary": {
                "status": "not_enough_candles",
                "candles": len(candles),
            },
        }

    atrs = _average_true_range(candles, period=200)
    internal_pivots = _detect_pivots(candles, internal_pivot_length)
    swing_pivots = _detect_pivots(candles, swing_pivot_length)

    internal_events, internal_blocks, internal_state = _detect_structure_and_order_blocks(
        candles=candles,
        pivots=internal_pivots,
        scope="internal",
        atrs=atrs,
        max_order_blocks=internal_order_blocks,
        include_mitigated_blocks=include_mitigated_blocks,
    )

    swing_events, swing_blocks, swing_state = _detect_structure_and_order_blocks(
        candles=candles,
        pivots=swing_pivots,
        scope="swing",
        atrs=atrs,
        max_order_blocks=swing_order_blocks,
        include_mitigated_blocks=include_mitigated_blocks,
    )

    smc_events = [*internal_events, *swing_events]
    smc_events.sort(key=lambda event: int(event.get("breakIndex", event.get("index", 0))))

    order_blocks = [*internal_blocks, *swing_blocks]
    order_blocks.sort(key=lambda block: block.start_index)

    order_block_zones = [_order_block_to_zone(block) for block in order_blocks]
    pd_zones = _premium_discount_zones(candles, swing_pivots)

    liquidity_events = [
        *_detect_liquidity_sweeps(candles, internal_pivots, atrs, "internal"),
        *_detect_liquidity_sweeps(candles, swing_pivots, atrs, "swing"),
    ] if show_sweeps else []

    equal_lines, equal_markers = _detect_equal_highs_lows(
        candles,
        length=equal_pivot_length,
        threshold_atr=equal_threshold_atr,
        atrs=atrs,
    ) if show_equal_highs_lows else ([], [])

    fvg_zones, fvg_markers = _detect_fair_value_gaps(
        candles,
        max_zones=500,
        extend_to_latest=True,
    ) if show_fair_value_gaps else ([], [])

    displacement_markers = _detect_displacement_markers(
        candles,
        atrs,
        atr_mult=displacement_atr_mult,
        body_ratio_min=displacement_body_ratio,
    ) if show_displacement else []

    inducement_markers = _detect_inducement_markers(
        candles,
        smc_events,
        lookback=inducement_lookback,
    ) if show_inducement else []

    sweep_markers = _liquidity_events_to_markers(liquidity_events)

    liquidity_profile_bins, dlm_levels, dlm_summary = _build_dlm_profile(
        candles=candles,
        lookback=dlm_lookback,
        bins=dlm_bins,
    )

    # Influence layer:
    # hidden calculations make existing visible objects smarter,
    # without creating extra visible labels or boxes.
    scored_smc_events = [
        _score_structure_event(
            event,
            candles=candles,
            atrs=atrs,
            equal_lines=equal_lines,
            fvg_zones=fvg_zones,
            liquidity_events=liquidity_events,
            displacement_markers=displacement_markers,
            inducement_markers=inducement_markers,
            pd_zones=pd_zones,
        )
        for event in smc_events
    ]

    structure_lines = [_make_structure_line(event) for event in scored_smc_events]
    structure_markers = [_make_structure_marker(event) for event in scored_smc_events]

    scored_order_block_zones = [
        _score_order_block_zone(
            zone,
            atrs=atrs,
            fvg_zones=fvg_zones,
            liquidity_events=liquidity_events,
            displacement_markers=displacement_markers,
            inducement_markers=inducement_markers,
            pd_zones=pd_zones,
            dlm_levels=dlm_levels,
        )
        for zone in order_block_zones
    ]

    scored_pd_zones = [
        _score_pd_zone(
            zone,
            equal_lines=equal_lines,
            fvg_zones=fvg_zones,
            liquidity_events=liquidity_events,
            displacement_markers=displacement_markers,
        )
        for zone in pd_zones
    ]

    scored_liquidity_profile_bins = _score_profile_bins(
        liquidity_profile_bins,
        equal_lines=equal_lines,
        liquidity_events=liquidity_events,
        fvg_zones=fvg_zones,
    )

    trend = swing_state.trend if swing_state.trend != "neutral" else internal_state.trend

    return {
        # Visual chart drawings only.
        # Do NOT include EQH/EQL, FVG, sweeps, displacement, or inducement here.
        # Those are calculation context for future ML, not visible overlays.
        "lines": structure_lines[-500:],
        "zones": [*scored_order_block_zones, *scored_pd_zones],
        "markers": structure_markers[-500:],
        "smcEvents": scored_smc_events[-500:],
        "orderBlocks": scored_order_block_zones,
        "liquidityEvents": liquidity_events[-500:],

        # Hidden calculation context for future ML / explanation engine.
        # Frontend should not render these unless we later add explicit toggles.
        "calculationContext": {
            "equalHighLow": {
                "lines": equal_lines,
                "markers": equal_markers,
                "count": len(equal_lines),
            },
            "fairValueGaps": {
                "zones": fvg_zones,
                "markers": fvg_markers,
                "count": len(fvg_zones),
            },
            "sweeps": {
                "events": liquidity_events,
                "markers": sweep_markers,
                "count": len(liquidity_events),
            },
            "displacement": {
                "markers": displacement_markers,
                "count": len(displacement_markers),
            },
            "inducement": {
                "markers": inducement_markers,
                "count": len(inducement_markers),
            },
        },

        "mlFeatureContext": {
            "equalHighLowCount": len(equal_lines),
            "fairValueGapCount": len(fvg_zones),
            "sweepCount": len(liquidity_events),
            "displacementCount": len(displacement_markers),
            "inducementCount": len(inducement_markers),
            "hasRecentEqualHighLow": len(equal_lines) > 0,
            "hasRecentFairValueGap": len(fvg_zones) > 0,
            "hasRecentSweep": len(liquidity_events) > 0,
            "hasRecentDisplacement": len(displacement_markers) > 0,
            "hasRecentInducement": len(inducement_markers) > 0,
        },

        "liquidityProfileBins": scored_liquidity_profile_bins,
        "dlmLevels": dlm_levels,
        "ghostCandles": _normalize_ghost_candles(ghost_candles),
        "summary": {
            "status": "ok",
            "candles": len(candles),
            "trend": trend,
            "internalTrend": internal_state.trend,
            "swingTrend": swing_state.trend,
            "internalPivotCount": len(internal_pivots),
            "swingPivotCount": len(swing_pivots),
            "smcEventCount": len(smc_events),
            "structureLineCount": len(structure_lines),
            "orderBlockCount": len(order_blocks),
            "zoneCount": len(order_block_zones) + len(pd_zones),
            "liquidityEventCount": len(liquidity_events),
            "equalHighLowCount": len(equal_lines),
            "fairValueGapCount": len(fvg_zones),
            "displacementCount": len(displacement_markers),
            "inducementCount": len(inducement_markers),
            "avgStructureQuality": round(
                sum(_num(event.get("qualityScore"), 0.0) for event in scored_smc_events) / max(len(scored_smc_events), 1),
                2,
            ),
            "avgOrderBlockQuality": round(
                sum(_num(zone.get("qualityScore"), 0.0) for zone in scored_order_block_zones) / max(len(scored_order_block_zones), 1),
                2,
            ),
            "influenceLayer": "hidden-features-score-visible-overlays",
            "dlm": dlm_summary,
        },
    }


# Backwards-compatible aliases used by older imports.
build_chart_overlays = build_overlay_payload
calculate_overlay_payload = build_overlay_payload


if __name__ == "__main__":
    # Smoke test.
    sample: list[dict[str, Any]] = []
    price = 100.0

    for index in range(500):
        drift = 0.15 if index < 180 else -0.12 if index < 340 else 0.08
        open_price = price
        close_price = price + drift + ((index % 7) - 3) * 0.05
        high = max(open_price, close_price) + 0.35
        low = min(open_price, close_price) - 0.35
        volume = 1000 + (index % 20) * 50

        sample.append(
            {
                "time": index,
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
            "lines": len(payload["lines"]),
            "zones": len(payload["zones"]),
            "orderBlocks": len(payload["orderBlocks"]),
            "liquidityProfileBins": len(payload["liquidityProfileBins"]),
            "dlmLevels": payload["dlmLevels"],
            "summary": payload["summary"],
        }
    )
