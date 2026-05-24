'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  ShieldAlert,
  Activity,
} from 'lucide-react'

type TradingSignal = {
  symbol: string
  timeframe: string
  signal: string
  confidence: number
  bullScore: number
  bearScore: number
  netBias: number
  price?: number
  ghostConfidence?: number
}

type SignalCardProps = {
  signal: TradingSignal
}

type TechnicalIndicator = {
  name: string
  value: number
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | string
}

type TechnicalSentiment = {
  sentiment?: number
  sentimentStatus?: string
  bearCount?: number
  neutralCount?: number
  bullCount?: number
  activeCount?: number
  indicators?: TechnicalIndicator[]
  technicalIndicators?: TechnicalIndicator[]
  technicalMeter?: TechnicalIndicator[]
  factors?: TechnicalIndicator[]
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://trading-intelligence-dashboard.onrender.com'

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeSymbol(value: unknown) {
  return String(value ?? 'BTCUSD')
    .trim()
    .toUpperCase()
    .split('BINANCE:')
    .join('')
    .split('COINBASE:')
    .join('')
    .split('CRYPTO:')
    .join('')
    .split('CME_MINI:')
    .join('')
    .split('CME:')
    .join('')
}

function normalizeTimeframe(value: unknown) {
  const tf = String(value ?? '1m').trim().toLowerCase()

  if (tf === '1') return '1m'
  if (tf === '3') return '3m'
  if (tf === '5') return '5m'
  if (tf === '15') return '15m'
  if (tf === '30') return '30m'
  if (tf === '60') return '1h'
  if (tf === '120') return '2h'
  if (tf === '240') return '4h'
  if (tf === 'd' || tf === '1d') return '1d'
  if (tf === 'w' || tf === '1w') return '1w'

  return tf || '1m'
}

function asIndicatorArray(value: unknown): TechnicalIndicator[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null

      const raw = item as Record<string, unknown>
      const name = String(raw.name ?? raw.factor ?? raw.label ?? raw.indicator ?? '').trim()

      if (!name) return null

      return {
        name,
        value: clamp(Number(raw.value ?? raw.strength ?? raw.score ?? 0)),
        signal: String(raw.signal ?? raw.status ?? raw.side ?? 'NEUTRAL').toUpperCase(),
      }
    })
    .filter((item): item is TechnicalIndicator => Boolean(item))
}

function extractTechnicalIndicators(data: TechnicalSentiment | null): TechnicalIndicator[] {
  if (!data) return []

  const merged = [
    ...asIndicatorArray(data.indicators),
    ...asIndicatorArray(data.technicalIndicators),
    ...asIndicatorArray(data.technicalMeter),
    ...asIndicatorArray(data.factors),
  ]

  const byName = new Map<string, TechnicalIndicator>()

  for (const indicator of merged) {
    const key = indicator.name.trim().toLowerCase()
    if (!byName.has(key)) {
      byName.set(key, indicator)
    }
  }

  return Array.from(byName.values())
}

function technicalSummary(data: TechnicalSentiment | null) {
  const indicators = extractTechnicalIndicators(data)
  const activeCount = data?.activeCount ?? indicators.length
  const bullCount =
    data?.bullCount ??
    indicators.filter((indicator) => String(indicator.signal).toUpperCase() === 'BULLISH')
      .length
  const bearCount =
    data?.bearCount ??
    indicators.filter((indicator) => String(indicator.signal).toUpperCase() === 'BEARISH')
      .length
  const neutralCount =
    data?.neutralCount ??
    indicators.filter((indicator) => String(indicator.signal).toUpperCase() === 'NEUTRAL')
      .length

  const sentiment = clamp(Number(data?.sentiment ?? 50))
  const status = String(data?.sentimentStatus ?? 'Waiting')

  return {
    indicators,
    activeCount,
    bullCount,
    bearCount,
    neutralCount,
    sentiment,
    status,
  }
}

function normalizeSignalSide(signal: string) {
  const upper = String(signal ?? '').toUpperCase()

  if (upper.includes('BUY') || upper.includes('BULL') || upper.includes('LONG')) return 'BULLISH'
  if (upper.includes('SELL') || upper.includes('BEAR') || upper.includes('SHORT')) return 'BEARISH'

  return 'NEUTRAL'
}

function formatPrice(price?: number) {
  const numeric = Number(price)

  if (!Number.isFinite(numeric) || numeric <= 0) return '—'
  if (numeric >= 1000) return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (numeric >= 100) return numeric.toFixed(2)
  if (numeric >= 10) return numeric.toFixed(3)

  return numeric.toFixed(4)
}

