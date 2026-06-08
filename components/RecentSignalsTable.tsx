'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'

type RecentSignal = {
  symbol?: string
  timeframe?: string
  primaryTimeframe?: string
  signal?: string
  type?: string
  confidence?: number
  price?: number
  entry?: number
  current?: number
  target?: number
  targetPrice?: number
  pnl?: number
  percent?: number
  status?: string
  createdAt?: string
}

type ChartCardCandle = {
  time?: unknown
  open?: number
  high?: number
  low?: number
  close?: number
  volume?: number
}

type ChartSignalCardInput = {
  label: string
  symbol?: string
  timeframe?: string
  candles?: ChartCardCandle[]
  latestSignal?: RecentSignal
  activePrice?: number
}

type RecentSignalsTableProps = {
  signals: RecentSignal[]
  latestSignal?: RecentSignal
  activeSymbol?: string
  activeTimeframe?: string
  activePrice?: number
  chartCards?: ChartSignalCardInput[]
}

type SignalCardView = {
  id: string
  label: string
  symbol: string
  timeframe: string
  type: 'BUY' | 'SELL' | 'HOLD'
  confidence: number
  confidenceLabel: 'LOW' | 'MEDIUM' | 'HIGH'
  entry: number | null
  target: number | null
  current: number | null
  bodyText: string
  statusText: string
  updatedAt?: string
}

function normalizeSymbol(value?: string) {
  const raw = String(value ?? 'BTCUSD')
    .trim()
    .toUpperCase()
    .replace('BINANCE:', '')
    .replace('COINBASE:', '')
    .replace('CRYPTO:', '')
    .replace('CME_MINI:', '')
    .replace('CME:', '')

  if (raw === 'MES1' || raw === 'MES1!' || raw.includes('MES')) return 'MES1!'
  if (raw.includes('BTC')) return 'BTCUSD'
  if (raw.includes('ETH')) return 'ETHUSD'
  if (raw.includes('SPY')) return 'SPY'

  return raw || 'BTCUSD'
}

function normalizeTimeframe(value?: string) {
  const raw = String(value ?? '1m').trim().toLowerCase()
  const tf = raw.includes('/') ? raw.split('/')[0]?.trim() ?? raw : raw

  if (tf === '1') return '1m'
  if (tf === '3') return '3m'
  if (tf === '5') return '5m'
  if (tf === '10') return '10m'
  if (tf === '15') return '15m'
  if (tf === '30') return '30m'
  if (tf === '60') return '1h'
  if (tf === '120') return '2h'
  if (tf === '240') return '4h'
  if (tf === 'd' || tf === '1d') return '1d'
  if (tf === 'w' || tf === '1w') return '1w'

  return tf || '1m'
}

function timeframeMatches(value: unknown, activeTimeframe: string) {
  const text = String(value ?? '').trim()

  if (text.includes('/')) {
    return text
      .split('/')
      .map((item) => normalizeTimeframe(item.trim()))
      .includes(normalizeTimeframe(activeTimeframe))
  }

  return normalizeTimeframe(text) === normalizeTimeframe(activeTimeframe)
}

function isPriceNearActiveScale(signal: RecentSignal, activePrice?: number) {
  const price = Number(signal.current ?? signal.price ?? signal.entry ?? 0)
  if (!Number.isFinite(price) || price <= 0) return false
  if (!activePrice || !Number.isFinite(activePrice) || activePrice <= 0) return true

  return Math.abs(price - activePrice) / activePrice <= 0.2
}

function normalizeSignalType(value?: string): 'BUY' | 'SELL' | 'HOLD' {
  const type = String(value ?? 'HOLD').toUpperCase()

  if (type.includes('BUY') || type.includes('BULL') || type.includes('LONG')) return 'BUY'
  if (type.includes('SELL') || type.includes('BEAR') || type.includes('SHORT')) return 'SELL'

  return 'HOLD'
}

function isPlaceholderSignal(signal?: RecentSignal) {
  if (!signal) return true

  const symbol = String(signal.symbol ?? '').toUpperCase()
  const status = String(signal.status ?? '').toLowerCase()
  const entry = Number(signal.entry ?? signal.price ?? 0)
  const current = Number(signal.current ?? signal.price ?? 0)

  return (
    symbol === 'WAITING' ||
    status === 'waiting' ||
    (!entry && !current && !Number(signal.confidence ?? 0))
  )
}

