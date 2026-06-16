"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

type AiTraderPanelProps = {
  apiBaseUrl?: string;
  symbol: string;
  timeframe: string;
  activePrice?: number;
  signal?: any;
  scorecards?: any;
  overlayPayload?: any;
  unifiedIntelligence?: any;
  projectionEngine?: any;
  candles?: any[];
  strategyTesterResults?: any;
};

type AiTraderDecision = {
  eventType?: string;
  status?: string;
  dashboardOnly?: boolean;
  brokerConnected?: boolean;
  allowedToTrade?: boolean;
  decision?: "BUY" | "SELL" | "HOLD" | string;
  rawDecision?: "BUY" | "SELL" | "HOLD" | string;
  confidence?: number;
  baseConfidence?: number;
  learningAdjustment?: number;
  confidenceGrade?: string;
  symbol?: string;
  timeframe?: string;
  entry?: number;
  target?: number;
  stop?: number;
  riskReward?: number;
  currentPrice?: number;
  currentPnl?: number;
  maxPnl?: number;
  riskPnl?: number;
  reason?: string;
  reasons?: string[];
  details?: any;
  createdAt?: string;
};

type AiTraderSummary = {
  eventType?: string;
  status?: string;
  dashboardOnly?: boolean;
  brokerConnected?: boolean;
  openTrades?: any[];
  closedTrades?: any[];
  recentClosedTrades?: any[];
  openCount?: number;
  closedCount?: number;
  decisionStats?: {
    samples?: number;
    buyBias?: number;
    sellBias?: number;
    holdCount?: number;
    tradeReadyCount?: number;
    avgConfidence?: number;
  };
  memoryStatus?: {
    stage?: string;
    message?: string;
    bucketDecisionStats?: any;
    overallDecisionStats?: any;
    bucketClosedStats?: any;
    overallClosedStats?: any;
  };
  stats?: {
    samples?: number;
    wins?: number;
    losses?: number;
    winRate?: number;
    profitFactor?: number;
    avgPnl?: number;
    avgR?: number;
  };
};

type AiTradeCloseReason =
  | "TARGET_HIT"
  | "STOP_HIT"
  | "AI_REVERSAL_EXIT"
  | "AI_CONFIDENCE_EXIT"
  | "MANUAL_CLOSE";

function toFiniteNumber(value: any, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatPrice(value: any) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) return "—";

  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: parsed > 100 ? 2 : 4,
    maximumFractionDigits: parsed > 100 ? 2 : 6,
  });
}

