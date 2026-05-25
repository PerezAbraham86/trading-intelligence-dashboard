from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
import math


# ═══════════════════════════════════════════════════════════════════════════════
# Trading Intelligence Dashboard Engine
# Phase 3A:
# - Python SMC structure / zones / liquidity events
# - Python AlphaX DLM profile calculations for right-side profile rendering
#
# Replace file:
# api/trading_engine.py
# ═══════════════════════════════════════════════════════════════════════════════


BULLISH = 1
BEARISH = -1
NEUTRAL = 0


# ─────────────────────────────────────────────────────────────────────────────
# BASIC HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _float(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None:
            return fallback
        x = float(value)
        if math.isnan(x) or math.isinf(x):
            return fallback
        return x
    except Exception:
        return fallback


def _int(value: Any, fallback: int = 0) -> int:
    try:
        if value is None:
            return fallback
        return int(float(value))
    except Exception:
        return fallback


def _epoch_seconds(value: Any) -> float:
    if value is None:
        return 0.0

    if isinstance(value, (int, float)):
        n = float(value)
        return n / 1000.0 if n > 1_000_000_000_000 else n

    text = str(value).strip()
    if not text:
        return 0.0

    try:
        n = float(text)
        return n / 1000.0 if n > 1_000_000_000_000 else n
    except Exception:
        pass

    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return 0.0


def _time_value(candle: Dict[str, Any]) -> Any:
    return candle.get("time") or candle.get("timestamp") or candle.get("createdAt")


