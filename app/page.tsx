"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickData,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  LineData,
  WhitespaceData,
  Time,
  createChart,
} from "lightweight-charts";
import { calculateHeikinAshi, RawCandle } from "@/lib/heikinAshi";
import {
  GhostCandle,
  normalizeGhostCandles,
} from "@/components/GhostCandleOverlay";
import {
  ChartOverlayLine,
  ChartOverlayPayload,
  OverlayCandle,
} from "@/lib/chartOverlayPrep";
import LightweightChartOverlayCanvas from "@/components/LightweightChartOverlayCanvas";

/**
 * LightweightCandlestickChart.tsx
 *
 * Purpose:
 * - Fast main candle chart using TradingView Lightweight Charts.
 * - Keeps real OHLC candles as master truth.
 * - Uses lib/heikinAshi.ts for Heikin Ashi visual calculation.
 * - Supports regular / Heikin Ashi display toggle through the `mode` prop.
 * - Supports optional Ghost Candles as a second projected candle series.
 * - Supports optional SMC + AlphaX dashed price lines.
 * - Mounts custom canvas overlay for zones, candle labels, and liquidity profile bars.
 *
 * Rule:
 * Raw OHLC = truth
 * Heikin Ashi = visual trend filter
 * SMC = structure context
 * AlphaX DLM = liquidity and pressure context
 * Ghost Candles = projected visual path
 */

export type DashboardCandle = {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type ChartMode = "regular" | "heikinAshi";
export type NrtrOverlayMode = "Off" | "ATR-Based" | "Percentage";
export type NrtrPresetMode = "Scalping" | "Swing" | "Long";
export type NrtrExitMode = "Off" | "Pivot Pullback" | "Internal SuperTrend End";

type LightweightCandlestickChartProps = {
  candles: DashboardCandle[];
  ghostCandles?: GhostCandle[];
  overlayLines?: ChartOverlayLine[];
  overlayPayload?: ChartOverlayPayload | null;
  mode?: ChartMode;
  height?: number;
  className?: string;
  symbol?: string;
  timeframe?: string;
  autoFit?: boolean;
  showOverlayLines?: boolean;
  showCanvasOverlay?: boolean;
  showOverlayZones?: boolean;
  showOverlayLabels?: boolean;
  showLiquidityProfile?: boolean;
  showSmma20?: boolean;
  smmaLength?: number;
  showNrtr?: boolean;
  nrtrMode?: NrtrOverlayMode;
  nrtrPreset?: NrtrPresetMode;
  nrtrExitMode?: NrtrExitMode;
  nrtrAtrLength?: number;
  nrtrAtrMultiplier?: number;
  nrtrPercent?: number;
  showNrtrStats?: boolean;
};

function isValidCandle(candle: DashboardCandle | null | undefined): candle is DashboardCandle {
  return Boolean(
    candle &&
      candle.time !== undefined &&
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close)
  );
}

function timeToOverlayTime(time: Time): OverlayCandle["time"] {
  if (typeof time === "number" || typeof time === "string") {
    return time;
  }

  return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
}

