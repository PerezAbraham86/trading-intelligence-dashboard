"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { DashboardCandle } from "@/components/LightweightCandlestickChart";

export type ChartStrategySettings = {
  smmaLength: number;
  nrtrMode: "ATR-Based" | "Percentage" | "Off";
  nrtrAtrLength: number;
  nrtrAtrMultiplier: number;
  nrtrPercent: number;
  showNrtrExitLabels: boolean;
};

type StrategyMode = "NRTR" | "SMMA";

type StrategyTesterPanelProps = {
  symbol: string;
  timeframe: string;
  mainCandles: DashboardCandle[];
  miniOneCandles: DashboardCandle[];
  miniTwoCandles: DashboardCandle[];
  mainSettings: ChartStrategySettings;
  miniOneSettings: ChartStrategySettings;
  miniTwoSettings: ChartStrategySettings;
  onResultsUpdate?: (results: StrategyTesterResults) => void;
  onApplyMainSettings?: (settings: ChartStrategySettings) => void;
};

type StrategyPoint = {
  time: number;
  value: number | null;
  direction: 1 | -1 | 0;
  buy: boolean;
  sell: boolean;
};

type BacktestTrade = {
  id: number;
  side: "Long" | "Short";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  mfePercent: number;
  maePercent: number;
  barsHeld: number;
  entryReason: string;
  exitReason: string;
  entryConfidence: number;
  confidenceReason: string;
  mlFeatureBucket: string;
  mlBroadBucket: string;
  isLive?: boolean;
};

type BacktestResult = {
  trades: BacktestTrade[];
  liveTrade: BacktestTrade | null;
  equity: Array<{
    time: number;
    value: number;
    tradeId: number;
    pnlPercent: number;
  }>;
  totalPnl: number;
  totalPnlPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  profitFactor: number;
  winRate: number;
  winners: number;
  losers: number;
  totalTrades: number;
};

type OptimizationRow = {
  rank: number;
  score: number;
  strategyMode: StrategyMode;
  settings: ChartStrategySettings;
  label: string;
  detail: string;
  result: BacktestResult;
};

export type StrategyTesterResults = {
  eventType: "STRATEGY_TESTER_RESULTS";
  scope: "MAIN_CHART_ONLY";
  symbol: string;
  timeframe: string;
  strategyMode: StrategyMode;
  currentSettings: ChartStrategySettings;
  currentResult: {
    totalPnl: number;
    totalPnlPercent: number;
    maxDrawdownPercent: number;
    profitFactor: number;
    winRate: number;
    winners: number;
    losers: number;
    totalTrades: number;
    liveTradeConfidence: number;
  };
  bestSettings?: ChartStrategySettings;
  bestResult?: {
    score: number;
    label: string;
    detail: string;
    totalPnl: number;
    totalPnlPercent: number;
    maxDrawdownPercent: number;
    profitFactor: number;
    winRate: number;
    winners: number;
    losers: number;
    totalTrades: number;
  };
  optimizerActive: boolean;
  optimizerRows: number;
  miniChartsRole: "AI_BACKEND_TREND_CONTEXT_ONLY";
  smcGhostRole: "MAIN_CHART_UNIFIED_INTELLIGENCE_AND_BACKGROUND_GHOSTS";
  createdAt: string;
};

type ContractSpec = {
  tickSize: number;
  tickValue: number;
  pointValue: number;
  label: string;
};

function normalizeUnixSeconds(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
}

function candleTimeToNumber(value: DashboardCandle["time"]): number {
  if (typeof value === "number") return normalizeUnixSeconds(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return normalizeUnixSeconds(Number(trimmed));
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
  }
  return Math.floor(Date.UTC(value.year, value.month - 1, value.day) / 1000);
}

