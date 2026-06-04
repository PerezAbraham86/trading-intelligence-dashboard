/**
 * lib/chartOverlayPrep.ts
 *
 * Purpose:
 * - Convert SMC + AlphaX DLM calculations into chart-ready overlay data.
 * - Keeps overlay preparation separate from Lightweight Charts rendering.
 * - This file does not draw anything by itself.
 *
 * Important:
 * - Only true price-based objects should become chart lines.
 * - Pressure scores are NOT price levels, so they belong in the status panel,
 *   not as chart price lines.
 *
 * Rule:
 * Raw OHLC = truth
 * Heikin Ashi = visual trend filter
 * SMC = structure context
 * AlphaX DLM = liquidity and pressure context
 * Ghost Candles = projected visual path
 */

import { analyzeAlphaXDLM, AlphaXCandle, AlphaXDLMAnalysisResult } from "@/lib/alphaxDlm";
import { analyzeSMC, SMCCandle, SMCAnalysisResult } from "@/lib/smc";

export type OverlayTime = number | string;

export type OverlayCandle = {
  time: OverlayTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type OverlayDirection = "bullish" | "bearish" | "neutral";

export type ChartOverlayLine = {
  id: string;
  type:
    | "swingHigh"
    | "swingLow"
    | "bos"
    | "choch"
    | "mss"
    | "liquiditySweep"
    | "rejection"
    | "imbalance"
    | "pressure";
  label: string;
  price: number;
  time: OverlayTime;
  direction: OverlayDirection;
  strength?: number;
};

export type ChartOverlayZone = {
  id: string;
  type:
    | "demand"
    | "supply"
    | "bullishPressure"
    | "bearishPressure"
    | "neutralPressure"
    | "bullishImbalance"
    | "bearishImbalance";
  label: string;
  startTime: OverlayTime;
  endTime: OverlayTime;
  high: number;
  low: number;
  direction: OverlayDirection;
  strength?: number;
};

export type ChartOverlayMarker = {
  id: string;
  time: OverlayTime;
  price: number;
  label: string;
  direction: OverlayDirection;
  type:
    | "BOS"
    | "CHoCH"
    | "MSS"
    | "Sweep"
    | "Rejection"
    | "Imbalance"
    | "Pressure";
  strength?: number;
};

export type ChartOverlaySummary = {
  smcTrend: OverlayDirection;
  alphaXBias: OverlayDirection;
  combinedBias: OverlayDirection;
  confidenceHint: number;
  latestStructureLabel: string;
  latestPressureLabel: string;
  latestRejectionLabel: string;
  lineCount: number;
  zoneCount: number;
  markerCount: number;
};

export type ChartOverlayPayload = {
  smc: SMCAnalysisResult;
  alphaX: AlphaXDLMAnalysisResult;
  lines: ChartOverlayLine[];
  zones: ChartOverlayZone[];
  markers: ChartOverlayMarker[];
  summary: ChartOverlaySummary;
};

export type ChartOverlayPrepOptions = {
  smcSwingLength?: number;
  smcUseCloseBreak?: boolean;
  smcMinBreakPercent?: number;
  alphaXLookback?: number;
  alphaXRejectionWickPercent?: number;
  maxLines?: number;
  maxZones?: number;
  maxMarkers?: number;
};

const DEFAULT_OPTIONS: Required<ChartOverlayPrepOptions> = {
  smcSwingLength: 3,
  smcUseCloseBreak: true,
  smcMinBreakPercent: 0,
  alphaXLookback: 20,
  alphaXRejectionWickPercent: 45,
  maxLines: 10,
  maxZones: 20,
  maxMarkers: 40,
};

function normalizeOptions(options?: ChartOverlayPrepOptions): Required<ChartOverlayPrepOptions> {
  return {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
    smcSwingLength: Math.max(1, Math.floor(options?.smcSwingLength ?? DEFAULT_OPTIONS.smcSwingLength)),
    smcMinBreakPercent: Math.max(0, Number(options?.smcMinBreakPercent ?? DEFAULT_OPTIONS.smcMinBreakPercent)),
    alphaXLookback: Math.max(2, Math.floor(options?.alphaXLookback ?? DEFAULT_OPTIONS.alphaXLookback)),
    alphaXRejectionWickPercent: Math.max(
      1,
      Math.min(100, Number(options?.alphaXRejectionWickPercent ?? DEFAULT_OPTIONS.alphaXRejectionWickPercent))
    ),
    maxLines: Math.max(1, Math.floor(options?.maxLines ?? DEFAULT_OPTIONS.maxLines)),
    maxZones: Math.max(1, Math.floor(options?.maxZones ?? DEFAULT_OPTIONS.maxZones)),
    maxMarkers: Math.max(1, Math.floor(options?.maxMarkers ?? DEFAULT_OPTIONS.maxMarkers)),
  };
}

function isValidOverlayCandle(candle: OverlayCandle | null | undefined): candle is OverlayCandle {
  return Boolean(
    candle &&
      candle.time !== undefined &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close)
  );
}

