from __future__ import annotations

import argparse
import json
import math
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


# ─────────────────────────────────────────────────────────────────────────────
# MARKETBOS GHOST ML OPTIMIZER
# ─────────────────────────────────────────────────────────────────────────────
#
# Purpose:
# - Reads persistent ghost ML memory created by api/ghost_ml.py.
# - Analyzes evaluated ghost projections.
# - Finds which SMC / AlphaX DLM / OrderBlock / FVG / sweep contexts perform best.
# - Exports optimized ghost confidence/projection settings.
#
# Important hierarchy:
# - Uses: SMC, AlphaX/DLM liquidity, OrderBlocks, PD zones, FVG, sweeps,
#         displacement/inducement style context, and ghost history.
# - Does NOT use NRTR.
# - Does NOT use SMMA.
# - NRTR/SMMA remain chart/entry/exit/strategy tools only.
#
# Outputs:
# - /tmp/trading_dashboard_ghost_optimizer.json by default
# - optional Pine/plain text style block for quick inspection
#
# CLI:
#   python optimizer.py
#   python optimizer.py --symbol MES1! --timeframe 1m
#   python optimizer.py --memory-file /tmp/trading_dashboard_ghost_ml_memory.json
# ─────────────────────────────────────────────────────────────────────────────


DEFAULT_MEMORY_FILE = Path(os.getenv("GHOST_ML_STORE_FILE", "/tmp/trading_dashboard_ghost_ml_memory.json"))
DEFAULT_OUTPUT_FILE = Path(os.getenv("GHOST_OPTIMIZER_OUTPUT_FILE", "/tmp/trading_dashboard_ghost_optimizer.json"))
DEFAULT_TEXT_OUTPUT_FILE = Path(os.getenv("GHOST_OPTIMIZER_TEXT_FILE", "/tmp/trading_dashboard_ghost_optimizer.txt"))

MIN_SAMPLES_FOR_BUCKET = int(os.getenv("GHOST_OPTIMIZER_MIN_BUCKET_SAMPLES", "5"))
MIN_SAMPLES_FOR_READY = int(os.getenv("GHOST_OPTIMIZER_MIN_READY_SAMPLES", "30"))


# ─────────────────────────────────────────────────────────────────────────────
# BASIC HELPERS
# ─────────────────────────────────────────────────────────────────────────────


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        if value is None:
            return fallback
        parsed = float(value)
        if parsed != parsed:
            return fallback
        if not math.isfinite(parsed):
            return fallback
        return parsed
    except Exception:
        return fallback


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def normalize_symbol(symbol: str) -> str:
    raw = str(symbol or "").strip().upper()
    raw = (
        raw.replace("BINANCE:", "")
        .replace("COINBASE:", "")
        .replace("CRYPTO:", "")
        .replace("CME_MINI:", "")
        .replace("CME:", "")
        .replace("AMEX:", "")
        .replace("NASDAQ:", "")
        .replace("NYSE:", "")
    )
    raw = raw.replace("-", "").replace("_", "")

    if raw in {"MES", "MES1", "MES1!", "/MES", "MES=F"}:
        return "MES1!"
    if raw in {"ES", "ES1", "ES1!", "/ES", "ES=F"}:
        return "ES1!"
    if "MES" in raw:
        return "MES1!"
    if "ES" in raw and "MES" not in raw:
        return "ES1!"
    if "BTC" in raw:
        return "BTCUSD"
    if "ETH" in raw:
        return "ETHUSD"
    if "SPY" in raw:
        return "SPY"

    return raw


def normalize_timeframe(timeframe: str) -> str:
    tf = str(timeframe or "").strip().lower()
    mapping = {
        "1": "1m", "1m": "1m", "1min": "1m", "1minute": "1m",
        "3": "3m", "3m": "3m", "3min": "3m", "3minute": "3m",
        "5": "5m", "5m": "5m", "5min": "5m", "5minute": "5m",
        "10": "10m", "10m": "10m", "10min": "10m", "10minute": "10m",
        "15": "15m", "15m": "15m", "15min": "15m", "15minute": "15m",
        "30": "30m", "30m": "30m", "30min": "30m", "30minute": "30m",
        "60": "1h", "1h": "1h", "60m": "1h",
        "120": "2h", "2h": "2h", "120m": "2h",
        "240": "4h", "4h": "4h", "240m": "4h",
        "d": "1d", "1d": "1d", "day": "1d", "1day": "1d",
        "w": "1w", "1w": "1w", "week": "1w", "1week": "1w",
    }
    return mapping.get(tf, tf)


