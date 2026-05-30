'use client'

import Link from 'next/link'
import { useState, useEffect, useMemo } from 'react'
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

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function getPythonGhostCandles(engineState: PythonEngineState | null) {
  if (!engineState) return []

  if (Array.isArray(engineState.ghostCandles)) return engineState.ghostCandles
  if (Array.isArray(engineState.ghostProjections)) return engineState.ghostProjections
  if (Array.isArray(engineState.projections)) return engineState.projections

  return []
}

function getAverageGhostConfidence(engineState: PythonEngineState | null) {
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

function getPythonGhostText(engineState: PythonEngineState | null) {
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

export default function Dashboard() {
  const [isClient, setIsClient] = useState(false)
  const [pythonEngineState, setPythonEngineState] =
    useState<PythonEngineState | null>(null)
  const [sharedTechnicalSentiment, setSharedTechnicalSentiment] =
    useState<TechnicalSentiment | null>(null)
  const [factorTechnicalSentiment, setFactorTechnicalSentiment] =
    useState<TechnicalSentiment | null>(null)

  const [mainChartSelection, setMainChartSelection] = useState<ChartSelection>({
    symbol: 'BTCUSD',
    timeframe: '1m',
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
  const FactorConfirmationTableLoose = FactorConfirmationTable as any

  useEffect(() => {
    setFactorTechnicalSentiment(null)
  }, [selectedSymbol, selectedTimeframe])

  useEffect(() => {
    if (!isClient || !apiBaseUrl) return

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchPythonEngineState() {
      try {
        const params = new URLSearchParams({
          symbol: selectedSymbol,
          timeframe: selectedTimeframe,
          limit: '500',
        })

        const response = await fetch(`${apiBaseUrl}/api/engine-state?${params.toString()}`, {
          cache: 'no-store',
        })

        if (!response.ok) return

        const json = await response.json()

        if (!cancelled) {
          setPythonEngineState(json && typeof json === 'object' ? json : null)
        }
      } catch (error) {
        console.error('Dashboard Python engine sync error:', error)
      }
    }

    fetchPythonEngineState()
    intervalId = setInterval(fetchPythonEngineState, 15000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [apiBaseUrl, isClient, selectedSymbol, selectedTimeframe])

  useEffect(() => {
    if (!isClient || !apiBaseUrl) return

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchSharedTechnicalSentiment() {
      try {
        const params = new URLSearchParams({
          symbol: selectedSymbol,
          timeframe: selectedTimeframe,
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

        if (!cancelled) {
          // Only set sharedTechnicalSentiment when the payload actually has indicator arrays.
          // Do not let simple futures sentiment override the shared technical meter.
          setSharedTechnicalSentiment(best)
        }
      } catch (error) {
        console.error('Dashboard shared technical sentiment sync error:', error)
      }
    }

    setSharedTechnicalSentiment(null)
    fetchSharedTechnicalSentiment()
    intervalId = setInterval(fetchSharedTechnicalSentiment, 10000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [apiBaseUrl, isClient, selectedSymbol, selectedTimeframe])

  const augmentedLatestSignal = useMemo(() => {
    const ghostConfidence = getAverageGhostConfidence(pythonEngineState)
    const pythonGhostText = getPythonGhostText(pythonEngineState)

    return {
      ...latestSignal,

      // Main chart is now the master symbol/timeframe source for every outside panel.
      // When the chart dropdown changes, SignalCard, Market Sentiment, Pressure Gauges,
      // Warnings, Factor Confirmation, Ghost Projections, and Recent Signals all follow it.
      symbol: selectedSymbol,
      timeframe: selectedTimeframe,

      // This syncs the Python ghost engine into the dashboard summary cards.
      // It fixes Pressure Gauges and Factor Confirmation showing Ghost Confidence as 0
      // while the Python ghost panel already shows PY confidence.
      confidence: Math.max(Number(latestSignal?.confidence ?? 0), ghostConfidence),
      ghost: pythonGhostText || latestSignal?.ghost || 'Python Ghost Projection',
      ghostConfidence,
      pythonGhostEngine: Boolean(ghostConfidence || pythonGhostText),

      // Shared 12-indicator technical meter.
      // This is the single source passed into Market Sentiment and Factor Confirmation,
      // so MES1!/ES1!/BTCUSD/ETHUSD/SPY all display the exact same technical array.
      technicalSentiment: sharedTechnicalSentiment ?? undefined,
      indicators: sharedTechnicalSentiment?.indicators,
      technicalIndicators: sharedTechnicalSentiment?.technicalIndicators,
      technicalMeter: sharedTechnicalSentiment?.technicalMeter,
      factors: sharedTechnicalSentiment?.factors,

      chartCandleMode: mainChartSelection.candleMode,
    }
  }, [latestSignal, pythonEngineState, sharedTechnicalSentiment, selectedSymbol, selectedTimeframe, mainChartSelection.candleMode])

  if (!isClient) {
    return null
  }

  const maxSignalsToShow = 25
  const visibleRecentSignals = recentSignals.slice(0, maxSignalsToShow)

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
              <Link
                href="/membership"
                className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 font-semibold text-amber-300 hover:bg-amber-400 hover:text-black"
              >
                Membership
              </Link>

              <Link
                href="/indicators"
                className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 font-semibold text-gray-300 hover:border-amber-400/50 hover:text-amber-300"
              >
                Indicators
              </Link>

              <Link
                href="/academy"
                className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 font-semibold text-gray-300 hover:border-amber-400/50 hover:text-amber-300"
              >
                Academy
              </Link>

              <Link
                href="/shop"
                className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 font-semibold text-gray-300 hover:border-amber-400/50 hover:text-amber-300"
              >
                Shop
              </Link>

              <Link
                href="/trading-room"
                className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 font-semibold text-gray-300 hover:border-amber-400/50 hover:text-amber-300"
              >
                Trading Room
              </Link>
            </div>

            <h1 className="text-4xl font-bold gradient-text">
              MARKETBOS ALGO DASHBOARD
            </h1>

            <p className="mt-2 text-sm text-gray-400">
              Real-time trading signals and analysis • {selectedSymbol} •{' '}
              {selectedTimeframe} timeframe
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
              defaultSymbol="SPY"
              defaultTimeframe="1m"
              defaultCandleMode="Heikin Ashi"
              allowCompactHistory
              latestSignal={augmentedLatestSignal}
              recentSignals={recentSignals}
              recentCandles={recentCandles}
            />

            <EChartsCandlestickChart
              heightClass="h-[390px]"
              compact
              chartTitle="Mini Chart 2"
              enableAdvancedOverlays={false}
              defaultSymbol="ES1!"
              defaultTimeframe="1m"
              defaultCandleMode="Heikin Ashi"
              allowCompactHistory
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
          />

        <GhostCandleProjection signal={augmentedLatestSignal} />
      </div>

      <RecentSignalsTable signals={visibleRecentSignals} latestSignal={augmentedLatestSignal} />

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