function formatDateTime(value: number) {
  const seconds = normalizeUnixSeconds(value);
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatMoney(value: number) {
  if (!Number.isFinite(value)) return "$0.00";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0.00%";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatProfitFactor(value: number) {
  if (!Number.isFinite(value)) return "0.000";
  if (value >= 999) return "∞";
  return value.toFixed(3);
}

function getContractSpec(symbol: string): ContractSpec {
  const normalized = String(symbol ?? "").toUpperCase();

  if (normalized.includes("MES")) {
    return {
      tickSize: 0.25,
      tickValue: 1.25,
      pointValue: 5,
      label: "MES: 0.25 tick = $1.25 / contract",
    };
  }

  if (normalized.includes("ES")) {
    return {
      tickSize: 0.25,
      tickValue: 12.5,
      pointValue: 50,
      label: "ES: 0.25 tick = $12.50 / contract",
    };
  }

  return {
    tickSize: 0.01,
    tickValue: 0.01,
    pointValue: 1,
    label: "Cash/spot estimate: $1 per full point",
  };
}

function pointsToMoney(pricePoints: number, contract: ContractSpec) {
  if (!Number.isFinite(pricePoints)) return 0;
  return pricePoints * contract.pointValue;
}

function toComparableCandles(candles: DashboardCandle[]) {
  return candles
    .map((candle) => ({
      ...candle,
      numericTime: candleTimeToNumber(candle.time),
    }))
    .filter((candle) => candle.numericTime > 0 && Number.isFinite(candle.close))
    .sort((a, b) => a.numericTime - b.numericTime);
}

function calculateAtr(
  candles: ReturnType<typeof toComparableCandles>,
  length: number,
) {
  const safeLength = Math.max(1, Math.floor(length));
  const atrValues: Array<number | null> = Array(candles.length).fill(null);
  if (!candles.length) return atrValues;

  const trueRanges = candles.map((candle, index) => {
    const previousClose = index > 0 ? candles[index - 1].close : candle.close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });

  let seed = 0;
  for (let index = 0; index < trueRanges.length; index += 1) {
    const value = trueRanges[index];
    if (index < safeLength) {
      seed += value;
      if (index === safeLength - 1) atrValues[index] = seed / safeLength;
      continue;
    }

    const previous = atrValues[index - 1];
    atrValues[index] =
      previous === null
        ? null
        : (previous * (safeLength - 1) + value) / safeLength;
  }

  return atrValues;
}

function calculateNrtrAtr(
  candles: ReturnType<typeof toComparableCandles>,
  settings: ChartStrategySettings,
): StrategyPoint[] {
  const result: StrategyPoint[] = [];
  const atrValues = calculateAtr(candles, settings.nrtrAtrLength);
  let finalUpper: number | null = null;
  let finalLower: number | null = null;
  let previousSuperTrend: number | null = null;
  let previousFinalUpper: number | null = null;
  let previousFinalLower: number | null = null;
  let direction: 1 | -1 | 0 = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const previousClose = index > 0 ? candles[index - 1].close : candle.close;
    const atr = atrValues[index];
    const previousDirection = direction;

    if (atr === null || !Number.isFinite(atr)) {
      result.push({
        time: candle.numericTime,
        value: null,
        direction: 0,
        buy: false,
        sell: false,
      });
      continue;
    }

    const multiplier = Math.max(0.01, Number(settings.nrtrAtrMultiplier) || 1);
    const hl2 = (candle.high + candle.low) / 2;
    const basicUpper = hl2 + multiplier * atr;
    const basicLower = hl2 - multiplier * atr;

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
      direction = candle.close > Number(finalUpper) ? 1 : -1;
    } else {
      direction = candle.close < Number(finalLower) ? -1 : 1;
    }

    const superTrend = direction === 1 ? finalLower : finalUpper;
    result.push({
      time: candle.numericTime,
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

function calculateNrtrPercentage(
  candles: ReturnType<typeof toComparableCandles>,
  settings: ChartStrategySettings,
): StrategyPoint[] {
  const result: StrategyPoint[] = [];
  const coefficient =
    Math.max(0.001, Math.min(100, Number(settings.nrtrPercent) || 0.25)) / 100;
  if (!candles.length) return result;

  let trend: 1 | -1 = 1;
  let highestPoint = candles[0].high;
  let lowestPoint = candles[0].low;
  let nrtr = highestPoint * (1 - coefficient);

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
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
      time: candle.numericTime,
      value: Number.isFinite(nrtr) ? nrtr : null,
      direction: trend,
      buy: index > 0 && trend === 1 && previousTrend === -1,
      sell: index > 0 && trend === -1 && previousTrend === 1,
    });
  }

  return result;
}

function calculateNrtr(
  candles: ReturnType<typeof toComparableCandles>,
  settings: ChartStrategySettings,
) {
  if (settings.nrtrMode === "Percentage") {
    return calculateNrtrPercentage(candles, settings);
  }

  return calculateNrtrAtr(candles, settings);
}

function calculateSmma(
  candles: ReturnType<typeof toComparableCandles>,
  settings: ChartStrategySettings,
): StrategyPoint[] {
  const safeLength = Math.max(1, Math.floor(Number(settings.smmaLength) || 20));
  const result: StrategyPoint[] = [];
  let smma: number | null = null;
  let runningSum = 0;
  let previousDirection: 1 | -1 | 0 = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    runningSum += candle.close;

    if (index < safeLength - 1) {
      result.push({
        time: candle.numericTime,
        value: null,
        direction: 0,
        buy: false,
        sell: false,
      });
      continue;
    }

    if (index === safeLength - 1) {
      smma = runningSum / safeLength;
    } else if (smma !== null) {
      smma = (smma * (safeLength - 1) + candle.close) / safeLength;
    }

    const direction: 1 | -1 | 0 =
      smma === null ? 0 : candle.close >= smma ? 1 : -1;

    result.push({
      time: candle.numericTime,
      value: smma,
      direction,
      buy: previousDirection === -1 && direction === 1,
      sell: previousDirection === 1 && direction === -1,
    });

    previousDirection = direction;
  }

  return result;
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function tradeFeatureBucket({
  side,
  strategyMode,
  mainDirection,
  candle,
  previousCandle,
}: {
  side: 1 | -1;
  strategyMode: StrategyMode;
  mainDirection: 1 | -1 | 0;
  candle: ReturnType<typeof toComparableCandles>[number];
  previousCandle?: ReturnType<typeof toComparableCandles>[number];
}) {
  const body = Math.abs(candle.close - candle.open);
  const range = Math.max(candle.high - candle.low, 0.000001);
  const bodyPct = body / range;
  const candleDirection =
    candle.close > candle.open ? 1 : candle.close < candle.open ? -1 : 0;
  const momentumAligned = candleDirection === side;

  const prevMove = previousCandle
    ? (candle.close - previousCandle.close) * side
    : 0;
  const movePct = candle.close ? Math.abs(prevMove / candle.close) * 100 : 0;

  const bodyBucket =
    bodyPct >= 0.7 ? "body_strong" :
    bodyPct >= 0.45 ? "body_medium" :
    bodyPct >= 0.25 ? "body_light" :
    "body_weak";

  const moveBucket =
    movePct >= 0.18 ? "move_large" :
    movePct >= 0.08 ? "move_medium" :
    movePct >= 0.03 ? "move_small" :
    "move_flat";

  return [
    `scope=main_only`,
    `mode=${strategyMode}`,
    `side=${side === 1 ? "long" : "short"}`,
    `main=${mainDirection === side ? 1 : 0}`,
    `momentum=${momentumAligned ? 1 : 0}`,
    bodyBucket,
    moveBucket,
  ].join("|");
}

