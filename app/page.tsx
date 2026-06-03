'use client'

import { useEffect, useMemo, useState } from 'react'
import SignalCard from '@/components/SignalCard'
import EChartsCandlestickChart from '@/components/EChartsCandlestickChart'
import PressureGauges from '@/components/PressureGauges'
import FactorConfirmationTable from '@/components/FactorConfirmationTable'
import GhostCandleProjection from '@/components/GhostCandleProjection'
import WarningsPanel from '@/components/WarningsPanel'
import RecentSignalsTable from '@/components/RecentSignalsTable'
import ConnectionStatusBadge from '@/components/ConnectionStatusBadge'
import MarketSentimentGauge from '@/components/MarketSentimentGauge'
import { motion } from 'framer-motion'
import { useApiPolling } from '@/hooks/useApiPolling'

type PythonGhostCandle = {
  confidence?: number
  direction?: string
  source?: string
}

type PythonEngineState = {
  ghostCandles?: PythonGhostCandle[]
  ghostProjections?: PythonGhostCandle[]
  projections?: PythonGhostCandle[]
  ghostEngine?: {
    phase?: string
    source?: string
    count?: number
  }
  sentiment?: TechnicalSentiment
  technicalSentiment?: TechnicalSentiment
  indicators?: TechnicalIndicator[]
  technicalIndicators?: TechnicalIndicator[]
  technicalMeter?: TechnicalIndicator[]
  factors?: TechnicalIndicator[]
}

type ChartSelection = {
  symbol: string
  timeframe: string
  candleMode: 'Regular' | 'Heikin Ashi'
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
  sourceTimeframes?: string[]
  timeframeBreakdown?: Record<string, TechnicalSentiment | null>
}

function countTechnicalIndicatorsPayload(value: unknown): number {
  if (!value || typeof value !== 'object') return 0

  const data = value as {
    indicators?: unknown
    technicalIndicators?: unknown
    technicalMeter?: unknown
    factors?: unknown
    technicalSentiment?: unknown
    sentiment?: unknown
  }

  const directCount =
    (Array.isArray(data.indicators) ? data.indicators.length : 0) +
    (Array.isArray(data.technicalIndicators) ? data.technicalIndicators.length : 0) +
    (Array.isArray(data.technicalMeter) ? data.technicalMeter.length : 0) +
    (Array.isArray(data.factors) ? data.factors.length : 0)

  const nestedTechnicalCount = countTechnicalIndicatorsPayload(data.technicalSentiment)
  const nestedSentimentCount = countTechnicalIndicatorsPayload(data.sentiment)

  return Math.max(directCount, nestedTechnicalCount, nestedSentimentCount)
}

function normalizeSharedTechnicalSentimentPayload(value: unknown): TechnicalSentiment | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Record<string, unknown>
  const nestedTechnical =
    raw.technicalSentiment && typeof raw.technicalSentiment === 'object'
      ? raw.technicalSentiment as Record<string, unknown>
      : raw.sentiment && typeof raw.sentiment === 'object'
        ? raw.sentiment as Record<string, unknown>
        : null

  const candidate: TechnicalSentiment = {
    ...(nestedTechnical ?? {}),
    ...(raw as TechnicalSentiment),
    indicators: [
      ...(Array.isArray(raw.indicators) ? raw.indicators as TechnicalIndicator[] : []),
      ...(Array.isArray(raw.technicalIndicators) ? raw.technicalIndicators as TechnicalIndicator[] : []),
      ...(Array.isArray(raw.technicalMeter) ? raw.technicalMeter as TechnicalIndicator[] : []),
      ...(Array.isArray(raw.factors) ? raw.factors as TechnicalIndicator[] : []),
      ...(nestedTechnical && Array.isArray(nestedTechnical.indicators) ? nestedTechnical.indicators as TechnicalIndicator[] : []),
      ...(nestedTechnical && Array.isArray(nestedTechnical.technicalIndicators) ? nestedTechnical.technicalIndicators as TechnicalIndicator[] : []),
      ...(nestedTechnical && Array.isArray(nestedTechnical.technicalMeter) ? nestedTechnical.technicalMeter as TechnicalIndicator[] : []),
      ...(nestedTechnical && Array.isArray(nestedTechnical.factors) ? nestedTechnical.factors as TechnicalIndicator[] : []),
    ],
  }

  return countTechnicalIndicatorsPayload(candidate) > 0 ? candidate : null
}

