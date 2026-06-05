"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import {
  ChartOverlayMarker,
  ChartOverlayPayload,
  ChartOverlayZone,
  OverlayCandle,
} from "@/lib/chartOverlayPrep";

/**
 * components/LightweightChartOverlayCanvas.tsx
 *
 * Purpose:
 * - TradingView-style custom canvas drawing layer.
 *
 * This version fixes:
 * - Profile/liquidity bars are NOT fixed to the far-right forever.
 * - Profile/liquidity bars anchor a few candles to the right of the latest visible candle.
 * - If the latest candle is not visible, the profile/liquidity bars are hidden.
 * - Premium / Equilibrium / Discount also anchor near the latest candle area.
 * - Market-structure labels are only drawn when their time maps to visible candles.
 * - No RJ labels / no fake pressure blocks.
 *
 * Rule:
 * Python backend calculates overlays.
 * React canvas only renders them.
 */

type LightweightChartOverlayCanvasProps = {
  chart: IChartApi | null;
  mainSeries: ISeriesApi<"Candlestick"> | null;
  overlayPayload?: ChartOverlayPayload | null;
  candles?: OverlayCandle[];
  width?: number;
  height?: number;
  showZones?: boolean;
  showLabels?: boolean;
  showLiquidityProfile?: boolean;
  profileLookback?: number;
  className?: string;
};

type LiquidityProfileBin = {
  low: number;
  high: number;
  price?: number;
  volume: number;
  buyVolume?: number;
  sellVolume?: number;
  buyPct: number;
  sellPct: number;
  widthPct?: number;
  dominantSide?: "buy" | "sell";
  isPOC?: boolean;
  isBuyLiquidity?: boolean;
  isSellLiquidity?: boolean;
};

type PdZoneGroup = {
  premium?: ChartOverlayZone;
  equilibrium?: ChartOverlayZone;
  discount?: ChartOverlayZone;
};

type StructureOverlayLine = {
  id?: string;
  type?: string;
  label?: string;
  price?: number;
  time?: unknown;
  fromTime?: unknown;
  direction?: "bullish" | "bearish" | "neutral";
  index?: number;
  breakIndex?: number;
  pivotIndex?: number;
  fromIndex?: number;
  scope?: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeUnixTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
  }

  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : numeric;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function candleTimeToUnix(time: OverlayCandle["time"]): number | null {
  return normalizeUnixTime(time);
}

function nearestCandleTimeForTarget(
  candles: OverlayCandle[],
  targetUnix: number | null,
  maxDistanceSeconds = 20 * 60
): number | null {
  if (!targetUnix || !Array.isArray(candles) || candles.length === 0) return null;

  let bestTime: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candle of candles) {
    const candleUnix = candleTimeToUnix(candle.time);
    if (!candleUnix) continue;

    const distance = Math.abs(candleUnix - targetUnix);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestTime = candleUnix;
    }
  }

  return bestDistance <= maxDistanceSeconds ? bestTime : null;
}

function timeToCoordinate(
  chart: IChartApi,
  time: unknown,
  candles: OverlayCandle[] = []
): number | null {
  if (typeof time === "number" || typeof time === "string") {
    const direct = chart.timeScale().timeToCoordinate(time as Time);
    if (isFiniteNumber(direct)) return direct;
  }

  const unix = normalizeUnixTime(time);
  const nearest = nearestCandleTimeForTarget(candles, unix);

  if (nearest) {
    const coordinate = chart.timeScale().timeToCoordinate(nearest as Time);
    return isFiniteNumber(coordinate) ? coordinate : null;
  }

  return null;
}

function priceToCoordinate(mainSeries: ISeriesApi<"Candlestick">, price: unknown): number | null {
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice)) return null;

  const coordinate = mainSeries.priceToCoordinate(numericPrice);
  return isFiniteNumber(coordinate) ? coordinate : null;
}

function getLatestVisibleCandleX(
  chart: IChartApi,
  candles: OverlayCandle[],
  canvasWidth: number
): number | null {
  if (!candles.length) return null;

  const latest = candles[candles.length - 1];
  const x = timeToCoordinate(chart, latest.time, candles);

  if (x === null) return null;

  // Important:
  // If user scrolls into historical candles, latest candle / ghost area is off screen.
  // Profile and current PD bands should disappear just like ghost candles disappear.
  if (x < -40 || x > canvasWidth + 80) return null;

  return x;
}

