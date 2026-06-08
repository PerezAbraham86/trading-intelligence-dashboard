from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


# ─────────────────────────────────────────────────────────────────────────────
# UNIFIED INTELLIGENCE ENGINE
#
# v1 purpose:
# - Create one shared intelligence object from SMC + Liquidity/Profile + SMMA
#   + NRTR + Ghost + External Data + ML feature-store context.
# - This module does NOT draw chart visuals and does NOT fetch data directly.
# - It consumes the already-loaded backend candle payload / overlay payload /
#   external data context so every dashboard panel can reference the same truth.
# ─────────────────────────────────────────────────────────────────────────────

ENGINE_VERSION = "unified_intelligence_v1"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None:
            return fallback
        parsed = float(value)
        if not math.isfinite(parsed):
            return fallback
        return parsed
    except Exception:
        return fallback


def to_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(float(value))
    except Exception:
        return fallback


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def signed_clamp(value: float, magnitude: float = 100.0) -> float:
    return max(-magnitude, min(magnitude, value))


def normalize_direction(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"bull", "bullish", "buy", "long", "up", "1", "+1"}:
        return "bullish"
    if text in {"bear", "bearish", "sell", "short", "down", "-1"}:
        return "bearish"
    if text in {"active", "mixed", "neutral", "flat", "0"}:
        return "neutral"
    return "neutral"


def direction_to_signed(direction: Any, strength: float = 50.0) -> float:
    normalized = normalize_direction(direction)
    score = clamp(strength)
    if normalized == "bullish":
        return score
    if normalized == "bearish":
        return -score
    return 0.0


