/**
 * lib/tradingViewOverlays.ts
 *
 * Parse chartOverlays JSON exported from the TradingView Pine script.
 *
 * Why:
 * - The dashboard should not invent RJ labels, pressure blocks, or fake zones.
 * - Your Pine script already exports the correct overlay groups:
 *   smcEvents, zones, liquidityEvents, dlmLevels, dlmConfluenceMarkers, scoreMarkers.
 *
 * Visual rule:
 * - Use TradingView exported order blocks and zones when available.
 * - Use TradingView exported BOS / CHoCH labels when available.
 * - Use TradingView exported liquidity events when available.
 * - Keep AlphaX pressure as context, not random candle labels.
 */

import {
  ChartOverlayLine,
  ChartOverlayMarker,
  ChartOverlayPayload,
  ChartOverlayZone,
  OverlayDirection,
} from "@/lib/chartOverlayPrep";

type AnyRecord = Record<string, unknown>;

type RawTradingViewOverlayPayload = {
  smcEvents?: RawTradingViewSMCEvent[];
  zones?: RawTradingViewZone[];
  liquidityEvents?: RawTradingViewLiquidityEvent[];
  dlmLevels?: RawTradingViewDlmLevel[];
  dlmConfluenceMarkers?: unknown[];
  scoreMarkers?: unknown[];
};

type RawTradingViewSMCEvent = {
  time?: unknown;
  fromTime?: unknown;
  price?: unknown;
  tag?: unknown;
  direction?: unknown;
  scope?: unknown;
};

type RawTradingViewZone = {
  startTime?: unknown;
  endTime?: unknown;
  top?: unknown;
  bottom?: unknown;
  label?: unknown;
  direction?: unknown;
  kind?: unknown;
};

type RawTradingViewLiquidityEvent = {
  time?: unknown;
  price?: unknown;
  label?: unknown;
  direction?: unknown;
  kind?: unknown;
  touches?: unknown;
};

type RawTradingViewDlmLevel = {
  label?: unknown;
  price?: unknown;
  direction?: unknown;
};

function toNumber(value: unknown, fallback = NaN): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toText(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function normalizeDirection(value: unknown): OverlayDirection {
  const text = toText(value).toLowerCase();

  if (text.includes("bull") || text.includes("buy") || text.includes("long")) return "bullish";
  if (text.includes("bear") || text.includes("sell") || text.includes("short")) return "bearish";

  return "neutral";
}

function normalizeTime(value: unknown): number | string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
  }

  const text = toText(value).trim();

  if (/^\d+$/.test(text)) {
    const parsed = Number(text);
    return parsed > 10_000_000_000 ? Math.floor(parsed / 1000) : parsed;
  }

  return text;
}

function safeJsonParse(value: unknown): unknown {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;

  let text = value.trim();

  if (!text) return null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const parsed = JSON.parse(text);

      if (typeof parsed === "string") {
        text = parsed;
        continue;
      }

      return parsed;
    } catch {
      text = text.replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
    }
  }

  return null;
}

function findRawChartOverlays(source: unknown): RawTradingViewOverlayPayload | null {
  if (!source || typeof source !== "object") return null;

  const record = source as AnyRecord;

  const direct =
    record.chartOverlays ??
    record.chart_overlays ??
    record.overlays ??
    record.tradingViewOverlays ??
    record.tvOverlays;

  const parsedDirect = safeJsonParse(direct);

  if (parsedDirect && typeof parsedDirect === "object") {
    return parsedDirect as RawTradingViewOverlayPayload;
  }

  if (
    Array.isArray(record.smcEvents) ||
    Array.isArray(record.zones) ||
    Array.isArray(record.liquidityEvents) ||
    Array.isArray(record.dlmLevels)
  ) {
    return record as RawTradingViewOverlayPayload;
  }

  return null;
}

function getStructureMarkerType(tag: string): ChartOverlayMarker["type"] {
  const upper = tag.toUpperCase();

  if (upper.includes("CHOCH")) return "CHoCH";
  if (upper.includes("MSS")) return "MSS";
  return "BOS";
}

