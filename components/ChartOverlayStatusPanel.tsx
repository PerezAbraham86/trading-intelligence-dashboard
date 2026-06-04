"use client";

import React, { useMemo } from "react";
import {
  buildChartOverlayPayload,
  ChartOverlayPayload,
  OverlayCandle,
  OverlayDirection,
} from "@/lib/chartOverlayPrep";

/**
 * components/ChartOverlayStatusPanel.tsx
 *
 * Purpose:
 * - Visual status panel for SMC + AlphaX DLM overlay preparation.
 * - Shows what the overlay engine is detecting before we draw directly on the chart.
 * - Safe dashboard component: it does not modify Lightweight Charts yet.
 *
 * Rule:
 * Raw OHLC = truth
 * Heikin Ashi = visual trend filter
 * SMC = structure context
 * AlphaX DLM = liquidity and pressure context
 * Ghost Candles = projected visual path
 */

type ChartOverlayStatusPanelProps = {
  candles: OverlayCandle[];
  title?: string;
  compact?: boolean;
  maxRecentItems?: number;
};

function getDirectionText(direction: OverlayDirection): string {
  if (direction === "bullish") return "Bullish";
  if (direction === "bearish") return "Bearish";
  return "Neutral";
}

function getDirectionBadgeClass(direction: OverlayDirection): string {
  if (direction === "bullish") {
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
  }

  if (direction === "bearish") {
    return "border-red-400/30 bg-red-400/10 text-red-300";
  }

  return "border-amber-400/30 bg-amber-400/10 text-amber-300";
}

function formatPrice(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return "—";

  const price = Number(value);

  if (Math.abs(price) >= 1000) return price.toFixed(2);
  if (Math.abs(price) >= 100) return price.toFixed(2);
  if (Math.abs(price) >= 10) return price.toFixed(3);

  return price.toFixed(4);
}

function formatTime(value: unknown): string {
  if (typeof value === "number") {
    return new Date(value * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);

    if (Number.isFinite(parsed)) {
      return new Date(parsed).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    return value;
  }

  return "—";
}

function buildEmptyPayload(): ChartOverlayPayload | null {
  return null;
}

export default function ChartOverlayStatusPanel({
  candles,
  title = "SMC + AlphaX Overlay Engine",
  compact = false,
  maxRecentItems = 6,
}: ChartOverlayStatusPanelProps) {
  const payload = useMemo(() => {
    if (!Array.isArray(candles) || candles.length < 20) {
      return buildEmptyPayload();
    }

    return buildChartOverlayPayload(candles, {
      smcSwingLength: 3,
      smcUseCloseBreak: true,
      alphaXLookback: 20,
      alphaXRejectionWickPercent: 45,
      maxLines: 40,
      maxZones: 20,
      maxMarkers: 40,
    });
  }, [candles]);

  const recentMarkers = useMemo(() => {
    return payload?.markers.slice(-maxRecentItems).reverse() ?? [];
  }, [payload, maxRecentItems]);

  const recentZones = useMemo(() => {
    return payload?.zones.slice(-maxRecentItems).reverse() ?? [];
  }, [payload, maxRecentItems]);

  if (!payload) {
    return (
      <div className="rounded-xl border border-slate-800 bg-[#05070d] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
              {title}
            </h3>
            <p className="text-xs text-slate-500">
              Waiting for enough real OHLC candles to analyze structure.
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-black/30 px-3 py-2 text-right">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">
              Candles
            </p>
            <p className="text-sm font-bold text-slate-100">
              {Array.isArray(candles) ? candles.length : 0}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
          Need at least 20 candles for the overlay engine.
        </div>
      </div>
    );
  }

  const { summary, smc, alphaX } = payload;

  return (
    <div className="rounded-xl border border-slate-800 bg-[#05070d] p-4">
      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
            {title}
          </h3>
          <p className="text-xs text-slate-500">
            Structure + liquidity prep layer • chart drawings come next
          </p>
        </div>

        <div
          className={`rounded-lg border px-3 py-2 text-right ${getDirectionBadgeClass(
            summary.combinedBias
          )}`}
        >
          <p className="text-[10px] uppercase tracking-wide opacity-75">
            Combined Bias
          </p>
          <p className="text-sm font-bold">{getDirectionText(summary.combinedBias)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">SMC Trend</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {getDirectionText(summary.smcTrend)}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">AlphaX Bias</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {getDirectionText(summary.alphaXBias)}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Confidence Hint</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {summary.confidenceHint}%
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Objects</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {summary.lineCount + summary.zoneCount + summary.markerCount}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            Latest Structure
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {summary.latestStructureLabel}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Events: {smc.structureEvents.length} • Sweeps: {smc.liquiditySweeps.length}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            Latest Pressure
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {summary.latestPressureLabel}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            States: {alphaX.pressureStates.length} • Zones: {alphaX.pressureZones.length}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            Latest Rejection
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {summary.latestRejectionLabel}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Rejections: {alphaX.rejectionLevels.length} • Imbalances: {alphaX.imbalances.length}
          </p>
        </div>
      </div>

      {!compact && (
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-800">
            <div className="border-b border-slate-800 bg-black/30 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Recent Markers
              </p>
            </div>

            {recentMarkers.length > 0 ? (
              <div className="max-h-56 overflow-auto">
                {recentMarkers.map((marker) => (
                  <div
                    key={marker.id}
                    className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2 last:border-b-0"
                  >
                    <div>
                      <p className="text-xs font-semibold text-slate-200">{marker.label}</p>
                      <p className="text-[11px] text-slate-500">
                        {formatTime(marker.time)} • {marker.type}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-xs font-semibold text-slate-300">
                        {formatPrice(marker.price)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {getDirectionText(marker.direction)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-slate-500">
                No markers detected yet.
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-800">
            <div className="border-b border-slate-800 bg-black/30 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Recent Zones
              </p>
            </div>

            {recentZones.length > 0 ? (
              <div className="max-h-56 overflow-auto">
                {recentZones.map((zone) => (
                  <div
                    key={zone.id}
                    className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2 last:border-b-0"
                  >
                    <div>
                      <p className="text-xs font-semibold text-slate-200">{zone.label}</p>
                      <p className="text-[11px] text-slate-500">
                        {formatTime(zone.startTime)} → {formatTime(zone.endTime)}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-xs font-semibold text-slate-300">
                        {formatPrice(zone.low)} - {formatPrice(zone.high)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {getDirectionText(zone.direction)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-slate-500">
                No zones detected yet.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