function getFutureAnchorX(chart: IChartApi, candles: OverlayCandle[], canvasWidth: number): number | null {
  const latestX = getLatestVisibleCandleX(chart, candles, canvasWidth);
  if (latestX === null) return null;

  const spacing = estimateBarSpacing(chart, candles);
  return latestX + spacing * 4;
}

function getFutureOverlayGeometry(chart: IChartApi, candles: OverlayCandle[], canvasWidth: number) {
  const latestX = getLatestVisibleCandleX(chart, candles, canvasWidth);

  if (latestX === null) return null;

  const spacing = estimateBarSpacing(chart, candles);
  const pdLeft = latestX + spacing * 4;
  const pdWidth = Math.min(260, Math.max(130, canvasWidth * 0.18));
  const gap = Math.max(8, spacing * 1.5);
  const profileLeft = pdLeft + pdWidth + gap;
  const profileWidth = Math.min(180, Math.max(90, canvasWidth * 0.13));

  return {
    latestX,
    spacing,
    pdLeft,
    pdRight: pdLeft + pdWidth,
    pdWidth,
    profileLeft,
    profileWidth,
    profileRight: profileLeft + profileWidth,
  };
}

function estimateBarSpacing(chart: IChartApi, candles: OverlayCandle[]): number {
  if (candles.length < 2) return 8;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const lastX = chart.timeScale().timeToCoordinate(last.time as Time);
  const prevX = chart.timeScale().timeToCoordinate(prev.time as Time);

  if (isFiniteNumber(lastX) && isFiniteNumber(prevX)) {
    return Math.max(4, Math.min(18, Math.abs(lastX - prevX)));
  }

  return 8;
}

function isPremiumZone(zone: ChartOverlayZone): boolean {
  return zone.label.toLowerCase().includes("premium");
}

function isDiscountZone(zone: ChartOverlayZone): boolean {
  return zone.label.toLowerCase().includes("discount");
}

function isEquilibriumZone(zone: ChartOverlayZone): boolean {
  return zone.label.toLowerCase().includes("equilibrium");
}

function isPdZone(zone: ChartOverlayZone): boolean {
  return isPremiumZone(zone) || isDiscountZone(zone) || isEquilibriumZone(zone);
}

function isOrderBlockOrFvg(zone: ChartOverlayZone): boolean {
  const label = zone.label.toLowerCase();
  const typeText = String(zone.type).toLowerCase();

  return (
    label.includes("ob") ||
    label.includes("order block") ||
    label.includes("fvg") ||
    label.includes("imbalance") ||
    typeText.includes("imbalance")
  );
}

function getZoneColor(zone: ChartOverlayZone): string {
  const label = zone.label.toLowerCase();

  if (label.includes("premium")) return "rgba(239, 83, 80, 0.19)";
  if (label.includes("discount")) return "rgba(38, 166, 154, 0.18)";
  if (label.includes("equilibrium")) return "rgba(148, 163, 184, 0.21)";

  if (zone.direction === "bullish") return "rgba(38, 166, 154, 0.14)";
  if (zone.direction === "bearish") return "rgba(239, 83, 80, 0.14)";

  return "rgba(148, 163, 184, 0.12)";
}

function getZoneBorderColor(zone: ChartOverlayZone): string {
  const label = zone.label.toLowerCase();

  if (label.includes("premium")) return "rgba(239, 83, 80, 0.42)";
  if (label.includes("discount")) return "rgba(38, 166, 154, 0.42)";
  if (label.includes("equilibrium")) return "rgba(148, 163, 184, 0.38)";

  if (zone.direction === "bullish") return "rgba(38, 166, 154, 0.40)";
  if (zone.direction === "bearish") return "rgba(239, 83, 80, 0.40)";

  return "rgba(148, 163, 184, 0.30)";
}

function getMarkerTextColor(marker: ChartOverlayMarker): string {
  if (marker.direction === "bullish") return "rgba(38, 166, 154, 0.95)";
  if (marker.direction === "bearish") return "rgba(239, 83, 80, 0.95)";
  return "rgba(234, 179, 8, 0.95)";
}

