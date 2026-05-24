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
}

type FactorRow = {
  factor: string
  status: 'bullish' | 'bearish' | 'neutral' | 'active' | 'inactive'
  strength: number
  section: 'Core' | 'Technical Meter' | 'External Data'
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
  activeCount?: number
  indicators?: TechnicalIndicator[]
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
    .replace('BINANCE:', '')
    .replace('COINBASE:', '')
    .replace('CRYPTO:', '')
    .replace('CME_MINI:', '')
    .replace('CME:', '')
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

function statusFromText(value?: string): FactorRow['status'] {
  if (isBullishText(value)) return 'bullish'
  if (isBearishText(value)) return 'bearish'
  if (isWaitingOrNeutral(value)) return 'inactive'
  return 'active'
}

function statusFromTechnical(value?: string): FactorRow['status'] {
  const side = String(value ?? '').toUpperCase()

  if (side === 'BULLISH') return 'bullish'
  if (side === 'BEARISH') return 'bearish'
  if (side === 'NEUTRAL') return 'neutral'

  return 'inactive'
}

function getStatusIcon(status: FactorRow['status']) {
  if (status === 'bullish' || status === 'active') {
    return <CheckCircle2 size={16} className="text-emerald-400" />
  }

  if (status === 'neutral') {
    return <MinusCircle size={16} className="text-yellow-400" />
  }

  if (status === 'bearish') {
    return <XCircle size={16} className="text-red-400" />
  }

  return <XCircle size={16} className="text-red-400/80" />
}

function getBarColor(status: FactorRow['status']) {
  if (status === 'bullish' || status === 'active') return 'bg-emerald-400'
  if (status === 'bearish') return 'bg-red-400'
  if (status === 'neutral') return 'bg-yellow-400'
  return 'bg-dark-600'
}

function getStatusText(status: FactorRow['status']) {
  if (status === 'bullish') return 'Bullish'
  if (status === 'bearish') return 'Bearish'
  if (status === 'neutral') return 'Neutral'
  if (status === 'active') return 'Active'
  return 'Inactive'
}

function getStatusTextColor(status: FactorRow['status']) {
  if (status === 'bullish' || status === 'active') return 'text-emerald-400'
  if (status === 'bearish') return 'text-red-400'
  if (status === 'neutral') return 'text-yellow-400'
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
      section: 'Core',
    },
    {
      factor: 'AlphaX DLM',
      status: alphaxStatus,
      strength: alphaxStatus === 'inactive' ? 0 : Math.max(bullScore, bearScore),
      section: 'Core',
    },
    {
      factor: 'Python Ghost Candles',
      status: ghostStatus,
      strength: ghostStatus === 'inactive' ? 0 : confidence,
      section: 'Core',
    },
    {
      factor: 'Session',
      status: sessionStatus,
      strength: sessionStatus === 'inactive' ? 0 : 85,
      section: 'Core',
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
      section: 'External Data',
    }
  })
}

export default function FactorConfirmationTable({
  signal,
}: FactorConfirmationTableProps) {
  const [technicalSentiment, setTechnicalSentiment] =
    useState<TechnicalSentiment | null>(null)

  const symbol = normalizeSymbol(signal?.symbol)
  const timeframe = normalizeTimeframe(signal?.timeframe)
  const bullScore = clamp(Number(signal?.bullScore ?? 50))
  const bearScore = clamp(Number(signal?.bearScore ?? 50))

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
        console.error('Factor confirmation technical sentiment fetch error:', error)
      }
    }

    fetchTechnicalSentiment()
    intervalId = setInterval(fetchTechnicalSentiment, 15000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [symbol, timeframe])

  const rows = useMemo(() => {
    const coreRows = buildCoreRows(signal)

    const technicalRows: FactorRow[] = Array.isArray(technicalSentiment?.indicators)
      ? technicalSentiment.indicators.map((indicator) => ({
          factor: indicator.name,
          status: statusFromTechnical(indicator.signal),
          strength: clamp(Number(indicator.value ?? 0)),
          section: 'Technical Meter',
        }))
      : []

    const externalRows = buildExternalRows(signal)

    return [...coreRows, ...technicalRows, ...externalRows]
  }, [signal, technicalSentiment])

  const groupedRows = useMemo(() => {
    return rows.reduce<Record<FactorRow['section'], FactorRow[]>>(
      (accumulator, row) => {
        accumulator[row.section].push(row)
        return accumulator
      },
      {
        Core: [],
        'Technical Meter': [],
        'External Data': [],
      }
    )
  }, [rows])

  const activeTechnicalCount = technicalSentiment?.activeCount ?? groupedRows['Technical Meter'].length
  const bullTechnicalCount = technicalSentiment?.bullCount ?? 0
  const bearTechnicalCount = technicalSentiment?.bearCount ?? 0
  const neutralTechnicalCount = technicalSentiment?.neutralCount ?? 0
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
            Core + Python technical meter + external datasets
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

      <div className="max-h-[520px] overflow-y-auto pr-1">
        {(['Core', 'Technical Meter', 'External Data'] as const).map((section) => (
          <div key={section} className="mb-4 last:mb-0">
            <div className="sticky top-0 z-10 border-b border-dark-700 bg-dark-800/95 py-2">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
                {section}
              </p>
            </div>

            <table className="w-full text-sm">
              <tbody>
                {groupedRows[section].map((row, index) => (
                  <motion.tr
                    key={`${section}-${row.factor}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.025 * index }}
                    className="border-b border-dark-700/70 text-gray-300"
                  >
                    <td className="py-3 pr-4">
                      <div>
                        <p className="font-medium">{row.factor}</p>
                        <p className={`text-[10px] font-bold uppercase ${getStatusTextColor(row.status)}`}>
                          {getStatusText(row.status)}
                        </p>
                      </div>
                    </td>

                    <td className="py-3 pr-4">
                      <div className="flex justify-center">
                        {getStatusIcon(row.status)}
                      </div>
                    </td>

                    <td className="py-3 pr-1">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-dark-700">
                          <div
                            className={`h-full rounded-full ${getBarColor(row.status)}`}
                            style={{ width: `${row.strength}%` }}
                          />
                        </div>

                        <span className="w-10 text-right font-bold text-white">
                          {row.strength}%
                        </span>
                      </div>
                    </td>
                  </motion.tr>
                ))}

                {groupedRows[section].length === 0 && (
                  <tr>
                    <td className="py-3 text-xs text-gray-500" colSpan={3}>
                      Waiting for {section.toLowerCase()} data...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-dark-700 pt-3 text-xs text-gray-500">
        Bull/Bear balance: {bullScore}% / {bearScore}% • Technical sentiment:{' '}
        {technicalSentiment?.sentimentStatus ?? 'Waiting'}
      </div>
    </motion.div>
  )
}
