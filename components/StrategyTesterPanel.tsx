import React, { useMemo, useState } from 'react';

export type CandleLike = {
  time?: unknown;
  timestamp?: unknown;
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

  mainCandles?: CandleLike[];
  miniOneCandles?: CandleLike[];
  miniTwoCandles?: CandleLike[];

  mainSettings?: ChartStrategySettings;
  miniOneSettings?: ChartStrategySettings;
  miniTwoSettings?: ChartStrategySettings;

  onMainSettingsChange?: (settings: ChartStrategySettings) => void;
  onMiniOneSettingsChange?: (settings: ChartStrategySettings) => void;
  onMiniTwoSettingsChange?: (settings: ChartStrategySettings) => void;

  // backwards compatibility
  candles?: CandleLike[];
  settings?: ChartStrategySettings;
  onSettingsChange?: (settings: ChartStrategySettings) => void;
};

type Direction = 1 | -1 | 0;
type ChartSlot = 'main' | 'miniOne' | 'miniTwo';

type TradeResult = {
  side: 'LONG' | 'SHORT';
  entryTime: unknown;
  exitTime: unknown;
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

const DEFAULT_SETTINGS: ChartStrategySettings = {
  smmaLength: 20,
  nrtrMode: 'ATR-Based',
  nrtrAtrLength: 14,
  nrtrAtrMultiplier: 1,
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
      finalUpper =
        basicUpper < previousFinalUpper || previousClose > previousFinalUpper
          ? basicUpper
          : previousFinalUpper;

      finalLower =
        basicLower > previousFinalLower || previousClose < previousFinalLower
          ? basicLower
          : previousFinalLower;
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
  const atrLengths = [5, 7, 10, 14, 21, 34];
  const atrMultipliers = [0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4];
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
    const stats = runNrtrBacktest(candles, 'Percentage', 14, 1, percent);
    rows.push({
      rank: 0,
      score: optimizerScore(stats),
      mode: 'Percentage',
      atrLength: 14,
      atrMultiplier: 1,
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

function getStatsForSettings(candles: CandleLike[], settings: ChartStrategySettings): StrategyStats {
  if (candles.length < 30 || settings.nrtrMode === 'Off') {
    return emptyStats();
  }

  return runNrtrBacktest(
    candles,
    settings.nrtrMode === 'Percentage' ? 'Percentage' : 'ATR-Based',
    settings.nrtrAtrLength,
    settings.nrtrAtrMultiplier,
    settings.nrtrPercent
  );
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
        label: 'Main',
        fullLabel: 'Main Chart',
        candles: validCandles(mainCandles ?? simpleCandles),
        settings: { ...DEFAULT_SETTINGS, ...(mainSettings ?? simpleSettings) },
        onApply: onMainSettingsChange ?? onSettingsChange,
      },
      miniOne: {
        label: 'Mini 1',
        fullLabel: 'Mini Chart 1',
        candles: validCandles(miniOneCandles),
        settings: { ...DEFAULT_SETTINGS, ...(miniOneSettings ?? mainSettings ?? simpleSettings) },
        onApply: onMiniOneSettingsChange,
      },
      miniTwo: {
        label: 'Mini 2',
        fullLabel: 'Mini Chart 2',
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

  const mainStats = useMemo(() => getStatsForSettings(slots.main.candles, slots.main.settings), [slots.main.candles, slots.main.settings]);
  const miniOneStats = useMemo(() => getStatsForSettings(slots.miniOne.candles, slots.miniOne.settings), [slots.miniOne.candles, slots.miniOne.settings]);
  const miniTwoStats = useMemo(() => getStatsForSettings(slots.miniTwo.candles, slots.miniTwo.settings), [slots.miniTwo.candles, slots.miniTwo.settings]);

  const active = slots[activeSlot];
  const activeStats = activeSlot === 'main' ? mainStats : activeSlot === 'miniOne' ? miniOneStats : miniTwoStats;

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
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-cyan-300">Strategy Tester</div>
          <div className="mt-1 text-lg font-semibold text-white">NRTR Strategy Results</div>
          <div className="mt-1 text-xs text-slate-400">
            {symbol} · {timeframe} · NRTR optimizer is strategy-only and excluded from ML.
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowOptimizer((value) => !value)}
          className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20"
        >
          {showOptimizer ? 'Hide NRTR Optimizer' : 'Run NRTR Optimizer'}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <CompactResultCard
          active={activeSlot === 'main'}
          label="Main Chart"
          candles={slots.main.candles.length}
          settings={slots.main.settings}
          stats={mainStats}
          onClick={() => setActiveSlot('main')}
        />

        <CompactResultCard
          active={activeSlot === 'miniOne'}
          label="Mini Chart 1"
          candles={slots.miniOne.candles.length}
          settings={slots.miniOne.settings}
          stats={miniOneStats}
          onClick={() => setActiveSlot('miniOne')}
        />

        <CompactResultCard
          active={activeSlot === 'miniTwo'}
          label="Mini Chart 2"
          candles={slots.miniTwo.candles.length}
          settings={slots.miniTwo.settings}
          stats={miniTwoStats}
          onClick={() => setActiveSlot('miniTwo')}
        />
      </div>

      {showOptimizer && (
        <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-950/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-cyan-100">Current NRTR Optimizer</div>
              <div className="mt-1 text-xs text-slate-400">
                Optimizing {active.fullLabel} · {active.candles.length.toLocaleString()} candles · Current {settingsLabel(active.settings)}
              </div>
            </div>

            {best && (
              <button
                type="button"
                onClick={() => applyBest(best)}
                className="rounded-xl border border-emerald-300/50 bg-emerald-400/15 px-4 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/25"
              >
                Apply Best To {active.label}
              </button>
            )}
          </div>

          {best && (
            <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-emerald-300">Best Found</div>
              <div className="mt-1 text-sm font-semibold text-white">
                {best.mode} · ATR {best.atrLength} · Multiplier {formatNumber(best.atrMultiplier, 2)}
                {best.mode === 'Percentage' ? ` · Percent ${formatPercent(best.percent)}` : ''}
              </div>
              <div className="mt-1 text-xs text-slate-300">
                Win Rate {formatPercent(best.stats.winRate)} · Net PnL {formatNumber(best.stats.netPnl, 2)} · PF {formatNumber(best.stats.profitFactor, 2)} · DD {formatNumber(best.stats.maxDrawdown, 2)} · Trades {best.stats.totalTrades}
              </div>

              {!active.onApply && (
                <div className="mt-2 text-xs text-amber-200">
                  Apply callback is not wired yet. You can copy the best values into NRTR settings manually.
                </div>
              )}
            </div>
          )}

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-800">
            <div className="max-h-[390px] overflow-auto">
              <table className="w-full min-w-[880px] text-left text-xs">
                <thead className="sticky top-0 bg-slate-950 text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Rank</th>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2">ATR</th>
                    <th className="px-3 py-2">Mult</th>
                    <th className="px-3 py-2">Percent</th>
                    <th className="px-3 py-2">Win</th>
                    <th className="px-3 py-2">PnL</th>
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
                          className="rounded-lg border border-slate-600 px-3 py-1 text-[11px] text-slate-100 hover:border-cyan-300 hover:text-cyan-100"
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

          <div className="mt-3 text-xs text-slate-500">
            Ranking requires at least 10 trades and favors win rate, profit factor, net PnL, average trade, and lower drawdown.
          </div>
        </div>
      )}
    </div>
  );
}

function CompactResultCard({
  active,
  label,
  candles,
  settings,
  stats,
  onClick,
}: {
  active: boolean;
  label: string;
  candles: number;
  settings: ChartStrategySettings;
  stats: StrategyStats;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-2xl border p-4 text-left transition',
        active
          ? 'border-cyan-300/70 bg-cyan-400/10'
          : 'border-slate-800 bg-slate-900/50 hover:border-slate-600',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{label}</div>
          <div className="mt-1 text-xs text-slate-500">{candles.toLocaleString()} candles · {settingsLabel(settings)}</div>
        </div>
        <div className={active ? 'text-xs font-semibold text-cyan-200' : 'text-xs text-slate-500'}>
          {active ? 'Selected' : 'View'}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniMetric label="Trades" value={String(stats.totalTrades)} />
        <MiniMetric label="Win" value={formatPercent(stats.winRate)} />
        <MiniMetric label="PnL" value={formatNumber(stats.netPnl, 2)} />
        <MiniMetric label="PF" value={formatNumber(stats.profitFactor, 2)} />
        <MiniMetric label="DD" value={formatNumber(stats.maxDrawdown, 2)} />
        <MiniMetric label="Avg" value={formatNumber(stats.avgTrade, 2)} />
      </div>
    </button>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-100">{value}</div>
    </div>
  );
}