function getMarkerBackgroundColor(marker: ChartOverlayMarker): string {
  if (marker.direction === "bullish") return "rgba(38, 166, 154, 0.13)";
  if (marker.direction === "bearish") return "rgba(239, 83, 80, 0.13)";
  return "rgba(234, 179, 8, 0.13)";
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawTextBadge(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  textColor: string,
  backgroundColor: string,
  align: "left" | "right" | "center" = "left"
) {
  const paddingX = 5;
  const paddingY = 3;
  const fontSize = 10;

  context.save();
  context.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;

  const metrics = context.measureText(text);
  const badgeWidth = Math.ceil(metrics.width + paddingX * 2);
  const badgeHeight = fontSize + paddingY * 2 + 1;
  const left = align === "right" ? x - badgeWidth : x;

  drawRoundedRect(context, left, y - badgeHeight / 2, badgeWidth, badgeHeight, 4);
  context.fillStyle = backgroundColor;
  context.fill();

  context.fillStyle = textColor;
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillText(text, left + paddingX, y + 0.5);
  context.restore();
}

function drawZoneLabel(
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  color: string,
  align: "left" | "right" | "center" = "left"
) {
  context.save();
  context.font = "600 10px Inter, system-ui, sans-serif";
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillText(label, x, y);
  context.restore();
}

function groupPdZones(zones: ChartOverlayZone[]): PdZoneGroup {
  const group: PdZoneGroup = {};

  for (let i = zones.length - 1; i >= 0; i -= 1) {
    const zone = zones[i];

    if (!group.premium && isPremiumZone(zone)) group.premium = zone;
    if (!group.equilibrium && isEquilibriumZone(zone)) group.equilibrium = zone;
    if (!group.discount && isDiscountZone(zone)) group.discount = zone;

    if (group.premium && group.equilibrium && group.discount) break;
  }

  return group;
}

function getPdHorizontalRange(
  chart: IChartApi,
  zones: ChartOverlayZone[],
  candles: OverlayCandle[],
  canvasWidth: number
) {
  const latest = candles[candles.length - 1];
  if (!latest) return null;

  const latestX = timeToCoordinate(chart, latest.time, candles);
  if (latestX === null || latestX < -40 || latestX > canvasWidth + 80) return null;

  const firstPdZone = zones.find((zone) => isPdZone(zone));
  const xStart = firstPdZone
    ? timeToCoordinate(chart, firstPdZone.startTime, candles)
    : null;

  const spacing = estimateBarSpacing(chart, candles);
  const fallbackLeft = Math.max(0, latestX - spacing * 80);
  const left = xStart !== null ? Math.max(0, xStart) : fallbackLeft;

  // Pine draws PD zones from trailing.barTime to current time.
  // We stop at latest candle area, before profile/ghost continuation.
  const right = Math.min(canvasWidth - 8, latestX + spacing * 2);

  if (right - left < 40) return null;

  return {
    left,
    right,
    width: right - left,
  };
}

function getPdSourceRange(zones: ChartOverlayZone[]) {
  const { premium, equilibrium, discount } = groupPdZones(zones);

  const allPd = [premium, equilibrium, discount].filter(Boolean) as ChartOverlayZone[];

  if (!allPd.length) return null;

  const top = Math.max(...allPd.map((zone) => Math.max(zone.high, zone.low)));
  const bottom = Math.min(...allPd.map((zone) => Math.min(zone.high, zone.low)));

  if (!Number.isFinite(top) || !Number.isFinite(bottom) || top <= bottom) return null;

  return {
    top,
    bottom,
    premium,
    equilibrium,
    discount,
  };
}

function makePdBand(
  label: "Premium" | "Equilibrium" | "Discount",
  top: number,
  bottom: number,
  template: ChartOverlayZone | undefined
): ChartOverlayZone {
  const premiumBottom = 0.95 * top + 0.05 * bottom;
  const equilibriumTop = 0.525 * top + 0.475 * bottom;
  const equilibriumBottom = 0.525 * bottom + 0.475 * top;
  const discountTop = 0.95 * bottom + 0.05 * top;

  if (label === "Premium") {
    return {
      id: "pd-premium-band",
      type: "supply",
      label,
      startTime: template?.startTime ?? "",
      endTime: template?.endTime ?? "",
      high: top,
      low: premiumBottom,
      direction: "bearish",
    };
  }

  if (label === "Equilibrium") {
    return {
      id: "pd-equilibrium-band",
      type: "neutralPressure",
      label,
      startTime: template?.startTime ?? "",
      endTime: template?.endTime ?? "",
      high: Math.max(equilibriumTop, equilibriumBottom),
      low: Math.min(equilibriumTop, equilibriumBottom),
      direction: "neutral",
    };
  }

  return {
    id: "pd-discount-band",
    type: "demand",
    label,
    startTime: template?.startTime ?? "",
    endTime: template?.endTime ?? "",
    high: discountTop,
    low: bottom,
    direction: "bullish",
  };
}

function drawPremiumDiscountZones(
  context: CanvasRenderingContext2D,
  chart: IChartApi,
  mainSeries: ISeriesApi<"Candlestick">,
  zones: ChartOverlayZone[],
  candles: OverlayCandle[],
  canvasWidth: number
) {
  const horizontal = getPdHorizontalRange(chart, zones, candles, canvasWidth);
  const source = getPdSourceRange(zones);

  if (!horizontal || !source) return;

  const drawable: ChartOverlayZone[] = [
    makePdBand("Premium", source.top, source.bottom, source.premium),
    makePdBand("Equilibrium", source.top, source.bottom, source.equilibrium),
    makePdBand("Discount", source.top, source.bottom, source.discount),
  ];

  for (const zone of drawable) {
    const yHigh = priceToCoordinate(mainSeries, zone.high);
    const yLow = priceToCoordinate(mainSeries, zone.low);

    if (yHigh === null || yLow === null) continue;

    const topY = Math.min(yHigh, yLow);
    const bottomY = Math.max(yHigh, yLow);
    const height = Math.max(5, bottomY - topY);

    context.save();
    context.fillStyle = getZoneColor(zone);
    context.strokeStyle = getZoneBorderColor(zone);
    context.lineWidth = 1;

    context.fillRect(horizontal.left, topY, horizontal.width, height);
    context.strokeRect(horizontal.left, topY, horizontal.width, height);

    const labelX =
      zone.label === "Equilibrium"
        ? Math.min(horizontal.right + 6, canvasWidth - 8)
        : horizontal.left + horizontal.width / 2;

    const labelAlign =
      zone.label === "Equilibrium"
        ? horizontal.right + 70 > canvasWidth ? "right" : "left"
        : "center";

    drawZoneLabel(
      context,
      zone.label,
      labelX,
      topY + height / 2,
      getZoneBorderColor(zone),
      labelAlign as "left" | "right" | "center"
    );

    context.restore();
  }
}

function drawRegularZones(
  context: CanvasRenderingContext2D,
  chart: IChartApi,
  mainSeries: ISeriesApi<"Candlestick">,
  zones: ChartOverlayZone[],
  canvasWidth: number,
  candles: OverlayCandle[]
) {
  const regularZones = zones
    .filter((zone) => !isPdZone(zone))
    .filter(isOrderBlockOrFvg)
    .slice(-6);

  for (const zone of regularZones) {
    const yHigh = priceToCoordinate(mainSeries, zone.high);
    const yLow = priceToCoordinate(mainSeries, zone.low);

    if (yHigh === null || yLow === null) continue;

    const xStart = timeToCoordinate(chart, zone.startTime, candles);
    const xEnd = timeToCoordinate(chart, zone.endTime, candles);

    // Do not draw floating OB/FVG if neither side maps to a real chart coordinate.
    if (xStart === null && xEnd === null) continue;

    const fallbackWidth = Math.min(220, Math.max(90, canvasWidth * 0.16));
    const right = xEnd ?? Math.min(canvasWidth - 20, (xStart ?? 0) + fallbackWidth);
    const left = xStart ?? Math.max(0, right - fallbackWidth);
    const width = Math.max(16, Math.min(right - left, fallbackWidth));

    if (right < -20 || left > canvasWidth + 20) continue;

    const top = Math.min(yHigh, yLow);
    const bottom = Math.max(yHigh, yLow);
    const height = Math.max(4, bottom - top);

    if (height < 3) continue;

    context.save();
    context.fillStyle = getZoneColor(zone);
    context.strokeStyle = getZoneBorderColor(zone);
    context.lineWidth = 1;

    context.fillRect(left, top, width, height);
    context.strokeRect(left, top, width, height);

    if (width > 80 && height > 16) {
      drawZoneLabel(context, zone.label, left + 6, top + 10, getZoneBorderColor(zone), "left");
    }

    context.restore();
  }
}

function drawZones(
  context: CanvasRenderingContext2D,
  chart: IChartApi,
  mainSeries: ISeriesApi<"Candlestick">,
  zones: ChartOverlayZone[],
  canvasWidth: number,
  candles: OverlayCandle[]
) {
  drawRegularZones(context, chart, mainSeries, zones, canvasWidth, candles);
  drawPremiumDiscountZones(context, chart, mainSeries, zones, candles, canvasWidth);
}

function getStructureLineColor(line: StructureOverlayLine): string {
  if (line.direction === "bullish") return "rgba(38, 166, 154, 0.82)";
  if (line.direction === "bearish") return "rgba(239, 83, 80, 0.82)";
  return "rgba(148, 163, 184, 0.72)";
}

function getStructureLineBg(line: StructureOverlayLine): string {
  if (line.direction === "bullish") return "rgba(38, 166, 154, 0.12)";
  if (line.direction === "bearish") return "rgba(239, 83, 80, 0.12)";
  return "rgba(148, 163, 184, 0.12)";
}

function normalizeStructureLines(overlayPayload: ChartOverlayPayload | null | undefined): StructureOverlayLine[] {
  const rawLines = (overlayPayload as any)?.lines;

  if (!Array.isArray(rawLines)) return [];

  return rawLines
    .filter((line: any) => {
      const type = String(line?.type ?? "").toLowerCase();
      const label = String(line?.label ?? "").toUpperCase();

      return (
        (type === "bos" || type === "choch" || type === "mss" || label.includes("BOS") || label.includes("CHOCH") || label.includes("MSS")) &&
        (line?.fromTime !== undefined || line?.fromIndex !== undefined || line?.pivotIndex !== undefined) &&
        Number.isFinite(Number(line?.price))
      );
    })
    .slice(-18);
}

function candleIndexToCoordinate(
  chart: IChartApi,
  candles: OverlayCandle[],
  index: unknown
): number | null {
  const parsed = Number(index);

  if (!Number.isFinite(parsed)) return null;

  const safeIndex = Math.floor(parsed);

  if (safeIndex < 0 || safeIndex >= candles.length) return null;

  return timeToCoordinate(chart, candles[safeIndex].time, candles);
}

function structureXFromIndexOrTime(
  chart: IChartApi,
  candles: OverlayCandle[],
  indexValue: unknown,
  timeValue: unknown
): number | null {
  const fromIndex = candleIndexToCoordinate(chart, candles, indexValue);

  if (fromIndex !== null) return fromIndex;

  return timeToCoordinate(chart, timeValue, candles);
}

function drawStructureLines(
  context: CanvasRenderingContext2D,
  chart: IChartApi,
  mainSeries: ISeriesApi<"Candlestick">,
  overlayPayload: ChartOverlayPayload | null | undefined,
  candles: OverlayCandle[],
  canvasWidth: number
) {
  const structureLines = normalizeStructureLines(overlayPayload);
  const placed: Array<{ x: number; y: number }> = [];

  for (const line of structureLines) {
    const y = priceToCoordinate(mainSeries, line.price);
    const x1 = structureXFromIndexOrTime(
      chart,
      candles,
      line.fromIndex ?? line.pivotIndex,
      line.fromTime
    );
    const x2 = structureXFromIndexOrTime(
      chart,
      candles,
      line.breakIndex ?? line.index,
      line.time
    );

    if (y === null || x1 === null || x2 === null) continue;

    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);

    if (right < -20 || left > canvasWidth + 20) continue;

    const clippedLeft = Math.max(0, left);
    const clippedRight = Math.min(canvasWidth, right);

    if (clippedRight - clippedLeft < 12) continue;

    context.save();

    context.strokeStyle = getStructureLineColor(line);
    context.lineWidth = 1;
    context.setLineDash([4, 3]);
    context.beginPath();
    context.moveTo(clippedLeft, y);
    context.lineTo(clippedRight, y);
    context.stroke();
    context.setLineDash([]);

    const label = String(line.label || line.type || "").replace(/^i(?=BOS|CHoCH|MSS)/, "i");
    const labelX = clippedLeft + (clippedRight - clippedLeft) / 2;
    let labelY = line.direction === "bullish" ? y - 10 : y + 10;

    for (const previous of placed) {
      if (Math.abs(previous.x - labelX) < 46 && Math.abs(previous.y - labelY) < 16) {
        labelY += line.direction === "bullish" ? -16 : 16;
      }
    }

    placed.push({ x: labelX, y: labelY });

    drawTextBadge(
      context,
      label,
      labelX,
      labelY,
      getStructureLineColor(line),
      getStructureLineBg(line),
      "left"
    );

    context.restore();
  }
}