function normalizeSymbol(value: unknown) {
  const raw = String(value ?? 'BTCUSD')
    .trim()
    .toUpperCase()
    .replace('BINANCE:', '')
    .replace('COINBASE:', '')
    .replace('CRYPTO:', '')
    .replace('CME_MINI:', '')
    .replace('CME:', '')

  if (raw === 'MES1' || raw === 'MES1!') return 'MES1!'
  if (raw.includes('MES')) return 'MES1!'
  if (raw.includes('BTC')) return 'BTCUSD'
  if (raw.includes('ETH')) return 'ETHUSD'
  if (raw.includes('SPY')) return 'SPY'

  return raw || 'BTCUSD'
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

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function extractCandleArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.candles)) return payload.candles
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.results)) return payload.results
  if (Array.isArray(payload?.series)) return payload.series
  return []
}

function extractLatestCloseFromCandlePayload(payload: any): number | null {
  const candles = extractCandleArray(payload)
  if (candles.length === 0) return null

  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index]
    const close = toFiniteNumber(candle?.close ?? candle?.c, NaN)
    if (Number.isFinite(close) && close > 0) return close
  }

  return null
}

function isSameActiveSymbol(value: unknown, activeSymbol: string) {
  return normalizeSymbol(value) === normalizeSymbol(activeSymbol)
}

function isSameActiveTimeframe(value: unknown, activeTimeframe: string) {
  const text = String(value ?? '').trim()
  if (text.includes('/')) {
    return text
      .split('/')
      .map((item) => normalizeTimeframe(item.trim()))
      .includes(normalizeTimeframe(activeTimeframe))
  }

  return normalizeTimeframe(text) === normalizeTimeframe(activeTimeframe)
}

function isPriceNearActiveScale(value: unknown, activePrice: number | null) {
  const price = toFiniteNumber(value, NaN)
  if (!Number.isFinite(price) || price <= 0) return false
  if (!activePrice || !Number.isFinite(activePrice) || activePrice <= 0) return true
  return Math.abs(price - activePrice) / activePrice <= 0.2
}

function getTechnicalIndicators(sentiment: TechnicalSentiment | null | undefined): TechnicalIndicator[] {
  if (!sentiment) return []

  return [
    ...(Array.isArray(sentiment.indicators) ? sentiment.indicators : []),
    ...(Array.isArray(sentiment.technicalIndicators) ? sentiment.technicalIndicators : []),
    ...(Array.isArray(sentiment.technicalMeter) ? sentiment.technicalMeter : []),
    ...(Array.isArray(sentiment.factors) ? sentiment.factors : []),
  ].filter((indicator) => indicator && typeof indicator.name === 'string')
}

function normalizeIndicatorSignal(signal: unknown, value: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const text = String(signal ?? '').toUpperCase()

  if (text.includes('BULL')) return 'BULLISH'
  if (text.includes('BEAR')) return 'BEARISH'
  if (text.includes('NEUTRAL')) return 'NEUTRAL'

  if (value >= 60) return 'BULLISH'
  if (value <= 40) return 'BEARISH'
  return 'NEUTRAL'
}

