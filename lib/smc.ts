/**
 * lib/smc.ts
 *
 * Purpose:
 * - Base Smart Money Concepts engine for the dashboard.
 * - Keeps SMC logic separate from chart rendering.
 * - Built to support future overlays on Lightweight Charts:
 *   BOS, CHoCH, MSS, liquidity sweeps, swing levels, and zones.
 *
 * Current role:
 * - Pure calculation helpers only.
 * - Safe to add without changing the UI.
 *
 * Rule:
 * Raw OHLC = truth
 * Heikin Ashi = visual trend filter
 * SMC = structure context
 * Ghost Candles = projected visual path
 */

export type SMCTrend = "bullish" | "bearish" | "neutral";

export type SMCCandleTime = number | string;

export type SMCCandle = {
  time: SMCCandleTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type SwingPointType = "high" | "low";

export type SwingPoint = {
  index: number;
  time: SMCCandleTime;
  price: number;
  type: SwingPointType;
};

export type StructureEventType = "BOS" | "CHoCH" | "MSS";

export type StructureEvent = {
  index: number;
  time: SMCCandleTime;
  type: StructureEventType;
  direction: SMCTrend;
  price: number;
  brokenLevel: number;
  label: string;
  fromIndex: number;
  fromTime: SMCCandleTime;
  pivotIndex: number;
  breakIndex: number;
};

export type LiquiditySweep = {
  index: number;
  time: SMCCandleTime;
  direction: "buySide" | "sellSide";
  sweptLevel: number;
  wickExtreme: number;
  close: number;
  label: string;
};

export type SMCZoneType = "demand" | "supply";

export type SMCZone = {
  startIndex: number;
  endIndex: number;
  startTime: SMCCandleTime;
  endTime: SMCCandleTime;
  high: number;
  low: number;
  type: SMCZoneType;
  sourceEvent?: StructureEventType;
  sourceEventIndex?: number;
  sourceEventTime?: SMCCandleTime;
  sourcePivotIndex?: number;
  label: string;
};

export type SMCAnalysisOptions = {
  swingLength?: number;
  useCloseBreak?: boolean;
  minBreakPercent?: number;
  zoneLookback?: number;
};

export type SMCAnalysisResult = {
  trend: SMCTrend;
  swings: SwingPoint[];
  structureEvents: StructureEvent[];
  liquiditySweeps: LiquiditySweep[];
  zones: SMCZone[];
  latestSwingHigh?: SwingPoint;
  latestSwingLow?: SwingPoint;
  latestEvent?: StructureEvent;
};

const DEFAULT_OPTIONS: Required<SMCAnalysisOptions> = {
  swingLength: 3,
  useCloseBreak: true,
  minBreakPercent: 0,
  zoneLookback: 5,
};

function isValidCandle(candle: SMCCandle | null | undefined): candle is SMCCandle {
  return Boolean(
    candle &&
      candle.time !== undefined &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close)
  );
}

function normalizeOptions(options?: SMCAnalysisOptions): Required<SMCAnalysisOptions> {
  return {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
    swingLength: Math.max(1, Math.floor(options?.swingLength ?? DEFAULT_OPTIONS.swingLength)),
    zoneLookback: Math.max(1, Math.floor(options?.zoneLookback ?? DEFAULT_OPTIONS.zoneLookback)),
    minBreakPercent: Math.max(0, Number(options?.minBreakPercent ?? DEFAULT_OPTIONS.minBreakPercent)),
  };
}

export function normalizeSMCCandles(candles: SMCCandle[]): SMCCandle[] {
  if (!Array.isArray(candles)) return [];

  return candles.filter(isValidCandle);
}