function getCompactMarkerText(marker: ChartOverlayMarker): string {
  const label = marker.label.toLowerCase();

  if (label.includes("pressure")) return "";
  if (label.includes("score")) return "";
  if (marker.type === "Rejection") return "";
  if (marker.type === "BOS" || marker.type === "CHoCH" || marker.type === "MSS") return "";

  if (marker.type === "Sweep") {
    return "";
  }

  return marker.label || marker.type;
}

function selectVisibleMarkers(markers: ChartOverlayMarker[]): ChartOverlayMarker[] {
  const selected: ChartOverlayMarker[] = [];
  const seen = new Set<string>();

  for (let i = markers.length - 1; i >= 0; i -= 1) {
    const marker = markers[i];
    const text = getCompactMarkerText(marker);

    if (!text) continue;

    const key = `${marker.type}-${marker.label}-${marker.direction}`;
    if (seen.has(key)) continue;

    selected.push(marker);
    seen.add(key);

    if (selected.length >= 12) break;
  }

  return selected.reverse();
}

function drawMarkers(
  context: CanvasRenderingContext2D,
  chart: IChartApi,
  mainSeries: ISeriesApi<"Candlestick">,
  markers: ChartOverlayMarker[],
  candles: OverlayCandle[],
  canvasWidth: number
) {
  const visibleMarkers = selectVisibleMarkers(markers);
  const placed: Array<{ x: number; y: number }> = [];

  for (const marker of visibleMarkers) {
    const x = timeToCoordinate(chart, marker.time, candles);
    const y = priceToCoordinate(mainSeries, marker.price);

    // Critical fix:
    // If the marker time does not map to a candle currently on screen,
    // do not draw it. This prevents floating random structure labels.
    if (x === null || y === null) continue;
    if (x < -20 || x > canvasWidth + 20) continue;

    const text = getCompactMarkerText(marker);
    if (!text) continue;

    let labelY = marker.direction === "bullish" ? y + 14 : y - 14;

    for (const previous of placed) {
      const overlapsX = Math.abs(previous.x - x) < 48;
      const overlapsY = Math.abs(previous.y - labelY) < 18;

      if (overlapsX && overlapsY) {
        labelY += marker.direction === "bullish" ? 18 : -18;
      }
    }

    placed.push({ x, y: labelY });

    context.save();
    context.strokeStyle = getMarkerTextColor(marker);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x, labelY);
    context.stroke();

    drawTextBadge(
      context,
      text,
      x + 4,
      labelY,
      getMarkerTextColor(marker),
      getMarkerBackgroundColor(marker),
      "left"
    );

    context.restore();
  }
}