function formatPrice(value?: number | null) {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) return '—'
  if (Math.abs(numeric) >= 1000) return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (Math.abs(numeric) >= 100) return numeric.toFixed(2)
  if (Math.abs(numeric) >= 10) return numeric.toFixed(3)

  return numeric.toFixed(4)
}

function formatTime(value?: string) {
  if (!value) return new Date().toLocaleTimeString()

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleTimeString()
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function getSignalClass(type: 'BUY' | 'SELL' | 'HOLD') {
  if (type === 'BUY') return 'border-emerald-500/45 bg-emerald-500/10 text-emerald-400'
  if (type === 'SELL') return 'border-red-500/45 bg-red-500/10 text-red-400'

  return 'border-amber-400/45 bg-amber-400/10 text-amber-300'
}

function getConfidenceLabel(confidence: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (confidence >= 70) return 'HIGH'
  if (confidence >= 45) return 'MEDIUM'
  return 'LOW'
}

function getConfidenceClass(label: 'LOW' | 'MEDIUM' | 'HIGH') {
  if (label === 'HIGH') return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
  if (label === 'MEDIUM') return 'border-amber-400/40 bg-amber-400/15 text-amber-300'
  return 'border-red-500/40 bg-red-500/15 text-red-400'
}

function getLatestClose(candles?: ChartCardCandle[]) {
  if (!Array.isArray(candles) || candles.length === 0) return null

  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const close = Number(candles[index]?.close)
    if (Number.isFinite(close) && close > 0) return close
  }

  return null
}

function calculateAtr(candles?: ChartCardCandle[], length = 14) {
  if (!Array.isArray(candles) || candles.length < 2) return 0

  const valid = candles
    .filter((candle) =>
      Number.isFinite(Number(candle.high)) &&
      Number.isFinite(Number(candle.low)) &&
      Number.isFinite(Number(candle.close))
    )
    .slice(-Math.max(length + 1, 2))

  if (valid.length < 2) return 0

  const trueRanges = valid.slice(1).map((candle, index) => {
    const previousClose = Number(valid[index].close)
    const high = Number(candle.high)
    const low = Number(candle.low)

    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose)
    )
  })

  if (trueRanges.length === 0) return 0

  return trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length
}

function inferChartTrend(candles?: ChartCardCandle[]) {
  if (!Array.isArray(candles) || candles.length < 3) {
    return {
      type: 'HOLD' as const,
      confidence: 0,
      momentum: 0,
    }
  }

  const latest = getLatestClose(candles)
  const lookbackIndex = Math.max(0, candles.length - 6)
  const lookback = Number(candles[lookbackIndex]?.close)
  const atr = calculateAtr(candles, 14)

  if (!latest || !Number.isFinite(lookback) || lookback <= 0) {
    return {
      type: 'HOLD' as const,
      confidence: 0,
      momentum: 0,
    }
  }

  const move = latest - lookback
  const normalizedMove = atr > 0 ? move / atr : move / Math.max(Math.abs(latest) * 0.001, 0.01)
  const confidence = clampPercent(35 + Math.min(45, Math.abs(normalizedMove) * 16))

  if (normalizedMove >= 0.35) {
    return {
      type: 'BUY' as const,
      confidence,
      momentum: normalizedMove,
    }
  }

  if (normalizedMove <= -0.35) {
    return {
      type: 'SELL' as const,
      confidence,
      momentum: normalizedMove,
    }
  }

  return {
    type: 'HOLD' as const,
    confidence: clampPercent(Math.max(25, confidence - 15)),
    momentum: normalizedMove,
  }
}

function isSignalLinkedToActiveChart(signal: RecentSignal, activeSymbol: string, activeTimeframe: string, activePrice?: number) {
  const symbol = normalizeSymbol(signal.symbol)
  const timeframe = signal.primaryTimeframe ?? signal.timeframe

  return (
    symbol === normalizeSymbol(activeSymbol) &&
    timeframeMatches(timeframe, activeTimeframe) &&
    isPriceNearActiveScale(signal, activePrice)
  )
}