export default function SignalCard({ signal }: SignalCardProps) {
  const [technicalSentiment, setTechnicalSentiment] =
    useState<TechnicalSentiment | null>(null)

  const symbol = normalizeSymbol(signal.symbol)
  const timeframe = normalizeTimeframe(signal.timeframe)

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchTechnicalSentiment() {
      try {
        const params = new URLSearchParams({
          symbol,
          timeframe,
          limit: '500',
        })

        const response = await fetch(`${API_BASE_URL}/api/latest-sentiment?${params.toString()}`, {
          cache: 'no-store',
        })

        if (!response.ok) return

        const json = await response.json()

        if (!cancelled) {
          setTechnicalSentiment(json && typeof json === 'object' ? json : null)
        }
      } catch (error) {
        console.error('Signal card technical sentiment fetch error:', error)
      }
    }

    fetchTechnicalSentiment()
    intervalId = setInterval(fetchTechnicalSentiment, 10000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [symbol, timeframe])

  const summary = useMemo(
    () => technicalSummary(technicalSentiment),
    [technicalSentiment]
  )

  const isBuy = signal.signal === 'BUY'
  const isSell = signal.signal === 'SELL'

  const technicalSide =
    summary.bullCount > summary.bearCount
      ? 'BULLISH'
      : summary.bearCount > summary.bullCount
        ? 'BEARISH'
        : 'NEUTRAL'

  const signalSide = normalizeSignalSide(signal.signal)
  const hasConflict =
    signalSide !== 'NEUTRAL' &&
    technicalSide !== 'NEUTRAL' &&
    signalSide !== technicalSide

  const technicalConfirming =
    signalSide !== 'NEUTRAL' &&
    technicalSide !== 'NEUTRAL' &&
    signalSide === technicalSide

  const signalColor = isBuy
    ? 'text-emerald-400'
    : isSell
      ? 'text-red-400'
      : 'text-yellow-400'

  const signalBg = isBuy
    ? 'bg-emerald-500/20 border-emerald-500/40'
    : isSell
      ? 'bg-red-500/20 border-red-500/40'
      : 'bg-yellow-500/20 border-yellow-500/40'

  const Icon = isBuy ? ArrowUpRight : isSell ? ArrowDownRight : Minus

  const confirmationLabel = hasConflict
    ? 'Conflict'
    : technicalConfirming
      ? 'Confirmed'
      : 'Mixed'

  const confirmationClass = hasConflict
    ? 'border-red-500/40 bg-red-500/15 text-red-300'
    : technicalConfirming
      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
      : 'border-blue-500/40 bg-blue-500/15 text-blue-300'

  const confidence = clamp(Number(signal.confidence ?? 0))
  const ghostConfidence = clamp(Number(signal.ghostConfidence ?? confidence))
  const bullScore = clamp(Number(signal.bullScore ?? 50))
  const bearScore = clamp(Number(signal.bearScore ?? 50))
  const netBias = Number.isFinite(Number(signal.netBias))
    ? Math.round(Number(signal.netBias))
    : bullScore - bearScore

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">{symbol}</h2>
          <p className="text-sm text-gray-400">{timeframe} Timeframe</p>

          <p className="mt-1 text-xs text-gray-500">
            Price: {formatPrice(signal.price)}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <div
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold ${signalBg} ${signalColor}`}
          >
            <Icon size={16} />
            {signal.signal}
          </div>

          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold ${confirmationClass}`}
            title={`Technical meter: ${summary.status} • ${summary.bullCount} bull / ${summary.bearCount} bear / ${summary.neutralCount} neutral`}
          >
            {hasConflict ? <ShieldAlert size={14} /> : <Activity size={14} />}
            {confirmationLabel}
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg border border-dark-700 bg-dark-900/30 p-3 md:grid-cols-4">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Technical</p>
          <p
            className={`text-sm font-bold ${
              technicalSide === 'BULLISH'
                ? 'text-emerald-400'
                : technicalSide === 'BEARISH'
                  ? 'text-red-400'
                  : 'text-yellow-400'
            }`}
          >
            {summary.status}
          </p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Active</p>
          <p className="text-sm font-bold text-white">{summary.activeCount}</p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Bull / Bear</p>
          <p className="text-sm font-bold text-white">
            <span className="text-emerald-400">{summary.bullCount}</span>
            <span className="text-gray-500"> / </span>
            <span className="text-red-400">{summary.bearCount}</span>
          </p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Meter</p>
          <p
            className={`text-sm font-bold ${
              summary.sentiment >= 55
                ? 'text-emerald-400'
                : summary.sentiment <= 45
                  ? 'text-red-400'
                  : 'text-yellow-400'
            }`}
          >
            {summary.sentiment}%
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg bg-dark-700/70 p-4">
          <p className="mb-2 text-xs text-gray-400">Confidence</p>
          <p className="text-2xl font-bold text-emerald-400">
            {confidence}%
          </p>
        </div>

        <div className="rounded-lg bg-dark-700/70 p-4">
          <p className="mb-2 text-xs text-gray-400">Bull Score</p>
          <p className="text-2xl font-bold text-emerald-400">
            {bullScore}%
          </p>
        </div>

        <div className="rounded-lg bg-dark-700/70 p-4">
          <p className="mb-2 text-xs text-gray-400">Bear Score</p>
          <p className="text-2xl font-bold text-red-400">
            {bearScore}%
          </p>
        </div>

        <div className="rounded-lg bg-dark-700/70 p-4">
          <p className="mb-2 text-xs text-gray-400">Net Bias</p>
          <p
            className={`text-2xl font-bold ${
              netBias >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {netBias >= 0 ? '+' : ''}
            {netBias}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-blue-300">
          Ghost {ghostConfidence}%
        </span>

        {hasConflict ? (
          <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-red-300">
            Main signal conflicts with technical meter
          </span>
        ) : technicalConfirming ? (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-300">
            Technical meter confirms main signal
          </span>
        ) : (
          <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-yellow-300">
            Mixed confirmation
          </span>
        )}
      </div>
    </motion.div>
  )
}