def safe_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def safe_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def latest_candle(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    return candles[-1] if candles and isinstance(candles[-1], dict) else {}


def calc_smma(values: List[float], length: int = 20) -> List[Optional[float]]:
    if not values or length <= 0:
        return []
    out: List[Optional[float]] = [None] * len(values)
    running: Optional[float] = None
    for index, value in enumerate(values):
        if index < length - 1:
            continue
        if index == length - 1:
            running = sum(values[:length]) / float(length)
        elif running is not None:
            running = (running * (length - 1) + value) / float(length)
        out[index] = running
    return out


def build_smma_component(candles: List[Dict[str, Any]], length: int = 20) -> Dict[str, Any]:
    closes = [to_float(c.get("close"), 0.0) for c in candles if isinstance(c, dict)]
    closes = [value for value in closes if value > 0]
    if len(closes) < max(length + 2, 5):
        current_price = closes[-1] if closes else 0.0
        return {
            "status": "waiting",
            "length": length,
            "direction": "neutral",
            "score": 0,
            "currentPrice": current_price,
            "smma": None,
            "slope": 0,
            "distancePct": 0,
            "reason": "not_enough_candles_for_smma",
        }

    smma_values = calc_smma(closes, length)
    current_smma = next((value for value in reversed(smma_values) if value is not None), None)
    prev_values = [value for value in smma_values[:-1] if value is not None]
    previous_smma = prev_values[-1] if prev_values else current_smma
    current_price = closes[-1]

    if current_smma is None or current_smma <= 0:
        return {
            "status": "unavailable",
            "length": length,
            "direction": "neutral",
            "score": 0,
            "currentPrice": current_price,
            "smma": None,
            "slope": 0,
            "distancePct": 0,
            "reason": "smma_unavailable",
        }

    slope = float(current_smma) - float(previous_smma or current_smma)
    distance_pct = (current_price - float(current_smma)) / max(current_price, 1e-9) * 100.0

    if current_price > current_smma and slope >= 0:
        direction = "bullish"
        score = clamp(52.0 + abs(distance_pct) * 12.0 + abs(slope) / max(current_price, 1.0) * 6000.0)
        reason = "price_above_smma_and_smma_rising"
    elif current_price < current_smma and slope <= 0:
        direction = "bearish"
        score = clamp(52.0 + abs(distance_pct) * 12.0 + abs(slope) / max(current_price, 1.0) * 6000.0)
        reason = "price_below_smma_and_smma_falling"
    elif current_price > current_smma:
        direction = "bullish"
        score = clamp(48.0 + abs(distance_pct) * 8.0)
        reason = "price_above_smma"
    elif current_price < current_smma:
        direction = "bearish"
        score = clamp(48.0 + abs(distance_pct) * 8.0)
        reason = "price_below_smma"
    else:
        direction = "neutral"
        score = 0.0
        reason = "price_at_smma"

    return {
        "status": "active",
        "length": length,
        "direction": direction,
        "score": round(score, 2),
        "currentPrice": round(current_price, 5),
        "smma": round(float(current_smma), 5),
        "slope": round(slope, 8),
        "distancePct": round(distance_pct, 4),
        "reason": reason,
    }


def build_smc_component(overlay_payload: Dict[str, Any]) -> Dict[str, Any]:
    scorecards = safe_dict(overlay_payload.get("scorecards"))
    smc_scorecard = safe_dict(scorecards.get("smc"))
    overall = safe_dict(scorecards.get("overall"))
    smc_events = safe_list(overlay_payload.get("smcEvents"))
    order_blocks = safe_list(overlay_payload.get("orderBlocks"))
    zones = safe_list(overlay_payload.get("zones"))

    bullish_events = to_int(smc_scorecard.get("bullishEvents"), 0)
    bearish_events = to_int(smc_scorecard.get("bearishEvents"), 0)
    quality = to_float(smc_scorecard.get("qualityScore"), 0.0)
    if quality <= 10:
        quality_score = quality * 10.0
    else:
        quality_score = quality

    direction = normalize_direction(smc_scorecard.get("direction") or overall.get("direction"))
    if direction == "neutral":
        if bullish_events > bearish_events:
            direction = "bullish"
        elif bearish_events > bullish_events:
            direction = "bearish"

    if quality_score <= 0 and smc_events:
        quality_score = clamp(40.0 + len(smc_events) * 5.0)

    return {
        "status": "active" if smc_events or order_blocks or quality_score > 0 else "waiting",
        "direction": direction,
        "score": round(clamp(quality_score), 2),
        "qualityScore": round(clamp(quality_score), 2),
        "bullishEvents": bullish_events,
        "bearishEvents": bearish_events,
        "eventCount": len(smc_events),
        "orderBlockCount": len(order_blocks),
        "zoneCount": len(zones),
        "reason": "scorecard_smc_context" if quality_score > 0 else "waiting_for_smc_context",
    }


def build_liquidity_component(overlay_payload: Dict[str, Any]) -> Dict[str, Any]:
    scorecards = safe_dict(overlay_payload.get("scorecards"))
    liquidity_scorecard = safe_dict(scorecards.get("liquidityProfile"))
    order_block_scorecard = safe_dict(scorecards.get("orderBlocks"))
    pd_zone_scorecard = safe_dict(scorecards.get("pdZones"))
    alpha_meta = safe_dict(overlay_payload.get("alphaProfileMeta"))
    profile_bins = safe_list(overlay_payload.get("liquidityProfileBins"))
    dlm_levels = safe_list(overlay_payload.get("dlmLevels"))
    liquidity_events = safe_list(overlay_payload.get("liquidityEvents"))

    bull_pressure = to_float(alpha_meta.get("bullPressurePct"), 50.0)
    bear_pressure = to_float(alpha_meta.get("bearPressurePct"), 50.0)
    profile_quality = to_float(liquidity_scorecard.get("qualityScore"), 0.0)
    if profile_quality <= 10:
        profile_quality *= 10.0
    ob_quality = to_float(order_block_scorecard.get("qualityScore"), 0.0)
    if ob_quality <= 10:
        ob_quality *= 10.0
    pd_quality = to_float(pd_zone_scorecard.get("qualityScore"), 0.0)
    if pd_quality <= 10:
        pd_quality *= 10.0

    if bull_pressure > bear_pressure + 3:
        direction = "bullish"
    elif bear_pressure > bull_pressure + 3:
        direction = "bearish"
    else:
        direction = "neutral"

    score = max(profile_quality, ob_quality, pd_quality, abs(bull_pressure - bear_pressure) + 45 if profile_bins else 0)

    return {
        "status": "active" if profile_bins or dlm_levels or liquidity_events else "waiting",
        "direction": direction,
        "score": round(clamp(score), 2),
        "bullPressurePct": round(clamp(bull_pressure), 2),
        "bearPressurePct": round(clamp(bear_pressure), 2),
        "profileBinCount": len(profile_bins),
        "dlmLevelCount": len(dlm_levels),
        "liquidityEventCount": len(liquidity_events),
        "orderBlockQuality": round(clamp(ob_quality), 2),
        "pdZoneQuality": round(clamp(pd_quality), 2),
        "reason": "alphax_liquidity_profile_context" if profile_bins or dlm_levels else "waiting_for_liquidity_profile",
    }


def build_nrtr_component(overlay_payload: Dict[str, Any], candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    scorecards = safe_dict(overlay_payload.get("scorecards"))
    nrtr = safe_dict(scorecards.get("nrtr"))
    if not nrtr:
        return {
            "status": "waiting",
            "direction": "neutral",
            "score": 0,
            "buyFlip": False,
            "sellFlip": False,
            "entrySignal": False,
            "exitSignal": False,
            "reason": "nrtr_context_missing",
        }

    direction = normalize_direction(nrtr.get("direction") or nrtr.get("trendDirUnified"))
    direction_value = to_int(nrtr.get("directionValue") or nrtr.get("trendDirUnified"), 0)
    if direction == "neutral":
        if direction_value > 0:
            direction = "bullish"
        elif direction_value < 0:
            direction = "bearish"

    buy_flip = bool(nrtr.get("buyFlip"))
    sell_flip = bool(nrtr.get("sellFlip"))
    bars_in_trend = to_int(nrtr.get("barsInTrend"), 0)
    distance_pct = abs(to_float(nrtr.get("distancePercent"), 0.0))
    locked_pct = to_float(nrtr.get("lockedPercent"), 0.0)
    score = clamp(45.0 + min(bars_in_trend, 20) * 1.2 + min(abs(locked_pct), 5.0) * 5.0 - min(distance_pct, 3.0) * 4.0)

    return {
        "status": "active" if direction != "neutral" else "waiting",
        "direction": direction,
        "score": round(score if direction != "neutral" else 0, 2),
        "directionValue": direction_value,
        "trendLine": nrtr.get("trendLineUnified"),
        "buyFlip": buy_flip,
        "sellFlip": sell_flip,
        "entrySignal": buy_flip or sell_flip,
        "exitSignal": buy_flip or sell_flip,
        "barsInTrend": bars_in_trend,
        "entryPrice": nrtr.get("entryPrice"),
        "currentPrice": nrtr.get("currentPrice") or to_float(latest_candle(candles).get("close"), 0.0),
        "distancePercent": nrtr.get("distancePercent"),
        "lockedPercent": nrtr.get("lockedPercent"),
        "reason": "nrtr_flip" if buy_flip or sell_flip else "nrtr_trend_context",
    }


def build_ghost_component(overlay_payload: Dict[str, Any]) -> Dict[str, Any]:
    scorecards = safe_dict(overlay_payload.get("scorecards"))
    ghost_scorecard = safe_dict(scorecards.get("ghost"))
    ghost_candles = safe_list(overlay_payload.get("ghostCandles"))
    ml_features = safe_dict(overlay_payload.get("mlFeatures"))

    direction = normalize_direction(ghost_scorecard.get("direction") or ml_features.get("ghostDirection"))
    confidence = to_float(
        ghost_scorecard.get("confidence")
        or ghost_scorecard.get("confidenceScore")
        or ml_features.get("ghostConfidence"),
        0.0,
    )
    if confidence <= 1 and confidence > 0:
        confidence *= 100.0
    count = to_int(ghost_scorecard.get("count"), len(ghost_candles))

    return {
        "status": "active" if ghost_candles or confidence > 0 or count > 0 else "waiting",
        "direction": direction,
        "score": round(clamp(confidence), 2),
        "confidence": round(clamp(confidence), 2),
        "ghostCount": len(ghost_candles) if ghost_candles else count,
        "projectionAvailable": bool(ghost_candles),
        "reason": "ghost_projection_context" if ghost_candles else "ghost_scorecard_context" if confidence > 0 else "waiting_for_ghost_context",
    }


def build_external_component(external_data: Dict[str, Any]) -> Dict[str, Any]:
    signal_fields = safe_dict(external_data.get("signalFields"))
    scalars = safe_dict(external_data.get("scalars"))
    factors = safe_dict(external_data.get("factors"))

    items = []
    for name in ["optionsFlow", "openInterest", "footprint", "fredMacro", "finraShortVolume", "cot"]:
        factor = safe_dict(factors.get(name))
        label = signal_fields.get(name) or factor.get("label")
        status = str(factor.get("status") or "").lower()
        direction = normalize_direction(factor.get("direction"))
        strength = to_float(factor.get("strength"), 0.0)
        if status in {"active", "live"} or label:
            items.append({
                "name": name,
                "status": status or "active",
                "label": label,
                "direction": direction,
                "strength": clamp(strength),
                "source": factor.get("source"),
            })

    signed_scores = [direction_to_signed(item.get("direction"), to_float(item.get("strength"), 0.0)) for item in items]
    net = sum(signed_scores) / max(len(signed_scores), 1) if items else 0.0
    if net > 8:
        direction = "bullish"
    elif net < -8:
        direction = "bearish"
    else:
        direction = "neutral"

    return {
        "status": "active" if items else "waiting",
        "direction": direction,
        "score": round(abs(net), 2),
        "netScore": round(net, 2),
        "activeCount": len(items),
        "items": items,
        "scalars": scalars,
        "reason": "external_factors_active" if items else "waiting_for_external_factors",
    }


def build_ml_component(overlay_payload: Dict[str, Any], ml_feature_store_status: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    ml_features = safe_dict(overlay_payload.get("mlFeatures"))
    ml_context = safe_dict(overlay_payload.get("mlFeatureContext"))
    calculation_context = safe_dict(overlay_payload.get("calculationContext"))
    store = safe_dict(ml_feature_store_status)

    overall_dir_value = to_float(ml_features.get("overallDirection"), 0.0)
    if overall_dir_value > 0:
        direction = "bullish"
    elif overall_dir_value < 0:
        direction = "bearish"
    else:
        direction = normalize_direction(ml_features.get("direction"))

    confirmation = to_float(
        ml_features.get("overallConfirmationScore")
        or ml_features.get("confirmationScore")
        or ml_features.get("confidence"),
        0.0,
    )
    if confirmation <= 10 and confirmation > 0:
        confirmation *= 10.0

    return {
        "status": "active" if ml_features else "waiting",
        "direction": direction,
        "score": round(clamp(confirmation), 2),
        "featureCount": len(ml_features),
        "contextCount": len(ml_context),
        "calculationContextCount": len(calculation_context),
        "featureStoreEnabled": bool(store.get("enabled")),
        "featureStoreRecorded": bool(store.get("recorded")),
        "outcomesChecked": to_int(safe_dict(store.get("outcomes")).get("checked"), 0),
        "outcomesResolved": to_int(safe_dict(store.get("outcomes")).get("resolved"), 0),
        "reason": "ml_features_active" if ml_features else "waiting_for_ml_features",
    }


def component_signed_score(component: Dict[str, Any]) -> float:
    return direction_to_signed(component.get("direction"), to_float(component.get("score"), 0.0))


def build_market_sentiment(components: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    weights = {
        "smc": 0.16,
        "liquidity": 0.16,
        "smma": 0.12,
        "nrtr": 0.16,
        "ghost": 0.12,
        "external": 0.13,
        "ml": 0.15,
    }

    net = 0.0
    active_weight = 0.0
    contribution: Dict[str, float] = {}

    for name, weight in weights.items():
        component = components.get(name, {})
        if str(component.get("status")) not in {"active", "live"}:
            continue
        signed = component_signed_score(component)
        contribution[name] = round(signed * weight, 4)
        net += signed * weight
        active_weight += weight

    normalized_net = net / max(active_weight, 0.01)
    bull_score = clamp(50.0 + normalized_net / 2.0)
    bear_score = clamp(50.0 - normalized_net / 2.0)
    strength = abs(normalized_net)

    if normalized_net > 18:
        direction = "bullish"
        label = "Unified Bullish"
    elif normalized_net < -18:
        direction = "bearish"
        label = "Unified Bearish"
    else:
        direction = "neutral"
        label = "Unified Neutral"

    return {
        "status": "active" if active_weight > 0 else "waiting",
        "label": label,
        "direction": direction,
        "strength": round(clamp(strength), 2),
        "netScore": round(normalized_net, 2),
        "bullScore": round(bull_score, 2),
        "bearScore": round(bear_score, 2),
        "activeWeight": round(active_weight, 4),
        "contribution": contribution,
    }


def build_ai_trader_plan(
    *,
    symbol: str,
    timeframe: str,
    candles: List[Dict[str, Any]],
    components: Dict[str, Dict[str, Any]],
    market_sentiment: Dict[str, Any],
) -> Dict[str, Any]:
    current_price = to_float(latest_candle(candles).get("close"), 0.0)
    direction = normalize_direction(market_sentiment.get("direction"))
    net_score = to_float(market_sentiment.get("netScore"), 0.0)
    strength = to_float(market_sentiment.get("strength"), 0.0)
    nrtr = components.get("nrtr", {})
    ghost = components.get("ghost", {})
    smc = components.get("smc", {})
    liquidity = components.get("liquidity", {})
    external = components.get("external", {})

    confirmations = []
    conflicts = []
    for name, component in components.items():
        component_direction = normalize_direction(component.get("direction"))
        if component_direction == "neutral" or str(component.get("status")) not in {"active", "live"}:
            continue
        if component_direction == direction:
            confirmations.append(name)
        else:
            conflicts.append(name)

    action = "WAIT"
    entry_signal = False
    exit_signal = False
    reason = "waiting_for_unified_confirmation"

    nrtr_buy = bool(nrtr.get("buyFlip"))
    nrtr_sell = bool(nrtr.get("sellFlip"))

    if direction == "bullish" and strength >= 22 and len(confirmations) >= 3:
        action = "BUY_BIAS"
        entry_signal = nrtr_buy or abs(net_score) >= 35
        exit_signal = nrtr_sell
        reason = "unified_bullish_confirmation"
    elif direction == "bearish" and strength >= 22 and len(confirmations) >= 3:
        action = "SELL_BIAS"
        entry_signal = nrtr_sell or abs(net_score) >= 35
        exit_signal = nrtr_buy
        reason = "unified_bearish_confirmation"
    elif nrtr_buy:
        action = "NRTR_BUY_WATCH"
        entry_signal = True
        reason = "nrtr_buy_flip_waiting_for_full_confirmation"
    elif nrtr_sell:
        action = "NRTR_SELL_WATCH"
        entry_signal = True
        reason = "nrtr_sell_flip_waiting_for_full_confirmation"

    return {
        "status": "active" if candles else "waiting",
        "symbol": symbol,
        "timeframe": timeframe,
        "action": action,
        "direction": direction,
        "entrySignal": entry_signal,
        "exitSignal": exit_signal,
        "currentPrice": round(current_price, 5),
        "confidence": round(clamp(strength), 2),
        "confirmations": confirmations,
        "conflicts": conflicts,
        "reason": reason,
        "nrtrEntryCandidate": bool(nrtr_buy or nrtr_sell),
        "ghostAligned": normalize_direction(ghost.get("direction")) in {direction} if direction != "neutral" else False,
        "smcAligned": normalize_direction(smc.get("direction")) in {direction} if direction != "neutral" else False,
        "liquidityAligned": normalize_direction(liquidity.get("direction")) in {direction} if direction != "neutral" else False,
        "externalAligned": normalize_direction(external.get("direction")) in {direction} if direction != "neutral" else False,
    }


def build_feature_vector(components: Dict[str, Dict[str, Any]], market_sentiment: Dict[str, Any]) -> Dict[str, float]:
    return {
        "smcScore": round(to_float(components.get("smc", {}).get("score"), 0.0), 4),
        "smcSigned": round(component_signed_score(components.get("smc", {})), 4),
        "liquidityScore": round(to_float(components.get("liquidity", {}).get("score"), 0.0), 4),
        "liquiditySigned": round(component_signed_score(components.get("liquidity", {})), 4),
        "smmaScore": round(to_float(components.get("smma", {}).get("score"), 0.0), 4),
        "smmaSigned": round(component_signed_score(components.get("smma", {})), 4),
        "nrtrScore": round(to_float(components.get("nrtr", {}).get("score"), 0.0), 4),
        "nrtrSigned": round(component_signed_score(components.get("nrtr", {})), 4),
        "ghostScore": round(to_float(components.get("ghost", {}).get("score"), 0.0), 4),
        "ghostSigned": round(component_signed_score(components.get("ghost", {})), 4),
        "externalScore": round(to_float(components.get("external", {}).get("score"), 0.0), 4),
        "externalSigned": round(component_signed_score(components.get("external", {})), 4),
        "mlScore": round(to_float(components.get("ml", {}).get("score"), 0.0), 4),
        "mlSigned": round(component_signed_score(components.get("ml", {})), 4),
        "unifiedNetScore": round(to_float(market_sentiment.get("netScore"), 0.0), 4),
        "unifiedBullScore": round(to_float(market_sentiment.get("bullScore"), 0.0), 4),
        "unifiedBearScore": round(to_float(market_sentiment.get("bearScore"), 0.0), 4),
    }


def build_unified_intelligence_object(
    *,
    symbol: str,
    timeframe: str,
    candles: List[Dict[str, Any]],
    overlay_payload: Optional[Dict[str, Any]] = None,
    external_data: Optional[Dict[str, Any]] = None,
    ml_feature_store_status: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    overlay = safe_dict(overlay_payload)
    external = safe_dict(external_data)
    normalized_symbol = str(symbol or "").upper().strip() or "UNKNOWN"
    normalized_timeframe = str(timeframe or "1m").strip() or "1m"

    components: Dict[str, Dict[str, Any]] = {
        "smc": build_smc_component(overlay),
        "liquidity": build_liquidity_component(overlay),
        "smma": build_smma_component(candles, length=20),
        "nrtr": build_nrtr_component(overlay, candles),
        "ghost": build_ghost_component(overlay),
        "external": build_external_component(external),
        "ml": build_ml_component(overlay, ml_feature_store_status),
    }

    market_sentiment = build_market_sentiment(components)
    ai_trader = build_ai_trader_plan(
        symbol=normalized_symbol,
        timeframe=normalized_timeframe,
        candles=candles,
        components=components,
        market_sentiment=market_sentiment,
    )
    feature_vector = build_feature_vector(components, market_sentiment)

    return {
        "eventType": "UNIFIED_INTELLIGENCE",
        "version": ENGINE_VERSION,
        "status": "active" if candles and len(candles) >= 20 else "waiting",
        "symbol": normalized_symbol,
        "timeframe": normalized_timeframe,
        "candlesCount": len(candles),
        "currentPrice": round(to_float(latest_candle(candles).get("close"), 0.0), 5),
        "components": components,
        "marketSentiment": market_sentiment,
        "aiTrader": ai_trader,
        "featureVector": feature_vector,
        "dataFlow": [
            "candles",
            "overlays",
            "scorecards",
            "externalData",
            "unifiedIntelligence",
            "marketSentiment",
            "ghostProjectionLearning",
            "aiEntriesExits",
        ],
        "source": "api.unified_intelligence_engine",
        "createdAt": utc_now_iso(),
    }