export function normalizeOverlayCandles(candles: OverlayCandle[]): OverlayCandle[] {
  if (!Array.isArray(candles)) return [];
  return candles.filter(isValidOverlayCandle);
}

function toSMCCandles(candles: OverlayCandle[]): SMCCandle[] {
  return candles.map((candle) => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
}

function toAlphaXCandles(candles: OverlayCandle[]): AlphaXCandle[] {
  return candles.map((candle) => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
}

function normalizeDirection(value: string | undefined): OverlayDirection {
  if (value === "bullish" || value === "bearish") return value;
  return "neutral";
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getCombinedBias(
  smcTrend: OverlayDirection,
  alphaXBias: OverlayDirection
): OverlayDirection {
  if (smcTrend === alphaXBias) return smcTrend;
  if (smcTrend !== "neutral" && alphaXBias === "neutral") return smcTrend;
  if (smcTrend === "neutral" && alphaXBias !== "neutral") return alphaXBias;
  return "neutral";
}

function getConfidenceHint(
  smcTrend: OverlayDirection,
  alphaXBias: OverlayDirection,
  smcEvents: number,
  alphaNetPressure: number | null
): number {
  let score = 50;

  if (smcTrend === "bullish") score += 10;
  if (smcTrend === "bearish") score -= 10;

  if (alphaNetPressure !== null) {
    score = (score + alphaNetPressure) / 2;
  }

  if (smcTrend !== "neutral" && smcTrend === alphaXBias) {
    score += smcTrend === "bullish" ? 10 : -10;
  }

  if (smcEvents > 0) {
    score += smcTrend === "bullish" ? 3 : smcTrend === "bearish" ? -3 : 0;
  }

  return clampPercent(score);
}

function getCurrentPrice(candles: OverlayCandle[]): number | null {
  const last = candles[candles.length - 1];
  if (!last || !Number.isFinite(last.close)) return null;
  return last.close;
}

function isNearCurrentPrice(line: ChartOverlayLine, currentPrice: number | null, maxDistancePercent = 8): boolean {
  if (!currentPrice || !Number.isFinite(currentPrice) || currentPrice <= 0) return true;
  return Math.abs(line.price - currentPrice) / currentPrice <= maxDistancePercent / 100;
}

function dedupeLinesByPrice(lines: ChartOverlayLine[], tickSizePercent = 0.035): ChartOverlayLine[] {
  const result: ChartOverlayLine[] = [];

  for (const line of lines) {
    const duplicate = result.some((existing) => {
      const base = Math.max(Math.abs(existing.price), 0.0000001);
      return Math.abs(existing.price - line.price) / base <= tickSizePercent / 100;
    });

    if (!duplicate) {
      result.push(line);
    }
  }

  return result;
}

function prioritizeLines(lines: ChartOverlayLine[]): ChartOverlayLine[] {
  const priority: Record<ChartOverlayLine["type"], number> = {
    bos: 100,
    choch: 95,
    mss: 90,
    liquiditySweep: 85,
    rejection: 80,
    swingHigh: 55,
    swingLow: 55,
    imbalance: 40,
    pressure: 0,
  };

  return [...lines].sort((a, b) => {
    const priorityDiff = (priority[b.type] ?? 0) - (priority[a.type] ?? 0);
    if (priorityDiff !== 0) return priorityDiff;
    return String(b.time).localeCompare(String(a.time));
  });
}

export function buildSMCLines(smc: SMCAnalysisResult, maxLines = DEFAULT_OPTIONS.maxLines): ChartOverlayLine[] {
  const lines: ChartOverlayLine[] = [];

  const latestSwingHigh = smc.latestSwingHigh;
  const latestSwingLow = smc.latestSwingLow;

  if (latestSwingHigh) {
    lines.push({
      id: `swing-high-${latestSwingHigh.index}`,
      type: "swingHigh",
      label: "Swing high",
      price: latestSwingHigh.price,
      time: latestSwingHigh.time,
      direction: "neutral",
    });
  }

  if (latestSwingLow) {
    lines.push({
      id: `swing-low-${latestSwingLow.index}`,
      type: "swingLow",
      label: "Swing low",
      price: latestSwingLow.price,
      time: latestSwingLow.time,
      direction: "neutral",
    });
  }

  for (const event of smc.structureEvents.slice(-6)) {
    lines.push({
      id: `structure-${event.type}-${event.index}`,
      type:
        event.type === "BOS"
          ? "bos"
          : event.type === "CHoCH"
            ? "choch"
            : "mss",
      label: event.label,
      price: event.brokenLevel,
      time: event.time,
      direction: normalizeDirection(event.direction),
    });
  }

  for (const sweep of smc.liquiditySweeps.slice(-4)) {
    lines.push({
      id: `sweep-${sweep.direction}-${sweep.index}`,
      type: "liquiditySweep",
      label: sweep.label,
      price: sweep.sweptLevel,
      time: sweep.time,
      direction: sweep.direction === "buySide" ? "bearish" : "bullish",
    });
  }

  return prioritizeLines(lines).slice(0, maxLines);
}

export function buildSMCZones(smc: SMCAnalysisResult, maxZones = DEFAULT_OPTIONS.maxZones): ChartOverlayZone[] {
  return smc.zones.slice(-maxZones).map((zone, index) => ({
    id: `smc-zone-${zone.type}-${zone.startIndex}-${zone.endIndex}-${index}`,
    type: zone.type,
    label: zone.label,
    startTime: zone.startTime,
    endTime: zone.endTime,
    high: zone.high,
    low: zone.low,
    direction: zone.type === "demand" ? "bullish" : "bearish",
  }));
}

export function buildAlphaXLines(
  alphaX: AlphaXDLMAnalysisResult,
  maxLines = DEFAULT_OPTIONS.maxLines
): ChartOverlayLine[] {
  /**
   * Only rejection levels are real price levels.
   * Pressure states are scores, not prices, so they are intentionally excluded here.
   */
  return alphaX.rejectionLevels.slice(-6).map((rejection, index) => ({
    id: `alphax-rejection-${rejection.type}-${rejection.index}-${index}`,
    type: "rejection",
    label: rejection.label,
    price: rejection.level,
    time: rejection.time,
    direction:
      rejection.type === "bullishRejection"
        ? "bullish"
        : rejection.type === "bearishRejection"
          ? "bearish"
          : "neutral",
    strength: rejection.strength,
  })).slice(-maxLines);
}

export function buildAlphaXZones(
  alphaX: AlphaXDLMAnalysisResult,
  maxZones = DEFAULT_OPTIONS.maxZones
): ChartOverlayZone[] {
  const imbalanceZones: ChartOverlayZone[] = alphaX.imbalances.map((imbalance, index) => ({
    id: `imbalance-${imbalance.type}-${imbalance.index}-${index}`,
    type: imbalance.type,
    label: imbalance.label,
    startTime: imbalance.time,
    endTime: imbalance.time,
    high: imbalance.high,
    low: imbalance.low,
    direction: imbalance.type === "bullishImbalance" ? "bullish" : "bearish",
    strength: imbalance.strength,
  }));

  const pressureZones: ChartOverlayZone[] = alphaX.pressureZones.map((zone, index) => ({
    id: `pressure-zone-${zone.type}-${zone.startIndex}-${zone.endIndex}-${index}`,
    type: zone.type,
    label: zone.label,
    startTime: zone.startTime,
    endTime: zone.endTime,
    high: zone.high,
    low: zone.low,
    direction:
      zone.type === "bullishPressure"
        ? "bullish"
        : zone.type === "bearishPressure"
          ? "bearish"
          : "neutral",
    strength: zone.averageNetPressure,
  }));

  return [...imbalanceZones, ...pressureZones].slice(-maxZones);
}

export function buildOverlayMarkers(
  smc: SMCAnalysisResult,
  alphaX: AlphaXDLMAnalysisResult,
  maxMarkers = DEFAULT_OPTIONS.maxMarkers
): ChartOverlayMarker[] {
  const structureMarkers: ChartOverlayMarker[] = smc.structureEvents.map((event, index) => ({
    id: `marker-structure-${event.type}-${event.index}-${index}`,
    time: event.time,
    price: event.price,
    label: event.label,
    direction: normalizeDirection(event.direction),
    type: event.type,
  }));

  const sweepMarkers: ChartOverlayMarker[] = smc.liquiditySweeps.map((sweep, index) => ({
    id: `marker-sweep-${sweep.direction}-${sweep.index}-${index}`,
    time: sweep.time,
    price: sweep.wickExtreme,
    label: sweep.label,
    direction: sweep.direction === "buySide" ? "bearish" : "bullish",
    type: "Sweep",
  }));

  const rejectionMarkers: ChartOverlayMarker[] = alphaX.rejectionLevels.map((rejection, index) => ({
    id: `marker-rejection-${rejection.type}-${rejection.index}-${index}`,
    time: rejection.time,
    price: rejection.level,
    label: rejection.label,
    direction:
      rejection.type === "bullishRejection"
        ? "bullish"
        : rejection.type === "bearishRejection"
          ? "bearish"
          : "neutral",
    type: "Rejection",
    strength: rejection.strength,
  }));

  return [...structureMarkers, ...sweepMarkers, ...rejectionMarkers].slice(-maxMarkers);
}

export function buildOverlaySummary(
  smc: SMCAnalysisResult,
  alphaX: AlphaXDLMAnalysisResult,
  lines: ChartOverlayLine[],
  zones: ChartOverlayZone[],
  markers: ChartOverlayMarker[]
): ChartOverlaySummary {
  const smcTrend = normalizeDirection(smc.trend);
  const alphaXBias = normalizeDirection(alphaX.bias);
  const combinedBias = getCombinedBias(smcTrend, alphaXBias);
  const latestAlphaPressure = alphaX.latestPressure?.netPressure ?? null;

  return {
    smcTrend,
    alphaXBias,
    combinedBias,
    confidenceHint: getConfidenceHint(
      smcTrend,
      alphaXBias,
      smc.structureEvents.length,
      latestAlphaPressure
    ),
    latestStructureLabel: smc.latestEvent?.label ?? "No structure event",
    latestPressureLabel: alphaX.latestPressure
      ? `${alphaX.latestPressure.pressureBias} pressure ${alphaX.latestPressure.netPressure}%`
      : "No pressure state",
    latestRejectionLabel: alphaX.latestRejection?.label ?? "No rejection level",
    lineCount: lines.length,
    zoneCount: zones.length,
    markerCount: markers.length,
  };
}

export function buildChartOverlayPayload(
  candles: OverlayCandle[],
  options?: ChartOverlayPrepOptions
): ChartOverlayPayload {
  const validCandles = normalizeOverlayCandles(candles);
  const settings = normalizeOptions(options);

  const smc = analyzeSMC(toSMCCandles(validCandles), {
    swingLength: settings.smcSwingLength,
    useCloseBreak: settings.smcUseCloseBreak,
    minBreakPercent: settings.smcMinBreakPercent,
  });

  const alphaX = analyzeAlphaXDLM(toAlphaXCandles(validCandles), {
    lookback: settings.alphaXLookback,
    rejectionWickPercent: settings.alphaXRejectionWickPercent,
  });

  const currentPrice = getCurrentPrice(validCandles);

  const rawLines = [
    ...buildSMCLines(smc, settings.maxLines),
    ...buildAlphaXLines(alphaX, settings.maxLines),
  ];

  const lines = dedupeLinesByPrice(
    prioritizeLines(rawLines.filter((line) => isNearCurrentPrice(line, currentPrice, 8)))
  ).slice(0, settings.maxLines);

  const zones = [
    ...buildSMCZones(smc, settings.maxZones),
    ...buildAlphaXZones(alphaX, settings.maxZones),
  ].slice(-settings.maxZones);

  const markers = buildOverlayMarkers(smc, alphaX, settings.maxMarkers);

  const summary = buildOverlaySummary(smc, alphaX, lines, zones, markers);

  return {
    smc,
    alphaX,
    lines,
    zones,
    markers,
    summary,
  };
}