function getStructureLineType(tag: string): ChartOverlayLine["type"] {
  const upper = tag.toUpperCase();

  if (upper.includes("CHOCH")) return "choch";
  if (upper.includes("MSS")) return "mss";
  return "bos";
}

function zoneKindToType(kind: string, direction: OverlayDirection): ChartOverlayZone["type"] {
  const text = kind.toLowerCase();

  if (text.includes("premium")) return "supply";
  if (text.includes("discount")) return "demand";

  if (text.includes("fvg")) {
    return direction === "bearish" ? "bearishImbalance" : "bullishImbalance";
  }

  if (text.includes("ob")) {
    return direction === "bearish" ? "supply" : "demand";
  }

  return direction === "bearish" ? "supply" : "demand";
}

function normalizeZoneLabel(zone: RawTradingViewZone): string {
  const label = toText(zone.label).trim();

  if (label) return label;

  const kind = toText(zone.kind).toLowerCase();
  const direction = normalizeDirection(zone.direction);

  if (kind.includes("premium")) return "Premium";
  if (kind.includes("discount")) return "Discount";
  if (kind.includes("fvg")) return direction === "bearish" ? "Bearish FVG" : "Bullish FVG";
  if (kind.includes("internal_ob")) return direction === "bearish" ? "Internal Bearish OB" : "Internal Bullish OB";
  if (kind.includes("swing_ob")) return direction === "bearish" ? "Swing Bearish OB" : "Swing Bullish OB";

  return direction === "bearish" ? "Supply" : "Demand";
}

function buildStructureMarkers(events: RawTradingViewSMCEvent[]): ChartOverlayMarker[] {
  return events
    .map((event, index): ChartOverlayMarker | null => {
      const price = toNumber(event.price);
      if (!Number.isFinite(price)) return null;

      const tag = toText(event.tag, "BOS");
      const direction = normalizeDirection(event.direction);

      return {
        id: `tv-smc-marker-${tag}-${index}-${toText(event.time)}`,
        time: normalizeTime(event.time),
        price,
        label: tag,
        direction,
        type: getStructureMarkerType(tag),
      };
    })
    .filter((item): item is ChartOverlayMarker => Boolean(item));
}

function buildStructureLines(events: RawTradingViewSMCEvent[]): ChartOverlayLine[] {
  return events
    .slice(-4)
    .map((event, index): ChartOverlayLine | null => {
      const price = toNumber(event.price);
      if (!Number.isFinite(price)) return null;

      const tag = toText(event.tag, "BOS");

      return {
        id: `tv-smc-line-${tag}-${index}-${toText(event.time)}`,
        type: getStructureLineType(tag),
        label: tag,
        price,
        time: normalizeTime(event.time),
        fromTime: normalizeTime(event.fromTime),
        direction: normalizeDirection(event.direction),
      };
    })
    .filter((item): item is ChartOverlayLine => Boolean(item));
}

function buildZones(zones: RawTradingViewZone[]): ChartOverlayZone[] {
  return zones
    .map((zone, index): ChartOverlayZone | null => {
      const top = toNumber(zone.top);
      const bottom = toNumber(zone.bottom);

      if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;

      const direction = normalizeDirection(zone.direction);
      const kind = toText(zone.kind);

      return {
        id: `tv-zone-${kind || "zone"}-${index}-${toText(zone.startTime)}`,
        type: zoneKindToType(kind, direction),
        label: normalizeZoneLabel(zone),
        startTime: normalizeTime(zone.startTime),
        endTime: normalizeTime(zone.endTime),
        high: Math.max(top, bottom),
        low: Math.min(top, bottom),
        direction,
      };
    })
    .filter((item): item is ChartOverlayZone => Boolean(item));
}

function buildLiquidityMarkers(events: RawTradingViewLiquidityEvent[]): ChartOverlayMarker[] {
  return events
    .map((event, index): ChartOverlayMarker | null => {
      const price = toNumber(event.price);
      if (!Number.isFinite(price)) return null;

      return {
        id: `tv-liquidity-marker-${toText(event.kind)}-${index}-${toText(event.time)}`,
        time: normalizeTime(event.time),
        price,
        label: toText(event.label, "Sweep"),
        direction: normalizeDirection(event.direction),
        type: "Sweep",
        strength: toNumber(event.touches, NaN),
      };
    })
    .filter((item): item is ChartOverlayMarker => Boolean(item));
}

