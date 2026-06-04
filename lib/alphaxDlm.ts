/**
 * lib/alphaxDlm.ts
 *
 * Purpose:
 * - Base AlphaX DLM-style pressure/liquidity engine for the dashboard.
 * - Keeps liquidity/pressure logic separate from chart rendering.
 * - Built to support future overlays on Lightweight Charts:
 *   pressure zones, rejection levels, imbalance context, and ghost candle weighting.
 *
 * Current role:
 * - Pure calculation helpers only.
 * - Safe to add without changing the UI.
 *
 * Rule:
 * Raw OHLC = truth
 * Heikin Ashi = visual trend filter
 * SMC = structure context
 * AlphaX DLM = liquidity and pressure context
 * Ghost Candles = projected visual path
 */

export type AlphaXTrendBias = "bullish" | "bearish" | "neutral";

export type AlphaXCandleTime = number | string;

export type AlphaXCandle = {
  time: AlphaXCandleTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type AlphaXPressureState = {
  index: number;
  time: AlphaXCandleTime;
  bullPressure: number;
  bearPressure: number;
  netPressure: number;
  pressureBias: AlphaXTrendBias;
  bodyStrength: number;
  wickRejectionScore: number;
  volumePressure: number;
  rangeExpansion: number;
};

export type AlphaXRejectionType =
  | "bullishRejection"
  | "bearishRejection"
  | "none";

export type AlphaXRejectionLevel = {
  index: number;
  time: AlphaXCandleTime;
  type: AlphaXRejectionType;
  level: number;
  wickExtreme: number;
  close: number;
  strength: number;
  label: string;
};

export type AlphaXImbalanceType = "bullishImbalance" | "bearishImbalance";

export type AlphaXImbalance = {
  index: number;
  time: AlphaXCandleTime;
  type: AlphaXImbalanceType;
  high: number;
  low: number;
  strength: number;
  label: string;
};

export type AlphaXPressureZoneType =
  | "bullishPressure"
  | "bearishPressure"
  | "neutralPressure";

export type AlphaXPressureZone = {
  startIndex: number;
  endIndex: number;
  startTime: AlphaXCandleTime;
  endTime: AlphaXCandleTime;
  high: number;
  low: number;
  type: AlphaXPressureZoneType;
  averageNetPressure: number;
  label: string;
};

export type AlphaXDLMOptions = {
  lookback?: number;
  rejectionWickPercent?: number;
  imbalanceMinPercent?: number;
  pressureZoneMinBars?: number;
  volumeWeight?: number;
  wickWeight?: number;
  bodyWeight?: number;
};

export type AlphaXDLMAnalysisResult = {
  bias: AlphaXTrendBias;
  pressureStates: AlphaXPressureState[];
  rejectionLevels: AlphaXRejectionLevel[];
  imbalances: AlphaXImbalance[];
  pressureZones: AlphaXPressureZone[];
  latestPressure?: AlphaXPressureState;
  latestRejection?: AlphaXRejectionLevel;
  latestImbalance?: AlphaXImbalance;
};

const DEFAULT_OPTIONS: Required<AlphaXDLMOptions> = {
  lookback: 20,
  rejectionWickPercent: 45,
  imbalanceMinPercent: 0.08,
  pressureZoneMinBars: 3,
  volumeWeight: 0.25,
  wickWeight: 0.35,
  bodyWeight: 0.4,
};

function isValidCandle(candle: AlphaXCandle | null | undefined): candle is AlphaXCandle {
  return Boolean(
    candle &&
      candle.time !== undefined &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close)
  );
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return fallback;
  }

  return numerator / denominator;
}

function normalizeOptions(options?: AlphaXDLMOptions): Required<AlphaXDLMOptions> {
  return {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
    lookback: Math.max(2, Math.floor(options?.lookback ?? DEFAULT_OPTIONS.lookback)),
    rejectionWickPercent: clamp(
      Number(options?.rejectionWickPercent ?? DEFAULT_OPTIONS.rejectionWickPercent),
      1,
      100
    ),
    imbalanceMinPercent: Math.max(
      0,
      Number(options?.imbalanceMinPercent ?? DEFAULT_OPTIONS.imbalanceMinPercent)
    ),
    pressureZoneMinBars: Math.max(
      2,
      Math.floor(options?.pressureZoneMinBars ?? DEFAULT_OPTIONS.pressureZoneMinBars)
    ),
    volumeWeight: Math.max(0, Number(options?.volumeWeight ?? DEFAULT_OPTIONS.volumeWeight)),
    wickWeight: Math.max(0, Number(options?.wickWeight ?? DEFAULT_OPTIONS.wickWeight)),
    bodyWeight: Math.max(0, Number(options?.bodyWeight ?? DEFAULT_OPTIONS.bodyWeight)),
  };
}