def is_evaluated(record: Dict[str, Any]) -> bool:
    return (
        isinstance(record, dict)
        and record.get("status") == "evaluated"
        and isinstance(record.get("evaluation"), dict)
    )


def direction_from_record(record: Dict[str, Any]) -> str:
    direction = str(record.get("projectedDirection") or "").lower()
    if "bull" in direction:
        return "bullish"
    if "bear" in direction:
        return "bearish"
    return "neutral"


def feature(record: Dict[str, Any], key: str, fallback: Any = None) -> Any:
    features = record.get("features")
    if not isinstance(features, dict):
        return fallback
    return features.get(key, fallback)


def feature_direction(record: Dict[str, Any], key: str) -> str:
    value = str(feature(record, key, "neutral") or "neutral").lower()
    if "bull" in value:
        return "bullish"
    if "bear" in value:
        return "bearish"
    return "neutral"


def align_score(projected_direction: str, factor_direction: str) -> int:
    if projected_direction not in {"bullish", "bearish"}:
        return 0
    if factor_direction == projected_direction:
        return 1
    if factor_direction in {"bullish", "bearish"} and factor_direction != projected_direction:
        return -1
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# LOAD / SAVE
# ─────────────────────────────────────────────────────────────────────────────


def load_records(memory_file: Path = DEFAULT_MEMORY_FILE) -> List[Dict[str, Any]]:
    if not memory_file.exists():
        return []

    with memory_file.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    records = payload.get("records") if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        return []

    return [record for record in records if isinstance(record, dict)]


def filter_records(
    records: List[Dict[str, Any]],
    symbol: str = "",
    timeframe: str = "",
) -> List[Dict[str, Any]]:
    normalized_symbol = normalize_symbol(symbol)
    normalized_timeframe = normalize_timeframe(timeframe)

    output = []

    for record in records:
        if normalized_symbol and normalize_symbol(str(record.get("symbol") or "")) != normalized_symbol:
            continue
        if normalized_timeframe and normalize_timeframe(str(record.get("timeframe") or "")) != normalized_timeframe:
            continue
        output.append(record)

    return output


def save_json(payload: Dict[str, Any], output_file: Path = DEFAULT_OUTPUT_FILE) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with output_file.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)


def save_text(payload: Dict[str, Any], output_file: Path = DEFAULT_TEXT_OUTPUT_FILE) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with output_file.open("w", encoding="utf-8") as handle:
        handle.write(format_optimizer_text(payload))


# ─────────────────────────────────────────────────────────────────────────────
# METRICS
# ─────────────────────────────────────────────────────────────────────────────