export function detectSwingPoints(
  candles: SMCCandle[],
  swingLength = DEFAULT_OPTIONS.swingLength
): SwingPoint[] {
  const validCandles = normalizeSMCCandles(candles);
  const length = Math.max(1, Math.floor(swingLength));

  if (validCandles.length < length * 2 + 1) return [];

  const swings: SwingPoint[] = [];

  for (let index = length; index < validCandles.length - length; index += 1) {
    const candle = validCandles[index];

    let isSwingHigh = true;
    let isSwingLow = true;

    for (let offset = 1; offset <= length; offset += 1) {
      const left = validCandles[index - offset];
      const right = validCandles[index + offset];

      if (left.high >= candle.high || right.high > candle.high) {
        isSwingHigh = false;
      }

      if (left.low <= candle.low || right.low < candle.low) {
        isSwingLow = false;
      }

      if (!isSwingHigh && !isSwingLow) break;
    }

    if (isSwingHigh) {
      swings.push({
        index,
        time: candle.time,
        price: candle.high,
        type: "high",
      });
    }

    if (isSwingLow) {
      swings.push({
        index,
        time: candle.time,
        price: candle.low,
        type: "low",
      });
    }
  }

  return swings.sort((a, b) => a.index - b.index);
}

function passesBreakThreshold(price: number, level: number, minBreakPercent: number): boolean {
  if (!Number.isFinite(price) || !Number.isFinite(level)) return false;
  if (minBreakPercent <= 0) return true;

  const distancePercent = Math.abs(price - level) / Math.max(Math.abs(level), 0.0000001);
  return distancePercent >= minBreakPercent / 100;
}

export function detectStructureEvents(
  candles: SMCCandle[],
  swings: SwingPoint[],
  options?: SMCAnalysisOptions
): StructureEvent[] {
  const validCandles = normalizeSMCCandles(candles);
  const settings = normalizeOptions(options);

  let lastSwingHigh: SwingPoint | undefined;
  let lastSwingLow: SwingPoint | undefined;
  let trend: SMCTrend = "neutral";

  const events: StructureEvent[] = [];
  const swingsByIndex = new Map<number, SwingPoint[]>();

  for (const swing of swings) {
    const current = swingsByIndex.get(swing.index) ?? [];
    current.push(swing);
    swingsByIndex.set(swing.index, current);
  }

  for (let index = 0; index < validCandles.length; index += 1) {
    const candle = validCandles[index];
    const swingUpdates = swingsByIndex.get(index) ?? [];

    for (const swing of swingUpdates) {
      if (swing.type === "high") lastSwingHigh = swing;
      if (swing.type === "low") lastSwingLow = swing;
    }

    if (lastSwingHigh && index > lastSwingHigh.index) {
      const breakPrice = settings.useCloseBreak ? candle.close : candle.high;
      const brokeHigh =
        breakPrice > lastSwingHigh.price &&
        passesBreakThreshold(breakPrice, lastSwingHigh.price, settings.minBreakPercent);

      if (brokeHigh) {
        const previousTrend = trend;
        const type: StructureEventType =
          previousTrend === "bearish" ? "CHoCH" : previousTrend === "neutral" ? "MSS" : "BOS";

        trend = "bullish";

        events.push({
          index,
          time: candle.time,
          type,
          direction: "bullish",
          price: breakPrice,
          brokenLevel: lastSwingHigh.price,
          label: type,
          fromIndex: lastSwingHigh.index,
          fromTime: lastSwingHigh.time,
          pivotIndex: lastSwingHigh.index,
          breakIndex: index,
        });

        lastSwingHigh = undefined;
      }
    }

    if (lastSwingLow && index > lastSwingLow.index) {
      const breakPrice = settings.useCloseBreak ? candle.close : candle.low;
      const brokeLow =
        breakPrice < lastSwingLow.price &&
        passesBreakThreshold(breakPrice, lastSwingLow.price, settings.minBreakPercent);

      if (brokeLow) {
        const previousTrend = trend;
        const type: StructureEventType =
          previousTrend === "bullish" ? "CHoCH" : previousTrend === "neutral" ? "MSS" : "BOS";

        trend = "bearish";

        events.push({
          index,
          time: candle.time,
          type,
          direction: "bearish",
          price: breakPrice,
          brokenLevel: lastSwingLow.price,
          label: type,
          fromIndex: lastSwingLow.index,
          fromTime: lastSwingLow.time,
          pivotIndex: lastSwingLow.index,
          breakIndex: index,
        });

        lastSwingLow = undefined;
      }
    }
  }

  return events;
}

