'use client'

import { useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, XCircle } from 'lucide-react'

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

type FactorConfirmationTableProps = {
  signal?: TradingSignal
  technicalSentiment?: TechnicalSentiment | null
  onTechnicalSentimentUpdate?: (sentiment: TechnicalSentiment | null) => void
}

type FactorStatus = 'bullish' | 'bearish' | 'active' | 'inactive'

type FactorRow = {
  factor: string
  status: FactorStatus
  strength: number
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
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

function getStatusIcon(status: FactorStatus, size = 15) {
  if (status === 'bullish' || status === 'active') {
    return <CheckCircle2 size={size} className="text-emerald-400" />
  }

  if (status === 'bearish') {
    return <XCircle size={size} className="text-red-400" />
  }

  return <XCircle size={size} className="text-red-400/80" />
}

function getBarColor(status: FactorStatus) {
  if (status === 'bullish' || status === 'active') return 'bg-emerald-400'
  if (status === 'bearish') return 'bg-red-400'
  return 'bg-dark-600'
}

function getStatusText(status: FactorStatus) {
  if (status === 'bullish') return 'Bullish'
  if (status === 'bearish') return 'Bearish'
  if (status === 'active') return 'Active'
  return 'Inactive'
}

function getStatusTextColor(status: FactorStatus) {
  if (status === 'bullish' || status === 'active') return 'text-emerald-400'
  if (status === 'bearish') return 'text-red-400'
  return 'text-gray-500'
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

export default function FactorConfirmationTable({
  signal,
  onTechnicalSentimentUpdate,
}: FactorConfirmationTableProps) {
  const bullScore = clamp(Number(signal?.bullScore ?? 50))
  const bearScore = clamp(Number(signal?.bearScore ?? 50))

  const coreRows = useMemo(() => buildCoreRows(signal), [signal])
  const externalRows = useMemo(() => buildExternalRows(signal), [signal])

  const activeCoreCount = coreRows.filter((row) => row.status !== 'inactive').length
  const bullCoreCount = coreRows.filter((row) => row.status === 'bullish' || row.status === 'active').length
  const bearCoreCount = coreRows.filter((row) => row.status === 'bearish').length

  // The 12-indicator technical meter now belongs ONLY under Market Sentiment.
  // Clear the shared technical state so app/page.tsx does not duplicate it here.
  useEffect(() => {
    onTechnicalSentimentUpdate?.(null)
  }, [onTechnicalSentimentUpdate])

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
            Core Python factors + external datasets
          </p>
        </div>

        <div className="rounded-lg border border-dark-600 bg-dark-900/40 px-3 py-2 text-right">
          <p className="text-xs text-gray-500">Core</p>
          <p className="text-lg font-bold text-white">{activeCoreCount}</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-dark-900/40 p-2">
          <p className="text-gray-500">Active</p>
          <p className="font-bold text-white">{activeCoreCount}</p>
        </div>

        <div className="rounded-lg bg-dark-900/40 p-2">
          <p className="text-red-400">Bear</p>
          <p className="font-bold text-white">{bearCoreCount}</p>
        </div>

        <div className="rounded-lg bg-dark-900/40 p-2">
          <p className="text-emerald-400">Bull</p>
          <p className="font-bold text-white">{bullCoreCount}</p>
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
        Bull/Bear balance: {bullScore}% / {bearScore}% • Technical meter shown only under Market Sentiment
      </div>
    </motion.div>
  )
}