function broadTradeFeatureBucket({
  side,
  strategyMode,
}: {
  side: 1 | -1;
  strategyMode: StrategyMode;
}) {
  return [
    `scope=main_only`,
    `mode=${strategyMode}`,
    `side=${side === 1 ? "long" : "short"}`,
  ].join("|");
}

function summarizeMlTradeSet(trades: BacktestTrade[]) {
  const closed = trades.filter((trade) => !trade.isLive);

  if (!closed.length) {
    return {
      samples: 0,
      winRate: 0,
      avgPnlPercent: 0,
      profitFactor: 0,
      quality: 0,
    };
  }

  const winners = closed.filter((trade) => trade.pnl > 0);
  const grossProfit = closed
    .filter((trade) => trade.pnl > 0)
    .reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(
    closed
      .filter((trade) => trade.pnl < 0)
      .reduce((sum, trade) => sum + trade.pnl, 0),
  );

  const winRate = (winners.length / closed.length) * 100;
  const avgPnlPercent =
    closed.reduce((sum, trade) => sum + trade.pnlPercent, 0) / closed.length;
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

  const quality = clampConfidence(
    winRate * 0.48 +
    Math.max(0, Math.min(100, (avgPnlPercent + 0.5) * 80)) * 0.27 +
    Math.max(0, Math.min(100, profitFactor / 3 * 100)) * 0.25,
  );

  return {
    samples: closed.length,
    winRate,
    avgPnlPercent,
    profitFactor,
    quality,
  };
}

function confidenceFromMlSummary(summary: ReturnType<typeof summarizeMlTradeSet>, base = 50) {
  if (!summary.samples) return base;

  const sampleWeight = Math.max(0.15, Math.min(1, summary.samples / 20));
  const learned =
    summary.winRate * 0.45 +
    Math.max(0, Math.min(100, (summary.avgPnlPercent + 0.5) * 80)) * 0.25 +
    Math.max(0, Math.min(100, summary.profitFactor / 3 * 100)) * 0.18 +
    summary.quality * 0.12;

  return clampConfidence(base * (1 - sampleWeight) + learned * sampleWeight);
}

function baseEntryMlPrior({
  side,
  mainDirection,
}: {
  side: 1 | -1;
  mainDirection: 1 | -1 | 0;
}) {
  let prior = 44;
  if (mainDirection === side) prior += 12;
  return clampConfidence(prior);
}

function applyEntryMlConfidenceToTrades(trades: BacktestTrade[]) {
  const closedHistory: BacktestTrade[] = [];

  return trades.map((trade) => {
    const exactHistory = closedHistory.filter(
      (item) => item.mlFeatureBucket === trade.mlFeatureBucket,
    );
    const broadHistory = closedHistory.filter(
      (item) => item.mlBroadBucket === trade.mlBroadBucket,
    );

    let summary = summarizeMlTradeSet([]);
    let reason = "Entry ML learning — not enough prior main-chart samples";

    if (exactHistory.length >= 6) {
      summary = summarizeMlTradeSet(exactHistory);
      reason = `Entry ML exact main bucket • ${summary.samples} samples • ${summary.winRate.toFixed(1)}% WR`;
    } else if (broadHistory.length >= 6) {
      summary = summarizeMlTradeSet(broadHistory);
      reason = `Entry ML broad main bucket • ${summary.samples} samples • ${summary.winRate.toFixed(1)}% WR`;
    } else if (closedHistory.length >= 20) {
      summary = summarizeMlTradeSet(closedHistory);
      reason = `Entry ML overall main chart • ${summary.samples} samples • ${summary.winRate.toFixed(1)}% WR`;
    }

    const confidence = confidenceFromMlSummary(summary, trade.entryConfidence || 50);
    const updatedTrade: BacktestTrade = {
      ...trade,
      entryConfidence: Math.round(confidence),
      confidenceReason: reason,
    };

    if (!updatedTrade.isLive) {
      closedHistory.push(updatedTrade);
    }

    return updatedTrade;
  });
}

function calculateSignalEntryConfidence({
  side,
  mainDirection,
  candle,
  previousCandle,
  strategyMode,
}: {
  side: 1 | -1;
  mainDirection: 1 | -1 | 0;
  candle: ReturnType<typeof toComparableCandles>[number];
  previousCandle?: ReturnType<typeof toComparableCandles>[number];
  strategyMode: StrategyMode;
}) {
  const prior = baseEntryMlPrior({ side, mainDirection });

  return {
    confidence: prior,
    reason: "Entry ML prior — main-chart tester only",
    mlFeatureBucket: tradeFeatureBucket({
      side,
      strategyMode,
      mainDirection,
      candle,
      previousCandle,
    }),
    mlBroadBucket: broadTradeFeatureBucket({
      side,
      strategyMode,
    }),
  };
}

function calculateLiveTradeConfidence(trade: BacktestTrade | null) {
  if (!trade) return 0;
  return clampConfidence(trade.entryConfidence);
}

function emptyBacktestResult(): BacktestResult {
  return {
    trades: [],
    liveTrade: null,
    equity: [],
    totalPnl: 0,
    totalPnlPercent: 0,
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
    profitFactor: 0,
    winRate: 0,
    winners: 0,
    losers: 0,
    totalTrades: 0,
  };
}

