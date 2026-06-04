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
import { calculateHeikinAshi, RawCandle } from "@/lib/heikinAshi";

/**
 * LightweightCandlestickChart.tsx
 *
 * Purpose:
 * - Fast main candle chart using TradingView Lightweight Charts.
 * - Keeps real OHLC candles as master truth.
 * - Uses lib/heikinAshi.ts for Heikin Ashi visual calculation.
 * - Supports a regular / Heikin Ashi display toggle through the `mode` prop.
 *
 * Rule:
 * Raw OHLC = truth
 * Heikin Ashi = visual trend filter
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
  mode?: ChartMode;
  height?: number;
  className?: string;
  symbol?: string;
  timeframe?: string;
  autoFit?: boolean;
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