function normalizePayloadBins(overlayPayload: ChartOverlayPayload | null | undefined): LiquidityProfileBin[] {
  const rawBins = (overlayPayload as any)?.liquidityProfileBins;

  if (!Array.isArray(rawBins)) return [];

  return rawBins
    .map((bin: any): LiquidityProfileBin | null => {
      const low = Number(bin.low ?? bin.price);
      const high = Number(bin.high ?? bin.price);
      const volume = Number(bin.volume ?? 0);
      const buyPct = Number(bin.buyPct ?? 0);
      const sellPct = Number(bin.sellPct ?? 0);
      const widthPct = Number(bin.widthPct ?? 0);

      if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(volume)) {
        return null;
      }

      return {
        low: Math.min(low, high),
        high: Math.max(low, high),
        price: Number(bin.price ?? (low + high) / 2),
        volume,
        buyVolume: Number(bin.buyVolume ?? 0),
        sellVolume: Number(bin.sellVolume ?? 0),
        buyPct: Number.isFinite(buyPct) ? buyPct : 0,
        sellPct: Number.isFinite(sellPct) ? sellPct : 0,
        widthPct: Number.isFinite(widthPct) ? widthPct : 0,
        dominantSide: bin.dominantSide === "sell" ? "sell" : "buy",
        isPOC: Boolean(bin.isPOC),
        isBuyLiquidity: Boolean(bin.isBuyLiquidity),
        isSellLiquidity: Boolean(bin.isSellLiquidity),
      };
    })
    .filter((bin): bin is LiquidityProfileBin => Boolean(bin));
}