function formatMoney(value: any) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return "—";

  const sign = parsed > 0 ? "+" : parsed < 0 ? "-" : "";

  return `${sign}$${Math.abs(parsed).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPercent(value: any) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return "—";

  return `${(parsed * 100).toFixed(2)}%`;
}

function formatCount(value: any) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return "0";

  return Math.max(0, Math.round(parsed)).toLocaleString();
}

function formatTradeDateTime(value: any) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function formatAiStage(value: any) {
  const raw = String(value ?? "WARMING_UP")
    .replace(/_/g, " ")
    .toLowerCase();
  return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeDecision(value: any): "BUY" | "SELL" | "HOLD" {
  const raw = String(value ?? "").toUpperCase();

  if (raw.includes("BUY") || raw.includes("LONG") || raw.includes("BULL"))
    return "BUY";
  if (raw.includes("SELL") || raw.includes("SHORT") || raw.includes("BEAR"))
    return "SELL";

  return "HOLD";
}

function normalizeTradeSide(value: any): "BUY" | "SELL" {
  const side = normalizeDecision(value);
  return side === "SELL" ? "SELL" : "BUY";
}

function sanitizeAiTraderPayload(value: any, depth = 0): any {
  if (depth > 6) return null;
  if (value === undefined || value === null) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 80)
      .map((item) => sanitizeAiTraderPayload(item, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, any> = {};

    Object.entries(value).forEach(([key, entry]) => {
      if (typeof entry === "function") return;
      if (typeof entry === "symbol") return;
      result[key] = sanitizeAiTraderPayload(entry, depth + 1);
    });

    return result;
  }

  return null;
}

async function readApiError(response: Response) {
  const text = await response.text().catch(() => "");

  if (!text) return `${response.status}`;

  try {
    const json = JSON.parse(text);
    return `${response.status}: ${JSON.stringify(json).slice(0, 500)}`;
  } catch {
    return `${response.status}: ${text.slice(0, 500)}`;
  }
}

function createRequestTimeout(timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => window.clearTimeout(timeoutId),
  };
}

function formatRequestError(error: any, fallback: string) {
  if (error?.name === "AbortError") {
    return `${fallback}: request timed out. Backend may be busy; try again after the current refresh finishes.`;
  }

  return error instanceof Error ? error.message : fallback;
}

function readNumberPath(source: any, paths: string[]) {
  for (const path of paths) {
    const value = path.split(".").reduce((current: any, key: string) => {
      if (current && typeof current === "object" && key in current)
        return current[key];
      return undefined;
    }, source);

    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return undefined;
}

function readProjectionEngine(
  signal: any,
  overlayPayload: any,
  unifiedIntelligence: any,
) {
  const candidates = [
    unifiedIntelligence?.projectionEngine,
    unifiedIntelligence?.unifiedProjectionEngine,
    unifiedIntelligence?.components?.projectionEngine,
    unifiedIntelligence?.components?.unifiedProjectionEngine,
    signal?.projectionEngine,
    signal?.unifiedProjectionEngine,
    overlayPayload?.projectionEngine,
    overlayPayload?.unifiedProjectionEngine,
    overlayPayload?.unifiedIntelligence?.projectionEngine,
    overlayPayload?.unifiedIntelligence?.unifiedProjectionEngine,
    unifiedIntelligence,
  ];

  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      (candidate.eventType === "UNIFIED_PROJECTION_ENGINE" ||
        candidate.ghostPath ||
        candidate.target ||
        candidate.alignment ||
        candidate.activeTargetPrice)
    ) {
      return candidate;
    }
  }

  return null;
}

function readProjectionTarget(projectionEngine: any) {
  if (!projectionEngine || typeof projectionEngine !== "object")
    return undefined;

  return readNumberPath(projectionEngine, [
    "activeTargetPrice",
    "target.price",
    "targetPrice",
    "targetPlan.targetPrice",
    "targetPlan.finalTargetPrice",
    "targetMl.targetPrice",
    "finalTargetPrice",
    "ghostOverlayTargetPrice",
    "ghostPath.targetPrice",
    "ghostPath.endPrice",
  ]);
}

function readProjectionGhostConfidence(projectionEngine: any) {
  if (!projectionEngine || typeof projectionEngine !== "object") return 0;

  return Math.max(
    toFiniteNumber(projectionEngine?.ghostConfidence, 0),
    toFiniteNumber(projectionEngine?.ghostPath?.confidence, 0),
    toFiniteNumber(projectionEngine?.alignment?.score, 0),
  );
}

function readProjectionTargetConfidence(projectionEngine: any) {
  if (!projectionEngine || typeof projectionEngine !== "object") return 0;

  const targetType = String(
    projectionEngine?.activeTargetType ??
      projectionEngine?.target?.type ??
      projectionEngine?.targetPlan?.type ??
      "",
  );

  if (targetType === "GHOST_OVERLAY_TARGET") return 0;

  return Math.max(
    toFiniteNumber(projectionEngine?.targetConfidence, 0),
    toFiniteNumber(projectionEngine?.activeTargetConfidence, 0),
    toFiniteNumber(projectionEngine?.target?.confidence, 0),
    toFiniteNumber(projectionEngine?.targetPlan?.targetConfidence, 0),
    toFiniteNumber(projectionEngine?.targetMl?.targetConfidence, 0),
  );
}

function readProjectionSide(projectionEngine: any, fallback: any) {
  const direction = String(
    projectionEngine?.target?.direction ??
      projectionEngine?.ghostPath?.direction ??
      projectionEngine?.marketState?.direction ??
      projectionEngine?.targetDirection ??
      "",
  ).toUpperCase();

  if (
    direction.includes("BULL") ||
    direction.includes("UP") ||
    direction.includes("BUY")
  )
    return "BUY";
  if (
    direction.includes("BEAR") ||
    direction.includes("DOWN") ||
    direction.includes("SELL")
  )
    return "SELL";

  return normalizeDecision(fallback);
}

function buildProjectionEngineSnapshot(projectionEngine: any) {
  if (!projectionEngine || typeof projectionEngine !== "object") {
    return {
      available: false,
      targetPrice: undefined,
      targetConfidence: 0,
      ghostConfidence: 0,
      alignmentScore: 0,
      alignmentLabel: "Waiting",
      projectionMode: "WAITING",
      projectionModeLabel: "Waiting",
      aiPermission: "WAIT",
      conflict: false,
      source: "Unified Projection Engine",
    };
  }

  const targetPrice = readProjectionTarget(projectionEngine);
  const targetConfidence = readProjectionTargetConfidence(projectionEngine);
  const ghostConfidence = readProjectionGhostConfidence(projectionEngine);
  const alignmentScore = toFiniteNumber(projectionEngine?.alignment?.score, 0);
  const conflict = Boolean(
    projectionEngine?.alignment?.conflict || projectionEngine?.mode?.conflict,
  );

  return {
    available: Boolean(targetPrice),
    targetPrice,
    targetConfidence,
    ghostConfidence,
    alignmentScore,
    alignmentLabel: String(projectionEngine?.alignment?.label ?? "Waiting"),
    projectionMode: String(
      projectionEngine?.projectionMode ??
        projectionEngine?.mode?.mode ??
        "WAITING",
    ),
    projectionModeLabel: String(
      projectionEngine?.projectionModeLabel ??
        projectionEngine?.mode?.label ??
        "Waiting",
    ),
    aiPermission: String(projectionEngine?.aiPermission ?? "WAIT"),
    conflict,
    source: String(
      projectionEngine?.activeTargetSource ??
        projectionEngine?.target?.source ??
        "Unified Projection Engine",
    ),
    targetType: String(
      projectionEngine?.activeTargetType ??
        projectionEngine?.target?.type ??
        "",
    ),
    targetSourceLockActive: Boolean(projectionEngine?.targetSourceLockActive),
    targetLockedConfidence: toFiniteNumber(
      projectionEngine?.targetLockedConfidence ??
        projectionEngine?.target?.lockedConfidence ??
        targetConfidence,
      targetConfidence,
    ),
    targetLiveConfidence: toFiniteNumber(
      projectionEngine?.targetLiveConfidence ??
        projectionEngine?.target?.liveConfidence ??
        targetConfidence,
      targetConfidence,
    ),
    learnedReliability: toFiniteNumber(
      projectionEngine?.targetMl?.learnedReliability ??
        projectionEngine?.targetPlan?.learnedReliability ??
        0,
      0,
    ),
    marketState: projectionEngine?.marketState,
    target: projectionEngine?.target,
    ghostPath: projectionEngine?.ghostPath,
    alignment: projectionEngine?.alignment,
    mode: projectionEngine?.mode,
    learning: projectionEngine?.learning,
  };
}

function inferTargetFromSignal(signal: any) {
  return readNumberPath(signal, [
    "projectionEngine.activeTargetPrice",
    "projectionEngine.target.price",
    "projectionEngine.targetPrice",
    "projectionEngine.targetPlan.targetPrice",
    "projectionEngine.targetMl.targetPrice",
    "projectionEngine.finalTargetPrice",
    "projectionEngine.ghostOverlayTargetPrice",
    "unifiedProjectionEngine.activeTargetPrice",
    "unifiedProjectionEngine.target.price",
    "unifiedProjectionEngine.targetPrice",
    "unifiedProjectionEngine.targetPlan.targetPrice",
    "unifiedProjectionEngine.targetMl.targetPrice",
    "unifiedProjectionEngine.finalTargetPrice",
    "unifiedProjectionEngine.ghostOverlayTargetPrice",
    "finalTargetPrice",
    "overallTargetPrice",
    "targetMl.finalTargetPrice",
    "targetMl.overallTargetPrice",
    "targetMl.targetPrice",
    "targetPlan.finalTargetPrice",
    "targetPlan.overallTargetPrice",
    "targetPlan.targetPrice",
    "activeTargetPrice",
    "ghostOverlayTargetPrice",
    "targetMl.activeTargetPrice",
    "targetMl.ghostOverlayTargetPrice",
    "targetPlan.activeTargetPrice",
    "targetPlan.ghostOverlayTargetPrice",
    "overlayPayload.finalTargetPrice",
    "overlayPayload.overallTargetPrice",
    "overlayPayload.targetMl.finalTargetPrice",
    "overlayPayload.targetMl.overallTargetPrice",
    "overlayPayload.targetMl.targetPrice",
    "overlayPayload.activeTargetPrice",
    "overlayPayload.ghostOverlayTargetPrice",
  ]);
}

function inferEntryFromSignal(signal: any, activePrice?: number) {
  return (
    readNumberPath(signal, [
      "entryPrice",
      "entry",
      "nrtrEntryPrice",
      "strategyEntryPrice",
      "price",
      "close",
    ]) ?? activePrice
  );
}

function buildTargetMlSnapshot(
  signal: any,
  overlayPayload: any,
  unifiedIntelligence?: any,
) {
  const projectionEngine = readProjectionEngine(
    signal,
    overlayPayload,
    unifiedIntelligence,
  );
  const projectionSnapshot = buildProjectionEngineSnapshot(projectionEngine);
  const targetPrice =
    projectionSnapshot.targetPrice ??
    inferTargetFromSignal(signal) ??
    readNumberPath(overlayPayload, [
      "finalTargetPrice",
      "overallTargetPrice",
      "targetPrice",
      "targetMl.targetPrice",
      "targetPlan.targetPrice",
    ]);

  const targetConfidence = Math.max(
    toFiniteNumber(projectionSnapshot.targetConfidence, 0),
    toFiniteNumber(
      signal?.targetConfidence ??
        signal?.targetMl?.targetConfidence ??
        overlayPayload?.targetConfidence ??
        overlayPayload?.targetMl?.targetConfidence,
      0,
    ),
  );

  const targetMlAligned = Boolean(
    projectionSnapshot.available ||
    signal?.targetMlAligned ||
    signal?.targetMl?.targetMlAligned ||
    overlayPayload?.targetMlAligned ||
    overlayPayload?.targetMl?.targetMlAligned,
  );

  return {
    targetConfidence,
    targetMlReady: Boolean(
      targetPrice || targetConfidence > 0 || targetMlAligned,
    ),
    targetMlAligned,
    targetPrice,
    source:
      projectionSnapshot.source ??
      signal?.targetSource ??
      signal?.targetMl?.source ??
      overlayPayload?.targetSource ??
      overlayPayload?.targetMl?.source ??
      "ghost_target_ml_context",
    projectionEngine: projectionSnapshot,
  };
}

function buildGhostMlSnapshot(
  signal: any,
  overlayPayload: any,
  unifiedIntelligence?: any,
) {
  const projectionEngine = readProjectionEngine(
    signal,
    overlayPayload,
    unifiedIntelligence,
  );
  const projectionSnapshot = buildProjectionEngineSnapshot(projectionEngine);

  return {
    confidence: Math.max(
      toFiniteNumber(projectionSnapshot.ghostConfidence, 0),
      toFiniteNumber(
        signal?.ghostConfidence ??
          signal?.confidence ??
          signal?.mlConfidence ??
          overlayPayload?.ghostConfidence,
        0,
      ),
    ),
    mlReady: Boolean(
      projectionSnapshot.available ||
      Boolean(
        signal?.mlReady ?? signal?.ghostMlReady ?? overlayPayload?.mlReady,
      ),
    ),
    ghostConfidenceBoost: toFiniteNumber(
      signal?.ghostConfidenceBoost ?? overlayPayload?.ghostConfidenceBoost,
      0,
    ),
  };
}

function buildEntryMlSnapshot(signal: any) {
  return {
    entryConfidence: toFiniteNumber(
      signal?.entryConfidence ?? signal?.entryMlConfidence,
      0,
    ),
    confidence: toFiniteNumber(
      signal?.entryConfidence ?? signal?.entryMlConfidence,
      0,
    ),
  };
}

function getLatestCandleClose(candles: any[] | undefined) {
  if (!Array.isArray(candles) || candles.length === 0) return undefined;

  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index];
    const close = toFiniteNumber(candle?.close ?? candle?.c, 0);

    if (close > 0) return close;
  }

  return undefined;
}

function getLatestCandleTime(candles: any[] | undefined) {
  if (!Array.isArray(candles) || candles.length === 0)
    return new Date().toISOString();

  const candle = candles[candles.length - 1];
  const raw =
    candle?.time ??
    candle?.timestamp ??
    candle?.t ??
    candle?.datetime ??
    candle?.date;

  if (typeof raw === "number") {
    return new Date(raw > 10_000_000_000 ? raw : raw * 1000).toISOString();
  }

  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
  }

  return new Date().toISOString();
}


function getCandleEpochMs(value: any) {
  const raw = value?.time ?? value?.timestamp ?? value?.t ?? value?.datetime ?? value?.date ?? value;

  if (typeof raw === "number") {
    return raw > 10_000_000_000 ? raw : raw * 1000;
  }

  if (typeof raw === "string") {
    if (/^\d+$/.test(raw.trim())) {
      const parsed = Number(raw.trim());
      return parsed > 10_000_000_000 ? parsed : parsed * 1000;
    }

    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function getTradeEntryEpochMs(trade: any) {
  return getCandleEpochMs(trade?.entryTime ?? trade?.createdAt ?? trade?.openedAt ?? trade?.time);
}

function getCandlesAfterTradeEntry(candles: any[] | undefined, trade: any) {
  if (!Array.isArray(candles) || candles.length === 0) return [] as any[];

  const entryMs = getTradeEntryEpochMs(trade);
  if (entryMs <= 0) return candles.slice(-2);

  return candles.filter((candle) => getCandleEpochMs(candle) >= entryMs);
}

function getTradeLevelHitPrice({
  trade,
  livePrice,
  candles,
}: {
  trade: any;
  livePrice: number;
  candles?: any[];
}) {
  const current = getTradeLiveCurrentPrice(trade, livePrice);
  const side = normalizeTradeSide(trade?.side ?? trade?.decision ?? trade?.rawDecision);
  const target = toFiniteNumber(trade?.target ?? trade?.targetPrice ?? trade?.takeProfitPrice ?? trade?.tp1, 0);
  const stop = toFiniteNumber(trade?.stop ?? trade?.stopPrice, 0);
  const entryMs = getTradeEntryEpochMs(trade);
  const nowMs = Date.now();

  // Safety guard: never close a just-created paper trade on the same render tick.
  // The trade must exist long enough for at least one real live-price/chart update
  // to evaluate it. This prevents fabricated instant open/close rows.
  if (entryMs > 0 && nowMs - entryMs < 1500) {
    return { current, targetHit: false, stopHit: false, price: current };
  }

  const afterEntryCandles = getCandlesAfterTradeEntry(candles, trade);
  const hitFromCandle = afterEntryCandles.some((candle) => {
    const high = toFiniteNumber(candle?.high ?? candle?.h, NaN);
    const low = toFiniteNumber(candle?.low ?? candle?.l, NaN);
    if (!Number.isFinite(high) || !Number.isFinite(low)) return false;

    if (side === "BUY") {
      if (target > 0 && high >= target) return true;
      if (stop > 0 && low <= stop) return true;
    } else {
      if (target > 0 && low <= target) return true;
      if (stop > 0 && high >= stop) return true;
    }

    return false;
  });

  const buyTargetHit = target > 0 && side === "BUY" && current >= target;
  const buyStopHit = stop > 0 && side === "BUY" && current <= stop;
  const sellTargetHit = target > 0 && side === "SELL" && current <= target;
  const sellStopHit = stop > 0 && side === "SELL" && current >= stop;

  if (buyTargetHit || sellTargetHit) return { current, targetHit: true, stopHit: false, price: target };
  if (buyStopHit || sellStopHit) return { current, targetHit: false, stopHit: true, price: stop };

  // Candle high/low confirmation is allowed only after the trade exists. This
  // ties closed rows to the main chart timeframe and prevents backend/random
  // fills from creating fake outcomes.
  if (hitFromCandle) {
    for (const candle of afterEntryCandles) {
      const high = toFiniteNumber(candle?.high ?? candle?.h, NaN);
      const low = toFiniteNumber(candle?.low ?? candle?.l, NaN);
      if (!Number.isFinite(high) || !Number.isFinite(low)) continue;

      if (side === "BUY") {
        if (target > 0 && high >= target) return { current, targetHit: true, stopHit: false, price: target };
        if (stop > 0 && low <= stop) return { current, targetHit: false, stopHit: true, price: stop };
      } else {
        if (target > 0 && low <= target) return { current, targetHit: true, stopHit: false, price: target };
        if (stop > 0 && high >= stop) return { current, targetHit: false, stopHit: true, price: stop };
      }
    }
  }

  return { current, targetHit: false, stopHit: false, price: current };
}

function getLatestCandleAutoKey(candles: any[] | undefined) {
  if (!Array.isArray(candles) || candles.length === 0) return "no-candle";

  const candle = candles[candles.length - 1];
  return String(
    candle?.time ??
      candle?.timestamp ??
      candle?.t ??
      candle?.datetime ??
      candle?.date ??
      candle?.epoch ??
      "no-candle",
  );
}

function buildAiTradeSetupKey({
  symbol,
  timeframe,
  candles,
  side,
  entry,
  target,
  stop,
}: {
  symbol: string;
  timeframe: string;
  candles?: any[];
  side: any;
  entry: any;
  target: any;
  stop: any;
}) {
  return [
    String(symbol ?? "UNKNOWN").toUpperCase(),
    String(timeframe ?? "UNKNOWN"),
    getLatestCandleAutoKey(candles),
    normalizeDecision(side),
    Number(entry ?? 0).toFixed(4),
    Number(target ?? 0).toFixed(4),
    Number(stop ?? 0).toFixed(4),
  ].join("|");
}

function pruneRecentSetupKeys(
  map: Map<string, number>,
  now = Date.now(),
  ttlMs = 5 * 60 * 1000,
) {
  Array.from(map.entries()).forEach(([key, timestamp]) => {
    if (!Number.isFinite(timestamp) || now - timestamp > ttlMs) {
      map.delete(key);
    }
  });
}

function getLiveAiCurrentPrice(
  activePrice: any,
  signal: any,
  candles: any[] | undefined,
) {
  const candidates = [
    activePrice,
    getLatestCandleClose(candles),
    signal?.current,
    signal?.price,
    signal?.entry,
    signal?.close,
    signal?.last,
  ];

  for (const candidate of candidates) {
    const value = toFiniteNumber(candidate, 0);
    if (value > 0) return value;
  }

  return 0;
}

function getTradeLiveCurrentPrice(trade: any, livePrice: number) {
  const live = toFiniteNumber(livePrice, 0);
  if (live > 0) return live;

  return toFiniteNumber(
    trade?.currentPrice ??
      trade?.current ??
      trade?.lastPrice ??
      trade?.markPrice ??
      trade?.entry,
    0,
  );
}

function getAiTradeTickSize(symbol: any) {
  const text = String(symbol ?? "").toUpperCase();

  if (text.includes("MES") || text.includes("ES")) return 0.25;
  if (text.includes("BTC")) return 0.5;
  if (text.includes("ETH")) return 0.05;

  return 0.01;
}

function roundAiTradePriceToTick(price: number, symbol: any) {
  if (!Number.isFinite(price) || price <= 0) return 0;

  const tickSize = getAiTradeTickSize(symbol);
  if (!Number.isFinite(tickSize) || tickSize <= 0) return Number(price.toFixed(5));

  return Number((Math.round(price / tickSize) * tickSize).toFixed(5));
}

function getProjectionDirectivePermission(value: any) {
  const text = String(value ?? "").toUpperCase();

  if (text.includes("HOLD_CONFLICT")) return "HOLD_CONFLICT";
  if (text.includes("WAIT")) return "WAIT";
  if (text.includes("CAN_CONSIDER") || text.includes("CONSIDER")) return "CAN_CONSIDER";
  if (text.includes("ALLOW") || text.includes("READY")) return "CAN_CONSIDER";

  return text || "WAIT";
}

function buildUnifiedDashboardTradePlan({
  projectionSnapshot,
  livePrice,
  symbol,
  minRiskReward,
  fallbackStop,
  fallbackDecision,
}: {
  projectionSnapshot: any;
  livePrice: number;
  symbol: string;
  minRiskReward: number;
  fallbackStop?: number;
  fallbackDecision?: any;
}) {
  const entry = roundAiTradePriceToTick(toFiniteNumber(livePrice, 0), symbol);
  const projectionTarget = roundAiTradePriceToTick(
    toFiniteNumber(projectionSnapshot?.targetPrice, 0),
    symbol,
  );
  const permission = getProjectionDirectivePermission(projectionSnapshot?.aiPermission);
  const confidence = Math.max(
    toFiniteNumber(projectionSnapshot?.targetConfidence, 0),
    toFiniteNumber(projectionSnapshot?.ghostConfidence, 0),
    toFiniteNumber(projectionSnapshot?.alignmentScore, 0),
  );

  if (entry <= 0 || projectionTarget <= 0 || projectionTarget === entry) {
    return {
      canTrade: false,
      reason: "Unified Intelligence has no actionable target away from live price.",
      permission,
      entry,
      target: projectionTarget,
      stop: 0,
      side: "HOLD" as const,
      confidence,
    };
  }

  if (projectionSnapshot?.conflict || permission === "HOLD_CONFLICT" || permission === "WAIT") {
    return {
      canTrade: false,
      reason: `Unified Intelligence permission is ${permission}; AI should wait instead of forcing a trade.`,
      permission,
      entry,
      target: projectionTarget,
      stop: 0,
      side: "HOLD" as const,
      confidence,
    };
  }

  const side: "BUY" | "SELL" = projectionTarget > entry ? "BUY" : "SELL";
  const rewardPoints = Math.abs(projectionTarget - entry);
  const requiredRiskPoints = rewardPoints / Math.max(0.01, toFiniteNumber(minRiskReward, 1.25));
  const fallbackStopNumber = roundAiTradePriceToTick(toFiniteNumber(fallbackStop, 0), symbol);
  const fallbackStopIsValid =
    fallbackStopNumber > 0 &&
    (side === "BUY" ? fallbackStopNumber < entry : fallbackStopNumber > entry);

  const fallbackRiskPoints = fallbackStopIsValid ? Math.abs(entry - fallbackStopNumber) : 0;

  // The projection target is the final dashboard ML target. Stop is built around
  // that target so the AI does not reverse the trade away from Ghost/Unified Intelligence.
  const stop = fallbackStopIsValid && fallbackRiskPoints <= requiredRiskPoints
    ? fallbackStopNumber
    : roundAiTradePriceToTick(
        side === "BUY" ? entry - requiredRiskPoints : entry + requiredRiskPoints,
        symbol,
      );

  const riskPoints = Math.abs(entry - stop);
  const riskReward = riskPoints > 0 ? Number((rewardPoints / riskPoints).toFixed(2)) : 0;

  return {
    canTrade: true,
    reason: `Unified Intelligence directive: ${side} toward Ghost/Target ML target ${formatPrice(projectionTarget)} with permission ${permission}.`,
    permission,
    entry,
    target: projectionTarget,
    stop,
    side,
    confidence,
    riskReward,
    targetSource: projectionSnapshot?.source ?? "unified_projection_engine",
    projectionMode: projectionSnapshot?.projectionMode,
    projectionModeLabel: projectionSnapshot?.projectionModeLabel,
    ghostConfidence: toFiniteNumber(projectionSnapshot?.ghostConfidence, 0),
    targetConfidence: toFiniteNumber(projectionSnapshot?.targetConfidence, 0),
    fallbackDecision: normalizeDecision(fallbackDecision),
  };
}

function getAiTradePointValue(symbol: any, trade?: any) {
  const explicit = toFiniteNumber(
    trade?.pointValue ?? trade?.dollarPerPoint ?? trade?.multiplier,
    NaN,
  );

  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const text = String(symbol ?? trade?.symbol ?? "").toUpperCase();

  // MES = $5 per full point, $1.25 per 0.25 tick.
  if (text.includes("MES")) return 5;

  // ES = $50 per full point, $12.50 per 0.25 tick.
  if (text.includes("ES")) return 50;

  return 1;
}

function roundAiTradePointsToTick(points: number, tickSize: number) {
  if (!Number.isFinite(points)) return 0;
  if (!Number.isFinite(tickSize) || tickSize <= 0) return points;

  const sign = points < 0 ? -1 : 1;
  const ticks = Math.round(Math.abs(points) / tickSize);
  return sign * ticks * tickSize;
}

function calculateAiTradeDollarMove({
  symbol,
  side,
  entry,
  price,
  quantity = 1,
  pointValue,
}: {
  symbol: any;
  side: "BUY" | "SELL" | "HOLD";
  entry: number;
  price: number;
  quantity?: number;
  pointValue?: number;
}) {
  if (!Number.isFinite(entry) || !Number.isFinite(price) || entry <= 0 || price <= 0) {
    return { points: 0, ticks: 0, pnl: 0 };
  }

  const tickSize = getAiTradeTickSize(symbol);
  const activePointValue = Math.max(1, toFiniteNumber(pointValue, getAiTradePointValue(symbol)));
  const activeQuantity = Math.max(1, toFiniteNumber(quantity, 1));
  const rawPoints = side === "SELL" ? entry - price : price - entry;
  const points = roundAiTradePointsToTick(rawPoints, tickSize);
  const ticks = tickSize > 0 ? points / tickSize : 0;
  const pnl = points * activePointValue * activeQuantity;

  return {
    points,
    ticks,
    pnl,
  };
}

function calculateLiveTradePnl(trade: any, livePrice: number) {
  const current = getTradeLiveCurrentPrice(trade, livePrice);
  const entry = toFiniteNumber(trade?.entry ?? trade?.entryPrice, 0);
  const side = normalizeTradeSide(
    trade?.side ?? trade?.decision ?? trade?.rawDecision,
  );
  const symbol = trade?.symbol ?? "MES1!";
  const quantity = Math.max(
    1,
    toFiniteNumber(trade?.quantity ?? trade?.qty ?? trade?.contracts, 1),
  );
  const pointValue = getAiTradePointValue(symbol, trade);

  if (entry <= 0 || current <= 0) {
    return {
      current,
      pnl: toFiniteNumber(trade?.currentPnl ?? trade?.pnl, 0),
      pnlPercent: toFiniteNumber(trade?.pnlPercent ?? trade?.percent, 0),
      points: 0,
      ticks: 0,
      targetPnl: toFiniteNumber(trade?.targetPnl ?? trade?.maxPnl ?? trade?.maxPnlDollar, 0),
      riskPnl: toFiniteNumber(trade?.riskPnl, 0),
      rMultiple: toFiniteNumber(trade?.rMultiple ?? trade?.r, 0),
    };
  }

  const liveMove = calculateAiTradeDollarMove({
    symbol,
    side,
    entry,
    price: current,
    quantity,
    pointValue,
  });
  const pnl = liveMove.pnl;
  const pnlPercent = entry > 0 ? liveMove.points / entry : 0;

  const target = toFiniteNumber(trade?.target ?? trade?.targetPrice ?? trade?.takeProfitPrice, 0);
  const stop = toFiniteNumber(trade?.stop ?? trade?.stopPrice, 0);
  const targetMove = calculateAiTradeDollarMove({
    symbol,
    side,
    entry,
    price: target,
    quantity,
    pointValue,
  });
  const stopMove = calculateAiTradeDollarMove({
    symbol,
    side,
    entry,
    price: stop,
    quantity,
    pointValue,
  });
  const riskPoints = stop > 0 ? Math.abs(entry - stop) : 0;
  const rMultiple =
    riskPoints > 0
      ? liveMove.points / riskPoints
      : toFiniteNumber(trade?.rMultiple ?? trade?.r, 0);

  return {
    current,
    pnl,
    pnlPercent,
    points: liveMove.points,
    ticks: liveMove.ticks,
    targetPnl: targetMove.pnl > 0 ? targetMove.pnl : toFiniteNumber(trade?.targetPnl ?? trade?.maxPnl ?? trade?.maxPnlDollar, 0),
    targetTicks: targetMove.ticks,
    targetPoints: targetMove.points,
    riskPnl: stopMove.pnl,
    riskTicks: stopMove.ticks,
    riskPoints: stopMove.points,
    rMultiple,
  };
}

function getTradeKey(trade: any) {
  return String(
    trade?.id ??
      trade?.tradeId ??
      trade?.entryId ??
      [
        trade?.symbol,
        trade?.timeframe,
        trade?.side,
        trade?.entryTime,
        trade?.entry,
        trade?.target,
        trade?.stop,
      ].join("|"),
  );
}

function mergeTrades(existing: any[], incoming: any[]) {
  const map = new Map<string, any>();

  existing.forEach((trade) => {
    if (!trade || typeof trade !== "object") return;
    map.set(getTradeKey(trade), trade);
  });

  incoming.forEach((trade) => {
    if (!trade || typeof trade !== "object") return;
    const key = getTradeKey(trade);
    map.set(key, {
      ...(map.get(key) ?? {}),
      ...trade,
    });
  });

  return Array.from(map.values())
    .sort((left, right) => {
      const leftTime = Date.parse(
        String(
          left.exitTime ??
            left.closedAt ??
            left.updatedAt ??
            left.entryTime ??
            0,
        ),
      );
      const rightTime = Date.parse(
        String(
          right.exitTime ??
            right.closedAt ??
            right.updatedAt ??
            right.entryTime ??
            0,
        ),
      );
      return rightTime - leftTime;
    })
    .slice(0, 500);
}

function isActiveAiOpenTrade(trade: any) {
  if (!trade || typeof trade !== "object") return false;

  const status = String(trade?.status ?? "OPEN").toUpperCase();
  return status.includes("OPEN") && !status.includes("CLOSED");
}

function getActiveOpenTrades(trades: any[]) {
  return (Array.isArray(trades) ? trades : []).filter(isActiveAiOpenTrade);
}

function describeAiOpenTradeForLog(trade: any, livePrice = 0) {
  if (!trade || typeof trade !== "object") return "unknown open trade";

  const live = calculateLiveTradePnl(trade, livePrice);
  const symbolLabel = String(trade?.symbol ?? "UNKNOWN").toUpperCase();
  const timeframeLabel = String(trade?.timeframe ?? "");
  const side = normalizeTradeSide(
    trade?.side ?? trade?.decision ?? trade?.rawDecision,
  );
  const entry = toFiniteNumber(trade?.entry ?? trade?.entryPrice, 0);
  const target = toFiniteNumber(
    trade?.target ?? trade?.targetPrice ?? trade?.takeProfitPrice ?? trade?.tp1,
    0,
  );
  const stop = toFiniteNumber(trade?.stop ?? trade?.stopPrice, 0);
  const key = getTradeKey(trade).slice(0, 72);

  return [
    `${symbolLabel}${timeframeLabel ? ` ${timeframeLabel}` : ""} ${side}`,
    `entry ${formatPrice(entry)}`,
    `target ${formatPrice(target)}`,
    `stop ${formatPrice(stop)}`,
    `live ${formatPrice(live.current)}`,
    `P&L ${formatMoney(live.pnl)}`,
    `key ${key}`,
  ].join(" • ");
}

function keepNewestActiveOpenTrade(trades: any[]) {
  const active = getActiveOpenTrades(trades);

  if (active.length <= 1) return active;

  return [
    active.reduce((newest, trade) => {
      const newestTime =
        Date.parse(
          String(
            newest?.createdAt ?? newest?.entryTime ?? newest?.updatedAt ?? 0,
          ),
        ) || 0;
      const tradeTime =
        Date.parse(
          String(trade?.createdAt ?? trade?.entryTime ?? trade?.updatedAt ?? 0),
        ) || 0;
      return tradeTime >= newestTime ? trade : newest;
    }, active[0]),
  ];
}

function getAiTradeSettlement(
  trade: any,
  livePrice: number,
  decision: AiTraderDecision | null,
  minConfidence: number,
  candles?: any[],
): {
  shouldClose: boolean;
  closePrice: number;
  closeReason?: AiTradeCloseReason;
  closeLabel?: string;
} {
  const hit = getTradeLevelHitPrice({ trade, livePrice, candles });

  if (hit.current <= 0) {
    return {
      shouldClose: false,
      closePrice: hit.current,
    };
  }

  if (hit.targetHit) {
    return {
      shouldClose: true,
      closePrice: hit.price,
      closeReason: "TARGET_HIT",
      closeLabel: "Target hit from shared live price / main chart level",
    };
  }

  if (hit.stopHit) {
    return {
      shouldClose: true,
      closePrice: hit.price,
      closeReason: "STOP_HIT",
      closeLabel: "Stop hit from shared live price / main chart level",
    };
  }

  // No AI reversal auto-close here. Dashboard paper trades now close only when
  // the real shared live price or main-chart candle high/low reaches the stored
  // target/stop. This prevents random instant closes when the AI decision flips.
  return {
    shouldClose: false,
    closePrice: hit.current,
  };
}

function buildClosedTradeFromOpenTrade({
  trade,
  livePrice,
  closePrice,
  closeReason,
  closeLabel,
  candles,
}: {
  trade: any;
  livePrice: number;
  closePrice: number;
  closeReason?: AiTradeCloseReason;
  closeLabel?: string;
  candles?: any[];
}) {
  const live = calculateLiveTradePnl(trade, closePrice || livePrice);
  const closedAt = getLatestCandleTime(candles);
  const result = live.pnl > 0 ? "WIN" : live.pnl < 0 ? "LOSS" : "BREAKEVEN";

  const maxPnl = Math.max(
    toFiniteNumber(trade?.maxPnl ?? trade?.maxPnlDollar, live.targetPnl || live.pnl),
    live.pnl,
  );

  return {
    ...trade,
    id: getTradeKey(trade),
    status: "CLOSED",
    result,
    exit: closePrice || live.current,
    exitPrice: closePrice || live.current,
    exitTime: closedAt,
    closedAt,
    exitReason:
      closeLabel ?? closeReason ?? "Closed from live chart settlement",
    closeReason,
    closeLabel,
    currentPrice: closePrice || live.current,
    pnl: live.pnl,
    pnlDollar: live.pnl,
    currentPnl: live.pnl,
    maxPnl,
    maxPnlDollar: maxPnl,
    targetPnl: live.targetPnl,
    targetPnlDollar: live.targetPnl,
    riskPnl: live.riskPnl,
    liveTicks: live.ticks,
    targetTicks: live.targetTicks,
    pnlPercent: live.pnlPercent,
    percent: live.pnlPercent,
    livePoints: live.points,
    rMultiple: live.rMultiple,
    r: live.rMultiple,
    frontendSaved: true,
  };
}

function buildFrontendOpenTradeFromDecision({
  decision,
  payload,
  livePrice,
  symbol,
  timeframe,
  candles,
}: {
  decision: AiTraderDecision | null;
  payload: any;
  livePrice: number;
  symbol: string;
  timeframe: string;
  candles?: any[];
}) {
  const unifiedPlan = payload?.unifiedTradePlan;
  const side = unifiedPlan?.canTrade
    ? normalizeDecision(unifiedPlan.side)
    : normalizeDecision(decision?.rawDecision ?? decision?.decision ?? payload?.side);

  if (side === "HOLD") return null;

  const current = toFiniteNumber(livePrice, 0);
  const entry = unifiedPlan?.canTrade
    ? toFiniteNumber(unifiedPlan.entry, current)
    : current;
  const target = unifiedPlan?.canTrade
    ? toFiniteNumber(unifiedPlan.target, 0)
    : toFiniteNumber(
        decision?.target ??
          payload?.targetPrice ??
          payload?.target ??
          payload?.takeProfitPrice,
        0,
      );
  const stop = unifiedPlan?.canTrade
    ? toFiniteNumber(unifiedPlan.stop, 0)
    : toFiniteNumber(decision?.stop ?? payload?.stopPrice ?? payload?.stop, 0);

  if (entry <= 0 || target <= 0 || stop <= 0 || current <= 0) return null;

  const targetOnCorrectSide = side === "BUY" ? target > entry : target < entry;
  const stopOnCorrectSide = side === "BUY" ? stop < entry : stop > entry;

  // A dashboard-only paper trade must be filled from the shared live price and
  // must agree with the Unified Intelligence / Ghost target direction.
  if (!targetOnCorrectSide || !stopOnCorrectSide) return null;

  const normalizedSymbol = String(
    symbol ?? payload?.symbol ?? "MES1!",
  ).toUpperCase();
  const normalizedTimeframe = String(timeframe ?? payload?.timeframe ?? "1m");
  const entryTime = String(payload?.entryTime ?? getLatestCandleTime(candles));
  const setupKey = String(
    payload?.setupKey ??
      buildAiTradeSetupKey({
        symbol: normalizedSymbol,
        timeframe: normalizedTimeframe,
        candles,
        side,
        entry,
        target,
        stop,
      }),
  );
  const quantity = Math.max(
    1,
    toFiniteNumber(payload?.quantity ?? payload?.qty ?? 1, 1),
  );
  const pointValue = Math.max(
    1,
    toFiniteNumber(
      payload?.pointValue ?? payload?.dollarPerPoint ?? payload?.multiplier,
      normalizedSymbol.includes("MES") ? 5 : 1,
    ),
  );
  const riskPoints = Math.abs(entry - stop);
  const rewardPoints = Math.abs(target - entry);
  const riskReward =
    riskPoints > 0
      ? Number((rewardPoints / riskPoints).toFixed(2))
      : toFiniteNumber(decision?.riskReward ?? payload?.riskReward, 0);
  const targetMove = calculateAiTradeDollarMove({
    symbol: normalizedSymbol,
    side,
    entry,
    price: target,
    quantity,
    pointValue,
  });
  const stopMove = calculateAiTradeDollarMove({
    symbol: normalizedSymbol,
    side,
    entry,
    price: stop,
    quantity,
    pointValue,
  });

  return {
    id: `AI-${normalizedSymbol}-${normalizedTimeframe}-${side}-${Math.abs(
      setupKey
        .split("")
        .reduce(
          (hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0,
          0,
        ),
    ).toString(16)}`,
    tradeId: setupKey,
    setupKey,
    symbol: normalizedSymbol,
    timeframe: normalizedTimeframe,
    side,
    decision: side,
    rawDecision: side,
    status: "OPEN",
    entry,
    entryPrice: entry,
    target,
    targetPrice: target,
    takeProfitPrice: target,
    stop,
    stopPrice: stop,
    currentPrice: current,
    quantity,
    pointValue,
    dollarPerPoint: pointValue,
    tickSize: getAiTradeTickSize(normalizedSymbol),
    targetPnl: targetMove.pnl,
    targetPnlDollar: targetMove.pnl,
    maxPnl: targetMove.pnl,
    maxPnlDollar: targetMove.pnl,
    riskPnl: stopMove.pnl,
    targetTicks: targetMove.ticks,
    riskTicks: stopMove.ticks,
    riskReward,
    confidence: toFiniteNumber(decision?.confidence ?? payload?.confidence, 0),
    confidenceGrade: decision?.confidenceGrade,
    reason:
      unifiedPlan?.reason ??
      decision?.reason ??
      payload?.signal?.reason ??
      "Dashboard-only paper trade opened at the shared live price using Unified Intelligence / Ghost target logic. It will close only after shared live price/main chart levels hit target or stop.",
    reasons: [
      ...(unifiedPlan?.reason ? [unifiedPlan.reason] : []),
      ...(Array.isArray(decision?.reasons) ? decision.reasons : []),
    ],
    entryTime,
    createdAt: entryTime,
    updatedAt: entryTime,
    frontendOnly: true,
    dashboardOnly: true,
    brokerConnected: false,
    openedBy: "dashboard_local_live_price_fill",
  };
}

function calculateClosedTradeStats(closedTrades: any[]) {
  const closed = closedTrades.filter(
    (trade) => trade && typeof trade === "object",
  );
  const samples = closed.length;
  const wins = closed.filter(
    (trade) => toFiniteNumber(trade.pnl ?? trade.pnlDollar, 0) > 0,
  ).length;
  const losses = closed.filter(
    (trade) => toFiniteNumber(trade.pnl ?? trade.pnlDollar, 0) < 0,
  ).length;
  const grossProfit = closed
    .filter((trade) => toFiniteNumber(trade.pnl ?? trade.pnlDollar, 0) > 0)
    .reduce(
      (sum, trade) => sum + toFiniteNumber(trade.pnl ?? trade.pnlDollar, 0),
      0,
    );
  const grossLoss = Math.abs(
    closed
      .filter((trade) => toFiniteNumber(trade.pnl ?? trade.pnlDollar, 0) < 0)
      .reduce(
        (sum, trade) => sum + toFiniteNumber(trade.pnl ?? trade.pnlDollar, 0),
        0,
      ),
  );
  const avgPnl =
    samples > 0
      ? closed.reduce(
          (sum, trade) => sum + toFiniteNumber(trade.pnl ?? trade.pnlDollar, 0),
          0,
        ) / samples
      : 0;
  const avgR =
    samples > 0
      ? closed.reduce(
          (sum, trade) => sum + toFiniteNumber(trade.rMultiple ?? trade.r, 0),
          0,
        ) / samples
      : 0;

  return {
    samples,
    wins,
    losses,
    winRate: samples > 0 ? wins / samples : 0,
    profitFactor:
      grossLoss > 0
        ? grossProfit / grossLoss
        : grossProfit > 0
          ? grossProfit
          : 0,
    avgPnl,
    avgR,
  };
}

function getBlockerAnalysis(
  decision: AiTraderDecision | null,
  summary: AiTraderSummary | null,
  minConfidence: number,
  minRiskReward: number,
  projectionTargetConfidence = 0,
  projectionGhostConfidence = 0,
) {
  const blockers: Array<{
    label: string;
    detail: string;
    severity: "high" | "medium" | "low";
  }> = [];
  const confidence = toFiniteNumber(decision?.confidence, 0);
  const riskReward = toFiniteNumber(decision?.riskReward, 0);
  const directional = decision?.details?.directionalContext ?? {};
  const memoryStatus =
    summary?.memoryStatus ?? decision?.details?.memoryStatus ?? {};
  const targetConfidence = Math.max(
    toFiniteNumber(directional?.targetConfidence, 0),
    toFiniteNumber(projectionTargetConfidence, 0),
    toFiniteNumber(decision?.details?.projectionEngine?.targetConfidence, 0),
    toFiniteNumber(
      decision?.details?.projectionEngineContext?.targetConfidence,
      0,
    ),
    toFiniteNumber(decision?.details?.targetMl?.targetConfidence, 0),
  );
  const ghostConfidence = Math.max(
    toFiniteNumber(directional?.ghostConfidence, 0),
    toFiniteNumber(projectionGhostConfidence, 0),
    toFiniteNumber(decision?.details?.projectionEngine?.ghostConfidence, 0),
    toFiniteNumber(
      decision?.details?.projectionEngineContext?.ghostConfidence,
      0,
    ),
  );
  const entryConfidence = toFiniteNumber(directional?.entryConfidence, 0);
  const nrtrConflicts = toFiniteNumber(directional?.nrtrConflictCount, 0);
  const nrtrAgreements = toFiniteNumber(directional?.nrtrAgreementCount, 0);

  const learningMode =
    decision?.details?.entryPermission?.learningMode !== false;

  if (confidence < minConfidence) {
    blockers.push({
      label: learningMode
        ? "Confidence learning label"
        : "Confidence below threshold",
      detail: learningMode
        ? `${confidence.toFixed(1)}% saved for learning; it does not block AI Auto Trade entries.`
        : `${confidence.toFixed(1)}% / required ${minConfidence.toFixed(1)}%`,
      severity: learningMode ? "low" : "high",
    });
  }

  if (riskReward > 0 && riskReward < minRiskReward) {
    blockers.push({
      label: learningMode
        ? "Risk/Reward learning label"
        : "Risk/Reward below minimum",
      detail: learningMode
        ? `${riskReward.toFixed(2)}R saved for learning; NRTR/internal exits can still manage the trade.`
        : `${riskReward.toFixed(2)}R / required ${minRiskReward.toFixed(2)}R`,
      severity: learningMode ? "low" : "high",
    });
  }

  if (targetConfidence <= 0) {
    blockers.push({
      label: "Target ML confidence missing",
      detail:
        "Target exists, but confidence is not flowing into the AI context yet.",
      severity: "medium",
    });
  } else if (targetConfidence < 50) {
    blockers.push({
      label: "Target ML is weak",
      detail: `${targetConfidence.toFixed(1)} confidence`,
      severity: "medium",
    });
  }

  if (ghostConfidence > 0 && ghostConfidence < 45) {
    blockers.push({
      label: "Ghost ML is weak",
      detail: `${ghostConfidence.toFixed(1)} confidence`,
      severity: "medium",
    });
  }

  if (entryConfidence > 0 && entryConfidence < 55) {
    blockers.push({
      label: "Entry ML is weak",
      detail: `${entryConfidence.toFixed(1)} confidence`,
      severity: "medium",
    });
  }

  if (nrtrConflicts > 0) {
    blockers.push({
      label: "NRTR conflict",
      detail: `${nrtrConflicts} chart(s) conflict, ${nrtrAgreements} agree`,
      severity: "medium",
    });
  }

  if (toFiniteNumber(summary?.closedCount, 0) < 8) {
    blockers.push({
      label: "Trade memory not mature",
      detail: String(
        memoryStatus?.message ?? "Need more closed dashboard AI trades.",
      ),
      severity: "low",
    });
  }

  if (blockers.length === 0 && decision?.allowedToTrade) {
    blockers.push({
      label: "No active blocker",
      detail: "AI is allowed to open dashboard paper trades.",
      severity: "low",
    });
  }

  if (blockers.length === 0) {
    blockers.push({
      label: "Waiting for clean setup",
      detail:
        "No major blocker found, but AI has not confirmed trade readiness.",
      severity: "low",
    });
  }

  return blockers;
}

function getMlStrengthLabel(value: any) {
  const score = toFiniteNumber(value, 0);

  if (score >= 75) return "Strong";
  if (score >= 55) return "Active";
  if (score > 0) return "Learning";

  return "Waiting";
}

function getMlStrengthTone(value: any): "neutral" | "bull" | "bear" | "warn" {
  const score = toFiniteNumber(value, 0);

  if (score >= 55) return "bull";
  if (score > 0) return "warn";

  return "neutral";
}

function StatBox({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "bull" | "bear" | "warn";
}) {
  const toneClass =
    tone === "bull"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : tone === "bear"
        ? "border-red-400/30 bg-red-400/10 text-red-200"
        : tone === "warn"
          ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
          : "border-dark-600 bg-dark-800/80 text-gray-200";

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-black">{value}</div>
    </div>
  );
}

function MlStatusCard({
  title,
  status,
  confidence,
  detail,
  tone = "neutral",
}: {
  title: string;
  status: string;
  confidence: number;
  detail: string;
  tone?: "neutral" | "bull" | "bear" | "warn";
}) {
  const border =
    tone === "bull"
      ? "border-emerald-400/30 bg-emerald-400/10"
      : tone === "bear"
        ? "border-red-400/30 bg-red-400/10"
        : tone === "warn"
          ? "border-amber-400/30 bg-amber-400/10"
          : "border-dark-700 bg-dark-900/70";

  const text =
    tone === "bull"
      ? "text-emerald-200"
      : tone === "bear"
        ? "text-red-200"
        : tone === "warn"
          ? "text-amber-200"
          : "text-gray-200";

  return (
    <div className={`rounded-xl border p-4 ${border}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-xs font-black uppercase tracking-wide text-gray-400">
          {title}
        </div>
        <span
          className={`rounded-full border border-current/30 px-2 py-1 text-[10px] font-black uppercase tracking-wide ${text}`}
        >
          {status}
        </span>
      </div>
      <div className={`text-2xl font-black ${text}`}>
        {confidence.toFixed(1)}%
      </div>
      <div className="mt-2 text-xs leading-5 text-gray-400">{detail}</div>
    </div>
  );
}