def _sort_candles(candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(candles, key=lambda c: _epoch_seconds(_time_value(c)))


def _safe_time(candles: List[Dict[str, Any]], index: int) -> Any:
    if not candles:
        return None
    index = max(0, min(index, len(candles) - 1))
    return _time_value(candles[index])


def _safe_price(value: float) -> float:
    if value is None:
        return 0.0
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return 0.0
    return float(value)


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _sma(values: List[float], length: int) -> List[float]:
    out: List[float] = []
    length = max(1, int(length))
    total = 0.0

    for i, v in enumerate(values):
        total += v
        if i >= length:
            total -= values[i - length]
        count = min(i + 1, length)
        out.append(total / count if count else 0.0)

    return out


def _ema(values: List[float], length: int) -> List[float]:
    out: List[float] = []
    length = max(1, int(length))
    alpha = 2.0 / (length + 1.0)
    prev = values[0] if values else 0.0

    for i, v in enumerate(values):
        prev = v if i == 0 else prev + alpha * (v - prev)
        out.append(prev)

    return out


def _atr(candles: List[Dict[str, Any]], length: int = 14) -> List[float]:
    trs: List[float] = []
    prev_close: Optional[float] = None

    for c in candles:
        h = _float(c.get("high"))
        l = _float(c.get("low"))
        close = _float(c.get("close"))

        if prev_close is None:
            tr = max(h - l, 0.0)
        else:
            tr = max(h - l, abs(h - prev_close), abs(l - prev_close), 0.0)

        trs.append(tr)
        prev_close = close

    return _ema(trs, length)


def _normalize_candle(raw: Dict[str, Any]) -> Dict[str, Any]:
    t = _time_value(raw)
    return {
        "time": t,
        "timestamp": t,
        "epoch": _epoch_seconds(t),
        "open": _float(raw.get("open")),
        "high": _float(raw.get("high")),
        "low": _float(raw.get("low")),
        "close": _float(raw.get("close")),
        "volume": _float(raw.get("volume")),
        "symbol": raw.get("symbol"),
        "timeframe": raw.get("timeframe"),
        "createdAt": raw.get("createdAt"),
    }


def _prepare_candles(candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    clean: List[Dict[str, Any]] = []

    for c in candles or []:
        if not isinstance(c, dict):
            continue

        o = _float(c.get("open"), math.nan)
        h = _float(c.get("high"), math.nan)
        l = _float(c.get("low"), math.nan)
        cl = _float(c.get("close"), math.nan)

        if any(math.isnan(x) for x in [o, h, l, cl]):
            continue

        clean.append(_normalize_candle(c))

    clean = _sort_candles(clean)

    # Deduplicate by epoch second.
    dedup: Dict[int, Dict[str, Any]] = {}
    for c in clean:
        epoch = int(_epoch_seconds(c.get("time")))
        dedup[epoch] = c

    return sorted(dedup.values(), key=lambda x: _epoch_seconds(x.get("time")))


# ─────────────────────────────────────────────────────────────────────────────
# HEIKIN ASHI
# ─────────────────────────────────────────────────────────────────────────────

def build_heikin_ashi(candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    prev_ha_open: Optional[float] = None
    prev_ha_close: Optional[float] = None

    for c in candles:
        o = _float(c.get("open"))
        h = _float(c.get("high"))
        l = _float(c.get("low"))
        close = _float(c.get("close"))

        ha_close = (o + h + l + close) / 4.0
        ha_open = (o + close) / 2.0 if prev_ha_open is None else (prev_ha_open + prev_ha_close) / 2.0
        ha_high = max(h, ha_open, ha_close)
        ha_low = min(l, ha_open, ha_close)

        out.append({
            **c,
            "open": ha_open,
            "high": ha_high,
            "low": ha_low,
            "close": ha_close,
            "sourceOpen": o,
            "sourceHigh": h,
            "sourceLow": l,
            "sourceClose": close,
        })

        prev_ha_open = ha_open
        prev_ha_close = ha_close

    return out


# ─────────────────────────────────────────────────────────────────────────────
# PIVOTS / SMC STRUCTURE
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Pivot:
    index: int
    time: Any
    price: float
    kind: str  # high / low
    scope: str # internal / swing


def _pivot_high(candles: List[Dict[str, Any]], i: int, left: int, right: int) -> bool:
    price = _float(candles[i].get("high"))
    start = max(0, i - left)
    end = min(len(candles) - 1, i + right)
    for j in range(start, end + 1):
        if j == i:
            continue
        if _float(candles[j].get("high")) >= price:
            return False
    return True


def _pivot_low(candles: List[Dict[str, Any]], i: int, left: int, right: int) -> bool:
    price = _float(candles[i].get("low"))
    start = max(0, i - left)
    end = min(len(candles) - 1, i + right)
    for j in range(start, end + 1):
        if j == i:
            continue
        if _float(candles[j].get("low")) <= price:
            return False
    return True


def find_pivots(candles: List[Dict[str, Any]], length: int, scope: str) -> List[Pivot]:
    length = max(2, int(length))
    left = length
    right = length
    pivots: List[Pivot] = []

    if len(candles) < length * 2 + 3:
        return pivots

    for i in range(left, len(candles) - right):
        if _pivot_high(candles, i, left, right):
            pivots.append(Pivot(
                index=i,
                time=_safe_time(candles, i),
                price=_float(candles[i].get("high")),
                kind="high",
                scope=scope,
            ))

        if _pivot_low(candles, i, left, right):
            pivots.append(Pivot(
                index=i,
                time=_safe_time(candles, i),
                price=_float(candles[i].get("low")),
                kind="low",
                scope=scope,
            ))

    pivots.sort(key=lambda p: p.index)
    return pivots


def detect_structure_events(
    candles: List[Dict[str, Any]],
    pivots: List[Pivot],
    scope: str,
    max_events: int,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    events: List[Dict[str, Any]] = []
    order_blocks: List[Dict[str, Any]] = []

    last_high: Optional[Pivot] = None
    last_low: Optional[Pivot] = None
    crossed_high: set[int] = set()
    crossed_low: set[int] = set()
    trend = NEUTRAL

    pivot_by_index: Dict[int, List[Pivot]] = {}
    for p in pivots:
        pivot_by_index.setdefault(p.index, []).append(p)

    for i, c in enumerate(candles):
        for p in pivot_by_index.get(i, []):
            if p.kind == "high":
                last_high = p
            elif p.kind == "low":
                last_low = p

        close = _float(c.get("close"))

        if last_high and last_high.index not in crossed_high and close > last_high.price:
            tag = "CHoCH" if trend == BEARISH else "BOS"
            direction = "bullish"
            events.append({
                "time": _safe_time(candles, i),
                "fromTime": last_high.time,
                "price": last_high.price,
                "tag": "i" + tag if scope == "internal" else tag,
                "direction": direction,
                "scope": scope,
                "kind": "structure",
                "index": i,
                "fromIndex": last_high.index,
            })
            crossed_high.add(last_high.index)
            trend = BULLISH

            ob = _find_order_block(candles, last_high.index, i, BULLISH, scope)
            if ob:
                order_blocks.append(ob)

        if last_low and last_low.index not in crossed_low and close < last_low.price:
            tag = "CHoCH" if trend == BULLISH else "BOS"
            direction = "bearish"
            events.append({
                "time": _safe_time(candles, i),
                "fromTime": last_low.time,
                "price": last_low.price,
                "tag": "i" + tag if scope == "internal" else tag,
                "direction": direction,
                "scope": scope,
                "kind": "structure",
                "index": i,
                "fromIndex": last_low.index,
            })
            crossed_low.add(last_low.index)
            trend = BEARISH

            ob = _find_order_block(candles, last_low.index, i, BEARISH, scope)
            if ob:
                order_blocks.append(ob)

    return events[-max_events:], order_blocks


def _find_order_block(
    candles: List[Dict[str, Any]],
    start_index: int,
    end_index: int,
    bias: int,
    scope: str,
) -> Optional[Dict[str, Any]]:
    if not candles:
        return None

    start = max(0, min(start_index, end_index))
    end = max(0, min(max(start_index, end_index), len(candles) - 1))
    window = candles[start:end + 1]

    if not window:
        return None

    chosen_index = start
    if bias == BULLISH:
        # Bullish OB = lowest bearish/low candle before bullish break.
        min_low = float("inf")
        for offset, c in enumerate(window):
            o = _float(c.get("open"))
            cl = _float(c.get("close"))
            l = _float(c.get("low"))
            if cl <= o and l < min_low:
                min_low = l
                chosen_index = start + offset
        if min_low == float("inf"):
            chosen_index = min(range(start, end + 1), key=lambda idx: _float(candles[idx].get("low")))
    else:
        # Bearish OB = highest bullish/high candle before bearish break.
        max_high = float("-inf")
        for offset, c in enumerate(window):
            o = _float(c.get("open"))
            cl = _float(c.get("close"))
            h = _float(c.get("high"))
            if cl >= o and h > max_high:
                max_high = h
                chosen_index = start + offset
        if max_high == float("-inf"):
            chosen_index = max(range(start, end + 1), key=lambda idx: _float(candles[idx].get("high")))

    chosen = candles[chosen_index]
    direction = "bullish" if bias == BULLISH else "bearish"

    return {
        "startTime": _safe_time(candles, chosen_index),
        "endTime": _safe_time(candles, len(candles) - 1),
        "top": _float(chosen.get("high")),
        "bottom": _float(chosen.get("low")),
        "label": f"{scope.title()} {'Bullish' if bias == BULLISH else 'Bearish'} OB",
        "direction": direction,
        "kind": f"{scope}_ob",
        "index": chosen_index,
        "scope": scope,
    }


def detect_fvgs(candles: List[Dict[str, Any]], max_zones: int) -> List[Dict[str, Any]]:
    zones: List[Dict[str, Any]] = []

    if len(candles) < 3:
        return zones

    atr = _atr(candles, 14)

    for i in range(2, len(candles)):
        c = candles[i]
        c2 = candles[i - 2]
        current_low = _float(c.get("low"))
        current_high = _float(c.get("high"))
        prev2_high = _float(c2.get("high"))
        prev2_low = _float(c2.get("low"))
        min_gap = max(atr[i] * 0.05, 0.0)

        if current_low > prev2_high and (current_low - prev2_high) >= min_gap:
            zones.append({
                "startTime": _safe_time(candles, i - 2),
                "endTime": _safe_time(candles, len(candles) - 1),
                "top": current_low,
                "bottom": prev2_high,
                "label": "Bullish FVG",
                "direction": "bullish",
                "kind": "fvg",
                "index": i,
            })

        if current_high < prev2_low and (prev2_low - current_high) >= min_gap:
            zones.append({
                "startTime": _safe_time(candles, i - 2),
                "endTime": _safe_time(candles, len(candles) - 1),
                "top": prev2_low,
                "bottom": current_high,
                "label": "Bearish FVG",
                "direction": "bearish",
                "kind": "fvg",
                "index": i,
            })

    return zones[-max_zones:]


def detect_premium_discount_zones(candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not candles:
        return []

    highs = [_float(c.get("high")) for c in candles]
    lows = [_float(c.get("low")) for c in candles]

    top = max(highs)
    bottom = min(lows)
    mid = (top + bottom) / 2.0
    start_time = _safe_time(candles, 0)
    end_time = _safe_time(candles, len(candles) - 1)

    return [
        {
            "startTime": start_time,
            "endTime": end_time,
            "top": top,
            "bottom": (top * 0.95 + bottom * 0.05),
            "label": "Premium",
            "direction": "bearish",
            "kind": "premium",
        },
        {
            "startTime": start_time,
            "endTime": end_time,
            "top": (top * 0.525 + bottom * 0.475),
            "bottom": (bottom * 0.525 + top * 0.475),
            "label": "Equilibrium",
            "direction": "neutral",
            "kind": "equilibrium",
        },
        {
            "startTime": start_time,
            "endTime": end_time,
            "top": (bottom * 0.95 + top * 0.05),
            "bottom": bottom,
            "label": "Discount",
            "direction": "bullish",
            "kind": "discount",
        },
    ]


def detect_equal_high_low_and_sweeps(
    candles: List[Dict[str, Any]],
    pivots: List[Pivot],
    threshold_atr_mult: float,
    max_events: int,
) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []

    if not candles or not pivots:
        return events

    atr = _atr(candles, 14)
    highs = [p for p in pivots if p.kind == "high"]
    lows = [p for p in pivots if p.kind == "low"]

    def add_pool_events(points: List[Pivot], direction: str, label: str, sweep_label: str) -> None:
        for i in range(1, len(points)):
            prev = points[i - 1]
            cur = points[i]
            ref_atr = atr[min(cur.index, len(atr) - 1)] if atr else 0.0
            threshold = max(ref_atr * threshold_atr_mult, 1e-9)

            if abs(cur.price - prev.price) <= threshold:
                level = (cur.price + prev.price) / 2.0
                events.append({
                    "time": cur.time,
                    "price": level,
                    "label": label,
                    "direction": direction,
                    "kind": "liquidity_pool",
                    "touches": 2,
                    "index": cur.index,
                })

                for j in range(cur.index + 1, min(len(candles), cur.index + 80)):
                    h = _float(candles[j].get("high"))
                    l = _float(candles[j].get("low"))
                    cl = _float(candles[j].get("close"))

                    if direction == "bearish":
                        if h > level and cl < level:
                            events.append({
                                "time": _safe_time(candles, j),
                                "price": level,
                                "label": sweep_label,
                                "direction": "bearish",
                                "kind": "sweep",
                                "index": j,
                            })
                            break
                    else:
                        if l < level and cl > level:
                            events.append({
                                "time": _safe_time(candles, j),
                                "price": level,
                                "label": sweep_label,
                                "direction": "bullish",
                                "kind": "sweep",
                                "index": j,
                            })
                            break

    add_pool_events(highs, "bearish", "Buy-Side Pool", "BSL Sweep")
    add_pool_events(lows, "bullish", "Sell-Side Pool", "SSL Sweep")

    events.sort(key=lambda e: e.get("index", 0))
    return events[-max_events:]


# ─────────────────────────────────────────────────────────────────────────────
# ALPHAX DLM PROFILE — PHASE 3A
# ─────────────────────────────────────────────────────────────────────────────

def build_alphax_dlm(
    candles: List[Dict[str, Any]],
    config: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Python version of the AlphaX DLM profile core.

    Backend output is designed for the frontend to draw the Pine-style right
    liquidity profile:
    - alphaProfileBins: horizontal bars by price bin
    - dlmLevels: POC / buy liquidity / sell liquidity
    - dlmConfluenceMarkers: pressure marker
    - alphaFvgs: DLM FVG zones
    - alphaSweeps: DLM sweep labels
    """

    lookback = int(config.get("dlm_lookback", config.get("dlmBridgeLookbackInput", 300)))
    bins_count = int(config.get("dlm_bins", config.get("dlmBridgeBinsInput", 50)))
    vol_smooth_len = int(config.get("dlm_vol_smooth", 10))
    atr_len = int(config.get("dlm_atr_len", 14))
    fvg_min_atr = float(config.get("dlm_fvg_min_atr", 0.10))
    sweep_lookback = int(config.get("dlm_sweep_lookback", 5))
    max_profile_width = int(config.get("dlm_bar_max_width", 50))

    lookback = max(20, min(lookback, 1000))
    bins_count = max(10, min(bins_count, 120))
    vol_smooth_len = max(1, min(vol_smooth_len, 50))
    atr_len = max(2, min(atr_len, 100))
    sweep_lookback = max(2, min(sweep_lookback, 50))

    recent = candles[-lookback:] if len(candles) > lookback else candles[:]

    if not recent:
        return {
            "alphaProfileBins": [],
            "alphaPoc": None,
            "alphaBuyLiquidity": None,
            "alphaSellLiquidity": None,
            "alphaBullPressure": 50,
            "alphaBearPressure": 50,
            "alphaFvgs": [],
            "alphaSweeps": [],
            "dlmLevels": [],
            "dlmConfluenceMarkers": [],
            "alphaProfileMeta": {
                "lookback": lookback,
                "bins": bins_count,
                "rangeTop": None,
                "rangeBottom": None,
                "maxVolume": 0,
            },
        }

    atr_values = _atr(recent, atr_len)
    volumes = [_float(c.get("volume")) for c in recent]
    volume_smooth = _sma(volumes, vol_smooth_len)

    # DLM Pine style uses adjusted liquidity levels around highs/lows.
    offsets: List[float] = []
    max_vol_smooth = max(max(volume_smooth), 1.0)

    for i, c in enumerate(recent):
        atr_adj = atr_values[i] / 50.0
        normalized_vol = volume_smooth[i] / max_vol_smooth * 100.0
        offsets.append(atr_adj * normalized_vol)

    range_top = max(_float(c.get("high")) + offsets[i] for i, c in enumerate(recent))
    range_bottom = min(_float(c.get("low")) - offsets[i] for i, c in enumerate(recent))

    if range_top <= range_bottom:
        last_close = _float(recent[-1].get("close"))
        range_top = last_close + 1.0
        range_bottom = last_close - 1.0

    step = (range_top - range_bottom) / bins_count
    if step <= 0:
        step = max(abs(range_top) * 0.0001, 1e-9)

    total_bins = [0.0 for _ in range(bins_count)]
    buy_bins = [0.0 for _ in range(bins_count)]
    sell_bins = [0.0 for _ in range(bins_count)]
    touch_bins = [0 for _ in range(bins_count)]

    # Bin by hlc3, similar to the bridge, but also split buy/sell side.
    for i, c in enumerate(recent):
        h = _float(c.get("high"))
        l = _float(c.get("low"))
        o = _float(c.get("open"))
        cl = _float(c.get("close"))
        v = max(_float(c.get("volume")), 0.0)
        src = (h + l + cl) / 3.0

        idx = int(math.floor((src - range_bottom) / step))
        idx = max(0, min(bins_count - 1, idx))

        total_bins[idx] += v
        touch_bins[idx] += 1

        if cl >= o:
            buy_bins[idx] += v
        else:
            sell_bins[idx] += v

    max_total = max(total_bins) if total_bins else 0.0
    max_buy = max(buy_bins) if buy_bins else 0.0
    max_sell = max(sell_bins) if sell_bins else 0.0
    min_total = min(total_bins) if total_bins else 0.0

    poc_idx = total_bins.index(max_total) if max_total > 0 else bins_count // 2
    buy_idx = buy_bins.index(max_buy) if max_buy > 0 else poc_idx
    sell_idx = sell_bins.index(max_sell) if max_sell > 0 else poc_idx

    def bin_mid(idx: int) -> float:
        return range_bottom + step * idx + step * 0.5

    poc_price = bin_mid(poc_idx)
    buy_price = bin_mid(buy_idx)
    sell_price = bin_mid(sell_idx)

    directional_total = max_buy + max_sell
    bull_pressure = (max_buy / directional_total * 100.0) if directional_total > 0 else 50.0
    bear_pressure = (max_sell / directional_total * 100.0) if directional_total > 0 else 50.0

    last_close = _float(recent[-1].get("close"))
    alpha_bins: List[Dict[str, Any]] = []

    for j in range(bins_count):
        bottom = range_bottom + step * j
        top = bottom + step
        mid = bottom + step * 0.5
        total = total_bins[j]
        buy_v = buy_bins[j]
        sell_v = sell_bins[j]

        width_pct = total / max_total * 100.0 if max_total > 0 else 0.0
        buy_width_pct = buy_v / max_total * 100.0 if max_total > 0 else 0.0
        sell_width_pct = sell_v / max_total * 100.0 if max_total > 0 else 0.0

        # Pine profile colors by price position relative to current price.
        direction = "bullish" if last_close > mid else "bearish"
        dominant = "bullish" if buy_v > sell_v else "bearish" if sell_v > buy_v else "neutral"

        alpha_bins.append({
            "index": j,
            "top": top,
            "bottom": bottom,
            "mid": mid,
            "volume": total,
            "buyVolume": buy_v,
            "sellVolume": sell_v,
            "touches": touch_bins[j],
            "widthPct": width_pct,
            "buyWidthPct": buy_width_pct,
            "sellWidthPct": sell_width_pct,
            "barWidth": int(round(width_pct / 100.0 * max_profile_width)),
            "isPoc": j == poc_idx,
            "isBuyLiquidity": j == buy_idx,
            "isSellLiquidity": j == sell_idx,
            "direction": direction,
            "dominantSide": dominant,
            "label": f"{round(width_pct)}%",
        })

    # Only send useful visible bins to avoid chart clutter.
    # Keep POC/buy/sell even if small.
    visible_bins = [
        b for b in alpha_bins
        if b["widthPct"] >= 3.0 or b["isPoc"] or b["isBuyLiquidity"] or b["isSellLiquidity"]
    ]

    # DLM FVGs
    alpha_fvgs: List[Dict[str, Any]] = []
    for i in range(2, len(recent)):
        c = recent[i]
        c2 = recent[i - 2]
        min_gap = atr_values[i] * fvg_min_atr
        low = _float(c.get("low"))
        high = _float(c.get("high"))
        high2 = _float(c2.get("high"))
        low2 = _float(c2.get("low"))

        if low > high2 and (low - high2) >= min_gap:
            alpha_fvgs.append({
                "startTime": _safe_time(recent, i - 2),
                "endTime": _safe_time(recent, len(recent) - 1),
                "top": low,
                "bottom": high2,
                "label": "DLM FVG ▲",
                "direction": "bullish",
                "kind": "alpha_fvg",
                "index": i,
            })

        if high < low2 and (low2 - high) >= min_gap:
            alpha_fvgs.append({
                "startTime": _safe_time(recent, i - 2),
                "endTime": _safe_time(recent, len(recent) - 1),
                "top": low2,
                "bottom": high,
                "label": "DLM FVG ▼",
                "direction": "bearish",
                "kind": "alpha_fvg",
                "index": i,
            })

    alpha_fvgs = alpha_fvgs[-12:]

    # DLM sweep detection
    alpha_sweeps: List[Dict[str, Any]] = []
    for i in range(sweep_lookback + 1, len(recent)):
        prev_window = recent[i - sweep_lookback:i]
        recent_low = min(_float(c.get("low")) for c in prev_window)
        recent_high = max(_float(c.get("high")) for c in prev_window)

        c = recent[i]
        low = _float(c.get("low"))
        high = _float(c.get("high"))
        o = _float(c.get("open"))
        cl = _float(c.get("close"))

        if low < recent_low and cl > recent_low and cl > o:
            alpha_sweeps.append({
                "time": _safe_time(recent, i),
                "price": recent_low,
                "label": "DLM Sweep Low",
                "direction": "bullish",
                "kind": "alpha_sweep",
                "index": i,
            })

        if high > recent_high and cl < recent_high and cl < o:
            alpha_sweeps.append({
                "time": _safe_time(recent, i),
                "price": recent_high,
                "label": "DLM Sweep High",
                "direction": "bearish",
                "kind": "alpha_sweep",
                "index": i,
            })

    alpha_sweeps = alpha_sweeps[-30:]

    dlm_direction = "bullish" if bull_pressure >= bear_pressure else "bearish"
    dlm_pressure = round(max(bull_pressure, bear_pressure), 2)

    dlm_levels = [
        {
            "label": "AlphaX POC",
            "price": poc_price,
            "direction": "neutral",
            "kind": "poc",
            "volume": max_total,
            "index": poc_idx,
        },
        {
            "label": "DLM Buy Liquidity",
            "price": buy_price,
            "direction": "bullish",
            "kind": "buy_liquidity",
            "volume": max_buy,
            "index": buy_idx,
        },
        {
            "label": "DLM Sell Liquidity",
            "price": sell_price,
            "direction": "bearish",
            "kind": "sell_liquidity",
            "volume": max_sell,
            "index": sell_idx,
        },
    ]

    confluence_markers = [
        {
            "time": _safe_time(recent, len(recent) - 1),
            "price": last_close,
            "label": "AlphaX Pressure",
            "direction": dlm_direction,
            "kind": "pressure",
            "pressurePct": dlm_pressure,
            "bullPressure": round(bull_pressure, 2),
            "bearPressure": round(bear_pressure, 2),
        }
    ]

    return {
        "alphaProfileBins": visible_bins,
        "alphaPoc": poc_price,
        "alphaBuyLiquidity": buy_price,
        "alphaSellLiquidity": sell_price,
        "alphaBullPressure": round(bull_pressure, 2),
        "alphaBearPressure": round(bear_pressure, 2),
        "alphaFvgs": alpha_fvgs,
        "alphaSweeps": alpha_sweeps,
        "dlmLevels": dlm_levels,
        "dlmConfluenceMarkers": confluence_markers,
        "alphaProfileMeta": {
            "lookback": len(recent),
            "requestedLookback": lookback,
            "bins": bins_count,
            "visibleBins": len(visible_bins),
            "rangeTop": range_top,
            "rangeBottom": range_bottom,
            "step": step,
            "maxVolume": max_total,
            "minVolume": min_total,
            "maxBuyVolume": max_buy,
            "maxSellVolume": max_sell,
            "pocIndex": poc_idx,
            "buyIndex": buy_idx,
            "sellIndex": sell_idx,
            "barMaxWidth": max_profile_width,
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# GHOST CANDLES — BASE PLACEHOLDER UNTIL PHASE 4
# ─────────────────────────────────────────────────────────────────────────────

def build_base_ghost_candles(candles: List[Dict[str, Any]], count: int = 3) -> List[Dict[str, Any]]:
    if not candles:
        return []

    ha = build_heikin_ashi(candles)
    last = ha[-1]
    atr_values = _atr(candles, 14)
    nf = max(atr_values[-1] if atr_values else 0.0, _float(candles[-1].get("close")) * 0.0005, 1e-9)

    prev_open = _float(last.get("open"))
    prev_close = _float(last.get("close"))
    momentum = _float(last.get("close")) - _float(ha[-2].get("close")) if len(ha) >= 2 else 0.0

    ghosts: List[Dict[str, Any]] = []

    for i in range(count):
        decay = math.pow(0.75, i)
        g_open = (prev_open + prev_close) / 2.0
        g_close = prev_close + momentum * decay
        body = abs(g_close - g_open)

        if body < nf * 0.08:
            direction = 1 if momentum >= 0 else -1
            g_close = g_open + direction * nf * 0.08

        top = max(g_open, g_close)
        bottom = min(g_open, g_close)
        wick = max(nf * 0.15, abs(g_close - g_open) * 0.25)

        g_high = top + wick
        g_low = bottom - wick

        ghosts.append({
            "index": i + 1,
            "label": f"Ghost #{i + 1}",
            "direction": "up" if g_close >= g_open else "down",
            "open": g_open,
            "high": g_high,
            "low": g_low,
            "close": g_close,
            "confidence": max(0, round(10 - i * 4)),
        })

        prev_open = g_open
        prev_close = g_close

    return ghosts



# ─────────────────────────────────────────────────────────────────────────────
# PYTHON TECHNICAL SENTIMENT ENGINE — PHASE 4A
# Mirrors the LuxAlgo Market Sentiment Technicals meter logic from Pine:
# RSI, Stochastic, Stoch RSI, CCI, Bull Bear Power, Momentum, MA, VWAP,
# Bollinger Bands, Supertrend, Linear Regression, Market Structure.
# ─────────────────────────────────────────────────────────────────────────────

def _last_sma(values: List[float], length: int) -> Optional[float]:
    if length <= 0 or len(values) < length:
        return None
    sample = values[-length:]
    return sum(sample) / length


def _ema_series(values: List[float], length: int) -> List[float]:
    if not values:
        return []
    length = max(1, int(length))
    alpha = 2.0 / (length + 1.0)
    out = [values[0]]
    for value in values[1:]:
        out.append(value * alpha + out[-1] * (1.0 - alpha))
    return out


def _last_ema(values: List[float], length: int) -> Optional[float]:
    out = _ema_series(values, length)
    return out[-1] if out else None


def _last_wma(values: List[float], length: int) -> Optional[float]:
    if length <= 0 or len(values) < length:
        return None
    sample = values[-length:]
    weights = list(range(1, length + 1))
    total_weight = sum(weights)
    return sum(v * w for v, w in zip(sample, weights)) / total_weight


def _last_rma(values: List[float], length: int) -> Optional[float]:
    if not values:
        return None
    length = max(1, int(length))
    alpha = 1.0 / length
    prev = values[0]
    for value in values[1:]:
        prev = value * alpha + prev * (1.0 - alpha)
    return prev


def _last_hma(values: List[float], length: int) -> Optional[float]:
    # Lightweight HMA approximation using WMA stages.
    if length <= 1 or len(values) < length:
        return _last_wma(values, max(1, length))
    half = max(1, length // 2)
    sqrt_len = max(1, int(math.sqrt(length)))
    diff: List[float] = []
    for i in range(len(values)):
        prefix = values[: i + 1]
        w1 = _last_wma(prefix, half)
        w2 = _last_wma(prefix, length)
        if w1 is None or w2 is None:
            continue
        diff.append(2.0 * w1 - w2)
    return _last_wma(diff, sqrt_len) if diff else None


def _last_vwma(values: List[float], volumes: List[float], length: int) -> Optional[float]:
    if length <= 0 or len(values) < length or len(volumes) < length:
        return None
    sample_values = values[-length:]
    sample_volumes = [max(0.0, v) for v in volumes[-length:]]
    total_volume = sum(sample_volumes)
    if total_volume <= 0:
        return _last_sma(values, length)
    return sum(v * vol for v, vol in zip(sample_values, sample_volumes)) / total_volume


def _moving_average_last(values: List[float], volumes: List[float], length: int, ma_type: str = "SMA") -> Optional[float]:
    ma = str(ma_type or "SMA").upper()
    if ma == "EMA":
        return _last_ema(values, length)
    if ma == "HMA":
        return _last_hma(values, length)
    if ma == "RMA":
        return _last_rma(values, length)
    if ma == "WMA":
        return _last_wma(values, length)
    if ma == "VWMA":
        return _last_vwma(values, volumes, length)
    return _last_sma(values, length)


def _last_stdev(values: List[float], length: int) -> Optional[float]:
    if length <= 1 or len(values) < length:
        return None
    sample = values[-length:]
    mean = sum(sample) / length
    variance = sum((v - mean) ** 2 for v in sample) / length
    return math.sqrt(max(variance, 0.0))


def _last_mean_deviation(values: List[float], length: int) -> Optional[float]:
    if length <= 0 or len(values) < length:
        return None
    sample = values[-length:]
    mean = sum(sample) / length
    return sum(abs(v - mean) for v in sample) / length


def _interpolate(value: float, value_high: float, value_low: float, range_high: float, range_low: float) -> float:
    denominator = value_high - value_low
    if abs(denominator) < 1e-12:
        return range_low
    return range_low + (value - value_low) * (range_high - range_low) / denominator


def _classify_sentiment_value(value: float) -> str:
    if value > 60:
        return "BULLISH"
    if value < 40:
        return "BEARISH"
    return "NEUTRAL"


def _rsi_last(closes: List[float], length: int = 14) -> Optional[float]:
    if len(closes) < length + 1:
        return None
    gains: List[float] = []
    losses: List[float] = []
    for i in range(1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gains.append(max(delta, 0.0))
        losses.append(max(-delta, 0.0))
    avg_gain = _last_rma(gains, length)
    avg_loss = _last_rma(losses, length)
    if avg_gain is None or avg_loss is None:
        return None
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _rsi_normalized(closes: List[float], length: int = 14) -> float:
    r = _rsi_last(closes, length)
    if r is None:
        return 50.0
    if r > 70:
        return _interpolate(r, 100, 70, 100, 75)
    if r > 50:
        return _interpolate(r, 70, 50, 75, 50)
    if r > 30:
        return _interpolate(r, 50, 30, 50, 25)
    return _interpolate(max(r, 0), 30, 0, 25, 0)


def _stochastic_normalized(highs: List[float], lows: List[float], closes: List[float], length_k: int = 14, smooth_k: int = 3) -> float:
    if len(closes) < length_k:
        return 50.0
    k_values: List[float] = []
    for i in range(length_k - 1, len(closes)):
        hh = max(highs[i - length_k + 1:i + 1])
        ll = min(lows[i - length_k + 1:i + 1])
        denom = hh - ll
        k_values.append(50.0 if abs(denom) < 1e-12 else (closes[i] - ll) / denom * 100.0)
    s = _last_sma(k_values, smooth_k) if k_values else None
    s = 50.0 if s is None else s
    if s > 80:
        return _interpolate(s, 100, 80, 100, 75)
    if s > 50:
        return _interpolate(s, 80, 50, 75, 50)
    if s > 20:
        return _interpolate(s, 50, 20, 50, 25)
    return _interpolate(max(s, 0), 20, 0, 25, 0)


def _stoch_rsi_normalized(closes: List[float], rsi_length: int = 14, stoch_length: int = 14, smooth_k: int = 3) -> float:
    if len(closes) < rsi_length + stoch_length + smooth_k:
        return 50.0
    rsi_series: List[float] = []
    for i in range(rsi_length + 1, len(closes) + 1):
        r = _rsi_last(closes[:i], rsi_length)
        if r is not None:
            rsi_series.append(r)
    if len(rsi_series) < stoch_length:
        return 50.0
    stoch_values: List[float] = []
    for i in range(stoch_length - 1, len(rsi_series)):
        window = rsi_series[i - stoch_length + 1:i + 1]
        hh = max(window)
        ll = min(window)
        denom = hh - ll
        stoch_values.append(50.0 if abs(denom) < 1e-12 else (rsi_series[i] - ll) / denom * 100.0)
    s = _last_sma(stoch_values, smooth_k) if stoch_values else None
    s = 50.0 if s is None else s
    if s > 80:
        return _interpolate(s, 100, 80, 100, 75)
    if s > 50:
        return _interpolate(s, 80, 50, 75, 50)
    if s > 20:
        return _interpolate(s, 50, 20, 50, 25)
    return _interpolate(max(s, 0), 20, 0, 25, 0)


def _cci_normalized(hlc3: List[float], length: int = 20) -> float:
    ma = _last_sma(hlc3, length)
    dev = _last_mean_deviation(hlc3, length)
    if ma is None or dev is None or dev <= 0:
        return 50.0
    c = (hlc3[-1] - ma) / (0.015 * dev)
    if c > 100:
        return 100.0 if c > 300 else _interpolate(c, 300, 100, 100, 75)
    if c >= 0:
        return _interpolate(c, 100, 0, 75, 50)
    if c < -100:
        return 0.0 if c < -300 else _interpolate(c, -100, -300, 25, 0)
    return _interpolate(c, 0, -100, 50, 25)


def _normalize_buy_sell(closes: List[float], buy_flags: List[bool], sell_flags: List[bool], smooth: int = 3) -> float:
    if not closes:
        return 50.0
    os = 0
    max_v: Optional[float] = None
    min_v: Optional[float] = None
    raw: List[float] = []
    for close, buy, sell in zip(closes, buy_flags, sell_flags):
        prev_os = os
        if buy:
            os = 1
        elif sell:
            os = -1
        if max_v is None or min_v is None:
            max_v = close
            min_v = close
        elif os > prev_os:
            max_v = close
        elif os < prev_os:
            min_v = close
        else:
            max_v = max(close, max_v)
            min_v = min(close, min_v)
        denom = max(max_v - min_v, 1e-12)
        raw.append((close - min_v) / denom * 100.0)
    smoothed = _sma(raw, max(1, smooth))
    return _clamp(smoothed[-1] if smoothed else 50.0, 0.0, 100.0)


def _bull_bear_power_normalized(highs: List[float], lows: List[float], closes: List[float], length: int = 13) -> float:
    if len(closes) < max(length, 100):
        return 50.0
    ema_vals = _ema_series(closes, length)
    bbp = [highs[i] + lows[i] - 2.0 * ema_vals[i] for i in range(len(closes))]
    basis = _last_sma(bbp, 100)
    dev = _last_stdev(bbp, 100)
    if basis is None or dev is None:
        return 50.0
    upper = basis + 2.0 * dev
    lower = basis - 2.0 * dev
    value = bbp[-1]
    if value > upper:
        return 100.0 if value > 1.5 * upper else _interpolate(value, 1.5 * upper, upper, 100, 75)
    if value > 0:
        return _interpolate(value, upper, 0, 75, 50)
    if value < lower:
        return 0.0 if value < 1.5 * lower else _interpolate(value, lower, 1.5 * lower, 25, 0)
    if value < 0:
        return _interpolate(value, 0, lower, 50, 25)
    return 50.0


def _momentum_normalized(closes: List[float], length: int = 10, smooth: int = 3) -> float:
    if len(closes) <= length:
        return 50.0
    moms = [0.0] * len(closes)
    for i in range(length, len(closes)):
        moms[i] = closes[i] - closes[i - length]
    return _normalize_buy_sell(closes, [m > 0 for m in moms], [m < 0 for m in moms], smooth)


def _moving_average_normalized(closes: List[float], volumes: List[float], length: int = 20, ma_type: str = "SMA", smooth: int = 3) -> float:
    ma_series: List[Optional[float]] = []
    for i in range(len(closes)):
        ma_series.append(_moving_average_last(closes[:i + 1], volumes[:i + 1], length, ma_type))
    buy = [ma is not None and closes[i] > ma for i, ma in enumerate(ma_series)]
    sell = [ma is not None and closes[i] < ma for i, ma in enumerate(ma_series)]
    return _normalize_buy_sell(closes, buy, sell, smooth)


def _bollinger_bands_normalized(closes: List[float], volumes: List[float], length: int = 20, multiplier: float = 2.0, ma_type: str = "SMA", smooth: int = 3) -> float:
    buy: List[bool] = []
    sell: List[bool] = []
    for i in range(len(closes)):
        prefix = closes[:i + 1]
        vol_prefix = volumes[:i + 1]
        basis = _moving_average_last(prefix, vol_prefix, length, ma_type)
        dev = _last_stdev(prefix, length)
        if basis is None or dev is None:
            buy.append(False)
            sell.append(False)
        else:
            buy.append(closes[i] > basis + multiplier * dev)
            sell.append(closes[i] < basis - multiplier * dev)
    return _normalize_buy_sell(closes, buy, sell, smooth)


def _vwap_normalized(highs: List[float], lows: List[float], closes: List[float], volumes: List[float], stdev_mult: float = 2.0, smooth: int = 3) -> float:
    if not closes:
        return 50.0
    typical = [(h + l + c) / 3.0 for h, l, c in zip(highs, lows, closes)]
    cumulative_volume = 0.0
    cumulative_pv = 0.0
    vwaps: List[float] = []
    deviations: List[float] = []
    for i, (tp, vol) in enumerate(zip(typical, volumes)):
        v = max(vol, 0.0)
        # Futures/crypto alerts sometimes send zero volume. Use one synthetic unit so VWAP remains usable.
        if v <= 0:
            v = 1.0
        cumulative_volume += v
        cumulative_pv += tp * v
        vwap = cumulative_pv / max(cumulative_volume, 1e-12)
        vwaps.append(vwap)
        deviations.append(tp - vwap)
    dev = _last_stdev(deviations, min(50, max(5, len(deviations)))) or 0.0
    upper = [v + stdev_mult * dev for v in vwaps]
    lower = [v - stdev_mult * dev for v in vwaps]
    return _normalize_buy_sell(closes, [closes[i] > upper[i] for i in range(len(closes))], [closes[i] < lower[i] for i in range(len(closes))], smooth)


def _supertrend_normalized(candles: List[Dict[str, Any]], factor: float = 3.0, period: int = 10, smooth: int = 3) -> float:
    if len(candles) < period + 2:
        return 50.0
    highs = [_float(c.get("high")) for c in candles]
    lows = [_float(c.get("low")) for c in candles]
    closes = [_float(c.get("close")) for c in candles]
    atr_values = _atr(candles, period)
    final_upper: List[float] = []
    final_lower: List[float] = []
    st_line: List[float] = []
    direction = 1
    for i in range(len(candles)):
        hl2 = (highs[i] + lows[i]) / 2.0
        basic_upper = hl2 + factor * atr_values[i]
        basic_lower = hl2 - factor * atr_values[i]
        if i == 0:
            final_upper.append(basic_upper)
            final_lower.append(basic_lower)
            st_line.append(basic_lower)
            continue
        fu = basic_upper if basic_upper < final_upper[-1] or closes[i - 1] > final_upper[-1] else final_upper[-1]
        fl = basic_lower if basic_lower > final_lower[-1] or closes[i - 1] < final_lower[-1] else final_lower[-1]
        if st_line[-1] == final_upper[-1]:
            if closes[i] <= fu:
                st = fu
                direction = -1
            else:
                st = fl
                direction = 1
        else:
            if closes[i] >= fl:
                st = fl
                direction = 1
            else:
                st = fu
                direction = -1
        final_upper.append(fu)
        final_lower.append(fl)
        st_line.append(st)
    return _normalize_buy_sell(closes, [closes[i] > st_line[i] for i in range(len(closes))], [closes[i] < st_line[i] for i in range(len(closes))], smooth)


def _linear_regression_normalized(closes: List[float], length: int = 25) -> float:
    if len(closes) < length:
        return 50.0
    y = closes[-length:]
    x = list(range(length))
    mean_x = sum(x) / length
    mean_y = sum(y) / length
    cov = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x, y))
    var_x = sum((xi - mean_x) ** 2 for xi in x)
    var_y = sum((yi - mean_y) ** 2 for yi in y)
    denom = math.sqrt(max(var_x * var_y, 1e-12))
    corr = cov / denom if denom else 0.0
    return _clamp(50.0 * corr + 50.0, 0.0, 100.0)


def _market_structure_normalized(highs: List[float], lows: List[float], closes: List[float], length: int = 5, smooth: int = 3) -> float:
    if len(closes) < length * 2 + 2:
        return 50.0
    ph_y: Optional[float] = None
    pl_y: Optional[float] = None
    ph_cross = False
    pl_cross = False
    buy: List[bool] = []
    sell: List[bool] = []
    for i in range(len(closes)):
        bull = False
        bear = False
        if i >= length * 2:
            pivot_i = i - length
            high_window = highs[pivot_i - length:pivot_i + length + 1]
            low_window = lows[pivot_i - length:pivot_i + length + 1]
            if highs[pivot_i] == max(high_window):
                ph_y = highs[pivot_i]
                ph_cross = False
            if lows[pivot_i] == min(low_window):
                pl_y = lows[pivot_i]
                pl_cross = False
        if ph_y is not None and closes[i] > ph_y and not ph_cross:
            ph_cross = True
            bull = True
        if pl_y is not None and closes[i] < pl_y and not pl_cross:
            pl_cross = True
            bear = True
        buy.append(bull)
        sell.append(bear)
    return _normalize_buy_sell(closes, buy, sell, smooth)


def build_technical_sentiment(
    candles: List[Dict[str, Any]],
    symbol: Optional[str] = None,
    timeframe: Optional[str] = None,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    config = config or {}
    clean = _prepare_candles(candles)

    if not clean:
        return {
            "eventType": "PYTHON_TECHNICAL_SENTIMENT",
            "symbol": symbol or "WAITING",
            "timeframe": timeframe or "1m",
            "sentiment": 50,
            "sentimentStatus": "Waiting",
            "bearCount": 0,
            "neutralCount": 0,
            "bullCount": 0,
            "bearPct": 0,
            "neutralPct": 0,
            "bullPct": 0,
            "activeCount": 0,
            "price": 0,
            "time": None,
            "indicators": [],
        }

    highs = [_float(c.get("high")) for c in clean]
    lows = [_float(c.get("low")) for c in clean]
    closes = [_float(c.get("close")) for c in clean]
    volumes = [_float(c.get("volume")) for c in clean]
    hlc3 = [(h + l + c) / 3.0 for h, l, c in zip(highs, lows, closes)]

    norm_smooth = int(config.get("technical_norm_smooth", 3))
    ma_type = str(config.get("technical_ma_type", "SMA"))
    bb_type = str(config.get("technical_bb_type", "SMA"))

    enabled = {
        "RSI": bool(config.get("technical_use_rsi", True)),
        "Stochastic": bool(config.get("technical_use_stoch", True)),
        "Stoch RSI": bool(config.get("technical_use_stoch_rsi", True)),
        "CCI": bool(config.get("technical_use_cci", True)),
        "Bull Bear Power": bool(config.get("technical_use_bbp", True)),
        "Momentum": bool(config.get("technical_use_momentum", True)),
        "Moving Average": bool(config.get("technical_use_ma", True)),
        "VWAP": bool(config.get("technical_use_vwap", True)),
        "Bollinger Bands": bool(config.get("technical_use_bb", True)),
        "Supertrend": bool(config.get("technical_use_supertrend", True)),
        "Linear Regression": bool(config.get("technical_use_lr", True)),
        "Market Structure": bool(config.get("technical_use_ms", True)),
    }

    raw_values = [
        ("RSI", _rsi_normalized(closes, int(config.get("technical_rsi_length", 14)))),
        ("Stochastic", _stochastic_normalized(highs, lows, closes, int(config.get("technical_stoch_length", 14)), int(config.get("technical_stoch_smooth", 3)))),
        ("Stoch RSI", _stoch_rsi_normalized(closes, int(config.get("technical_stoch_rsi_rsi_length", 14)), int(config.get("technical_stoch_rsi_length", 14)), int(config.get("technical_stoch_rsi_smooth", 3)))),
        ("CCI", _cci_normalized(hlc3, int(config.get("technical_cci_length", 20)))),
        ("Bull Bear Power", _bull_bear_power_normalized(highs, lows, closes, int(config.get("technical_bbp_length", 13)))),
        ("Momentum", _momentum_normalized(closes, int(config.get("technical_momentum_length", 10)), norm_smooth)),
        ("Moving Average", _moving_average_normalized(closes, volumes, int(config.get("technical_ma_length", 20)), ma_type, norm_smooth)),
        ("VWAP", _vwap_normalized(highs, lows, closes, volumes, float(config.get("technical_vwap_stdev", 2.0)), norm_smooth)),
        ("Bollinger Bands", _bollinger_bands_normalized(closes, volumes, int(config.get("technical_bb_length", 20)), float(config.get("technical_bb_mult", 2.0)), bb_type, norm_smooth)),
        ("Supertrend", _supertrend_normalized(clean, float(config.get("technical_st_factor", 3.0)), int(config.get("technical_st_period", 10)), norm_smooth)),
        ("Linear Regression", _linear_regression_normalized(closes, int(config.get("technical_lr_length", 25)))),
        ("Market Structure", _market_structure_normalized(highs, lows, closes, int(config.get("technical_ms_length", 5)), norm_smooth)),
    ]

    indicators: List[Dict[str, Any]] = []
    for name, value in raw_values:
        if not enabled.get(name, True):
            continue
        v = round(_clamp(float(value), 0.0, 100.0), 2)
        indicators.append({
            "name": name,
            "value": v,
            "signal": _classify_sentiment_value(v),
        })

    bull_count = sum(1 for item in indicators if item["signal"] == "BULLISH")
    bear_count = sum(1 for item in indicators if item["signal"] == "BEARISH")
    neutral_count = sum(1 for item in indicators if item["signal"] == "NEUTRAL")
    active_count = len(indicators)

    if active_count > 0:
        sentiment = sum(float(item["value"]) for item in indicators) / active_count
    else:
        sentiment = 50.0

    bear_pct = bear_count / active_count * 100.0 if active_count else 0.0
    neutral_pct = neutral_count / active_count * 100.0 if active_count else 0.0
    bull_pct = bull_count / active_count * 100.0 if active_count else 0.0

    if bull_count > bear_count and bull_count > neutral_count:
        status = "Mostly Bullish"
    elif bear_count > bull_count and bear_count > neutral_count:
        status = "Mostly Bearish"
    elif neutral_count > bull_count and neutral_count > bear_count:
        status = "Mostly Neutral"
    elif sentiment > 60:
        status = "Mostly Bullish"
    elif sentiment < 40:
        status = "Mostly Bearish"
    else:
        status = "Mixed"

    return {
        "eventType": "PYTHON_TECHNICAL_SENTIMENT",
        "symbol": symbol or clean[-1].get("symbol") or "UNKNOWN",
        "timeframe": timeframe or clean[-1].get("timeframe") or "1m",
        "sentiment": round(_clamp(sentiment, 0.0, 100.0), 2),
        "sentimentStatus": status,
        "bearCount": bear_count,
        "neutralCount": neutral_count,
        "bullCount": bull_count,
        "bearPct": round(bear_pct, 2),
        "neutralPct": round(neutral_pct, 2),
        "bullPct": round(bull_pct, 2),
        "activeCount": active_count,
        "price": closes[-1],
        "time": _epoch_seconds(_time_value(clean[-1])),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "indicators": indicators,
    }

# ─────────────────────────────────────────────────────────────────────────────
# MAIN ENGINE
# ─────────────────────────────────────────────────────────────────────────────

def run_phase1_engine(
    candles: List[Dict[str, Any]],
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    config = config or {}
    clean = _prepare_candles(candles)

    max_events = int(config.get("max_events", 150))
    max_zones = int(config.get("max_zones", 80))
    max_liquidity_events = int(config.get("max_liquidity_events", 120))

    internal_len = int(config.get("internal_pivot_len", 5))
    swing_len = int(config.get("swing_pivot_len", 50))
    equal_threshold = float(config.get("equal_threshold_atr", 0.10))

    if not clean:
        return {
            "engine": "python_smc_alpha_ghost",
            "phase": "phase_4a_technical_sentiment",
            "status": "empty",
            "candles": [],
            "heikinAshiCandles": [],
            "smcEvents": [],
            "zones": [],
            "liquidityEvents": [],
            "dlmLevels": [],
            "dlmConfluenceMarkers": [],
            "alphaProfileBins": [],
            "alphaProfileMeta": {},
            "alphaPoc": None,
            "alphaBuyLiquidity": None,
            "alphaSellLiquidity": None,
            "alphaBullPressure": 50,
            "alphaBearPressure": 50,
            "alphaFvgs": [],
            "alphaSweeps": [],
            "scoreMarkers": [],
            "ghostCandles": [],
            "signal": "NEUTRAL",
            "confidence": 0,
            "bullScore": 50,
            "bearScore": 50,
            "netBias": 0,
            "technicalSentiment": build_technical_sentiment([], config=config),
            "indicators": [],
            "sentiment": 50,
            "sentimentStatus": "Waiting",
            "activeCount": 0,
            "warnings": ["No candles available"],
        }

    ha_candles = build_heikin_ashi(clean)

    internal_pivots = find_pivots(clean, internal_len, "internal")
    swing_pivots = find_pivots(clean, swing_len, "swing")

    internal_events, internal_obs = detect_structure_events(
        clean, internal_pivots, "internal", max_events
    )
    swing_events, swing_obs = detect_structure_events(
        clean, swing_pivots, "swing", max_events
    )

    smc_events = [*internal_events, *swing_events]
    smc_events.sort(key=lambda e: e.get("index", 0))
    smc_events = smc_events[-max_events:]

    zones: List[Dict[str, Any]] = []
    if config.get("show_internal_order_blocks", True):
        zones.extend(internal_obs[-int(config.get("internal_order_blocks_size", 5)):])
    if config.get("show_swing_order_blocks", False):
        zones.extend(swing_obs[-int(config.get("swing_order_blocks_size", 5)):])

    if config.get("show_fair_value_gaps", True):
        zones.extend(detect_fvgs(clean, max_zones))

    if config.get("show_premium_discount_zones", True):
        zones.extend(detect_premium_discount_zones(clean))

    zones = zones[-max_zones:]

    liquidity_events: List[Dict[str, Any]] = []
    if config.get("show_liquidity_pools", True) or config.get("show_equal_highs_lows", True):
        liquidity_events = detect_equal_high_low_and_sweeps(
            clean,
            [*internal_pivots, *swing_pivots],
            equal_threshold,
            max_liquidity_events,
        )

    alpha = build_alphax_dlm(clean, config)

    bull_score = alpha["alphaBullPressure"]
    bear_score = alpha["alphaBearPressure"]

    # Add SMC structure influence to score.
    recent_events = smc_events[-8:]
    smc_bias = 0
    for ev in recent_events:
        if ev.get("direction") == "bullish":
            smc_bias += 1
        elif ev.get("direction") == "bearish":
            smc_bias -= 1

    smc_adjust = _clamp(smc_bias * 2.0, -12.0, 12.0)

    bull_score = _clamp(bull_score + max(smc_adjust, 0.0), 0.0, 100.0)
    bear_score = _clamp(bear_score + max(-smc_adjust, 0.0), 0.0, 100.0)

    # Normalize if both scores got too large.
    score_total = bull_score + bear_score
    if score_total > 100:
        bull_score = bull_score / score_total * 100.0
        bear_score = bear_score / score_total * 100.0

    net_bias = round(bull_score - bear_score, 2)
    confidence = round(min(100.0, abs(net_bias)), 2)
    signal = "BUY" if net_bias > 0 else "SELL" if net_bias < 0 else "NEUTRAL"

    last_close = _float(clean[-1].get("close"))
    symbol = str(config.get("symbol") or clean[-1].get("symbol") or "UNKNOWN")
    timeframe = str(config.get("timeframe") or clean[-1].get("timeframe") or "1m")
    technical_sentiment = build_technical_sentiment(clean, symbol=symbol, timeframe=timeframe, config=config)

    score_markers = [
        {
            "time": _safe_time(clean, len(clean) - 1),
            "price": last_close,
            "label": "Python Score",
            "direction": "bullish" if net_bias >= 0 else "bearish",
            "kind": "python_score",
            "score": confidence,
            "grade": "A" if confidence >= 65 else "B" if confidence >= 35 else "C",
        }
    ]

    warnings: List[str] = []
    if len(clean) < 100:
        warnings.append("Low candle count. SMC/AlphaX quality improves with 300-1000 candles.")
    if not alpha.get("alphaProfileBins"):
        warnings.append("AlphaX profile bins empty. Check candle volume data.")

    return {
        "engine": "python_smc_alpha_ghost",
        "phase": "phase_4a_technical_sentiment",
        "status": "ok",
        "candles": clean,
        "heikinAshiCandles": ha_candles,
        "smcEvents": smc_events,
        "zones": zones,
        "liquidityEvents": liquidity_events,

        # AlphaX / DLM Phase 3A
        "dlmLevels": alpha["dlmLevels"],
        "dlmConfluenceMarkers": alpha["dlmConfluenceMarkers"],
        "alphaProfileBins": alpha["alphaProfileBins"],
        "alphaProfileMeta": alpha["alphaProfileMeta"],
        "alphaPoc": alpha["alphaPoc"],
        "alphaBuyLiquidity": alpha["alphaBuyLiquidity"],
        "alphaSellLiquidity": alpha["alphaSellLiquidity"],
        "alphaBullPressure": alpha["alphaBullPressure"],
        "alphaBearPressure": alpha["alphaBearPressure"],
        "alphaFvgs": alpha["alphaFvgs"],
        "alphaSweeps": alpha["alphaSweeps"],

        # Python Market Sentiment Technical Meter — Phase 4A
        "technicalSentiment": technical_sentiment,
        "sentiment": technical_sentiment["sentiment"],
        "sentimentStatus": technical_sentiment["sentimentStatus"],
        "bearCount": technical_sentiment["bearCount"],
        "neutralCount": technical_sentiment["neutralCount"],
        "bullCount": technical_sentiment["bullCount"],
        "bearPct": technical_sentiment["bearPct"],
        "neutralPct": technical_sentiment["neutralPct"],
        "bullPct": technical_sentiment["bullPct"],
        "activeCount": technical_sentiment["activeCount"],
        "indicators": technical_sentiment["indicators"],

        # Dashboard compatibility
        "scoreMarkers": score_markers,
        "ghostCandles": build_base_ghost_candles(clean, 3),
        "signal": signal,
        "confidence": confidence,
        "bullScore": round(bull_score, 2),
        "bearScore": round(bear_score, 2),
        "netBias": net_bias,
        "price": last_close,
        "smc": "Python SMC Active",
        "alphax": "Python AlphaX DLM Active",
        "ghost": "Python Ghost Base",
        "warnings": warnings,
    }


# Backward compatibility alias.
run_engine = run_phase1_engine