export function detectLiquiditySweeps(
  candles: SMCCandle[],
  swings: SwingPoint[]
): LiquiditySweep[] {
  const validCandles = normalizeSMCCandles(candles);
  const sweeps: LiquiditySweep[] = [];

  let lastSwingHigh: SwingPoint | undefined;
  let lastSwingLow: SwingPoint | undefined;

  const swingsByIndex = new Map<number, SwingPoint[]>();

  for (const swing of swings) {
    const current = swingsByIndex.get(swing.index) ?? [];
    current.push(swing);
    swingsByIndex.set(swing.index, current);
  }

  for (let index = 0; index < validCandles.length; index += 1) {
    const candle = validCandles[index];
    const swingUpdates = swingsByIndex.get(index) ?? [];

    for (const swing of swingUpdates) {
      if (swing.type === "high") lastSwingHigh = swing;
      if (swing.type === "low") lastSwingLow = swing;
    }

    if (
      lastSwingHigh &&
      index > lastSwingHigh.index &&
      candle.high > lastSwingHigh.price &&
      candle.close < lastSwingHigh.price
    ) {
      sweeps.push({
        index,
        time: candle.time,
        direction: "buySide",
        sweptLevel: lastSwingHigh.price,
        wickExtreme: candle.high,
        close: candle.close,
        label: "Buy-side liquidity sweep",
      });
    }

    if (
      lastSwingLow &&
      index > lastSwingLow.index &&
      candle.low < lastSwingLow.price &&
      candle.close > lastSwingLow.price
    ) {
      sweeps.push({
        index,
        time: candle.time,
        direction: "sellSide",
        sweptLevel: lastSwingLow.price,
        wickExtreme: candle.low,
        close: candle.close,
        label: "Sell-side liquidity sweep",
      });
    }
  }

  return sweeps;
}

function isHighVolatilityCandle(candle: SMCCandle, averageRange: number): boolean {
  if (!Number.isFinite(averageRange) || averageRange <= 0) return false;
  return candle.high - candle.low >= averageRange * 2;
}

function getAverageRange(candles: SMCCandle[], endIndex: number, length = 200): number {
  const start = Math.max(0, endIndex - length + 1);
  const window = candles.slice(start, endIndex + 1);

  if (window.length === 0) return 0;

  return window.reduce((sum, candle) => sum + Math.max(candle.high - candle.low, 0), 0) / window.length;
}

function getParsedHigh(candle: SMCCandle, averageRange: number): number {
  return isHighVolatilityCandle(candle, averageRange) ? candle.low : candle.high;
}

function getParsedLow(candle: SMCCandle, averageRange: number): number {
  return isHighVolatilityCandle(candle, averageRange) ? candle.high : candle.low;
}

function findOrderBlockSourceCandle(
  candles: SMCCandle[],
  event: StructureEvent
): { index: number; candle: SMCCandle; high: number; low: number } | null {
  const validCandles = normalizeSMCCandles(candles);

  if (validCandles.length === 0) return null;

  const start = Math.max(0, Math.min(event.fromIndex ?? event.pivotIndex ?? event.index, event.index));
  const end = Math.max(0, Math.min(event.index, validCandles.length - 1));

  if (end <= start) return null;

  let selectedIndex = start;
  let selectedValue = event.direction === "bearish" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

  for (let index = start; index <= end; index += 1) {
    const candle = validCandles[index];
    const averageRange = getAverageRange(validCandles, index);
    const parsedHigh = getParsedHigh(candle, averageRange);
    const parsedLow = getParsedLow(candle, averageRange);

    // Pine logic:
    // bearish OB = max parsedHigh between pivot and break
    // bullish OB = min parsedLow between pivot and break
    if (event.direction === "bearish") {
      if (parsedHigh > selectedValue) {
        selectedValue = parsedHigh;
        selectedIndex = index;
      }
    } else if (parsedLow < selectedValue) {
      selectedValue = parsedLow;
      selectedIndex = index;
    }
  }

  const selectedCandle = validCandles[selectedIndex];
  const averageRange = getAverageRange(validCandles, selectedIndex);

  return {
    index: selectedIndex,
    candle: selectedCandle,
    high: getParsedHigh(selectedCandle, averageRange),
    low: getParsedLow(selectedCandle, averageRange),
  };
}

