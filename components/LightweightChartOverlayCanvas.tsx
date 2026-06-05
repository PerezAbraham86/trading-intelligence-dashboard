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
 * - Custom TradingView-style drawing layer over Lightweight Charts.
 *
 * Fix in this version:
 * - Premium / Equilibrium / Discount now draw as right-side zone blocks,
 *   closer to the TradingView reference screenshot.
 * - Order blocks / FVG zones draw as normal boxes.
 * - Liquidity profile stays on the far right and does not cover candles as much.
 * - Labels are reduced to avoid stacked BOS / Sweep clutter.
 *
 * Important:
 * - TradingView webhook times can arrive as labels like "6/4 09:30".
 *   Those are not always valid Lightweight Charts time values, so this canvas
 *   uses a safer right-side fallback for Premium / Discount zones.
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
  mid: number;
  totalVolume: number;
  bullVolume: number;
  bearVolume: number;
  bullPercent: number;
  bearPercent: number;
};

type PdZoneGroup = {
  premium?: ChartOverlayZone;
  discount?: ChartOverlayZone;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function timeToCoordinate(chart: IChartApi, time: unknown): number | null {
  if (typeof time === "number" || typeof time === "string") {
    const coordinate = chart.timeScale().timeToCoordinate(time as Time);
    return isFiniteNumber(coordinate) ? coordinate : null;
  }

  return null;
}

function priceToCoordinate(
  mainSeries: ISeriesApi<"Candlestick">,
  price: unknown
): number | null {
  const numericPrice = Number(price);

  if (!Number.isFinite(numericPrice)) return null;

  const coordinate = mainSeries.priceToCoordinate(numericPrice);
  return isFiniteNumber(coordinate) ? coordinate : null;
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

function getZoneColor(zone: ChartOverlayZone): string {
  const label = zone.label.toLowerCase();

  if (label.includes("premium")) return "rgba(239, 83, 80, 0.22)";
  if (label.includes("discount")) return "rgba(38, 166, 154, 0.20)";
  if (label.includes("equilibrium")) return "rgba(148, 163, 184, 0.18)";

  if (
    zone.type === "demand" ||
    zone.type === "bullishPressure" ||
    zone.type === "bullishImbalance"
  ) {
    return "rgba(38, 166, 154, 0.15)";
  }

  if (
    zone.type === "supply" ||
    zone.type === "bearishPressure" ||
    zone.type === "bearishImbalance"
  ) {
    return "rgba(239, 83, 80, 0.15)";
  }

  return "rgba(148, 163, 184, 0.13)";
}

function getZoneBorderColor(zone: ChartOverlayZone): string {
  const label = zone.label.toLowerCase();

  if (label.includes("premium")) return "rgba(239, 83, 80, 0.42)";
  if (label.includes("discount")) return "rgba(38, 166, 154, 0.42)";
  if (label.includes("equilibrium")) return "rgba(148, 163, 184, 0.34)";

  if (
    zone.type === "demand" ||
    zone.type === "bullishPressure" ||
    zone.type === "bullishImbalance"
  ) {
    return "rgba(38, 166, 154, 0.40)";
  }

  if (
    zone.type === "supply" ||
    zone.type === "bearishPressure" ||
    zone.type === "bearishImbalance"
  ) {
    return "rgba(239, 83, 80, 0.40)";
  }

  return "rgba(148, 163, 184, 0.30)";
}

function getMarkerTextColor(marker: ChartOverlayMarker): string {
  if (marker.direction === "bullish") return "rgba(38, 166, 154, 0.95)";
  if (marker.direction === "bearish") return "rgba(239, 83, 80, 0.95)";
  return "rgba(234, 179, 8, 0.95)";
}

function getMarkerBackgroundColor(marker: ChartOverlayMarker): string {
  if (marker.direction === "bullish") return "rgba(38, 166, 154, 0.12)";
  if (marker.direction === "bearish") return "rgba(239, 83, 80, 0.12)";
  return "rgba(234, 179, 8, 0.12)";
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
  align: "left" | "right" = "left"
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
  align: "left" | "right" = "left"
) {
  context.save();
  context.font = "600 10px Inter, system-ui, sans-serif";
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillText(label, x, y);
  context.restore();
}

function getProfilePanelLeft(canvasWidth: number): number {
  const panelWidth = Math.min(190, Math.max(115, canvasWidth * 0.17));
  return canvasWidth - panelWidth;
}

function groupPremiumDiscountZones(zones: ChartOverlayZone[]): PdZoneGroup {
  const group: PdZoneGroup = {};

  for (let index = zones.length - 1; index >= 0; index -= 1) {
    const zone = zones[index];

    if (!group.premium && isPremiumZone(zone)) group.premium = zone;
    if (!group.discount && isDiscountZone(zone)) group.discount = zone;

    if (group.premium && group.discount) break;
  }

  return group;
}

function drawPremiumDiscountZones(
  context: CanvasRenderingContext2D,
  mainSeries: ISeriesApi<"Candlestick">,
  zones: ChartOverlayZone[],
  canvasWidth: number
) {
  const { premium, discount } = groupPremiumDiscountZones(zones);

  if (!premium && !discount) return;

  const profileLeft = getProfilePanelLeft(canvasWidth);
  const right = profileLeft - 12;
  const left = Math.max(0, canvasWidth * 0.58);
  const width = Math.max(80, right - left);

  const drawableZones: ChartOverlayZone[] = [];

  if (premium) drawableZones.push(premium);

  if (premium && discount) {
    const equilibriumHigh = Math.min(premium.low, discount.high);
    const equilibriumLow = Math.max(discount.high, premium.low);

    const mid = (premium.low + discount.high) / 2;
    const range = Math.abs((premium.high - discount.low) || (premium.high - premium.low) || 1);
    const thickness = range * 0.035;

    drawableZones.push({
      id: "derived-equilibrium-zone",
      type: "neutralPressure",
      label: "Equilibrium",
      startTime: premium.startTime,
      endTime: premium.endTime,
      high: Number.isFinite(equilibriumHigh) && equilibriumHigh !== equilibriumLow ? Math.max(equilibriumHigh, equilibriumLow) : mid + thickness,
      low: Number.isFinite(equilibriumHigh) && equilibriumHigh !== equilibriumLow ? Math.min(equilibriumHigh, equilibriumLow) : mid - thickness,
      direction: "neutral",
    });
  }

  if (discount) drawableZones.push(discount);

  for (const zone of drawableZones) {
    const yHigh = priceToCoordinate(mainSeries, zone.high);
    const yLow = priceToCoordinate(mainSeries, zone.low);

    if (yHigh === null || yLow === null) continue;

    const top = Math.min(yHigh, yLow);
    const bottom = Math.max(yHigh, yLow);
    const height = Math.max(5, bottom - top);

    context.save();

    context.fillStyle = getZoneColor(zone);
    context.strokeStyle = getZoneBorderColor(zone);
    context.lineWidth = 1;

    context.fillRect(left, top, width, height);
    context.strokeRect(left, top, width, height);

    const labelY = top + height / 2;
    const labelX = right + 7;

    drawZoneLabel(context, zone.label, labelX, labelY, getZoneBorderColor(zone), "left");

    context.restore();
  }
}

function drawRegularZones(
  context: CanvasRenderingContext2D,
  chart: IChartApi,
  mainSeries: ISeriesApi<"Candlestick">,
  zones: ChartOverlayZone[],
  canvasWidth: number
) {
  const profileLeft = getProfilePanelLeft(canvasWidth);
  const regularZones = zones
    .filter((zone) => !isPdZone(zone))
    .slice(-8);

  for (const zone of regularZones) {
    const yHigh = priceToCoordinate(mainSeries, zone.high);
    const yLow = priceToCoordinate(mainSeries, zone.low);

    if (yHigh === null || yLow === null) continue;

    const xStart = timeToCoordinate(chart, zone.startTime);
    const xEndFromTime = timeToCoordinate(chart, zone.endTime);

    const fallbackWidth = Math.min(260, Math.max(120, canvasWidth * 0.22));
    const right = xEndFromTime ?? profileLeft - 18;
    const left = xStart ?? Math.max(0, right - fallbackWidth);

    const top = Math.min(yHigh, yLow);
    const bottom = Math.max(yHigh, yLow);
    const width = Math.max(24, right - left);
    const height = Math.max(4, bottom - top);

    if (height < 3) continue;

    context.save();
    context.fillStyle = getZoneColor(zone);
    context.strokeStyle = getZoneBorderColor(zone);
    context.lineWidth = 1;

    context.fillRect(left, top, width, height);
    context.strokeRect(left, top, width, height);

    if (width > 70 && height > 16) {
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
  canvasWidth: number
) {
  drawRegularZones(context, chart, mainSeries, zones, canvasWidth);
  drawPremiumDiscountZones(context, mainSeries, zones, canvasWidth);
}

function getCompactMarkerText(marker: ChartOverlayMarker): string {
  if (marker.type === "Rejection") return "";
  if (marker.label.toLowerCase().includes("pressure")) return "";
  if (marker.label.toLowerCase().includes("score")) return "";
  if (marker.type === "Sweep") return marker.label || "Sweep";
  return marker.label || marker.type;
}

function selectVisibleMarkers(markers: ChartOverlayMarker[]): ChartOverlayMarker[] {
  const selected: ChartOverlayMarker[] = [];
  const seen = new Set<string>();

  for (let index = markers.length - 1; index >= 0; index -= 1) {
    const marker = markers[index];
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
  markers: ChartOverlayMarker[]
) {
  const visibleMarkers = selectVisibleMarkers(markers);
  const placed: Array<{ x: number; y: number }> = [];

  for (const marker of visibleMarkers) {
    const x = timeToCoordinate(chart, marker.time);
    const y = priceToCoordinate(mainSeries, marker.price);

    if (x === null || y === null) continue;

    const text = getCompactMarkerText(marker);
    if (!text) continue;

    let labelY = marker.direction === "bullish" ? y + 14 : y - 14;

    for (const previous of placed) {
      const overlapsX = Math.abs(previous.x - x) < 46;
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

function buildLiquidityProfile(
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
      mid: (binLow + binHigh) / 2,
      totalVolume: 0,
      bullVolume: 0,
      bearVolume: 0,
      bullPercent: 0,
      bearPercent: 0,
    };
  });

  for (const candle of recent) {
    const typical = (candle.high + candle.low + candle.close) / 3;
    const rawIndex = Math.floor((typical - low) / step);
    const index = Math.max(0, Math.min(binCount - 1, rawIndex));
    const volume = Number.isFinite(candle.volume) ? Number(candle.volume) : 1;

    bins[index].totalVolume += volume;

    if (candle.close >= candle.open) {
      bins[index].bullVolume += volume;
    } else {
      bins[index].bearVolume += volume;
    }
  }

  return bins.map((bin) => {
    const total = Math.max(bin.totalVolume, 0.0000001);

    return {
      ...bin,
      bullPercent: (bin.bullVolume / total) * 100,
      bearPercent: (bin.bearVolume / total) * 100,
    };
  });
}

function drawLiquidityProfile(
  context: CanvasRenderingContext2D,
  mainSeries: ISeriesApi<"Candlestick">,
  candles: OverlayCandle[] | undefined,
  canvasWidth: number,
  canvasHeight: number,
  lookback: number
) {
  const bins = buildLiquidityProfile(candles, 24, lookback);

  if (bins.length === 0) return;

  const maxVolume = Math.max(...bins.map((bin) => bin.totalVolume));

  if (!Number.isFinite(maxVolume) || maxVolume <= 0) return;

  const panelLeft = getProfilePanelLeft(canvasWidth);
  const panelWidth = canvasWidth - panelLeft;
  const maxBarWidth = panelWidth - 34;

  context.save();

  context.fillStyle = "rgba(0, 0, 0, 0.28)";
  context.fillRect(panelLeft, 0, panelWidth, canvasHeight);

  for (const bin of bins) {
    const yHigh = priceToCoordinate(mainSeries, bin.high);
    const yLow = priceToCoordinate(mainSeries, bin.low);

    if (yHigh === null || yLow === null) continue;

    const top = Math.min(yHigh, yLow);
    const bottom = Math.max(yHigh, yLow);
    const height = Math.max(2, bottom - top - 1);
    const y = top + 1;

    const totalWidth = Math.max(2, (bin.totalVolume / maxVolume) * maxBarWidth);
    const bearWidth = totalWidth * (bin.bearPercent / 100);
    const bullWidth = totalWidth * (bin.bullPercent / 100);
    const x = panelLeft + 8;

    if (bearWidth > 1) {
      context.fillStyle = "rgba(239, 83, 80, 0.44)";
      context.fillRect(x, y, bearWidth, height);
    }

    if (bullWidth > 1) {
      context.fillStyle = "rgba(38, 166, 154, 0.50)";
      context.fillRect(x + bearWidth, y, bullWidth, height);
    }

    if (totalWidth > maxBarWidth * 0.42) {
      context.font = "600 10px Inter, system-ui, sans-serif";
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.fillStyle = "rgba(209, 213, 219, 0.74)";
      context.fillText(formatCompactVolume(bin.totalVolume), x + totalWidth + 4, y + height / 2);
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
      drawZones(context, chart, mainSeries, zones, canvasWidth);
    }

    if (showLabels) {
      drawMarkers(context, chart, mainSeries, markers);
    }

    if (showLiquidityProfile) {
      drawLiquidityProfile(
        context,
        mainSeries,
        candles,
        canvasWidth,
        canvasHeight,
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
    profileLookback,
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
