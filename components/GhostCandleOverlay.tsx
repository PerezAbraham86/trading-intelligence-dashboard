"use client";

import React, { useMemo } from "react";
import { Time } from "lightweight-charts";

/**
 * components/GhostCandleOverlay.tsx
 *
 * Purpose:
 * - Base visual/logic component for future Ghost Candle projections.
 * - Keeps Ghost Candles separate from real OHLC candles.
 * - Designed to be connected to LightweightCandlestickChart later.
 *
 * Current role:
 * - Normalizes projected ghost candle data.
 * - Provides confidence/direction helpers.
 * - Displays a compact status panel for testing.
 *
 * Next connection step:
 * - Add `ghostCandles?: GhostCandle[]` prop to LightweightCandlestickChart.
 * - Render ghost candles as a second candlestick series after the current candle.
 *
 * Rule:
 * Raw OHLC = truth
 * Heikin Ashi = visual trend filter
 * Ghost Candles = projected visual path
 */

export type GhostDirection = "bullish" | "bearish" | "neutral";

export type GhostCandle = {
  /**
   * Future chart time.
   * For Lightweight Charts this should usually be Unix seconds.
   */
  time: Time;

  /**
   * Projected OHLC values.
   * These are visual projections only, not true market prices.
   */
  open: number;
  high: number;
  low: number;
  close: number;

  /**
   * Confidence from 0 to 100.
   * Higher confidence can later render with stronger opacity.
   */
  confidence?: number;

  /**
   * Optional model/source metadata.
   */
  direction?: GhostDirection | string;
  source?: string;
  label?: string;
  reason?: string;
};

export type NormalizedGhostCandle = GhostCandle & {
  confidenceValue: number;
  normalizedDirection: GhostDirection;
  bodySize: number;
  range: number;
  isBullish: boolean;
  isBearish: boolean;
  isNeutral: boolean;
};

type GhostCandleOverlayProps = {
  ghostCandles?: GhostCandle[];
  title?: string;
  compact?: boolean;
  showDetails?: boolean;
};

export function clampGhostConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function normalizeGhostDirection(
  direction: unknown,
  open?: number,
  close?: number
): GhostDirection {
  const text = String(direction ?? "").toLowerCase();

  if (
    text.includes("bull") ||
    text.includes("buy") ||
    text.includes("long") ||
    text.includes("up")
  ) {
    return "bullish";
  }

  if (
    text.includes("bear") ||
    text.includes("sell") ||
    text.includes("short") ||
    text.includes("down")
  ) {
    return "bearish";
  }

  if (Number.isFinite(open) && Number.isFinite(close)) {
    if (Number(close) > Number(open)) return "bullish";
    if (Number(close) < Number(open)) return "bearish";
  }

  return "neutral";
}

export function normalizeGhostCandles(
  ghostCandles: GhostCandle[] | undefined
): NormalizedGhostCandle[] {
  if (!Array.isArray(ghostCandles)) return [];

  return ghostCandles
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
    .map((candle) => {
      const normalizedDirection = normalizeGhostDirection(
        candle.direction,
        candle.open,
        candle.close
      );

      const bodySize = Math.abs(candle.close - candle.open);
      const range = Math.max(candle.high - candle.low, 0);
      const confidenceValue = clampGhostConfidence(candle.confidence);

      return {
        ...candle,
        confidenceValue,
        normalizedDirection,
        bodySize,
        range,
        isBullish: normalizedDirection === "bullish",
        isBearish: normalizedDirection === "bearish",
        isNeutral: normalizedDirection === "neutral",
      };
    });
}

export function getAverageGhostConfidence(ghostCandles: GhostCandle[] | undefined): number {
  const normalized = normalizeGhostCandles(ghostCandles);

  if (normalized.length === 0) return 0;

  const total = normalized.reduce((sum, candle) => sum + candle.confidenceValue, 0);
  return clampGhostConfidence(total / normalized.length);
}

export function getDominantGhostDirection(
  ghostCandles: GhostCandle[] | undefined
): GhostDirection {
  const normalized = normalizeGhostCandles(ghostCandles);

  if (normalized.length === 0) return "neutral";

  const bullish = normalized.filter((candle) => candle.isBullish).length;
  const bearish = normalized.filter((candle) => candle.isBearish).length;

  if (bullish > bearish) return "bullish";
  if (bearish > bullish) return "bearish";

  return "neutral";
}

export function getGhostDirectionLabel(direction: GhostDirection): string {
  if (direction === "bullish") return "Bullish projection";
  if (direction === "bearish") return "Bearish projection";
  return "Neutral projection";
}

/**
 * This component is intentionally simple for now.
 * It gives us a safe dashboard test panel before we attach Ghost Candles
 * directly to the chart as a second candlestick series.
 */
export default function GhostCandleOverlay({
  ghostCandles = [],
  title = "Ghost Candles",
  compact = false,
  showDetails = true,
}: GhostCandleOverlayProps) {
  const normalized = useMemo(() => normalizeGhostCandles(ghostCandles), [ghostCandles]);
  const averageConfidence = useMemo(
    () => getAverageGhostConfidence(ghostCandles),
    [ghostCandles]
  );
  const dominantDirection = useMemo(
    () => getDominantGhostDirection(ghostCandles),
    [ghostCandles]
  );

  const directionLabel = getGhostDirectionLabel(dominantDirection);

  return (
    <div className="rounded-xl border border-slate-800 bg-[#05070d] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
            {title}
          </h3>
          <p className="text-xs text-slate-500">
            Projected visual path only • real OHLC remains truth
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-black/30 px-3 py-2 text-right">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            Confidence
          </p>
          <p className="text-sm font-bold text-slate-100">{averageConfidence}%</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            Direction
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-100">{directionLabel}</p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            Candles
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {normalized.length}
          </p>
        </div>
      </div>

      {showDetails && !compact && normalized.length > 0 && (
        <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-black/30 text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Direction</th>
                <th className="px-3 py-2 font-medium">Close</th>
                <th className="px-3 py-2 font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {normalized.map((candle, index) => (
                <tr key={`${String(candle.time)}-${index}`} className="border-t border-slate-800">
                  <td className="px-3 py-2 text-slate-400">{index + 1}</td>
                  <td className="px-3 py-2 text-slate-200">
                    {getGhostDirectionLabel(candle.normalizedDirection)}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{candle.close}</td>
                  <td className="px-3 py-2 text-slate-300">
                    {candle.confidenceValue}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {normalized.length === 0 && (
        <div className="mt-3 rounded-lg border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
          No ghost candle projections received yet.
        </div>
      )}
    </div>
  );
}