export function normalizeAlphaXCandles(candles: AlphaXCandle[]): AlphaXCandle[] {
  if (!Array.isArray(candles)) return [];
  return candles.filter(isValidCandle);
}

export function getAverageRange(candles: AlphaXCandle[], endIndex: number, lookback: number): number {
  const startIndex = Math.max(0, endIndex - lookback + 1);
  const window = candles.slice(startIndex, endIndex + 1);

  if (window.length === 0) return 0;

  const total = window.reduce((sum, candle) => {
    return sum + Math.max(candle.high - candle.low, 0);
  }, 0);

  return total / window.length;
}

export function getAverageVolume(candles: AlphaXCandle[], endIndex: number, lookback: number): number {
  const startIndex = Math.max(0, endIndex - lookback + 1);
  const window = candles.slice(startIndex, endIndex + 1);
  const volumeCandles = window.filter((candle) => Number.isFinite(candle.volume));

  if (volumeCandles.length === 0) return 0;

  const total = volumeCandles.reduce((sum, candle) => sum + Number(candle.volume ?? 0), 0);
  return total / volumeCandles.length;
}

export function calculatePressureStates(
  candles: AlphaXCandle[],
  options?: AlphaXDLMOptions
): AlphaXPressureState[] {
  const validCandles = normalizeAlphaXCandles(candles);
  const settings = normalizeOptions(options);
  const weightTotal = Math.max(
    settings.volumeWeight + settings.wickWeight + settings.bodyWeight,
    0.000001
  );

  return validCandles.map((candle, index) => {
    const range = Math.max(candle.high - candle.low, 0);
    const body = Math.abs(candle.close - candle.open);
    const upperWick = Math.max(candle.high - Math.max(candle.open, candle.close), 0);
    const lowerWick = Math.max(Math.min(candle.open, candle.close) - candle.low, 0);

    const bodyPercent = safeDivide(body, range, 0) * 100;
    const upperWickPercent = safeDivide(upperWick, range, 0) * 100;
    const lowerWickPercent = safeDivide(lowerWick, range, 0) * 100;

    const averageRange = getAverageRange(validCandles, index, settings.lookback);
    const averageVolume = getAverageVolume(validCandles, index, settings.lookback);

    const rangeExpansion = averageRange > 0 ? clamp((range / averageRange) * 100, 0, 300) : 100;
    const volumeExpansion =
      averageVolume > 0 && Number.isFinite(candle.volume)
        ? clamp((Number(candle.volume ?? 0) / averageVolume) * 100, 0, 300)
        : 100;

    const candleDirection = candle.close > candle.open ? 1 : candle.close < candle.open ? -1 : 0;

    const bodyScore = bodyPercent * candleDirection;
    const wickScore = lowerWickPercent - upperWickPercent;
    const volumeScore = (volumeExpansion - 100) * candleDirection;

    const weightedNet =
      (bodyScore * settings.bodyWeight +
        wickScore * settings.wickWeight +
        volumeScore * settings.volumeWeight) /
      weightTotal;

    const netPressure = clamp(50 + weightedNet, 0, 100);

    let pressureBias: AlphaXTrendBias = "neutral";
    if (netPressure >= 57) pressureBias = "bullish";
    else if (netPressure <= 43) pressureBias = "bearish";

    const bullPressure = clamp(netPressure, 0, 100);
    const bearPressure = clamp(100 - netPressure, 0, 100);

    return {
      index,
      time: candle.time,
      bullPressure: Math.round(bullPressure),
      bearPressure: Math.round(bearPressure),
      netPressure: Math.round(netPressure),
      pressureBias,
      bodyStrength: Math.round(bodyPercent),
      wickRejectionScore: Math.round(Math.max(upperWickPercent, lowerWickPercent)),
      volumePressure: Math.round(volumeExpansion),
      rangeExpansion: Math.round(rangeExpansion),
    };
  });
}

