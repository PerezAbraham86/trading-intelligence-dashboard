'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'

type TradingSignal = {
  symbol?: string
  timeframe?: string
  confidence?: number
  bullScore?: number
  bearScore?: number
  netBias?: number
  signal?: string
  chopRisk?: number
  macroRisk?: number
  fredMacro?: string
  session?: string
}

type PressureGaugesProps = {
  signal?: TradingSignal
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

type GaugeItem = {
  label: string
  value: number
  barClass: string
  note: string
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

function isNeutralText(value?: string) {
  const lower = String(value ?? '').toLowerCase()

  return (
    !lower ||
    lower.includes('neutral') ||
    lower.includes('waiting') ||
    lower.includes('none') ||
    lower.includes('no signal')
  )
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
  const bullishShare = activeCount > 0 ? (bullCount / activeCount) * 100 : 0
  const bearishShare = activeCount > 0 ? (bearCount / activeCount) * 100 : 0
  const neutralShare = activeCount > 0 ? (neutralCount / activeCount) * 100 : 0

  return {
    indicators,
    activeCount,
    bullCount,
    bearCount,
    neutralCount,
    sentiment,
    bullishShare,
    bearishShare,
    neutralShare,
  }
}

export default function PressureGauges({ signal }: PressureGaugesProps) {
  const [technicalSentiment, setTechnicalSentiment] =
    useState<TechnicalSentiment | null>(null)

  const symbol = normalizeSymbol(signal?.symbol)
  const timeframe = normalizeTimeframe(signal?.timeframe)

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
        console.error('Pressure gauges technical sentiment fetch error:', error)
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

  const bullPressure = clamp(
    summary.activeCount > 0
      ? Math.max(Number(signal?.bullScore ?? 50), summary.bullishShare)
      : Number(signal?.bullScore ?? 50)
  )

  const bearPressure = clamp(
    summary.activeCount > 0
      ? Math.max(Number(signal?.bearScore ?? 50), summary.bearishShare)
      : Number(signal?.bearScore ?? 50)
  )

  const ghostConfidence = clamp(Number(signal?.confidence ?? 0))
  const netBias = Number.isFinite(Number(signal?.netBias))
    ? Number(signal?.netBias)
    : bullPressure - bearPressure

  const conflictRisk = clamp(
    summary.activeCount > 0
      ? Math.abs(Number(signal?.bearScore ?? 50) - summary.bullishShare) >= 25 ||
        Math.abs(Number(signal?.bullScore ?? 50) - summary.bearishShare) >= 25
        ? 75
        : Math.abs(bullPressure - bearPressure) < 12
          ? 45
          : 15
      : 0
  )

  const chopRisk = clamp(
    Number.isFinite(Number(signal?.chopRisk))
      ? Number(signal?.chopRisk)
      : Math.max(summary.neutralShare, 50 - Math.abs(netBias))
  )

  const macroRisk = clamp(
    Number.isFinite(Number(signal?.macroRisk))
      ? Number(signal?.macroRisk)
      : isNeutralText(signal?.fredMacro)
        ? 35
        : 15
  )

  const gauges: GaugeItem[] = [
    {
      label: 'Bull Pressure',
      value: bullPressure,
      barClass: 'bg-emerald-400',
      note: `${summary.bullCount} of ${summary.activeCount || 12} technicals bullish`,
    },
    {
      label: 'Bear Pressure',
      value: bearPressure,
      barClass: 'bg-red-400',
      note: `${summary.bearCount} of ${summary.activeCount || 12} technicals bearish`,
    },
    {
      label: 'Ghost Confidence',
      value: ghostConfidence,
      barClass: 'bg-blue-400',
      note: 'Python ghost projection confidence',
    },
    {
      label: 'Technical Conflict Risk',
      value: conflictRisk,
      barClass: conflictRisk >= 60 ? 'bg-red-400' : conflictRisk >= 35 ? 'bg-yellow-400' : 'bg-emerald-400',
      note: 'Mismatch between dashboard pressure and technical meter',
    },
    {
      label: 'Chop Risk',
      value: chopRisk,
      barClass: chopRisk >= 60 ? 'bg-yellow-400' : 'bg-blue-400',
      note: `${summary.neutralCount} neutral technicals + weak net bias check`,
    },
    {
      label: 'Macro Risk',
      value: macroRisk,
      barClass: macroRisk >= 60 ? 'bg-orange-500' : 'bg-orange-400',
      note: isNeutralText(signal?.fredMacro) ? 'Macro is neutral or missing' : 'Macro confirmation available',
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Pressure Gauges</h2>
          <p className="mt-1 text-xs text-gray-500">
            Python technical meter + live dashboard pressure
          </p>
        </div>

        <div className="rounded-lg border border-dark-600 bg-dark-900/40 px-3 py-2 text-right">
          <p className="text-xs text-gray-500">Net</p>
          <p className={`text-sm font-bold ${netBias >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {netBias > 0 ? '+' : ''}
            {Math.round(netBias)}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {gauges.map((gauge) => (
          <div key={gauge.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-semibold text-gray-300">{gauge.label}</span>
              <span className="font-bold text-white">{gauge.value}%</span>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-dark-700">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${gauge.value}%` }}
                transition={{ duration: 0.35 }}
                className={`h-full rounded-full ${gauge.barClass}`}
              />
            </div>

            <p className="mt-1 text-[10px] text-gray-500">{gauge.note}</p>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