function buildLiveSnapshot(latestSignal?: RecentSignal, activeSymbol = 'BTCUSD', activeTimeframe = '1m', activePrice?: number): RecentSignal {
  const price = Number(activePrice ?? latestSignal?.current ?? latestSignal?.price ?? latestSignal?.entry ?? 0)
  const type = normalizeSignalType(latestSignal?.signal ?? latestSignal?.type)

  return {
    symbol: normalizeSymbol(activeSymbol),
    timeframe: normalizeTimeframe(activeTimeframe),
    signal: type,
    confidence: Number(latestSignal?.confidence ?? 0),
    entry: Number(latestSignal?.entry ?? price),
    current: price,
    pnl: 0,
    percent: 0,
    status: 'Live Snapshot',
    createdAt: latestSignal?.createdAt ?? new Date().toISOString(),
  }
}

function buildCardFromChart(input: ChartSignalCardInput, fallbackSignal?: RecentSignal): SignalCardView {
  const symbol = normalizeSymbol(input.symbol ?? fallbackSignal?.symbol)
  const timeframe = normalizeTimeframe(input.timeframe ?? fallbackSignal?.primaryTimeframe ?? fallbackSignal?.timeframe)
  const current = Number(input.activePrice ?? getLatestClose(input.candles) ?? fallbackSignal?.current ?? fallbackSignal?.price ?? fallbackSignal?.entry ?? NaN)
  const hasCurrent = Number.isFinite(current) && current > 0
  const trend = inferChartTrend(input.candles)

  const signalType = normalizeSignalType(input.latestSignal?.signal ?? input.latestSignal?.type ?? fallbackSignal?.signal ?? fallbackSignal?.type)
  const type = input.label.toLowerCase().includes('main') && signalType !== 'HOLD' ? signalType : trend.type
  const confidence = clampPercent(
    input.label.toLowerCase().includes('main')
      ? Number(input.latestSignal?.confidence ?? fallbackSignal?.confidence ?? trend.confidence)
      : trend.confidence
  )
  const confidenceLabel = getConfidenceLabel(confidence)
  const atr = calculateAtr(input.candles, 14)
  const entryFromSignal = Number(input.latestSignal?.entry ?? input.latestSignal?.price ?? fallbackSignal?.entry ?? fallbackSignal?.price ?? NaN)
  const entry = Number.isFinite(entryFromSignal) && entryFromSignal > 0 && hasCurrent && Math.abs(entryFromSignal - current) / current <= 0.2
    ? entryFromSignal
    : hasCurrent
      ? current
      : null
  const explicitTarget = Number(input.latestSignal?.target ?? input.latestSignal?.targetPrice ?? (fallbackSignal as any)?.target ?? (fallbackSignal as any)?.targetPrice ?? NaN)
  const targetMove = atr > 0 ? atr * 2 : hasCurrent ? current * 0.003 : 0
  const target = Number.isFinite(explicitTarget) && explicitTarget > 0 && hasCurrent && Math.abs(explicitTarget - current) / current <= 0.25
    ? explicitTarget
    : entry && type === 'BUY'
      ? entry + targetMove
      : entry && type === 'SELL'
        ? entry - targetMove
        : entry

  const statusText = type === 'BUY'
    ? 'Bullish chart signal'
    : type === 'SELL'
      ? 'Bearish chart signal'
      : 'Hold / no clean signal'

  const bodyText = input.label.toLowerCase().includes('main')
    ? 'Main chart signal card. Entry, target, current price, and confidence are tied to the active chart signal context.'
    : 'Mini chart confirmation card. This chart is used as a directional filter for the main chart strategy.'

  return {
    id: `${input.label}-${symbol}-${timeframe}`,
    label: input.label,
    symbol,
    timeframe,
    type,
    confidence,
    confidenceLabel,
    entry,
    target,
    current: hasCurrent ? current : null,
    bodyText,
    statusText,
    updatedAt: input.latestSignal?.createdAt ?? fallbackSignal?.createdAt,
  }
}

function buildFallbackCards(
  latestSignal: RecentSignal | undefined,
  activeSymbol: string | undefined,
  activeTimeframe: string | undefined,
  activePrice: number | undefined
) {
  const symbol = normalizeSymbol(activeSymbol ?? latestSignal?.symbol)
  const timeframe = normalizeTimeframe(activeTimeframe ?? latestSignal?.primaryTimeframe ?? latestSignal?.timeframe)

  return [
    buildCardFromChart({ label: 'Main Chart', symbol, timeframe, latestSignal, activePrice }, latestSignal),
    buildCardFromChart({ label: 'Mini Chart 1', symbol, timeframe: '5m', latestSignal, activePrice }, latestSignal),
    buildCardFromChart({ label: 'Mini Chart 2', symbol, timeframe: '15m', latestSignal, activePrice }, latestSignal),
  ]
}