function buildFallbackProfileFromCandles(
  candles: OverlayCandle[] | undefined,
  binCount = 24,
  lookback = 260
): LiquidityProfileBin[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];

  const recent = candles.slice(-lookback);
  const high = Math.max(...recent.map((candle) => candle.high));
  const low = Math.min(...recent.map((candle) => candle.low));

  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) return [];

  const step = (high - low) / binCount;
  if (step <= 0) return [];

  const bins: LiquidityProfileBin[] = Array.from({ length: binCount }, (_, index) => {
    const binLow = low + step * index;
    const binHigh = binLow + step;

    return {
      low: binLow,
      high: binHigh,
      price: (binLow + binHigh) / 2,
      volume: 0,
      buyVolume: 0,
      sellVolume: 0,
      buyPct: 0,
      sellPct: 0,
      widthPct: 0,
      dominantSide: "buy",
    };
  });

  for (const candle of recent) {
    const typical = (candle.high + candle.low + candle.close) / 3;
    const rawIndex = Math.floor((typical - low) / step);
    const index = Math.max(0, Math.min(binCount - 1, rawIndex));
    const volume = Number.isFinite(candle.volume) ? Number(candle.volume) : 1;

    bins[index].volume += volume;

    if (candle.close >= candle.open) {
      bins[index].buyVolume = (bins[index].buyVolume ?? 0) + volume;
    } else {
      bins[index].sellVolume = (bins[index].sellVolume ?? 0) + volume;
    }
  }

  const maxVolume = Math.max(...bins.map((bin) => bin.volume), 0.0000001);

  return bins
    .filter((bin) => bin.volume > 0)
    .map((bin) => {
      const total = Math.max(bin.volume, 0.0000001);
      const buyVolume = bin.buyVolume ?? 0;
      const sellVolume = bin.sellVolume ?? 0;

      return {
        ...bin,
        buyPct: (buyVolume / total) * 100,
        sellPct: (sellVolume / total) * 100,
        widthPct: (bin.volume / maxVolume) * 100,
        dominantSide: buyVolume >= sellVolume ? "buy" : "sell",
      };
    });
}

