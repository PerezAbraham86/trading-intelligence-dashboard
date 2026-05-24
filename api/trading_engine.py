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
            "phase": "phase_3_alpha_profile",
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
        "phase": "phase_3_alpha_profile",
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
