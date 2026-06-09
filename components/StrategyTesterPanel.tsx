import React, { useMemo, useState } from 'react';

export type CandleLike = {
  time?: string | number;
  timestamp?: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type ChartStrategySettings = {
  smmaLength: number;
  nrtrMode: 'ATR-Based' | 'Percentage' | 'Off';
  nrtrAtrLength: number;
  nrtrAtrMultiplier: number;
  nrtrPercent: number;
  showNrtrExitLabels: boolean;
};

export type StrategyTesterPanelProps = {
  symbol?: string;
  timeframe?: string;

  // Existing app/page.tsx dashboard props.
  mainCandles?: CandleLike[];
  miniOneCandles?: CandleLike[];
  miniTwoCandles?: CandleLike[];
  mainSettings?: ChartStrategySettings;
  miniOneSettings?: ChartStrategySettings;
  miniTwoSettings?: ChartStrategySettings;

  // Optional callbacks if/when app/page.tsx wires Apply Best into live settings.
  onMainSettingsChange?: (settings: ChartStrategySettings) => void;
  onMiniOneSettingsChange?: (settings: ChartStrategySettings) => void;
  onMiniTwoSettingsChange?: (settings: ChartStrategySettings) => void;

  // Backwards-compatible simple props.
  candles?: CandleLike[];
  settings?: ChartStrategySettings;
  onSettingsChange?: (settings: ChartStrategySettings) => void;
};

type Direction = 1 | -1 | 0;

type TradeResult = {
  side: 'LONG' | 'SHORT';
  entryTime: string | number | undefined;
  exitTime: string | number | undefined;
  entry: number;
  exit: number;
  pnl: number;
  percent: number;
  barsHeld: number;
  reason: string;
};

type StrategyStats = {
  trades: TradeResult[];
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  avgTrade: number;
};

type NrtrOptimizationRow = {
  rank: number;
  score: number;
  mode: 'ATR-Based' | 'Percentage';
  atrLength: number;
  atrMultiplier: number;
  percent: number;
  stats: StrategyStats;
};

type ChartSlot = 'main' | 'miniOne' | 'miniTwo';

const DEFAULT_SETTINGS: ChartStrategySettings = {
  smmaLength: 20,
  nrtrMode: 'ATR-Based',
  nrtrAtrLength: 14,
  nrtrAtrMultiplier: 3,
  nrtrPercent: 0.25,
  showNrtrExitLabels: true,
};

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${formatNumber(value, 2)}%`;
}

function validCandles(candles?: CandleLike[]): CandleLike[] {
  return Array.isArray(candles)
    ? candles.filter((c) => {
        const o = toNumber(c.open);
        const h = toNumber(c.high);
        const l = toNumber(c.low);
        const close = toNumber(c.close);
        return o > 0 && h > 0 && l > 0 && close > 0 && h >= l;
      })
    : [];
}

function emptyStats(): StrategyStats {
  return {
    trades: [],
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    netPnl: 0,
    grossProfit: 0,
    grossLoss: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    avgTrade: 0,
  };
}

function calculateAtr(candles: CandleLike[], length: number): Array<number | null> {
  const safeLength = Math.max(1, Math.round(length || 14));
  const tr: number[] = [];

  for (let i = 0; i < candles.length; i += 1) {
    const high = toNumber(candles[i].high);
    const low = toNumber(candles[i].low);
    const prevClose = i > 0 ? toNumber(candles[i - 1].close) : toNumber(candles[i].close);
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  const output: Array<number | null> = Array(tr.length).fill(null);
  let seed = 0;

  for (let i = 0; i < tr.length; i += 1) {
    if (i < safeLength) {
      seed += tr[i];
      if (i === safeLength - 1) output[i] = seed / safeLength;
      continue;
    }

    const prev = output[i - 1];
    output[i] = prev === null ? null : (prev * (safeLength - 1) + tr[i]) / safeLength;
  }

  return output;
}

function calculateNrtrDirections(
  candles: CandleLike[],
  mode: 'ATR-Based' | 'Percentage',
  atrLength: number,
  atrMultiplier: number,
  percent: number
): Direction[] {
  if (candles.length < 5) return [];

  const directions: Direction[] = Array(candles.length).fill(0);
  const atr = calculateAtr(candles, atrLength);

  let finalUpper: number | null = null;
  let finalLower: number | null = null;
  let previousFinalUpper: number | null = null;
  let previousFinalLower: number | null = null;
  let previousTrendLine: number | null = null;
  let direction: Direction = 0;

  for (let i = 0; i < candles.length; i += 1) {
    const high = toNumber(candles[i].high);
    const low = toNumber(candles[i].low);
    const close = toNumber(candles[i].close);
    const previousClose = i > 0 ? toNumber(candles[i - 1].close) : close;

    const hl2 = (high + low) / 2;
    const offset =
      mode === 'ATR-Based'
        ? toNumber(atr[i], 0) * Math.max(0.1, atrMultiplier || 1)
        : close * (Math.max(0.01, percent || 0.25) / 100);

    if (offset <= 0) {
      directions[i] = direction;
      continue;
    }

    const basicUpper = hl2 + offset;
    const basicLower = hl2 - offset;

    if (previousFinalUpper === null || previousFinalLower === null) {
      finalUpper = basicUpper;
      finalLower = basicLower;
    } else {
      finalUpper = basicUpper < previousFinalUpper || previousClose > previousFinalUpper ? basicUpper : previousFinalUpper;
      finalLower = basicLower > previousFinalLower || previousClose < previousFinalLower ? basicLower : previousFinalLower;
    }

    if (previousTrendLine === null) {
      direction = close >= hl2 ? 1 : -1;
    } else if (previousFinalUpper !== null && Math.abs(previousTrendLine - previousFinalUpper) <= 1e-10) {
      direction = close > Number(finalUpper) ? 1 : -1;
    } else {
      direction = close < Number(finalLower) ? -1 : 1;
    }

    directions[i] = direction;
    previousTrendLine = direction === 1 ? Number(finalLower) : Number(finalUpper);
    previousFinalUpper = finalUpper;
    previousFinalLower = finalLower;
  }

  return directions;
}

function runNrtrBacktest(
  candles: CandleLike[],
  mode: 'ATR-Based' | 'Percentage',
  atrLength: number,
  atrMultiplier: number,
  percent: number
): StrategyStats {
  if (!candles.length) return emptyStats();

  const directions = calculateNrtrDirections(candles, mode, atrLength, atrMultiplier, percent);
  const trades: TradeResult[] = [];

  let activeSide: 'LONG' | 'SHORT' | null = null;
  let entry = 0;
  let entryIndex = 0;

  for (let i = 1; i < candles.length; i += 1) {
    const prev = directions[i - 1];
    const curr = directions[i];

    if (!curr || curr === prev) continue;

    const close = toNumber(candles[i].close);
    const time = candles[i].time ?? candles[i].timestamp;

    if (activeSide) {
      const pnl = activeSide === 'LONG' ? close - entry : entry - close;
      trades.push({
        side: activeSide,
        entryTime: candles[entryIndex].time ?? candles[entryIndex].timestamp,
        exitTime: time,
        entry,
        exit: close,
        pnl,
        percent: entry ? (pnl / entry) * 100 : 0,
        barsHeld: i - entryIndex,
        reason: curr === 1 ? 'NRTR Bull Flip' : 'NRTR Bear Flip',
      });
    }

    activeSide = curr === 1 ? 'LONG' : 'SHORT';
    entry = close;
    entryIndex = i;
  }

  const grossProfit = trades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const grossLossAbs = Math.abs(trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
  const netPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl <= 0).length;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const trade of trades) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return {
    trades,
    totalTrades: trades.length,
    wins,
    losses,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    netPnl,
    grossProfit,
    grossLoss: grossLossAbs,
    profitFactor: grossLossAbs > 0 ? grossProfit / grossLossAbs : grossProfit > 0 ? 99 : 0,
    maxDrawdown,
    avgTrade: trades.length ? netPnl / trades.length : 0,
  };
}

function optimizerScore(stats: StrategyStats): number {
  if (stats.totalTrades < 10) return -999999;

  const pnlScore = stats.netPnl;
  const winScore = stats.winRate * 0.8;
  const pfScore = clamp(stats.profitFactor, 0, 5) * 18;
  const avgTradeScore = stats.avgTrade * 6;
  const drawdownPenalty = stats.maxDrawdown * 1.25;
  const tradeCountQuality = clamp(stats.totalTrades, 10, 80) * 0.15;

  return winScore + pfScore + pnlScore + avgTradeScore + tradeCountQuality - drawdownPenalty;
}

function runNrtrOptimization(candles: CandleLike[]): NrtrOptimizationRow[] {
  const atrLengths = [7, 10, 14, 21, 34];
  const atrMultipliers = [1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4];
  const percentages = [0.1, 0.15, 0.2, 0.25, 0.35, 0.5, 0.75, 1];

  const rows: NrtrOptimizationRow[] = [];

  for (const atrLength of atrLengths) {
    for (const atrMultiplier of atrMultipliers) {
      const stats = runNrtrBacktest(candles, 'ATR-Based', atrLength, atrMultiplier, 0.25);
      rows.push({
        rank: 0,
        score: optimizerScore(stats),
        mode: 'ATR-Based',
        atrLength,
        atrMultiplier,
        percent: 0.25,
        stats,
      });
    }
  }

  for (const percent of percentages) {
    const stats = runNrtrBacktest(candles, 'Percentage', 14, 3, percent);
    rows.push({
      rank: 0,
      score: optimizerScore(stats),
      mode: 'Percentage',
      atrLength: 14,
      atrMultiplier: 3,
      percent,
      stats,
    });
  }

  return rows
    .sort((a, b) => b.score - a.score)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function settingsLabel(settings: ChartStrategySettings): string {
  if (settings.nrtrMode === 'Off') return 'NRTR Off';

  if (settings.nrtrMode === 'Percentage') {
    return `Percentage · ${formatPercent(settings.nrtrPercent)}`;
  }

  return `ATR-Based · ATR ${settings.nrtrAtrLength} · x${formatNumber(settings.nrtrAtrMultiplier, 2)}`;
}

export default function StrategyTesterPanel({
  symbol = 'MES1!',
  timeframe = '1m',
  mainCandles,
  miniOneCandles,
  miniTwoCandles,
  mainSettings,
  miniOneSettings,
  miniTwoSettings,
  onMainSettingsChange,
  onMiniOneSettingsChange,
  onMiniTwoSettingsChange,
  candles,
  settings,
  onSettingsChange,
}: StrategyTesterPanelProps) {
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [activeSlot, setActiveSlot] = useState<ChartSlot>('main');

  const slots = useMemo(() => {
    const simpleCandles = candles;
    const simpleSettings = settings;

    return {
      main: {
        label: 'Main Chart',
        candles: validCandles(mainCandles ?? simpleCandles),
        settings: { ...DEFAULT_SETTINGS, ...(mainSettings ?? simpleSettings) },
        onApply: onMainSettingsChange ?? onSettingsChange,
      },
      miniOne: {
        label: 'Mini Chart 1',
        candles: validCandles(miniOneCandles),
        settings: { ...DEFAULT_SETTINGS, ...(miniOneSettings ?? mainSettings ?? simpleSettings) },
        onApply: onMiniOneSettingsChange,
      },
      miniTwo: {
        label: 'Mini Chart 2',
        candles: validCandles(miniTwoCandles),
        settings: { ...DEFAULT_SETTINGS, ...(miniTwoSettings ?? mainSettings ?? simpleSettings) },
        onApply: onMiniTwoSettingsChange,
      },
    };
  }, [
    candles,
    mainCandles,
    mainSettings,
    miniOneCandles,
    miniOneSettings,
    miniTwoCandles,
    miniTwoSettings,
    onMainSettingsChange,
    onMiniOneSettingsChange,
    onMiniTwoSettingsChange,
    onSettingsChange,
    settings,
  ]);

  const active = slots[activeSlot];

  const currentStats = useMemo(() => {
    if (active.candles.length < 30 || active.settings.nrtrMode === 'Off') {
      return emptyStats();
    }

    return runNrtrBacktest(
      active.candles,
      active.settings.nrtrMode === 'Percentage' ? 'Percentage' : 'ATR-Based',
      active.settings.nrtrAtrLength,
      active.settings.nrtrAtrMultiplier,
      active.settings.nrtrPercent
    );
  }, [active.candles, active.settings]);

  const optimizationRows = useMemo(() => {
    if (!showOptimizer || active.candles.length < 60) return [];
    return runNrtrOptimization(active.candles).slice(0, 20);
  }, [showOptimizer, active.candles]);

  const best = optimizationRows[0];

  function applyBest(row: NrtrOptimizationRow) {
    const nextSettings: ChartStrategySettings = {
      ...active.settings,
      nrtrMode: row.mode,
      nrtrAtrLength: row.atrLength,
      nrtrAtrMultiplier: row.atrMultiplier,
      nrtrPercent: row.percent,
    };

    active.onApply?.(nextSettings);
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-slate-100 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm uppercase tracking-[0.25em] text-cyan-300">Strategy Tester</div>
          <h3 className="text-xl font-semibold">NRTR Entry / Exit Performance</h3>
          <p className="mt-1 text-sm text-slate-400">
            {symbol} · {timeframe} · NRTR is strategy-only, not ML hierarchy.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowOptimizer((value) => !value)}
          className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20"
        >
          {showOptimizer ? 'Hide NRTR Optimizer' : 'Run NRTR Optimizer'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(['main', 'miniOne', 'miniTwo'] as ChartSlot[]).map((slot) => {
          const item = slots[slot];
          const activeButton = activeSlot === slot;

          return (
            <button
              key={slot}
              type="button"
              onClick={() => setActiveSlot(slot)}
              className={[
                'rounded-xl border px-3 py-2 text-sm font-semibold',
                activeButton
                  ? 'border-cyan-300 bg-cyan-400/15 text-cyan-100'
                  : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500',
              ].join(' ')}
            >
              {item.label} · {item.candles.length.toLocaleString()} candles
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-sm text-slate-300">
        <span className="text-slate-500">Current settings:</span>{' '}
        <span className="font-semibold text-slate-100">{settingsLabel(active.settings)}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <MetricCard label="Trades" value={String(currentStats.totalTrades)} />
        <MetricCard label="Win Rate" value={formatPercent(currentStats.winRate)} />
        <MetricCard label="Net PnL" value={formatNumber(currentStats.netPnl, 2)} />
        <MetricCard label="Profit Factor" value={formatNumber(currentStats.profitFactor, 2)} />
        <MetricCard label="Drawdown" value={formatNumber(currentStats.maxDrawdown, 2)} />
        <MetricCard label="Avg Trade" value={formatNumber(currentStats.avgTrade, 2)} />
      </div>

      {best && (
        <div className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-emerald-300">Best NRTR Settings Found</div>
              <div className="mt-1 text-lg font-semibold">
                {best.mode} · ATR {best.atrLength} · Multiplier {formatNumber(best.atrMultiplier, 2)}
                {best.mode === 'Percentage' ? ` · ${formatPercent(best.percent)}` : ''}
              </div>
              <div className="mt-1 text-sm text-slate-300">
                Win Rate {formatPercent(best.stats.winRate)} · Net PnL {formatNumber(best.stats.netPnl, 2)} · PF {formatNumber(best.stats.profitFactor, 2)} · Trades {best.stats.totalTrades}
              </div>
            </div>

            <button
              type="button"
              onClick={() => applyBest(best)}
              className="rounded-xl border border-emerald-300/50 bg-emerald-400/15 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/25"
            >
              Apply Best Settings
            </button>
          </div>

          {!active.onApply && (
            <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
              Apply button is ready, but app/page.tsx has not passed a settings update callback yet. You can still copy these best values into your NRTR settings.
            </div>
          )}
        </div>
      )}

      {showOptimizer && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800">
          <div className="border-b border-slate-800 bg-slate-900/80 px-4 py-3">
            <div className="text-sm font-semibold text-slate-200">NRTR Optimization Results</div>
            <div className="text-xs text-slate-500">
              Minimum 10 trades required to rank. Higher score favors win rate, profit factor, PnL, average trade, and lower drawdown.
            </div>
          </div>

          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="sticky top-0 bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Rank</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">ATR Length</th>
                  <th className="px-3 py-2">Multiplier</th>
                  <th className="px-3 py-2">Percent</th>
                  <th className="px-3 py-2">Win Rate</th>
                  <th className="px-3 py-2">Net PnL</th>
                  <th className="px-3 py-2">PF</th>
                  <th className="px-3 py-2">DD</th>
                  <th className="px-3 py-2">Trades</th>
                  <th className="px-3 py-2">Apply</th>
                </tr>
              </thead>
              <tbody>
                {optimizationRows.map((row) => (
                  <tr key={`${row.rank}-${row.mode}-${row.atrLength}-${row.atrMultiplier}-${row.percent}`} className="border-t border-slate-800/80">
                    <td className="px-3 py-2 font-semibold text-cyan-200">#{row.rank}</td>
                    <td className="px-3 py-2">{row.mode}</td>
                    <td className="px-3 py-2">{row.atrLength}</td>
                    <td className="px-3 py-2">{formatNumber(row.atrMultiplier, 2)}</td>
                    <td className="px-3 py-2">{row.mode === 'Percentage' ? formatPercent(row.percent) : '—'}</td>
                    <td className="px-3 py-2">{formatPercent(row.stats.winRate)}</td>
                    <td className="px-3 py-2">{formatNumber(row.stats.netPnl, 2)}</td>
                    <td className="px-3 py-2">{formatNumber(row.stats.profitFactor, 2)}</td>
                    <td className="px-3 py-2">{formatNumber(row.stats.maxDrawdown, 2)}</td>
                    <td className="px-3 py-2">{row.stats.totalTrades}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => applyBest(row)}
                        className="rounded-lg border border-slate-600 px-3 py-1 text-xs text-slate-100 hover:border-cyan-300 hover:text-cyan-100"
                      >
                        Apply
                      </button>
                    </td>
                  </tr>
                ))}

                {optimizationRows.length === 0 && (
                  <tr>
                    <td className="px-3 py-8 text-center text-slate-400" colSpan={11}>
                      Need at least 60 candles to run optimization.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-100">{value}</div>
    </div>
  );
}