function drawLiquidityProfile(
  context: CanvasRenderingContext2D,
  chart: IChartApi,
  mainSeries: ISeriesApi<"Candlestick">,
  overlayPayload: ChartOverlayPayload | null | undefined,
  candles: OverlayCandle[] | undefined,
  canvasWidth: number,
  profileLookback: number
) {
  const geometry = getFutureOverlayGeometry(chart, candles ?? [], canvasWidth);

  // Same rule as ghost candles:
  // if latest candle / ghost area is not visible, profile is not visible.
  if (!geometry) return;

  let bins = normalizePayloadBins(overlayPayload);

  if (bins.length === 0) {
    bins = buildFallbackProfileFromCandles(candles, 24, profileLookback);
  }

  if (bins.length === 0) return;

  const maxWidth = geometry.profileWidth;
  const startX = geometry.profileLeft;

  // If profile is out of view, hide it rather than pinning to the edge.
  if (startX > canvasWidth + 20 || geometry.profileRight < -20) return;

  context.save();

  for (const bin of bins) {
    const yHigh = priceToCoordinate(mainSeries, bin.high);
    const yLow = priceToCoordinate(mainSeries, bin.low);

    if (yHigh === null || yLow === null) continue;

    const top = Math.min(yHigh, yLow);
    const bottom = Math.max(yHigh, yLow);
    const height = Math.max(2, bottom - top - 1);
    const y = top + 1;

    const widthPct = Number.isFinite(bin.widthPct ?? NaN)
      ? Math.max(2, Math.min(100, bin.widthPct ?? 0))
      : 35;

    const totalWidth = (widthPct / 100) * maxWidth;
    const bearWidth = totalWidth * (bin.sellPct / 100);
    const bullWidth = totalWidth * (bin.buyPct / 100);

    if (bearWidth > 1) {
      context.fillStyle = "rgba(239, 83, 80, 0.46)";
      context.fillRect(startX, y, bearWidth, height);
    }

    if (bullWidth > 1) {
      context.fillStyle = "rgba(38, 166, 154, 0.54)";
      context.fillRect(startX + bearWidth, y, bullWidth, height);
    }

    const shouldLabel = bin.isPOC || bin.isBuyLiquidity || bin.isSellLiquidity || totalWidth > maxWidth * 0.52;

    if (shouldLabel) {
      context.font = "600 10px Inter, system-ui, sans-serif";
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.fillStyle = bin.dominantSide === "sell"
        ? "rgba(239, 83, 80, 0.78)"
        : "rgba(38, 166, 154, 0.80)";

      const pct = bin.dominantSide === "sell" ? bin.sellPct : bin.buyPct;
      context.fillText(`${Math.round(pct)}%`, startX - 24, y + height / 2);
      context.fillText(formatCompactVolume(bin.volume), startX + totalWidth + 4, y + height / 2);
    }
  }

  context.restore();
}