function buildOverallTechnicalSentiment(
  timeframeSentiments: Record<string, TechnicalSentiment | null>,
  timeframes: string[],
  symbol: string
): TechnicalSentiment | null {
  const activeEntries = timeframes
    .map((timeframe) => ({
      timeframe,
      sentiment: timeframeSentiments[timeframe] ?? null,
    }))
    .filter((entry) => getTechnicalIndicators(entry.sentiment).length > 0)

  if (activeEntries.length === 0) return null

  const grouped = new Map<
    string,
    {
      values: number[]
      bullish: number
      bearish: number
      neutral: number
      sources: string[]
    }
  >()

  for (const entry of activeEntries) {
    for (const indicator of getTechnicalIndicators(entry.sentiment)) {
      const name = String(indicator.name || '').trim()
      if (!name) continue

      const value = clampPercent(Number(indicator.value ?? 50))
      const signal = normalizeIndicatorSignal(indicator.signal, value)
      const current = grouped.get(name) ?? {
        values: [],
        bullish: 0,
        bearish: 0,
        neutral: 0,
        sources: [],
      }

      current.values.push(value)
      current.sources.push(entry.timeframe)

      if (signal === 'BULLISH') current.bullish += 1
      else if (signal === 'BEARISH') current.bearish += 1
      else current.neutral += 1

      grouped.set(name, current)
    }
  }

  const indicators: TechnicalIndicator[] = Array.from(grouped.entries()).map(([name, item]) => {
    const average =
      item.values.length > 0
        ? item.values.reduce((sum, value) => sum + value, 0) / item.values.length
        : 50

    let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'

    if (item.bullish > item.bearish && item.bullish >= item.neutral) {
      signal = 'BULLISH'
    } else if (item.bearish > item.bullish && item.bearish >= item.neutral) {
      signal = 'BEARISH'
    } else if (average >= 60) {
      signal = 'BULLISH'
    } else if (average <= 40) {
      signal = 'BEARISH'
    }

    return {
      name,
      value: clampPercent(average),
      signal,
    }
  })

  if (indicators.length === 0) return null

  const bullCount = indicators.filter((indicator) => normalizeIndicatorSignal(indicator.signal, indicator.value) === 'BULLISH').length
  const bearCount = indicators.filter((indicator) => normalizeIndicatorSignal(indicator.signal, indicator.value) === 'BEARISH').length
  const neutralCount = Math.max(0, indicators.length - bullCount - bearCount)
  const activeCount = Math.max(indicators.length, 1)
  const sentiment = clampPercent(((bullCount + neutralCount * 0.5) / activeCount) * 100)

  let sentimentStatus = 'Mixed'
  if (sentiment >= 75) sentimentStatus = 'Strong Bullish'
  else if (sentiment >= 60) sentimentStatus = 'Mostly Bullish'
  else if (sentiment <= 25) sentimentStatus = 'Strong Bearish'
  else if (sentiment <= 40) sentimentStatus = 'Mostly Bearish'

  return {
    eventType: 'MULTI_TIMEFRAME_TECHNICAL_SENTIMENT',
    symbol,
    timeframe: timeframes.join(' / '),
    sentiment,
    sentimentStatus,
    bearCount,
    neutralCount,
    bullCount,
    bearPct: Math.round((bearCount / activeCount) * 100),
    neutralPct: Math.round((neutralCount / activeCount) * 100),
    bullPct: Math.round((bullCount / activeCount) * 100),
    activeCount,
    indicators,
    technicalIndicators: indicators,
    technicalMeter: indicators,
    factors: indicators,
    sourceTimeframes: timeframes,
    timeframeBreakdown: timeframeSentiments,
  }
}

function getPythonGhostCandles(engineState: PythonEngineState | null | undefined) {
  if (!engineState) return []

  if (Array.isArray(engineState.ghostCandles)) return engineState.ghostCandles
  if (Array.isArray(engineState.ghostProjections)) return engineState.ghostProjections
  if (Array.isArray(engineState.projections)) return engineState.projections

  return []
}

function getAverageGhostConfidence(engineState: PythonEngineState | null | undefined) {
  const ghostCandles = getPythonGhostCandles(engineState)

  if (ghostCandles.length === 0) return 0

  const values = ghostCandles
    .map((ghost) => Number(ghost.confidence ?? 0))
    .filter((value) => Number.isFinite(value))

  if (values.length === 0) return 0

  return clampPercent(
    values.reduce((sum, value) => sum + value, 0) / values.length
  )
}

function getPythonGhostText(engineState: PythonEngineState | null | undefined) {
  const ghostCandles = getPythonGhostCandles(engineState)

  if (ghostCandles.length === 0) return ''

  const firstDirection = String(ghostCandles[0]?.direction ?? '').toLowerCase()

  if (
    firstDirection.includes('bull') ||
    firstDirection.includes('up') ||
    firstDirection.includes('buy')
  ) {
    return 'Python Bullish Projection'
  }

  if (
    firstDirection.includes('bear') ||
    firstDirection.includes('down') ||
    firstDirection.includes('sell')
  ) {
    return 'Python Bearish Projection'
  }

  return 'Python Neutral Projection'
}