def summarize(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    evaluated = [record for record in records if is_evaluated(record)]
    pending = [record for record in records if not is_evaluated(record)]

    if not evaluated:
        return {
            "samples": 0,
            "pending": len(pending),
            "directionAccuracy": 0.0,
            "targetHitRate": 0.0,
            "avgQualityScore": 0.0,
            "avgCloseErrorPct": 0.0,
            "avgFavorableMove": 0.0,
            "avgAdverseMove": 0.0,
            "avgMoveAlignment": 0.0,
            "avgBarsToTarget": None,
        }

    bars_to_target_values = [
        to_float(record["evaluation"].get("barsToTarget"), 0)
        for record in evaluated
        if record["evaluation"].get("barsToTarget") is not None
    ]

    return {
        "samples": len(evaluated),
        "pending": len(pending),
        "directionAccuracy": round(
            sum(1 for record in evaluated if record["evaluation"].get("directionCorrect")) / len(evaluated) * 100,
            2,
        ),
        "targetHitRate": round(
            sum(1 for record in evaluated if record["evaluation"].get("targetHit")) / len(evaluated) * 100,
            2,
        ),
        "avgQualityScore": round(
            sum(to_float(record["evaluation"].get("qualityScore"), 0) for record in evaluated) / len(evaluated),
            2,
        ),
        "avgCloseErrorPct": round(
            sum(to_float(record["evaluation"].get("closeErrorPct"), 0) for record in evaluated) / len(evaluated),
            5,
        ),
        "avgFavorableMove": round(
            sum(to_float(record["evaluation"].get("favorableMove"), 0) for record in evaluated) / len(evaluated),
            5,
        ),
        "avgAdverseMove": round(
            sum(to_float(record["evaluation"].get("adverseMove"), 0) for record in evaluated) / len(evaluated),
            5,
        ),
        "avgMoveAlignment": round(
            sum(to_float(record["evaluation"].get("moveAlignment"), 0) for record in evaluated) / len(evaluated),
            2,
        ),
        "avgBarsToTarget": round(sum(bars_to_target_values) / len(bars_to_target_values), 2) if bars_to_target_values else None,
    }


def weighted_quality(summary: Dict[str, Any]) -> float:
    samples = int(summary.get("samples") or 0)
    quality = to_float(summary.get("avgQualityScore"), 0)
    direction = to_float(summary.get("directionAccuracy"), 0)
    target = to_float(summary.get("targetHitRate"), 0)
    alignment = to_float(summary.get("avgMoveAlignment"), 0)
    close_error = to_float(summary.get("avgCloseErrorPct"), 0)

    sample_weight = min(1.0, samples / max(MIN_SAMPLES_FOR_READY, 1))
    raw = (
        quality * 0.42 +
        direction * 0.25 +
        target * 0.20 +
        alignment * 0.08 +
        max(0.0, 100.0 - close_error * 120.0) * 0.05
    )

    # Shrink low-sample buckets toward 50 so tiny lucky samples do not dominate.
    return round(50.0 * (1.0 - sample_weight) + raw * sample_weight, 2)


def confidence_multiplier_from_summary(summary: Dict[str, Any]) -> float:
    quality = to_float(summary.get("avgQualityScore"), 0)
    direction = to_float(summary.get("directionAccuracy"), 0)
    target = to_float(summary.get("targetHitRate"), 0)
    close_error = to_float(summary.get("avgCloseErrorPct"), 0)

    quality_edge = (quality - 50.0) / 50.0
    direction_edge = (direction - 50.0) / 50.0
    target_edge = (target - 40.0) / 60.0
    error_penalty = clamp(close_error * 8.0, 0.0, 0.30)

    return round(clamp(
        1.0 + quality_edge * 0.18 + direction_edge * 0.12 + target_edge * 0.08 - error_penalty,
        0.62,
        1.35,
    ), 4)


def confidence_bonus_from_summary(summary: Dict[str, Any]) -> int:
    quality = to_float(summary.get("avgQualityScore"), 0)
    direction = to_float(summary.get("directionAccuracy"), 0)
    target = to_float(summary.get("targetHitRate"), 0)

    return int(round(clamp(
        (quality - 50.0) * 0.22 +
        (direction - 50.0) * 0.12 +
        (target - 40.0) * 0.05,
        -18,
        18,
    )))


def projection_multiplier_from_summary(summary: Dict[str, Any]) -> float:
    quality = to_float(summary.get("avgQualityScore"), 0)
    target = to_float(summary.get("targetHitRate"), 0)
    close_error = to_float(summary.get("avgCloseErrorPct"), 0)
    error_penalty = clamp(close_error * 8.0, 0.0, 0.30)

    return round(clamp(
        1.0 + (target - 45.0) / 100.0 * 0.16 + (quality - 50.0) / 100.0 * 0.12 - error_penalty,
        0.70,
        1.22,
    ), 4)


# ─────────────────────────────────────────────────────────────────────────────
# GROUPING / FACTOR ANALYSIS
# ─────────────────────────────────────────────────────────────────────────────


def group_by(records: List[Dict[str, Any]], key_fn) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[str(key_fn(record))].append(record)
    return dict(grouped)


def bucket_summary(records: List[Dict[str, Any]], bucket: str) -> Dict[str, Any]:
    summary = summarize(records)
    return {
        "bucket": bucket,
        **summary,
        "weightedQuality": weighted_quality(summary),
        "confidenceMultiplier": confidence_multiplier_from_summary(summary),
        "confidenceBonus": confidence_bonus_from_summary(summary),
        "projectionMultiplier": projection_multiplier_from_summary(summary),
    }


def analyze_buckets(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    evaluated = [record for record in records if is_evaluated(record)]
    grouped = group_by(evaluated, lambda record: record.get("featureBucket") or "unknown")

    buckets = [
        bucket_summary(bucket_records, bucket)
        for bucket, bucket_records in grouped.items()
        if len(bucket_records) >= MIN_SAMPLES_FOR_BUCKET
    ]

    buckets.sort(
        key=lambda item: (
            to_float(item.get("weightedQuality"), 0),
            int(item.get("samples") or 0),
            to_float(item.get("directionAccuracy"), 0),
        ),
        reverse=True,
    )

    return buckets


def analyze_direction_buckets(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    evaluated = [record for record in records if is_evaluated(record)]
    grouped = group_by(evaluated, direction_from_record)

    buckets = [
        bucket_summary(bucket_records, bucket)
        for bucket, bucket_records in grouped.items()
        if len(bucket_records) >= MIN_SAMPLES_FOR_BUCKET
    ]

    buckets.sort(key=lambda item: to_float(item.get("weightedQuality"), 0), reverse=True)
    return buckets


def analyze_factor_alignment(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    evaluated = [record for record in records if is_evaluated(record)]
    factor_keys = [
        ("smc", "smcDirection"),
        ("liquidity", "liquidityDirection"),
        ("orderBlocks", "orderBlockDirection"),
        ("fvg", "fvgDirection"),
        ("pdZones", "pdDirection"),
        ("dlm", "dlmDirection"),
        ("alpha", "alphaDirection"),
    ]

    rows: List[Dict[str, Any]] = []

    for label, key in factor_keys:
        aligned = []
        opposed = []
        neutral = []

        for record in evaluated:
            projected = direction_from_record(record)
            factor_dir = feature_direction(record, key)
            score = align_score(projected, factor_dir)

            if score > 0:
                aligned.append(record)
            elif score < 0:
                opposed.append(record)
            else:
                neutral.append(record)

        aligned_summary = summarize(aligned)
        opposed_summary = summarize(opposed)
        neutral_summary = summarize(neutral)

        rows.append({
            "factor": label,
            "featureKey": key,
            "aligned": {
                **aligned_summary,
                "weightedQuality": weighted_quality(aligned_summary),
            },
            "opposed": {
                **opposed_summary,
                "weightedQuality": weighted_quality(opposed_summary),
            },
            "neutral": {
                **neutral_summary,
                "weightedQuality": weighted_quality(neutral_summary),
            },
            "edge": round(weighted_quality(aligned_summary) - weighted_quality(opposed_summary), 2),
            "recommendedWeight": recommended_factor_weight(aligned_summary, opposed_summary),
        })

    rows.sort(key=lambda item: to_float(item.get("edge"), 0), reverse=True)
    return rows


def recommended_factor_weight(aligned_summary: Dict[str, Any], opposed_summary: Dict[str, Any]) -> float:
    aligned_quality = weighted_quality(aligned_summary)
    opposed_quality = weighted_quality(opposed_summary)
    edge = aligned_quality - opposed_quality
    samples = int(aligned_summary.get("samples") or 0) + int(opposed_summary.get("samples") or 0)

    if samples < MIN_SAMPLES_FOR_BUCKET:
        return 0.0

    return round(clamp(edge / 25.0, -1.5, 2.0), 4)


def analyze_binary_features(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    evaluated = [record for record in records if is_evaluated(record)]
    binary_keys = [
        "hasSweep",
        "hasOrderBlock",
        "hasFvg",
        "hasPdZone",
        "hasDlmLevels",
        "hasProfile",
    ]

    rows: List[Dict[str, Any]] = []

    for key in binary_keys:
        active = [record for record in evaluated if to_float(feature(record, key), 0) > 0]
        inactive = [record for record in evaluated if to_float(feature(record, key), 0) <= 0]

        active_summary = summarize(active)
        inactive_summary = summarize(inactive)

        rows.append({
            "feature": key,
            "active": {
                **active_summary,
                "weightedQuality": weighted_quality(active_summary),
            },
            "inactive": {
                **inactive_summary,
                "weightedQuality": weighted_quality(inactive_summary),
            },
            "edge": round(weighted_quality(active_summary) - weighted_quality(inactive_summary), 2),
            "recommendedWeight": round(clamp((weighted_quality(active_summary) - weighted_quality(inactive_summary)) / 30.0, -1.0, 1.5), 4),
        })

    rows.sort(key=lambda item: to_float(item.get("edge"), 0), reverse=True)
    return rows


def analyze_pressure_ranges(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    evaluated = [record for record in records if is_evaluated(record)]
    rows: List[Dict[str, Any]] = []

    def alpha_net_bucket(record: Dict[str, Any]) -> str:
        net = to_float(feature(record, "alphaPressureNet"), 0)
        projected = direction_from_record(record)

        # Net > 0 means Alpha pressure bullish, Net < 0 means bearish.
        aligned = (projected == "bullish" and net > 0) or (projected == "bearish" and net < 0)
        magnitude = abs(net)

        if magnitude >= 30:
            mag = "strong"
        elif magnitude >= 15:
            mag = "medium"
        elif magnitude >= 5:
            mag = "light"
        else:
            mag = "flat"

        return f"{'aligned' if aligned else 'opposed' if magnitude >= 5 else 'neutral'}_{mag}"

    grouped = group_by(evaluated, alpha_net_bucket)
    for bucket, bucket_records in grouped.items():
        if len(bucket_records) < MIN_SAMPLES_FOR_BUCKET:
            continue
        rows.append(bucket_summary(bucket_records, bucket))

    rows.sort(key=lambda item: to_float(item.get("weightedQuality"), 0), reverse=True)
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# BUILD OPTIMIZED SETTINGS
# ─────────────────────────────────────────────────────────────────────────────


def build_factor_weights(factor_alignment: List[Dict[str, Any]], binary_features: List[Dict[str, Any]]) -> Dict[str, float]:
    weights: Dict[str, float] = {
        "smcWeight": 1.0,
        "liquidityWeight": 1.0,
        "orderBlockWeight": 1.0,
        "fvgWeight": 0.75,
        "pdZoneWeight": 0.65,
        "dlmWeight": 1.0,
        "alphaWeight": 1.0,
        "sweepWeight": 0.75,
        "profileWeight": 0.65,
    }

    factor_map = {
        "smc": "smcWeight",
        "liquidity": "liquidityWeight",
        "orderBlocks": "orderBlockWeight",
        "fvg": "fvgWeight",
        "pdZones": "pdZoneWeight",
        "dlm": "dlmWeight",
        "alpha": "alphaWeight",
    }

    for row in factor_alignment:
        key = factor_map.get(str(row.get("factor")))
        if not key:
            continue

        edge_weight = to_float(row.get("recommendedWeight"), 0)
        weights[key] = round(clamp(weights[key] + edge_weight * 0.25, 0.15, 1.75), 4)

    binary_map = {
        "hasSweep": "sweepWeight",
        "hasOrderBlock": "orderBlockWeight",
        "hasFvg": "fvgWeight",
        "hasPdZone": "pdZoneWeight",
        "hasProfile": "profileWeight",
        "hasDlmLevels": "dlmWeight",
    }

    for row in binary_features:
        key = binary_map.get(str(row.get("feature")))
        if not key:
            continue

        edge_weight = to_float(row.get("recommendedWeight"), 0)
        weights[key] = round(clamp(weights[key] + edge_weight * 0.20, 0.15, 1.85), 4)

    return weights


def build_optimized_settings(
    overall: Dict[str, Any],
    best_buckets: List[Dict[str, Any]],
    direction_buckets: List[Dict[str, Any]],
    pressure_buckets: List[Dict[str, Any]],
    factor_alignment: List[Dict[str, Any]],
    binary_features: List[Dict[str, Any]],
) -> Dict[str, Any]:
    ready = int(overall.get("samples") or 0) >= MIN_SAMPLES_FOR_READY
    base_summary = overall

    best_bucket = best_buckets[0] if best_buckets else None

    active_summary = (
        best_bucket
        if best_bucket and int(best_bucket.get("samples") or 0) >= MIN_SAMPLES_FOR_READY
        else base_summary
    )

    settings = {
        "ready": ready,
        "minSamplesForReady": MIN_SAMPLES_FOR_READY,
        "sampleCount": int(overall.get("samples") or 0),

        "ghostConfidenceMultiplier": confidence_multiplier_from_summary(active_summary),
        "ghostConfidenceBonus": confidence_bonus_from_summary(active_summary),
        "ghostProjectionMultiplier": projection_multiplier_from_summary(active_summary),

        "minimumDisplayConfidence": int(round(clamp(18 + (50 - to_float(overall.get("avgQualityScore"), 0)) * 0.12, 8, 35))),
        "maximumDisplayConfidence": int(round(clamp(88 + (to_float(overall.get("avgQualityScore"), 0) - 50) * 0.10, 70, 96))),

        "factorWeights": build_factor_weights(factor_alignment, binary_features),

        "bestBucket": best_bucket,
        "bestDirectionBucket": direction_buckets[0] if direction_buckets else None,
        "bestPressureBucket": pressure_buckets[0] if pressure_buckets else None,

        "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_GHOST_ONLY",
        "nrtrUsedForMl": 0,
        "smmaUsedForMl": 0,
    }

    # Extra safety: if the global system is weak, compress projection even if one bucket is strong.
    if ready and to_float(overall.get("avgQualityScore"), 0) < 42:
        settings["ghostProjectionMultiplier"] = round(min(to_float(settings["ghostProjectionMultiplier"], 1), 0.92), 4)
        settings["ghostConfidenceMultiplier"] = round(min(to_float(settings["ghostConfidenceMultiplier"], 1), 0.94), 4)
        settings["ghostConfidenceBonus"] = min(int(settings["ghostConfidenceBonus"]), -2)
        settings["safetyMode"] = "compress_projection_due_to_low_quality"
    else:
        settings["safetyMode"] = "normal"

    return settings


# ─────────────────────────────────────────────────────────────────────────────
# MAIN OPTIMIZER
# ─────────────────────────────────────────────────────────────────────────────


def run_optimizer(
    *,
    memory_file: Path = DEFAULT_MEMORY_FILE,
    output_file: Path = DEFAULT_OUTPUT_FILE,
    text_output_file: Path = DEFAULT_TEXT_OUTPUT_FILE,
    symbol: str = "",
    timeframe: str = "",
    save: bool = True,
) -> Dict[str, Any]:
    all_records = load_records(memory_file)
    records = filter_records(all_records, symbol=symbol, timeframe=timeframe)
    evaluated = [record for record in records if is_evaluated(record)]
    pending = [record for record in records if not is_evaluated(record)]

    overall = summarize(records)
    best_buckets = analyze_buckets(records)
    direction_buckets = analyze_direction_buckets(records)
    factor_alignment = analyze_factor_alignment(records)
    binary_features = analyze_binary_features(records)
    pressure_buckets = analyze_pressure_ranges(records)

    optimized_settings = build_optimized_settings(
        overall=overall,
        best_buckets=best_buckets,
        direction_buckets=direction_buckets,
        pressure_buckets=pressure_buckets,
        factor_alignment=factor_alignment,
        binary_features=binary_features,
    )

    payload = {
        "eventType": "GHOST_ML_OPTIMIZER",
        "version": "ghost-optimizer-v1-smc-alpha-dlm-ob-only",
        "createdAt": now_iso(),
        "memoryFile": str(memory_file),
        "outputFile": str(output_file),
        "textOutputFile": str(text_output_file),
        "filters": {
            "symbol": normalize_symbol(symbol) if symbol else "",
            "timeframe": normalize_timeframe(timeframe) if timeframe else "",
        },
        "records": {
            "totalLoaded": len(all_records),
            "matching": len(records),
            "evaluated": len(evaluated),
            "pending": len(pending),
        },
        "overall": overall,
        "optimizedSettings": optimized_settings,
        "bestBuckets": best_buckets[:25],
        "directionBuckets": direction_buckets,
        "pressureBuckets": pressure_buckets[:20],
        "factorAlignment": factor_alignment,
        "binaryFeatures": binary_features,
        "readyForLiveUse": bool(optimized_settings.get("ready")),
        "mlHierarchy": "SMC_ALPHA_DLM_ORDERBLOCKS_GHOST_ONLY",
        "nrtrUsedForMl": 0,
        "smmaUsedForMl": 0,
    }

    if save:
        save_json(payload, output_file)
        save_text(payload, text_output_file)

    return payload


# ─────────────────────────────────────────────────────────────────────────────
# TEXT OUTPUT
# ─────────────────────────────────────────────────────────────────────────────


def format_optimizer_text(payload: Dict[str, Any]) -> str:
    settings = payload.get("optimizedSettings") if isinstance(payload.get("optimizedSettings"), dict) else {}
    overall = payload.get("overall") if isinstance(payload.get("overall"), dict) else {}
    factor_weights = settings.get("factorWeights") if isinstance(settings.get("factorWeights"), dict) else {}

    lines = [
        "MARKETBOS Ghost ML Optimizer",
        "================================",
        f"Created: {payload.get('createdAt')}",
        f"Version: {payload.get('version')}",
        "",
        "ML hierarchy:",
        "  SMC + AlphaX/DLM + Order Blocks + PD Zones + FVG + Sweeps + Ghost History",
        "  NRTR used for ML: 0",
        "  SMMA used for ML: 0",
        "",
        "Records:",
        f"  total loaded: {payload.get('records', {}).get('totalLoaded')}",
        f"  matching: {payload.get('records', {}).get('matching')}",
        f"  evaluated: {payload.get('records', {}).get('evaluated')}",
        f"  pending: {payload.get('records', {}).get('pending')}",
        "",
        "Overall:",
        f"  directionAccuracy: {overall.get('directionAccuracy')}%",
        f"  targetHitRate: {overall.get('targetHitRate')}%",
        f"  avgQualityScore: {overall.get('avgQualityScore')}",
        f"  avgCloseErrorPct: {overall.get('avgCloseErrorPct')}",
        f"  avgMoveAlignment: {overall.get('avgMoveAlignment')}",
        "",
        "Optimized settings:",
        f"  ready: {settings.get('ready')}",
        f"  ghostConfidenceMultiplier: {settings.get('ghostConfidenceMultiplier')}",
        f"  ghostConfidenceBonus: {settings.get('ghostConfidenceBonus')}",
        f"  ghostProjectionMultiplier: {settings.get('ghostProjectionMultiplier')}",
        f"  minimumDisplayConfidence: {settings.get('minimumDisplayConfidence')}",
        f"  maximumDisplayConfidence: {settings.get('maximumDisplayConfidence')}",
        f"  safetyMode: {settings.get('safetyMode')}",
        "",
        "Factor weights:",
    ]

    for key in sorted(factor_weights):
        lines.append(f"  {key}: {factor_weights[key]}")

    best_buckets = payload.get("bestBuckets") if isinstance(payload.get("bestBuckets"), list) else []
    if best_buckets:
        lines.extend(["", "Top buckets:"])
        for item in best_buckets[:10]:
            lines.append(
                f"  quality={item.get('weightedQuality')} samples={item.get('samples')} "
                f"dirAcc={item.get('directionAccuracy')} targetHit={item.get('targetHitRate')} "
                f"bucket={item.get('bucket')}"
            )

    factor_alignment = payload.get("factorAlignment") if isinstance(payload.get("factorAlignment"), list) else []
    if factor_alignment:
        lines.extend(["", "Factor alignment:"])
        for item in factor_alignment:
            lines.append(
                f"  {item.get('factor')}: edge={item.get('edge')} "
                f"weight={item.get('recommendedWeight')} "
                f"alignedQ={item.get('aligned', {}).get('weightedQuality')} "
                f"opposedQ={item.get('opposed', {}).get('weightedQuality')}"
            )

    return "\n".join(lines) + "\n"


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Optimize MARKETBOS ghost ML projection settings.")
    parser.add_argument("--memory-file", default=str(DEFAULT_MEMORY_FILE), help="Path to ghost ML memory JSON.")
    parser.add_argument("--output-file", default=str(DEFAULT_OUTPUT_FILE), help="Path to optimizer JSON output.")
    parser.add_argument("--text-output-file", default=str(DEFAULT_TEXT_OUTPUT_FILE), help="Path to optimizer text output.")
    parser.add_argument("--symbol", default="", help="Optional symbol filter, e.g. MES1!, BTCUSD, ETHUSD, SPY.")
    parser.add_argument("--timeframe", default="", help="Optional timeframe filter, e.g. 1m, 5m, 15m.")
    parser.add_argument("--no-save", action="store_true", help="Do not write output files.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    payload = run_optimizer(
        memory_file=Path(args.memory_file),
        output_file=Path(args.output_file),
        text_output_file=Path(args.text_output_file),
        symbol=args.symbol,
        timeframe=args.timeframe,
        save=not args.no_save,
    )

    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