function formatCompactVolume(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toString();
}

export default function LightweightChartOverlayCanvas({
  chart,
  mainSeries,
  overlayPayload = null,
  candles = [],
  width,
  height,
  showZones = true,
  showLabels = true,
  showLiquidityProfile = true,
  profileLookback = 260,
  className = "",
}: LightweightChartOverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measuredSize, setMeasuredSize] = React.useState({ width: 0, height: 0 });
  const [redrawVersion, setRedrawVersion] = React.useState(0);

  const canvasWidth = width ?? measuredSize.width;
  const canvasHeight = height ?? measuredSize.height;

  const zones = useMemo(() => overlayPayload?.zones ?? [], [overlayPayload]);
  const markers = useMemo(() => overlayPayload?.markers ?? [], [overlayPayload]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || width || height) return;

    resizeObserverRef.current = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      setMeasuredSize({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      });
    });

    resizeObserverRef.current.observe(container);

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, [width, height]);

  useEffect(() => {
    if (!chart) return;

    let frameId: number | null = null;

    const requestRedraw = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);

      frameId = requestAnimationFrame(() => {
        setRedrawVersion((value) => value + 1);
      });
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(requestRedraw);
    chart.timeScale().subscribeVisibleTimeRangeChange(requestRedraw);

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);

      chart.timeScale().unsubscribeVisibleLogicalRangeChange(requestRedraw);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(requestRedraw);
    };
  }, [chart]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !chart || !mainSeries || canvasWidth <= 0 || canvasHeight <= 0) {
      return;
    }

    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvasWidth * pixelRatio);
    canvas.height = Math.floor(canvasHeight * pixelRatio);
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, canvasWidth, canvasHeight);

    if (showZones) {
      drawZones(context, chart, mainSeries, zones, canvasWidth, candles);
    }

    if (showLabels) {
      drawStructureLines(context, chart, mainSeries, overlayPayload, candles, canvasWidth);
      drawMarkers(context, chart, mainSeries, markers, candles, canvasWidth);
    }

    if (showLiquidityProfile) {
      drawLiquidityProfile(
        context,
        chart,
        mainSeries,
        overlayPayload,
        candles,
        canvasWidth,
        profileLookback
      );
    }
  }, [
    candles,
    canvasHeight,
    canvasWidth,
    chart,
    mainSeries,
    markers,
    overlayPayload,
    profileLookback,
    redrawVersion,
    showLabels,
    showLiquidityProfile,
    showZones,
    zones,
  ]);

  return (
    <div
      ref={containerRef}
      className={`pointer-events-none absolute inset-0 z-[5] ${className}`}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