function SignalScoreCard({ card }: { card: SignalCardView }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex min-h-[300px] flex-col rounded-2xl border border-dark-600 bg-dark-900/45 p-6 shadow-lg"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">{card.label}</p>
          <h3 className="mt-2 text-2xl font-black text-white">{card.symbol}</h3>
          <p className="mt-1 text-sm font-semibold text-gray-500">{card.timeframe}</p>
        </div>

        <div className={`rounded-lg border px-4 py-3 text-lg font-black ${getSignalClass(card.type)}`}>
          {card.type === 'BUY' ? '↗ BUY' : card.type === 'SELL' ? '↘ SELL' : '— HOLD'}
        </div>
      </div>

      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-semibold text-gray-400">Entry</span>
          <span className="text-lg font-black text-white">{formatPrice(card.entry)}</span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-semibold text-gray-400">Target</span>
          <span className="text-lg font-black text-white">{formatPrice(card.target)}</span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-semibold text-gray-400">Current Price</span>
          <span className="text-lg font-black text-white">{formatPrice(card.current)}</span>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-base font-semibold text-gray-400">Confidence</span>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-black ${getConfidenceClass(card.confidenceLabel)}`}>
              {card.confidenceLabel}
            </span>
            <span className="text-sm font-bold text-gray-300">{card.confidence}%</span>
          </div>
        </div>
      </div>

      <div className="my-5 h-px bg-dark-600" />

      <p className="min-h-[64px] flex-1 text-sm font-medium leading-6 text-gray-400">
        {card.statusText}. {card.bodyText}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button className="rounded-lg border border-dark-600 bg-dark-900/70 px-3 py-3 text-sm font-bold text-gray-300 hover:border-emerald-400/50 hover:text-emerald-300">
          ↙ Chart
        </button>
        <button className="rounded-lg border border-dark-600 bg-dark-900/70 px-3 py-3 text-sm font-bold text-gray-300 hover:border-amber-400/50 hover:text-amber-300">
          ↗ Paper Trade
        </button>
      </div>
    </motion.div>
  )
}

export default function RecentSignalsTable({
  signals,
  latestSignal,
  activeSymbol,
  activeTimeframe,
  activePrice,
  chartCards,
}: RecentSignalsTableProps) {
  const symbol = normalizeSymbol(activeSymbol ?? latestSignal?.symbol)
  const timeframe = normalizeTimeframe(activeTimeframe ?? latestSignal?.primaryTimeframe ?? latestSignal?.timeframe)

  const displaySignal = useMemo(() => {
    const cleanSignals = Array.isArray(signals)
      ? signals.filter((signal) => !isPlaceholderSignal(signal))
      : []

    const linkedSignals = cleanSignals.filter((signal) =>
      isSignalLinkedToActiveChart(signal, symbol, timeframe, activePrice)
    )

    return linkedSignals[0] ?? buildLiveSnapshot(latestSignal, symbol, timeframe, activePrice)
  }, [signals, latestSignal, symbol, timeframe, activePrice])

  const cards = useMemo(() => {
    if (Array.isArray(chartCards) && chartCards.length > 0) {
      return chartCards.slice(0, 3).map((card) => buildCardFromChart(card, displaySignal))
    }

    return buildFallbackCards(displaySignal, symbol, timeframe, activePrice)
  }, [chartCards, displaySignal, symbol, timeframe, activePrice])

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Recent Signals</h2>
          <p className="mt-1 text-xs text-gray-500">
            3 chart signal cards • main chart + mini confirmations • {symbol} • {timeframe}
          </p>
        </div>

        <div className="rounded-lg border border-dark-600 bg-dark-900/40 px-3 py-2 text-right">
          <p className="text-xs text-gray-500">Updated</p>
          <p className="text-sm font-bold text-white">{formatTime(displaySignal.createdAt)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {cards.map((card) => (
          <SignalScoreCard key={card.id} card={card} />
        ))}
      </div>
    </motion.div>
  )
}
