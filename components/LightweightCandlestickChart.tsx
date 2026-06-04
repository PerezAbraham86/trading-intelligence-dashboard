"use client";

import React, { useEffect, useMemo, useRef } from "react";
import {
  CandlestickData,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  Time,
  createChart,
} from "lightweight-charts";

/**
 * LightweightCandlestickChart.tsx
 *
 * Purpose:
 * - New fast candle chart component using TradingView Lightweight Charts.
 * - Keeps real OHLC candles as master truth.
 * - Calculates Heikin Ashi locally only for visual display.
 * - Supports a regular / Heikin Ashi display toggle through the `mode` prop.
 *
 * Install dependency:
 * npm install lightweight-charts
 *
 * Next planned files:
 * - lib/heikinAshi.ts
 * - app/page.tsx import replacement
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
  mode?: ChartMode;
  height?: number;
  className?: string;
  symbol?: string;
  timeframe?: string;
  autoFit?: boolean;
};

function toChartCandles(candles: DashboardCandle[]): CandlestickData<Time>[] {
  return candles
    .filter((c) => {
      return (
        c &&
        c.time !== undefined &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close)
      );
    })
    .map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
}

function calculateHeikinAshi(
  candles: DashboardCandle[]
): CandlestickData<Time>[] {
  if (!candles.length) return [];

  const haCandles: CandlestickData<Time>[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    if (
      !c ||
      c.time === undefined ||
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close)
    ) {
      continue;
    }

    const haClose = (c.open + c.high + c.low + c.close) / 4;

    let haOpen: number;

    if (haCandles.length === 0) {
      haOpen = (c.open + c.close) / 2;
    } else {
      const prev = haCandles[haCandles.length - 1];
      haOpen = (prev.open + prev.close) / 2;
    }

    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);

    haCandles.push({
      time: c.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
    });
  }

  return haCandles;
}

export default function LightweightCandlestickChart({
  candles,
  mode = "regular",
  height = 520,
  className = "",
  symbol = "",
  timeframe = "",
  autoFit = true,
}: LightweightCandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const hasFitContentRef = useRef(false);

  /**
   * Cache both versions so the chart toggle is instant.
   * Raw candles remain the truth.
   * Heikin Ashi candles are visual-only.
   */
  const chartData = useMemo(() => {
    const regular = toChartCandles(candles);
    const heikinAshi = calculateHeikinAshi(candles);

    return {
      regular,
      heikinAshi,
    };
  }, [candles]);

  const displayData = mode === "heikinAshi" ? chartData.heikinAshi : chartData.regular;

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
        rightOffset: 8,
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

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    resizeObserverRef.current = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !chartRef.current) return;

      const width = Math.floor(entry.contentRect.width);

      if (width > 0) {
        chartRef.current.applyOptions({
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
    if (!chartRef.current) return;

    chartRef.current.applyOptions({
      height,
    });
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
        </div>
      )}

      {displayData.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-500">
          No candle data available
        </div>
      )}

      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
