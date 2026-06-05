"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickData,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
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
}: LightweightCandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ghostCandleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const hasFitContentRef = useRef(false);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height });

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
   * Ghost Candles are projected visuals only.
   * They should be future candles from the backend/ML layer.
   */
  const ghostDisplayData = useMemo(() => {
    return toGhostChartCandles(ghostCandles);
  }, [ghostCandles]);

  /**
   * Price-scale labels / createPriceLine overlays are intentionally disabled.
   * The TradingView-style visuals should be drawn by the canvas layer only.
   * This prevents stacked right-axis labels like BOS, CHoCH, DLM levels, sweeps.
   */
  const visibleOverlayLines = useMemo(() => {
    return [] as ChartOverlayLine[];
  }, [overlayLines, showOverlayLines]);

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

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;

      chartRef.current?.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
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

      {displayData.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-500">
          No candle data available
        </div>
      )}

      <div ref={containerRef} className="h-full w-full" />

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
