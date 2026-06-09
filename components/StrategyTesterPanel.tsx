"use client";

import { useMemo, useState } from "react";
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
};

type NrtrPoint = {
  time: number;
  value: number | null;
  direction: 1 | -1 | 0;
  buy: boolean;
  sell: boolean;
};

type SmmaPoint = {
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

function clampNumber(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

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

type ContractSpec = {
  tickSize: number;
  tickValue: number;
  pointValue: number;
  label: string;
};

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
): NrtrPoint[] {
  const result: NrtrPoint[] = [];
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
): NrtrPoint[] {
  const result: NrtrPoint[] = [];
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
  if (settings.nrtrMode === "Percentage")
    return calculateNrtrPercentage(candles, settings);
  return calculateNrtrAtr(candles, settings);
}

function calculateSmma(
  candles: ReturnType<typeof toComparableCandles>,
  settings: ChartStrategySettings,
): SmmaPoint[] {
  const safeLength = Math.max(1, Math.floor(Number(settings.smmaLength) || 20));
  const result: SmmaPoint[] = [];
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

    if (index === safeLength - 1) smma = runningSum / safeLength;
    else if (smma !== null)
      smma = (smma * (safeLength - 1) + candle.close) / safeLength;

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

function findDirectionAt<T extends { time: number; direction: 1 | -1 | 0 }>(
  points: T[],
  time: number,
) {
  let direction: 1 | -1 | 0 = 0;
  for (const point of points) {
    if (point.time > time) break;
    if (point.direction !== 0) direction = point.direction;
  }
  return direction;
}

function calculateBacktest(
  symbol: string,
  mainCandlesInput: DashboardCandle[],
  miniOneCandlesInput: DashboardCandle[],
  miniTwoCandlesInput: DashboardCandle[],
  mainSettings: ChartStrategySettings,
  miniOneSettings: ChartStrategySettings,
  miniTwoSettings: ChartStrategySettings,
  strategyMode: StrategyMode,
): BacktestResult {
  const mainCandles = toComparableCandles(mainCandlesInput);
  const miniOneCandles = toComparableCandles(miniOneCandlesInput);
  const miniTwoCandles = toComparableCandles(miniTwoCandlesInput);

  if (mainCandles.length < 30) {
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

  const mainPoints =
    strategyMode === "NRTR"
      ? calculateNrtr(mainCandles, mainSettings)
      : calculateSmma(mainCandles, mainSettings);
  const miniOnePoints =
    strategyMode === "NRTR"
      ? calculateNrtr(miniOneCandles, miniOneSettings)
      : calculateSmma(miniOneCandles, miniOneSettings);
  const miniTwoPoints =
    strategyMode === "NRTR"
      ? calculateNrtr(miniTwoCandles, miniTwoSettings)
      : calculateSmma(miniTwoCandles, miniTwoSettings);
  const contract = getContractSpec(symbol);

  const trades: BacktestTrade[] = [];
  let openTrade: {
    side: 1 | -1;
    entryIndex: number;
    entryTime: number;
    entryPrice: number;
    reason: string;
  } | null = null;

  for (let index = 1; index < mainCandles.length; index += 1) {
    const candle = mainCandles[index];
    const point = mainPoints[index];
    if (!point) continue;

    const miniOneDirection = findDirectionAt(miniOnePoints, candle.numericTime);
    const miniTwoDirection = findDirectionAt(miniTwoPoints, candle.numericTime);
    const miniLongOk = miniOneDirection === 1 && miniTwoDirection === 1;
    const miniShortOk = miniOneDirection === -1 && miniTwoDirection === -1;

    const longSignal = point.buy && miniLongOk;
    const shortSignal = point.sell && miniShortOk;
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
          ? Math.max(...tradeCandles.map((item) => item.high)) -
            openTrade.entryPrice
          : openTrade.entryPrice -
            Math.min(...tradeCandles.map((item) => item.low));
      const mae =
        side === 1
          ? Math.min(...tradeCandles.map((item) => item.low)) -
            openTrade.entryPrice
          : openTrade.entryPrice -
            Math.max(...tradeCandles.map((item) => item.high));

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
        exitReason: `${strategyMode} opposite flip`,
      });
      openTrade = null;
    }

    if (!openTrade && longSignal) {
      openTrade = {
        side: 1,
        entryIndex: index,
        entryTime: candle.numericTime,
        entryPrice: candle.close,
        reason: `${strategyMode} long + both mini charts confirmed`,
      };
    } else if (!openTrade && shortSignal) {
      openTrade = {
        side: -1,
        entryIndex: index,
        entryTime: candle.numericTime,
        entryPrice: candle.close,
        reason: `${strategyMode} short + both mini charts confirmed`,
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
        ? Math.max(...tradeCandles.map((item) => item.high)) -
          openTrade.entryPrice
        : openTrade.entryPrice -
          Math.min(...tradeCandles.map((item) => item.low));
    const mae =
      side === 1
        ? Math.min(...tradeCandles.map((item) => item.low)) -
          openTrade.entryPrice
        : openTrade.entryPrice -
          Math.max(...tradeCandles.map((item) => item.high));

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
      exitReason: "LIVE — waiting for exit",
      isLive: true,
    };
  }

  let cumulative = 0;
  let peak = 0;
  let maxDrawdownPercent = 0;
  const equity = trades.map((trade) => {
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

  const winners = trades.filter((trade) => trade.pnl > 0);
  const losers = trades.filter((trade) => trade.pnl < 0);
  const grossProfit = winners.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((sum, trade) => sum + trade.pnl, 0));
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const totalPnlPercent = trades.reduce(
    (sum, trade) => sum + trade.pnlPercent,
    0,
  );

  return {
    trades,
    liveTrade,
    equity,
    totalPnl,
    totalPnlPercent,
    maxDrawdown: maxDrawdownPercent,
    maxDrawdownPercent,
    profitFactor:
      grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0,
    winRate: trades.length ? (winners.length / trades.length) * 100 : 0,
    winners: winners.length,
    losers: losers.length,
    totalTrades: trades.length,
  };
}

function EquityCurve({ equity }: { equity: BacktestResult["equity"] }) {
  if (!equity.length) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-dark-700 bg-dark-900/50 text-sm text-gray-500">
        No backtest trades yet. Load all three charts and wait for enough
        candles.
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
        <h3 className="text-sm font-semibold text-gray-200">Equity chart</h3>
        <span className="rounded-md border border-dark-600 px-2 py-1 text-[10px] text-gray-400">
          Preview
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

export default function StrategyTesterPanel({
  symbol,
  timeframe,
  mainCandles,
  miniOneCandles,
  miniTwoCandles,
  mainSettings,
  miniOneSettings,
  miniTwoSettings,
}: StrategyTesterPanelProps) {
  const [strategyMode, setStrategyMode] = useState<StrategyMode>("NRTR");

  const result = useMemo(
    () =>
      calculateBacktest(
        symbol,
        mainCandles,
        miniOneCandles,
        miniTwoCandles,
        mainSettings,
        miniOneSettings,
        miniTwoSettings,
        strategyMode,
      ),
    [
      mainCandles,
      mainSettings,
      miniOneCandles,
      miniOneSettings,
      miniTwoCandles,
      miniTwoSettings,
      strategyMode,
      symbol,
    ],
  );

  const contractSpec = getContractSpec(symbol);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mt-6 rounded-2xl border border-dark-700 bg-dark-800/80 p-5 shadow-xl"
    >
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-white">Strategy Tester</h2>
            <span className="rounded-lg border border-dark-600 bg-dark-900 px-2 py-1 text-xs text-gray-400">
              {symbol} • {timeframe} main / mini confirmation
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Candle-only preview using the three chart settings. SMC, Liquidity,
            Ghost, External Data, and ML are excluded. {contractSpec.label}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={strategyMode}
            onChange={(event) =>
              setStrategyMode(event.target.value as StrategyMode)
            }
            className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-amber-400"
          >
            <option value="NRTR">NRTR flip</option>
            <option value="SMMA">SMMA cross</option>
          </select>
          <span className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-dark-900">
            Metrics
          </span>
          <span className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-300">
            List always visible
          </span>
        </div>
      </div>

      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
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
            value={
              result.profitFactor >= 999 ? "∞" : result.profitFactor.toFixed(3)
            }
            positive={result.profitFactor >= 1}
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
                      colSpan={12}
                    >
                      No trades found with the current three-chart settings.
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
    </motion.div>
  );
}