export function detectRejectionLevels(
  candles: AlphaXCandle[],
  options?: AlphaXDLMOptions
): AlphaXRejectionLevel[] {
  const validCandles = normalizeAlphaXCandles(candles);
  const settings = normalizeOptions(options);
  const rejections: AlphaXRejectionLevel[] = [];

  for (let index = 0; index < validCandles.length; index += 1) {
    const candle = validCandles[index];
    const range = Math.max(candle.high - candle.low, 0);

    if (range <= 0) continue;

    const upperWick = Math.max(candle.high - Math.max(candle.open, candle.close), 0);
    const lowerWick = Math.max(Math.min(candle.open, candle.close) - candle.low, 0);

    const upperWickPercent = safeDivide(upperWick, range, 0) * 100;
    const lowerWickPercent = safeDivide(lowerWick, range, 0) * 100;

    if (lowerWickPercent >= settings.rejectionWickPercent && candle.close > candle.open) {
      rejections.push({
        index,
        time: candle.time,
        type: "bullishRejection",
        level: candle.low,
        wickExtreme: candle.low,
        close: candle.close,
        strength: Math.round(lowerWickPercent),
        label: "Bullish wick rejection",
      });
    }

    if (upperWickPercent >= settings.rejectionWickPercent && candle.close < candle.open) {
      rejections.push({
        index,
        time: candle.time,
        type: "bearishRejection",
        level: candle.high,
        wickExtreme: candle.high,
        close: candle.close,
        strength: Math.round(upperWickPercent),
        label: "Bearish wick rejection",
      });
    }
  }

  return rejections;
}

export function detectImbalances(
  candles: AlphaXCandle[],
  options?: AlphaXDLMOptions
): AlphaXImbalance[] {
  const validCandles = normalizeAlphaXCandles(candles);
  const settings = normalizeOptions(options);
  const imbalances: AlphaXImbalance[] = [];

  if (validCandles.length < 3) return imbalances;

  for (let index = 2; index < validCandles.length; index += 1) {
    const left = validCandles[index - 2];
    const middle = validCandles[index - 1];
    const current = validCandles[index];

    const middleRange = Math.max(middle.high - middle.low, 0.0000001);

    // Bullish fair-value style gap: current low is above candle two bars back high.
    if (current.low > left.high) {
      const gap = current.low - left.high;
      const strength = safeDivide(gap, middleRange, 0) * 100;

      if (strength >= settings.imbalanceMinPercent) {
        imbalances.push({
          index,
          time: current.time,
          type: "bullishImbalance",
          high: current.low,
          low: left.high,
          strength: Math.round(strength),
          label: "Bullish imbalance",
        });
      }
    }

    // Bearish fair-value style gap: current high is below candle two bars back low.
    if (current.high < left.low) {
      const gap = left.low - current.high;
      const strength = safeDivide(gap, middleRange, 0) * 100;

      if (strength >= settings.imbalanceMinPercent) {
        imbalances.push({
          index,
          time: current.time,
          type: "bearishImbalance",
          high: left.low,
          low: current.high,
          strength: Math.round(strength),
          label: "Bearish imbalance",
        });
      }
    }
  }

  return imbalances;
}

export function buildPressureZones(
  candles: AlphaXCandle[],
  pressureStates: AlphaXPressureState[],
  options?: AlphaXDLMOptions
): AlphaXPressureZone[] {
  const validCandles = normalizeAlphaXCandles(candles);
  const settings = normalizeOptions(options);
  const zones: AlphaXPressureZone[] = [];

  let zoneStartIndex: number | null = null;
  let currentBias: AlphaXTrendBias = "neutral";

  function closeZone(endIndex: number) {
    if (zoneStartIndex === null) return;

    const startIndex = zoneStartIndex;
    const states = pressureStates.slice(startIndex, endIndex + 1);

    if (states.length >= settings.pressureZoneMinBars) {
      const zoneCandles = validCandles.slice(startIndex, endIndex + 1);
      const high = Math.max(...zoneCandles.map((candle) => candle.high));
      const low = Math.min(...zoneCandles.map((candle) => candle.low));
      const averageNetPressure =
        states.reduce((sum, state) => sum + state.netPressure, 0) / states.length;

      const type: AlphaXPressureZoneType =
        currentBias === "bullish"
          ? "bullishPressure"
          : currentBias === "bearish"
            ? "bearishPressure"
            : "neutralPressure";

      zones.push({
        startIndex,
        endIndex,
        startTime: validCandles[startIndex].time,
        endTime: validCandles[endIndex].time,
        high,
        low,
        type,
        averageNetPressure: Math.round(averageNetPressure),
        label:
          type === "bullishPressure"
            ? "Bullish pressure zone"
            : type === "bearishPressure"
              ? "Bearish pressure zone"
              : "Neutral pressure zone",
      });
    }

    zoneStartIndex = null;
  }

  for (let index = 0; index < pressureStates.length; index += 1) {
    const state = pressureStates[index];

    if (zoneStartIndex === null) {
      zoneStartIndex = index;
      currentBias = state.pressureBias;
      continue;
    }

    if (state.pressureBias !== currentBias) {
      closeZone(index - 1);
      zoneStartIndex = index;
      currentBias = state.pressureBias;
    }
  }

  closeZone(pressureStates.length - 1);

  return zones;
}