function toOverlayCandles(candles: DashboardCandle[]): OverlayCandle[] {
  return candles.filter(isValidCandle).map((candle) => ({
    time: timeToOverlayTime(candle.time),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
}

function toRawCandles(candles: DashboardCandle[]): RawCandle[] {
  return candles.filter(isValidCandle).map((candle) => ({
    time: candle.time as RawCandle["time"],
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
}

function toChartCandles(candles: DashboardCandle[] | RawCandle[]): CandlestickData<Time>[] {
  return candles
    .filter((candle) => {
      return (
        candle &&
        candle.time !== undefined &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close)
      );
    })
    .map((candle) => ({
      time: candle.time as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
}

function toGhostChartCandles(ghostCandles: GhostCandle[] | undefined): CandlestickData<Time>[] {
  return normalizeGhostCandles(ghostCandles).map((candle) => ({
    time: candle.time as Time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}


function calculateSmmaLineData(
  candles: DashboardCandle[],
  length = 20
): LineData<Time>[] {
  const validCandles = candles.filter(isValidCandle);
  const safeLength = Math.max(1, Math.floor(length));

  if (validCandles.length === 0) return [];

  const result: LineData<Time>[] = [];
  let smma: number | null = null;
  let runningSum = 0;

  for (let index = 0; index < validCandles.length; index += 1) {
    const candle = validCandles[index];
    const close = candle.close;

    runningSum += close;

    if (index < safeLength - 1) {
      continue;
    }

    if (index === safeLength - 1) {
      smma = runningSum / safeLength;
    } else if (smma !== null) {
      smma = (smma * (safeLength - 1) + close) / safeLength;
    }

    if (smma !== null && Number.isFinite(smma)) {
      result.push({
        time: candle.time as Time,
        value: smma,
      });
    }
  }

  return result;
}


type NrtrPoint = {
  time: Time;
  value: number | null;
  direction: 1 | -1 | 0;
  buy: boolean;
  sell: boolean;
};

type NrtrExitPoint = {
  time: Time;
  value: number;
  direction: 1 | -1;
  label: string;
};

type NrtrTradeStats = {
  direction: 1 | -1 | 0;
  directionText: string;
  entryPrice: number | null;
  currentPrice: number | null;
  trailingStop: number | null;
  pnlPoints: number | null;
  pnlPercent: number | null;
  lockedProfit: number | null;
  lockedPercent: number | null;
  moveDistance: number | null;
  distancePercent: number | null;
  barsInTrade: number;
  lastSignalText: string;
};

type NrtrLineData = Array<LineData<Time> | WhitespaceData<Time>>;

function getNrtrPresetValues(preset: NrtrPresetMode) {
  if (preset === "Long") {
    return {
      atrMultiplier: 5.0,
      percent: 0.5,
      label: "Long",
    };
  }

  if (preset === "Swing") {
    return {
      atrMultiplier: 3.0,
      percent: 0.25,
      label: "Swing",
    };
  }

  return {
    atrMultiplier: 1.5,
    percent: 0.15,
    label: "Scalping",
  };
}

function calculateAtr(candles: DashboardCandle[], length: number): Array<number | null> {
  const validCandles = candles.filter(isValidCandle);
  const atrValues: Array<number | null> = Array(validCandles.length).fill(null);

  if (validCandles.length === 0 || length <= 0) return atrValues;

  const trueRanges = validCandles.map((candle, index) => {
    const previousClose = index > 0 ? validCandles[index - 1].close : candle.close;

    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });

  let seedSum = 0;

  for (let index = 0; index < trueRanges.length; index += 1) {
    const value = trueRanges[index];

    if (index < length) {
      seedSum += value;

      if (index === length - 1) {
        atrValues[index] = seedSum / length;
      }

      continue;
    }

    const previousAtr = atrValues[index - 1];

    atrValues[index] =
      previousAtr === null || !Number.isFinite(previousAtr)
        ? null
        : (previousAtr * (length - 1) + value) / length;
  }

  return atrValues;
}

function calculateNrtrPercentage(candles: DashboardCandle[], percent = 0.25): NrtrPoint[] {
  const validCandles = candles.filter(isValidCandle);
  const result: NrtrPoint[] = [];
  const coefficient = Math.max(0, Math.min(100, percent)) / 100;

  if (validCandles.length === 0) return result;

  let trend: 1 | -1 = 1;
  let highestPoint = validCandles[0].high;
  let lowestPoint = validCandles[0].low;
  let nrtr = highestPoint * (1 - coefficient);

  for (let index = 0; index < validCandles.length; index += 1) {
    const candle = validCandles[index];
    const previousTrend = trend;

    if (trend === 1) {
      if (candle.high > highestPoint) highestPoint = candle.high;
      nrtr = highestPoint * (1 - coefficient);

      if (candle.low <= nrtr) {
        trend = -1;
        lowestPoint = candle.low;
        nrtr = lowestPoint * (1 + coefficient);
      }
    } else {
      if (candle.low < lowestPoint) lowestPoint = candle.low;
      nrtr = lowestPoint * (1 + coefficient);

      if (candle.high >= nrtr) {
        trend = 1;
        highestPoint = candle.high;
        nrtr = highestPoint * (1 - coefficient);
      }
    }

    result.push({
      time: candle.time as Time,
      value: Number.isFinite(nrtr) ? nrtr : null,
      direction: trend,
      buy: index > 0 && trend === 1 && previousTrend === -1,
      sell: index > 0 && trend === -1 && previousTrend === 1,
    });
  }

  return result;
}

function calculateNrtrAtrSuperTrend(
  candles: DashboardCandle[],
  atrLength = 14,
  atrMultiplier = 3
): NrtrPoint[] {
  const validCandles = candles.filter(isValidCandle);
  const result: NrtrPoint[] = [];

  if (validCandles.length === 0) return result;

  const atrValues = calculateAtr(validCandles, atrLength);

  let finalUpper: number | null = null;
  let finalLower: number | null = null;
  let previousSuperTrend: number | null = null;
  let previousFinalUpper: number | null = null;
  let previousFinalLower: number | null = null;
  let direction: 1 | -1 | 0 = 0;

  for (let index = 0; index < validCandles.length; index += 1) {
    const candle = validCandles[index];
    const previousClose = index > 0 ? validCandles[index - 1].close : candle.close;
    const atr = atrValues[index];
    const previousDirection = direction;

    if (atr === null || !Number.isFinite(atr)) {
      result.push({
        time: candle.time as Time,
        value: null,
        direction: 0,
        buy: false,
        sell: false,
      });
      continue;
    }

    const hl2 = (candle.high + candle.low) / 2;
    const basicUpper = hl2 + atrMultiplier * atr;
    const basicLower = hl2 - atrMultiplier * atr;

    if (previousFinalUpper === null || previousFinalLower === null) {
      finalUpper = basicUpper;
      finalLower = basicLower;
    } else {
      finalUpper =
        basicUpper < previousFinalUpper || previousClose > previousFinalUpper
          ? basicUpper
          : previousFinalUpper;

      finalLower =
        basicLower > previousFinalLower || previousClose < previousFinalLower
          ? basicLower
          : previousFinalLower;
    }

    if (previousSuperTrend === null) {
      direction = candle.close >= hl2 ? 1 : -1;
    } else if (
      previousFinalUpper !== null &&
      Math.abs(previousSuperTrend - previousFinalUpper) <= 1e-10
    ) {
      direction = candle.close > finalUpper ? 1 : -1;
    } else {
      direction = candle.close < finalLower ? -1 : 1;
    }

    const superTrend = direction === 1 ? finalLower : finalUpper;

    result.push({
      time: candle.time as Time,
      value: Number.isFinite(superTrend ?? NaN) ? Number(superTrend) : null,
      direction,
      buy: index > 0 && previousDirection === -1 && direction === 1,
      sell: index > 0 && previousDirection === 1 && direction === -1,
    });

    previousSuperTrend = superTrend;
    previousFinalUpper = finalUpper;
    previousFinalLower = finalLower;
  }

  return result;
}

function calculateNrtrOverlay(
  candles: DashboardCandle[],
  mode: NrtrOverlayMode,
  preset: NrtrPresetMode,
  atrLength = 14,
  atrMultiplier?: number,
  percent?: number
): NrtrPoint[] {
  const presetValues = getNrtrPresetValues(preset);
  const safeAtrLength = Math.max(1, Math.floor(Number.isFinite(atrLength) ? atrLength : 14));
  const safeAtrMultiplier =
    Number.isFinite(Number(atrMultiplier)) && Number(atrMultiplier) > 0
      ? Number(atrMultiplier)
      : presetValues.atrMultiplier;
  const safePercent =
    Number.isFinite(Number(percent)) && Number(percent) > 0
      ? Number(percent)
      : presetValues.percent;

  if (mode === "ATR-Based") {
    return calculateNrtrAtrSuperTrend(candles, safeAtrLength, safeAtrMultiplier);
  }

  if (mode === "Percentage") {
    return calculateNrtrPercentage(candles, safePercent);
  }

  return [];
}

function calculateNrtrExitPoints(
  candles: DashboardCandle[],
  nrtrPoints: NrtrPoint[],
  exitMode: NrtrExitMode,
  pivotLength = 5
): NrtrExitPoint[] {
  const validCandles = candles.filter(isValidCandle);

  if (exitMode === "Off" || validCandles.length === 0 || nrtrPoints.length === 0) {
    return [];
  }

  const exits: NrtrExitPoint[] = [];
  let exitLocked = false;

  const internalPoints =
    exitMode === "Internal SuperTrend End"
      ? calculateNrtrAtrSuperTrend(validCandles, 10, 1.5)
      : [];

  for (let index = 1; index < validCandles.length; index += 1) {
    const point = nrtrPoints[index];
    const previousPoint = nrtrPoints[index - 1];
    const direction = point?.direction ?? 0;
    const previousDirection = previousPoint?.direction ?? 0;

    if (direction !== previousDirection) {
      exitLocked = false;
    }

    if (direction === 0) continue;

    if (exitMode === "Pivot Pullback") {
      const previousLookbackStart = Math.max(0, index - 1 - pivotLength);
      const previousWindow = validCandles.slice(previousLookbackStart, index);

      if (previousWindow.length === 0) continue;

      const previousHighest = Math.max(...previousWindow.map((candle) => candle.high));
      const previousLowest = Math.min(...previousWindow.map((candle) => candle.low));
      const candle = validCandles[index];
      const previousCandle = validCandles[index - 1];
      const trendValue = Number(point.value ?? NaN);
      const previousTrendValue = Number(previousPoint?.value ?? NaN);

      const newExtremeLong = direction === 1 && candle.high > previousHighest;
      const newExtremeShort = direction === -1 && candle.low < previousLowest;

      if (newExtremeLong || newExtremeShort) {
        exitLocked = false;
      }

      const exitLong =
        direction === 1 &&
        previousCandle.high >= previousHighest &&
        candle.close < previousCandle.close &&
        Number.isFinite(trendValue) &&
        Number.isFinite(previousTrendValue) &&
        trendValue <= previousTrendValue;

      const exitShort =
        direction === -1 &&
        previousCandle.low <= previousLowest &&
        candle.close > previousCandle.close &&
        Number.isFinite(trendValue) &&
        Number.isFinite(previousTrendValue) &&
        trendValue >= previousTrendValue;

      if (!exitLocked && exitLong) {
        exits.push({
          time: candle.time as Time,
          value: candle.high,
          direction: 1,
          label: "Exit Long",
        });
        exitLocked = true;
      }

      if (!exitLocked && exitShort) {
        exits.push({
          time: candle.time as Time,
          value: candle.low,
          direction: -1,
          label: "Exit Short",
        });
        exitLocked = true;
      }
    }

    if (exitMode === "Internal SuperTrend End") {
      const internalPoint = internalPoints[index];
      const previousInternalPoint = internalPoints[index - 1];

      if (!internalPoint || !previousInternalPoint) continue;

      const internalResetLong =
        direction === 1 &&
        internalPoint.direction === 1 &&
        previousInternalPoint.direction === -1;

      const internalResetShort =
        direction === -1 &&
        internalPoint.direction === -1 &&
        previousInternalPoint.direction === 1;

      if (internalResetLong || internalResetShort) {
        exitLocked = false;
      }

      const exitLong =
        direction === 1 &&
        internalPoint.direction === -1 &&
        previousInternalPoint.direction === 1;

      const exitShort =
        direction === -1 &&
        internalPoint.direction === 1 &&
        previousInternalPoint.direction === -1;

      const candle = validCandles[index];

      if (!exitLocked && exitLong) {
        exits.push({
          time: candle.time as Time,
          value: candle.high,
          direction: 1,
          label: "Exit Long",
        });
        exitLocked = true;
      }

      if (!exitLocked && exitShort) {
        exits.push({
          time: candle.time as Time,
          value: candle.low,
          direction: -1,
          label: "Exit Short",
        });
        exitLocked = true;
      }
    }
  }

  return exits;
}

function splitNrtrLineData(points: NrtrPoint[], direction: 1 | -1): NrtrLineData {
  /**
   * Pine uses plot.style_linebr for NRTR / SuperTrend.
   * Lightweight Charts line series can visually connect across missing points
   * when the same series receives time-only whitespace points.
   *
   * To emulate linebr:
   * - keep only active points for this direction
   * - insert one whitespace point exactly at every inactive / flip bar
   * - this forces a visible break instead of a continuous connected line
   */
  const lineData: NrtrLineData = [];
  let wasActive = false;

  for (const point of points) {
    const isActive =
      point.direction === direction &&
      point.value !== null &&
      Number.isFinite(point.value);

    if (isActive) {
      lineData.push({
        time: point.time,
        value: Number(point.value),
      });
      wasActive = true;
      continue;
    }

    if (wasActive) {
      lineData.push({
        time: point.time,
      });
    }

    wasActive = false;
  }

  return lineData;
}

function buildNrtrMarkers(points: NrtrPoint[], exits: NrtrExitPoint[]) {
  /**
   * Keep NRTR labels usable instead of covering the chart.
   * TradingView can handle hundreds of labels, but dashboard readability is better
   * with only the most recent meaningful flips/exits.
   */
  const signalMarkers = points
    .filter((point) => point.buy || point.sell)
    .slice(-8)
    .map((point) => ({
      time: point.time,
      position: point.buy ? "belowBar" : "aboveBar",
      color: point.buy ? "#26a69a" : "#ef5350",
      shape: point.buy ? "arrowUp" : "arrowDown",
      text: point.buy ? "Buy" : "Sell",
      size: 1,
    }));

  const exitMarkers = exits.slice(-8).map((exit) => ({
    time: exit.time,
    position: exit.direction === 1 ? "aboveBar" : "belowBar",
    color: "#f59e0b",
    shape: "square",
    text: exit.direction === 1 ? "Exit Long" : "Exit Short",
    size: 1,
  }));

  return [...signalMarkers, ...exitMarkers].sort((a, b) =>
    String(a.time).localeCompare(String(b.time))
  );
}

function calculateNrtrTradeStats(candles: DashboardCandle[], points: NrtrPoint[]): NrtrTradeStats {
  const validCandles = candles.filter(isValidCandle);
  const empty: NrtrTradeStats = {
    direction: 0,
    directionText: "Flat",
    entryPrice: null,
    currentPrice: validCandles.length > 0 ? validCandles[validCandles.length - 1].close : null,
    trailingStop: null,
    pnlPoints: null,
    pnlPercent: null,
    lockedProfit: null,
    lockedPercent: null,
    moveDistance: null,
    distancePercent: null,
    barsInTrade: 0,
    lastSignalText: "No Signal",
  };

  if (validCandles.length === 0 || points.length === 0) return empty;

  const lastPoint = [...points].reverse().find((point) => point.direction !== 0 && point.value !== null);
  const lastCandle = validCandles[validCandles.length - 1];

  if (!lastPoint || lastPoint.value === null) return empty;

  let entryIndex = -1;

  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].buy || points[index].sell) {
      entryIndex = index;
      break;
    }
  }

  if (entryIndex === -1) {
    entryIndex = Math.max(0, points.findIndex((point) => point.direction === lastPoint.direction));
  }

  const entryCandle = validCandles[entryIndex] ?? validCandles[0];
  const entryPrice = entryCandle.close;
  const currentPrice = lastCandle.close;
  const trailingStop = lastPoint.value;
  const direction = lastPoint.direction;
  const pnlPoints =
    direction === 1
      ? currentPrice - entryPrice
      : direction === -1
        ? entryPrice - currentPrice
        : 0;
  const pnlPercent = entryPrice !== 0 ? (pnlPoints / entryPrice) * 100 : 0;
  const lockedProfit =
    direction === 1
      ? trailingStop - entryPrice
      : direction === -1
        ? entryPrice - trailingStop
        : 0;
  const lockedPercent = entryPrice !== 0 ? (lockedProfit / entryPrice) * 100 : 0;
  const moveDistance = Math.abs(currentPrice - trailingStop);
  const distancePercent = currentPrice !== 0 ? (moveDistance / currentPrice) * 100 : 0;

  return {
    direction,
    directionText: direction === 1 ? "Long" : direction === -1 ? "Short" : "Flat",
    entryPrice,
    currentPrice,
    trailingStop,
    pnlPoints,
    pnlPercent,
    lockedProfit,
    lockedPercent,
    moveDistance,
    distancePercent,
    barsInTrade: Math.max(0, validCandles.length - 1 - entryIndex),
    lastSignalText:
      entryIndex >= 0 && points[entryIndex]?.buy
        ? "Buy"
        : entryIndex >= 0 && points[entryIndex]?.sell
          ? "Sell"
          : "Trend Active",
  };
}

function formatNrtrNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(decimals);
}

function formatNrtrSigned(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(decimals)}`;
}


function drawNrtrLineBreakCanvas(
  canvas: HTMLCanvasElement,
  chart: IChartApi,
  mainSeries: ISeriesApi<"Candlestick">,
  points: NrtrPoint[],
  width: number,
  height: number
) {
  const context = canvas.getContext("2d");
  if (!context) return;

  const ctx: CanvasRenderingContext2D = context;
  const pixelRatio = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.floor(width * pixelRatio));
  canvas.height = Math.max(1, Math.floor(height * pixelRatio));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  function drawDirection(direction: 1 | -1, color: string) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    let previousX: number | null = null;
    let previousY: number | null = null;
    let previousDirection: 1 | -1 | 0 = 0;

    for (const point of points) {
      const isActive =
        point.direction === direction &&
        point.value !== null &&
        Number.isFinite(point.value);

      if (!isActive) {
        previousX = null;
        previousY = null;
        previousDirection = point.direction;
        continue;
      }

      const x = chart.timeScale().timeToCoordinate(point.time);
      const y = mainSeries.priceToCoordinate(Number(point.value));

      if (x === null || y === null) {
        previousX = null;
        previousY = null;
        previousDirection = point.direction;
        continue;
      }

      /**
       * This is the important plot.style_linebr behavior:
       * only connect two adjacent active points in the same direction.
       * Never bridge across inactive bars or trend flips.
       */
      if (
        previousX !== null &&
        previousY !== null &&
        previousDirection === direction
      ) {
        ctx.beginPath();
        ctx.moveTo(previousX, previousY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      previousX = x;
      previousY = y;
      previousDirection = point.direction;
    }

    ctx.restore();
  }

  drawDirection(1, "rgba(38, 166, 154, 0.95)");
  drawDirection(-1, "rgba(239, 83, 80, 0.95)");
}

function getOverlayLineColor(line: ChartOverlayLine): string {
  if (line.direction === "bullish") return "rgba(38, 166, 154, 0.85)";
  if (line.direction === "bearish") return "rgba(239, 83, 80, 0.85)";
  return "rgba(234, 179, 8, 0.80)";
}

function getOverlayLineTitle(line: ChartOverlayLine): string {
  const strengthText = Number.isFinite(line.strength)
    ? ` ${Math.round(Number(line.strength))}%`
    : "";

  return `${line.label}${strengthText}`;
}

function getVisibleOverlayLines(lines: ChartOverlayLine[] | undefined): ChartOverlayLine[] {
  if (!Array.isArray(lines)) return [];

  return lines
    .filter((line) => {
      return (
        line &&
        Number.isFinite(line.price) &&
        line.price > 0 &&
        typeof line.label === "string" &&
        line.label.length > 0
      );
    })
    .slice(-8);
}

export default function LightweightCandlestickChart({
  candles,
  ghostCandles = [],
  overlayLines = [],
  overlayPayload = null,
  mode = "regular",
  height = 520,
  className = "",
  symbol = "",
  timeframe = "",
  autoFit = true,
  showOverlayLines = true,
  showCanvasOverlay = true,
  showOverlayZones = true,
  showOverlayLabels = true,
  showLiquidityProfile = true,
  showSmma20 = true,
  smmaLength = 20,
  showNrtr = true,
  nrtrMode = "ATR-Based",
  nrtrPreset = "Swing",
  nrtrExitMode = "Pivot Pullback",
  nrtrAtrLength = 14,
  nrtrAtrMultiplier = 3,
  nrtrPercent = 0.25,
  showNrtrStats = true,
}: LightweightCandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const smmaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const nrtrLongSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const nrtrShortSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const nrtrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const nrtrAnimationFrameRef = useRef<number | null>(null);
  const ghostCandleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const hasFitContentRef = useRef(false);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height });
  const [isNrtrStatsCollapsed, setIsNrtrStatsCollapsed] = useState(false);

  /**
   * Cache both versions so the chart toggle is instant.
   * Raw candles remain the truth.
   * Heikin Ashi candles are visual-only and come from lib/heikinAshi.ts.
   */
  const chartData = useMemo(() => {
    const rawCandles = toRawCandles(candles);
    const regular = toChartCandles(rawCandles);
    const heikinAshi = toChartCandles(calculateHeikinAshi(rawCandles));

    return {
      regular,
      heikinAshi,
    };
  }, [candles]);

  const overlayCandles = useMemo(() => toOverlayCandles(candles), [candles]);
  const displayData = mode === "heikinAshi" ? chartData.heikinAshi : chartData.regular;

  /**
   * 20 SMMA uses real close prices.
   * It does not use Heikin Ashi values because raw OHLC remains the truth.
   */
  const smma20Data = useMemo(() => {
    return calculateSmmaLineData(candles, smmaLength);
  }, [candles, smmaLength]);

  const nrtrPoints = useMemo(() => {
    return showNrtr
      ? calculateNrtrOverlay(
          candles,
          nrtrMode,
          nrtrPreset,
          nrtrAtrLength,
          nrtrAtrMultiplier,
          nrtrPercent
        )
      : [];
  }, [candles, nrtrAtrLength, nrtrAtrMultiplier, nrtrMode, nrtrPercent, nrtrPreset, showNrtr]);

  const nrtrLongLineData = useMemo(() => {
    return splitNrtrLineData(nrtrPoints, 1);
  }, [nrtrPoints]);

  const nrtrShortLineData = useMemo(() => {
    return splitNrtrLineData(nrtrPoints, -1);
  }, [nrtrPoints]);

  const nrtrExitPoints = useMemo(() => {
    return showNrtr ? calculateNrtrExitPoints(candles, nrtrPoints, nrtrExitMode) : [];
  }, [candles, nrtrExitMode, nrtrPoints, showNrtr]);

  const nrtrMarkers = useMemo(() => {
    return showNrtr ? buildNrtrMarkers(nrtrPoints, nrtrExitPoints) : [];
  }, [nrtrExitPoints, nrtrPoints, showNrtr]);

  const nrtrStats = useMemo(() => {
    return calculateNrtrTradeStats(candles, nrtrPoints);
  }, [candles, nrtrPoints]);

  /**
   * Ghost Candles are projected visuals only.
   * They should be future candles from the backend/ML layer.
   */
  const ghostDisplayData = useMemo(() => {
    return toGhostChartCandles(ghostCandles);
  }, [ghostCandles]);

  /**
   * Price-scale labels / createPriceLine overlays are intentionally disabled.
   * TradingView-style SMC visuals are drawn by the canvas layer only.
   */
  const visibleOverlayLines = useMemo(() => {
    return [] as ChartOverlayLine[];
  }, [overlayLines, showOverlayLines]);

  const nrtrSettingsLabel = useMemo(() => {
    if (nrtrMode === "ATR-Based") {
      return `NRTR ATR ${Math.max(1, Math.floor(nrtrAtrLength))} x${Number(nrtrAtrMultiplier).toFixed(2)}`;
    }

    if (nrtrMode === "Percentage") {
      return `NRTR ${Number(nrtrPercent).toFixed(2)}%`;
    }

    return "NRTR Off";
  }, [nrtrAtrLength, nrtrAtrMultiplier, nrtrMode, nrtrPercent]);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const container = containerRef.current;

    const chart = createChart(container, {
      height,
      width: container.clientWidth,
      layout: {
        background: {
          type: ColorType.Solid,
          color: "#05070d",
        },
        textColor: "#d1d5db",
        fontSize: 12,
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      },
      grid: {
        vertLines: {
          color: "rgba(148, 163, 184, 0.08)",
        },
        horzLines: {
          color: "rgba(148, 163, 184, 0.08)",
        },
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.18)",
        scaleMargins: {
          top: 0.08,
          bottom: 0.12,
        },
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.18)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      localization: {
        priceFormatter: (price: number) => {
          if (Math.abs(price) >= 1000) return price.toFixed(2);
          if (Math.abs(price) >= 100) return price.toFixed(2);
          if (Math.abs(price) >= 10) return price.toFixed(3);
          return price.toFixed(4);
        },
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderUpColor: "#26a69a",
      borderDownColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      priceLineVisible: true,
      lastValueVisible: true,
    });

    const smmaSeries = chart.addLineSeries({
      color: "rgba(251, 191, 36, 0.95)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
    });

    const nrtrLongSeries = chart.addLineSeries({
      color: "rgba(38, 166, 154, 0.95)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    } as any);

    const nrtrShortSeries = chart.addLineSeries({
      color: "rgba(239, 83, 80, 0.95)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    } as any);

    const ghostCandleSeries = chart.addCandlestickSeries({
      upColor: "rgba(38, 166, 154, 0.28)",
      downColor: "rgba(239, 83, 80, 0.28)",
      borderUpColor: "rgba(38, 166, 154, 0.72)",
      borderDownColor: "rgba(239, 83, 80, 0.72)",
      wickUpColor: "rgba(38, 166, 154, 0.72)",
      wickDownColor: "rgba(239, 83, 80, 0.72)",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    smmaSeriesRef.current = smmaSeries;
    nrtrLongSeriesRef.current = nrtrLongSeries;
    nrtrShortSeriesRef.current = nrtrShortSeries;
    ghostCandleSeriesRef.current = ghostCandleSeries;

    setOverlaySize({
      width: container.clientWidth,
      height,
    });

    resizeObserverRef.current = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !chartRef.current) return;

      const width = Math.floor(entry.contentRect.width);

      if (width > 0) {
        chartRef.current.applyOptions({
          width,
          height,
        });

        setOverlaySize({
          width,
          height,
        });
      }
    });

    resizeObserverRef.current.observe(container);

    const redrawNrtrCanvas = () => {
      setOverlaySize((previous) => ({ ...previous }));
    };

    chart.timeScale().subscribeVisibleTimeRangeChange(redrawNrtrCanvas);

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(redrawNrtrCanvas);

      if (nrtrAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(nrtrAnimationFrameRef.current);
        nrtrAnimationFrameRef.current = null;
      }

      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;

      chartRef.current?.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      smmaSeriesRef.current = null;
      nrtrLongSeriesRef.current = null;
      nrtrShortSeriesRef.current = null;
      ghostCandleSeriesRef.current = null;
      hasFitContentRef.current = false;
    };
  }, [height]);

  useEffect(() => {
    if (!candleSeriesRef.current) return;

    candleSeriesRef.current.setData(displayData);

    if (autoFit && displayData.length > 0 && chartRef.current && !hasFitContentRef.current) {
      chartRef.current.timeScale().fitContent();
      hasFitContentRef.current = true;
    }
  }, [displayData, autoFit]);

  useEffect(() => {
    if (!smmaSeriesRef.current) return;

    smmaSeriesRef.current.setData(showSmma20 ? smma20Data : []);
  }, [showSmma20, smma20Data]);

  useEffect(() => {
    /**
     * NRTR/SuperTrend is drawn by the canvas below to match Pine plot.style_linebr.
     * Lightweight line series can visually bridge old segments on some data sets,
     * so the built-in line series stays empty.
     */
    nrtrLongSeriesRef.current?.setData([]);
    nrtrShortSeriesRef.current?.setData([]);
  }, [nrtrLongLineData, nrtrShortLineData, showNrtr]);

  useEffect(() => {
    /**
     * NRTR is drawn on a dedicated canvas because it must behave like
     * Pine plot.style_linebr. Since Lightweight Charts scroll/zoom transforms
     * change continuously, this canvas must redraw with the chart, not only
     * when data changes.
     */
    if (nrtrAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(nrtrAnimationFrameRef.current);
      nrtrAnimationFrameRef.current = null;
    }

    const clearNrtrCanvas = () => {
      const canvas = nrtrCanvasRef.current;
      const context = canvas?.getContext("2d");

      if (!canvas || !context) return;

      context.clearRect(0, 0, canvas.width, canvas.height);
    };

    if (
      !showNrtr ||
      nrtrPoints.length === 0 ||
      overlaySize.width <= 0 ||
      overlaySize.height <= 0
    ) {
      clearNrtrCanvas();
      return;
    }

    let cancelled = false;

    const drawFrame = () => {
      if (cancelled) return;

      if (
        nrtrCanvasRef.current &&
        chartRef.current &&
        candleSeriesRef.current
      ) {
        drawNrtrLineBreakCanvas(
          nrtrCanvasRef.current,
          chartRef.current,
          candleSeriesRef.current,
          nrtrPoints,
          overlaySize.width,
          overlaySize.height
        );
      }

      nrtrAnimationFrameRef.current = window.requestAnimationFrame(drawFrame);
    };

    nrtrAnimationFrameRef.current = window.requestAnimationFrame(drawFrame);

    return () => {
      cancelled = true;

      if (nrtrAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(nrtrAnimationFrameRef.current);
        nrtrAnimationFrameRef.current = null;
      }
    };
  }, [nrtrPoints, overlaySize.height, overlaySize.width, showNrtr]);

  useEffect(() => {
    if (!candleSeriesRef.current) return;

    const candleSeries = candleSeriesRef.current as unknown as {
      setMarkers?: (markers: any[]) => void;
    };

    if (typeof candleSeries.setMarkers === "function") {
      candleSeries.setMarkers(nrtrMarkers);
    }
  }, [nrtrMarkers]);

  useEffect(() => {
    if (!ghostCandleSeriesRef.current) return;

    ghostCandleSeriesRef.current.setData(ghostDisplayData);
  }, [ghostDisplayData]);

  useEffect(() => {
    if (!chartRef.current) return;

    chartRef.current.applyOptions({
      height,
    });

    setOverlaySize((previous) => ({
      ...previous,
      height,
    }));
  }, [height]);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-slate-800 bg-[#05070d] ${className}`}
      style={{ height }}
    >
      {(symbol || timeframe || mode) && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-slate-800 bg-black/40 px-3 py-1.5 text-xs text-slate-300 backdrop-blur">
          {symbol && <span className="font-semibold text-slate-100">{symbol}</span>}
          {timeframe && <span className="text-slate-500">•</span>}
          {timeframe && <span>{timeframe}</span>}
          <span className="text-slate-500">•</span>
          <span>{mode === "heikinAshi" ? "Heikin Ashi" : "Regular"}</span>
          {showSmma20 && smma20Data.length > 0 && (
            <>
              <span className="text-slate-500">•</span>
              <span>{smmaLength} SMMA</span>
            </>
          )}
          {showNrtr && nrtrPoints.length > 0 && (
            <>
              <span className="text-slate-500">•</span>
              <span>{nrtrSettingsLabel}</span>
            </>
          )}
          {ghostDisplayData.length > 0 && (
            <>
              <span className="text-slate-500">•</span>
              <span>{ghostDisplayData.length} Ghost</span>
            </>
          )}
          {visibleOverlayLines.length > 0 && (
            <>
              <span className="text-slate-500">•</span>
              <span>{visibleOverlayLines.length} Levels</span>
            </>
          )}
          {overlayPayload && showCanvasOverlay && (
            <>
              <span className="text-slate-500">•</span>
              <span>Canvas Overlay</span>
            </>
          )}
        </div>
      )}


      {showNrtr && showNrtrStats && nrtrPoints.length > 0 && (
        <div className="absolute right-3 top-3 z-10 w-[230px] rounded-xl border border-slate-800 bg-black/45 p-3 text-[11px] text-slate-300 shadow-lg backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="font-semibold text-slate-100">NRTR+</span>
              <span className="truncate text-[10px] text-slate-500">{nrtrSettingsLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={
                  nrtrStats.direction === 1
                    ? "text-emerald-300"
                    : nrtrStats.direction === -1
                      ? "text-red-300"
                      : "text-slate-400"
                }
              >
                {nrtrStats.directionText}
              </span>
              <button
                type="button"
                onClick={() => setIsNrtrStatsCollapsed((value) => !value)}
                className="pointer-events-auto rounded-md border border-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:border-amber-400/60 hover:text-amber-300"
              >
                {isNrtrStatsCollapsed ? "Expand" : "Collapse"}
              </button>
            </div>
          </div>

          {isNrtrStatsCollapsed ? (
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-800 bg-black/30 p-2 text-center">
              <div>
                <div className="text-slate-500">P/L</div>
                <div className={Number(nrtrStats.pnlPoints) >= 0 ? "text-emerald-300" : "text-red-300"}>
                  {formatNrtrSigned(nrtrStats.pnlPoints)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Stop</div>
                <div>{formatNrtrNumber(nrtrStats.trailingStop)}</div>
              </div>
              <div>
                <div className="text-slate-500">Bars</div>
                <div>{nrtrStats.barsInTrade}</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <span className="text-slate-500">Mode</span>
              <span className="text-right">{nrtrMode}</span>
              <span className="text-slate-500">Settings</span>
              <span className="text-right">{nrtrMode === "ATR-Based" ? `${Math.max(1, Math.floor(nrtrAtrLength))} / ${Number(nrtrAtrMultiplier).toFixed(2)}` : `${Number(nrtrPercent).toFixed(2)}%`}</span>
              <span className="text-slate-500">Entry</span>
              <span className="text-right">{formatNrtrNumber(nrtrStats.entryPrice)}</span>
              <span className="text-slate-500">Stop</span>
              <span className="text-right">{formatNrtrNumber(nrtrStats.trailingStop)}</span>
              <span className="text-slate-500">P/L pts</span>
              <span
                className={
                  Number(nrtrStats.pnlPoints) >= 0
                    ? "text-right text-emerald-300"
                    : "text-right text-red-300"
                }
              >
                {formatNrtrSigned(nrtrStats.pnlPoints)}
              </span>
              <span className="text-slate-500">Locked</span>
              <span
                className={
                  Number(nrtrStats.lockedProfit) >= 0
                    ? "text-right text-emerald-300"
                    : "text-right text-red-300"
                }
              >
                {formatNrtrSigned(nrtrStats.lockedProfit)}
              </span>
              <span className="text-slate-500">Stretch</span>
              <span className="text-right">{formatNrtrNumber(nrtrStats.distancePercent, 2)}%</span>
              <span className="text-slate-500">Bars</span>
              <span className="text-right">{nrtrStats.barsInTrade}</span>
            </div>
          )}
        </div>
      )}

      {displayData.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-500">
          No candle data available
        </div>
      )}

      <div ref={containerRef} className="h-full w-full" />

      <canvas
        ref={nrtrCanvasRef}
        className="pointer-events-none absolute inset-0 z-[4]"
        aria-hidden="true"
      />

      {showCanvasOverlay && overlayPayload && chartRef.current && candleSeriesRef.current && (
        <LightweightChartOverlayCanvas
          chart={chartRef.current}
          mainSeries={candleSeriesRef.current}
          overlayPayload={overlayPayload}
          candles={overlayCandles}
          width={overlaySize.width}
          height={overlaySize.height}
          showZones={showOverlayZones}
          showLabels={showOverlayLabels}
          showLiquidityProfile={showLiquidityProfile}
          profileLookback={160}
        />
      )}
    </div>
  );
}