function BlockerBadge({ severity }: { severity: "high" | "medium" | "low" }) {
  const className =
    severity === "high"
      ? "border-red-400/30 bg-red-400/10 text-red-200"
      : severity === "medium"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
        : "border-blue-400/30 bg-blue-400/10 text-blue-200";

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${className}`}
    >
      {severity}
    </span>
  );
}

function normalizeAiDecisionStats(source: any) {
  const samples = Math.max(0, Math.round(toFiniteNumber(source?.samples, 0)));
  const buyBias = Math.max(0, Math.round(toFiniteNumber(source?.buyBias, 0)));
  const sellBias = Math.max(0, Math.round(toFiniteNumber(source?.sellBias, 0)));
  const holdCount = Math.max(
    0,
    Math.round(toFiniteNumber(source?.holdCount, 0)),
  );
  const tradeReadyCount = Math.max(
    0,
    Math.round(toFiniteNumber(source?.tradeReadyCount, 0)),
  );
  const confidenceSum = Math.max(
    0,
    toFiniteNumber(source?.confidenceSum, 0) ||
      samples * toFiniteNumber(source?.avgConfidence, 0),
  );
  const avgConfidence =
    samples > 0
      ? confidenceSum / samples
      : toFiniteNumber(source?.avgConfidence, 0);

  return {
    ...(source && typeof source === "object" ? source : {}),
    samples,
    buyBias,
    sellBias,
    holdCount,
    tradeReadyCount,
    confidenceSum,
    avgConfidence: Number.isFinite(avgConfidence) ? avgConfidence : 0,
    observationKeys: Array.isArray(source?.observationKeys)
      ? source.observationKeys.slice(-1500)
      : [],
    lastUpdatedAt: source?.lastUpdatedAt ?? null,
  };
}

function mergeAiDecisionStats(current: any, incoming: any) {
  const base = normalizeAiDecisionStats(current);
  const next = normalizeAiDecisionStats(incoming);

  if (next.samples <= 0) return base;
  if (base.samples <= 0) return next;

  const samples = Math.max(base.samples, next.samples);
  const avgConfidence = Math.max(
    toFiniteNumber(base.avgConfidence, 0),
    toFiniteNumber(next.avgConfidence, 0),
  );
  const confidenceSum = Math.max(
    toFiniteNumber(base.confidenceSum, 0),
    toFiniteNumber(next.confidenceSum, 0),
    samples * avgConfidence,
  );

  const mergedKeys = Array.from(
    new Set([
      ...(Array.isArray(base.observationKeys) ? base.observationKeys : []),
      ...(Array.isArray(next.observationKeys) ? next.observationKeys : []),
    ]),
  ).slice(-1500);

  return {
    ...base,
    ...next,
    samples,
    buyBias: Math.max(base.buyBias, next.buyBias),
    sellBias: Math.max(base.sellBias, next.sellBias),
    holdCount: Math.max(base.holdCount, next.holdCount),
    tradeReadyCount: Math.max(base.tradeReadyCount, next.tradeReadyCount),
    confidenceSum,
    avgConfidence,
    observationKeys: mergedKeys,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function readAiDecisionStatsFromMemoryStatus(memoryStatus: any) {
  return (
    memoryStatus?.overallDecisionStats ??
    memoryStatus?.bucketDecisionStats ??
    memoryStatus?.decisionStats ??
    {}
  );
}

function getAiDecisionStatsFromDecision(decision: any) {
  return readAiDecisionStatsFromMemoryStatus(decision?.details?.memoryStatus);
}

function getAiDecisionStatsFromSummary(summary: any) {
  return (
    summary?.decisionStats ??
    readAiDecisionStatsFromMemoryStatus(summary?.memoryStatus) ??
    {}
  );
}

function getDecisionObservationKey(
  decision: any,
  symbol: string,
  timeframe: string,
  candles: any[] | undefined,
) {
  const candleTime = getLatestCandleTime(candles);
  const side = normalizeDecision(decision?.rawDecision ?? decision?.decision);
  const entry = toFiniteNumber(decision?.entry, 0).toFixed(4);
  const target = toFiniteNumber(decision?.target, 0).toFixed(4);
  const stop = toFiniteNumber(decision?.stop, 0).toFixed(4);

  return [
    String(symbol ?? "UNKNOWN").toUpperCase(),
    String(timeframe ?? "UNKNOWN"),
    candleTime,
    side,
    entry,
    target,
    stop,
  ].join("|");
}

function addLiveDecisionObservation(
  current: any,
  decision: any,
  symbol: string,
  timeframe: string,
  candles: any[] | undefined,
) {
  if (!decision || typeof decision !== "object")
    return normalizeAiDecisionStats(current);

  const base = normalizeAiDecisionStats(current);
  const key = getDecisionObservationKey(decision, symbol, timeframe, candles);
  const currentKeys = Array.isArray(base.observationKeys)
    ? base.observationKeys
    : [];

  if (currentKeys.includes(key)) {
    return base;
  }

  const side = normalizeDecision(decision?.rawDecision ?? decision?.decision);
  const confidence = toFiniteNumber(decision?.confidence, 0);
  const samples = base.samples + 1;
  const confidenceSum = toFiniteNumber(base.confidenceSum, 0) + confidence;

  return {
    ...base,
    samples,
    buyBias: base.buyBias + (side === "BUY" ? 1 : 0),
    sellBias: base.sellBias + (side === "SELL" ? 1 : 0),
    holdCount: base.holdCount + (side === "HOLD" ? 1 : 0),
    tradeReadyCount: base.tradeReadyCount + (decision?.allowedToTrade ? 1 : 0),
    confidenceSum,
    avgConfidence: samples > 0 ? confidenceSum / samples : 0,
    observationKeys: [...currentKeys, key].slice(-1500),
    lastUpdatedAt: new Date().toISOString(),
  };
}

function buildStableAiDecisionStats(
  persisted: any,
  summary: any,
  decision: any,
) {
  let stable = normalizeAiDecisionStats(persisted);
  stable = mergeAiDecisionStats(stable, getAiDecisionStatsFromSummary(summary));
  stable = mergeAiDecisionStats(
    stable,
    getAiDecisionStatsFromDecision(decision),
  );
  return stable;
}

export default function AiTraderPanel({
  apiBaseUrl,
  symbol,
  timeframe,
  activePrice,
  signal,
  scorecards,
  overlayPayload,
  unifiedIntelligence,
  projectionEngine: directProjectionEngine,
  candles,
  strategyTesterResults,
}: AiTraderPanelProps) {
  const [decision, setDecision] = useState<AiTraderDecision | null>(null);
  const [summary, setSummary] = useState<AiTraderSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState("");
  const [errorText, setErrorText] = useState("");
  const [autoPaperMode, setAutoPaperMode] = useState(false);
  const [minConfidence, setMinConfidence] = useState(62);
  const [minRiskReward, setMinRiskReward] = useState(1.25);
  const [lastAutoOpenKey, setLastAutoOpenKey] = useState("");
  const [localOpenTrades, setLocalOpenTrades] = useState<any[]>([]);
  const [hydratedLocalOpenTrades, setHydratedLocalOpenTrades] = useState(false);
  const [localClosedTrades, setLocalClosedTrades] = useState<any[]>([]);
  const [hydratedLocalClosedTrades, setHydratedLocalClosedTrades] =
    useState(false);
  const [persistentLearningStats, setPersistentLearningStats] = useState<any>(
    () => normalizeAiDecisionStats({}),
  );
  const [hydratedLearningStats, setHydratedLearningStats] = useState(false);
  const [directLivePrice, setDirectLivePrice] = useState(0);
  const [directLivePriceUpdatedAt, setDirectLivePriceUpdatedAt] = useState("");
  const [aiActivityLog, setAiActivityLog] = useState<
    Array<{
      time: string;
      message: string;
      tone: "info" | "success" | "warn" | "error";
    }>
  >([]);

  const decisionRequestInFlightRef = useRef(false);
  const summaryRequestInFlightRef = useRef(false);
  const evaluateRequestInFlightRef = useRef(false);
  const openRequestInFlightRef = useRef(false);
  const activePaperTradeLockRef = useRef(false);
  const closedTradeKeysRef = useRef<Set<string>>(new Set());
  const recentOpenSetupKeysRef = useRef<Map<string, number>>(new Map());
  const lastDecisionRequestAtRef = useRef(0);
  const lastSummaryRequestAtRef = useRef(0);
  const lastEvaluateRequestAtRef = useRef(0);
  const lastOpenRequestAtRef = useRef(0);
  const lastLoggedActionStatusRef = useRef("");

  const pushAiActivityLog = useCallback(
    (message: string, tone: "info" | "success" | "warn" | "error" = "info") => {
      const cleanMessage = String(message ?? "").trim();
      if (!cleanMessage) return;

      setAiActivityLog((current) =>
        [
          {
            time: new Date().toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
              hour12: true,
            }),
            message: cleanMessage,
            tone,
          },
          ...current,
        ].slice(0, 30),
      );
    },
    [],
  );

  useEffect(() => {
    if (!actionStatus) return;
    if (lastLoggedActionStatusRef.current === actionStatus) return;

    lastLoggedActionStatusRef.current = actionStatus;

    const normalized = actionStatus.toLowerCase();
    const tone =
      normalized.includes("failed") ||
      normalized.includes("error") ||
      normalized.includes("timed out")
        ? "error"
        : normalized.includes("blocked") ||
            normalized.includes("waiting") ||
            normalized.includes("cooldown") ||
            normalized.includes("not opened")
          ? "warn"
          : normalized.includes("opened") ||
              normalized.includes("started") ||
              normalized.includes("closed") ||
              normalized.includes("evaluated")
            ? "success"
            : "info";

    pushAiActivityLog(actionStatus, tone);
  }, [actionStatus, pushAiActivityLog]);

  const openStorageKey = useMemo(() => {
    return `marketbos:ai-trader:open:${String(symbol ?? "ALL").toUpperCase()}:${String(timeframe ?? "ALL")}`;
  }, [symbol, timeframe]);

  const closedStorageKey = useMemo(() => {
    return `marketbos:ai-trader:closed:${String(symbol ?? "ALL").toUpperCase()}:${String(timeframe ?? "ALL")}`;
  }, [symbol, timeframe]);

  const learningStorageKey = useMemo(() => {
    return `marketbos:ai-trader:learning:${String(symbol ?? "ALL").toUpperCase()}:${String(timeframe ?? "ALL")}`;
  }, [symbol, timeframe]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(openStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setLocalOpenTrades(Array.isArray(parsed) ? parsed : []);
    } catch {
      setLocalOpenTrades([]);
    } finally {
      setHydratedLocalOpenTrades(true);
    }
  }, [openStorageKey]);

  useEffect(() => {
    if (!hydratedLocalOpenTrades) return;

    try {
      window.localStorage.setItem(
        openStorageKey,
        JSON.stringify(localOpenTrades.slice(0, 100)),
      );
    } catch {
      // Browser storage can fail in private mode; backend/Supabase memory still remains primary.
    }
  }, [openStorageKey, hydratedLocalOpenTrades, localOpenTrades]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(closedStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setLocalClosedTrades(Array.isArray(parsed) ? parsed : []);
    } catch {
      setLocalClosedTrades([]);
    } finally {
      setHydratedLocalClosedTrades(true);
    }
  }, [closedStorageKey]);

  useEffect(() => {
    if (!hydratedLocalClosedTrades) return;

    try {
      window.localStorage.setItem(
        closedStorageKey,
        JSON.stringify(localClosedTrades.slice(0, 500)),
      );
    } catch {
      // Browser storage can fail in private mode; the dashboard should continue.
    }
  }, [closedStorageKey, hydratedLocalClosedTrades, localClosedTrades]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(learningStorageKey);
      const parsed = raw ? JSON.parse(raw) : {};
      setPersistentLearningStats(normalizeAiDecisionStats(parsed));
    } catch {
      setPersistentLearningStats(normalizeAiDecisionStats({}));
    } finally {
      setHydratedLearningStats(true);
    }
  }, [learningStorageKey]);

  useEffect(() => {
    if (!hydratedLearningStats) return;

    try {
      window.localStorage.setItem(
        learningStorageKey,
        JSON.stringify(normalizeAiDecisionStats(persistentLearningStats)),
      );
    } catch {
      // Browser storage can fail in private mode; backend/Supabase memory still remains primary.
    }
  }, [hydratedLearningStats, learningStorageKey, persistentLearningStats]);

  useEffect(() => {
    if (!apiBaseUrl || !symbol) return;

    let cancelled = false;

    async function fetchDirectLivePrice() {
      try {
        const params = new URLSearchParams({
          symbol: String(symbol ?? ""),
          timeframe: String(timeframe ?? "1m"),
        });
        const response = await fetch(
          `${apiBaseUrl}/api/live-price?${params.toString()}`,
          { cache: "no-store" },
        );

        if (!response.ok) return;

        const json = await response.json();
        const price = toFiniteNumber(
          json?.price ?? json?.last ?? json?.currentPrice,
          0,
        );

        if (!cancelled && price > 0) {
          setDirectLivePrice(price);
          setDirectLivePriceUpdatedAt(
            String(
              json?.time ??
                json?.timestamp ??
                json?.createdAt ??
                new Date().toISOString(),
            ),
          );
        }
      } catch {
        // Keep the last known direct live price. The chart activePrice still remains as fallback.
      }
    }

    fetchDirectLivePrice();
    const intervalMs = autoPaperMode ? 5000 : 10000;
    const intervalId = window.setInterval(fetchDirectLivePrice, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [apiBaseUrl, autoPaperMode, symbol, timeframe]);

  const sharedLivePriceFromDashboard = useMemo(() => {
    return toFiniteNumber(activePrice, 0);
  }, [activePrice]);

  const bestLivePriceForTrades = useMemo(() => {
    // Critical: the dashboard shared live price is the source of truth for
    // open paper trades, P&L, target/stop checks, and close logic. The direct
    // /api/live-price poll is only a fallback because it can lag behind or be
    // rejected by the backend while the chart shared price is still updating.
    if (sharedLivePriceFromDashboard > 0) return sharedLivePriceFromDashboard;

    const direct = toFiniteNumber(directLivePrice, 0);
    if (direct > 0) return direct;

    return 0;
  }, [directLivePrice, sharedLivePriceFromDashboard]);

  const livePriceSourceLabel = useMemo(() => {
    if (sharedLivePriceFromDashboard > 0) return "shared_live_price";
    if (toFiniteNumber(directLivePrice, 0) > 0) return "backend_live_price";
    return "chart_candle_fallback";
  }, [directLivePrice, sharedLivePriceFromDashboard]);

  const liveActivePrice = useMemo(() => {
    return getLiveAiCurrentPrice(bestLivePriceForTrades, signal, candles);
  }, [bestLivePriceForTrades, signal, candles]);

  const activeProjectionEngine = useMemo(() => {
    return (
      directProjectionEngine ??
      readProjectionEngine(signal, overlayPayload, unifiedIntelligence)
    );
  }, [directProjectionEngine, signal, overlayPayload, unifiedIntelligence]);

  const projectionSnapshot = useMemo(() => {
    return buildProjectionEngineSnapshot(activeProjectionEngine);
  }, [activeProjectionEngine]);

  const payload = useMemo(() => {
    const targetSnapshot = buildTargetMlSnapshot(
      signal,
      overlayPayload,
      unifiedIntelligence,
    );
    const target = projectionSnapshot.targetPrice ?? targetSnapshot.targetPrice;
    const entry = inferEntryFromSignal(signal, liveActivePrice);
    const unifiedTradePlan = buildUnifiedDashboardTradePlan({
      projectionSnapshot,
      livePrice: liveActivePrice,
      symbol,
      minRiskReward,
      fallbackStop: signal?.stop ?? signal?.stopPrice ?? signal?.nrtrStopPrice ?? undefined,
      fallbackDecision: signal?.signal ?? signal?.type ?? signal?.direction,
    });
    const side = unifiedTradePlan.canTrade
      ? unifiedTradePlan.side
      : readProjectionSide(
          activeProjectionEngine,
          signal?.signal ?? signal?.type ?? signal?.direction,
        );
    const entryTime = getLatestCandleTime(candles);
    const setupKey = buildAiTradeSetupKey({
      symbol,
      timeframe,
      candles,
      side,
      entry: unifiedTradePlan.canTrade ? unifiedTradePlan.entry : entry,
      target: unifiedTradePlan.canTrade ? unifiedTradePlan.target : target,
      stop: unifiedTradePlan.canTrade
        ? unifiedTradePlan.stop
        : signal?.stop ?? signal?.stopPrice ?? signal?.nrtrStopPrice ?? undefined,
    });

    return {
      symbol,
      timeframe,
      setupKey,
      entryTime,
      currentPrice: liveActivePrice,
      entryPrice: unifiedTradePlan.canTrade ? unifiedTradePlan.entry : entry,
      targetPrice: unifiedTradePlan.canTrade ? unifiedTradePlan.target : target,
      stopPrice: unifiedTradePlan.canTrade
        ? unifiedTradePlan.stop
        : signal?.stop ?? signal?.stopPrice ?? signal?.nrtrStopPrice ?? undefined,
      unifiedTradePlan,
      side,
      signal: {
        ...(signal ?? {}),
        projectionEngine: activeProjectionEngine,
        unifiedProjectionEngine: activeProjectionEngine,
        activeTargetPrice: target,
        activeTargetSource: projectionSnapshot.source,
        projectionMode: projectionSnapshot.projectionMode,
        projectionModeLabel: projectionSnapshot.projectionModeLabel,
        aiPermission: projectionSnapshot.aiPermission,
        targetGhostAlignment: projectionSnapshot.alignment,
      },
      scorecards,
      ghostMl: buildGhostMlSnapshot(
        signal,
        overlayPayload,
        unifiedIntelligence,
      ),
      targetMl: {
        ...targetSnapshot,
        targetPrice: target,
        targetConfidence:
          projectionSnapshot.targetConfidence ||
          targetSnapshot.targetConfidence,
        projectionEngine: projectionSnapshot,
      },
      entryMl: buildEntryMlSnapshot(signal),
      nrtrContext:
        scorecards?.nrtrStrategyFeeds ?? scorecards?.nrtrCharts ?? {},
      unifiedIntelligence: {
        ...(unifiedIntelligence ?? {}),
        projectionEngine: activeProjectionEngine,
        unifiedProjectionEngine: activeProjectionEngine,
      },
      projectionEngine: activeProjectionEngine,
      projectionEngineContext: projectionSnapshot,
      strategyTesterResults,
      strategyTesterContext: strategyTesterResults,
      candles: Array.isArray(candles) ? candles.slice(-80) : [],
      context: {
        mode: "dashboard_only_ai_paper_trader",
        dashboardOnly: true,
        noBroker: true,
        projectionEngineMode: projectionSnapshot.projectionMode,
        projectionEngineLabel: projectionSnapshot.projectionModeLabel,
        aiPermission: projectionSnapshot.aiPermission,
        targetGhostConflict: projectionSnapshot.conflict,
        unifiedTradePlanStatus: unifiedTradePlan.canTrade ? "READY" : "WAIT",
        unifiedTradePlanReason: unifiedTradePlan.reason,
        strategyTesterScope: strategyTesterResults?.scope ?? "MAIN_CHART_ONLY",
        strategyTesterMode: strategyTesterResults?.strategyMode,
        strategyTesterBestSettings: strategyTesterResults?.bestSettings,
        strategyTesterBestResult: strategyTesterResults?.bestResult,
      },
      minConfidence,
      minRiskReward,
    };
  }, [
    liveActivePrice,
    signal,
    scorecards,
    overlayPayload,
    unifiedIntelligence,
    symbol,
    timeframe,
    minConfidence,
    minRiskReward,
    activeProjectionEngine,
    projectionSnapshot,
    candles,
    strategyTesterResults,
  ]);

  const safePayload = useMemo(
    () => sanitizeAiTraderPayload(payload),
    [payload],
  );

  const saveOpenTrades = useCallback((incomingTrades: any[]) => {
    if (!Array.isArray(incomingTrades) || incomingTrades.length === 0) return;

    setLocalOpenTrades((current) =>
      keepNewestActiveOpenTrade(mergeTrades(current, incomingTrades)),
    );
  }, []);

  const forgetOpenTrades = useCallback((closedOrRemovedTrades: any[]) => {
    if (
      !Array.isArray(closedOrRemovedTrades) ||
      closedOrRemovedTrades.length === 0
    )
      return;

    const closedKeys = new Set(closedOrRemovedTrades.map(getTradeKey));
    setLocalOpenTrades((current) =>
      current.filter((trade) => !closedKeys.has(getTradeKey(trade))),
    );
  }, []);

  const saveClosedTrades = useCallback(
    (incomingTrades: any[]) => {
      if (!Array.isArray(incomingTrades) || incomingTrades.length === 0) return;

      setLocalClosedTrades((current) => mergeTrades(current, incomingTrades));
      forgetOpenTrades(incomingTrades);
    },
    [forgetOpenTrades],
  );

  const closeTradeOnBackend = useCallback(
    async ({
      trade,
      closePrice,
      closeReason,
      closeLabel,
    }: {
      trade: any;
      closePrice: number;
      closeReason?: AiTradeCloseReason;
      closeLabel?: string;
    }) => {
      if (!apiBaseUrl) {
        throw new Error("AI Trader close failed: apiBaseUrl is missing.");
      }

      const fallbackClosedTrade = buildClosedTradeFromOpenTrade({
        trade,
        livePrice: closePrice,
        closePrice,
        closeReason,
        closeLabel,
        candles,
      });

      const timeout = createRequestTimeout(16000);

      try {
        const response = await fetch(`${apiBaseUrl}/api/ai-trader/close`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tradeId: trade?.id ?? trade?.tradeId ?? getTradeKey(trade),
            symbol: trade?.symbol ?? symbol,
            timeframe: trade?.timeframe ?? timeframe,
            side: trade?.side ?? trade?.decision ?? trade?.rawDecision,
            exitPrice: closePrice,
            currentPrice: closePrice,
            exitReason: closeLabel ?? closeReason ?? "Closed from dashboard shared live price",
            exitTime: getLatestCandleTime(candles),
          }),
          signal: timeout.signal,
        });

        if (!response.ok) {
          throw new Error(`AI trader close failed: ${await readApiError(response)}`);
        }

        const json = await response.json();
        const closedTrade = json?.trade ?? fallbackClosedTrade;

        if (!json?.closed && !json?.trade) {
          throw new Error(String(json?.message ?? "AI trader close did not return a closed trade."));
        }

        saveClosedTrades([closedTrade]);
        forgetOpenTrades([trade]);
        if (json?.summary) setSummary(json.summary);
        activePaperTradeLockRef.current = false;
        openRequestInFlightRef.current = false;

        return {
          closed: true,
          trade: closedTrade,
          summary: json?.summary,
        };
      } finally {
        timeout.clear();
      }
    },
    [
      apiBaseUrl,
      candles,
      forgetOpenTrades,
      saveClosedTrades,
      symbol,
      timeframe,
    ],
  );

  const fetchDecision = useCallback(
    async (force = false) => {
      if (!apiBaseUrl) {
        setErrorText("AI Trader is waiting for apiBaseUrl.");
        return;
      }

      if (!liveActivePrice || liveActivePrice <= 0) {
        setErrorText(
          "AI Trader is waiting for live price. Check mainChartCandles, activePrice, or latest signal price.",
        );
        return;
      }

      const now = Date.now();

      if (decisionRequestInFlightRef.current) {
        if (force) setActionStatus("AI decision request already running...");
        return;
      }

      if (!force && now - lastDecisionRequestAtRef.current < 8000) {
        return;
      }

      decisionRequestInFlightRef.current = true;
      lastDecisionRequestAtRef.current = now;
      const timeout = createRequestTimeout(14000);

      try {
        setIsLoading(true);
        setErrorText("");

        const response = await fetch(`${apiBaseUrl}/api/ai-trader/decision`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(safePayload),
          signal: timeout.signal,
        });

        if (!response.ok) {
          throw new Error(
            `AI trader decision failed: ${await readApiError(response)}`,
          );
        }

        const json = await response.json();
        setDecision(json);
        setPersistentLearningStats((current: any) => {
          const withBackendStats = mergeAiDecisionStats(
            current,
            getAiDecisionStatsFromDecision(json),
          );
          return addLiveDecisionObservation(
            withBackendStats,
            json,
            symbol,
            timeframe,
            candles,
          );
        });
      } catch (error) {
        setErrorText(formatRequestError(error, "AI trader decision failed"));
      } finally {
        timeout.clear();
        decisionRequestInFlightRef.current = false;
        setIsLoading(false);
      }
    },
    [apiBaseUrl, liveActivePrice, safePayload, symbol, timeframe, candles],
  );

  const fetchSummary = useCallback(
    async (force = false) => {
      if (!apiBaseUrl) return;

      const now = Date.now();

      if (summaryRequestInFlightRef.current) return;
      if (!force && now - lastSummaryRequestAtRef.current < 12000) return;

      summaryRequestInFlightRef.current = true;
      lastSummaryRequestAtRef.current = now;
      const timeout = createRequestTimeout(12000);

      try {
        // Closed trade history should be global across all symbols/timeframes.
        // Open-trade locking is already handled by the backend one-trade-at-a-time rule.
        const response = await fetch(`${apiBaseUrl}/api/ai-trader/summary`, {
          cache: "no-store",
          signal: timeout.signal,
        });

        if (!response.ok) return;

        const json = await response.json();
        setSummary(json);
        setPersistentLearningStats((current: any) =>
          mergeAiDecisionStats(current, getAiDecisionStatsFromSummary(json)),
        );

        const backendOpenPayload = [
          ...(Array.isArray(json?.globalOpenTrades)
            ? json.globalOpenTrades
            : []),
          ...(Array.isArray(json?.openTrades) ? json.openTrades : []),
        ];

        // Supabase/backend is the source of truth for live AI trades.
        // Mirror backend rows into local state only for display continuity.
        if (backendOpenPayload.length > 0) {
          saveOpenTrades(backendOpenPayload);
        } else {
          setLocalOpenTrades([]);
        }

        const backendClosedTrades = [
          ...(Array.isArray(json?.closedTrades) ? json.closedTrades : []),
          ...(Array.isArray(json?.recentClosedTrades)
            ? json.recentClosedTrades
            : []),
        ];

        if (backendClosedTrades.length > 0) {
          saveClosedTrades(backendClosedTrades);
        }
      } catch {
        // Keep the panel usable even if summary temporarily fails.
      } finally {
        timeout.clear();
        summaryRequestInFlightRef.current = false;
      }
    },
    [apiBaseUrl, saveClosedTrades, saveOpenTrades],
  );

  const evaluateOpenTrades = useCallback(
    async (force = false) => {
      const now = Date.now();

      if (evaluateRequestInFlightRef.current) return;
      if (!force && now - lastEvaluateRequestAtRef.current < 15000) return;

      evaluateRequestInFlightRef.current = true;
      lastEvaluateRequestAtRef.current = now;

      try {
        const activeTrades = getActiveOpenTrades([
          ...localOpenTrades,
          ...(Array.isArray((summary as any)?.globalOpenTrades)
            ? (summary as any).globalOpenTrades
            : []),
          ...(Array.isArray(summary?.openTrades) ? summary.openTrades : []),
        ]).filter(
          (trade: any) => !closedTradeKeysRef.current.has(getTradeKey(trade)),
        );

        const tradesToClose = activeTrades
          .map((trade: any) => {
            const settlement = getAiTradeSettlement(
              trade,
              liveActivePrice,
              decision,
              minConfidence,
              candles,
            );

            if (!settlement.shouldClose) return null;

            return {
              trade,
              closePrice: settlement.closePrice,
              closeReason: settlement.closeReason,
              closeLabel: settlement.closeLabel,
            };
          })
          .filter(Boolean) as Array<{
            trade: any;
            closePrice: number;
            closeReason?: AiTradeCloseReason;
            closeLabel?: string;
          }>;

        let closedCount = 0;

        for (const item of tradesToClose) {
          await closeTradeOnBackend(item);
          closedCount += 1;
        }

        if (force || closedCount > 0) {
          setActionStatus(
            `Evaluated shared live price/main chart levels • Closed ${closedCount} trade(s) through backend/Supabase`,
          );
        }

        if (closedCount > 0) {
          fetchSummary(true);
        }
      } catch (error) {
        setActionStatus(formatRequestError(error, "Evaluate failed"));
      } finally {
        evaluateRequestInFlightRef.current = false;
      }
    },
    [
      candles,
      closeTradeOnBackend,
      decision,
      fetchSummary,
      liveActivePrice,
      localOpenTrades,
      minConfidence,
      summary,
    ],
  );

  const openDashboardTrade = useCallback(
    async (source: "auto" = "auto") => {
      if (!apiBaseUrl) return;

      const now = Date.now();

      if (openRequestInFlightRef.current) {
        setActionStatus("Open trade request already running...");
        return;
      }

      const openSetupKey = String((safePayload as any)?.setupKey ?? "");

      // Autonomous paper trading should not stay locked out by an old setup key
      // or an old timestamp. The only valid entry blockers are an actual open
      // trade or an in-flight open request. Stale backend/local ghost references
      // are filtered below and should never create an hours-long cooldown.
      pruneRecentSetupKeys(recentOpenSetupKeysRef.current, now, 15_000);

      if (activePaperTradeLockRef.current) {
        const localActiveUnlocked = getActiveOpenTrades(localOpenTrades).filter(
          (trade: any) => !closedTradeKeysRef.current.has(getTradeKey(trade)),
        );
        const backendActiveUnlocked = getActiveOpenTrades([
          ...(Array.isArray((summary as any)?.globalOpenTrades)
            ? (summary as any).globalOpenTrades
            : []),
          ...(Array.isArray(summary?.openTrades) ? summary.openTrades : []),
        ]).filter(
          (trade: any) => !closedTradeKeysRef.current.has(getTradeKey(trade)),
        );

        if (
          localActiveUnlocked.length > 0 ||
          backendActiveUnlocked.length > 0
        ) {
          setActionStatus(
            `Open blocked: internal AI trade lock is active. Debug: activeLocal=${localActiveUnlocked.length}, activeBackend=${backendActiveUnlocked.length}. Run Evaluate Open or wait for the active trade to close.`,
          );
          return;
        }

        activePaperTradeLockRef.current = false;
        setActionStatus(
          "Internal AI trade lock was stale and has been reset. Checking the current setup again...",
        );
      }

      const trustedBackendOpenTrades = getActiveOpenTrades([
        ...(Array.isArray((summary as any)?.globalOpenTrades)
          ? (summary as any).globalOpenTrades
          : []),
        ...(Array.isArray(summary?.openTrades) ? summary.openTrades : []),
      ]).filter(
        (trade: any) => !closedTradeKeysRef.current.has(getTradeKey(trade)),
      );

      if (trustedBackendOpenTrades.length > 0) {
        activePaperTradeLockRef.current = true;
        const blocker =
          trustedBackendOpenTrades[trustedBackendOpenTrades.length - 1];
        const blockerSymbol = String(blocker?.symbol ?? "another symbol");
        const blockerSide = normalizeTradeSide(
          blocker?.side ?? blocker?.decision ?? blocker?.rawDecision,
        );
        setActionStatus(
          `Open blocked: one AI Auto Trade is already active (${blockerSymbol} ${blockerSide}). Learning mode is one trade at a time.`,
        );
        saveOpenTrades(trustedBackendOpenTrades);
        return;
      }

      const visibleLocalOpenTrades = getActiveOpenTrades(
        localOpenTrades,
      ).filter(
        (trade: any) => !closedTradeKeysRef.current.has(getTradeKey(trade)),
      );

      if (visibleLocalOpenTrades.length > 0) {
        activePaperTradeLockRef.current = true;
        const visibleDetails = visibleLocalOpenTrades
          .map((trade: any) =>
            describeAiOpenTradeForLog(trade, liveActivePrice),
          )
          .join(" || ");
        setActionStatus(
          `Open blocked: ${visibleLocalOpenTrades.length} dashboard AI trade is already visible. ${visibleDetails}. Learning mode is one trade at a time.`,
        );
        return;
      }

      // Do not block a valid autonomous entry just because a decision/evaluate
      // refresh is running. Use the latest already-rendered decision/setup.
      // The openRequestInFlightRef above still prevents duplicate submit clicks.
      //
      // IMPORTANT SYNC RULE:
      // Supabase/backend is the official source of truth for live AI trades.
      // Never open the visible trade only in browser state; otherwise another
      // computer will not see it in ai_trader_open_trades.
      activePaperTradeLockRef.current = true;
      openRequestInFlightRef.current = true;
      const timeout = createRequestTimeout(16000);

      try {
        setActionStatus("AI Trader opening dashboard-only trade...");

        const response = await fetch(`${apiBaseUrl}/api/ai-trader/open`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(safePayload),
          signal: timeout.signal,
        });

        if (!response.ok) {
          throw new Error(
            `AI trader open failed: ${await readApiError(response)}`,
          );
        }

        const json = await response.json();
        const nextDecision = json?.decision ?? decision;
        const nextSummary = json?.summary ?? summary;
        setDecision(nextDecision);
        setSummary(nextSummary);
        if (
          Array.isArray(nextSummary?.openTrades) &&
          nextSummary.openTrades.length > 0
        ) {
          saveOpenTrades(nextSummary.openTrades);
        }
        if (json?.trade) {
          saveOpenTrades([json.trade]);
        }
        setPersistentLearningStats((current: any) => {
          const withSummaryStats = mergeAiDecisionStats(
            current,
            getAiDecisionStatsFromSummary(nextSummary),
          );
          const withDecisionStats = mergeAiDecisionStats(
            withSummaryStats,
            getAiDecisionStatsFromDecision(nextDecision),
          );
          return addLiveDecisionObservation(
            withDecisionStats,
            nextDecision,
            symbol,
            timeframe,
            candles,
          );
        });
        const backendMessage = String(json?.message ?? json?.error ?? "");
        const backendBlockedByOpenTrade =
          /already active|already visible|one .*trade|open trade/i.test(
            backendMessage,
          );
        const frontendHasNoRealOpenTrade =
          getActiveOpenTrades(localOpenTrades).filter(
            (trade: any) => !closedTradeKeysRef.current.has(getTradeKey(trade)),
          ).length === 0 && trustedBackendOpenTrades.length === 0;
        const backendOnlyStaleOpenBlock =
          backendBlockedByOpenTrade && frontendHasNoRealOpenTrade;

        if (backendOnlyStaleOpenBlock) {
          activePaperTradeLockRef.current = false;
          if (openSetupKey) {
            recentOpenSetupKeysRef.current.delete(openSetupKey);
          }
          setActionStatus(
            "Backend reported an active AI paper trade, but frontend verified no visible/local/backend active trade. Internal lock reset; next eligible tick may open.",
          );
          return;
        }

        if (!json?.opened && !json?.trade) {
          activePaperTradeLockRef.current = false;
          if (openSetupKey) {
            recentOpenSetupKeysRef.current.delete(openSetupKey);
          }
        } else {
          if (openSetupKey)
            recentOpenSetupKeysRef.current.set(openSetupKey, now);
          lastOpenRequestAtRef.current = now;
        }

        setActionStatus(
          json?.opened
            ? "Dashboard AI trade opened"
            : (json?.message ?? "AI trade not opened"),
        );
      } catch (error) {
        activePaperTradeLockRef.current = false;
        if (openSetupKey) {
          recentOpenSetupKeysRef.current.delete(openSetupKey);
        }
        setActionStatus(formatRequestError(error, "Open failed"));
      } finally {
        timeout.clear();
        openRequestInFlightRef.current = false;
      }
    },
    [
      apiBaseUrl,
      safePayload,
      decision,
      summary,
      symbol,
      timeframe,
      candles,
      localOpenTrades,
      liveActivePrice,
      saveOpenTrades,
    ],
  );

  useEffect(() => {
    fetchDecision(true);
    fetchSummary(true);
  }, [apiBaseUrl, symbol, timeframe]);

  useEffect(() => {
    if (!autoPaperMode) return;

    const unifiedPlan = (safePayload as any)?.unifiedTradePlan;
    const unifiedReady = Boolean(unifiedPlan?.canTrade);
    const backendAllowed = Boolean(decision?.allowedToTrade);

    // Unified Intelligence / Ghost projection is the primary gate. Backend
    // decision is now only a supporting label; it must not reverse or override
    // the dashboard ML target direction.
    if (!unifiedReady && !backendAllowed) return;

    const side = unifiedReady
      ? normalizeDecision(unifiedPlan.side)
      : normalizeDecision(decision?.rawDecision ?? decision?.decision);
    if (side === "HOLD") return;

    const key = buildAiTradeSetupKey({
      symbol,
      timeframe,
      candles,
      side,
      entry: unifiedReady ? unifiedPlan.entry : decision?.entry,
      target: unifiedReady ? unifiedPlan.target : decision?.target,
      stop: unifiedReady ? unifiedPlan.stop : decision?.stop,
    });

    if (key === lastAutoOpenKey) return;

    setLastAutoOpenKey(key);
    openDashboardTrade("auto");
  }, [
    autoPaperMode,
    candles,
    decision,
    lastAutoOpenKey,
    openDashboardTrade,
    safePayload,
    symbol,
    timeframe,
  ]);

  useEffect(() => {
    const id = window.setInterval(() => {
      fetchDecision(false);
      fetchSummary(false);
      evaluateOpenTrades(false);
    }, 20000);

    return () => window.clearInterval(id);
  }, [fetchDecision, fetchSummary, evaluateOpenTrades]);

  const aiDecision = normalizeDecision(decision?.decision);
  const rawDecision = normalizeDecision(decision?.rawDecision);
  const decisionTone =
    aiDecision === "BUY"
      ? "bull"
      : aiDecision === "SELL"
        ? "bear"
        : rawDecision === "BUY" || rawDecision === "SELL"
          ? "warn"
          : "neutral";

  const activeMemoryStatus =
    summary?.memoryStatus ?? decision?.details?.memoryStatus ?? {};

  const activeDecisionStats = useMemo(() => {
    return buildStableAiDecisionStats(
      persistentLearningStats,
      summary,
      decision,
    );
  }, [persistentLearningStats, summary, decision]);

  const backendClosedTrades = useMemo(() => {
    return [
      ...(Array.isArray(summary?.closedTrades)
        ? (summary?.closedTrades ?? [])
        : []),
      ...(Array.isArray(summary?.recentClosedTrades)
        ? (summary?.recentClosedTrades ?? [])
        : []),
    ];
  }, [summary]);

  const closedTrades = useMemo(() => {
    return mergeTrades(localClosedTrades, backendClosedTrades);
  }, [backendClosedTrades, localClosedTrades]);

  const frontendClosedStats = useMemo(() => {
    return calculateClosedTradeStats(closedTrades);
  }, [closedTrades]);

  const activeClosedStats =
    closedTrades.length > 0
      ? frontendClosedStats
      : (activeMemoryStatus?.bucketClosedStats ??
        activeMemoryStatus?.overallClosedStats ??
        summary?.stats ??
        {});

  const stats = activeClosedStats;
  const decisionStats = activeDecisionStats;
  const memoryStatus = activeMemoryStatus;
  const mergedSummaryForStats: AiTraderSummary = {
    ...(summary ?? {}),
    memoryStatus: activeMemoryStatus,
    decisionStats: activeDecisionStats,
    stats: activeClosedStats,
    closedCount: closedTrades.length,
  };

  const blockers = getBlockerAnalysis(
    decision,
    mergedSummaryForStats,
    minConfidence,
    minRiskReward,
    toFiniteNumber(projectionSnapshot.targetConfidence, 0),
    toFiniteNumber(projectionSnapshot.ghostConfidence, 0),
  );

  const directionalContext = decision?.details?.directionalContext ?? {};
  const ghostMlConfidence = Math.max(
    toFiniteNumber(projectionSnapshot.ghostConfidence, 0),
    toFiniteNumber(directionalContext.ghostConfidence, 0),
  );
  const targetMlConfidence = Math.max(
    toFiniteNumber(projectionSnapshot.targetConfidence, 0),
    toFiniteNumber(directionalContext.targetConfidence, 0),
  );
  const entryMlConfidence = toFiniteNumber(
    directionalContext.entryConfidence,
    0,
  );
  const aiConfidence = toFiniteNumber(decision?.confidence, 0);
  const liveTargetConfidence = toFiniteNumber(
    (projectionSnapshot as any).targetLiveConfidence ?? targetMlConfidence,
    targetMlConfidence,
  );
  const lockedTargetConfidence = toFiniteNumber(
    (projectionSnapshot as any).targetLockedConfidence ?? targetMlConfidence,
    targetMlConfidence,
  );
  const targetLearnedReliability = Math.max(
    toFiniteNumber((projectionSnapshot as any).learnedReliability, 0),
    toFiniteNumber((payload as any)?.targetMl?.learnedReliability, 0),
    lockedTargetConfidence,
  );
  const aiSetupConfidence = aiConfidence;
  const rrTargetPlan = decision?.details?.rrTargetPlan ?? {};
  const rrPlanMethod = String(rrTargetPlan?.method ?? "original_target");
  const rrPlanUpgraded = Boolean(rrTargetPlan?.upgraded);
  const rrRequiredTarget = toFiniteNumber(rrTargetPlan?.requiredTarget, 0);
  const originalRiskReward = toFiniteNumber(
    rrTargetPlan?.originalRiskReward,
    decision?.riskReward ?? 0,
  );
  const aiMemorySamples = toFiniteNumber(decisionStats.samples, 0);
  const aiMemoryProgress = Math.min(100, (aiMemorySamples / 400) * 100);
  const aiLearnedReliability = Math.max(
    toFiniteNumber(stats.winRate, 0) * 100,
    aiMemorySamples > 0
      ? Math.min(100, toFiniteNumber(decisionStats.avgConfidence, 0))
      : 0,
  );

  const locallyClosedKeys = useMemo(
    () => new Set(closedTrades.map(getTradeKey)),
    [closedTrades],
  );

  useEffect(() => {
    closedTradeKeysRef.current = locallyClosedKeys;
  }, [locallyClosedKeys]);

  const backendOpenTrades = useMemo(() => {
    return [
      ...(Array.isArray((summary as any)?.globalOpenTrades)
        ? (summary as any).globalOpenTrades
        : []),
      ...(Array.isArray(summary?.openTrades)
        ? (summary?.openTrades ?? [])
        : []),
    ];
  }, [summary]);

  const rawOpenTrades = useMemo(() => {
    const merged = mergeTrades(localOpenTrades, backendOpenTrades).filter(
      (trade: any) => !locallyClosedKeys.has(getTradeKey(trade)),
    );
    return keepNewestActiveOpenTrade(merged);
  }, [localOpenTrades, backendOpenTrades, locallyClosedKeys]);

  const liveOpenTrades = rawOpenTrades
    .filter((trade: any) => !locallyClosedKeys.has(getTradeKey(trade)))
    .map((trade: any) => {
      const settlement = getAiTradeSettlement(
        trade,
        liveActivePrice,
        decision,
        minConfidence,
        candles,
      );
      const live = calculateLiveTradePnl(
        trade,
        settlement.shouldClose ? settlement.closePrice : liveActivePrice,
      );

      const maxPnl =
        Number.isFinite(live.targetPnl) && live.targetPnl > 0
          ? live.targetPnl
          : Math.max(
              toFiniteNumber(trade?.maxPnl ?? trade?.maxPnlDollar, live.pnl),
              live.pnl,
            );

      return {
        ...trade,
        currentPrice: live.current,
        liveCurrentPrice: live.current,
        currentPnl: live.pnl,
        pnl: live.pnl,
        maxPnl,
        maxPnlDollar: maxPnl,
        targetPnl: live.targetPnl,
        targetPnlDollar: live.targetPnl,
        riskPnl: live.riskPnl,
        liveTicks: live.ticks,
        targetTicks: live.targetTicks,
        pnlPercent: live.pnlPercent,
        percent: live.pnlPercent,
        livePoints: live.points,
        rMultiple: live.rMultiple,
        liveUpdatedFromChart: live.current > 0,
        livePriceSource: livePriceSourceLabel,
        livePriceUpdatedAt: directLivePriceUpdatedAt,

        shouldCloseNow: settlement.shouldClose,
        closePrice: settlement.shouldClose
          ? settlement.closePrice
          : trade.closePrice,
        closeReason: settlement.shouldClose
          ? settlement.closeReason
          : trade.closeReason,
        closeLabel: settlement.shouldClose
          ? settlement.closeLabel
          : trade.closeLabel,
      };
    });

  const closeDashboardTradeNow = useCallback(
    async (trade: any) => {
      if (!trade) return;

      const closePrice =
        toFiniteNumber(trade.currentPrice, NaN) > 0
          ? toFiniteNumber(trade.currentPrice, liveActivePrice)
          : toFiniteNumber(liveActivePrice, NaN) > 0
            ? liveActivePrice
            : toFiniteNumber(trade.entry, 0);

      if (!Number.isFinite(closePrice) || closePrice <= 0) {
        setActionStatus("Manual close failed: no valid shared live price is available.");
        return;
      }

      try {
        await closeTradeOnBackend({
          trade,
          closePrice,
          closeReason: "MANUAL_CLOSE",
          closeLabel: "Manually closed with X at shared live price",
        });

        setActionStatus(
          `Manually closed dashboard AI trade at ${formatPrice(closePrice)} through backend/Supabase.`,
        );

        fetchSummary(true);
      } catch (error) {
        setActionStatus(formatRequestError(error, "Manual close failed"));
      }
    },
    [closeTradeOnBackend, fetchSummary, liveActivePrice],
  );

  useEffect(() => {
    const hasActiveOpenTrade = getActiveOpenTrades(liveOpenTrades).length > 0;

    if (hasActiveOpenTrade) {
      activePaperTradeLockRef.current = true;
      return;
    }

    if (!openRequestInFlightRef.current) {
      activePaperTradeLockRef.current = false;
    }
  }, [liveOpenTrades]);

  useEffect(() => {
    setLastAutoOpenKey("");
    recentOpenSetupKeysRef.current.clear();
  }, [symbol, timeframe]);

  const settlementAutoEvaluateKey = liveOpenTrades
    .filter((trade: any) => trade.shouldCloseNow)
    .map(
      (trade: any) =>
        `${getTradeKey(trade)}:${trade.closeReason}:${trade.closePrice}`,
    )
    .join("|");

  useEffect(() => {
    if (!settlementAutoEvaluateKey) return;

    evaluateOpenTrades(true);
  }, [
    settlementAutoEvaluateKey,
    evaluateOpenTrades,
  ]);

  const displayOpenCount = liveOpenTrades.length;
  const liveOpenTradeKeys = useMemo(
    () => new Set(liveOpenTrades.map(getTradeKey)),
    [liveOpenTrades],
  );
  const closedLocalOpenRefs = useMemo(() => {
    return getActiveOpenTrades(localOpenTrades).filter((trade: any) =>
      locallyClosedKeys.has(getTradeKey(trade)),
    );
  }, [localOpenTrades, locallyClosedKeys]);
  const closedBackendOpenRefs = useMemo(() => {
    return getActiveOpenTrades(backendOpenTrades).filter((trade: any) =>
      locallyClosedKeys.has(getTradeKey(trade)),
    );
  }, [backendOpenTrades, locallyClosedKeys]);
  const hiddenLocalOpenTrades = useMemo(() => {
    return getActiveOpenTrades(localOpenTrades)
      .filter((trade: any) => !locallyClosedKeys.has(getTradeKey(trade)))
      .filter((trade: any) => !liveOpenTradeKeys.has(getTradeKey(trade)));
  }, [liveOpenTradeKeys, localOpenTrades, locallyClosedKeys]);
  const hiddenBackendOpenTrades = useMemo(() => {
    return getActiveOpenTrades(backendOpenTrades)
      .filter((trade: any) => !locallyClosedKeys.has(getTradeKey(trade)))
      .filter((trade: any) => !liveOpenTradeKeys.has(getTradeKey(trade)));
  }, [backendOpenTrades, liveOpenTradeKeys, locallyClosedKeys]);
  const staleOpenTradeCount =
    hiddenLocalOpenTrades.length +
    hiddenBackendOpenTrades.length +
    closedLocalOpenRefs.length +
    closedBackendOpenRefs.length;
  const displayClosedCount = closedTrades.length;
  const stableMemoryMessage = `AI memory warming up: ${formatCount(decisionStats.samples)} decision observations, ${formatCount(displayClosedCount)} closed/virtual outcomes`;

  // Header cards must not display simulated P&L when there is no real visible open trade.
  // The decision object can contain a latest setup plan and theoretical P&L fields,
  // but those are not an active trade. Keep setup values separate from open-trade values.
  const activeVisibleOpenTrade = liveOpenTrades[0] ?? null;
  const hasVisibleOpenTrade = Boolean(activeVisibleOpenTrade);
  const headerEntryValue = hasVisibleOpenTrade
    ? (activeVisibleOpenTrade?.entry ?? activeVisibleOpenTrade?.entryPrice)
    : decision?.entry;
  const headerTargetValue = hasVisibleOpenTrade
    ? (activeVisibleOpenTrade?.target ?? activeVisibleOpenTrade?.targetPrice)
    : decision?.target;
  const headerStopValue = hasVisibleOpenTrade
    ? (activeVisibleOpenTrade?.stop ?? activeVisibleOpenTrade?.stopPrice)
    : decision?.stop;
  const headerCurrentPnlValue = hasVisibleOpenTrade
    ? (activeVisibleOpenTrade?.currentPnl ?? activeVisibleOpenTrade?.pnl)
    : null;
  const headerMaxPnlValue = hasVisibleOpenTrade
    ? (activeVisibleOpenTrade?.maxPnl ?? activeVisibleOpenTrade?.maxPnlDollar)
    : null;

  useEffect(() => {
    if (closedLocalOpenRefs.length === 0) return;

    setLocalOpenTrades((current) =>
      current.filter(
        (trade: any) => !locallyClosedKeys.has(getTradeKey(trade)),
      ),
    );

    if (getActiveOpenTrades(liveOpenTrades).length === 0) {
      activePaperTradeLockRef.current = false;
    }
  }, [closedLocalOpenRefs.length, liveOpenTrades, locallyClosedKeys]);

  const clearStaleOpenAiTrades = useCallback(() => {
    const hiddenCount = staleOpenTradeCount;

    setLocalOpenTrades([]);
    setSummary((current: any) => {
      if (!current || typeof current !== "object") return current;

      return {
        ...current,
        openTrades: [],
        globalOpenTrades: [],
        openCount: 0,
      };
    });
    activePaperTradeLockRef.current = false;
    openRequestInFlightRef.current = false;
    recentOpenSetupKeysRef.current.clear();
    setLastAutoOpenKey("");
    setActionStatus(
      hiddenCount > 0
        ? `Cleared ${hiddenCount} stale frontend open AI trade reference(s). Closed history was not deleted.`
        : "Open AI trade references were reset. Closed history was not deleted.",
    );
  }, [staleOpenTradeCount]);

  const dashboardTraderDebugRows = useMemo(() => {
    const rows: Array<{
      time: string;
      level: "info" | "warn" | "error" | "success";
      message: string;
    }> = [];
    const nowText = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    const pushRow = (
      level: "info" | "warn" | "error" | "success",
      stage: string,
      detail: Record<string, any> = {},
      rowTime = nowText,
    ) => {
      const readable = Object.entries(detail)
        .filter(
          ([, value]) => value !== undefined && value !== null && value !== "",
        )
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" • ");

      rows.push({
        time: rowTime,
        level,
        message: readable ? `${stage} • ${readable}` : stage,
      });
    };

    const decisionSide = normalizeDecision(decision?.decision);
    const rawSide = normalizeDecision(decision?.rawDecision);
    const confidence = toFiniteNumber(decision?.confidence, 0);

    pushRow(autoPaperMode ? "success" : "info", "mode", {
      enabled: autoPaperMode,
      symbol,
      timeframe,
      live: formatPrice(liveActivePrice),
      liveSource: livePriceSourceLabel,
      sharedLive: formatPrice(sharedLivePriceFromDashboard),
      backendLive: formatPrice(directLivePrice),
    });

    pushRow(decision?.allowedToTrade ? "success" : "warn", "decision-table", {
      decision: decision?.decision ?? "WAITING",
      rawBias: decision?.rawDecision ?? "—",
      confidence: `${confidence.toFixed(1)}%`,
      grade: decision?.confidenceGrade ?? "—",
      allowed: decision?.allowedToTrade ? "YES" : "NO",
      loading: isLoading,
    });

    pushRow(
      "info",
      hasVisibleOpenTrade ? "open-trade-plan-table" : "latest-setup-plan-table",
      {
        status: hasVisibleOpenTrade ? "OPEN_TRADE" : "LATEST_AI_SETUP_ONLY",
        entry: formatPrice(headerEntryValue),
        target: formatPrice(headerTargetValue),
        stop: formatPrice(headerStopValue),
        rr: toFiniteNumber(decision?.riskReward, 0).toFixed(2),
        note: hasVisibleOpenTrade
          ? "P&L is shown on the open-trade row and header cards."
          : "No open trade exists; these are only the latest AI setup prices.",
      },
    );

    if (!hasVisibleOpenTrade) {
      pushRow("info", "no-open-trade-table", {
        currentPnl: "—",
        maxPnl: "—",
        reason: "P&L is hidden because visibleOpen=0.",
      });
    }

    pushRow(
      projectionSnapshot.conflict
        ? "warn"
        : projectionSnapshot.available
          ? "success"
          : "info",
      "projection-table",
      {
        mode:
          projectionSnapshot.projectionModeLabel ||
          projectionSnapshot.projectionMode,
        permission: projectionSnapshot.aiPermission,
        target: formatPrice(projectionSnapshot.targetPrice),
        targetConfidence: `${toFiniteNumber(projectionSnapshot.targetConfidence, 0).toFixed(1)}%`,
        ghostConfidence: `${toFiniteNumber(projectionSnapshot.ghostConfidence, 0).toFixed(1)}%`,
        conflict: projectionSnapshot.conflict,
      },
    );

    pushRow(displayOpenCount > 0 ? "warn" : "info", "open-trades-table", {
      visibleOpen: displayOpenCount,
      localOpen: getActiveOpenTrades(localOpenTrades).length,
      backendOpen: getActiveOpenTrades(backendOpenTrades).length,
      hiddenLocal: hiddenLocalOpenTrades.length,
      hiddenBackend: hiddenBackendOpenTrades.length,
      closedLocalRefs: closedLocalOpenRefs.length,
      closedBackendRefs: closedBackendOpenRefs.length,
      staleOpenRefs: staleOpenTradeCount,
      closedSaved: displayClosedCount,
    });

    liveOpenTrades.slice(0, 5).forEach((trade: any, index: number) => {
      const side = normalizeTradeSide(
        trade?.side ?? trade?.decision ?? trade?.rawDecision,
      );
      pushRow(
        trade.shouldCloseNow ? "success" : "warn",
        `open-trade-${index + 1}`,
        {
          side,
          entry: formatPrice(trade?.entry ?? trade?.entryPrice),
          target: formatPrice(trade?.target ?? trade?.targetPrice),
          stop: formatPrice(trade?.stop ?? trade?.stopPrice),
          live: formatPrice(trade?.liveCurrentPrice ?? trade?.currentPrice),
          pnl: formatMoney(trade?.pnl ?? trade?.currentPnl),
          maxPnl: formatMoney(trade?.maxPnl ?? trade?.maxPnlDollar),
          shouldClose: trade.shouldCloseNow ? "YES" : "NO",
          closeReason: trade.closeLabel ?? trade.closeReason ?? "",
          key: getTradeKey(trade),
        },
      );
    });

    hiddenLocalOpenTrades.slice(0, 5).forEach((trade: any, index: number) => {
      pushRow("warn", `hidden-local-open-${index + 1}`, {
        source: "browser localStorage",
        detail: describeAiOpenTradeForLog(trade, liveActivePrice),
      });
    });

    hiddenBackendOpenTrades.slice(0, 5).forEach((trade: any, index: number) => {
      pushRow("warn", `hidden-backend-open-${index + 1}`, {
        source: "backend summary",
        detail: describeAiOpenTradeForLog(trade, liveActivePrice),
      });
    });

    closedLocalOpenRefs.slice(0, 5).forEach((trade: any, index: number) => {
      pushRow("warn", `closed-local-open-ref-${index + 1}`, {
        source: "browser localStorage",
        detail: describeAiOpenTradeForLog(trade, liveActivePrice),
        reason:
          "This open reference already exists in closed history and will be ignored for new entries.",
      });
    });

    closedBackendOpenRefs.slice(0, 5).forEach((trade: any, index: number) => {
      pushRow("warn", `closed-backend-open-ref-${index + 1}`, {
        source: "backend summary",
        detail: describeAiOpenTradeForLog(trade, liveActivePrice),
        reason:
          "This backend open reference matches closed history and will be ignored for new entries.",
      });
    });

    if (staleOpenTradeCount > 0 && displayOpenCount === 0) {
      pushRow("warn", "stale-open-cleanup-needed", {
        reason:
          "Open trade references exist, but no active trade is visible in the table. Use Clear Stale Open Trades if these are old ghost references.",
      });
    }

    blockers.slice(0, 6).forEach((blocker, index) => {
      pushRow(
        blocker.severity === "high"
          ? "error"
          : blocker.severity === "medium"
            ? "warn"
            : "info",
        `blocker-${index + 1}`,
        {
          label: blocker.label,
          detail: blocker.detail,
          severity: blocker.severity,
        },
      );
    });

    pushRow("info", "learning-memory-table", {
      decisionSamples: formatCount(decisionStats.samples),
      buyBias: formatCount(decisionStats.buyBias),
      sellBias: formatCount(decisionStats.sellBias),
      holdCount: formatCount(decisionStats.holdCount),
      readyCount: formatCount(decisionStats.tradeReadyCount),
      closed: formatCount(displayClosedCount),
      winRate: formatPercent(stats.winRate ?? 0),
      profitFactor: toFiniteNumber(stats.profitFactor, 0).toFixed(2),
    });

    if (actionStatus) {
      const lower = actionStatus.toLowerCase();
      const latestActionLogItem = aiActivityLog.find(
        (item) => item.message === actionStatus,
      );
      pushRow(
        lower.includes("failed") ||
          lower.includes("error") ||
          lower.includes("timed out")
          ? "error"
          : lower.includes("blocked") ||
              lower.includes("waiting") ||
              lower.includes("cooldown") ||
              lower.includes("not opened")
            ? "warn"
            : lower.includes("opened") ||
                lower.includes("started") ||
                lower.includes("closed") ||
                lower.includes("evaluated")
              ? "success"
              : "info",
        "latest-action",
        { message: actionStatus },
        latestActionLogItem?.time ?? nowText,
      );
    }

    aiActivityLog.slice(0, 12).forEach((item) => {
      // Activity rows are historical events, so their left timestamp must be
      // the original event time, not the current render/snapshot time.
      pushRow(
        item.tone,
        "activity-history",
        {
          message: item.message,
        },
        item.time,
      );
    });

    return rows;
  }, [
    actionStatus,
    aiActivityLog,
    autoPaperMode,
    backendOpenTrades,
    blockers,
    decision,
    decisionStats,
    directLivePrice,
    livePriceSourceLabel,
    sharedLivePriceFromDashboard,
    displayClosedCount,
    displayOpenCount,
    hiddenBackendOpenTrades,
    hiddenLocalOpenTrades,
    closedBackendOpenRefs,
    closedLocalOpenRefs,
    isLoading,
    liveActivePrice,
    liveOpenTrades,
    localOpenTrades,
    projectionSnapshot,
    staleOpenTradeCount,
    stats,
    symbol,
    timeframe,
  ]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mb-6 rounded-2xl border border-purple-400/20 bg-dark-800/90 p-5 shadow-xl"
    >
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black text-white">
              Dashboard AI Self-Learning Trader
            </h2>
            <span className="rounded-full border border-purple-400/30 bg-purple-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-purple-200">
              Dashboard Only
            </span>
            <span className="rounded-full border border-red-400/30 bg-red-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-red-200">
              No Broker
            </span>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-200">
              Closed History Saved
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Dashboard paper/simulated AI trades only. Broker execution is OFF.
            Supabase/backend memory is the source of truth, so the same open
            AI trade can appear on every computer logged into the dashboard.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (autoPaperMode) {
                setAutoPaperMode(false);
                setActionStatus(
                  "AI Trader stopped. No new autonomous trades will open.",
                );
                return;
              }

              const visibleTrades = getActiveOpenTrades(liveOpenTrades);
              const hiddenTrades = [
                ...hiddenLocalOpenTrades,
                ...hiddenBackendOpenTrades,
              ];

              if (visibleTrades.length > 0) {
                const visibleDetails = visibleTrades
                  .map((trade: any) =>
                    describeAiOpenTradeForLog(trade, liveActivePrice),
                  )
                  .join(" || ");
                setActionStatus(
                  `Start blocked: ${visibleTrades.length} AI trade is already visible. ${visibleDetails}. Press Evaluate Open or let the active trade close before starting a new AI trader session.`,
                );
                return;
              }

              if (hiddenTrades.length > 0) {
                setAutoPaperMode(false);
                activePaperTradeLockRef.current = false;
                setActionStatus(
                  `Start blocked: ${hiddenTrades.length} stale hidden open AI trade reference(s) still exist. Review the debug log and press Clear Stale Open Trades if they are old ghost references.`,
                );
                return;
              }

              setLastAutoOpenKey("");
              setAutoPaperMode(true);
              setActionStatus(
                "AI Trader started. Waiting for an eligible autonomous setup.",
              );
            }}
            className={`rounded-lg px-4 py-2 text-xs font-black transition ${
              autoPaperMode
                ? "border border-red-400/40 bg-red-400/10 text-red-200 hover:bg-red-400/20"
                : "border border-emerald-400/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
            }`}
          >
            {autoPaperMode ? "Stop AI Trader" : "Start AI Trader"}
          </button>

          <label className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            Conf Label
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={minConfidence}
              onChange={(event) =>
                setMinConfidence(
                  Math.max(1, Math.min(100, Number(event.target.value) || 62)),
                )
              }
              className="ml-2 w-14 rounded border border-dark-600 bg-dark-800 px-2 py-1 text-xs text-white"
            />
          </label>

          <label className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            Min RR
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.05}
              value={minRiskReward}
              onChange={(event) =>
                setMinRiskReward(
                  Math.max(
                    0.1,
                    Math.min(10, Number(event.target.value) || 1.25),
                  ),
                )
              }
              className="ml-2 w-16 rounded border border-dark-600 bg-dark-800 px-2 py-1 text-xs text-white"
            />
          </label>

          <button
            type="button"
            onClick={() => fetchDecision(true)}
            className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-xs font-bold text-gray-200 hover:border-purple-300"
          >
            Refresh AI
          </button>
          {staleOpenTradeCount > 0 && (
            <button
              type="button"
              onClick={clearStaleOpenAiTrades}
              className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-200 hover:bg-amber-400/20"
            >
              Clear Stale Open Trades
            </button>
          )}

          <button
            type="button"
            onClick={() => evaluateOpenTrades(true)}
            className="rounded-lg border border-blue-400/30 bg-blue-400/10 px-3 py-2 text-xs font-bold text-blue-200 hover:bg-blue-400/20"
          >
            Evaluate Open
          </button>
        </div>
      </div>

      {errorText ? (
        <div className="mb-4 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
          {errorText}
        </div>
      ) : null}

      <details
        className="mb-4 rounded-lg border border-blue-400/20 bg-blue-400/10 px-3 py-2 text-[10px] text-blue-100"
        open
      >
        <summary className="cursor-pointer select-none font-black uppercase tracking-wide text-blue-300">
          Dashboard AI Self-Learning Trader debug log • {symbol} • {timeframe} •
          open {displayOpenCount} • closed {displayClosedCount}
        </summary>
        <div className="mt-2 max-h-56 space-y-1 overflow-auto font-mono leading-4">
          {dashboardTraderDebugRows.map((item, index) => (
            <div
              key={`${item.time}-${item.message}-${index}`}
              className={
                item.level === "error"
                  ? "text-red-300"
                  : item.level === "warn"
                    ? "text-amber-300"
                    : item.level === "success"
                      ? "text-emerald-300"
                      : "text-blue-100"
              }
            >
              <span className="text-gray-500">{item.time}</span> {item.message}
            </div>
          ))}
        </div>
      </details>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatBox
          label="AI Decision"
          value={decision?.decision ?? (isLoading ? "Loading..." : "WAITING")}
          tone={decisionTone as any}
        />
        <StatBox
          label="Raw Bias"
          value={decision?.rawDecision ?? "—"}
          tone={
            rawDecision === "BUY"
              ? "bull"
              : rawDecision === "SELL"
                ? "bear"
                : "neutral"
          }
        />
        <StatBox
          label="Confidence"
          value={`${toFiniteNumber(decision?.confidence, 0).toFixed(1)}% ${decision?.confidenceGrade ?? ""}`}
        />
        <StatBox
          label="AI Trader"
          value={autoPaperMode ? "RUNNING" : "OFF"}
          tone={autoPaperMode ? "bull" : "neutral"}
        />
        <StatBox
          label={hasVisibleOpenTrade ? "Open Entry" : "Setup Entry"}
          value={formatPrice(headerEntryValue)}
        />
        <StatBox
          label={hasVisibleOpenTrade ? "Open Target" : "Setup Target"}
          value={formatPrice(headerTargetValue)}
        />
        <StatBox
          label={hasVisibleOpenTrade ? "Open Stop" : "Setup Stop"}
          value={formatPrice(headerStopValue)}
          tone="warn"
        />
        <StatBox
          label="Current P&L"
          value={
            hasVisibleOpenTrade
              ? formatMoney(headerCurrentPnlValue)
              : "No Open Trade"
          }
          tone={
            hasVisibleOpenTrade
              ? toFiniteNumber(headerCurrentPnlValue, 0) >= 0
                ? "bull"
                : "bear"
              : "neutral"
          }
        />
        <StatBox
          label="Max P&L"
          value={
            hasVisibleOpenTrade
              ? formatMoney(headerMaxPnlValue)
              : "No Open Trade"
          }
          tone={
            hasVisibleOpenTrade
              ? toFiniteNumber(headerMaxPnlValue, 0) >= 0
                ? "bull"
                : "bear"
              : "neutral"
          }
        />
        <StatBox
          label="Projection"
          value={
            projectionSnapshot.projectionModeLabel ||
            projectionSnapshot.projectionMode
          }
          tone={
            projectionSnapshot.conflict
              ? "warn"
              : projectionSnapshot.available
                ? "bull"
                : "neutral"
          }
        />
        <StatBox
          label="AI Permission"
          value={projectionSnapshot.aiPermission}
          tone={
            projectionSnapshot.aiPermission === "CAN_CONSIDER"
              ? "bull"
              : projectionSnapshot.conflict
                ? "warn"
                : "neutral"
          }
        />
      </div>

      <div className="mt-4 rounded-xl border border-dark-700 bg-dark-900/60 p-4">
        <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-black text-white">
              ML System Status
            </div>
            <div className="text-xs text-gray-500">
              Live view of Ghost ML, Target Price ML, and AI Trader learning
              context.
            </div>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
            Background refresh enabled
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatBox
            label="Live Price"
            value={formatPrice(liveActivePrice)}
            tone={liveActivePrice > 0 ? "bull" : "warn"}
          />
          <StatBox
            label="Candles"
            value={formatCount(Array.isArray(candles) ? candles.length : 0)}
            tone={
              Array.isArray(candles) && candles.length > 0 ? "bull" : "warn"
            }
          />
          <StatBox
            label="Payload"
            value={liveActivePrice > 0 ? "READY" : "WAITING"}
            tone={liveActivePrice > 0 ? "bull" : "warn"}
          />
          <StatBox
            label="Decision Route"
            value={apiBaseUrl ? "READY" : "NO API"}
            tone={apiBaseUrl ? "bull" : "warn"}
          />
          <StatBox
            label="Strategy Tester"
            value={
              strategyTesterResults?.bestResult
                ? "BEST FOUND"
                : strategyTesterResults?.currentResult
                  ? "LIVE"
                  : "WAITING"
            }
            tone={
              strategyTesterResults?.bestResult
                ? "bull"
                : strategyTesterResults?.currentResult
                  ? "warn"
                  : "neutral"
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <MlStatusCard
            title="Projection Engine"
            status={
              projectionSnapshot.available
                ? projectionSnapshot.projectionModeLabel
                : "Waiting"
            }
            confidence={toFiniteNumber(projectionSnapshot.alignmentScore, 0)}
            tone={
              projectionSnapshot.conflict
                ? "warn"
                : projectionSnapshot.available
                  ? "bull"
                  : "neutral"
            }
            detail={
              projectionSnapshot.available
                ? `Target ${formatPrice(projectionSnapshot.targetPrice)} • ${projectionSnapshot.aiPermission} • ${projectionSnapshot.alignmentLabel}`
                : "Waiting for Unified Projection Engine target, ghost route, and alignment."
            }
          />

          <MlStatusCard
            title="Ghost ML"
            status={getMlStrengthLabel(ghostMlConfidence)}
            confidence={ghostMlConfidence}
            tone={getMlStrengthTone(ghostMlConfidence)}
            detail={
              ghostMlConfidence > 0
                ? "Ghost ML is contributing to projected candle confidence and AI decision scoring."
                : "Waiting for Ghost ML confidence to flow into the AI context."
            }
          />

          <MlStatusCard
            title="Target Price ML"
            status={
              (projectionSnapshot as any).targetSourceLockActive
                ? "Source Locked"
                : getMlStrengthLabel(targetMlConfidence)
            }
            confidence={targetMlConfidence}
            tone={getMlStrengthTone(targetMlConfidence)}
            detail={
              targetMlConfidence > 0
                ? `Live ${liveTargetConfidence.toFixed(1)}% • locked ${lockedTargetConfidence.toFixed(1)}% • learned ${targetLearnedReliability.toFixed(1)}%`
                : "Waiting for real Target Price ML; using chart ghost overlay only if ML target is unavailable."
            }
          />

          <MlStatusCard
            title="AI Setup Score"
            status={formatAiStage(memoryStatus.stage)}
            confidence={aiSetupConfidence}
            tone={
              decision?.allowedToTrade
                ? "bull"
                : aiSetupConfidence >= minConfidence
                  ? "warn"
                  : "neutral"
            }
            detail={
              decision?.allowedToTrade
                ? "Current setup is trade-ready for dashboard-only paper execution."
                : `Setup score changes every candle. Memory progress ${aiMemoryProgress.toFixed(1)}% from ${formatCount(aiMemorySamples)} observations.`
            }
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatBox
            label="Entry ML"
            value={`${entryMlConfidence.toFixed(1)}%`}
            tone={getMlStrengthTone(entryMlConfidence)}
          />
          <StatBox label="Target" value={formatPrice(decision?.target)} />
          <StatBox
            label="RR"
            value={`${toFiniteNumber(decision?.riskReward, 0).toFixed(2)}R`}
            tone={
              toFiniteNumber(decision?.riskReward, 0) >= minRiskReward
                ? "bull"
                : "warn"
            }
          />
          <StatBox
            label="Original RR"
            value={`${originalRiskReward.toFixed(2)}R`}
            tone={originalRiskReward >= minRiskReward ? "bull" : "warn"}
          />
          <StatBox
            label="RR Plan"
            value={
              rrPlanUpgraded
                ? "UPGRADED"
                : rrPlanMethod.replace(/_/g, " ").toUpperCase()
            }
            tone={
              rrPlanUpgraded
                ? "bull"
                : toFiniteNumber(decision?.riskReward, 0) >= minRiskReward
                  ? "bull"
                  : "warn"
            }
          />
          <StatBox
            label="Required Target"
            value={formatPrice(rrRequiredTarget)}
            tone={rrRequiredTarget > 0 ? "warn" : "neutral"}
          />
          <StatBox
            label="Target Source"
            value={projectionSnapshot.source || "—"}
          />
          <StatBox
            label="Target Live Conf"
            value={`${liveTargetConfidence.toFixed(1)}%`}
            tone={getMlStrengthTone(liveTargetConfidence)}
          />
          <StatBox
            label="Target Locked Conf"
            value={`${lockedTargetConfidence.toFixed(1)}%`}
            tone={
              (projectionSnapshot as any).targetSourceLockActive
                ? "bull"
                : getMlStrengthTone(lockedTargetConfidence)
            }
          />
          <StatBox
            label="Target Learned"
            value={`${targetLearnedReliability.toFixed(1)}%`}
            tone={getMlStrengthTone(targetLearnedReliability)}
          />
          <StatBox
            label="Source Lock"
            value={
              (projectionSnapshot as any).targetSourceLockActive
                ? "ACTIVE"
                : "STANDBY"
            }
            tone={
              (projectionSnapshot as any).targetSourceLockActive
                ? "bull"
                : "neutral"
            }
          />
          <StatBox
            label="Tester Mode"
            value={strategyTesterResults?.strategyMode ?? "—"}
            tone={strategyTesterResults?.currentResult ? "bull" : "neutral"}
          />
          <StatBox
            label="Tester WR"
            value={`${toFiniteNumber(strategyTesterResults?.bestResult?.winRate ?? strategyTesterResults?.currentResult?.winRate, 0).toFixed(1)}%`}
            tone={
              toFiniteNumber(
                strategyTesterResults?.bestResult?.winRate ??
                  strategyTesterResults?.currentResult?.winRate,
                0,
              ) >= 50
                ? "bull"
                : "warn"
            }
          />
          <StatBox
            label="AI Setup Conf"
            value={`${aiSetupConfidence.toFixed(1)}%`}
            tone={
              decision?.allowedToTrade
                ? "bull"
                : aiSetupConfidence >= minConfidence
                  ? "warn"
                  : "neutral"
            }
          />
          <StatBox
            label="AI Memory Progress"
            value={`${aiMemoryProgress.toFixed(1)}%`}
            tone={aiMemorySamples >= 10 ? "bull" : "warn"}
          />
          <StatBox
            label="AI Learned"
            value={`${aiLearnedReliability.toFixed(1)}%`}
            tone={
              aiMemorySamples >= 10 || displayClosedCount > 0
                ? "bull"
                : "neutral"
            }
          />
          <StatBox
            label="Alignment"
            value={`${toFiniteNumber(projectionSnapshot.alignmentScore, 0).toFixed(1)}%`}
            tone={
              projectionSnapshot.conflict
                ? "warn"
                : toFiniteNumber(projectionSnapshot.alignmentScore, 0) >= 60
                  ? "bull"
                  : "neutral"
            }
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-dark-700 bg-dark-900/70 p-4 xl:col-span-2">
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-gray-400">
            AI Reason
          </div>
          <p className="text-sm leading-6 text-gray-200">
            {decision?.reason ??
              "Waiting for enough dashboard data to create a decision."}
          </p>

          {Array.isArray(decision?.reasons) && decision.reasons.length > 0 ? (
            <div className="mt-3 space-y-1">
              {decision.reasons.slice(0, 6).map((reason, index) => (
                <div
                  key={`${reason}-${index}`}
                  className="text-xs text-gray-400"
                >
                  • {reason}
                </div>
              ))}
            </div>
          ) : null}

          {rrTargetPlan?.reason ? (
            <div
              className={`mt-4 rounded-xl border px-3 py-2 text-xs ${rrPlanUpgraded ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`}
            >
              <div className="font-black uppercase tracking-wide">
                RR Builder
              </div>
              <div className="mt-1 leading-5">
                {String(rrTargetPlan.reason)}
                {rrRequiredTarget > 0
                  ? ` Required target: ${formatPrice(rrRequiredTarget)}.`
                  : ""}
              </div>
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-dark-700 bg-dark-800/70 p-3">
            <div className="mb-2 text-xs font-black uppercase tracking-wide text-gray-400">
              Blocker Analysis
            </div>
            <div className="space-y-2">
              {blockers.slice(0, 6).map((blocker) => (
                <div
                  key={`${blocker.label}-${blocker.detail}`}
                  className="flex flex-col gap-1 rounded-lg border border-dark-700 bg-dark-900/70 px-3 py-2 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <div className="text-xs font-black text-white">
                      {blocker.label}
                    </div>
                    <div className="text-xs text-gray-500">
                      {blocker.detail}
                    </div>
                  </div>
                  <BlockerBadge severity={blocker.severity} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-dark-700 bg-dark-900/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs font-black uppercase tracking-wide text-gray-400">
              Learning Memory
            </div>
            <span className="rounded-full border border-purple-400/30 bg-purple-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-purple-200">
              {formatAiStage(memoryStatus.stage)}
            </span>
          </div>

          <div className="mb-3 rounded-lg border border-dark-700 bg-dark-800/70 px-3 py-2 text-xs text-gray-300">
            {stableMemoryMessage}
            {toFiniteNumber(decisionStats.samples, 0) > 0 ? (
              <span className="ml-2 font-black text-emerald-300">
                • {formatCount(decisionStats.samples)} live observations loaded
              </span>
            ) : null}
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <StatBox
              label="Live Observations"
              value={formatCount(decisionStats.samples)}
              tone={
                toFiniteNumber(decisionStats.samples, 0) >= 10 ? "bull" : "warn"
              }
            />
            <StatBox
              label="Memory Source"
              value={
                displayClosedCount > 0
                  ? "CLOSED HISTORY"
                  : toFiniteNumber(persistentLearningStats?.samples, 0) > 0
                    ? "SAVED LIVE MEMORY"
                    : summary?.memoryStatus
                      ? "SUMMARY"
                      : decision?.details?.memoryStatus
                        ? "LIVE DECISION"
                        : "WAITING"
              }
              tone={
                displayClosedCount > 0 ||
                toFiniteNumber(activeDecisionStats?.samples, 0) > 0
                  ? "bull"
                  : "warn"
              }
            />
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <StatBox
              label="Setup Confidence"
              value={`${aiSetupConfidence.toFixed(1)}%`}
              tone={
                decision?.allowedToTrade
                  ? "bull"
                  : aiSetupConfidence >= minConfidence
                    ? "warn"
                    : "neutral"
              }
            />
            <StatBox
              label="Memory Progress"
              value={`${aiMemoryProgress.toFixed(1)}%`}
              tone={aiMemorySamples >= 10 ? "bull" : "warn"}
            />
            <StatBox
              label="Learned Reliability"
              value={`${aiLearnedReliability.toFixed(1)}%`}
              tone={
                aiMemorySamples >= 10 || displayClosedCount > 0
                  ? "bull"
                  : "neutral"
              }
            />
            <StatBox
              label="Target Lock"
              value={
                (projectionSnapshot as any).targetSourceLockActive
                  ? "ACTIVE"
                  : "STANDBY"
              }
              tone={
                (projectionSnapshot as any).targetSourceLockActive
                  ? "bull"
                  : "neutral"
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <StatBox
              label="Decisions"
              value={formatCount(decisionStats.samples)}
            />
            <StatBox
              label="Trade Ready"
              value={formatCount(decisionStats.tradeReadyCount)}
              tone="bull"
            />
            <StatBox
              label="HOLD Count"
              value={formatCount(decisionStats.holdCount)}
              tone="warn"
            />
            <StatBox
              label="Avg AI Conf"
              value={`${toFiniteNumber(decisionStats.avgConfidence, 0).toFixed(1)}%`}
            />
            <StatBox
              label="BUY Bias"
              value={formatCount(decisionStats.buyBias)}
              tone="bull"
            />
            <StatBox
              label="SELL Bias"
              value={formatCount(decisionStats.sellBias)}
              tone="bear"
            />
            <StatBox label="Open" value={String(displayOpenCount)} />
            <StatBox
              label="Closed"
              value={String(displayClosedCount)}
              tone={displayClosedCount > 0 ? "bull" : "neutral"}
            />
            <StatBox
              label="Win Rate"
              value={formatPercent(stats.winRate)}
              tone={toFiniteNumber(stats.winRate, 0) >= 0.5 ? "bull" : "warn"}
            />
            <StatBox
              label="Profit Factor"
              value={toFiniteNumber(stats.profitFactor, 0).toFixed(2)}
            />
            <StatBox
              label="Avg P&L"
              value={formatMoney(stats.avgPnl)}
              tone={toFiniteNumber(stats.avgPnl, 0) >= 0 ? "bull" : "bear"}
            />
            <StatBox
              label="Avg R"
              value={toFiniteNumber(stats.avgR, 0).toFixed(2)}
            />
          </div>
        </div>
      </div>

      {liveOpenTrades.length > 0 ? (
        <div className="mt-4 rounded-xl border border-dark-700 bg-dark-900/70 p-4">
          <div className="mb-1 text-xs font-black uppercase tracking-wide text-gray-400">
            Open Dashboard AI Trades
          </div>
          <div className="mb-3 text-[11px] text-gray-500">
            Open trade current price, P&amp;L, and target/stop settlement are
            checked from the shared live chart price and closed through
            backend/Supabase.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-xs">
              <thead className="text-gray-500">
                <tr>
                  <th className="pb-2">Symbol</th>
                  <th className="pb-2">Side</th>
                  <th className="pb-2">Entry</th>
                  <th className="pb-2">Target</th>
                  <th className="pb-2">Stop</th>
                  <th className="pb-2">Current</th>
                  <th className="pb-2">P&L</th>
                  <th className="pb-2">Max P&L</th>
                  <th className="pb-2">P&L %</th>
                  <th className="pb-2">Live R</th>
                  <th className="pb-2">Confidence</th>
                  <th className="pb-2">Reason</th>
                  <th className="pb-2 text-right">Close</th>
                </tr>
              </thead>
              <tbody>
                {liveOpenTrades.slice(-8).map((trade: any) => (
                  <tr
                    key={getTradeKey(trade)}
                    className={`border-t text-gray-300 ${
                      trade.shouldCloseNow
                        ? "border-amber-400/30 bg-amber-400/5"
                        : "border-dark-700"
                    }`}
                  >
                    <td className="py-2 font-black text-gray-300">
                      {String(trade.symbol ?? symbol ?? "—").toUpperCase()}
                    </td>
                    <td
                      className={`py-2 font-black ${normalizeDecision(trade.side) === "BUY" ? "text-emerald-300" : "text-red-300"}`}
                    >
                      {trade.side}
                    </td>
                    <td className="py-2">
                      <div className="font-semibold text-gray-300">
                        {formatPrice(trade.entry)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {formatTradeDateTime(
                          trade.entryTime ?? trade.createdAt,
                        )}
                      </div>
                    </td>
                    <td className="py-2">{formatPrice(trade.target)}</td>
                    <td className="py-2">{formatPrice(trade.stop)}</td>
                    <td className="py-2">
                      <div className="font-semibold text-gray-300">
                        {formatPrice(trade.currentPrice)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {trade.livePriceSource === "backend_live_price"
                          ? "live feed"
                          : "chart feed"}
                      </div>
                    </td>
                    <td
                      className={`py-2 font-bold ${toFiniteNumber(trade.currentPnl, 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}
                    >
                      {formatMoney(trade.currentPnl)}
                    </td>
                    <td
                      className={`py-2 font-bold ${toFiniteNumber(trade.maxPnl ?? trade.maxPnlDollar, 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}
                    >
                      {formatMoney(trade.maxPnl ?? trade.maxPnlDollar)}
                    </td>
                    <td
                      className={`py-2 font-bold ${toFiniteNumber(trade.pnlPercent, 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}
                    >
                      {formatPercent(trade.pnlPercent)}
                    </td>
                    <td
                      className={`py-2 font-bold ${toFiniteNumber(trade.rMultiple, 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}
                    >
                      {toFiniteNumber(trade.rMultiple, 0).toFixed(2)}R
                    </td>
                    <td className="py-2">
                      {toFiniteNumber(trade.confidence, 0).toFixed(1)}%
                    </td>
                    <td className="max-w-[280px] truncate py-2 text-gray-500">
                      {trade.shouldCloseNow
                        ? `${trade.closeLabel} at ${formatPrice(trade.closePrice)}`
                        : trade.reason}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => closeDashboardTradeNow(trade)}
                        title="Close this dashboard AI trade at the current shared live price"
                        aria-label="Close dashboard AI trade"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-400/40 bg-red-500/10 text-sm font-black text-red-200 hover:bg-red-500 hover:text-white"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {closedTrades.length > 0 ? (
        <div className="mt-4 rounded-xl border border-dark-700 bg-dark-900/70 p-4">
          <div className="mb-1 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-wide text-gray-400">
                Saved Closed AI Trades
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                Shows backend/Supabase closed trades plus local mirrored rows
                for display continuity. Backend is the official saved history.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLocalClosedTrades([])}
              className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-red-200 hover:bg-red-400/20"
            >
              Clear Local History
            </button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1060px] text-left text-xs">
              <thead className="text-gray-500">
                <tr>
                  <th className="pb-2">Result</th>
                  <th className="pb-2">Symbol</th>
                  <th className="pb-2">Side</th>
                  <th className="pb-2">Entry</th>
                  <th className="pb-2">Exit</th>
                  <th className="pb-2">Target</th>
                  <th className="pb-2">Stop</th>
                  <th className="pb-2">P&L</th>
                  <th className="pb-2">P&L %</th>
                  <th className="pb-2">R</th>
                  <th className="pb-2">Confidence</th>
                  <th className="pb-2">Exit Reason</th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.slice(0, 50).map((trade: any) => (
                  <tr
                    key={getTradeKey(trade)}
                    className="border-t border-dark-700 text-gray-300"
                  >
                    <td
                      className={`py-2 font-black ${String(trade.result).toUpperCase() === "WIN" ? "text-emerald-300" : String(trade.result).toUpperCase() === "LOSS" ? "text-red-300" : "text-amber-300"}`}
                    >
                      {trade.result ?? "CLOSED"}
                    </td>
                    <td className="py-2 font-black text-gray-300">
                      {String(trade.symbol ?? "—").toUpperCase()}
                    </td>
                    <td
                      className={`py-2 font-black ${normalizeDecision(trade.side) === "BUY" ? "text-emerald-300" : "text-red-300"}`}
                    >
                      {trade.side}
                    </td>
                    <td className="py-2">
                      <div className="font-semibold text-gray-300">
                        {formatPrice(trade.entry ?? trade.entryPrice)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {formatTradeDateTime(trade.entryTime)}
                      </div>
                    </td>
                    <td className="py-2">
                      <div className="font-semibold text-gray-300">
                        {formatPrice(trade.exit ?? trade.exitPrice)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {formatTradeDateTime(trade.exitTime ?? trade.closedAt)}
                      </div>
                    </td>
                    <td className="py-2">
                      {formatPrice(trade.target ?? trade.targetPrice)}
                    </td>
                    <td className="py-2">
                      {formatPrice(trade.stop ?? trade.stopPrice)}
                    </td>
                    <td
                      className={`py-2 font-bold ${toFiniteNumber(trade.pnl ?? trade.pnlDollar, 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}
                    >
                      {formatMoney(trade.pnl ?? trade.pnlDollar)}
                    </td>
                    <td
                      className={`py-2 font-bold ${toFiniteNumber(trade.pnlPercent ?? trade.percent, 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}
                    >
                      {formatPercent(trade.pnlPercent ?? trade.percent)}
                    </td>
                    <td className="py-2">
                      {toFiniteNumber(trade.rMultiple ?? trade.r, 0).toFixed(2)}
                    </td>
                    <td className="py-2">
                      {toFiniteNumber(trade.confidence, 0).toFixed(1)}%
                    </td>
                    <td className="max-w-[260px] truncate py-2 text-gray-500">
                      {trade.exitReason ??
                        trade.closeLabel ??
                        trade.closeReason ??
                        "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dark-700 bg-dark-900/70 p-4">
          <div className="text-xs font-black uppercase tracking-wide text-gray-400">
            Saved Closed AI Trades
          </div>
          <div className="mt-2 text-xs text-gray-500">
            No closed trades saved yet. The first target, stop, or
            opposite-decision exit will be stored here and counted in Learning
            Memory.
          </div>
        </div>
      )}
    </motion.div>
  );
}