function calculateBacktest(
  symbol: string,
  mainCandlesInput: DashboardCandle[],
  mainSettings: ChartStrategySettings,
  strategyMode: StrategyMode,
): BacktestResult {
  const mainCandles = toComparableCandles(mainCandlesInput);

  if (mainCandles.length < 30) {
    return emptyBacktestResult();
  }

  const mainPoints =
    strategyMode === "NRTR"
      ? calculateNrtr(mainCandles, mainSettings)
      : calculateSmma(mainCandles, mainSettings);
  const contract = getContractSpec(symbol);

  const trades: BacktestTrade[] = [];
  let openTrade: {
    side: 1 | -1;
    entryIndex: number;
    entryTime: number;
    entryPrice: number;
    reason: string;
    entryConfidence: number;
    confidenceReason: string;
    mlFeatureBucket: string;
    mlBroadBucket: string;
  } | null = null;

  for (let index = 1; index < mainCandles.length; index += 1) {
    const candle = mainCandles[index];
    const point = mainPoints[index];
    if (!point) continue;

    const longSignal = point.buy;
    const shortSignal = point.sell;
    const oppositeLongExit = openTrade?.side === 1 && point.sell;
    const oppositeShortExit = openTrade?.side === -1 && point.buy;

    if (openTrade && (oppositeLongExit || oppositeShortExit)) {
      const exitPrice = candle.close;
      const side = openTrade.side;
      const priceMovePoints = (exitPrice - openTrade.entryPrice) * side;
      const pnl = pointsToMoney(priceMovePoints, contract);
      const pnlPercent = (priceMovePoints / openTrade.entryPrice) * 100;
      const tradeCandles = mainCandles.slice(openTrade.entryIndex, index + 1);
      const mfe =
        side === 1
          ? Math.max(...tradeCandles.map((item) => item.high)) - openTrade.entryPrice
          : openTrade.entryPrice - Math.min(...tradeCandles.map((item) => item.low));
      const mae =
        side === 1
          ? Math.min(...tradeCandles.map((item) => item.low)) - openTrade.entryPrice
          : openTrade.entryPrice - Math.max(...tradeCandles.map((item) => item.high));

      trades.push({
        id: trades.length + 1,
        side: side === 1 ? "Long" : "Short",
        entryTime: openTrade.entryTime,
        exitTime: candle.numericTime,
        entryPrice: openTrade.entryPrice,
        exitPrice,
        pnl,
        pnlPercent,
        mfePercent: (mfe / openTrade.entryPrice) * 100,
        maePercent: (mae / openTrade.entryPrice) * 100,
        barsHeld: index - openTrade.entryIndex,
        entryReason: openTrade.reason,
        exitReason: `${strategyMode} opposite main-chart flip`,
        entryConfidence: openTrade.entryConfidence,
        confidenceReason: openTrade.confidenceReason,
        mlFeatureBucket: openTrade.mlFeatureBucket,
        mlBroadBucket: openTrade.mlBroadBucket,
      });
      openTrade = null;
    }

    if (!openTrade && longSignal) {
      const confidence = calculateSignalEntryConfidence({
        side: 1,
        mainDirection: point.direction,
        candle,
        previousCandle: mainCandles[index - 1],
        strategyMode,
      });

      openTrade = {
        side: 1,
        entryIndex: index,
        entryTime: candle.numericTime,
        entryPrice: candle.close,
        reason: `${strategyMode} long main-chart flip`,
        entryConfidence: confidence.confidence,
        confidenceReason: confidence.reason,
        mlFeatureBucket: confidence.mlFeatureBucket,
        mlBroadBucket: confidence.mlBroadBucket,
      };
    } else if (!openTrade && shortSignal) {
      const confidence = calculateSignalEntryConfidence({
        side: -1,
        mainDirection: point.direction,
        candle,
        previousCandle: mainCandles[index - 1],
        strategyMode,
      });

      openTrade = {
        side: -1,
        entryIndex: index,
        entryTime: candle.numericTime,
        entryPrice: candle.close,
        reason: `${strategyMode} short main-chart flip`,
        entryConfidence: confidence.confidence,
        confidenceReason: confidence.reason,
        mlFeatureBucket: confidence.mlFeatureBucket,
        mlBroadBucket: confidence.mlBroadBucket,
      };
    }
  }

  let liveTrade: BacktestTrade | null = null;

  if (openTrade && mainCandles.length > openTrade.entryIndex + 1) {
    const lastIndex = mainCandles.length - 1;
    const candle = mainCandles[lastIndex];
    const side = openTrade.side;
    const priceMovePoints = (candle.close - openTrade.entryPrice) * side;
    const pnl = pointsToMoney(priceMovePoints, contract);
    const pnlPercent = (priceMovePoints / openTrade.entryPrice) * 100;
    const tradeCandles = mainCandles.slice(openTrade.entryIndex, lastIndex + 1);
    const mfe =
      side === 1
        ? Math.max(...tradeCandles.map((item) => item.high)) - openTrade.entryPrice
        : openTrade.entryPrice - Math.min(...tradeCandles.map((item) => item.low));
    const mae =
      side === 1
        ? Math.min(...tradeCandles.map((item) => item.low)) - openTrade.entryPrice
        : openTrade.entryPrice - Math.max(...tradeCandles.map((item) => item.high));

    liveTrade = {
      id: trades.length + 1,
      side: side === 1 ? "Long" : "Short",
      entryTime: openTrade.entryTime,
      exitTime: candle.numericTime,
      entryPrice: openTrade.entryPrice,
      exitPrice: candle.close,
      pnl,
      pnlPercent,
      mfePercent: (mfe / openTrade.entryPrice) * 100,
      maePercent: (mae / openTrade.entryPrice) * 100,
      barsHeld: lastIndex - openTrade.entryIndex,
      entryReason: openTrade.reason,
      exitReason: "LIVE — waiting for main-chart opposite flip",
      entryConfidence: openTrade.entryConfidence,
      confidenceReason: openTrade.confidenceReason,
      mlFeatureBucket: openTrade.mlFeatureBucket,
      mlBroadBucket: openTrade.mlBroadBucket,
      isLive: true,
    };
  }

  const learnedTrades = applyEntryMlConfidenceToTrades(trades);
  const learnedLiveTrade = liveTrade
    ? applyEntryMlConfidenceToTrades([...trades, liveTrade]).at(-1) ?? liveTrade
    : null;

  let cumulative = 0;
  let peak = 0;
  let maxDrawdownPercent = 0;
  const equity = learnedTrades.map((trade) => {
    cumulative += trade.pnlPercent;
    peak = Math.max(peak, cumulative);
    maxDrawdownPercent = Math.max(maxDrawdownPercent, peak - cumulative);
    return {
      time: trade.exitTime,
      value: cumulative,
      tradeId: trade.id,
      pnlPercent: trade.pnlPercent,
    };
  });

  const winners = learnedTrades.filter((trade) => trade.pnl > 0);
  const losers = learnedTrades.filter((trade) => trade.pnl < 0);
  const grossProfit = winners.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((sum, trade) => sum + trade.pnl, 0));
  const totalPnl = learnedTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const totalPnlPercent = learnedTrades.reduce(
    (sum, trade) => sum + trade.pnlPercent,
    0,
  );

  return {
    trades: learnedTrades,
    liveTrade: learnedLiveTrade,
    equity,
    totalPnl,
    totalPnlPercent,
    maxDrawdown: maxDrawdownPercent,
    maxDrawdownPercent,
    profitFactor:
      grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0,
    winRate: learnedTrades.length ? (winners.length / learnedTrades.length) * 100 : 0,
    winners: winners.length,
    losers: losers.length,
    totalTrades: learnedTrades.length,
  };
}