function isOrderBlockMitigated(
  zone: SMCZone,
  candles: SMCCandle[],
  useCloseBreak: boolean
): boolean {
  const validCandles = normalizeSMCCandles(candles);
  const start = Math.min(validCandles.length - 1, Math.max(zone.endIndex + 1, zone.startIndex + 1));

  for (let index = start; index < validCandles.length; index += 1) {
    const candle = validCandles[index];
    const bearishMitigationSource = useCloseBreak ? candle.close : candle.high;
    const bullishMitigationSource = useCloseBreak ? candle.close : candle.low;

    if (zone.type === "supply" && bearishMitigationSource > zone.high) return true;
    if (zone.type === "demand" && bullishMitigationSource < zone.low) return true;
  }

  return false;
}

export function buildStructureZones(
  candles: SMCCandle[],
  structureEvents: StructureEvent[],
  options?: SMCAnalysisOptions
): SMCZone[] {
  const validCandles = normalizeSMCCandles(candles);
  const settings = normalizeOptions(options);
  const latestCandle = validCandles[validCandles.length - 1];

  if (!latestCandle) return [];

  const zones: SMCZone[] = [];

  for (const event of structureEvents) {
    const source = findOrderBlockSourceCandle(validCandles, event);

    if (!source) continue;

    const zone: SMCZone = {
      startIndex: source.index,
      endIndex: validCandles.length - 1,
      startTime: source.candle.time,
      endTime: latestCandle.time,
      high: Math.max(source.high, source.low),
      low: Math.min(source.high, source.low),
      type: event.direction === "bullish" ? "demand" : "supply",
      sourceEvent: event.type,
      sourceEventIndex: event.index,
      sourceEventTime: event.time,
      sourcePivotIndex: event.fromIndex ?? event.pivotIndex,
      label: event.direction === "bullish" ? "Bullish OB" : "Bearish OB",
    };

    if (!isOrderBlockMitigated(zone, validCandles, settings.useCloseBreak)) {
      zones.push(zone);
    }
  }

  return zones;
}

export function getLatestSwing(
  swings: SwingPoint[],
  type: SwingPointType
): SwingPoint | undefined {
  for (let index = swings.length - 1; index >= 0; index -= 1) {
    if (swings[index].type === type) return swings[index];
  }

  return undefined;
}

export function getSMCTrendFromEvents(events: StructureEvent[]): SMCTrend {
  const latest = events[events.length - 1];
  return latest?.direction ?? "neutral";
}

export function analyzeSMC(
  candles: SMCCandle[],
  options?: SMCAnalysisOptions
): SMCAnalysisResult {
  const validCandles = normalizeSMCCandles(candles);
  const settings = normalizeOptions(options);

  const swings = detectSwingPoints(validCandles, settings.swingLength);
  const structureEvents = detectStructureEvents(validCandles, swings, settings);
  const liquiditySweeps = detectLiquiditySweeps(validCandles, swings);
  const zones = buildStructureZones(validCandles, structureEvents, settings);

  return {
    trend: getSMCTrendFromEvents(structureEvents),
    swings,
    structureEvents,
    liquiditySweeps,
    zones,
    latestSwingHigh: getLatestSwing(swings, "high"),
    latestSwingLow: getLatestSwing(swings, "low"),
    latestEvent: structureEvents[structureEvents.length - 1],
  };
}

/**
 * Lightweight feature summary for AI / signal logic.
 * This is intentionally small so it can be sent to backend scoring later.
 */
export function getSMCFeatureSummary(result: SMCAnalysisResult) {
  const latestEvent = result.latestEvent;
  const latestSweep = result.liquiditySweeps[result.liquiditySweeps.length - 1];

  return {
    trend: result.trend,
    latestEventType: latestEvent?.type ?? "none",
    latestEventDirection: latestEvent?.direction ?? "neutral",
    latestEventPrice: latestEvent?.price ?? null,
    latestSweepDirection: latestSweep?.direction ?? "none",
    latestSweepLevel: latestSweep?.sweptLevel ?? null,
    swingHigh: result.latestSwingHigh?.price ?? null,
    swingLow: result.latestSwingLow?.price ?? null,
    structureEventCount: result.structureEvents.length,
    liquiditySweepCount: result.liquiditySweeps.length,
    zoneCount: result.zones.length,
  };
}
