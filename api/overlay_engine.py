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
    max_events: int = 20,
    atr_buffer: float = 0.05,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []

    for pivot in pivots[-80:]:
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
# Main public builder
# ─────────────────────────────────────────────────────────────────────────────


def build_overlay_payload(
    raw_candles: list[dict[str, Any] | Candle],
    *,
    internal_pivot_length: int = 5,
    swing_pivot_length: int = 50,
    internal_order_blocks: int = 5,
    swing_order_blocks: int = 5,
    include_mitigated_blocks: bool = False,
    dlm_lookback: int = 300,
    dlm_bins: int = 50,
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

    structure_lines = [_make_structure_line(event) for event in smc_events]
    structure_markers = [_make_structure_marker(event) for event in smc_events]

    order_blocks = [*internal_blocks, *swing_blocks]
    order_blocks.sort(key=lambda block: block.start_index)

    order_block_zones = [_order_block_to_zone(block) for block in order_blocks]
    pd_zones = _premium_discount_zones(candles, swing_pivots)

    liquidity_events = [
        *_detect_liquidity_sweeps(candles, internal_pivots, atrs, "internal"),
        *_detect_liquidity_sweeps(candles, swing_pivots, atrs, "swing"),
    ]

    liquidity_profile_bins, dlm_levels, dlm_summary = _build_dlm_profile(
        candles=candles,
        lookback=dlm_lookback,
        bins=dlm_bins,
    )

    trend = swing_state.trend if swing_state.trend != "neutral" else internal_state.trend

    return {
        "lines": structure_lines[-80:],
        "zones": [*order_block_zones, *pd_zones],
        "markers": structure_markers[-80:],
        "smcEvents": smc_events[-80:],
        "orderBlocks": [_order_block_to_zone(block) for block in order_blocks],
        "liquidityEvents": liquidity_events[-40:],
        "liquidityProfileBins": liquidity_profile_bins,
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