function optimizerScore(result: BacktestResult) {
  if (result.totalTrades < 4) return -999999;

  const pnlScore = result.totalPnl;
  const winRateScore = result.winRate * 0.85;
  const profitFactorScore = Math.min(result.profitFactor, 5) * 18;
  const drawdownPenalty = result.maxDrawdownPercent * 18;
  const tradeCountBonus = Math.min(result.totalTrades, 60) * 0.35;

  return (
    pnlScore +
    winRateScore +
    profitFactorScore +
    tradeCountBonus -
    drawdownPenalty
  );
}

function buildCandidateSettings(
  base: ChartStrategySettings,
  patch: Partial<ChartStrategySettings>,
): ChartStrategySettings {
  return {
    ...base,
    ...patch,
  };
}

function rankOptimizationRows(rows: OptimizationRow[]) {
  return rows
    .sort((a, b) => b.score - a.score)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function calculateNrtrOptimization(
  symbol: string,
  mainCandles: DashboardCandle[],
  mainSettings: ChartStrategySettings,
) {
  const atrLengths = Array.from({ length: 21 }, (_, index) => index + 1);
  const atrMultipliers = Array.from({ length: 12 }, (_, index) => Number(((index + 1) * 0.25).toFixed(2)));
  const percentages = Array.from({ length: 50 }, (_, index) => Number(((index + 1) * 0.01).toFixed(2)));

  const rows: OptimizationRow[] = [];

  for (const atrLength of atrLengths) {
    for (const atrMultiplier of atrMultipliers) {
      const candidateSettings = buildCandidateSettings(mainSettings, {
        nrtrMode: "ATR-Based",
        nrtrAtrLength: atrLength,
        nrtrAtrMultiplier: atrMultiplier,
      });

      const result = calculateBacktest(
        symbol,
        mainCandles,
        candidateSettings,
        "NRTR",
      );

      rows.push({
        rank: 0,
        score: optimizerScore(result),
        strategyMode: "NRTR",
        settings: candidateSettings,
        label: "ATR-Based",
        detail: `ATR ${atrLength} • x${atrMultiplier.toFixed(2)}`,
        result,
      });
    }
  }

  for (const percent of percentages) {
    const candidateSettings = buildCandidateSettings(mainSettings, {
      nrtrMode: "Percentage",
      nrtrPercent: percent,
    });

    const result = calculateBacktest(
      symbol,
      mainCandles,
      candidateSettings,
      "NRTR",
    );

    rows.push({
      rank: 0,
      score: optimizerScore(result),
      strategyMode: "NRTR",
      settings: candidateSettings,
      label: "Percentage",
      detail: `${percent.toFixed(2)}%`,
      result,
    });
  }

  return rankOptimizationRows(rows);
}

function calculateSmmaOptimization(
  symbol: string,
  mainCandles: DashboardCandle[],
  mainSettings: ChartStrategySettings,
) {
  const lengths = Array.from({ length: 199 }, (_, index) => index + 2);
  const rows: OptimizationRow[] = [];

  for (const smmaLength of lengths) {
    const candidateSettings = buildCandidateSettings(mainSettings, {
      smmaLength,
    });

    const result = calculateBacktest(
      symbol,
      mainCandles,
      candidateSettings,
      "SMMA",
    );

    rows.push({
      rank: 0,
      score: optimizerScore(result),
      strategyMode: "SMMA",
      settings: candidateSettings,
      label: "SMMA",
      detail: `Length ${smmaLength}`,
      result,
    });
  }

  return rankOptimizationRows(rows);
}

function buildStrategyTesterResults({
  symbol,
  timeframe,
  strategyMode,
  currentSettings,
  currentResult,
  optimizerRows,
  optimizerActive,
}: {
  symbol: string;
  timeframe: string;
  strategyMode: StrategyMode;
  currentSettings: ChartStrategySettings;
  currentResult: BacktestResult;
  optimizerRows: OptimizationRow[];
  optimizerActive: boolean;
}): StrategyTesterResults {
  const best = optimizerRows[0];

  return {
    eventType: "STRATEGY_TESTER_RESULTS",
    scope: "MAIN_CHART_ONLY",
    symbol,
    timeframe,
    strategyMode,
    currentSettings,
    currentResult: {
      totalPnl: currentResult.totalPnl,
      totalPnlPercent: currentResult.totalPnlPercent,
      maxDrawdownPercent: currentResult.maxDrawdownPercent,
      profitFactor: currentResult.profitFactor,
      winRate: currentResult.winRate,
      winners: currentResult.winners,
      losers: currentResult.losers,
      totalTrades: currentResult.totalTrades,
      liveTradeConfidence: calculateLiveTradeConfidence(currentResult.liveTrade),
    },
    bestSettings: best?.settings,
    bestResult: best
      ? {
          score: best.score,
          label: best.label,
          detail: best.detail,
          totalPnl: best.result.totalPnl,
          totalPnlPercent: best.result.totalPnlPercent,
          maxDrawdownPercent: best.result.maxDrawdownPercent,
          profitFactor: best.result.profitFactor,
          winRate: best.result.winRate,
          winners: best.result.winners,
          losers: best.result.losers,
          totalTrades: best.result.totalTrades,
        }
      : undefined,
    optimizerActive,
    optimizerRows: optimizerRows.length,
    miniChartsRole: "AI_BACKEND_TREND_CONTEXT_ONLY",
    smcGhostRole: "MAIN_CHART_UNIFIED_INTELLIGENCE_AND_BACKGROUND_GHOSTS",
    createdAt: new Date().toISOString(),
  };
}

function EquityCurve({ equity }: { equity: BacktestResult["equity"] }) {
  if (!equity.length) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-dark-700 bg-dark-900/50 text-sm text-gray-500">
        No main-chart backtest trades yet. Load more candles or switch to a lower timeframe.
      </div>
    );
  }

  const width = 900;
  const height = 260;
  const padding = 24;
  const minValue = Math.min(0, ...equity.map((item) => item.value));
  const maxValue = Math.max(0, ...equity.map((item) => item.value));
  const range = Math.max(0.01, maxValue - minValue);

  const points = equity
    .map((item, index) => {
      const x =
        padding +
        (index / Math.max(1, equity.length - 1)) * (width - padding * 2);
      const y =
        height -
        padding -
        ((item.value - minValue) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const zeroY =
    height - padding - ((0 - minValue) / range) * (height - padding * 2);

  return (
    <div className="rounded-xl border border-dark-700 bg-black/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">Main-chart equity curve</h3>
        <span className="rounded-md border border-dark-600 px-2 py-1 text-[10px] text-gray-400">
          Candle-only preview
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-72 w-full overflow-visible"
      >
        <line
          x1={padding}
          y1={zeroY}
          x2={width - padding}
          y2={zeroY}
          stroke="rgba(148,163,184,0.25)"
          strokeWidth="1"
        />
        <polyline
          fill="none"
          stroke="rgb(45,212,191)"
          strokeWidth="3"
          points={points}
        />
        {equity.map((item, index) => {
          const x =
            padding +
            (index / Math.max(1, equity.length - 1)) * (width - padding * 2);
          const y =
            height -
            padding -
            ((item.value - minValue) / range) * (height - padding * 2);
          return (
            <circle
              key={item.tradeId}
              cx={x}
              cy={y}
              r="4"
              fill="rgb(45,212,191)"
            />
          );
        })}
      </svg>
    </div>
  );
}

function MetricCard({
  label,
  value,
  subValue,
  positive,
}: {
  label: string;
  value: string;
  subValue?: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl border border-dark-700 bg-dark-900/60 p-4 shadow-lg">
      <div className="text-xs font-semibold text-gray-400">{label}</div>
      <div
        className={`mt-2 text-xl font-bold ${positive === false ? "text-red-300" : positive === true ? "text-emerald-300" : "text-gray-100"}`}
      >
        {value}
      </div>
      {subValue && <div className="mt-1 text-xs text-gray-500">{subValue}</div>}
    </div>
  );
}

function OptimizerView({
  rows,
  strategyMode,
  onApplyMainSettings,
}: {
  rows: OptimizationRow[];
  strategyMode: StrategyMode;
  onApplyMainSettings?: (settings: ChartStrategySettings) => void;
}) {
  const best = rows[0];

  if (!rows.length || !best || best.score <= -999000) {
    return (
      <div className="rounded-xl border border-dark-700 bg-black/30 p-8 text-center text-sm text-gray-500">
        Not enough closed main-chart trades to rank {strategyMode} settings yet. Load more candles or use a lower timeframe.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
        <MetricCard
          label="Best setup"
          value={best.label}
          subValue={best.detail}
        />
        <MetricCard
          label="Best P&L"
          value={`${formatMoney(best.result.totalPnl)} / ${formatPercent(best.result.totalPnlPercent)}`}
          positive={best.result.totalPnl >= 0}
        />
        <MetricCard
          label="Best win rate"
          value={`${best.result.winRate.toFixed(2)}%`}
          subValue={`${best.result.winners}/${best.result.totalTrades}`}
          positive={best.result.winRate >= 50}
        />
        <MetricCard
          label="Best profit factor"
          value={formatProfitFactor(best.result.profitFactor)}
          positive={best.result.profitFactor >= 1}
        />
        <MetricCard
          label="Best drawdown"
          value={formatPercent(-best.result.maxDrawdownPercent)}
          subValue="Percent drawdown"
          positive={false}
        />
        <div className="rounded-xl border border-dark-700 bg-dark-900/60 p-4 shadow-lg">
          <div className="text-xs font-semibold text-gray-400">Apply best</div>
          {onApplyMainSettings ? (
            <button
              type="button"
              onClick={() => onApplyMainSettings(best.settings)}
              className="mt-2 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs font-black uppercase tracking-wide text-emerald-300 hover:bg-emerald-400 hover:text-black"
            >
              Apply to main
            </button>
          ) : (
            <div className="mt-2 text-xs text-gray-500">
              Wire onApplyMainSettings from app/page.tsx to enable one-click apply.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-dark-700 bg-black/30 p-4">
        <div className="mb-3 flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-gray-200">
            Main-chart {strategyMode} optimizer
          </h3>
          <p className="text-xs text-gray-500">
            This optimizer scans main-chart settings only. Mini charts remain separate visual/AI-backend trend context and are not used to score this table.
          </p>
          <p className="mt-1 text-xs text-cyan-300">
            {strategyMode === "NRTR"
              ? "302 NRTR combinations • ATR lengths 1-21 • multipliers 0.25-3.00 • percentages 0.01%-0.50%."
              : "199 SMMA combinations • lengths 2-200."}
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-dark-700">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[980px] text-left text-xs">
              <thead className="sticky top-0 bg-dark-900 text-gray-400">
                <tr>
                  <th className="px-3 py-3">Rank</th>
                  <th className="px-3 py-3">Strategy</th>
                  <th className="px-3 py-3">Settings</th>
                  <th className="px-3 py-3 text-right">P&L $</th>
                  <th className="px-3 py-3 text-right">P&L %</th>
                  <th className="px-3 py-3 text-right">Win rate</th>
                  <th className="px-3 py-3 text-right">PF</th>
                  <th className="px-3 py-3 text-right">DD</th>
                  <th className="px-3 py-3 text-right">Trades</th>
                  <th className="px-3 py-3 text-right">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700 bg-dark-800/50 text-gray-300">
                {rows.slice(0, 30).map((row) => (
                  <tr
                    key={`${row.rank}-${row.strategyMode}-${row.label}-${row.detail}`}
                    className={row.rank === 1 ? "bg-emerald-400/5" : undefined}
                  >
                    <td className="px-3 py-3 font-semibold text-cyan-300">
                      #{row.rank}
                    </td>
                    <td className="px-3 py-3 font-semibold">
                      {row.label}
                    </td>
                    <td className="px-3 py-3 text-gray-300">
                      {row.detail}
                    </td>
                    <td
                      className={`px-3 py-3 text-right font-semibold ${row.result.totalPnl >= 0 ? "text-emerald-300" : "text-red-300"}`}
                    >
                      {formatMoney(row.result.totalPnl)}
                    </td>
                    <td
                      className={`px-3 py-3 text-right ${row.result.totalPnlPercent >= 0 ? "text-emerald-300" : "text-red-300"}`}
                    >
                      {formatPercent(row.result.totalPnlPercent)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {row.result.winRate.toFixed(2)}%
                    </td>
                    <td className="px-3 py-3 text-right">
                      {formatProfitFactor(row.result.profitFactor)}
                    </td>
                    <td className="px-3 py-3 text-right text-red-300">
                      {formatPercent(-row.result.maxDrawdownPercent)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {row.result.totalTrades}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {row.score.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StrategyTesterPanel({
  symbol,
  timeframe,
  mainCandles,
  miniOneCandles,
  miniTwoCandles,
  mainSettings,
  miniOneSettings,
  miniTwoSettings,
  onResultsUpdate,
  onApplyMainSettings,
}: StrategyTesterPanelProps) {
  const [strategyMode, setStrategyMode] = useState<StrategyMode>("NRTR");
  const [showOptimizer, setShowOptimizer] = useState(false);

  const result = useMemo(
    () =>
      calculateBacktest(
        symbol,
        mainCandles,
        mainSettings,
        strategyMode,
      ),
    [mainCandles, mainSettings, strategyMode, symbol],
  );

  const optimizerRows = useMemo(() => {
    if (!showOptimizer) return [];

    if (strategyMode === "NRTR") {
      return calculateNrtrOptimization(symbol, mainCandles, mainSettings);
    }

    return calculateSmmaOptimization(symbol, mainCandles, mainSettings);
  }, [mainCandles, mainSettings, showOptimizer, strategyMode, symbol]);

  const testerResults = useMemo(
    () =>
      buildStrategyTesterResults({
        symbol,
        timeframe,
        strategyMode,
        currentSettings: mainSettings,
        currentResult: result,
        optimizerRows,
        optimizerActive: showOptimizer,
      }),
    [mainSettings, optimizerRows, result, showOptimizer, strategyMode, symbol, timeframe],
  );

  useEffect(() => {
    onResultsUpdate?.(testerResults);
  }, [onResultsUpdate, testerResults]);

  const contractSpec = getContractSpec(symbol);
  const miniOneLoaded = Array.isArray(miniOneCandles) && miniOneCandles.length > 0;
  const miniTwoLoaded = Array.isArray(miniTwoCandles) && miniTwoCandles.length > 0;
  const miniSettingsSummary = `${miniOneLoaded ? miniOneCandles.length : 0} / ${miniTwoLoaded ? miniTwoCandles.length : 0} candles`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mt-6 rounded-2xl border border-dark-700 bg-dark-800/80 p-5 shadow-xl"
    >
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-bold text-white">Strategy Tester</h2>
            <span className="rounded-lg border border-dark-600 bg-dark-900 px-2 py-1 text-xs text-gray-400">
              {symbol} • {timeframe} main chart only
            </span>
            <span className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-300">
              Mini charts: AI context only
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Candle-only tester for main-chart NRTR or SMMA settings. Mini charts are not used for this tester score; they stay visual and AI-backend timeframe context. SMC, Liquidity, Ghost, External Data, and ML are excluded from the tester. {contractSpec.label}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={strategyMode}
            onChange={(event) => {
              setStrategyMode(event.target.value as StrategyMode);
              setShowOptimizer(false);
            }}
            className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-amber-400"
          >
            <option value="NRTR">NRTR flip</option>
            <option value="SMMA">SMMA cross</option>
          </select>
          <span className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-dark-900">
            {showOptimizer ? "Optimizer" : "Metrics"}
          </span>
          <button
            type="button"
            onClick={() => setShowOptimizer((value) => !value)}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
              showOptimizer
                ? "border-cyan-300/60 bg-cyan-400/20 text-cyan-100"
                : "border-cyan-400/30 bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/20"
            }`}
          >
            {showOptimizer ? "Show Metrics + Trades" : `Run ${strategyMode} Optimizer`}
          </button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-4">
        <MetricCard
          label="Tester scope"
          value="Main only"
          subValue="NRTR / SMMA settings"
        />
        <MetricCard
          label="Mini chart role"
          value="AI context"
          subValue={`Loaded: ${miniSettingsSummary}`}
        />
        <MetricCard
          label="Mini settings"
          value={`SMMA ${miniOneSettings.smmaLength}/${miniTwoSettings.smmaLength}`}
          subValue="Not scored here"
        />
        <MetricCard
          label="Unified intelligence"
          value="Main chart"
          subValue="SMC + AlphaX + DLM + Ghost remains outside this tester"
        />
      </div>

      {showOptimizer ? (
        <OptimizerView
          rows={optimizerRows}
          strategyMode={strategyMode}
          onApplyMainSettings={onApplyMainSettings}
        />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
            <MetricCard
              label="Total P&L"
              value={`${formatMoney(result.totalPnl)} / ${formatPercent(result.totalPnlPercent)}`}
              positive={result.totalPnl >= 0}
            />
            <MetricCard
              label="Max equity drawdown"
              value={formatPercent(-result.maxDrawdownPercent)}
              subValue="Percent drawdown"
              positive={false}
            />
            <MetricCard
              label="Closed trades"
              value={String(result.totalTrades)}
              subValue={result.liveTrade ? "1 live trade waiting to exit" : "No live trade"}
            />
            <MetricCard
              label="Profitable trades"
              value={`${result.winRate.toFixed(2)}%`}
              subValue={`${result.winners}/${result.totalTrades}`}
              positive={result.winRate >= 50}
            />
            <MetricCard
              label="Profit factor"
              value={formatProfitFactor(result.profitFactor)}
              positive={result.profitFactor >= 1}
            />
            <MetricCard
              label="Live entry confidence"
              value={`${calculateLiveTradeConfidence(result.liveTrade).toFixed(0)}%`}
              subValue={result.liveTrade ? result.liveTrade.confidenceReason : "No live trade"}
              positive={calculateLiveTradeConfidence(result.liveTrade) >= 70}
            />
          </div>

          <EquityCurve equity={result.equity} />

          <div className="overflow-hidden rounded-xl border border-dark-700">
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead className="sticky top-0 bg-dark-900 text-gray-400">
                  <tr>
                    <th className="px-3 py-3">Trade</th>
                    <th className="px-3 py-3">Side</th>
                    <th className="px-3 py-3 text-right">Entry confidence</th>
                    <th className="px-3 py-3">Entry time</th>
                    <th className="px-3 py-3">Exit time</th>
                    <th className="px-3 py-3 text-right">Entry</th>
                    <th className="px-3 py-3 text-right">Exit</th>
                    <th className="px-3 py-3 text-right">P&L $</th>
                    <th className="px-3 py-3 text-right">%</th>
                    <th className="px-3 py-3 text-right">MFE</th>
                    <th className="px-3 py-3 text-right">MAE</th>
                    <th className="px-3 py-3 text-right">Bars</th>
                    <th className="px-3 py-3">Exit reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-700 bg-dark-800/50 text-gray-300">
                  {result.trades.length === 0 && !result.liveTrade ? (
                    <tr>
                      <td
                        className="px-3 py-8 text-center text-gray-500"
                        colSpan={13}
                      >
                        No main-chart trades found with the current {strategyMode} settings.
                      </td>
                    </tr>
                  ) : (
                    [
                      ...(result.liveTrade ? [result.liveTrade] : []),
                      ...result.trades.slice().reverse(),
                    ].map((trade) => (
                      <tr key={`${trade.isLive ? "live" : "closed"}-${trade.id}`} className={trade.isLive ? "bg-emerald-400/5" : undefined}>
                        <td className="px-3 py-3 font-semibold">
                          {trade.isLive ? "LIVE" : `#${trade.id}`}
                        </td>
                        <td
                          className={`px-3 py-3 font-semibold ${trade.side === "Long" ? "text-emerald-300" : "text-red-300"}`}
                        >
                          {trade.side}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="font-bold text-cyan-300">
                            {trade.entryConfidence.toFixed(0)}%
                          </div>
                          <div className="text-[10px] text-gray-500">
                            {trade.confidenceReason}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {formatDateTime(trade.entryTime)}
                        </td>
                        <td className="px-3 py-3">
                          {trade.isLive ? "LIVE — waiting for exit" : formatDateTime(trade.exitTime)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {trade.entryPrice.toFixed(2)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {trade.exitPrice.toFixed(2)}
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-semibold ${trade.pnl >= 0 ? "text-emerald-300" : "text-red-300"}`}
                        >
                          {formatMoney(trade.pnl)}
                        </td>
                        <td
                          className={`px-3 py-3 text-right ${trade.pnlPercent >= 0 ? "text-emerald-300" : "text-red-300"}`}
                        >
                          {formatPercent(trade.pnlPercent)}
                        </td>
                        <td className="px-3 py-3 text-right text-emerald-300">
                          {formatPercent(trade.mfePercent)}
                        </td>
                        <td className="px-3 py-3 text-right text-red-300">
                          {formatPercent(trade.maePercent)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {trade.barsHeld}
                        </td>
                        <td className="px-3 py-3 text-gray-400">
                          {trade.exitReason}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
