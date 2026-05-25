'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react'

type TradingSignal = {
  symbol?: string
  timeframe?: string
  smc?: string
  alphax?: string
  ghost?: string
  openInterest?: string
  footprint?: string
  session?: string
  fredMacro?: string
  finraShortVolume?: string
  cot?: string
  confidence?: number
  bullScore?: number
  bearScore?: number
}

type FactorConfirmationTableProps = {
  signal?: TradingSignal
  technicalSentiment?: TechnicalSentiment | null
}

type FactorStatus = 'bullish' | 'bearish' | 'neutral' | 'active' | 'inactive'

type FactorRow = {
  factor: string
  status: FactorStatus
  strength: number
}

type TechnicalIndicator = {
  name: string
  value: number
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | string
}

type TechnicalSentiment = {
  eventType?: string
  symbol?: string
  timeframe?: string
  sentiment?: number
  sentimentStatus?: string
  bearCount?: number
  neutralCount?: number
  bullCount?: number
  bearPct?: number
  neutralPct?: number
  bullPct?: number
  activeCount?: number
  indicators?: TechnicalIndicator[]
  technicalIndicators?: TechnicalIndicator[]
  technicalMeter?: TechnicalIndicator[]
  factors?: TechnicalIndicator[]
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://trading-intelligence-dashboard.onrender.com'

const TECHNICAL_ORDER = [
  'RSI',
  'Stochastic',
  'Stoch RSI',
  'CCI',
  'Bull Bear Power',
  'Momentum',
  'Moving Average',
  'VWAP',
  'Bollinger Bands',
  'Supertrend',
  'Linear Regression',
  'Market Structure',
]

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

function isWaitingOrNeutral(value?: string) {
  const lower = String(value ?? '').toLowerCase()

  return (
    !lower ||
    lower.includes('waiting') ||
    lower.includes('neutral') ||
    lower.includes('none') ||
    lower.includes('no signal')
  )
}

function isBullishText(value?: string) {
  const lower = String(value ?? '').toLowerCase()

  return (
    lower.includes('bull') ||
    lower.includes('buy') ||
    lower.includes('up') ||
    lower.includes('long') ||
    lower.includes('positive')
  )
}

function isBearishText(value?: string) {
  const lower = String(value ?? '').toLowerCase()

  return (
    lower.includes('bear') ||
    lower.includes('sell') ||
    lower.includes('down') ||
    lower.includes('short') ||
    lower.includes('negative')
  )
}

function statusFromText(value?: string): FactorStatus {
  if (isBullishText(value)) return 'bullish'
  if (isBearishText(value)) return 'bearish'
  if (isWaitingOrNeutral(value)) return 'inactive'
  return 'active'
}

function statusFromTechnical(value?: string): FactorStatus {
  const side = String(value ?? '').toUpperCase()

  if (side === 'BULLISH') return 'bullish'
  if (side === 'BEARISH') return 'bearish'
  if (side === 'NEUTRAL') return 'neutral'

  return 'inactive'
}

function getStatusIcon(status: FactorStatus, size = 15) {
  if (status === 'bullish' || status === 'active') {
    return <CheckCircle2 size={size} className="text-emerald-400" />
  }

  if (status === 'neutral') {
    return <MinusCircle size={size} className="text-yellow-400" />
  }

  if (status === 'bearish') {
    return <XCircle size={size} className="text-red-400" />
  }

  return <XCircle size={size} className="text-red-400/80" />
}

function getBarColor(status: FactorStatus) {
  if (status === 'bullish' || status === 'active') return 'bg-emerald-400'
  if (status === 'bearish') return 'bg-red-400'
  if (status === 'neutral') return 'bg-yellow-400'
  return 'bg-dark-600'
}

function getStatusText(status: FactorStatus) {
  if (status === 'bullish') return 'Bullish'
  if (status === 'bearish') return 'Bearish'
  if (status === 'neutral') return 'Neutral'
  if (status === 'active') return 'Active'
  return 'Inactive'
}

function getStatusTextColor(status: FactorStatus) {
  if (status === 'bullish' || status === 'active') return 'text-emerald-400'
  if (status === 'bearish') return 'text-red-400'
  if (status === 'neutral') return 'text-yellow-400'
  return 'text-gray-500'
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

  const sorted: TechnicalIndicator[] = []

  for (const expectedName of TECHNICAL_ORDER) {
    const found = Array.from(byName.values()).find(
      (indicator) => indicator.name.trim().toLowerCase() === expectedName.toLowerCase()
    )

    if (found) sorted.push(found)
  }

  for (const indicator of byName.values()) {
    if (!sorted.some((item) => item.name.toLowerCase() === indicator.name.toLowerCase())) {
      sorted.push(indicator)
    }
  }

  return sorted
}

function buildCoreRows(signal?: TradingSignal): FactorRow[] {
  const confidence = clamp(Number(signal?.confidence ?? 0))
  const bullScore = clamp(Number(signal?.bullScore ?? 50))
  const bearScore = clamp(Number(signal?.bearScore ?? 50))

  const smcStatus = statusFromText(signal?.smc)
  const alphaxStatus = statusFromText(signal?.alphax)
  const ghostStatus = statusFromText(signal?.ghost)
  const sessionStatus = statusFromText(signal?.session)

  return [
    {
      factor: 'SMC Structure',
      status: smcStatus,
      strength: smcStatus === 'inactive' ? 0 : Math.max(confidence, bullScore, bearScore),
    },
    {
      factor: 'AlphaX DLM',
      status: alphaxStatus,
      strength: alphaxStatus === 'inactive' ? 0 : Math.max(bullScore, bearScore),
    },
    {
      factor: 'Python Ghost Candles',
      status: ghostStatus,
      strength: ghostStatus === 'inactive' ? 0 : confidence,
    },
    {
      factor: 'Session',
      status: sessionStatus,
      strength: sessionStatus === 'inactive' ? 0 : 85,
    },
  ]
}

function buildExternalRows(signal?: TradingSignal): FactorRow[] {
  const bullScore = clamp(Number(signal?.bullScore ?? 50))

  const rows: Array<[string, string | undefined, number]> = [
    ['Open Interest', signal?.openInterest, 65],
    ['Footprint Delta', signal?.footprint, bullScore],
    ['FRED Macro', signal?.fredMacro, 52],
    ['FINRA Short Volume', signal?.finraShortVolume, 71],
    ['COT', signal?.cot, 81],
  ]

  return rows.map(([factor, value, fallbackStrength]) => {
    const status = statusFromText(value)

    return {
      factor,
      status,
      strength: status === 'inactive' ? 0 : fallbackStrength,
    }
  })
}

function FactorRowItem({ row }: { row: FactorRow }) {
  return (
    <div className="grid grid-cols-[1fr_auto_72px] items-center gap-3 border-b border-dark-700/70 py-2.5 text-sm text-gray-300">
      <div>
        <p className="font-medium">{row.factor}</p>
        <p className={`text-[10px] font-bold uppercase ${getStatusTextColor(row.status)}`}>
          {getStatusText(row.status)}
        </p>
      </div>

      <div className="flex justify-center">{getStatusIcon(row.status)}</div>

      <div className="flex items-center justify-end gap-2">
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-dark-700">
          <div
            className={`h-full rounded-full ${getBarColor(row.status)}`}
            style={{ width: `${row.strength}%` }}
          />
        </div>

        <span className="w-8 text-right font-bold text-white">{row.strength}%</span>
      </div>
    </div>
  )
}

function TechnicalChip({ indicator }: { indicator: TechnicalIndicator }) {
  const status = statusFromTechnical(indicator.signal)
  const strength = clamp(Number(indicator.value ?? 0))

  return (
    <div className="rounded-lg border border-dark-700/80 bg-dark-900/35 px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold text-gray-300">{indicator.name}</p>
        {getStatusIcon(status, 13)}
      </div>

      <div className="mb-1 flex items-center justify-between gap-2">
        <p className={`text-[10px] font-bold uppercase ${getStatusTextColor(status)}`}>
          {getStatusText(status)}
        </p>
        <p className="text-xs font-bold text-white">{strength}%</p>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-dark-700">
        <div
          className={`h-full rounded-full ${getBarColor(status)}`}
          style={{ width: `${strength}%` }}
        />
      </div>
    </div>
  )
}

export default function FactorConfirmationTable({
  signal,
  technicalSentiment: technicalSentimentOverride,
}: FactorConfirmationTableProps) {
  const [fetchedTechnicalSentiment, setFetchedTechnicalSentiment] =
    useState<TechnicalSentiment | null>(null)

  const symbol = normalizeSymbol(signal?.symbol)
  const timeframe = normalizeTimeframe(signal?.timeframe)
  const bullScore = clamp(Number(signal?.bullScore ?? 50))
  const bearScore = clamp(Number(signal?.bearScore ?? 50))
  const technicalSentiment = technicalSentimentOverride ?? fetchedTechnicalSentiment

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchTechnicalSentiment() {
      if (technicalSentimentOverride) return

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
          setFetchedTechnicalSentiment(json && typeof json === 'object' ? json : null)
        }
      } catch (error) {
        console.error('Factor confirmation technical sentiment fetch error:', error)
      }
    }

    fetchTechnicalSentiment()
    intervalId = setInterval(fetchTechnicalSentiment, 10000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [symbol, timeframe, technicalSentimentOverride])

  const coreRows = useMemo(() => buildCoreRows(signal), [signal])
  const externalRows = useMemo(() => buildExternalRows(signal), [signal])
  const technicalIndicators = useMemo(
    () => extractTechnicalIndicators(technicalSentiment),
    [technicalSentiment]
  )

  const activeTechnicalCount =
    technicalSentiment?.activeCount ?? technicalIndicators.length
  const bullTechnicalCount =
    technicalSentiment?.bullCount ??
    technicalIndicators.filter((indicator) => statusFromTechnical(indicator.signal) === 'bullish').length
  const bearTechnicalCount =
    technicalSentiment?.bearCount ??
    technicalIndicators.filter((indicator) => statusFromTechnical(indicator.signal) === 'bearish').length
  const neutralTechnicalCount =
    technicalSentiment?.neutralCount ??
    technicalIndicators.filter((indicator) => statusFromTechnical(indicator.signal) === 'neutral').length
  const technicalValue = clamp(Number(technicalSentiment?.sentiment ?? 50))

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Factor Confirmation</h2>
          <p className="mt-1 text-xs text-gray-500">
            Core + full Python technical meter + external datasets
          </p>
        </div>

        <div className="rounded-lg border border-dark-600 bg-dark-900/40 px-3 py-2 text-right">
          <p className="text-xs text-gray-500">Technical</p>
          <p className="text-lg font-bold text-white">{technicalValue}%</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-2 text-center text-xs">
        <div className="rounded-lg bg-dark-900/40 p-2">
          <p className="text-gray-500">Active</p>
          <p className="font-bold text-white">{activeTechnicalCount}</p>
        </div>

        <div className="rounded-lg bg-dark-900/40 p-2">
          <p className="text-red-400">Bear</p>
          <p className="font-bold text-white">{bearTechnicalCount}</p>
        </div>

        <div className="rounded-lg bg-dark-900/40 p-2">
          <p className="text-yellow-400">Neutral</p>
          <p className="font-bold text-white">{neutralTechnicalCount}</p>
        </div>

        <div className="rounded-lg bg-dark-900/40 p-2">
          <p className="text-emerald-400">Bull</p>
          <p className="font-bold text-white">{bullTechnicalCount}</p>
        </div>
      </div>

      <div className="space-y-5">
        <section>
          <div className="mb-2 border-b border-dark-700 pb-2">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Core</p>
          </div>

          <div>
            {coreRows.map((row) => (
              <FactorRowItem key={`core-${row.factor}`} row={row} />
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between border-b border-dark-700 pb-2">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
              Technical Meter
            </p>

            <p className="text-xs text-gray-500">
              {technicalIndicators.length} indicators
            </p>
          </div>

          {technicalIndicators.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {technicalIndicators.map((indicator) => (
                <TechnicalChip key={`technical-${indicator.name}`} indicator={indicator} />
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dark-700/80 bg-dark-900/30 p-3 text-xs text-gray-500">
              Waiting for technical meter data...
            </p>
          )}
        </section>

        <section>
          <div className="mb-2 border-b border-dark-700 pb-2">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
              External Data
            </p>
          </div>

          <div>
            {externalRows.map((row) => (
              <FactorRowItem key={`external-${row.factor}`} row={row} />
            ))}
          </div>
        </section>
      </div>

      <div className="mt-4 border-t border-dark-700 pt-3 text-xs text-gray-500">
        Bull/Bear balance: {bullScore}% / {bearScore}% • Technical sentiment:{' '}
        {technicalSentiment?.sentimentStatus ?? 'Waiting'}
      </div>
    </motion.div>
  )
}
