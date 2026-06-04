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
 * - Custom drawing layer for TradingView-style visuals over Lightweight Charts.
 * - Draws boxes/zones, labels around candles, and right-side liquidity profile bars.
 *
 * This is the layer needed for visuals like:
 * - Order block boxes
 * - FVG boxes
 * - Premium / discount zones
 * - BOS / CHoCH labels around candles
 * - Sweep / rejection labels
 * - Right-side liquidity profile bars
 *
 * Current role:
 * - New standalone overlay canvas component.
 * - Safe to add first.
 * - Next step is connecting it inside LightweightCandlestickChart.tsx.
 *
 * Rule:
 * Raw OHLC = truth
 * Heikin Ashi = visual trend filter
 * SMC = structure context
 * AlphaX DLM = liquidity and pressure context
 * Ghost Candles = projected visual path
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
  if (!isFiniteNumber(Number(price))) return null;

  const coordinate = mainSeries.priceToCoordinate(Number(price));
  return isFiniteNumber(coordinate) ? coordinate : null;
}

function getZoneColor(zone: ChartOverlayZone): string {
  if (
    zone.type === "demand" ||
    zone.type === "bullishPressure" ||
    zone.type === "bullishImbalance"
  ) {
    return "rgba(38, 166, 154, 0.16)";
  }

  if (
    zone.type === "supply" ||
    zone.type === "bearishPressure" ||
    zone.type === "bearishImbalance"
  ) {
    return "rgba(239, 83, 80, 0.16)";
  }

  return "rgba(148, 163, 184, 0.14)";
}

function getZoneBorderColor(zone: ChartOverlayZone): string {
  if (
    zone.type === "demand" ||
    zone.type === "bullishPressure" ||
    zone.type === "bullishImbalance"
  ) {
    return "rgba(38, 166, 154, 0.45)";
  }

  if (
    zone.type === "supply" ||
    zone.type === "bearishPressure" ||
    zone.type === "bearishImbalance"
  ) {
    return "rgba(239, 83, 80, 0.45)";
  }

  return "rgba(148, 163, 184, 0.35)";
}

function getMarkerTextColor(marker: ChartOverlayMarker): string {
  if (marker.direction === "bullish") return "rgba(38, 166, 154, 0.95)";
  if (marker.direction === "bearish") return "rgba(239, 83, 80, 0.95)";
  return "rgba(234, 179, 8, 0.95)";
}

function getMarkerBackgroundColor(marker: ChartOverlayMarker): string {
  if (marker.direction === "bullish") return "rgba(38, 166, 154, 0.14)";
  if (marker.direction === "bearish") return "rgba(239, 83, 80, 0.14)";
  return "rgba(234, 179, 8, 0.14)";
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

function drawZones(
  context: CanvasRenderingContext2D,
  chart: IChartApi,
  mainSeries: ISeriesApi<"Candlestick">,
  zones: ChartOverlayZone[],
  canvasWidth: number
) {
  const visibleZones = zones.slice(-12);

  for (const zone of visibleZones) {
    const yHigh = priceToCoordinate(mainSeries, zone.high);
    const yLow = priceToCoordinate(mainSeries, zone.low);

    if (yHigh === null || yLow === null) continue;

    const xStart = timeToCoordinate(chart, zone.startTime);
    const xEndFromTime = timeToCoordinate(chart, zone.endTime);

    const left = xStart ?? 0;
    const right = xEndFromTime ?? canvasWidth - 80;
    const top = Math.min(yHigh, yLow);
    const bottom = Math.max(yHigh, yLow);
    const width = Math.max(24, right - left);
    const height = Math.max(4, bottom - top);

    context.save();
    context.fillStyle = getZoneColor(zone);
    context.strokeStyle = getZoneBorderColor(zone);
    context.lineWidth = 1;

    context.fillRect(left, top, width, height);
    context.strokeRect(left, top, width, height);

    if (width > 60 && height > 14) {
      context.font = "600 10px Inter, system-ui, sans-serif";
      context.fillStyle = getZoneBorderColor(zone);
      context.textAlign = "left";
      context.textBaseline = "top";
      context.fillText(zone.label, left + 6, top + 4);
    }

    context.restore();
  }
}

function drawMarkers(
  context: CanvasRenderingContext2D,
  chart: IChartApi,
  mainSeries: ISeriesApi<"Candlestick">,
  markers: ChartOverlayMarker[]
) {
  const visibleMarkers = markers.slice(-30);

  for (const marker of visibleMarkers) {
    const x = timeToCoordinate(chart, marker.time);
    const y = priceToCoordinate(mainSeries, marker.price);

    if (x === null || y === null) continue;

    const yOffset = marker.direction === "bullish" ? 16 : -16;
    const labelY = y + yOffset;
    const text = marker.type === "Rejection" ? "RJ" : marker.type;

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
  binCount = 18,
  lookback = 160
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
  const bins = buildLiquidityProfile(candles, 18, lookback);

  if (bins.length === 0) return;

  const maxVolume = Math.max(...bins.map((bin) => bin.totalVolume));

  if (!Number.isFinite(maxVolume) || maxVolume <= 0) return;

  const panelWidth = Math.min(170, Math.max(95, canvasWidth * 0.16));
  const panelLeft = canvasWidth - panelWidth;
  const maxBarWidth = panelWidth - 36;

  context.save();

  context.fillStyle = "rgba(0, 0, 0, 0.22)";
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
    const bullWidth = totalWidth * (bin.bullPercent / 100);
    const bearWidth = totalWidth * (bin.bearPercent / 100);
    const x = panelLeft + 8;

    if (bearWidth > 1) {
      context.fillStyle = "rgba(239, 83, 80, 0.42)";
      context.fillRect(x, y, bearWidth, height);
    }

    if (bullWidth > 1) {
      context.fillStyle = "rgba(38, 166, 154, 0.42)";
      context.fillRect(x + bearWidth, y, bullWidth, height);
    }

    if (totalWidth > maxBarWidth * 0.55) {
      context.font = "600 10px Inter, system-ui, sans-serif";
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.fillStyle = "rgba(209, 213, 219, 0.75)";
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
  profileLookback = 160,
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