function buildLiquidityLines(events: RawTradingViewLiquidityEvent[]): ChartOverlayLine[] {
  return events
    .slice(-4)
    .map((event, index): ChartOverlayLine | null => {
      const price = toNumber(event.price);
      if (!Number.isFinite(price)) return null;

      return {
        id: `tv-liquidity-line-${toText(event.kind)}-${index}-${toText(event.time)}`,
        type: "liquiditySweep",
        label: toText(event.label, "Liquidity"),
        price,
        time: normalizeTime(event.time),
        direction: normalizeDirection(event.direction),
        strength: toNumber(event.touches, NaN),
      };
    })
    .filter((item): item is ChartOverlayLine => Boolean(item));
}

function buildDlmLines(levels: RawTradingViewDlmLevel[]): ChartOverlayLine[] {
  return levels
    .map((level, index): ChartOverlayLine | null => {
      const price = toNumber(level.price);
      if (!Number.isFinite(price)) return null;

      return {
        id: `tv-dlm-level-${index}-${toText(level.label)}`,
        type: "liquiditySweep",
        label: toText(level.label, "DLM Level"),
        price,
        time: 0,
        direction: normalizeDirection(level.direction),
      };
    })
    .filter((item): item is ChartOverlayLine => Boolean(item));
}

function createEmptyAnalysisObject<T>(): T {
  return {} as T;
}

function getCombinedBiasFromLines(lines: ChartOverlayLine[]): OverlayDirection {
  const recent = lines.slice(-5);
  const bullish = recent.filter((line) => line.direction === "bullish").length;
  const bearish = recent.filter((line) => line.direction === "bearish").length;

  if (bullish > bearish) return "bullish";
  if (bearish > bullish) return "bearish";

  return "neutral";
}

export function buildTradingViewOverlayPayload(source: unknown): ChartOverlayPayload | null {
  const raw = findRawChartOverlays(source);

  if (!raw) return null;

  const smcEvents = Array.isArray(raw.smcEvents) ? raw.smcEvents : [];
  const zonesRaw = Array.isArray(raw.zones) ? raw.zones : [];
  const liquidityEvents = Array.isArray(raw.liquidityEvents) ? raw.liquidityEvents : [];
  const dlmLevels = Array.isArray(raw.dlmLevels) ? raw.dlmLevels : [];

  const structureMarkers = buildStructureMarkers(smcEvents);
  const structureLines = buildStructureLines(smcEvents);
  const zones = buildZones(zonesRaw);
  const liquidityMarkers = buildLiquidityMarkers(liquidityEvents);
  const liquidityLines = buildLiquidityLines(liquidityEvents);
  const dlmLines = buildDlmLines(dlmLevels).slice(-3);

  const lines = [...structureLines, ...liquidityLines, ...dlmLines].slice(-8);
  const markers = [...structureMarkers, ...liquidityMarkers].slice(-40);
  const combinedBias = getCombinedBiasFromLines(lines);

  return {
    smc: createEmptyAnalysisObject<ChartOverlayPayload["smc"]>(),
    alphaX: createEmptyAnalysisObject<ChartOverlayPayload["alphaX"]>(),
    lines,
    zones,
    markers,
    summary: {
      smcTrend: combinedBias,
      alphaXBias: "neutral",
      combinedBias,
      confidenceHint: 50,
      latestStructureLabel: structureMarkers[structureMarkers.length - 1]?.label ?? "No TradingView structure",
      latestPressureLabel: "TradingView overlay source",
      latestRejectionLabel: "Use Pine zones/liquidity events",
      lineCount: lines.length,
      zoneCount: zones.length,
      markerCount: markers.length,
    },
  };
}

export function hasTradingViewOverlayPayload(source: unknown): boolean {
  return Boolean(findRawChartOverlays(source));
}