export function getAlphaXBiasFromPressureStates(
  pressureStates: AlphaXPressureState[]
): AlphaXTrendBias {
  if (pressureStates.length === 0) return "neutral";

  const recent = pressureStates.slice(-5);
  const average =
    recent.reduce((sum, state) => sum + state.netPressure, 0) / Math.max(recent.length, 1);

  if (average >= 57) return "bullish";
  if (average <= 43) return "bearish";

  return "neutral";
}

export function analyzeAlphaXDLM(
  candles: AlphaXCandle[],
  options?: AlphaXDLMOptions
): AlphaXDLMAnalysisResult {
  const validCandles = normalizeAlphaXCandles(candles);
  const pressureStates = calculatePressureStates(validCandles, options);
  const rejectionLevels = detectRejectionLevels(validCandles, options);
  const imbalances = detectImbalances(validCandles, options);
  const pressureZones = buildPressureZones(validCandles, pressureStates, options);

  return {
    bias: getAlphaXBiasFromPressureStates(pressureStates),
    pressureStates,
    rejectionLevels,
    imbalances,
    pressureZones,
    latestPressure: pressureStates[pressureStates.length - 1],
    latestRejection: rejectionLevels[rejectionLevels.length - 1],
    latestImbalance: imbalances[imbalances.length - 1],
  };
}

/**
 * Lightweight feature summary for AI / signal logic.
 * This is intentionally small so it can be sent to backend scoring later.
 */
export function getAlphaXFeatureSummary(result: AlphaXDLMAnalysisResult) {
  return {
    bias: result.bias,
    latestNetPressure: result.latestPressure?.netPressure ?? null,
    latestBullPressure: result.latestPressure?.bullPressure ?? null,
    latestBearPressure: result.latestPressure?.bearPressure ?? null,
    latestPressureBias: result.latestPressure?.pressureBias ?? "neutral",
    latestRejectionType: result.latestRejection?.type ?? "none",
    latestRejectionLevel: result.latestRejection?.level ?? null,
    latestRejectionStrength: result.latestRejection?.strength ?? null,
    latestImbalanceType: result.latestImbalance?.type ?? "none",
    latestImbalanceHigh: result.latestImbalance?.high ?? null,
    latestImbalanceLow: result.latestImbalance?.low ?? null,
    pressureZoneCount: result.pressureZones.length,
    rejectionCount: result.rejectionLevels.length,
    imbalanceCount: result.imbalances.length,
  };
}

/**
 * Combines pressure and rejection into a single ghost candle directional hint.
 * This does not make trade decisions by itself; it only provides context.
 */
export function getAlphaXGhostBiasHint(result: AlphaXDLMAnalysisResult) {
  const pressure = result.latestPressure;
  const rejection = result.latestRejection;

  let score = 50;

  if (pressure) {
    score = pressure.netPressure;
  }

  if (rejection?.type === "bullishRejection") {
    score += Math.min(15, rejection.strength * 0.15);
  }

  if (rejection?.type === "bearishRejection") {
    score -= Math.min(15, rejection.strength * 0.15);
  }

  score = clamp(score, 0, 100);

  return {
    score: Math.round(score),
    bias: score >= 57 ? "bullish" : score <= 43 ? "bearish" : "neutral",
  };
}
