/**
 * lib/heikinAshi.ts
 *
 * Purpose:
 * - Keep raw OHLC candles as the master truth.
 * - Calculate Heikin Ashi candles locally for visual trend filtering.
 * - Reusable by the dashboard, chart component, Ghost Candles, and ML feature layer.
 *
 * Rule:
 * Raw OHLC = truth
 * Heikin Ashi = visual trend filter
 */

export type CandleTime = number | string;

export type RawCandle = {
  time: CandleTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type HeikinAshiCandle = {
  time: CandleTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;

  /**
   * Optional reference values from the original real candle.
   * These are useful later if we want HA display but still need
   * exact real price validation in the same object.
   */
  realOpen?: number;
  realHigh?: number;
  realLow?: number;
  realClose?: number;
};

export type HeikinAshiDirection = "bullish" | "bearish" | "neutral";

export type HeikinAshiFeatureCandle = HeikinAshiCandle & {
  direction: HeikinAshiDirection;
  bodySize: number;
  upperWickSize: number;
  lowerWickSize: number;
  totalRange: number;
  bodyPercentOfRange: number;
  isDojiLike: boolean;
};

function isValidCandle(candle: RawCandle | null | undefined): candle is RawCandle {
  return Boolean(
    candle &&
      candle.time !== undefined &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close)
  );
}

/**
 * Calculates Heikin Ashi candles from raw OHLC candles.
 *
 * Formula:
 * HA Close = (Open + High + Low + Close) / 4
 * HA Open = (Previous HA Open + Previous HA Close) / 2
 * HA High = Max(High, HA Open, HA Close)
 * HA Low = Min(Low, HA Open, HA Close)
 *
 * First HA Open:
 * (Open + Close) / 2
 */
export function calculateHeikinAshi(candles: RawCandle[]): HeikinAshiCandle[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];

  const haCandles: HeikinAshiCandle[] = [];

  for (const candle of candles) {
    if (!isValidCandle(candle)) continue;

    const haClose = (candle.open + candle.high + candle.low + candle.close) / 4;

    let haOpen: number;

    if (haCandles.length === 0) {
      haOpen = (candle.open + candle.close) / 2;
    } else {
      const previousHa = haCandles[haCandles.length - 1];
      haOpen = (previousHa.open + previousHa.close) / 2;
    }

    const haHigh = Math.max(candle.high, haOpen, haClose);
    const haLow = Math.min(candle.low, haOpen, haClose);

    haCandles.push({
      time: candle.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      volume: candle.volume,

      realOpen: candle.open,
      realHigh: candle.high,
      realLow: candle.low,
      realClose: candle.close,
    });
  }

  return haCandles;
}

/**
 * Calculates one next Heikin Ashi candle from the previous HA candle
 * and a new real OHLC candle.
 *
 * This is useful for live updates because we do not need to recalculate
 * the entire historical candle array every tick.
 */
export function calculateNextHeikinAshiCandle(
  previousHaCandle: HeikinAshiCandle | null | undefined,
  candle: RawCandle
): HeikinAshiCandle | null {
  if (!isValidCandle(candle)) return null;

  const haClose = (candle.open + candle.high + candle.low + candle.close) / 4;

  const haOpen = previousHaCandle
    ? (previousHaCandle.open + previousHaCandle.close) / 2
    : (candle.open + candle.close) / 2;

  const haHigh = Math.max(candle.high, haOpen, haClose);
  const haLow = Math.min(candle.low, haOpen, haClose);

  return {
    time: candle.time,
    open: haOpen,
    high: haHigh,
    low: haLow,
    close: haClose,
    volume: candle.volume,

    realOpen: candle.open,
    realHigh: candle.high,
    realLow: candle.low,
    realClose: candle.close,
  };
}

/**
 * Adds direction/body/wick features to HA candles.
 * Useful later for:
 * - Ghost Candle projection
 * - trend filtering
 * - AI/ML feature creation
 * - AlphaX / DLM pressure interpretation
 */
export function addHeikinAshiFeatures(
  haCandles: HeikinAshiCandle[],
  dojiBodyPercentThreshold = 20
): HeikinAshiFeatureCandle[] {
  return haCandles.map((candle) => {
    const bodySize = Math.abs(candle.close - candle.open);
    const totalRange = Math.max(candle.high - candle.low, 0);
    const upperWickSize = Math.max(candle.high - Math.max(candle.open, candle.close), 0);
    const lowerWickSize = Math.max(Math.min(candle.open, candle.close) - candle.low, 0);

    const bodyPercentOfRange =
      totalRange > 0 ? (bodySize / totalRange) * 100 : 0;

    let direction: HeikinAshiDirection = "neutral";

    if (candle.close > candle.open) {
      direction = "bullish";
    } else if (candle.close < candle.open) {
      direction = "bearish";
    }

    return {
      ...candle,
      direction,
      bodySize,
      upperWickSize,
      lowerWickSize,
      totalRange,
      bodyPercentOfRange,
      isDojiLike: bodyPercentOfRange <= dojiBodyPercentThreshold,
    };
  });
}

/**
 * Returns either real candles or HA candles based on chart mode.
 * This keeps chart toggling simple and prevents unnecessary API refetches.
 */
export function getDisplayCandles(
  candles: RawCandle[],
  mode: "regular" | "heikinAshi"
): RawCandle[] | HeikinAshiCandle[] {
  if (mode === "heikinAshi") {
    return calculateHeikinAshi(candles);
  }

  return candles;
}

/**
 * Returns the most recent HA direction.
 * Useful for simple dashboard badges and later signal filters.
 */
export function getLatestHeikinAshiDirection(
  candles: RawCandle[]
): HeikinAshiDirection {
  const haCandles = calculateHeikinAshi(candles);
  const latest = haCandles[haCandles.length - 1];

  if (!latest) return "neutral";
  if (latest.close > latest.open) return "bullish";
  if (latest.close < latest.open) return "bearish";

  return "neutral";
}