function getOverallGhostConfidence(engineStates: Record<string, PythonEngineState | null>, timeframes: string[]) {
  const values = timeframes
    .map((timeframe) => getAverageGhostConfidence(engineStates[timeframe]))
    .filter((value) => value > 0)

  if (values.length === 0) return 0

  return clampPercent(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function getOverallGhostText(engineStates: Record<string, PythonEngineState | null>, timeframes: string[]) {
  const texts = timeframes
    .map((timeframe) => getPythonGhostText(engineStates[timeframe]))
    .filter(Boolean)

  const bullish = texts.filter((text) => text.toLowerCase().includes('bull')).length
  const bearish = texts.filter((text) => text.toLowerCase().includes('bear')).length

  if (bullish > bearish) return 'Multi-Timeframe Python Bullish Projection'
  if (bearish > bullish) return 'Multi-Timeframe Python Bearish Projection'
  if (texts.length > 0) return 'Multi-Timeframe Python Mixed Projection'
  return ''
}

export default function Dashboard() {
  const [isClient, setIsClient] = useState(false)
  const [pythonEngineState, setPythonEngineState] =
    useState<PythonEngineState | null>(null)
  const [timeframeEngineStates, setTimeframeEngineStates] =
    useState<Record<string, PythonEngineState | null>>({})
  const [sharedTechnicalSentiment, setSharedTechnicalSentiment] =
    useState<TechnicalSentiment | null>(null)
  const [timeframeTechnicalSentiments, setTimeframeTechnicalSentiments] =
    useState<Record<string, TechnicalSentiment | null>>({})
  const [factorTechnicalSentiment, setFactorTechnicalSentiment] =
    useState<TechnicalSentiment | null>(null)
  const [activeChartPrice, setActiveChartPrice] = useState<number | null>(null)

  const [mainChartSelection, setMainChartSelection] = useState<ChartSelection>({
    symbol: 'BTCUSD',
    timeframe: '1m',
    candleMode: 'Heikin Ashi',
  })

  const [miniChartOneSelection, setMiniChartOneSelection] = useState<ChartSelection>({
    symbol: 'BTCUSD',
    timeframe: '5m',
    candleMode: 'Heikin Ashi',
  })

  const [miniChartTwoSelection, setMiniChartTwoSelection] = useState<ChartSelection>({
    symbol: 'BTCUSD',
    timeframe: '15m',
    candleMode: 'Heikin Ashi',
  })

  const {
    latestSignal,
    recentSignals,
    recentCandles,
    connectionStatus,
    lastUpdateTime,
    apiBaseUrl,
  } = useApiPolling()

  useEffect(() => {
    setIsClient(true)
  }, [])

  const selectedSymbol = normalizeSymbol(mainChartSelection.symbol || latestSignal?.symbol)
  const selectedTimeframe = normalizeTimeframe(mainChartSelection.timeframe || latestSignal?.timeframe)
  const miniOneSymbol = normalizeSymbol(miniChartOneSelection.symbol || 'BTCUSD')
  const miniTwoSymbol = normalizeSymbol(miniChartTwoSelection.symbol || 'BTCUSD')
  const miniOneTimeframe = normalizeTimeframe(miniChartOneSelection.timeframe || '5m')
  const miniTwoTimeframe = normalizeTimeframe(miniChartTwoSelection.timeframe || '15m')

  const dashboardTimeframes = useMemo(
    () => Array.from(new Set([selectedTimeframe, miniOneTimeframe, miniTwoTimeframe])),
    [selectedTimeframe, miniOneTimeframe, miniTwoTimeframe]
  )

  const overallTimeframeLabel = dashboardTimeframes.join(' / ')
  const FactorConfirmationTableLoose = FactorConfirmationTable as any

  useEffect(() => {
    if (!isClient || !apiBaseUrl) return

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchActiveChartPrice() {
      try {
        const params = new URLSearchParams({
          symbol: selectedSymbol,
          timeframe: selectedTimeframe,
          limit: '5',
        })

        const response = await fetch(`${apiBaseUrl}/api/candles?${params.toString()}`, {
          cache: 'no-store',
        })

        if (!response.ok) return

        const json = await response.json()
        const latestClose = extractLatestCloseFromCandlePayload(json)

        if (!cancelled && latestClose && Number.isFinite(latestClose)) {
          setActiveChartPrice(latestClose)
        }
      } catch (error) {
        console.error('Active chart price sync error:', error)
      }
    }

    setActiveChartPrice(null)
    fetchActiveChartPrice()
    intervalId = setInterval(fetchActiveChartPrice, 10000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [apiBaseUrl, isClient, selectedSymbol, selectedTimeframe])

  useEffect(() => {
    setFactorTechnicalSentiment(null)
  }, [selectedSymbol, overallTimeframeLabel])

  useEffect(() => {
    if (!isClient || !apiBaseUrl) return

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchPythonEngineStates() {
      try {
        const entries = await Promise.all(
          dashboardTimeframes.map(async (timeframe) => {
            const params = new URLSearchParams({
              symbol: selectedSymbol,
              timeframe,
              limit: '500',
            })

            const response = await fetch(`${apiBaseUrl}/api/engine-state?${params.toString()}`, {
              cache: 'no-store',
            })

            if (!response.ok) return [timeframe, null] as const

            const json = await response.json()
            return [timeframe, json && typeof json === 'object' ? json as PythonEngineState : null] as const
          })
        )

        if (!cancelled) {
          const nextStates = Object.fromEntries(entries) as Record<string, PythonEngineState | null>
          setTimeframeEngineStates(nextStates)
          setPythonEngineState(nextStates[selectedTimeframe] ?? entries[0]?.[1] ?? null)
        }
      } catch (error) {
        console.error('Dashboard Python multi-timeframe engine sync error:', error)
      }
    }

    fetchPythonEngineStates()
    intervalId = setInterval(fetchPythonEngineStates, 15000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [apiBaseUrl, isClient, selectedSymbol, selectedTimeframe, dashboardTimeframes])

  useEffect(() => {
    if (!isClient || !apiBaseUrl) return

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchSharedTechnicalSentiments() {
      try {
        const entries = await Promise.all(
          dashboardTimeframes.map(async (timeframe) => {
            const params = new URLSearchParams({
              symbol: selectedSymbol,
              timeframe,
              limit: '500',
            })

            const [latestResponse, engineResponse] = await Promise.allSettled([
              fetch(`${apiBaseUrl}/api/latest-sentiment?${params.toString()}`, {
                cache: 'no-store',
              }),
              fetch(`${apiBaseUrl}/api/engine-state?${params.toString()}`, {
                cache: 'no-store',
              }),
            ])

            const payloads: unknown[] = []

            if (latestResponse.status === 'fulfilled' && latestResponse.value.ok) {
              payloads.push(await latestResponse.value.json())
            }

            if (engineResponse.status === 'fulfilled' && engineResponse.value.ok) {
              payloads.push(await engineResponse.value.json())
            }

            const candidates = payloads
              .map(normalizeSharedTechnicalSentimentPayload)
              .filter((item): item is TechnicalSentiment => Boolean(item))

            const best =
              candidates.length > 0
                ? candidates.reduce((currentBest, current) =>
                    countTechnicalIndicatorsPayload(current) > countTechnicalIndicatorsPayload(currentBest)
                      ? current
                      : currentBest
                  )
                : null

            return [timeframe, best] as const
          })
        )

        if (!cancelled) {
          const nextSentiments = Object.fromEntries(entries) as Record<string, TechnicalSentiment | null>
          const overall = buildOverallTechnicalSentiment(nextSentiments, dashboardTimeframes, selectedSymbol)

          setTimeframeTechnicalSentiments(nextSentiments)
          setSharedTechnicalSentiment(overall ?? nextSentiments[selectedTimeframe] ?? null)
        }
      } catch (error) {
        console.error('Dashboard shared multi-timeframe sentiment sync error:', error)
      }
    }

    setSharedTechnicalSentiment(null)
    setTimeframeTechnicalSentiments({})
    fetchSharedTechnicalSentiments()
    intervalId = setInterval(fetchSharedTechnicalSentiments, 10000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [apiBaseUrl, isClient, selectedSymbol, selectedTimeframe, dashboardTimeframes])

  const augmentedLatestSignal = useMemo(() => {
    const mainGhostConfidence = getAverageGhostConfidence(pythonEngineState)
    const overallGhostConfidence = getOverallGhostConfidence(timeframeEngineStates, dashboardTimeframes)
    const ghostConfidence = Math.max(mainGhostConfidence, overallGhostConfidence)
    const pythonGhostText =
      getOverallGhostText(timeframeEngineStates, dashboardTimeframes) ||
      getPythonGhostText(pythonEngineState)

    return {
      ...latestSignal,

      // Overall dashboard logic now uses the active chart as the master context.
      symbol: selectedSymbol,
      timeframe: overallTimeframeLabel,
      primaryTimeframe: selectedTimeframe,
      activeSymbol: selectedSymbol,
      activeTimeframe: selectedTimeframe,
      price: activeChartPrice ?? latestSignal?.price ?? latestSignal?.current ?? latestSignal?.entry,
      current: activeChartPrice ?? latestSignal?.current ?? latestSignal?.price ?? latestSignal?.entry,
      entry: isPriceNearActiveScale(latestSignal?.entry ?? latestSignal?.price, activeChartPrice)
        ? latestSignal?.entry ?? latestSignal?.price
        : activeChartPrice ?? latestSignal?.entry ?? latestSignal?.price,
      miniTimeframes: [miniOneTimeframe, miniTwoTimeframe],
      analysisTimeframes: dashboardTimeframes,
      multiTimeframeMode: true,

      // Python ghost score is now blended across main + mini timeframe engine states.
      confidence: Math.max(Number(latestSignal?.confidence ?? 0), ghostConfidence),
      ghost: pythonGhostText || latestSignal?.ghost || 'Multi-Timeframe Python Ghost Projection',
      ghostConfidence,
      pythonGhostEngine: Boolean(ghostConfidence || pythonGhostText),

      // Shared technical meter now combines main chart + mini chart logic.
      technicalSentiment: sharedTechnicalSentiment ?? undefined,
      indicators: sharedTechnicalSentiment?.indicators,
      technicalIndicators: sharedTechnicalSentiment?.technicalIndicators,
      technicalMeter: sharedTechnicalSentiment?.technicalMeter,
      factors: sharedTechnicalSentiment?.factors,
      timeframeTechnicalSentiments,
      timeframeEngineStates,

      chartCandleMode: mainChartSelection.candleMode,
      chartOverlayToggles: (latestSignal as any)?.chartOverlayToggles ?? {
        smc: true,
        ghost: true,
        liquidityProfile: true,
        orderBlocks: true,
      },
    }
  }, [
    latestSignal,
    pythonEngineState,
    timeframeEngineStates,
    dashboardTimeframes,
    sharedTechnicalSentiment,
    timeframeTechnicalSentiments,
    selectedSymbol,
    selectedTimeframe,
    miniOneTimeframe,
    miniTwoTimeframe,
    overallTimeframeLabel,
    activeChartPrice,
    mainChartSelection.candleMode,
  ])

  if (!isClient) {
    return null
  }

  const maxSignalsToShow = 25
  const visibleRecentSignals = recentSignals
    .filter((signal: any) => {
      const candidateSymbol = signal?.symbol ?? selectedSymbol
      const candidateTimeframe = signal?.primaryTimeframe ?? signal?.timeframe ?? selectedTimeframe
      const candidatePrice = signal?.current ?? signal?.price ?? signal?.entry

      return (
        isSameActiveSymbol(candidateSymbol, selectedSymbol) &&
        isSameActiveTimeframe(candidateTimeframe, selectedTimeframe) &&
        isPriceNearActiveScale(candidatePrice, activeChartPrice)
      )
    })
    .slice(0, maxSignalsToShow)

  return (
    <div className="min-h-screen bg-gradient-to-b from-dark-900 via-dark-800 to-dark-900 p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-8"
      >
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <a
                href="/membership"
                className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 font-semibold text-amber-300 hover:bg-amber-400 hover:text-black"
              >
                Membership
              </a>

              <a
                href="/indicators"
                className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 font-semibold text-gray-300 hover:border-amber-400/50 hover:text-amber-300"
              >
                Indicators
              </a>

              <a
                href="/academy"
                className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 font-semibold text-gray-300 hover:border-amber-400/50 hover:text-amber-300"
              >
                Academy
              </a>

              <a
                href="/shop"
                className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 font-semibold text-gray-300 hover:border-amber-400/50 hover:text-amber-300"
              >
                Shop
              </a>

              <a
                href="/trading-room"
                className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 font-semibold text-gray-300 hover:border-amber-400/50 hover:text-amber-300"
              >
                Trading Room
              </a>
            </div>

            <h1 className="text-4xl font-bold gradient-text">
              MARKETBOS ALGO DASHBOARD
            </h1>

            <p className="mt-2 text-sm text-gray-400">
              Real-time trading signals and analysis • {selectedSymbol} •{' '}
              overall {overallTimeframeLabel} logic
            </p>
          </div>

          <ConnectionStatusBadge
            status={connectionStatus}
            lastUpdateTime={lastUpdateTime}
          />
        </div>
      </motion.div>

      {/* Main Grid */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column */}
        <div className="space-y-6 lg:col-span-2">
          <SignalCard signal={augmentedLatestSignal} />

          <EChartsCandlestickChart
            heightClass="h-[760px]"
            enableAdvancedOverlays
            defaultSymbol={selectedSymbol}
            defaultTimeframe={selectedTimeframe}
            defaultCandleMode={mainChartSelection.candleMode}
            onChartSelectionChange={(selection) => {
              if (!selection.compact) {
                setMainChartSelection({
                  symbol: normalizeSymbol(selection.symbol),
                  timeframe: normalizeTimeframe(selection.timeframe),
                  candleMode: selection.candleMode,
                })
              }
            }}
            latestSignal={augmentedLatestSignal}
            recentSignals={recentSignals}
            recentCandles={recentCandles}
          />

          {/* Two Smaller Charts */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <EChartsCandlestickChart
              heightClass="h-[390px]"
              compact
              chartTitle="Mini Chart 1"
              enableAdvancedOverlays={false}
              defaultSymbol={miniOneSymbol}
              defaultTimeframe={miniOneTimeframe}
              defaultCandleMode={miniChartOneSelection.candleMode}
              allowCompactHistory
              onChartSelectionChange={(selection) => {
                setMiniChartOneSelection({
                  symbol: normalizeSymbol(selection.symbol || miniOneSymbol),
                  timeframe: normalizeTimeframe(selection.timeframe || miniOneTimeframe),
                  candleMode: selection.candleMode,
                })
              }}
              latestSignal={augmentedLatestSignal}
              recentSignals={recentSignals}
              recentCandles={recentCandles}
            />

            <EChartsCandlestickChart
              heightClass="h-[390px]"
              compact
              chartTitle="Mini Chart 2"
              enableAdvancedOverlays={false}
              defaultSymbol={miniTwoSymbol}
              defaultTimeframe={miniTwoTimeframe}
              defaultCandleMode={miniChartTwoSelection.candleMode}
              allowCompactHistory
              onChartSelectionChange={(selection) => {
                setMiniChartTwoSelection({
                  symbol: normalizeSymbol(selection.symbol || miniTwoSymbol),
                  timeframe: normalizeTimeframe(selection.timeframe || miniTwoTimeframe),
                  candleMode: selection.candleMode,
                })
              }}
              latestSignal={augmentedLatestSignal}
              recentSignals={recentSignals}
              recentCandles={recentCandles}
            />
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          <MarketSentimentGauge
            signal={augmentedLatestSignal as any}
            technicalSentiment={(factorTechnicalSentiment ?? sharedTechnicalSentiment) as any}
          />

          <PressureGauges signal={augmentedLatestSignal} />

          <WarningsPanel signal={augmentedLatestSignal} />
        </div>
      </div>

      {/* Second Row */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FactorConfirmationTableLoose
          signal={augmentedLatestSignal as any}
          technicalSentiment={sharedTechnicalSentiment as any}
          onTechnicalSentimentUpdate={setFactorTechnicalSentiment as any}
          activeSymbol={selectedSymbol}
          activeTimeframe={selectedTimeframe}
          activePrice={activeChartPrice ?? undefined}
        />

        <GhostCandleProjection
          signal={augmentedLatestSignal}
          activeSymbol={selectedSymbol}
          activeTimeframe={selectedTimeframe}
          activePrice={activeChartPrice ?? undefined}
        />
      </div>

      <RecentSignalsTable
        signals={visibleRecentSignals}
        latestSignal={augmentedLatestSignal}
        activeSymbol={selectedSymbol}
        activeTimeframe={selectedTimeframe}
        activePrice={activeChartPrice ?? undefined}
      />

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.6 }}
        className="mt-8 border-t border-dark-700 pt-4 text-center text-xs text-gray-500"
      >
        <p>
          Trading Intelligence Dashboard • Live API Polling Mode • Connected to{' '}
          {apiBaseUrl}
        </p>
      </motion.div>
    </div>
  )
}
