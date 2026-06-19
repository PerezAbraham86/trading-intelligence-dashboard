'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  Info,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react'
import SP500Heatmap from '@/components/SP500Heatmap'
import TickerNewsFeed from '@/components/TickerNewsFeed'
import { cachedJsonFetch } from '@/lib/frontendRequestCache'

type TradingSignal = {
  symbol?: string
  timeframe?: string
  signal?: string
  confidence?: number
  bullScore?: number
  bearScore?: number
  netBias?: number
  warnings?: string[]
  session?: string
  fredMacro?: string
  ghost?: string
  alphax?: string
  smc?: string
  ghostConfidence?: number
  smcDirection?: string
  alphaxDirection?: string
  ghostDirection?: string
  optionsFlow?: string
  optionsFlowStrength?: number
  optionsFlowDirection?: string
  optionsBullPressure?: number
  optionsBearPressure?: number
  putCallRatio?: number | null
  unusualOptionsVolume?: number
  gammaRisk?: number
  dealerPinZone?: number | null
  optionsConflictRisk?: number
  optionsReversalRisk?: number
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

type WarningsPanelProps = {
  signal?: TradingSignal
}

type WarningItem = {
  title: string
  subtitle: string
  severity: 'danger' | 'warning' | 'info' | 'success'
  icon: 'alert' | 'info' | 'bull' | 'bear' | 'zap' | 'success'
  score: number
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://trading-intelligence-dashboard.onrender.com'

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeSymbol(value: unknown) {
  const raw = String(value ?? 'MES1!')
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

  if (raw === 'MES1' || raw === 'MES1!') return 'MES1!'
  if (raw.includes('MES')) return 'MES1!'
  if (raw.includes('BTC')) return 'BTCUSD'
  if (raw.includes('ETH')) return 'ETHUSD'
  if (raw.includes('SPY')) return 'SPY'

  return raw || 'MES1!'
}

function normalizeNewsSymbol(value: unknown) {
  const symbol = normalizeSymbol(value)

  // MES tracks the S&P 500. Use SPY for stock/news APIs that do not support futures symbols.
  if (symbol === 'MES1!' || symbol.includes('MES')) return 'SPY'

  return symbol
}

function normalizeTimeframe(value: unknown) {
  const tf = String(value ?? '1m').trim().toLowerCase()

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

function getSeverityClass(severity: WarningItem['severity']) {
  if (severity === 'danger') return 'border-red-500/50 bg-red-500/15 text-red-300'
  if (severity === 'warning') return 'border-yellow-500/50 bg-yellow-500/15 text-yellow-300'
  if (severity === 'success') return 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
  return 'border-blue-500/50 bg-blue-500/15 text-blue-300'
}

function getIcon(type: WarningItem['icon']) {
  if (type === 'alert') return ShieldAlert
  if (type === 'bull') return TrendingUp
  if (type === 'bear') return TrendingDown
  if (type === 'zap') return Zap
  if (type === 'success') return CheckCircle2
  return Info
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
    if (!byName.has(key)) byName.set(key, indicator)
  }

  return Array.from(byName.values())
}

function isBearishText(value?: string) {
  const lower = String(value ?? '').toLowerCase()
  return lower.includes('bear') || lower.includes('sell') || lower.includes('down') || lower.includes('short')
}

function isBullishText(value?: string) {
  const lower = String(value ?? '').toLowerCase()
  return lower.includes('bull') || lower.includes('buy') || lower.includes('up') || lower.includes('long')
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
    indicators.filter((indicator) => String(indicator.signal).toUpperCase() === 'BULLISH').length
  const bearCount =
    data?.bearCount ??
    indicators.filter((indicator) => String(indicator.signal).toUpperCase() === 'BEARISH').length
  const neutralCount =
    data?.neutralCount ??
    indicators.filter((indicator) => String(indicator.signal).toUpperCase() === 'NEUTRAL').length
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

function buildWarnings(signal: TradingSignal | undefined, data: TechnicalSentiment | null) {
  const confidence = clamp(Number(signal?.confidence ?? 0))
  const ghostConfidence = clamp(Number(signal?.ghostConfidence ?? confidence))
  const bullScore = clamp(Number(signal?.bullScore ?? 50))
  const bearScore = clamp(Number(signal?.bearScore ?? 50))
  const netBias = Number.isFinite(Number(signal?.netBias))
    ? Number(signal?.netBias)
    : bullScore - bearScore

  const summary = technicalSummary(data)
  const customWarnings = Array.isArray(signal?.warnings) ? signal?.warnings : []
  const items: WarningItem[] = []

  customWarnings.forEach((warning) => {
    items.push({
      title: warning,
      subtitle: 'Received from live engine payload',
      severity: 'warning',
      icon: 'alert',
      score: 88,
    })
  })

  const dashboardSide = isBullishText(signal?.signal)
    ? 'bullish'
    : isBearishText(signal?.signal)
      ? 'bearish'
      : 'neutral'

  const technicalSide =
    summary.bullCount > summary.bearCount
      ? 'bullish'
      : summary.bearCount > summary.bullCount
        ? 'bearish'
        : 'neutral'

  if (confidence > 0 && confidence < 35) {
    items.push({
      title: 'Low Confidence Signal',
      subtitle: `Current confidence is ${confidence}%. Treat this as weak confirmation.`,
      severity: 'warning',
      icon: 'alert',
      score: 86,
    })
  }

  if (Math.abs(netBias) <= 5) {
    items.push({
      title: 'Very Weak Net Bias',
      subtitle: `Bull/bear pressure is nearly balanced at ${netBias > 0 ? '+' : ''}${netBias}.`,
      severity: 'info',
      icon: 'info',
      score: 72,
    })
  } else if (Math.abs(netBias) <= 12) {
    items.push({
      title: 'Weak Net Bias',
      subtitle: `Net bias is only ${netBias > 0 ? '+' : ''}${netBias}.`,
      severity: 'info',
      icon: 'info',
      score: 66,
    })
  }

  if (
    dashboardSide !== 'neutral' &&
    technicalSide !== 'neutral' &&
    dashboardSide !== technicalSide
  ) {
    items.push({
      title: 'Dashboard / Technical Conflict',
      subtitle: `Main signal is ${dashboardSide}, but technical meter is ${technicalSide}.`,
      severity: 'danger',
      icon: 'alert',
      score: 96,
    })
  }

  if (summary.activeCount >= 8 && summary.bearCount >= 8) {
    items.push({
      title: 'Heavy Bearish Technical Pressure',
      subtitle: `${summary.bearCount} of ${summary.activeCount} technical indicators are bearish.`,
      severity: 'danger',
      icon: 'bear',
      score: 92,
    })
  }

  if (summary.activeCount >= 8 && summary.bullCount >= 8) {
    items.push({
      title: 'Heavy Bullish Technical Pressure',
      subtitle: `${summary.bullCount} of ${summary.activeCount} technical indicators are bullish.`,
      severity: 'success',
      icon: 'bull',
      score: 92,
    })
  }

  if (summary.neutralCount >= 5) {
    items.push({
      title: 'Choppy Technical Conditions',
      subtitle: `${summary.neutralCount} technical indicators are neutral. Expect slower follow-through.`,
      severity: 'info',
      icon: 'info',
      score: 64,
    })
  }

  if (ghostConfidence > 0 && ghostConfidence < 20) {
    items.push({
      title: 'Weak Ghost Projection',
      subtitle: `Python ghost confidence is only ${ghostConfidence}%. Projection quality is low.`,
      severity: 'warning',
      icon: 'zap',
      score: 82,
    })
  }

  const optionsDirection = String(signal?.optionsFlowDirection ?? '').toLowerCase()
  const smcDirection = String(signal?.smcDirection ?? '').toLowerCase()
  const ghostDirection = String(signal?.ghostDirection ?? '').toLowerCase()
  const optionsConflictRisk = clamp(Number(signal?.optionsConflictRisk ?? 0))
  const optionsReversalRisk = clamp(Number(signal?.optionsReversalRisk ?? 0))
  const gammaRisk = clamp(Number(signal?.gammaRisk ?? 0))
  const putCallRatio = Number(signal?.putCallRatio ?? NaN)

  if (
    optionsDirection.includes('bear') &&
    (smcDirection.includes('bull') || ghostDirection.includes('bull'))
  ) {
    items.push({
      title: 'Options Conflict: Puts Against Bullish Setup',
      subtitle: `SMC/Ghost are bullish but options flow is bearish${Number.isFinite(putCallRatio) ? ` with put/call ${putCallRatio.toFixed(2)}` : ''}.`,
      severity: 'danger',
      icon: 'alert',
      score: 98,
    })
  }

  if (
    optionsDirection.includes('bull') &&
    (smcDirection.includes('bear') || ghostDirection.includes('bear'))
  ) {
    items.push({
      title: 'Options Conflict: Calls Against Bearish Setup',
      subtitle: `SMC/Ghost are bearish but options flow is bullish${Number.isFinite(putCallRatio) ? ` with put/call ${putCallRatio.toFixed(2)}` : ''}.`,
      severity: 'danger',
      icon: 'alert',
      score: 98,
    })
  }

  if (optionsConflictRisk >= 60) {
    items.push({
      title: 'High Options Conflict Risk',
      subtitle: `Options pressure conflict is ${optionsConflictRisk}%. Confirm direction before entry.`,
      severity: 'danger',
      icon: 'alert',
      score: 94,
    })
  }

  if (optionsReversalRisk >= 60 || gammaRisk >= 60) {
    items.push({
      title: 'Options Reversal / Gamma Risk',
      subtitle: `Reversal risk ${optionsReversalRisk}% • Gamma risk ${gammaRisk}%${signal?.dealerPinZone ? ` • Pin ${signal.dealerPinZone}` : ''}.`,
      severity: 'warning',
      icon: 'zap',
      score: 89,
    })
  }

  if (!signal?.session || isNeutralText(signal.session)) {
    items.push({
      title: 'Session Confirmation Missing',
      subtitle: 'Session filter is not giving strong directional confirmation.',
      severity: 'info',
      icon: 'info',
      score: 58,
    })
  }

  if (!signal?.fredMacro || isNeutralText(signal.fredMacro)) {
    items.push({
      title: 'Macro Neutral',
      subtitle: 'No strong macro confirmation received.',
      severity: 'info',
      icon: 'info',
      score: 48,
    })
  }

  if (items.length === 0) {
    items.push({
      title: 'No Active Warnings',
      subtitle: 'Live engine has no warning flags.',
      severity: 'success',
      icon: 'success',
      score: 10,
    })
  }

  return items.sort((a, b) => b.score - a.score).slice(0, 5)
}

export default function WarningsPanel({ signal }: WarningsPanelProps) {
  const [technicalSentiment, setTechnicalSentiment] =
    useState<TechnicalSentiment | null>(null)

  const symbol = normalizeSymbol(signal?.symbol)
  const newsSymbol = normalizeNewsSymbol(signal?.symbol)
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

        const json = await cachedJsonFetch<TechnicalSentiment | null>(
          `${API_BASE_URL}/api/latest-sentiment?${params.toString()}`,
          30000
        )

        if (!cancelled) {
          setTechnicalSentiment(json && typeof json === 'object' ? json : null)
        }
      } catch (error) {
        console.error('Warnings technical sentiment fetch error:', error)
      }
    }

    fetchTechnicalSentiment()
    intervalId = setInterval(fetchTechnicalSentiment, 10000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [symbol, timeframe])

  const warnings = useMemo(
    () => buildWarnings(signal, technicalSentiment),
    [signal, technicalSentiment]
  )

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Warnings & Alerts</h2>
            <p className="mt-1 text-xs text-gray-500">
              Ranked by live signal, Python ghost, and technical meter conflict
            </p>
          </div>

          <div className="rounded-lg border border-dark-600 bg-dark-900/40 px-3 py-2 text-right">
            <p className="text-xs text-gray-500">Alerts</p>
            <p className="text-sm font-bold text-white">{warnings.length}</p>
          </div>
        </div>

        <div className="space-y-3">
          {warnings.map((warning, index) => {
            const Icon = getIcon(warning.icon)

            return (
              <motion.div
                key={`${warning.title}-${index}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.04 * index }}
                className={`rounded-lg border p-4 ${getSeverityClass(warning.severity)}`}
              >
                <div className="flex items-start gap-3">
                  <Icon size={15} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-bold">{warning.title}</p>
                    <p className="text-xs opacity-80">{warning.subtitle}</p>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      </motion.div>

      <SP500Heatmap />

      <TickerNewsFeed symbol={newsSymbol} limit={8} />
    </>
  )
}
