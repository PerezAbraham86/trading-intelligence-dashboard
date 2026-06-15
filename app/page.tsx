'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import SignalCard from '@/components/SignalCard'
import LightweightCandlestickChart, { ChartMode, DashboardCandle, NrtrOverlayMode } from '@/components/LightweightCandlestickChart'
import { GhostCandle } from '@/components/GhostCandleOverlay'
import ChartOverlayStatusPanel from '@/components/ChartOverlayStatusPanel'
import ScorecardsPanel from '@/components/ScorecardsPanel'
import { buildChartOverlayPayload } from '@/lib/chartOverlayPrep'
import PressureGauges from '@/components/PressureGauges'
import FactorConfirmationTable from '@/components/FactorConfirmationTable'
import GhostCandleProjection from '@/components/GhostCandleProjection'
import WarningsPanel from '@/components/WarningsPanel'
import RecentSignalsTable from '@/components/RecentSignalsTable'
import StrategyTesterPanel from '@/components/StrategyTesterPanel'
import ConnectionStatusBadge from '@/components/ConnectionStatusBadge'
import MarketSentimentGauge from '@/components/MarketSentimentGauge'
import UnifiedIntelligenceMatrix from '@/components/UnifiedIntelligenceMatrix'
import AiTraderPanel from '@/components/AiTraderPanel'
import AiBrainContextPanel from '@/components/AiBrainContextPanel'
import { motion } from 'framer-motion'
import { useApiPolling } from '@/hooks/useApiPolling'

type ChartStrategySettings = {
  smmaLength: number
  nrtrMode: 'ATR-Based' | 'Percentage' | 'Off'
  nrtrAtrLength: number
  nrtrAtrMultiplier: number
  nrtrPercent: number
  showNrtrExitLabels: boolean
}

type PythonGhostCandle = {
  time?: unknown
  timestamp?: unknown
  t?: unknown
  open?: unknown
  high?: unknown
  low?: unknown
  close?: unknown
  o?: unknown
  h?: unknown
  l?: unknown
  c?: unknown
  confidence?: number
  baseConfidence?: number
  direction?: string
  source?: string
  label?: string
  reason?: string

  // Target ML fields passed from api/main.py + api/target_ml.py.
  targetMlAligned?: boolean
  targetPrice?: number
  targetSource?: string
  targetConfidence?: number
  targetMlReady?: boolean
  ghostConfidenceBoost?: number

  // Ghost ML metadata.
  mlAdjusted?: boolean
  mlReady?: boolean
  mlReason?: string
  mlConfidenceMultiplier?: number
  mlConfidenceBonus?: number
  mlProjectionMultiplier?: number
  mlHierarchy?: string
  nrtrUsedForMl?: number
  smmaUsedForMl?: number
}

type PythonEngineState = {
  overlayPayload?: unknown
  chartOverlays?: unknown
  chart_overlays?: unknown
  overlays?: unknown
  lines?: unknown[]
  zones?: unknown[]
  markers?: unknown[]
  smcEvents?: unknown[]
  orderBlocks?: unknown[]
  liquidityEvents?: unknown[]
  liquidityProfileBins?: unknown[]
  dlmLevels?: unknown[]
  scorecards?: unknown
  mlFeatures?: unknown
  mlFeatureContext?: unknown
  calculationContext?: unknown
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

type ProjectionEngineState = {
  eventType?: string
  status?: string
  symbol?: string
  timeframe?: string
  projectionId?: string
  createdAt?: string

  marketState?: any
  target?: any
  ghostPath?: any
  alignment?: any
  mode?: any
  learning?: any

  currentPrice?: number
  activeTargetPrice?: number | null
  activeTargetSource?: string
  activeTargetType?: string
  activeTargetConfidence?: number | null

  targetPrice?: number | null
  finalTargetPrice?: number | null
  ghostOverlayTargetPrice?: number | null
  targetConfidence?: number | null
  ghostConfidence?: number | null
  projectionMode?: string
  projectionModeLabel?: string
  aiPermission?: string

  ghostCandles?: PythonGhostCandle[]
  ghosts?: PythonGhostCandle[]
  targetMl?: any
  targetPlan?: any
}

type ChartSelection = {
  symbol: string
  timeframe: string
  candleMode: 'Regular' | 'Heikin Ashi'
}

type LiveFeedSnapshot = {
  symbol: string
  price: number
  bid?: number | null
  ask?: number | null
  last?: number | null
  source?: string
  updatedAt: number
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


function getSafeDashboardStatus({
  error,
  updatedAt,
  signal,
  candlesCount,
}: {
  error?: string | null
  updatedAt?: string | null
  signal?: any
  candlesCount?: number
}) {
  const hasCoreData =
    Boolean(signal && typeof signal === "object") ||
    Boolean(updatedAt) ||
    Number(candlesCount ?? 0) > 0

  if (hasCoreData) {
    return {
      status: "Live",
      label: updatedAt ? new Date(updatedAt).toLocaleTimeString() : "Updated",
      hasError: false,
      error: null,
    }
  }

  if (error) {
    return {
      status: "Error",
      label: "No update yet",
      hasError: true,
      error,
    }
  }

  return {
    status: "Loading",
    label: "Waiting",
    hasError: false,
    error: null,
  }
}

function normalizeSymbol(value: unknown) {
  const raw = String(value ?? 'MES1!')
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

  return raw || 'MES1!'
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


function isCryptoCandleSymbol(symbol: string) {
  const normalized = normalizeSymbol(symbol)
  return normalized === 'BTCUSD' || normalized === 'ETHUSD'
}

function isFuturesCandleSymbol(symbol: string) {
  const normalized = normalizeSymbol(symbol)
  return normalized === 'MES1!'
}

function isInsightSentryDirectHistoricalTimeframe(timeframe: string) {
  return ['1m', '5m', '10m', '15m', '30m'].includes(normalizeTimeframe(timeframe))
}

function getHistoricalCandleRouteForSymbol(apiBaseUrl: string, symbol: string) {
  const normalized = normalizeSymbol(symbol)

  // MES/futures historical candles must use the verified InsightSentry history
  // endpoint. The dashboard /api/candles router can return live price without a
  // full historical OHLCV set when MES cache is rejected, which creates a blank
  // chart with only a live vertical candle. Keep MES history on the route that
  // already returns the real candle series, then let the frontend merge guard
  // prevent stale history from being stitched to far-away live quotes.
  if (isFuturesCandleSymbol(normalized)) {
    return {
      route: `${apiBaseUrl}/api/insightsentry/history`,
      provider: 'insightsentry',
      source: 'insightsentry_v3_historical_ohlcv',
    }
  }

  // BTCUSD / ETHUSD / SPY should keep the original backend candle router.
  // api/main.py routes crypto through Alpaca crypto and SPY through Alpaca stock.
  // This prevents BTCUSD from being incorrectly treated as an InsightSentry futures symbol.
  return {
    route: `${apiBaseUrl}/api/candles`,
    provider: isCryptoCandleSymbol(normalized) ? 'alpaca_crypto' : 'dashboard_candles',
    source: isCryptoCandleSymbol(normalized) ? 'alpaca_crypto_historical_ohlcv' : 'dashboard_candle_router',
  }
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
    .map((timeframe: string) => ({
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
        ? item.values.reduce((sum: number, value: number) => sum + value, 0) / item.values.length
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

function isGhostCandleArray(value: unknown): value is PythonGhostCandle[] {
  return Array.isArray(value) && value.length > 0
}

function getPythonGhostCandles(engineState: PythonEngineState | ProjectionEngineState | null | undefined) {
  if (!engineState) return []

  const raw = engineState as any

  const candidates = [
    raw.ghostPath?.candles,
    raw.ghostPath?.ghostCandles,
    raw.ghostProjection?.candles,
    raw.ghostProjection?.ghostCandles,
    raw.projectionEngine?.ghostPath?.candles,
    raw.projectionEngine?.ghostPath?.ghostCandles,
    raw.projectionEngine?.ghostProjection?.candles,
    raw.projectionEngine?.ghostProjection?.ghostCandles,
    raw.projectionEngine?.ghostCandles,
    raw.projectionEngine?.ghosts,
    raw.projectionEngine?.ghostProjections,
    raw.projectionEngine?.projections,
    raw.unifiedProjectionEngine?.ghostPath?.candles,
    raw.unifiedProjectionEngine?.ghostPath?.ghostCandles,
    raw.unifiedProjectionEngine?.ghostProjection?.candles,
    raw.unifiedProjectionEngine?.ghostProjection?.ghostCandles,
    raw.unifiedProjectionEngine?.ghostCandles,
    raw.unifiedProjectionEngine?.ghosts,
    raw.unifiedProjectionEngine?.ghostProjections,
    raw.unifiedProjectionEngine?.projections,
    raw.ghostCandles,
    raw.ghosts,
    raw.ghostProjections,
    raw.projections,
  ]

  for (const candidate of candidates) {
    if (isGhostCandleArray(candidate)) return candidate
  }

  return []
}

function getAverageGhostConfidence(engineState: PythonEngineState | null | undefined) {
  const ghostCandles = getPythonGhostCandles(engineState)

  if (ghostCandles.length === 0) return 0

  const values = ghostCandles
    .map((ghost: any) => Number(ghost.confidence ?? 0))
    .filter((value: number) => Number.isFinite(value))

  if (values.length === 0) return 0

  return clampPercent(
    values.reduce((sum: number, value: number) => sum + value, 0) / values.length
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
    .map((timeframe: string) => getAverageGhostConfidence(engineStates[timeframe]))
    .filter((value) => value > 0)

  if (values.length === 0) return 0

  return clampPercent(values.reduce((sum: number, value: number) => sum + value, 0) / values.length)
}

function getOverallGhostText(engineStates: Record<string, PythonEngineState | null>, timeframes: string[]) {
  const texts = timeframes
    .map((timeframe: string) => getPythonGhostText(engineStates[timeframe]))
    .filter(Boolean)

  const bullish = texts.filter((text: string) => text.toLowerCase().includes('bull')).length
  const bearish = texts.filter((text: string) => text.toLowerCase().includes('bear')).length

  if (bullish > bearish) return 'Multi-Timeframe Python Bullish Projection'
  if (bearish > bullish) return 'Multi-Timeframe Python Bearish Projection'
  if (texts.length > 0) return 'Multi-Timeframe Python Mixed Projection'
  return ''
}


type CandleModeLabel = 'Regular' | 'Heikin Ashi'

const chartSymbols = ['MES1!', 'BTCUSD', 'ETHUSD', 'SPY']
const chartTimeframes = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '1d']

const DASHBOARD_API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://trading-intelligence-dashboard.onrender.com'

const CHART_SETTINGS_USER_KEY = 'abraham-marketbos-dashboard'

type ChartConfigKey = 'main' | 'mini1' | 'mini2'

type SavedChartConfig = {
  selection: ChartSelection
  settings: ChartStrategySettings
  savedAt: string
  source?: 'backend' | 'local'
}

const chartConfigStorageKeys: Record<ChartConfigKey, string> = {
  main: 'marketbos:chart-config:main',
  mini1: 'marketbos:chart-config:mini1',
  mini2: 'marketbos:chart-config:mini2',
}

function normalizeChartSettings(value: unknown): ChartStrategySettings | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Partial<ChartStrategySettings>

  return {
    smmaLength: Math.max(1, Math.floor(Number(raw.smmaLength ?? 20) || 20)),
    nrtrMode: raw.nrtrMode === 'Percentage' || raw.nrtrMode === 'Off' ? raw.nrtrMode : 'ATR-Based',
    nrtrAtrLength: Math.max(1, Math.floor(Number(raw.nrtrAtrLength ?? 14) || 14)),
    nrtrAtrMultiplier: Math.max(0.1, Number(raw.nrtrAtrMultiplier ?? 1) || 1),
    nrtrPercent: Math.max(0.01, Number(raw.nrtrPercent ?? 0.25) || 0.25),
    showNrtrExitLabels: raw.showNrtrExitLabels !== false,
  }
}

function normalizeChartSelectionPayload(value: unknown): ChartSelection | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Partial<ChartSelection>

  return {
    symbol: normalizeSymbol(raw.symbol),
    timeframe: normalizeTimeframe(raw.timeframe),
    candleMode: raw.candleMode === 'Regular' ? 'Regular' : 'Heikin Ashi',
  }
}

function normalizeSavedChartConfigPayload(value: unknown): SavedChartConfig | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as any
  const payload = raw.settings && typeof raw.settings === 'object' && raw.selection
    ? raw
    : raw.settings && typeof raw.settings === 'object' && raw.settings.selection
      ? raw.settings
      : raw

  const selection = normalizeChartSelectionPayload(payload?.selection)
  const settings = normalizeChartSettings(payload?.settings)

  if (!selection || !settings) return null

  return {
    selection,
    settings,
    savedAt: typeof payload?.savedAt === 'string'
      ? payload.savedAt
      : typeof raw?.updatedAt === 'string'
        ? raw.updatedAt
        : new Date().toISOString(),
  }
}

function buildChartConfigPayload(selection: ChartSelection, settings: ChartStrategySettings) {
  return {
    selection: normalizeChartSelectionPayload(selection) ?? selection,
    settings: normalizeChartSettings(settings) ?? settings,
    savedAt: new Date().toISOString(),
  }
}

function readSavedChartConfig(key: ChartConfigKey): SavedChartConfig | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(chartConfigStorageKeys[key])
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const normalized = normalizeSavedChartConfigPayload(parsed)
    if (!normalized) return null

    return {
      ...normalized,
      source: 'local',
    }
  } catch (error) {
    console.error('Unable to read saved chart config:', error)
    return null
  }
}

function writeSavedChartConfig(key: ChartConfigKey, selection: ChartSelection, settings: ChartStrategySettings) {
  if (typeof window === 'undefined') return false

  try {
    window.localStorage.setItem(
      chartConfigStorageKeys[key],
      JSON.stringify(buildChartConfigPayload(selection, settings))
    )
    return true
  } catch (error) {
    console.error('Unable to save chart config:', error)
    return false
  }
}

async function fetchBackendChartConfigs(): Promise<Partial<Record<ChartConfigKey, SavedChartConfig>>> {
  const response = await fetch(
    `${DASHBOARD_API_BASE_URL}/api/chart-settings?userKey=${encodeURIComponent(CHART_SETTINGS_USER_KEY)}`,
    { cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error(`Chart settings request failed: ${response.status}`)
  }

  const payload = await response.json()
  const charts = payload?.charts && typeof payload.charts === 'object' ? payload.charts : {}
  const result: Partial<Record<ChartConfigKey, SavedChartConfig>> = {}

  ;(['main', 'mini1', 'mini2'] as ChartConfigKey[]).forEach((key) => {
    const normalized = normalizeSavedChartConfigPayload(charts[key])
    if (normalized) {
      result[key] = {
        ...normalized,
        source: 'backend',
      }
    }
  })

  return result
}

async function saveBackendChartConfig(
  key: ChartConfigKey,
  selection: ChartSelection,
  settings: ChartStrategySettings
) {
  const payload = buildChartConfigPayload(selection, settings)

  const response = await fetch(`${DASHBOARD_API_BASE_URL}/api/chart-settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userKey: CHART_SETTINGS_USER_KEY,
      chartKey: key,
      settings: payload,
    }),
  })

  if (!response.ok) {
    throw new Error(`Chart settings save failed: ${response.status}`)
  }

  return response.json()
}

function DashboardWaitingCard({
  title,
  message,
}: {
  title: string
  message: string
}) {
  return (
    <div className="rounded-2xl border border-dark-700 bg-dark-800/80 p-5 shadow-lg">
      <div className="text-sm font-semibold text-amber-300">{title}</div>
      <div className="mt-2 text-xs text-gray-400">{message}</div>
    </div>
  )
}

function candleModeToLightweightMode(mode: CandleModeLabel): ChartMode {
  return mode === 'Heikin Ashi' ? 'heikinAshi' : 'regular'
}

function normalizeCandleTime(value: unknown): DashboardCandle['time'] {
  if (typeof value === 'number') {
    // Lightweight Charts expects Unix seconds, not milliseconds.
    const unixSeconds = value > 10_000_000_000 ? Math.floor(value / 1000) : value
    return unixSeconds as DashboardCandle['time']
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()

    if (/^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed)
      const unixSeconds = parsed > 10_000_000_000 ? Math.floor(parsed / 1000) : parsed
      return unixSeconds as DashboardCandle['time']
    }

    const parsedDate = Date.parse(trimmed)
    if (Number.isFinite(parsedDate)) {
      return Math.floor(parsedDate / 1000) as DashboardCandle['time']
    }

    return trimmed as DashboardCandle['time']
  }

  return Math.floor(Date.now() / 1000) as DashboardCandle['time']
}

function normalizeCandlePayloadItem(item: any): DashboardCandle | null {
  if (!item || typeof item !== 'object') return null

  const open = toFiniteNumber(item.open ?? item.o, NaN)
  const high = toFiniteNumber(item.high ?? item.h, NaN)
  const low = toFiniteNumber(item.low ?? item.l, NaN)
  const close = toFiniteNumber(item.close ?? item.c, NaN)

  if (
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return null
  }

  return {
    time: normalizeCandleTime(
      item.time ??
        item.timestamp ??
        item.t ??
        item.datetime ??
        item.date
    ),
    open,
    high,
    low,
    close,
    volume: toFiniteNumber(item.volume ?? item.v, 0),
  }
}

function normalizeCandlePayload(payload: any): DashboardCandle[] {
  return extractCandleArray(payload)
    .map(normalizeCandlePayloadItem)
    .filter((item): item is DashboardCandle => Boolean(item))
    .sort((a, b) => {
      const left = typeof a.time === 'number' ? a.time : Date.parse(String(a.time))
      const right = typeof b.time === 'number' ? b.time : Date.parse(String(b.time))
      return left - right
    })
}

const SHARED_CANDLE_CACHE_MAX_BARS = 5000
const CHART_CANDLE_DEBUG_MAX_ROWS = 16

// Historical OHLCV is expensive and rate-limited. After a good historical
// payload is loaded, keep the chart alive from cache + live candles and only
// refetch full history when the cache is stale, the symbol/timeframe changes,
// or a live/history gap needs repair.
const MAIN_HISTORICAL_REFRESH_MS = 2 * 60 * 1000
const MINI_HISTORICAL_REFRESH_MS = 5 * 60 * 1000
const LIVE_GAP_REPAIR_COOLDOWN_MS = 45 * 1000
const LIVE_GAP_REPAIR_LOG_THROTTLE_MS = 5 * 1000

type ChartCandleDebugLogEntry = {
  time: string
  level: 'info' | 'warn' | 'error' | 'success'
  stage: string
  message: string
}

function candleDebugTime() {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function candleDebugMessage(stage: string, detail: Record<string, any> = {}) {
  const readable = Object.entries(detail)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' • ')

  return readable ? `${stage} • ${readable}` : stage
}

function candleIdentityKey(candle: DashboardCandle) {
  const epoch = liveCandleEpoch(candle)
  if (epoch > 0) return String(epoch)
  return String(candle.time ?? `${candle.open}-${candle.high}-${candle.low}-${candle.close}`)
}

function mergeHistoricalCandles(
  existingCandles: DashboardCandle[] | undefined,
  incomingCandles: DashboardCandle[],
  maxBars = SHARED_CANDLE_CACHE_MAX_BARS
) {
  const map = new Map<string, DashboardCandle>()

  ;[...(existingCandles ?? []), ...incomingCandles].forEach((candle) => {
    if (!candle) return
    map.set(candleIdentityKey(candle), candle)
  })

  return Array.from(map.values())
    .sort((left, right) => liveCandleEpoch(left) - liveCandleEpoch(right))
    .slice(-Math.max(1, maxBars))
}

function describeCandleRange(candles: DashboardCandle[]) {
  const first = candles[0]
  const last = candles[candles.length - 1]

  return {
    count: candles.length,
    first: first ? String(first.time) : 'none',
    last: last ? String(last.time) : 'none',
    lastClose: last ? Number(last.close).toFixed(last.close >= 100 ? 2 : 6) : 'none',
  }
}


type SharedCandleCacheEntry = {
  candles: DashboardCandle[]
  overlayPayload: any | null
  unifiedIntelligence: any | null
  updatedAt: number
  limit: number
  provider?: string
  source?: string
}

const SHARED_CANDLE_CACHE = new Map<string, SharedCandleCacheEntry>()
const SHARED_CANDLE_IN_FLIGHT = new Map<string, Promise<SharedCandleCacheEntry>>()
const INSIGHTSENTRY_HISTORY_BACKOFF_UNTIL = new Map<string, number>()
const INSIGHTSENTRY_HISTORY_BACKOFF_MS = 3 * 60 * 1000

function shouldUseInsightSentryBackoff(key: string) {
  return (INSIGHTSENTRY_HISTORY_BACKOFF_UNTIL.get(key) ?? 0) > Date.now()
}

function rememberInsightSentryBackoff(key: string) {
  INSIGHTSENTRY_HISTORY_BACKOFF_UNTIL.set(key, Date.now() + INSIGHTSENTRY_HISTORY_BACKOFF_MS)
}

function sharedCandleKey(symbol: string, timeframe: string) {
  return `${normalizeSymbol(symbol)}::${normalizeTimeframe(timeframe)}`
}
function clearSharedChartCachesForSymbolSwitch(symbol: string, timeframe?: string) {
  const normalizedSymbol = normalizeSymbol(symbol)
  const normalizedTimeframe = timeframe ? normalizeTimeframe(timeframe) : ''

  Array.from(SHARED_CANDLE_CACHE.keys()).forEach((key) => {
    const [cacheSymbol, cacheTimeframe] = key.split('::')
    if (cacheSymbol !== normalizedSymbol) return
    if (normalizedTimeframe && cacheTimeframe !== normalizedTimeframe) return
    SHARED_CANDLE_CACHE.delete(key)
  })

  Array.from(SHARED_CANDLE_IN_FLIGHT.keys()).forEach((key) => {
    const [cacheSymbol, cacheTimeframe] = key.split('::')
    if (cacheSymbol !== normalizedSymbol) return
    if (normalizedTimeframe && cacheTimeframe !== normalizedTimeframe) return
    SHARED_CANDLE_IN_FLIGHT.delete(key)
  })
}


const SHARED_LIVE_PRICE_CACHE = new Map<string, LiveFeedSnapshot>()

function sharedLivePriceKey(symbol: string) {
  return normalizeSymbol(symbol)
}

function extractLiveFeedPriceFromPayload(payload: any, liveCandle?: any): LiveFeedSnapshot | null {
  const symbol = normalizeSymbol(
    payload?.symbol ??
      payload?.ticker ??
      payload?.data?.symbol ??
      payload?.quote?.symbol ??
      liveCandle?.symbol ??
      'MES1!'
  )

  const candidates = [
    payload?.price,
    payload?.livePrice,
    payload?.currentPrice,
    payload?.current,
    payload?.last,
    payload?.lastPrice,
    payload?.markPrice,
    payload?.quote?.last,
    payload?.quote?.price,
    payload?.quote?.mid,
    payload?.quote?.bid,
    payload?.quote?.ask,
    payload?.data?.last,
    payload?.data?.price,
    liveCandle?.close,
    liveCandle?.c,
  ]

  for (const candidate of candidates) {
    const price = toFiniteNumber(candidate, NaN)

    if (Number.isFinite(price) && price > 0) {
      return {
        symbol,
        price,
        bid: toFiniteNumber(payload?.bid ?? payload?.quote?.bid ?? payload?.data?.bid, NaN),
        ask: toFiniteNumber(payload?.ask ?? payload?.quote?.ask ?? payload?.data?.ask, NaN),
        last: toFiniteNumber(payload?.last ?? payload?.quote?.last ?? payload?.data?.last ?? price, price),
        source: String(payload?.source ?? payload?.provider ?? 'phase8_live_feed_sse'),
        updatedAt: Date.now(),
      }
    }
  }

  return null
}

function extractLiveCandleFromStreamPayload(payload: any): any | null {
  if (!payload || typeof payload !== 'object') return null

  const direct =
    payload?.candle ??
    payload?.liveCandle ??
    payload?.bar ??
    payload?.liveBar ??
    payload?.ohlc ??
    payload?.data?.candle ??
    payload?.data?.bar ??
    payload?.data?.ohlc ??
    payload?.quote?.candle ??
    null

  if (direct && typeof direct === 'object') return direct

  const close = toFiniteNumber(
    payload?.close ??
      payload?.c ??
      payload?.price ??
      payload?.livePrice ??
      payload?.currentPrice ??
      payload?.current ??
      payload?.last ??
      payload?.lastPrice ??
      payload?.markPrice ??
      payload?.quote?.last ??
      payload?.quote?.price ??
      payload?.quote?.bid ??
      payload?.quote?.ask ??
      payload?.data?.last ??
      payload?.data?.price,
    NaN
  )

  if (!Number.isFinite(close) || close <= 0) return null

  const open = toFiniteNumber(payload?.open ?? payload?.o, close)
  const high = Math.max(toFiniteNumber(payload?.high ?? payload?.h, close), open, close)
  const low = Math.min(toFiniteNumber(payload?.low ?? payload?.l, close), open, close)

  return {
    symbol: payload?.symbol ?? payload?.ticker,
    timeframe: payload?.timeframe,
    time:
      payload?.time ??
      payload?.timestamp ??
      payload?.t ??
      payload?.createdAt ??
      Math.floor(Date.now() / 1000),
    open,
    high,
    low,
    close,
    volume: toFiniteNumber(payload?.volume ?? payload?.v, 0),
    source: payload?.source ?? payload?.provider ?? 'phase8_live_feed_sse',
  }
}


function getLivePriceSourcePriority(source: any) {
  const text = String(source ?? '').toLowerCase()

  if (
    text.includes('api/live-price') ||
    text.includes('backend_live_price') ||
    text.includes('insightsentry_live_quote') ||
    text.includes('alpaca_latest_trade') ||
    text.includes('alpaca_latest_quote') ||
    text.includes('live_quote') ||
    text.includes('latest_trade') ||
    text.includes('latest_quote')
  ) {
    return 100
  }

  if (text.includes('phase8_live_feed_sse') || text.includes('live_feed') || text.includes('websocket') || text.includes('sse')) {
    return 70
  }

  if (text.includes('live_candle') || text.includes('candle') || text.includes('historical')) {
    return 35
  }

  return 50
}

function writeSharedLivePriceCache(snapshot: LiveFeedSnapshot | null, options?: { force?: boolean }) {
  if (!snapshot || !Number.isFinite(snapshot.price) || snapshot.price <= 0) return null

  const normalized: LiveFeedSnapshot = {
    ...snapshot,
    symbol: normalizeSymbol(snapshot.symbol),
    source: String(snapshot.source ?? 'unknown_live_price_source'),
    updatedAt: snapshot.updatedAt || Date.now(),
  }

  const key = sharedLivePriceKey(normalized.symbol)
  const existing = SHARED_LIVE_PRICE_CACHE.get(key)

  if (existing) {
    const existingTime = toFiniteNumber(existing.updatedAt, 0)
    const incomingTime = toFiniteNumber(normalized.updatedAt, 0)
    const existingPriority = getLivePriceSourcePriority(existing.source)
    const incomingPriority = getLivePriceSourcePriority(normalized.source)

    // Do not let a stale backend quote overwrite a fresher chart/live-feed price.
    // The shared live price should represent the freshest live value for the symbol,
    // not whichever poll finished last.
    if (incomingTime + 1500 < existingTime) {
      return existing
    }

    // If two updates arrive at nearly the same time, allow the more direct backend
    // quote to win only when it is not older. Otherwise, keep the fresher candle/SSE value.
    if (!options?.force && Math.abs(incomingTime - existingTime) <= 1500 && incomingPriority < existingPriority) {
      return existing
    }
  }

  SHARED_LIVE_PRICE_CACHE.set(key, normalized)
  return normalized
}

function readSharedLivePriceCache(symbol: string) {
  return SHARED_LIVE_PRICE_CACHE.get(sharedLivePriceKey(symbol)) ?? null
}

function extractBackendLivePriceSnapshot(payload: any, symbol: string, timeframe: string): LiveFeedSnapshot | null {
  if (!payload || typeof payload !== 'object') return null

  const normalizedSymbol = normalizeSymbol(payload.symbol ?? symbol)
  const price = toFiniteNumber(
    payload.price ??
      payload.livePrice ??
      payload.currentPrice ??
      payload.current ??
      payload.last ??
      payload.lastPrice ??
      payload.close ??
      payload.c,
    NaN
  )

  if (!Number.isFinite(price) || price <= 0) return null

  const rawTime =
    payload.time ??
    payload.timestamp ??
    payload.updatedAt ??
    payload.createdAt ??
    payload.data?.time ??
    payload.data?.timestamp ??
    payload.quote?.time ??
    payload.quote?.timestamp

  const parsedTime = typeof rawTime === 'number'
    ? (rawTime > 10_000_000_000 ? rawTime : rawTime * 1000)
    : Date.parse(String(rawTime ?? ''))

  return {
    symbol: normalizedSymbol,
    price,
    bid: toFiniteNumber(payload.bid ?? payload.quote?.bid ?? payload.data?.bid, NaN),
    ask: toFiniteNumber(payload.ask ?? payload.quote?.ask ?? payload.data?.ask, NaN),
    last: toFiniteNumber(payload.last ?? payload.lastPrice ?? price, price),
    source: String(payload.source ?? payload.provider ?? 'backend_live_price_api/live-price'),
    updatedAt: Number.isFinite(parsedTime) && parsedTime > 0 ? parsedTime : Date.now(),
  }
}

async function fetchBackendSharedLivePrice(apiBaseUrl: string, symbol: string, timeframe: string): Promise<LiveFeedSnapshot | null> {
  const params = new URLSearchParams({
    symbol: normalizeSymbol(symbol),
    timeframe: normalizeTimeframe(timeframe),
  })

  const response = await fetch(`${apiBaseUrl}/api/live-price?${params.toString()}`, {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Live price request failed: ${response.status}`)
  }

  const payload = await response.json()
  return extractBackendLivePriceSnapshot(payload, symbol, timeframe)
}

function formatSharedLivePrice(value: any) {
  const price = toFiniteNumber(value, NaN)
  if (!Number.isFinite(price) || price <= 0) return '—'

  return price.toLocaleString(undefined, {
    minimumFractionDigits: price >= 100 ? 2 : 4,
    maximumFractionDigits: price >= 100 ? 2 : 6,
  })
}

function readSharedCandleCache(symbol: string, timeframe: string, limit: number) {
  const cached = SHARED_CANDLE_CACHE.get(sharedCandleKey(symbol, timeframe))
  if (!cached) return null

  return {
    ...cached,
    candles: cached.candles.slice(-Math.max(1, limit)),
  }
}


function liveCandleEpoch(value: DashboardCandle | null | undefined) {
  if (!value) return 0

  if (typeof value.time === 'number') return value.time

  const parsed = Date.parse(String(value.time))
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0
}

function candleGapSeconds(currentCandles: DashboardCandle[], rawCandle: any) {
  const liveCandle = normalizeCandlePayloadItem(rawCandle)
  if (!liveCandle || currentCandles.length === 0) return 0

  const liveEpoch = liveCandleEpoch(liveCandle)
  const lastHistoricalEpoch = liveCandleEpoch(currentCandles[currentCandles.length - 1])

  if (liveEpoch <= 0 || lastHistoricalEpoch <= 0) return 0

  return liveEpoch - lastHistoricalEpoch
}

function getCandleCloseValue(candle: any) {
  return toFiniteNumber(candle?.close ?? candle?.c ?? candle?.price ?? candle?.last, NaN)
}

function getMaxLiveMergeGapPct(symbol: string) {
  const normalized = normalizeSymbol(symbol)

  // MES live quotes should never be stitched onto old Friday/Sunday history.
  // 0.25% is roughly 19 points near 7600. If price is farther away, refresh
  // historical candles first instead of creating a fake vertical candle.
  if (normalized === 'MES1!') return 0.0025

  if (normalized === 'BTCUSD' || normalized === 'ETHUSD') return 0.03

  return 0.01
}

function livePriceGapPctFromHistory(currentCandles: DashboardCandle[], rawCandle: any) {
  if (!Array.isArray(currentCandles) || currentCandles.length === 0) return 0

  const liveCandle = normalizeCandlePayloadItem(rawCandle)
  if (!liveCandle) return 0

  const lastClose = getCandleCloseValue(currentCandles[currentCandles.length - 1])
  const liveClose = getCandleCloseValue(liveCandle)

  if (!Number.isFinite(lastClose) || lastClose <= 0 || !Number.isFinite(liveClose) || liveClose <= 0) {
    return 0
  }

  return Math.abs(liveClose - lastClose) / lastClose
}

function isLiveCandleTooFarFromHistory(symbol: string, currentCandles: DashboardCandle[], rawCandle: any) {
  if (!Array.isArray(currentCandles) || currentCandles.length === 0) return false

  const gapPct = livePriceGapPctFromHistory(currentCandles, rawCandle)
  const maxGapPct = getMaxLiveMergeGapPct(symbol)

  return gapPct > maxGapPct
}

function mergeLiveCandleIntoCandles(
  currentCandles: DashboardCandle[],
  rawCandle: any,
  limit: number,
  timeframeSeconds = 60
): DashboardCandle[] {
  const liveCandle = normalizeLiveCandleToTimeframeBucket(rawCandle, timeframeSeconds)
  if (!liveCandle) return currentCandles

  const liveEpoch = liveCandleEpoch(liveCandle)
  if (liveEpoch <= 0) return currentCandles

  if (currentCandles.length > 0) {
    const lastHistoricalEpoch = liveCandleEpoch(currentCandles[currentCandles.length - 1])
    const gapSeconds = liveEpoch - lastHistoricalEpoch

    // Never fill chart history with fake/flat bridge candles.
    // If live is ahead of history, the caller force-refreshes historical OHLCV.
    // This keeps BTCUSD history real instead of showing a blank/invisible gap.
    if (gapSeconds > timeframeSeconds * 2) {
      return currentCandles
    }
  }

  let replaced = false
  const merged = currentCandles.map((existing) => {
    const existingEpoch = liveCandleEpoch(existing)
    if (existingEpoch === liveEpoch) {
      replaced = true
      return {
        ...existing,
        ...liveCandle,
        time: existing.time,
      }
    }
    return existing
  })

  if (!replaced) {
    merged.push(liveCandle)
  }

  merged.sort((a, b) => liveCandleEpoch(a) - liveCandleEpoch(b))
  return merged.slice(-Math.max(1, limit))
}

function writeLiveCandleToSharedCache(
  symbol: string,
  timeframe: string,
  limit: number,
  rawCandle: any,
  previousOverlayPayload: any | null,
  previousUnifiedIntelligence: any | null,
  timeframeSeconds = timeframeToSeconds(timeframe)
) {
  const key = sharedCandleKey(symbol, timeframe)
  const previous = SHARED_CANDLE_CACHE.get(key)

  if (previous?.candles?.length && isLiveCandleTooFarFromHistory(symbol, previous.candles, rawCandle)) {
    return null
  }

  const mergedCandles = mergeLiveCandleIntoCandles(
    previous?.candles ?? [],
    rawCandle,
    SHARED_CANDLE_CACHE_MAX_BARS,
    timeframeSeconds
  )

  if (mergedCandles.length === 0) return null

  const entry: SharedCandleCacheEntry = {
    candles: mergedCandles,
    overlayPayload: previous?.overlayPayload ?? previousOverlayPayload ?? null,
    unifiedIntelligence: previous?.unifiedIntelligence ?? previousUnifiedIntelligence ?? null,
    updatedAt: Date.now(),
    limit: Math.max(limit, previous?.limit ?? 0, mergedCandles.length),
    provider: 'insightsentry',
    source: 'phase8_live_feed_sse',
  }

  SHARED_CANDLE_CACHE.set(key, entry)
  return entry
}

async function fetchSharedCandlePayload(
  apiBaseUrl: string,
  symbol: string,
  timeframe: string,
  limit: number,
  force = false
): Promise<SharedCandleCacheEntry> {
  const normalizedSymbol = normalizeSymbol(symbol)
  const normalizedTimeframe = normalizeTimeframe(timeframe)
  const key = sharedCandleKey(normalizedSymbol, normalizedTimeframe)
  const requestedLimit = Math.max(1, limit)

  const providerForce = force && !isFuturesCandleSymbol(normalizedSymbol)

  const activeRequest = SHARED_CANDLE_IN_FLIGHT.get(key)
  if (activeRequest && !providerForce) {
    const activeResult = await activeRequest
    return {
      ...activeResult,
      candles: activeResult.candles.slice(-requestedLimit),
    }
  }

  const request = (async () => {
    const previous = SHARED_CANDLE_CACHE.get(key)
    const previousCount = previous?.candles?.length ?? 0

    // Backfill/grow rule:
    // Display can still request 300/700 candles, but the stored shared cache
    // should grow after history has loaded once. Increasing the provider limit
    // on occasional historical refreshes lets the cache expand toward 5,000
    // bars instead of permanently staying at the visible chart limit.
    const apiLimit = Math.min(
      SHARED_CANDLE_CACHE_MAX_BARS,
      Math.max(
        requestedLimit,
        previous?.limit ?? 0,
        previousCount > 0 ? previousCount + requestedLimit : requestedLimit
      )
    )

    let routeConfig = getHistoricalCandleRouteForSymbol(apiBaseUrl, normalizedSymbol)

    // InsightSentry direct history does not return reliable full series for every
    // custom timeframe. For MES 3m/2h/4h/etc., use the backend candle router so
    // api/main.py can fetch 1m/valid source candles and resample them correctly.
    if (isFuturesCandleSymbol(normalizedSymbol) && !isInsightSentryDirectHistoricalTimeframe(normalizedTimeframe)) {
      routeConfig = {
        route: `${apiBaseUrl}/api/candles`,
        provider: 'dashboard_candles',
        source: 'dashboard_candle_router_resampled_futures_history',
      }
    }

    const useBackendFallbackFirst =
      routeConfig.provider === 'insightsentry' &&
      (!providerForce || shouldUseInsightSentryBackoff(key)) &&
      shouldUseInsightSentryBackoff(key)

    const activeRouteConfig = useBackendFallbackFirst
      ? {
          route: `${apiBaseUrl}/api/candles`,
          provider: 'dashboard_candles',
          source: 'dashboard_candle_router_rate_limit_backoff',
        }
      : routeConfig

    const params = new URLSearchParams({
      symbol: normalizedSymbol,
      timeframe: normalizedTimeframe,
      limit: String(apiLimit),
      force: providerForce ? 'true' : 'false',
    })

    if (activeRouteConfig.provider === 'insightsentry') {
      params.set('start_ym', new Date().toISOString().slice(0, 7))
      params.set('extended', 'true')
      params.set('badj', 'true')
      params.set('dadj', 'false')
    }

    let json: any = null
    let providerLabel = activeRouteConfig.provider
    let sourceLabel = activeRouteConfig.source

    const response = await fetch(`${activeRouteConfig.route}?${params.toString()}`, {
      cache: 'no-store',
    })

    if (!response.ok) {
      if (routeConfig.provider === 'insightsentry') {
        if (response.status === 429) {
          rememberInsightSentryBackoff(key)
        }

        const fallbackParams = new URLSearchParams({
          symbol: normalizedSymbol,
          timeframe: normalizedTimeframe,
          limit: String(apiLimit),
          force: 'false',
        })

        const fallbackResponse = await fetch(`${apiBaseUrl}/api/candles?${fallbackParams.toString()}`, {
          cache: 'no-store',
        }).catch(() => null)

        if (fallbackResponse?.ok) {
          const fallbackJson = await fallbackResponse.json()
          const fallbackCandles = normalizeCandlePayload(fallbackJson)

          if (fallbackCandles.length > 0) {
            json = {
              ...fallbackJson,
              warning: `InsightSentry history returned ${response.status}; using backend cached MES candles.`,
            }
            providerLabel = typeof fallbackJson?.provider === 'string' ? fallbackJson.provider : 'dashboard_candles'
            sourceLabel = typeof fallbackJson?.source === 'string' ? fallbackJson.source : 'dashboard_candle_router_rate_limit_fallback'
          }
        }

        if (!json && previous?.candles?.length) {
          return {
            ...previous,
            candles: previous.candles.slice(-requestedLimit),
            updatedAt: Date.now(),
            source: 'frontend_cached_history_after_insightsentry_error',
          }
        }
      }

      if (!json) {
        throw new Error(`${activeRouteConfig.provider} candle history error ${response.status}`)
      }
    }

    if (!json) {
      json = await response.json()
    }

    const candles = normalizeCandlePayload(json)
    const overlayPayload = getUnifiedOverlayPayload(json)
    const unifiedIntelligence = getUnifiedIntelligencePayload(json)
    const mergedCandles = mergeHistoricalCandles(previous?.candles, candles)

    const entry: SharedCandleCacheEntry = {
      candles: mergedCandles,
      // Candle history is the candle source. Preserve any previous
      // overlay/intelligence payload so live refreshes do not blank the canvas.
      overlayPayload: overlayPayload ?? previous?.overlayPayload ?? null,
      unifiedIntelligence: unifiedIntelligence ?? previous?.unifiedIntelligence ?? null,
      updatedAt: Date.now(),
      limit: Math.max(apiLimit, previous?.limit ?? 0, mergedCandles.length),
      provider: typeof json?.provider === 'string' ? json.provider : providerLabel,
      source: typeof json?.source === 'string' ? json.source : sourceLabel,
    }

    SHARED_CANDLE_CACHE.set(key, entry)
    return entry
  })()

  SHARED_CANDLE_IN_FLIGHT.set(key, request)

  try {
    const result = await request
    return {
      ...result,
      candles: result.candles.slice(-requestedLimit),
    }
  } finally {
    SHARED_CANDLE_IN_FLIGHT.delete(key)
  }
}


function dashboardCandlesToOverlayCandles(candles: DashboardCandle[]) {
  return candles.map((candle) => {
    let overlayTime: number | string

    if (typeof candle.time === 'number' || typeof candle.time === 'string') {
      overlayTime = candle.time
    } else {
      overlayTime = `${candle.time.year}-${String(candle.time.month).padStart(2, '0')}-${String(candle.time.day).padStart(2, '0')}`
    }

    return {
      time: overlayTime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }
  })
}

function isUnifiedOverlayPayloadLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false

  const raw = value as any

  return (
    Array.isArray(raw.lines) ||
    Array.isArray(raw.zones) ||
    Array.isArray(raw.markers) ||
    Array.isArray(raw.smcEvents) ||
    Array.isArray(raw.orderBlocks) ||
    Array.isArray(raw.liquidityEvents) ||
    Array.isArray(raw.liquidityProfileBins) ||
    Array.isArray(raw.dlmLevels) ||
    Array.isArray(raw.ghostCandles)
  )
}

function hasUsefulObjectKeys(value: unknown) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value as Record<string, unknown>).length > 0
  )
}

function getUnifiedOverlayPayload(...sources: unknown[]) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue

    const raw = source as any

    const candidates = [
      raw.overlayPayload,
      raw.chartOverlays,
      raw.chart_overlays,
      raw.overlays,
      raw.latestSignal?.overlayPayload,
      raw.latestSignal?.chartOverlays,
      raw.latestSignal?.chart_overlays,
      raw.latestSignal?.overlays,
      raw,
    ]

    for (const candidate of candidates) {
      if (!isUnifiedOverlayPayloadLike(candidate)) continue

      /**
       * Important:
       * older candle payloads can expose scorecards/mlFeatures at the top level and
       * inside overlayPayload. Older cached payloads may have an overlayPayload
       * but empty scorecard objects. Preserve the visual overlay object, but
       * enrich it from the full API response so the ML Scorecards panel does
       * not receive blank objects.
       */
      const enriched = {
        ...(candidate as any),
      }

      if (!hasUsefulObjectKeys(enriched.scorecards) && hasUsefulObjectKeys(raw.scorecards)) {
        enriched.scorecards = raw.scorecards
      }

      if (!hasUsefulObjectKeys(enriched.mlFeatures) && hasUsefulObjectKeys(raw.mlFeatures)) {
        enriched.mlFeatures = raw.mlFeatures
      }

      if (!hasUsefulObjectKeys(enriched.mlFeatureContext) && hasUsefulObjectKeys(raw.mlFeatureContext)) {
        enriched.mlFeatureContext = raw.mlFeatureContext
      }

      if (!hasUsefulObjectKeys(enriched.calculationContext) && hasUsefulObjectKeys(raw.calculationContext)) {
        enriched.calculationContext = raw.calculationContext
      }

      if (!hasUsefulObjectKeys(enriched.scorecards) && hasUsefulObjectKeys(raw.chartOverlays?.scorecards)) {
        enriched.scorecards = raw.chartOverlays.scorecards
      }

      if (!hasUsefulObjectKeys(enriched.mlFeatures) && hasUsefulObjectKeys(raw.chartOverlays?.mlFeatures)) {
        enriched.mlFeatures = raw.chartOverlays.mlFeatures
      }

      return enriched
    }
  }

  return null
}

function getUnifiedIntelligencePayload(...sources: unknown[]) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue

    const raw = source as any
    const candidates = [
      raw.unifiedIntelligence,
      raw.unified_intelligence,
      raw.overlayPayload?.unifiedIntelligence,
      raw.chartOverlays?.unifiedIntelligence,
      raw.latestSignal?.unifiedIntelligence,
      raw.latestSignal?.overlayPayload?.unifiedIntelligence,
    ]

    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function getGhostCandlesFromUnifiedIntelligence(unifiedIntelligence: any | null | undefined): PythonGhostCandle[] {
  if (!unifiedIntelligence || typeof unifiedIntelligence !== 'object') return []

  const candidates = [
    unifiedIntelligence.projectionEngine?.ghostPath?.candles,
    unifiedIntelligence.projectionEngine?.ghostPath?.ghostCandles,
    unifiedIntelligence.projectionEngine?.ghostProjection?.candles,
    unifiedIntelligence.projectionEngine?.ghostProjection?.ghostCandles,
    unifiedIntelligence.projectionEngine?.ghostCandles,
    unifiedIntelligence.projectionEngine?.ghosts,
    unifiedIntelligence.projectionEngine?.ghostProjections,
    unifiedIntelligence.projectionEngine?.projections,
    unifiedIntelligence.unifiedProjectionEngine?.ghostPath?.candles,
    unifiedIntelligence.unifiedProjectionEngine?.ghostPath?.ghostCandles,
    unifiedIntelligence.unifiedProjectionEngine?.ghostProjection?.candles,
    unifiedIntelligence.unifiedProjectionEngine?.ghostProjection?.ghostCandles,
    unifiedIntelligence.unifiedProjectionEngine?.ghostCandles,
    unifiedIntelligence.unifiedProjectionEngine?.ghosts,
    unifiedIntelligence.unifiedProjectionEngine?.ghostProjections,
    unifiedIntelligence.unifiedProjectionEngine?.projections,
    unifiedIntelligence.ghostPath?.candles,
    unifiedIntelligence.ghostPath?.ghostCandles,
    unifiedIntelligence.ghostProjection?.candles,
    unifiedIntelligence.ghostProjection?.ghostCandles,
    unifiedIntelligence.components?.ghost?.candles,
    unifiedIntelligence.components?.ghost?.ghostCandles,
    unifiedIntelligence.ghostCandles,
    unifiedIntelligence.ghosts,
    unifiedIntelligence.ghostProjections,
    unifiedIntelligence.projections,
  ]

  for (const value of candidates) {
    if (isGhostCandleArray(value)) return value
  }

  return []
}

function getGhostCandlesFromUnifiedOverlay(overlayPayload: any | null | undefined): PythonGhostCandle[] {
  if (!overlayPayload || typeof overlayPayload !== 'object') return []

  const candidates = [
    overlayPayload.projectionEngine?.ghostPath?.candles,
    overlayPayload.projectionEngine?.ghostPath?.ghostCandles,
    overlayPayload.projectionEngine?.ghostProjection?.candles,
    overlayPayload.projectionEngine?.ghostProjection?.ghostCandles,
    overlayPayload.projectionEngine?.ghostCandles,
    overlayPayload.projectionEngine?.ghosts,
    overlayPayload.projectionEngine?.ghostProjections,
    overlayPayload.projectionEngine?.projections,
    overlayPayload.unifiedProjectionEngine?.ghostPath?.candles,
    overlayPayload.unifiedProjectionEngine?.ghostPath?.ghostCandles,
    overlayPayload.unifiedProjectionEngine?.ghostProjection?.candles,
    overlayPayload.unifiedProjectionEngine?.ghostProjection?.ghostCandles,
    overlayPayload.unifiedProjectionEngine?.ghostCandles,
    overlayPayload.unifiedProjectionEngine?.ghosts,
    overlayPayload.unifiedProjectionEngine?.ghostProjections,
    overlayPayload.unifiedProjectionEngine?.projections,
    overlayPayload.ghostPath?.candles,
    overlayPayload.ghostPath?.ghostCandles,
    overlayPayload.ghostProjection?.candles,
    overlayPayload.ghostProjection?.ghostCandles,
    overlayPayload.ghostCandles,
    overlayPayload.ghosts,
    overlayPayload.ghostProjections,
    overlayPayload.projections,
  ]

  for (const value of candidates) {
    if (isGhostCandleArray(value)) return value
  }

  return []
}

function getProjectionGhostCandles(projectionEngine: ProjectionEngineState | null | undefined): PythonGhostCandle[] {
  if (!projectionEngine || typeof projectionEngine !== 'object') return []

  const raw = projectionEngine as any

  const candidates = [
    raw.ghostPath?.candles,
    raw.ghostPath?.ghostCandles,
    raw.ghostProjection?.candles,
    raw.ghostProjection?.ghostCandles,
    raw.ghostCandles,
    raw.ghosts,
    raw.ghostProjections,
    raw.projections,
  ]

  for (const candidate of candidates) {
    if (isGhostCandleArray(candidate)) return candidate
  }

  return []
}

function mergeProjectionEngineIntoUnifiedIntelligence(
  unifiedIntelligence: any | null,
  projectionEngine: ProjectionEngineState | null
) {
  if (!projectionEngine || typeof projectionEngine !== 'object') {
    return unifiedIntelligence
  }

  const ghostCandles = getProjectionGhostCandles(projectionEngine)

  return {
    ...(unifiedIntelligence && typeof unifiedIntelligence === 'object' ? unifiedIntelligence : {}),
    projectionEngine,
    unifiedProjectionEngine: projectionEngine,
    target: projectionEngine.target,
    ghostPath: projectionEngine.ghostPath,
    alignment: projectionEngine.alignment,
    mode: projectionEngine.mode,
    learning: projectionEngine.learning,
    activeTargetPrice: projectionEngine.activeTargetPrice,
    activeTargetSource: projectionEngine.activeTargetSource,
    activeTargetType: projectionEngine.activeTargetType,
    activeTargetConfidence: projectionEngine.activeTargetConfidence,
    targetPrice: projectionEngine.targetPrice,
    finalTargetPrice: projectionEngine.finalTargetPrice,
    ghostOverlayTargetPrice: projectionEngine.ghostOverlayTargetPrice,
    targetConfidence: projectionEngine.targetConfidence,
    ghostConfidence: projectionEngine.ghostConfidence,
    projectionMode: projectionEngine.projectionMode,
    projectionModeLabel: projectionEngine.projectionModeLabel,
    aiPermission: projectionEngine.aiPermission,
    targetMl: projectionEngine.targetMl,
    targetPlan: projectionEngine.targetPlan,
    ghostCandles,
    ghostProjection: {
      ...(unifiedIntelligence?.ghostProjection ?? {}),
      candles: ghostCandles,
      ghostCandles,
      confidence: projectionEngine.ghostConfidence,
      direction: projectionEngine.ghostPath?.direction,
      source: 'unified_projection_engine',
    },
  }
}


function readSharedTargetNumber(source: any, path: string[]) {
  let current = source

  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) {
      return NaN
    }

    current = current[key]
  }

  const parsed = Number(current)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN
}

function collectSharedGhostCandles(...sources: any[]) {
  const ghosts: any[] = []

  sources.forEach((source) => {
    if (!source || typeof source !== 'object') return

    const candidates = [
      source.projectionEngine?.ghostPath?.candles,
      source.projectionEngine?.ghostPath?.ghostCandles,
      source.projectionEngine?.ghostProjection?.candles,
      source.projectionEngine?.ghostProjection?.ghostCandles,
      source.projectionEngine?.ghostCandles,
      source.projectionEngine?.ghosts,
      source.projectionEngine?.ghostProjections,
      source.projectionEngine?.projections,
      source.unifiedProjectionEngine?.ghostPath?.candles,
      source.unifiedProjectionEngine?.ghostPath?.ghostCandles,
      source.unifiedProjectionEngine?.ghostProjection?.candles,
      source.unifiedProjectionEngine?.ghostProjection?.ghostCandles,
      source.unifiedProjectionEngine?.ghostCandles,
      source.unifiedProjectionEngine?.ghosts,
      source.unifiedProjectionEngine?.ghostProjections,
      source.unifiedProjectionEngine?.projections,
      source.ghostPath?.candles,
      source.ghostPath?.ghostCandles,
      source.ghostCandles,
      source.ghosts,
      source.ghostProjections,
      source.projections,
      source.ghostProjection?.candles,
      source.ghostProjection?.ghostCandles,
      source.components?.ghost?.candles,
      source.components?.ghost?.ghostCandles,
      source.overlayPayload?.projectionEngine?.ghostPath?.candles,
      source.overlayPayload?.projectionEngine?.ghostCandles,
      source.overlayPayload?.unifiedProjectionEngine?.ghostPath?.candles,
      source.overlayPayload?.unifiedProjectionEngine?.ghostCandles,
      source.overlayPayload?.ghostPath?.candles,
      source.overlayPayload?.ghostCandles,
      source.overlayPayload?.ghostProjections,
      source.overlayPayload?.projections,
      source.chartOverlays?.projectionEngine?.ghostPath?.candles,
      source.chartOverlays?.projectionEngine?.ghostCandles,
      source.chartOverlays?.ghostCandles,
      source.chartOverlays?.ghostProjections,
      source.unifiedIntelligence?.projectionEngine?.ghostPath?.candles,
      source.unifiedIntelligence?.projectionEngine?.ghostCandles,
      source.unifiedIntelligence?.unifiedProjectionEngine?.ghostPath?.candles,
      source.unifiedIntelligence?.unifiedProjectionEngine?.ghostCandles,
      source.unifiedIntelligence?.ghostPath?.candles,
      source.unifiedIntelligence?.ghostCandles,
      source.unifiedIntelligence?.ghostProjection?.candles,
      source.unifiedIntelligence?.components?.ghost?.candles,
    ]

    candidates.forEach((candidate) => {
      if (Array.isArray(candidate)) {
        ghosts.push(...candidate)
      }
    })
  })

  return ghosts
}

function buildSharedTargetMlContext(...sources: any[]) {
  const targetCandidates: number[] = []
  const confidenceCandidates: number[] = []
  let targetMlReady = false
  let targetMlAligned = false
  let targetSource = ''

  const targetPaths = [
    ['finalTargetPrice'],
    ['overallTargetPrice'],

    ['targetMl', 'finalTargetPrice'],
    ['targetMl', 'overallTargetPrice'],
    ['targetMl', 'targetPrice'],

    ['targetPlan', 'finalTargetPrice'],
    ['targetPlan', 'overallTargetPrice'],
    ['targetPlan', 'targetPrice'],

    ['overlayPayload', 'finalTargetPrice'],
    ['overlayPayload', 'overallTargetPrice'],
    ['overlayPayload', 'targetMl', 'finalTargetPrice'],
    ['overlayPayload', 'targetMl', 'overallTargetPrice'],
    ['overlayPayload', 'targetMl', 'targetPrice'],
    ['overlayPayload', 'targetPlan', 'finalTargetPrice'],
    ['overlayPayload', 'targetPlan', 'overallTargetPrice'],
    ['overlayPayload', 'targetPlan', 'targetPrice'],

    ['unifiedIntelligence', 'finalTargetPrice'],
    ['unifiedIntelligence', 'overallTargetPrice'],
    ['unifiedIntelligence', 'targetMl', 'finalTargetPrice'],
    ['unifiedIntelligence', 'targetMl', 'overallTargetPrice'],
    ['unifiedIntelligence', 'targetMl', 'targetPrice'],
  ]

  const confidencePaths = [
    ['targetConfidence'],
    ['targetMlConfidence'],
    ['confidence'],
    ['targetMl', 'targetConfidence'],
    ['targetMl', 'confidence'],
    ['targetPlan', 'targetConfidence'],
    ['targetPlan', 'confidence'],
    ['overlayPayload', 'targetConfidence'],
    ['overlayPayload', 'targetMl', 'targetConfidence'],
    ['overlayPayload', 'targetPlan', 'targetConfidence'],
    ['unifiedIntelligence', 'targetConfidence'],
    ['unifiedIntelligence', 'targetMl', 'targetConfidence'],
  ]

  sources.forEach((source) => {
    if (!source || typeof source !== 'object') return

    targetPaths.forEach((path) => {
      const value = readSharedTargetNumber(source, path)
      if (Number.isFinite(value) && value > 0) {
        targetCandidates.push(value)
      }
    })

    confidencePaths.forEach((path) => {
      const value = readSharedTargetNumber(source, path)
      if (Number.isFinite(value) && value > 0) {
        confidenceCandidates.push(value)
      }
    })

    targetMlReady =
      targetMlReady ||
      Boolean(source.targetMlReady) ||
      Boolean(source.targetMl?.targetMlReady) ||
      Boolean(source.targetPlan?.targetMlReady) ||
      Boolean(source.overlayPayload?.targetMlReady) ||
      Boolean(source.overlayPayload?.targetMl?.targetMlReady)

    targetMlAligned =
      targetMlAligned ||
      Boolean(source.targetMlAligned) ||
      Boolean(source.targetMl?.targetMlAligned) ||
      Boolean(source.targetPlan?.targetMlAligned) ||
      Boolean(source.overlayPayload?.targetMlAligned) ||
      Boolean(source.overlayPayload?.targetMl?.targetMlAligned)

    targetSource =
      targetSource ||
      String(
        source.targetSource ??
        source.targetMl?.targetSource ??
        source.targetMl?.source ??
        source.targetPlan?.targetSource ??
        source.targetPlan?.source ??
        source.overlayPayload?.targetSource ??
        source.overlayPayload?.targetMl?.source ??
        ''
      ).trim()
  })

  const ghosts = collectSharedGhostCandles(...sources)
  const ghostOverlayTargetCandidates: number[] = []
  const ghostOverlayConfidenceCandidates: number[] = []

  ghosts.forEach((ghost) => {
    if (!ghost || typeof ghost !== 'object') return

    // Real Target Price ML fields only.
    const finalTarget =
      readSharedTargetNumber(ghost, ['finalTargetPrice']) ||
      readSharedTargetNumber(ghost, ['overallTargetPrice']) ||
      readSharedTargetNumber(ghost, ['targetMl', 'finalTargetPrice']) ||
      readSharedTargetNumber(ghost, ['targetMl', 'overallTargetPrice']) ||
      readSharedTargetNumber(ghost, ['targetMl', 'targetPrice']) ||
      readSharedTargetNumber(ghost, ['targetPlan', 'finalTargetPrice']) ||
      readSharedTargetNumber(ghost, ['targetPlan', 'overallTargetPrice']) ||
      readSharedTargetNumber(ghost, ['targetPlan', 'targetPrice'])

    if (Number.isFinite(finalTarget) && finalTarget > 0) {
      targetCandidates.push(finalTarget)
    }

    const confidence =
      readSharedTargetNumber(ghost, ['targetConfidence']) ||
      readSharedTargetNumber(ghost, ['targetMlConfidence']) ||
      readSharedTargetNumber(ghost, ['targetMl', 'targetConfidence']) ||
      readSharedTargetNumber(ghost, ['targetPlan', 'targetConfidence'])

    if (Number.isFinite(confidence) && confidence > 0) {
      confidenceCandidates.push(confidence)
    }

    // Ghost overlay fallback: ONLY the explicit projected/end ghost candle prices.
    // This is not Target Price ML. It is a chart projection target for display and AI context.
    const ghostOverlayTarget =
      readSharedTargetNumber(ghost, ['ghostTargetPrice']) ||
      readSharedTargetNumber(ghost, ['projectedTargetPrice']) ||
      readSharedTargetNumber(ghost, ['close'])

    if (Number.isFinite(ghostOverlayTarget) && ghostOverlayTarget > 0) {
      ghostOverlayTargetCandidates.push(ghostOverlayTarget)
    }

    const ghostOverlayConfidence =
      readSharedTargetNumber(ghost, ['confidence']) ||
      readSharedTargetNumber(ghost, ['baseConfidence'])

    if (Number.isFinite(ghostOverlayConfidence) && ghostOverlayConfidence > 0) {
      ghostOverlayConfidenceCandidates.push(ghostOverlayConfidence)
    }

    targetMlReady = targetMlReady || Boolean(ghost.targetMlReady) || Boolean(ghost.targetMlAligned)
    targetMlAligned = targetMlAligned || Boolean(ghost.targetMlAligned)
    targetSource = targetSource || String(ghost.targetSource ?? ghost.source ?? '').trim()
  })

  const finalTargetPrice = targetCandidates.find((value) => Number.isFinite(value) && value > 0) ?? null
  const targetConfidence = confidenceCandidates.length > 0 ? Math.max(...confidenceCandidates) : null

  const ghostOverlayTargetPrice =
    ghostOverlayTargetCandidates.length > 0
      ? ghostOverlayTargetCandidates[ghostOverlayTargetCandidates.length - 1]
      : null
  const ghostOverlayConfidence =
    ghostOverlayConfidenceCandidates.length > 0
      ? Math.max(...ghostOverlayConfidenceCandidates)
      : null

  const activeTargetPrice = finalTargetPrice ?? ghostOverlayTargetPrice
  const activeTargetSource = finalTargetPrice
    ? (targetSource || 'real_target_price_ml')
    : ghostOverlayTargetPrice
      ? 'ghost_overlay_target'
      : 'target_unavailable'
  const activeTargetConfidence = finalTargetPrice ? targetConfidence : ghostOverlayConfidence

  return {
    finalTargetPrice,
    overallTargetPrice: finalTargetPrice,
    ghostOverlayTargetPrice,
    ghostOverlayConfidence,
    activeTargetPrice,
    activeTargetSource,
    targetPrice: activeTargetPrice,
    target: activeTargetPrice,
    targetConfidence,
    targetMlConfidence: targetConfidence,
    targetMlReady: Boolean(finalTargetPrice && (targetMlReady || targetMlAligned || targetConfidence)),
    targetMlAligned: Boolean(finalTargetPrice && targetMlAligned),
    targetSource: activeTargetSource,
    targetMl: {
      finalTargetPrice,
      overallTargetPrice: finalTargetPrice,
      ghostOverlayTargetPrice,
      ghostOverlayConfidence,
      activeTargetPrice,
      activeTargetSource,
      targetPrice: finalTargetPrice,
      target: finalTargetPrice,
      targetConfidence,
      confidence: targetConfidence,
      targetMlConfidence: targetConfidence,
      targetMlReady: Boolean(finalTargetPrice && (targetMlReady || targetMlAligned || targetConfidence)),
      targetMlAligned: Boolean(finalTargetPrice && targetMlAligned),
      source: targetSource || 'real_target_price_ml',
    },
    targetPlan: {
      finalTargetPrice,
      overallTargetPrice: finalTargetPrice,
      ghostOverlayTargetPrice,
      ghostOverlayConfidence,
      activeTargetPrice,
      activeTargetSource,
      targetPrice: finalTargetPrice,
      target: finalTargetPrice,
      targetConfidence,
      confidence: targetConfidence,
      targetMlReady: Boolean(finalTargetPrice && (targetMlReady || targetMlAligned || targetConfidence)),
      targetMlAligned: Boolean(finalTargetPrice && targetMlAligned),
      source: targetSource || 'real_target_price_ml',
    },
  }
}

function getScorecardsFromOverlayPayload(...sources: unknown[]) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue

    const raw = source as any
    const candidates = [
      raw.scorecards,
      raw.overlayPayload?.scorecards,
      raw.chartOverlays?.scorecards,
      raw.latestSignal?.scorecards,
      raw.latestSignal?.overlayPayload?.scorecards,
    ]

    for (const candidate of candidates) {
      if (hasUsefulObjectKeys(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function getMlFeaturesFromOverlayPayload(...sources: unknown[]) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue

    const raw = source as any
    const candidates = [
      raw.mlFeatures,
      raw.overlayPayload?.mlFeatures,
      raw.chartOverlays?.mlFeatures,
      raw.latestSignal?.mlFeatures,
      raw.latestSignal?.overlayPayload?.mlFeatures,
      raw.mlFeatureContext,
      raw.overlayPayload?.mlFeatureContext,
    ]

    for (const candidate of candidates) {
      if (hasUsefulObjectKeys(candidate)) {
        return candidate
      }
    }
  }

  return null
}


function overlayNumber(value: unknown, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function overlayDirection(value: unknown): 'bullish' | 'bearish' | 'neutral' {
  const text = String(value ?? '').toLowerCase()

  if (
    text.includes('bull') ||
    text.includes('buy') ||
    text.includes('long') ||
    text.includes('demand')
  ) {
    return 'bullish'
  }

  if (
    text.includes('bear') ||
    text.includes('sell') ||
    text.includes('short') ||
    text.includes('supply')
  ) {
    return 'bearish'
  }

  return 'neutral'
}

function overlayAverage(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value))

  if (!clean.length) return 0

  return clean.reduce((sum: number, value: number) => sum + value, 0) / clean.length
}

function overlayQuality(item: any, fallback = 5) {
  if (!item || typeof item !== 'object') return fallback

  const explicit = overlayNumber(
    item.qualityScore ??
      item.quality_score ??
      item.score ??
      item.strength ??
      item.confidence,
    NaN
  )

  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit > 10 ? Math.min(10, explicit / 10) : Math.min(10, explicit)
  }

  const top = overlayNumber(item.top ?? item.high ?? item.upper ?? item.max, NaN)
  const bottom = overlayNumber(item.bottom ?? item.low ?? item.lower ?? item.min, NaN)

  if (Number.isFinite(top) && Number.isFinite(bottom) && Math.abs(top - bottom) > 0) {
    return fallback
  }

  return fallback
}

function getPayloadArray(payload: any, ...keys: string[]) {
  if (!payload || typeof payload !== 'object') return [] as any[]

  for (const key of keys) {
    const value = payload[key]
    if (Array.isArray(value)) return value
  }

  return [] as any[]
}

function getNestedPayloadArray(payload: any, key: string, ...arrayKeys: string[]) {
  const nested = payload?.[key]
  if (!nested || typeof nested !== 'object') return [] as any[]

  return getPayloadArray(nested, ...arrayKeys)
}

function uniqueOverlayItems(items: any[]) {
  const seen = new Set<string>()

  return items.filter((item) => {
    if (!item || typeof item !== 'object') return false

    const key = [
      item.id,
      item.type,
      item.kind,
      item.label,
      item.time,
      item.fromTime,
      item.startTime,
      item.endTime,
      item.index,
      item.price,
      item.top,
      item.bottom,
      item.high,
      item.low,
    ]
      .map((value) => String(value ?? ''))
      .join('|')

    if (seen.has(key)) return false
    seen.add(key)

    return true
  })
}

function scanOverlayArraysByKey(source: unknown, keyMatcher: (key: string) => boolean) {
  const results: any[] = []
  const seen = new Set<unknown>()

  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return

    seen.add(value)

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (Array.isArray(child) && keyMatcher(key.toLowerCase())) {
        results.push(...child.filter((item) => item && typeof item === 'object'))
      }

      if (child && typeof child === 'object') visit(child, depth + 1)
    }
  }

  visit(source, 0)

  return uniqueOverlayItems(results)
}

function scoreVisualProfileBin(bin: any) {
  const explicit = overlayNumber(
    bin?.liquidityScore ??
      bin?.score ??
      bin?.strength ??
      bin?.weight ??
      bin?.value,
    NaN
  )

  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit > 10 ? Math.min(10, explicit / 10) : Math.min(10, explicit)
  }

  const percent = overlayNumber(
    bin?.widthPct ??
      bin?.volumePct ??
      bin?.percent ??
      bin?.percentage ??
      bin?.pct ??
      bin?.relativeSize,
    NaN
  )

  if (Number.isFinite(percent) && percent > 0) {
    return percent > 10 ? Math.min(10, percent / 10) : Math.min(10, percent)
  }

  const volume = overlayNumber(
    bin?.volume ?? bin?.buyVolume ?? bin?.sellVolume ?? bin?.totalVolume,
    NaN
  )

  if (Number.isFinite(volume) && volume > 0) return 4

  const high = overlayNumber(bin?.high ?? bin?.top ?? bin?.upper, NaN)
  const low = overlayNumber(bin?.low ?? bin?.bottom ?? bin?.lower, NaN)

  if (Number.isFinite(high) && Number.isFinite(low)) return 3

  return 0
}

function calculateVisualAtr(candles: DashboardCandle[], length = 14) {
  if (!candles.length) return [] as Array<number | null>

  const trueRanges = candles.map((candle, index) => {
    const high = overlayNumber(candle.high, 0)
    const low = overlayNumber(candle.low, high)
    const previousClose = index > 0 ? overlayNumber(candles[index - 1].close, overlayNumber(candle.close, high)) : overlayNumber(candle.close, high)

    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose)
    )
  })

  const atrValues: Array<number | null> = Array(trueRanges.length).fill(null)
  let seed = 0

  for (let index = 0; index < trueRanges.length; index += 1) {
    const value = trueRanges[index]

    if (index < length) {
      seed += value

      if (index === length - 1) {
        atrValues[index] = seed / length
      }

      continue
    }

    const previousAtr = atrValues[index - 1]
    atrValues[index] =
      previousAtr === null ? null : (previousAtr * (length - 1) + value) / length
  }

  return atrValues
}

function calculateVisualNrtrContext(candles: DashboardCandle[]) {
  if (candles.length < 20) {
    return {
      direction: 'neutral',
      directionValue: 0,
      trendDirUnified: 0,
      trendLineUnified: null,
      barsInTrend: 0,
      distancePercent: 0,
      lockedProfit: 0,
      agreesWithSmc: false,
      buyFlip: false,
      sellFlip: false,
      flipHistory: [] as any[],
    }
  }

  const atrValues = calculateVisualAtr(candles, 14)
  const multiplier = 3.0

  let finalUpper: number | null = null
  let finalLower: number | null = null
  let previousFinalUpper: number | null = null
  let previousFinalLower: number | null = null
  let previousSuperTrend: number | null = null
  let direction = 0
  const points: any[] = []

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]
    const high = overlayNumber(candle.high, 0)
    const low = overlayNumber(candle.low, high)
    const close = overlayNumber(candle.close, high)
    const previousClose = index > 0 ? overlayNumber(candles[index - 1].close, close) : close
    const atr = atrValues[index]
    const previousDirection = direction

    if (atr === null || !Number.isFinite(atr)) {
      points.push({
        index,
        time: candle.time,
        price: close,
        line: null,
        direction: 0,
        buy: false,
        sell: false,
      })
      continue
    }

    const hl2 = (high + low) / 2
    const basicUpper = hl2 + multiplier * atr
    const basicLower = hl2 - multiplier * atr

    if (previousFinalUpper === null || previousFinalLower === null) {
      finalUpper = basicUpper
      finalLower = basicLower
    } else {
      finalUpper =
        basicUpper < previousFinalUpper || previousClose > previousFinalUpper
          ? basicUpper
          : previousFinalUpper

      finalLower =
        basicLower > previousFinalLower || previousClose < previousFinalLower
          ? basicLower
          : previousFinalLower
    }

    if (previousSuperTrend === null) {
      direction = close >= hl2 ? 1 : -1
    } else if (
      previousFinalUpper !== null &&
      Math.abs(previousSuperTrend - previousFinalUpper) <= 1e-10
    ) {
      direction = close > Number(finalUpper) ? 1 : -1
    } else {
      direction = close < Number(finalLower) ? -1 : 1
    }

    const trendLine = direction === 1 ? finalLower : finalUpper

    points.push({
      index,
      time: candle.time,
      price: close,
      line: trendLine,
      direction,
      buy: index > 0 && previousDirection === -1 && direction === 1,
      sell: index > 0 && previousDirection === 1 && direction === -1,
    })

    previousSuperTrend = trendLine
    previousFinalUpper = finalUpper
    previousFinalLower = finalLower
  }

  const active = points.filter((point) => point.direction !== 0 && point.line !== null)
  const latest = active[active.length - 1]

  if (!latest) {
    return {
      direction: 'neutral',
      directionValue: 0,
      trendDirUnified: 0,
      trendLineUnified: null,
      barsInTrend: 0,
      distancePercent: 0,
      lockedProfit: 0,
      agreesWithSmc: false,
      buyFlip: false,
      sellFlip: false,
      flipHistory: [] as any[],
    }
  }

  const flips = points.filter((point) => point.buy || point.sell)
  const latestFlip = flips[flips.length - 1]
  const entryIndex = latestFlip?.index ?? Math.max(0, active.findIndex((point) => point.direction === latest.direction))
  const entryCandle = candles[Math.max(0, Math.min(candles.length - 1, entryIndex))]
  const entryPrice = overlayNumber(entryCandle?.close, latest.price)
  const currentPrice = overlayNumber(latest.price, entryPrice)
  const trendLine = overlayNumber(latest.line, currentPrice)
  const lockedProfit =
    latest.direction === 1
      ? trendLine - entryPrice
      : latest.direction === -1
        ? entryPrice - trendLine
        : 0
  const distance = Math.abs(currentPrice - trendLine)
  const distancePercent = currentPrice !== 0 ? (distance / currentPrice) * 100 : 0

  return {
    direction: latest.direction === 1 ? 'bullish' : latest.direction === -1 ? 'bearish' : 'neutral',
    directionValue: latest.direction,
    trendDirUnified: latest.direction,
    trendLineUnified: Number(trendLine.toFixed(5)),
    barsInTrend: Math.max(0, candles.length - 1 - entryIndex),
    distancePercent: Number(distancePercent.toFixed(4)),
    lockedProfit: Number(lockedProfit.toFixed(5)),
    agreesWithSmc: false,
    buyFlip: Boolean(latest.buy),
    sellFlip: Boolean(latest.sell),
    flipHistory: flips.slice(-12).map((point) => ({
      time: point.time,
      index: point.index,
      type: point.buy ? 'buy' : 'sell',
      price: Number(overlayNumber(point.price, 0).toFixed(5)),
      line: Number(overlayNumber(point.line, 0).toFixed(5)),
    })),
  }
}

function calculateHiddenSmcContextFromCandles(candles: DashboardCandle[]) {
  const lookbackCandles = candles.slice(-160)
  if (lookbackCandles.length < 20) {
    return {
      qualityScore: 0,
      eqhEqlCount: 0,
      fvgCount: 0,
      sweepCount: 0,
      displacementCount: 0,
      inducementCount: 0,
    }
  }

  const atrValues = calculateVisualAtr(lookbackCandles, 14)
  const latestAtr =
    [...atrValues].reverse().find((value) => value !== null && Number.isFinite(value)) ?? 0
  const tolerance = Math.max(Number(latestAtr) * 0.12, overlayNumber(lookbackCandles[lookbackCandles.length - 1].close, 1) * 0.00025)
  const pivotLength = 3
  const swingHighs: Array<{ index: number; price: number }> = []
  const swingLows: Array<{ index: number; price: number }> = []

  for (let index = pivotLength; index < lookbackCandles.length - pivotLength; index += 1) {
    const candle = lookbackCandles[index]
    const high = overlayNumber(candle.high, 0)
    const low = overlayNumber(candle.low, high)
    const left = lookbackCandles.slice(index - pivotLength, index)
    const right = lookbackCandles.slice(index + 1, index + 1 + pivotLength)

    const isSwingHigh =
      left.every((item) => high >= overlayNumber(item.high, 0)) &&
      right.every((item) => high > overlayNumber(item.high, 0))

    const isSwingLow =
      left.every((item) => low <= overlayNumber(item.low, 0)) &&
      right.every((item) => low < overlayNumber(item.low, 0))

    if (isSwingHigh) swingHighs.push({ index, price: high })
    if (isSwingLow) swingLows.push({ index, price: low })
  }

  let eqhEqlCount = 0
  for (let index = 1; index < swingHighs.length; index += 1) {
    if (Math.abs(swingHighs[index].price - swingHighs[index - 1].price) <= tolerance) {
      eqhEqlCount += 1
    }
  }
  for (let index = 1; index < swingLows.length; index += 1) {
    if (Math.abs(swingLows[index].price - swingLows[index - 1].price) <= tolerance) {
      eqhEqlCount += 1
    }
  }

  let fvgCount = 0
  for (let index = 2; index < lookbackCandles.length; index += 1) {
    const left = lookbackCandles[index - 2]
    const current = lookbackCandles[index]
    const bullishFvg = overlayNumber(left.high, 0) < overlayNumber(current.low, 0)
    const bearishFvg = overlayNumber(left.low, 0) > overlayNumber(current.high, 0)
    if (bullishFvg || bearishFvg) fvgCount += 1
  }

  let sweepCount = 0
  for (let index = 10; index < lookbackCandles.length; index += 1) {
    const candle = lookbackCandles[index]
    const previous = lookbackCandles.slice(Math.max(0, index - 10), index)
    const previousHigh = Math.max(...previous.map((item) => overlayNumber(item.high, 0)))
    const previousLow = Math.min(...previous.map((item) => overlayNumber(item.low, 0)))
    const high = overlayNumber(candle.high, 0)
    const low = overlayNumber(candle.low, high)
    const close = overlayNumber(candle.close, high)

    const buySideSweep = high > previousHigh && close < previousHigh
    const sellSideSweep = low < previousLow && close > previousLow

    if (buySideSweep || sellSideSweep) sweepCount += 1
  }

  let displacementCount = 0
  for (let index = 0; index < lookbackCandles.length; index += 1) {
    const candle = lookbackCandles[index]
    const atr = atrValues[index]
    if (atr === null || !Number.isFinite(atr)) continue

    const open = overlayNumber(candle.open, overlayNumber(candle.close, 0))
    const close = overlayNumber(candle.close, open)
    const high = overlayNumber(candle.high, Math.max(open, close))
    const low = overlayNumber(candle.low, Math.min(open, close))
    const body = Math.abs(close - open)
    const range = Math.max(high - low, 0.000001)

    if (body >= Number(atr) * 1.15 && body / range >= 0.55) {
      displacementCount += 1
    }
  }

  const inducementCount = Math.min(
    sweepCount,
    Math.max(0, Math.floor(displacementCount / 2) + Math.floor(eqhEqlCount / 2))
  )

  const qualityScore = Math.min(
    10,
    sweepCount * 1.2 +
      displacementCount * 0.85 +
      inducementCount * 0.75 +
      fvgCount * 0.45 +
      eqhEqlCount * 0.5
  )

  return {
    qualityScore: Number(qualityScore.toFixed(2)),
    eqhEqlCount,
    fvgCount,
    sweepCount,
    displacementCount,
    inducementCount,
  }
}


type VisualTargetPlan = {
  entryPrice: number | null
  targetPrice: number | null
  stopPrice: number | null
  riskReward: number | null
  targetSource: string
  stopSource: string
  targetDistance: number | null
  stopDistance: number | null
}

function roundVisualPriceToTick(price: number, symbol?: string) {
  if (!Number.isFinite(price) || price <= 0) return null

  const normalized = normalizeSymbol(symbol ?? 'MES1!')
  const tickSize =
    normalized.includes('MES') || normalized.includes('ES')
      ? 0.25
      : normalized.includes('BTC')
        ? 0.5
        : normalized.includes('ETH')
          ? 0.05
          : 0.01

  return Number((Math.round(price / tickSize) * tickSize).toFixed(5))
}

function getLatestVisualClose(candles: DashboardCandle[]) {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const close = overlayNumber(candles[index]?.close, NaN)
    if (Number.isFinite(close) && close > 0) return close
  }

  return null
}

function getLatestVisualAtr(candles: DashboardCandle[], length = 14) {
  const atrValues = calculateVisualAtr(candles, length)
  const latestAtr = [...atrValues].reverse().find((value) => value !== null && Number.isFinite(value))

  return Number.isFinite(Number(latestAtr)) ? Number(latestAtr) : 0
}

function getVisualPriceCandidatesFromItem(item: any) {
  if (!item || typeof item !== 'object') return [] as number[]

  const values = [
    item.targetPrice,
    item.target_price,
    item.takeProfitPrice,
    item.take_profit_price,
    item.tp1,
    item.tp1Price,
    item.price,
    item.level,
    item.value,
    item.y,
    item.high,
    item.top,
    item.upper,
    item.max,
    item.low,
    item.bottom,
    item.lower,
    item.min,
    item.mid,
    item.middle,
    item.equilibrium,
  ]

  return values
    .map((value) => overlayNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0)
}

function getVisualCandidateSource(item: any, fallback: string) {
  const label = String(
    item?.targetSource ??
      item?.source ??
      item?.label ??
      item?.fullLabel ??
      item?.type ??
      item?.kind ??
      item?.name ??
      fallback
  ).trim()

  return label || fallback
}

function pushVisualTargetCandidate(
  candidates: Array<{ price: number; source: string; quality: number }>,
  price: number,
  source: string,
  quality = 5
) {
  if (!Number.isFinite(price) || price <= 0) return

  candidates.push({
    price,
    source,
    quality: Number.isFinite(quality) ? quality : 5,
  })
}

function scanCandleStructureTargets(
  candles: DashboardCandle[],
  direction: 'bullish' | 'bearish',
  currentPrice: number,
  atr: number
) {
  const lookback = candles.slice(-140)
  const pivotLength = 3
  const candidates: Array<{ price: number; source: string; quality: number }> = []

  if (lookback.length < pivotLength * 2 + 5) return candidates

  for (let index = pivotLength; index < lookback.length - pivotLength; index += 1) {
    const candle = lookback[index]
    const high = overlayNumber(candle.high, NaN)
    const low = overlayNumber(candle.low, NaN)
    const left = lookback.slice(index - pivotLength, index)
    const right = lookback.slice(index + 1, index + 1 + pivotLength)

    if (Number.isFinite(high)) {
      const isSwingHigh =
        left.every((item) => high >= overlayNumber(item.high, 0)) &&
        right.every((item) => high > overlayNumber(item.high, 0))

      if (isSwingHigh && direction === 'bullish' && high > currentPrice) {
        pushVisualTargetCandidate(
          candidates,
          high,
          'SMC swing-high liquidity target',
          6
        )
      }
    }

    if (Number.isFinite(low)) {
      const isSwingLow =
        left.every((item) => low <= overlayNumber(item.low, Number.POSITIVE_INFINITY)) &&
        right.every((item) => low < overlayNumber(item.low, Number.POSITIVE_INFINITY))

      if (isSwingLow && direction === 'bearish' && low < currentPrice) {
        pushVisualTargetCandidate(
          candidates,
          low,
          'SMC swing-low liquidity target',
          6
        )
      }
    }
  }

  // Equal high / equal low style liquidity from recent extremes.
  const tolerance = Math.max(atr * 0.12, currentPrice * 0.00025)
  const rawLevels = candidates.map((candidate) => candidate.price)

  for (let index = 1; index < rawLevels.length; index += 1) {
    if (Math.abs(rawLevels[index] - rawLevels[index - 1]) <= tolerance) {
      pushVisualTargetCandidate(
        candidates,
        (rawLevels[index] + rawLevels[index - 1]) / 2,
        direction === 'bullish'
          ? 'SMC equal-high liquidity target'
          : 'SMC equal-low liquidity target',
        7.5
      )
    }
  }

  return candidates
}

function buildVisualTargetPlan(
  candles: DashboardCandle[],
  direction: 'bullish' | 'bearish' | 'neutral',
  payloadSources: any[],
  symbol?: string
): VisualTargetPlan {
  const entryPrice = getLatestVisualClose(candles)
  const atr = getLatestVisualAtr(candles, 14)

  if (!entryPrice || direction === 'neutral') {
    return {
      entryPrice,
      targetPrice: null,
      stopPrice: null,
      riskReward: null,
      targetSource: 'Waiting for ML/SMC directional target',
      stopSource: 'Waiting for ML/SMC directional stop',
      targetDistance: null,
      stopDistance: null,
    }
  }

  const targetCandidates: Array<{ price: number; source: string; quality: number }> = []
  const stopCandidates: Array<{ price: number; source: string; quality: number }> = []

  const overlayCollections = payloadSources.flatMap((payload) => [
    ...getPayloadArray(payload, 'lines', 'overlayLines', 'structureLines', 'smcEvents', 'liquidityEvents', 'dlmLevels'),
    ...getPayloadArray(payload, 'zones', 'overlayZones', 'chartZones', 'orderBlocks', 'orderBlockZones'),
    ...getPayloadArray(payload, 'liquidityProfileBins', 'profileBins', 'alphaProfileBins', 'dlmProfileBins', 'bins', 'levels'),
    ...getNestedPayloadArray(payload, 'alphaProfile', 'bins', 'profileBins', 'levels'),
    ...getNestedPayloadArray(payload, 'liquidityProfile', 'bins', 'profileBins', 'levels'),
    ...getNestedPayloadArray(payload, 'dlm', 'bins', 'profileBins', 'liquidityProfileBins', 'levels'),
    ...scanOverlayArraysByKey(
      payload,
      (key) =>
        key.includes('liquidity') ||
        key.includes('profile') ||
        key.includes('dlm') ||
        key.includes('orderblock') ||
        key.includes('zone') ||
        key.includes('level') ||
        key.includes('target') ||
        key.includes('tp')
    ),
  ])

  for (const item of uniqueOverlayItems(overlayCollections)) {
    const sourceText = getVisualCandidateSource(item, 'ML/SMC overlay level')
    const itemDirection = overlayDirection(item.direction ?? item.bias ?? item.side ?? item.label ?? item.type ?? item.kind)
    const quality = overlayQuality(item, scoreVisualProfileBin(item) || 5)

    for (const price of getVisualPriceCandidatesFromItem(item)) {
      if (direction === 'bullish') {
        if (price > entryPrice) {
          pushVisualTargetCandidate(
            targetCandidates,
            price,
            sourceText.toLowerCase().includes('profile') || sourceText.toLowerCase().includes('liquidity')
              ? 'AlphaX/DLM liquidity target'
              : sourceText,
            quality
          )
        }

        if (price < entryPrice && (itemDirection === 'bullish' || sourceText.toLowerCase().includes('demand') || sourceText.toLowerCase().includes('discount') || sourceText.toLowerCase().includes('ob'))) {
          pushVisualTargetCandidate(
            stopCandidates,
            price,
            'SMC invalidation below demand/order block',
            quality
          )
        }
      }

      if (direction === 'bearish') {
        if (price < entryPrice) {
          pushVisualTargetCandidate(
            targetCandidates,
            price,
            sourceText.toLowerCase().includes('profile') || sourceText.toLowerCase().includes('liquidity')
              ? 'AlphaX/DLM liquidity target'
              : sourceText,
            quality
          )
        }

        if (price > entryPrice && (itemDirection === 'bearish' || sourceText.toLowerCase().includes('supply') || sourceText.toLowerCase().includes('premium') || sourceText.toLowerCase().includes('ob'))) {
          pushVisualTargetCandidate(
            stopCandidates,
            price,
            'SMC invalidation above supply/order block',
            quality
          )
        }
      }
    }
  }

  for (const candidate of scanCandleStructureTargets(candles, direction, entryPrice, atr)) {
    pushVisualTargetCandidate(targetCandidates, candidate.price, candidate.source, candidate.quality)
  }

  // If the overlay has no stop, use the latest SMC/ATR structural invalidation.
  // This is still SMC risk logic, not a target generator.
  if (stopCandidates.length === 0 && atr > 0) {
    const lookback = candles.slice(-30)
    if (direction === 'bullish') {
      const recentLow = Math.min(...lookback.map((candle) => overlayNumber(candle.low, entryPrice)))
      const stop = Math.min(recentLow, entryPrice - atr)
      pushVisualTargetCandidate(stopCandidates, stop, 'SMC recent low / ATR invalidation', 4.5)
    } else if (direction === 'bearish') {
      const recentHigh = Math.max(...lookback.map((candle) => overlayNumber(candle.high, entryPrice)))
      const stop = Math.max(recentHigh, entryPrice + atr)
      pushVisualTargetCandidate(stopCandidates, stop, 'SMC recent high / ATR invalidation', 4.5)
    }
  }

  const minimumTargetDistance = Math.max(atr * 0.25, entryPrice * 0.0001)

  const directionalTargets = targetCandidates
    .filter((candidate) =>
      direction === 'bullish'
        ? candidate.price > entryPrice + minimumTargetDistance
        : candidate.price < entryPrice - minimumTargetDistance
    )
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.price - entryPrice),
    }))
    .sort((left, right) => {
      const qualityDiff = right.quality - left.quality
      if (Math.abs(qualityDiff) >= 2) return qualityDiff
      return left.distance - right.distance
    })

  const directionalStops = stopCandidates
    .filter((candidate) =>
      direction === 'bullish'
        ? candidate.price < entryPrice
        : candidate.price > entryPrice
    )
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.price - entryPrice),
    }))
    .sort((left, right) => left.distance - right.distance)

  const target = directionalTargets[0] ?? null
  const stop = directionalStops[0] ?? null

  const roundedTarget = target ? roundVisualPriceToTick(target.price, symbol) : null
  const roundedStop = stop ? roundVisualPriceToTick(stop.price, symbol) : null
  const roundedEntry = roundVisualPriceToTick(entryPrice, symbol) ?? entryPrice

  const targetDistance =
    roundedTarget && Number.isFinite(roundedTarget)
      ? Math.abs(roundedTarget - roundedEntry)
      : null

  const stopDistance =
    roundedStop && Number.isFinite(roundedStop)
      ? Math.abs(roundedEntry - roundedStop)
      : null

  const riskReward =
    targetDistance && stopDistance && stopDistance > 0
      ? Number((targetDistance / stopDistance).toFixed(2))
      : null

  return {
    entryPrice: roundedEntry,
    targetPrice: roundedTarget,
    stopPrice: roundedStop,
    riskReward,
    targetSource: target?.source ?? 'Waiting for ML/SMC target level',
    stopSource: stop?.source ?? 'Waiting for ML/SMC stop level',
    targetDistance: targetDistance === null ? null : Number(targetDistance.toFixed(5)),
    stopDistance: stopDistance === null ? null : Number(stopDistance.toFixed(5)),
  }
}



function extractNrtrSettingsFromSources(sources: any[]): ChartStrategySettings | null {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue

    const candidates = [
      source.mainSettings,
      source.settings,
      source.chartSettings,
      source.strategySettings,
      source.mainChartSettings,
      source?.scorecards?.settings,
      source?.summary?.settings,
    ]

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue

      const nrtrMode = candidate.nrtrMode
      if (nrtrMode === "ATR-Based" || nrtrMode === "Percentage" || nrtrMode === "Off") {
        return {
          smmaLength: Number(candidate.smmaLength ?? 20),
          nrtrMode,
          nrtrAtrLength: Number(candidate.nrtrAtrLength ?? 5),
          nrtrAtrMultiplier: Number(candidate.nrtrAtrMultiplier ?? 1.25),
          nrtrPercent: Number(candidate.nrtrPercent ?? 0.25),
          showNrtrExitLabels: Boolean(candidate.showNrtrExitLabels),
        }
      }
    }
  }

  return null
}

function buildNrtrUnifiedStrategyContext(
  candles: DashboardCandle[],
  settings?: ChartStrategySettings | null
) {
  const safeSettings = settings ?? {
    smmaLength: 20,
    nrtrMode: "ATR-Based" as const,
    nrtrAtrLength: 5,
    nrtrAtrMultiplier: 1.25,
    nrtrPercent: 0.25,
    showNrtrExitLabels: false,
  }

  if (!Array.isArray(candles) || candles.length < Math.max(8, safeSettings.nrtrAtrLength + 2)) {
    return {
      status: "Waiting",
      state: "Waiting",
      direction: "neutral",
      signal: "NEUTRAL",
      score: 0,
      confidence: 0,
      label: "NRTR",
      name: "NRTR",
      detail: "Waiting for enough candles",
      details: "Waiting for enough candles",
      usedForMl: false,
      purpose: "strategy_context_only",
    }
  }

  if (safeSettings.nrtrMode === "Off") {
    return {
      status: "Inactive",
      state: "Inactive",
      direction: "neutral",
      signal: "NEUTRAL",
      score: 0,
      confidence: 0,
      label: "NRTR",
      name: "NRTR",
      detail: "NRTR is off",
      details: "NRTR is off",
      usedForMl: false,
      purpose: "strategy_context_only",
    }
  }

  const latest = candles[candles.length - 1]
  const previous = candles[candles.length - 2]
  const close = Number(latest.close)
  const previousClose = Number(previous.close)

  if (!Number.isFinite(close) || !Number.isFinite(previousClose) || close <= 0) {
    return {
      status: "Waiting",
      state: "Waiting",
      direction: "neutral",
      signal: "NEUTRAL",
      score: 0,
      confidence: 0,
      label: "NRTR",
      name: "NRTR",
      detail: "Waiting for valid candle prices",
      details: "Waiting for valid candle prices",
      usedForMl: false,
      purpose: "strategy_context_only",
    }
  }

  const atrLength = Math.max(1, Number(safeSettings.nrtrAtrLength || 5))
  const sample = candles.slice(-Math.max(atrLength + 2, 10))
  const trueRanges = sample.slice(1).map((candle, index) => {
    const prev = sample[index]
    const high = Number(candle.high)
    const low = Number(candle.low)
    const prevCloseValue = Number(prev.close)

    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(prevCloseValue)) return 0

    return Math.max(
      high - low,
      Math.abs(high - prevCloseValue),
      Math.abs(low - prevCloseValue),
    )
  })

  const atr =
    trueRanges.reduce((sum: number, value: number) => sum + value, 0) /
    Math.max(trueRanges.length, 1)

  const distance =
    safeSettings.nrtrMode === "ATR-Based"
      ? atr * Number(safeSettings.nrtrAtrMultiplier || 1.25)
      : close * (Number(safeSettings.nrtrPercent || 0.25) / 100)

  const recentHigh = Math.max(...sample.map((candle) => Number(candle.high)).filter(Number.isFinite))
  const recentLow = Math.min(...sample.map((candle) => Number(candle.low)).filter(Number.isFinite))

  const bullishStop = recentHigh - distance
  const bearishStop = recentLow + distance

  let direction: "bullish" | "bearish" | "neutral" = "neutral"

  if (close >= bullishStop && close >= previousClose) {
    direction = "bullish"
  } else if (close <= bearishStop && close <= previousClose) {
    direction = "bearish"
  } else if (close > previousClose) {
    direction = "bullish"
  } else if (close < previousClose) {
    direction = "bearish"
  }

  const activeStop =
    direction === "bullish"
      ? bullishStop
      : direction === "bearish"
        ? bearishStop
        : close

  const distanceFromStop = Math.abs(close - activeStop)
  const rawScore =
    direction === "neutral"
      ? 0
      : Math.max(5, Math.min(100, (distanceFromStop / Math.max(distance, close * 0.0001, 0.000001)) * 100))

  const confidence =
    direction === "neutral"
      ? 0
      : Math.max(20, Math.min(100, 48 + rawScore * 0.42))

  const signal =
    direction === "bullish" ? "BULLISH" :
    direction === "bearish" ? "BEARISH" :
    "NEUTRAL"

  const status = direction === "neutral" ? "Waiting" : "Active"
  const detail = `${safeSettings.nrtrMode} • ATR ${safeSettings.nrtrAtrLength} x${safeSettings.nrtrAtrMultiplier} • Stop ${activeStop.toFixed(2)} • strategy context only`

  return {
    status,
    state: status,
    direction,
    signal,
    side: direction,
    score: Math.round(rawScore),
    confidence: Math.round(confidence),
    label: "NRTR",
    name: "NRTR",
    detail,
    details: detail,
    value: Math.round(confidence),
    usedForMl: false,
    purpose: "strategy_context_only",
    nrtrMode: safeSettings.nrtrMode,
    nrtrStop: Number(activeStop.toFixed(5)),
    close,
  }
}



function getLiveNrtrMatrixSource(scorecards: any) {
  const nrtr =
    scorecards?.nrtrMatrix ??
    scorecards?.nrtrStrategy ??
    scorecards?.nrtr ??
    scorecards?.nrtrStrategyContext

  if (!nrtr || typeof nrtr !== "object") return null

  return {
    id: "nrtr",
    name: "NRTR",
    label: "NRTR",
    system: "STRATEGY",
    status: nrtr.status ?? nrtr.state ?? "Active",
    state: nrtr.state ?? nrtr.status ?? "Active",
    direction: nrtr.direction ?? "neutral",
    signal: nrtr.signal ?? "NEUTRAL",
    score: Number(nrtr.score ?? nrtr.confidence ?? 0),
    confidence: Number(nrtr.confidence ?? nrtr.score ?? 0),
    details: nrtr.details ?? nrtr.detail ?? "NRTR strategy context",
    detail: nrtr.detail ?? nrtr.details ?? "NRTR strategy context",
    usedForMl: false,
    purpose: "strategy_context_only",
  }
}

function buildVisualOverlayScorecards(candles: DashboardCandle[], ...sources: any[]) {
  const liveNrtrStrategyContext = buildNrtrUnifiedStrategyContext(candles, extractNrtrSettingsFromSources(sources))

  const mainCandles = candles

  const payloadSources = sources.filter((source) => source && typeof source === 'object')
  if (!payloadSources.length) return null

  const zones = uniqueOverlayItems(
    payloadSources.flatMap((payload) => [
      ...getPayloadArray(payload, 'zones', 'overlayZones', 'chartZones'),
      ...getPayloadArray(payload, 'pdZones', 'premiumDiscountZones', 'premiumDiscount', 'pdLevels'),
      ...getPayloadArray(payload, 'orderBlocks', 'orderBlockZones'),
      ...scanOverlayArraysByKey(
        payload,
        (key) =>
          key.includes('zone') ||
          key.includes('orderblock') ||
          key.includes('premium') ||
          key.includes('discount') ||
          key.includes('equilibrium')
      ),
    ])
  )

  const lines = uniqueOverlayItems(
    payloadSources.flatMap((payload) => [
      ...getPayloadArray(payload, 'lines', 'overlayLines', 'structureLines'),
      ...getPayloadArray(payload, 'smcEvents', 'structureEvents', 'marketStructureEvents'),
    ])
  )

  const smcEvents = lines.filter((item) => {
    const label = String(item.label ?? item.type ?? item.kind ?? '').toLowerCase()
    return label.includes('bos') || label.includes('choch') || label.includes('mss')
  })

  const orderBlocks = zones.filter((zone) => {
    const label = String(zone.label ?? zone.type ?? zone.kind ?? zone.zoneType ?? '').toLowerCase()
    return (
      label.includes('ob') ||
      label.includes('order') ||
      label.includes('supply') ||
      label.includes('demand') ||
      label.includes('bearish ob') ||
      label.includes('bullish ob')
    )
  })

  const pdZones = zones.filter((zone) => {
    const label = String(zone.label ?? zone.type ?? zone.kind ?? zone.zoneType ?? zone.name ?? '').toLowerCase()
    return (
      label.includes('premium') ||
      label.includes('discount') ||
      label.includes('equilibrium') ||
      label.includes('pd')
    )
  })

  const profileBins = uniqueOverlayItems(
    payloadSources.flatMap((payload) => [
      ...getPayloadArray(payload, 'liquidityProfileBins', 'profileBins', 'alphaProfileBins', 'dlmProfileBins', 'bins', 'levels'),
      ...getNestedPayloadArray(payload, 'alphaProfile', 'bins', 'profileBins', 'levels'),
      ...getNestedPayloadArray(payload, 'liquidityProfile', 'bins', 'profileBins', 'levels'),
      ...getNestedPayloadArray(payload, 'dlm', 'bins', 'profileBins', 'liquidityProfileBins', 'levels'),
      ...scanOverlayArraysByKey(
        payload,
        (key) =>
          key.includes('profilebin') ||
          key.includes('liquidityprofile') ||
          key.includes('dlmprofile') ||
          key === 'bins' ||
          key === 'levels'
      ),
    ])
  )

  const ghostCandles = uniqueOverlayItems(
    payloadSources.flatMap((payload) =>
      getPayloadArray(payload, 'ghostCandles', 'ghostProjections', 'projections')
    )
  )

  const recentSmc = smcEvents.slice(-10)
  const recentObs = orderBlocks.slice(-10)

  const smcBull = recentSmc.filter((item) => overlayDirection(item.direction ?? item.label ?? item.type) === 'bullish').length
  const smcBear = recentSmc.filter((item) => overlayDirection(item.direction ?? item.label ?? item.type) === 'bearish').length
  const obBull = recentObs.filter((item) => overlayDirection(item.direction ?? item.label ?? item.type) === 'bullish').length
  const obBear = recentObs.filter((item) => overlayDirection(item.direction ?? item.label ?? item.type) === 'bearish').length

  const smcQuality = recentSmc.length ? overlayAverage(recentSmc.map((item) => overlayQuality(item, 5))) : 0
  const obQuality = recentObs.length ? overlayAverage(recentObs.map((item) => overlayQuality(item, 5))) : 0
  const pdQuality = pdZones.length ? Math.max(4.5, overlayAverage(pdZones.map((item) => overlayQuality(item, 5)))) : 0
  const profileQuality = profileBins.length
    ? Math.max(4.5, overlayAverage(profileBins.map((bin) => scoreVisualProfileBin(bin))))
    : 0

  const ghost = ghostCandles[0] ?? {}
  const ghostDirection = overlayDirection(ghost.direction ?? ghost.bias)
  let ghostConfidence = overlayNumber(ghost.confidence ?? ghost.probability ?? ghost.score, 0)
  if (ghostConfidence > 0 && ghostConfidence <= 1) ghostConfidence *= 100

  const hiddenContext = calculateHiddenSmcContextFromCandles(candles)

  const hiddenQuality = overlayNumber(hiddenContext.qualityScore, 0)

  const smcDirection =
    smcBull > smcBear ? 'bullish' : smcBear > smcBull ? 'bearish' : 'neutral'

  const bullScore =
    smcBull * 1.5 +
    obBull * 1.2 +
    (ghostDirection === 'bullish' ? Math.min(3, ghostConfidence / 35) : 0) +
    (hiddenQuality > 0 && smcDirection === 'bullish' ? Math.min(2, hiddenQuality / 5) : 0)
  const bearScore =
    smcBear * 1.5 +
    obBear * 1.2 +
    (ghostDirection === 'bearish' ? Math.min(3, ghostConfidence / 35) : 0) +
    (hiddenQuality > 0 && smcDirection === 'bearish' ? Math.min(2, hiddenQuality / 5) : 0)

  const netBias = bullScore - bearScore
  const direction = netBias >= 3 ? 'bullish' : netBias <= -3 ? 'bearish' : 'neutral'
  const targetPlan = buildVisualTargetPlan(
    candles,
    direction,
    payloadSources,
    String(payloadSources[0]?.symbol ?? payloadSources[0]?.ticker ?? 'MES1!')
  )
  const contextScore =
    smcQuality * 0.24 +
    obQuality * 0.2 +
    pdQuality * 0.16 +
    profileQuality * 0.14 +
    hiddenQuality * 0.16 +
    (ghostDirection !== 'neutral' ? 5 : 0) * 0.1

  let conflictScore = smcBull > 0 && smcBear > 0 ? 16 : 0
  if (ghostDirection !== 'neutral' && direction !== 'neutral' && ghostDirection !== direction) conflictScore += 18
  conflictScore = Math.max(0, Math.min(100, conflictScore))

  const scorecards = {
    version: 'smc-alpha-dlm-ob-ghost-scorecards-v3-no-nrtr-no-smma-ml',
    overall: {
      direction,
      netBias: Number(netBias.toFixed(2)),
      confirmationScore: Math.max(0, Math.min(100, Number((contextScore * 10).toFixed(2)))),
      conflictScore: Number(conflictScore.toFixed(2)),
      bullScore: Number(bullScore.toFixed(2)),
      bearScore: Number(bearScore.toFixed(2)),
      contextScore: Number(contextScore.toFixed(2)),
      entryPrice: targetPlan.entryPrice,
      targetPrice: targetPlan.targetPrice,
      stopPrice: targetPlan.stopPrice,
      riskReward: targetPlan.riskReward,
      targetSource: targetPlan.targetSource,
      stopSource: targetPlan.stopSource,
      targetDistance: targetPlan.targetDistance,
      stopDistance: targetPlan.stopDistance,
    },
    smc: {
      qualityScore: Number(smcQuality.toFixed(2)),
      bullishEvents: smcBull,
      bearishEvents: smcBear,
    },
    orderBlocks: {
      qualityScore: Number(obQuality.toFixed(2)),
      bullishZones: obBull,
      bearishZones: obBear,
    },
    pdZones: {
      qualityScore: Number(pdQuality.toFixed(2)),
      count: pdZones.length,
    },
    liquidityProfile: {
      qualityScore: Number(profileQuality.toFixed(2)),
      profileBinCount: profileBins.length,
      strongBins: profileBins.filter((bin) => scoreVisualProfileBin(bin) >= 4).length,
    },
    ghost: {
      direction: ghostDirection,
      confidence: Number(ghostConfidence.toFixed(2)),
      count: ghostCandles.length,
    },
    hiddenContext,
    activeFactors: {
      smcEvents: recentSmc.length,
      orderBlocks: recentObs.length,
      pdZones: pdZones.length,
      profileBins: profileBins.length,
      ghostCandles: ghostCandles.length,
      eqhEql: hiddenContext.eqhEqlCount,
      fvg: hiddenContext.fvgCount,
      sweeps: hiddenContext.sweepCount,
      displacement: hiddenContext.displacementCount,
      inducement: hiddenContext.inducementCount,
    },
  }

  const mlFeatures = {
    overallDirection: direction === 'bullish' ? 1 : direction === 'bearish' ? -1 : 0,
    overallNetBias: scorecards.overall.netBias,
    overallConfirmationScore: scorecards.overall.confirmationScore,
    overallConflictScore: scorecards.overall.conflictScore,
    smcQualityScore: smcQuality,
    orderBlockQualityScore: obQuality,
    pdQualityScore: pdQuality,
    liquidityProfileQualityScore: profileQuality,
    ghostDirection: ghostDirection === 'bullish' ? 1 : ghostDirection === 'bearish' ? -1 : 0,
    ghostConfidence,
    bullScore,
    bearScore,
    visualSmcCount: recentSmc.length,
    visualOrderBlockCount: recentObs.length,
    visualPdZoneCount: pdZones.length,
    visualProfileBinCount: profileBins.length,
    hiddenContextQualityScore: hiddenContext.qualityScore,
    eqhEqlCount: hiddenContext.eqhEqlCount,
    fairValueGapCount: hiddenContext.fvgCount,
    sweepCount: hiddenContext.sweepCount,
    displacementCount: hiddenContext.displacementCount,
    inducementCount: hiddenContext.inducementCount,
    nrtrStrategyContext: liveNrtrStrategyContext,
    mlHierarchy: 'SMC_ALPHA_DLM_ORDERBLOCKS_GHOST_ONLY',
    nrtrUsedForMl: 0,
    smmaUsedForMl: 0,
    entryPrice: targetPlan.entryPrice,
    targetPrice: targetPlan.targetPrice,
    stopPrice: targetPlan.stopPrice,
    takeProfitPrice: targetPlan.targetPrice,
    tp1: targetPlan.targetPrice,
    riskReward: targetPlan.riskReward,
    targetSource: targetPlan.targetSource,
    stopSource: targetPlan.stopSource,
    targetDistance: targetPlan.targetDistance,
    stopDistance: targetPlan.stopDistance,
  }

  return {
    nrtr: liveNrtrStrategyContext,
    nrtrStrategy: liveNrtrStrategyContext,
    nrtrMatrix: liveNrtrStrategyContext,
    scorecards,
    mlFeatures,
  }
}

function timeToUnixSeconds(time: DashboardCandle['time'] | undefined): number | null {
  if (typeof time === 'number') return time
  if (typeof time === 'string') {
    if (/^\d+$/.test(time)) return Number(time)
    const parsed = Date.parse(time)
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
  }

  return null
}

function timeframeToSeconds(timeframe: string): number {
  const normalized = normalizeTimeframe(timeframe)

  if (normalized.endsWith('m')) {
    return Math.max(1, Number(normalized.replace('m', '')) || 1) * 60
  }

  if (normalized.endsWith('h')) {
    return Math.max(1, Number(normalized.replace('h', '')) || 1) * 60 * 60
  }

  if (normalized.endsWith('d')) {
    return Math.max(1, Number(normalized.replace('d', '')) || 1) * 24 * 60 * 60
  }

  if (normalized.endsWith('w')) {
    return Math.max(1, Number(normalized.replace('w', '')) || 1) * 7 * 24 * 60 * 60
  }

  return 60
}


function isContinuousMarketSymbol(symbol: string) {
  const normalized = normalizeSymbol(symbol)
  return normalized === 'BTCUSD' || normalized === 'ETHUSD'
}

function normalizeLiveCandleToTimeframeBucket(rawCandle: any, timeframeSeconds: number) {
  const liveCandle = normalizeCandlePayloadItem(rawCandle)
  if (!liveCandle) return null

  const liveEpoch = liveCandleEpoch(liveCandle)
  if (liveEpoch <= 0 || timeframeSeconds <= 0) return liveCandle

  // Put live crypto/24-7 candles into the active chart bucket.
  // Example on 5m: 10:35:42 becomes the 10:35 candle.
  const bucketEpoch = Math.floor(liveEpoch / timeframeSeconds) * timeframeSeconds

  return {
    ...liveCandle,
    time: bucketEpoch as DashboardCandle['time'],
  }
}


function buildFallbackGhostCandle(
  previous: DashboardCandle | GhostCandle,
  direction: string | undefined,
  confidence: number | undefined,
  index: number,
  timeframeSeconds: number
): GhostCandle {
  const previousClose = toFiniteNumber(previous.close, 0)
  const previousOpen = toFiniteNumber(previous.open, previousClose)
  const previousHigh = toFiniteNumber(previous.high, Math.max(previousOpen, previousClose))
  const previousLow = toFiniteNumber(previous.low, Math.min(previousOpen, previousClose))
  const previousRange = Math.max(previousHigh - previousLow, Math.abs(previousClose * 0.001), 0.01)

  const normalizedDirection = String(direction ?? '').toLowerCase()
  const directionalMultiplier =
    normalizedDirection.includes('bear') ||
    normalizedDirection.includes('down') ||
    normalizedDirection.includes('sell')
      ? -1
      : normalizedDirection.includes('bull') ||
          normalizedDirection.includes('up') ||
          normalizedDirection.includes('buy')
        ? 1
        : previousClose >= previousOpen
          ? 1
          : -1

  const confidenceScale = Math.max(0.25, Math.min(1, toFiniteNumber(confidence, 35) / 100))
  const bodyMove = previousRange * 0.35 * confidenceScale * directionalMultiplier
  const open = previousClose
  const close = previousClose + bodyMove
  const wick = previousRange * 0.25

  const previousTime = timeToUnixSeconds(previous.time as DashboardCandle['time']) ?? Math.floor(Date.now() / 1000)

  return {
    time: (previousTime + timeframeSeconds * (index + 1)) as GhostCandle['time'],
    open,
    high: Math.max(open, close) + wick,
    low: Math.min(open, close) - wick,
    close,
    confidence,
    direction,
    source: 'python-fallback',
    label: `PY #${index + 1}`,
  }
}

function readPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    const number = toFiniteNumber(value, NaN)
    if (Number.isFinite(number) && number > 0) return number
  }

  return NaN
}

function readTargetPriceFromSource(source: any): number {
  if (!source || typeof source !== 'object') return NaN

  return readPositiveNumber(
    source.activeTargetPrice,
    source.finalTargetPrice,
    source.overallTargetPrice,
    source.targetPrice,
    source.takeProfitPrice,
    source.tp1,
    source.target,
    source.ghostOverlayTargetPrice,
    source.targetMl?.activeTargetPrice,
    source.targetMl?.finalTargetPrice,
    source.targetMl?.overallTargetPrice,
    source.targetMl?.targetPrice,
    source.targetPlan?.activeTargetPrice,
    source.targetPlan?.finalTargetPrice,
    source.targetPlan?.overallTargetPrice,
    source.targetPlan?.targetPrice,
    source.target?.activeTargetPrice,
    source.target?.finalTargetPrice,
    source.target?.overallTargetPrice,
    source.target?.targetPrice,
    source.target?.price,
    source.alignment?.targetPrice,
    source.mode?.targetPrice,
    source.projectionEngine?.activeTargetPrice,
    source.projectionEngine?.finalTargetPrice,
    source.projectionEngine?.overallTargetPrice,
    source.projectionEngine?.targetPrice,
    source.unifiedProjectionEngine?.activeTargetPrice,
    source.unifiedProjectionEngine?.finalTargetPrice,
    source.unifiedProjectionEngine?.overallTargetPrice,
    source.unifiedProjectionEngine?.targetPrice
  )
}

function getProjectionTargetPrice(
  engineState: PythonEngineState | ProjectionEngineState | null | undefined,
  ghosts: PythonGhostCandle[]
) {
  const raw = engineState as any
  const directTarget = readTargetPriceFromSource(raw)

  if (Number.isFinite(directTarget) && directTarget > 0) {
    return directTarget
  }

  for (let index = ghosts.length - 1; index >= 0; index -= 1) {
    const ghost = ghosts[index] as any
    const ghostTarget = readPositiveNumber(
      ghost.finalTargetPrice,
      ghost.overallTargetPrice,
      ghost.targetPrice,
      ghost.target,
      ghost.targetMl?.finalTargetPrice,
      ghost.targetMl?.overallTargetPrice,
      ghost.targetMl?.targetPrice,
      ghost.targetPlan?.finalTargetPrice,
      ghost.targetPlan?.overallTargetPrice,
      ghost.targetPlan?.targetPrice,
      ghost.ghostTargetPrice,
      ghost.projectedTargetPrice
    )

    if (Number.isFinite(ghostTarget) && ghostTarget > 0) {
      return ghostTarget
    }
  }

  const finalClose = readPositiveNumber(
    (ghosts[ghosts.length - 1] as any)?.close,
    (ghosts[ghosts.length - 1] as any)?.c
  )

  return Number.isFinite(finalClose) && finalClose > 0 ? finalClose : NaN
}

function getRecentCandleRange(candles: DashboardCandle[]) {
  const recent = candles.slice(-14)
  const ranges = recent
    .map((candle) => Math.abs(toFiniteNumber(candle.high, 0) - toFiniteNumber(candle.low, 0)))
    .filter((range) => Number.isFinite(range) && range > 0)

  if (ranges.length === 0) {
    const close = toFiniteNumber(candles[candles.length - 1]?.close, 0)
    return Math.max(Math.abs(close * 0.001), 0.01)
  }

  return ranges.reduce((sum, range) => sum + range, 0) / ranges.length
}

function buildConnectedGhostCandle({
  previousProjected,
  ghost,
  index,
  count,
  timeframeSeconds,
  finalTargetPrice,
  lastRealClose,
  recentRange,
}: {
  previousProjected: DashboardCandle | GhostCandle
  ghost: any
  index: number
  count: number
  timeframeSeconds: number
  finalTargetPrice: number
  lastRealClose: number
  recentRange: number
}): GhostCandle {
  const open = toFiniteNumber(previousProjected.close, lastRealClose)
  const previousTime =
    timeToUnixSeconds(previousProjected.time as DashboardCandle['time']) ??
    Math.floor(Date.now() / 1000)

  const rawOpen = readPositiveNumber(ghost.open, ghost.o)
  const rawClose = readPositiveNumber(ghost.close, ghost.c)
  const rawHigh = readPositiveNumber(ghost.high, ghost.h)
  const rawLow = readPositiveNumber(ghost.low, ghost.l)
  const rawRange =
    Number.isFinite(rawHigh) && Number.isFinite(rawLow) && rawHigh > rawLow
      ? rawHigh - rawLow
      : recentRange

  const hasTarget = Number.isFinite(finalTargetPrice) && finalTargetPrice > 0
  const progress = Math.max(0, Math.min(1, (index + 1) / Math.max(1, count)))

  let close: number

  if (hasTarget) {
    // Connected target path:
    // The target can be far away, but ghost candle #1 must start from the current candle,
    // and ghost candle #3 must reach the expected target level instead of teleporting away.
    close = lastRealClose + (finalTargetPrice - lastRealClose) * progress
  } else if (Number.isFinite(rawOpen) && Number.isFinite(rawClose)) {
    close = open + (rawClose - rawOpen)
  } else {
    const fallback = buildFallbackGhostCandle(
      previousProjected,
      ghost.direction,
      ghost.confidence,
      index,
      timeframeSeconds
    )
    close = fallback.close
  }

  const body = close - open
  const wick = Math.max(
    rawRange * 0.22,
    Math.abs(body) * 0.18,
    recentRange * 0.18,
    Math.abs(lastRealClose) * 0.00015
  )

  return {
    time: (previousTime + timeframeSeconds) as GhostCandle['time'],
    open,
    high: Math.max(open, close) + wick,
    low: Math.min(open, close) - wick,
    close,
    confidence: ghost.confidence,
    direction:
      body > 0
        ? 'bullish'
        : body < 0
          ? 'bearish'
          : ghost.direction,
    source: ghost.source ?? 'python-connected-target-path',
    label: ghost.label ?? `PY #${index + 1}`,
    reason: ghost.reason ?? 'Connected to current candle and stepped toward target',
  }
}

function copyGhostMetadata(projected: GhostCandle, ghost: any, finalTargetPrice: number) {
  // Preserve Target ML + Ghost ML metadata for projection tables/details.
  ;(projected as any).targetMlAligned = Boolean(ghost.targetMlAligned)
  ;(projected as any).targetPrice = Number.isFinite(finalTargetPrice)
    ? finalTargetPrice
    : toFiniteNumber(ghost.targetPrice, NaN)
  ;(projected as any).targetSource = ghost.targetSource
  ;(projected as any).targetConfidence = toFiniteNumber(ghost.targetConfidence, NaN)
  ;(projected as any).targetMlReady = Boolean(ghost.targetMlReady)
  ;(projected as any).ghostConfidenceBoost = toFiniteNumber(ghost.ghostConfidenceBoost, NaN)
  ;(projected as any).mlAdjusted = Boolean(ghost.mlAdjusted)
  ;(projected as any).mlReady = Boolean(ghost.mlReady)
  ;(projected as any).mlReason = ghost.mlReason
  ;(projected as any).mlConfidenceMultiplier = toFiniteNumber(ghost.mlConfidenceMultiplier, NaN)
  ;(projected as any).mlConfidenceBonus = toFiniteNumber(ghost.mlConfidenceBonus, NaN)
  ;(projected as any).mlProjectionMultiplier = toFiniteNumber(ghost.mlProjectionMultiplier, NaN)
  ;(projected as any).mlHierarchy = ghost.mlHierarchy
  ;(projected as any).nrtrUsedForMl = ghost.nrtrUsedForMl
  ;(projected as any).smmaUsedForMl = ghost.smmaUsedForMl
  ;(projected as any).connectedToCurrentCandle = true
  ;(projected as any).targetLevelOverlay = Number.isFinite(finalTargetPrice) ? finalTargetPrice : null

  return projected
}


function buildGhostCandlesForChart(
  engineState: PythonEngineState | null | undefined,
  chartCandles: DashboardCandle[],
  timeframe: string
): GhostCandle[] {
  const pythonGhostCandles = getPythonGhostCandles(engineState)

  if (chartCandles.length === 0 || pythonGhostCandles.length === 0) return []

  const timeframeSeconds = timeframeToSeconds(timeframe)
  const lastRealCandle = chartCandles[chartCandles.length - 1]
  const lastRealClose = toFiniteNumber(lastRealCandle.close, 0)
  const recentRange = getRecentCandleRange(chartCandles)
  const finalTargetPrice = getProjectionTargetPrice(engineState, pythonGhostCandles)
  let previousProjected: DashboardCandle | GhostCandle = lastRealCandle

  // Only draw the user-selected 3 ghost path by default.
  // The full backend can still return more, but the visible chart path should be a clean
  // current-candle → ghost #1 → ghost #2 → ghost #3 sequence.
  return pythonGhostCandles.slice(0, 3).map((ghost: any, index: number) => {
    const projected = buildConnectedGhostCandle({
      previousProjected,
      ghost,
      index,
      count: Math.min(3, pythonGhostCandles.length),
      timeframeSeconds,
      finalTargetPrice,
      lastRealClose,
      recentRange,
    })

    const withMetadata = copyGhostMetadata(projected, ghost, finalTargetPrice)

    previousProjected = withMetadata
    return withMetadata
  })
}


function useChartCandles(
  apiBaseUrl: string | undefined,
  isClient: boolean,
  symbol: string,
  timeframe: string,
  limit = 500,
  pollMs = 5000,
  enabled = true,
  priority: 'main' | 'mini' = 'main',
  onLivePriceUpdate?: (snapshot: LiveFeedSnapshot) => void
) {
  const [candles, setCandles] = useState<DashboardCandle[]>([])
  const [overlayPayload, setOverlayPayload] = useState<any | null>(null)
  const [unifiedIntelligence, setUnifiedIntelligence] = useState<any | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [debugLog, setDebugLog] = useState<ChartCandleDebugLogEntry[]>([])

  const addCandleDebugLog = useCallback((
    stage: string,
    detail: Record<string, any> = {},
    level: ChartCandleDebugLogEntry['level'] = 'info'
  ) => {
    const entry = {
      time: candleDebugTime(),
      level,
      stage,
      message: candleDebugMessage(stage, detail),
    }

    setDebugLog((current) => [...current, entry].slice(-CHART_CANDLE_DEBUG_MAX_ROWS))

    if (typeof console !== 'undefined') {
      const prefix = `[Chart candles] ${normalizeSymbol(symbol)} ${normalizeTimeframe(timeframe)} ${priority}`
      if (level === 'error') console.error(prefix, entry.message)
      else if (level === 'warn') console.warn(prefix, entry.message)
      else console.log(prefix, entry.message)
    }
  }, [priority, symbol, timeframe])

  useEffect(() => {
    if (!isClient || !apiBaseUrl) return

    const activeApiBaseUrl = apiBaseUrl
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null
    let liveEventSource: EventSource | null = null
    let liveSourceConnected = false
    let lastHistoricalFetchStartedAt = 0
    let lastHistoricalFetchSucceededAt = 0
    let lastLiveGapRepairFetchAt = 0
    let lastLiveGapRepairRequestedAt = 0
    let lastLiveGapRepairSkipLoggedAt = 0

    setDebugLog([])
    addCandleDebugLog('mount', { enabled, limit, pollMs })

    function stopPolling() {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    }

    function startPolling() {
      if (intervalId || liveSourceConnected) return
      intervalId = setInterval(fetchCandles, pollMs)
    }

    function applyCachedPayload(reason = 'cache-check') {
      const cached = readSharedCandleCache(symbol, timeframe, limit)
      if (!cached || cancelled) {
        addCandleDebugLog('cache-miss', { reason })
        return false
      }

      // Do not let mini charts reuse a one-candle live-only cache as if it were
      // historical data. When a mini timeframe is changed, this forces a real
      // historical candle request for that symbol/timeframe.
      const minimumReusableCandles = priority === 'mini' ? 20 : 10
      if (!Array.isArray(cached.candles) || cached.candles.length < minimumReusableCandles) {
        addCandleDebugLog('cache-skip-too-few-candles', {
          reason,
          count: cached.candles?.length ?? 0,
          required: minimumReusableCandles,
          source: cached.source,
        }, 'warn')
        return false
      }

      const cachedLivePrice = readSharedLivePriceCache(symbol)
      if (cachedLivePrice) {
        const syntheticLiveCandle = {
          symbol,
          timeframe,
          time: Math.floor(toFiniteNumber(cachedLivePrice.updatedAt, Date.now()) / 1000),
          open: cachedLivePrice.price,
          high: cachedLivePrice.price,
          low: cachedLivePrice.price,
          close: cachedLivePrice.price,
        }

        if (isLiveCandleTooFarFromHistory(symbol, cached.candles, syntheticLiveCandle)) {
          addCandleDebugLog('cache-skip-live-gap', {
            reason,
            count: cached.candles.length,
            live: cachedLivePrice.price,
            lastClose: cached.candles[cached.candles.length - 1]?.close,
          }, 'warn')
          return false
        }
      }

      addCandleDebugLog('plot-candles-from-cache', {
        reason,
        ...describeCandleRange(cached.candles),
        source: cached.source,
        provider: cached.provider,
      }, 'success')

      setCandles(cached.candles)
      setOverlayPayload(cached.overlayPayload ?? null)
      setUnifiedIntelligence(cached.unifiedIntelligence ?? null)

      if (cachedLivePrice) {
        onLivePriceUpdate?.(cachedLivePrice)
      }

      setErrorText('')
      return cached.candles.length > 0
    }

    function getFullSharedCacheEntry() {
      return SHARED_CANDLE_CACHE.get(sharedCandleKey(symbol, timeframe)) ?? null
    }

    function getHistoricalRefreshMs() {
      return priority === 'mini' ? MINI_HISTORICAL_REFRESH_MS : MAIN_HISTORICAL_REFRESH_MS
    }

    function shouldSkipHistoricalFetchAfterCache(reason: string, cachedWasApplied: boolean, force: boolean) {
      if (force || !cachedWasApplied) return false

      const fullCache = getFullSharedCacheEntry()
      if (!fullCache || !Array.isArray(fullCache.candles) || fullCache.candles.length === 0) return false

      const minimumReusableCandles = priority === 'mini' ? 20 : 10
      if (fullCache.candles.length < minimumReusableCandles) return false

      const now = Date.now()
      const cacheAgeMs = now - toFiniteNumber(fullCache.updatedAt, 0)
      const historicalAgeMs = lastHistoricalFetchSucceededAt > 0
        ? now - lastHistoricalFetchSucceededAt
        : cacheAgeMs
      const refreshMs = getHistoricalRefreshMs()

      if (reason === 'live-gap') {
        if (now - lastLiveGapRepairFetchAt < LIVE_GAP_REPAIR_COOLDOWN_MS) {
          addCandleDebugLog('fetch-skip-live-gap-cooldown', {
            cooldownMs: LIVE_GAP_REPAIR_COOLDOWN_MS,
            cacheCount: fullCache.candles.length,
            cacheSource: fullCache.source,
          }, 'warn')
          return true
        }

        lastLiveGapRepairFetchAt = now
        return false
      }

      if (priority === 'mini') {
        addCandleDebugLog('fetch-skip-mini-cache-good', {
          reason,
          cacheCount: fullCache.candles.length,
          cacheAgeMs,
          source: fullCache.source,
        })
        return true
      }

      if (historicalAgeMs < refreshMs) {
        addCandleDebugLog('fetch-skip-cache-fresh', {
          reason,
          cacheCount: fullCache.candles.length,
          historicalAgeMs,
          refreshMs,
          source: fullCache.source,
        })
        return true
      }

      return false
    }

    async function fetchCandles(force = false, reason = 'poll') {
      if (!enabled) {
        applyCachedPayload()
        setIsLoading(false)
        return
      }

      try {
        const cacheReason = force ? `before-force-fetch:${reason}` : `before-fetch:${reason}`
        const cachedWasApplied = applyCachedPayload(cacheReason)

        if (shouldSkipHistoricalFetchAfterCache(reason, cachedWasApplied, force)) {
          setIsLoading(false)
          return
        }

        setIsLoading(!cachedWasApplied)
        setErrorText('')

        lastHistoricalFetchStartedAt = Date.now()
        const fullCacheBeforeFetch = getFullSharedCacheEntry()

        addCandleDebugLog('fetch-start', {
          force,
          limit,
          priority,
          reason,
          existingCacheCount: fullCacheBeforeFetch?.candles?.length ?? 0,
          existingCacheLimit: fullCacheBeforeFetch?.limit ?? 0,
        })

        const nextPayload = await fetchSharedCandlePayload(activeApiBaseUrl, symbol, timeframe, limit, force)

        if (!cancelled) {
          const fullCacheAfterFetch = getFullSharedCacheEntry()
          lastHistoricalFetchSucceededAt = Date.now()

          addCandleDebugLog('plot-candles-from-fetch', {
            ...describeCandleRange(nextPayload.candles),
            source: nextPayload.source,
            provider: nextPayload.provider,
            displayLimit: limit,
            returnedCount: nextPayload.candles.length,
            cacheLimit: nextPayload.limit,
            storedCacheCount: fullCacheAfterFetch?.candles?.length ?? nextPayload.candles.length,
          }, 'success')
          setCandles(nextPayload.candles)

          // Keep overlay/intelligence stable during polling/history refresh.
          // Historical OHLCV usually returns candles only, so never replace a
          // valid canvas overlay with null.
          setOverlayPayload(nextPayload.overlayPayload ?? null)
          setUnifiedIntelligence(nextPayload.unifiedIntelligence ?? null)
        }
      } catch (error) {
        console.error('Lightweight chart candle sync error:', error)
        addCandleDebugLog('fetch-error', {
          error: error instanceof Error ? error.message : 'Candle API error',
        }, 'error')

        if (!cancelled) {
          const cachedWasApplied = applyCachedPayload('after-fetch-error')
          if (!cachedWasApplied) {
            setErrorText(error instanceof Error ? error.message : 'Candle API error')
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }


    function requestLiveGapRepairOnce(previousCandles: DashboardCandle[], liveCandle: any, streamSource: string) {
      const now = Date.now()
      const timeframeSeconds = timeframeToSeconds(timeframe)
      const gapSeconds = candleGapSeconds(previousCandles, liveCandle)
      const liveTooFarFromHistory = isLiveCandleTooFarFromHistory(symbol, previousCandles, liveCandle)
      const fullCache = getFullSharedCacheEntry()
      const liveClose = getCandleCloseValue(normalizeCandlePayloadItem(liveCandle))
      const lastClose = getCandleCloseValue(previousCandles[previousCandles.length - 1])

      if (!(gapSeconds > timeframeSeconds * 2 || liveTooFarFromHistory)) {
        return false
      }

      // SSE can send one message every second. When a history/live gap exists,
      // every message used to call fetchCandles(), which repeatedly re-plotted
      // the same cached 700 candles and spammed the log. Request one repair per
      // cooldown window, then keep the current candles visible until the next
      // repair attempt is allowed.
      if (now - lastLiveGapRepairRequestedAt < LIVE_GAP_REPAIR_COOLDOWN_MS) {
        if (now - lastLiveGapRepairSkipLoggedAt >= LIVE_GAP_REPAIR_LOG_THROTTLE_MS) {
          lastLiveGapRepairSkipLoggedAt = now
          addCandleDebugLog('live-gap-repair-wait', {
            streamSource,
            cooldownMs: LIVE_GAP_REPAIR_COOLDOWN_MS,
            cacheCount: fullCache?.candles?.length ?? previousCandles.length,
            cacheSource: fullCache?.source,
            gapSeconds,
            liveTooFarFromHistory,
            lastClose: Number.isFinite(lastClose) ? lastClose : undefined,
            liveClose: Number.isFinite(liveClose) ? liveClose : undefined,
          }, 'warn')
        }

        return true
      }

      lastLiveGapRepairRequestedAt = now
      addCandleDebugLog('live-gap-repair-request', {
        streamSource,
        cacheCount: fullCache?.candles?.length ?? previousCandles.length,
        cacheSource: fullCache?.source,
        gapSeconds,
        liveTooFarFromHistory,
        lastClose: Number.isFinite(lastClose) ? lastClose : undefined,
        liveClose: Number.isFinite(liveClose) ? liveClose : undefined,
      }, 'warn')
      fetchCandles(false, 'live-gap')
      return true
    }

    if (!enabled) {
      applyCachedPayload()
      setIsLoading(false)
      return () => {
        cancelled = true
      }
    }

    setCandles([])
    setOverlayPayload(null)
    setUnifiedIntelligence(null)
    fetchCandles(false, 'initial')
    startPolling()

    if (typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
      const params = new URLSearchParams({
        symbol: normalizeSymbol(symbol),
        timeframe: normalizeTimeframe(timeframe),
        limit: String(Math.max(1, limit)),
        pollSeconds: '1',
      })

      liveEventSource = new EventSource(`${activeApiBaseUrl}/api/live-feed/stream?${params.toString()}`)

      liveEventSource.onopen = () => {
        liveSourceConnected = true
        // Once WebSocket/SSE live candles are active, stop the historical
        // polling loop so old refreshes do not fight live candles or overlays.
        stopPolling()
      }

      liveEventSource.onmessage = (event) => {
        if (cancelled || !event.data) return

        try {
          const payload = JSON.parse(event.data)
          const liveCandle = extractLiveCandleFromStreamPayload(payload)
          if (!liveCandle) return

          const livePriceSnapshot = writeSharedLivePriceCache(
            extractLiveFeedPriceFromPayload(payload, liveCandle)
          )
          if (livePriceSnapshot) {
            onLivePriceUpdate?.(livePriceSnapshot)
          }

          setCandles((previousCandles) => {
            const timeframeSeconds = timeframeToSeconds(timeframe)

            if (requestLiveGapRepairOnce(previousCandles, liveCandle, 'message')) {
              return previousCandles
            }

            const merged = mergeLiveCandleIntoCandles(
              previousCandles,
              liveCandle,
              limit,
              timeframeSeconds
            )
            const cacheEntry = writeLiveCandleToSharedCache(
              symbol,
              timeframe,
              limit,
              liveCandle,
              overlayPayload,
              unifiedIntelligence,
              timeframeSeconds
            )

            if (cacheEntry) {
              setOverlayPayload(cacheEntry.overlayPayload ?? null)
              setUnifiedIntelligence(cacheEntry.unifiedIntelligence ?? null)
            }

            return merged
          })
        } catch {
          // Ignore malformed SSE heartbeat/data packets.
        }
      }

      liveEventSource.addEventListener('candle', (event: MessageEvent) => {
        if (cancelled || !event.data) return

        try {
          const payload = JSON.parse(event.data)
          const liveCandle = extractLiveCandleFromStreamPayload(payload)
          if (!liveCandle) return

          const livePriceSnapshot = writeSharedLivePriceCache(
            extractLiveFeedPriceFromPayload(payload, liveCandle)
          )
          if (livePriceSnapshot) {
            onLivePriceUpdate?.(livePriceSnapshot)
          }

          setCandles((previousCandles) => {
            const timeframeSeconds = timeframeToSeconds(timeframe)

            if (requestLiveGapRepairOnce(previousCandles, liveCandle, 'candle')) {
              return previousCandles
            }

            const merged = mergeLiveCandleIntoCandles(
              previousCandles,
              liveCandle,
              limit,
              timeframeSeconds
            )
            const cacheEntry = writeLiveCandleToSharedCache(
              symbol,
              timeframe,
              limit,
              liveCandle,
              overlayPayload,
              unifiedIntelligence,
              timeframeSeconds
            )

            if (cacheEntry) {
              setOverlayPayload(cacheEntry.overlayPayload ?? null)
              setUnifiedIntelligence(cacheEntry.unifiedIntelligence ?? null)
            }

            return merged
          })
        } catch {
          // Ignore malformed SSE heartbeat/data packets.
        }
      })

      liveEventSource.onerror = () => {
        // Restart historical polling only when the live stream disconnects.
        liveSourceConnected = false
        startPolling()
      }
    }

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
      if (liveEventSource) liveEventSource.close()
    }
  }, [addCandleDebugLog, apiBaseUrl, isClient, symbol, timeframe, limit, pollMs, enabled, priority, onLivePriceUpdate])

  return {
    candles,
    overlayPayload,
    unifiedIntelligence,
    isLoading,
    errorText,
    debugLog,
  }
}


function isStructureOverlayLine(line: any) {
  const type = String(line?.type ?? '').toLowerCase()
  const label = String(line?.label ?? line?.tag ?? '').toUpperCase()

  return (
    type === 'bos' ||
    type === 'choch' ||
    type === 'mss' ||
    label.includes('BOS') ||
    label.includes('CHOCH') ||
    label.includes('MSS')
  )
}

function isPdOverlayZone(zone: any) {
  const label = String(zone?.label ?? '').toLowerCase()
  const kind = String(zone?.kind ?? zone?.type ?? '').toLowerCase()

  return (
    label.includes('premium') ||
    label.includes('equilibrium') ||
    label.includes('discount') ||
    kind.includes('premium') ||
    kind.includes('equilibrium') ||
    kind.includes('discount')
  )
}

function isOrderBlockOverlayZone(zone: any) {
  const label = String(zone?.label ?? '').toLowerCase()
  const kind = String(zone?.kind ?? zone?.type ?? '').toLowerCase()
  const sourceEvent = String(zone?.sourceEvent ?? '').toLowerCase()

  return (
    label.includes('ob') ||
    label.includes('order block') ||
    kind.includes('ob') ||
    kind.includes('order') ||
    sourceEvent === 'bos' ||
    sourceEvent === 'choch' ||
    sourceEvent === 'mss' ||
    sourceEvent === 'ibos' ||
    sourceEvent === 'ichoch'
  )
}

function isSmcOverlayZone(zone: any) {
  const label = String(zone?.label ?? zone?.fullLabel ?? '').toLowerCase()
  const kind = String(zone?.kind ?? zone?.type ?? '').toLowerCase()
  const sourceEvent = String(zone?.sourceEvent ?? '').toLowerCase()

  return (
    isOrderBlockOverlayZone(zone) ||
    label.includes('bos') ||
    label.includes('choch') ||
    label.includes('mss') ||
    label.includes('wick rejection') ||
    kind.includes('bos') ||
    kind.includes('choch') ||
    kind.includes('mss') ||
    sourceEvent === 'bos' ||
    sourceEvent === 'choch' ||
    sourceEvent === 'mss' ||
    sourceEvent === 'ibos' ||
    sourceEvent === 'ichoch'
  )
}

function isSmcOverlayMarker(marker: any) {
  const type = String(marker?.type ?? '').toLowerCase()
  const label = String(marker?.label ?? marker?.text ?? marker?.tag ?? '').toLowerCase()
  const sourceEvent = String(marker?.sourceEvent ?? '').toLowerCase()

  return (
    type.includes('bos') ||
    type.includes('choch') ||
    type.includes('mss') ||
    label.includes('bos') ||
    label.includes('choch') ||
    label.includes('mss') ||
    label.includes('wick rejection') ||
    sourceEvent === 'bos' ||
    sourceEvent === 'choch' ||
    sourceEvent === 'mss' ||
    sourceEvent === 'ibos' ||
    sourceEvent === 'ichoch'
  )
}

function roundedOverlayPriceKey(value: any) {
  const price = Number(value)
  if (!Number.isFinite(price)) return 'na'

  // MES/ES run on quarter ticks. This fuzzy bucket also keeps stock/crypto
  // overlays stable enough while preventing near-identical OB duplicates.
  return String(Math.round(price * 4) / 4)
}


function getOverlayReferencePrice(candles: DashboardCandle[] | undefined, symbol?: string) {
  const latest = getLatestVisualClose(Array.isArray(candles) ? candles : [])
  if (latest && latest > 0) return latest

  const sharedLive = readSharedLivePriceCache(normalizeSymbol(symbol ?? ''))
  if (sharedLive?.price && sharedLive.price > 0) return sharedLive.price

  return 0
}

function isOverlayPriceNearChart(price: any, referencePrice: number, symbol?: string) {
  const value = overlayNumber(price, NaN)
  if (!Number.isFinite(value) || value <= 0) return false
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return true

  const normalized = normalizeSymbol(symbol ?? '')
  const pctDistance = Math.abs(value - referencePrice) / Math.max(referencePrice, 1)

  // MES/ES overlays must stay close to the visible futures scale. This prevents
  // BTCUSD premium/discount and DLM liquidity profile levels from remaining on
  // the MES chart after switching symbols.
  const maxPctDistance = normalized.includes('MES') || normalized.includes('ES') ? 0.18 : 0.35

  return pctDistance <= maxPctDistance
}

function getOverlayItemPriceCandidates(item: any) {
  if (!item || typeof item !== 'object') return [] as number[]

  return getVisualPriceCandidatesFromItem(item)
}

function isOverlayItemNearChart(item: any, referencePrice: number, symbol?: string) {
  const prices = getOverlayItemPriceCandidates(item)
  if (prices.length === 0) return true

  return prices.some((price) => isOverlayPriceNearChart(price, referencePrice, symbol))
}

function filterOverlayArrayForChartScale(items: any, referencePrice: number, symbol?: string) {
  if (!Array.isArray(items)) return items

  return items.filter((item) => isOverlayItemNearChart(item, referencePrice, symbol))
}

function sanitizeBackendOverlayPayloadForChart(
  backendPayload: any,
  chartCandles: DashboardCandle[] | undefined,
  symbol?: string
) {
  if (!backendPayload || typeof backendPayload !== 'object') return backendPayload

  const referencePrice = getOverlayReferencePrice(chartCandles, symbol)
  if (!referencePrice || referencePrice <= 0) return backendPayload

  const sanitized = {
    ...backendPayload,
    lines: filterOverlayArrayForChartScale(backendPayload.lines, referencePrice, symbol),
    zones: filterOverlayArrayForChartScale(backendPayload.zones, referencePrice, symbol),
    markers: filterOverlayArrayForChartScale(backendPayload.markers, referencePrice, symbol),
    smcEvents: filterOverlayArrayForChartScale(backendPayload.smcEvents, referencePrice, symbol),
    orderBlocks: filterOverlayArrayForChartScale(backendPayload.orderBlocks, referencePrice, symbol),
    liquidityEvents: filterOverlayArrayForChartScale(backendPayload.liquidityEvents, referencePrice, symbol),
    liquidityProfileBins: filterOverlayArrayForChartScale(backendPayload.liquidityProfileBins, referencePrice, symbol),
    dlmLevels: filterOverlayArrayForChartScale(backendPayload.dlmLevels, referencePrice, symbol),
    pdZones: filterOverlayArrayForChartScale(backendPayload.pdZones, referencePrice, symbol),
    premiumDiscountZones: filterOverlayArrayForChartScale(backendPayload.premiumDiscountZones, referencePrice, symbol),
    premiumDiscount: filterOverlayArrayForChartScale(backendPayload.premiumDiscount, referencePrice, symbol),
    pdLevels: filterOverlayArrayForChartScale(backendPayload.pdLevels, referencePrice, symbol),
  }

  const targetPrice = overlayNumber(
    sanitized.targetPrice ??
      sanitized.targetMl?.targetPrice ??
      sanitized.targetPlan?.targetPrice ??
      sanitized.finalTargetPrice ??
      sanitized.overallTargetPrice,
    NaN
  )

  if (Number.isFinite(targetPrice) && targetPrice > 0 && !isOverlayPriceNearChart(targetPrice, referencePrice, symbol)) {
    sanitized.targetPrice = undefined
    sanitized.finalTargetPrice = undefined
    sanitized.overallTargetPrice = undefined
    sanitized.targetMl = undefined
    sanitized.targetPlan = undefined
    sanitized.targetMlStatus = undefined
    sanitized.targetConfidence = undefined
  }

  sanitized.summary = {
    ...(backendPayload.summary ?? {}),
    chartScaleReferencePrice: referencePrice,
    chartScaleSymbol: normalizeSymbol(symbol ?? ''),
    backendOverlayScaleFiltered: true,
  }

  return sanitized
}

function mergeStableOverlayZones(fallbackPayload: any, backendPayload: any) {
  const fallbackZones = Array.isArray(fallbackPayload?.zones) ? fallbackPayload.zones : []
  const backendZones = Array.isArray(backendPayload?.zones) ? backendPayload.zones : []
  const backendOrderBlocks = Array.isArray(backendPayload?.orderBlocks) ? backendPayload.orderBlocks : []

  /**
   * Source-lock rule:
   * Only ONE SMC zone source is allowed to draw.
   *
   * - Fallback/frontend SMC is preferred because it is built from the exact
   *   candles currently on the chart.
   * - Backend SMC zones/orderBlocks are used only when fallback has none.
   * - Backend PD/profile/liquidity extras are still preserved.
   */
  const fallbackSmcZones = fallbackZones.filter(isSmcOverlayZone)
  const backendSmcZones = [
    ...backendZones.filter(isSmcOverlayZone),
    ...backendOrderBlocks.filter(isSmcOverlayZone),
  ]

  const fallbackPdZones = fallbackZones.filter(isPdOverlayZone)
  const backendPdZones = backendZones.filter(isPdOverlayZone)

  const backendExtraZones = backendZones.filter(
    (zone: any) => !isSmcOverlayZone(zone) && !isPdOverlayZone(zone)
  )

  const fallbackExtraZones = fallbackZones.filter(
    (zone: any) => !isSmcOverlayZone(zone) && !isPdOverlayZone(zone)
  )

  const smcZoneSource =
    fallbackSmcZones.length > 0 ? fallbackSmcZones : backendSmcZones

  // Prefer backend PD zones because backend/unified payload often owns
  // Premium / Equilibrium / Discount and liquidity context.
  const pdZoneSource =
    backendPdZones.length > 0 ? backendPdZones : fallbackPdZones

  const merged: any[] = []
  const seen = new Set<string>()

  for (const zone of [
    ...smcZoneSource,
    ...pdZoneSource,
    ...backendExtraZones,
    ...fallbackExtraZones,
  ]) {
    if (!zone || typeof zone !== 'object') continue

    const high = Number(zone.high ?? zone.top)
    const low = Number(zone.low ?? zone.bottom)

    if (!Number.isFinite(high) || !Number.isFinite(low)) continue

    const label = String(zone.label ?? zone.fullLabel ?? zone.kind ?? zone.type ?? '')
    const kind = String(zone.kind ?? zone.type ?? '')
    const direction = String(zone.direction ?? 'neutral')

    const key = [
      kind.toLowerCase(),
      label.toLowerCase(),
      direction.toLowerCase(),
      roundedOverlayPriceKey(high),
      roundedOverlayPriceKey(low),
      zone.startIndex ?? zone.startTime ?? '',
      zone.endIndex ?? zone.endTime ?? '',
    ].join('|')

    if (seen.has(key)) continue

    seen.add(key)
    merged.push({
      ...zone,
      id: String(zone.id ?? key),
      label,
      kind,
      type:
        zone.type ??
        (kind.toLowerCase().includes('ob')
          ? direction === 'bearish'
            ? 'supply'
            : 'demand'
          : 'neutralPressure'),
      direction:
        direction === 'bullish' || direction === 'bearish'
          ? direction
          : 'neutral',
      high,
      low,
      top: high,
      bottom: low,
    })
  }

  const nonPdZones = merged.filter((zone) => !isPdOverlayZone(zone))
  const pdZones = merged.filter(isPdOverlayZone)

  return [...nonPdZones, ...pdZones]
}


function mergeStableOverlayLines(fallbackPayload: any, backendPayload: any) {
  const fallbackLines = Array.isArray(fallbackPayload?.lines) ? fallbackPayload.lines : []
  const backendLines = Array.isArray(backendPayload?.lines) ? backendPayload.lines : []

  /**
   * Source-lock rule:
   * BOS / CHoCH / MSS structure lines can come from fallback OR backend,
   * never both. Backend non-structure extras can still pass through.
   */
  const fallbackStructureLines = fallbackLines.filter(isStructureOverlayLine)
  const backendStructureLines = backendLines.filter(isStructureOverlayLine)
  const backendOtherLines = backendLines.filter((line: any) => !isStructureOverlayLine(line))
  const fallbackOtherLines = fallbackLines.filter((line: any) => !isStructureOverlayLine(line))

  const structureSource =
    fallbackStructureLines.length > 0 ? fallbackStructureLines : backendStructureLines

  const merged: any[] = []
  const seen = new Set<string>()

  for (const line of [
    ...structureSource,
    ...backendOtherLines,
    ...fallbackOtherLines,
  ]) {
    if (!line || typeof line !== 'object') continue

    const price = Number(line.price ?? line.brokenLevel)
    if (!Number.isFinite(price)) continue

    const label = String(line.label ?? line.tag ?? line.type ?? '')
    const type = String(line.type ?? '').toLowerCase()

    const key = [
      type,
      label.toLowerCase(),
      roundedOverlayPriceKey(price),
      line.fromIndex ?? line.pivotIndex ?? line.fromTime ?? '',
      line.breakIndex ?? line.index ?? line.time ?? '',
    ].join('|')

    if (seen.has(key)) continue

    seen.add(key)
    merged.push(line)
  }

  return merged
}


function mergeStableOverlayPayloads(fallbackPayload: any, backendPayload: any, chartCandles?: DashboardCandle[], symbol?: string) {
  if (!fallbackPayload && !backendPayload) return null
  if (!backendPayload) return fallbackPayload

  const safeBackendPayload = sanitizeBackendOverlayPayloadForChart(backendPayload, chartCandles, symbol)

  if (!fallbackPayload) return safeBackendPayload

  const fallbackMarkers = Array.isArray(fallbackPayload.markers) ? fallbackPayload.markers : []
  const backendMarkers = Array.isArray(safeBackendPayload.markers) ? safeBackendPayload.markers : []

  /**
   * Source-lock markers too. Some BOS/CHoCH labels can be rendered as
   * markers instead of structure lines, so marker merging must follow the
   * same SMC one-source rule.
   */
  const fallbackSmcMarkers = fallbackMarkers.filter(isSmcOverlayMarker)
  const backendSmcMarkers = backendMarkers.filter(isSmcOverlayMarker)
  const backendOtherMarkers = backendMarkers.filter((marker: any) => !isSmcOverlayMarker(marker))
  const fallbackOtherMarkers = fallbackMarkers.filter((marker: any) => !isSmcOverlayMarker(marker))

  const smcMarkerSource =
    fallbackSmcMarkers.length > 0 ? fallbackSmcMarkers : backendSmcMarkers

  const mergedMarkers: any[] = []
  const seenMarkers = new Set<string>()

  for (const marker of [
    ...smcMarkerSource,
    ...backendOtherMarkers,
    ...fallbackOtherMarkers,
  ]) {
    if (!marker || typeof marker !== 'object') continue

    const price = Number(marker.price ?? marker.value ?? marker.y)
    const key = [
      String(marker.type ?? '').toLowerCase(),
      String(marker.label ?? marker.text ?? marker.tag ?? '').toLowerCase(),
      Number.isFinite(price) ? roundedOverlayPriceKey(price) : 'na',
      marker.time ?? '',
      marker.index ?? '',
    ].join('|')

    if (seenMarkers.has(key)) continue

    seenMarkers.add(key)
    mergedMarkers.push(marker)
  }

  const lines = mergeStableOverlayLines(fallbackPayload, safeBackendPayload)
  const zones = mergeStableOverlayZones(fallbackPayload, safeBackendPayload)

  return {
    ...safeBackendPayload,
    // Keep fallback SMC analysis attached because it is the current stable SMC layer.
    smc: fallbackPayload.smc ?? safeBackendPayload.smc,
    alphaX: safeBackendPayload.alphaX ?? fallbackPayload.alphaX,

    // Final merged draw sources.
    lines,
    zones,
    markers: mergedMarkers.slice(-60),

    // Preserve backend unified extras.
    smcEvents: fallbackPayload.smcEvents ?? safeBackendPayload.smcEvents,
    orderBlocks: zones.filter(isOrderBlockOverlayZone),
    liquidityEvents: safeBackendPayload.liquidityEvents ?? fallbackPayload.liquidityEvents,
    liquidityProfileBins:
      safeBackendPayload.liquidityProfileBins ?? fallbackPayload.liquidityProfileBins,
    dlmLevels: safeBackendPayload.dlmLevels ?? fallbackPayload.dlmLevels,
    ghostCandles: safeBackendPayload.ghostCandles ?? fallbackPayload.ghostCandles,
    targetMl: safeBackendPayload.targetMl ?? safeBackendPayload.targetPlan ?? fallbackPayload.targetMl ?? fallbackPayload.targetPlan,
    targetPlan: safeBackendPayload.targetPlan ?? safeBackendPayload.targetMl ?? fallbackPayload.targetPlan ?? fallbackPayload.targetMl,
    targetMlStatus: safeBackendPayload.targetMlStatus ?? fallbackPayload.targetMlStatus,
    targetPrice: safeBackendPayload.targetPrice ?? safeBackendPayload.targetMl?.targetPrice ?? safeBackendPayload.targetPlan?.targetPrice,
    targetConfidence: safeBackendPayload.targetConfidence ?? safeBackendPayload.targetMl?.targetConfidence ?? safeBackendPayload.targetPlan?.targetConfidence,

    summary: {
      ...(fallbackPayload.summary ?? {}),
      ...(safeBackendPayload.summary ?? {}),
      lineCount: lines.length,
      zoneCount: zones.length,
      markerCount: mergedMarkers.length,
      overlayMergeMode: 'source-locked-smc-plus-backend-pd-profile',
    },
  }
}

type LightweightChartPanelProps = {
  title: string
  symbol: string
  timeframe: string
  candleMode: CandleModeLabel
  ghostCandles?: GhostCandle[]
  engineState?: PythonEngineState | null
  showOverlayStatus?: boolean
  showOverlayLines?: boolean
  height: number
  compact?: boolean
  apiBaseUrl?: string
  isClient: boolean
  enabled?: boolean
  priority?: 'main' | 'mini'
  onChange: (selection: ChartSelection) => void
  onScorecardsUpdate?: (scorecards: any, mlFeatures: any) => void
  onCandlesUpdate?: (candles: DashboardCandle[]) => void
  onOverlayPayloadUpdate?: (overlayPayload: any | null) => void
  onUnifiedIntelligenceUpdate?: (unifiedIntelligence: any | null) => void
  smmaLength?: number
  nrtrMode?: NrtrOverlayMode
  nrtrAtrLength?: number
  nrtrAtrMultiplier?: number
  nrtrPercent?: number
  showNrtrExitLabels?: boolean
  onIndicatorSettingsChange?: (settings: ChartStrategySettings) => void
  onSaveConfig?: () => void
  saveStatus?: string
  livePrice?: number | null
  onLivePriceUpdate?: (snapshot: LiveFeedSnapshot) => void
}

function LightweightChartPanel({
  title,
  symbol,
  timeframe,
  candleMode,
  ghostCandles = [],
  engineState = null,
  showOverlayStatus = false,
  showOverlayLines = false,
  height,
  compact = false,
  apiBaseUrl,
  isClient,
  enabled = true,
  priority = compact ? 'mini' : 'main',
  onChange,
  onScorecardsUpdate,
  onCandlesUpdate,
  onOverlayPayloadUpdate,
  onUnifiedIntelligenceUpdate,
  smmaLength = 20,
  nrtrMode = 'ATR-Based',
  nrtrAtrLength = 14,
  nrtrAtrMultiplier = 3,
  nrtrPercent = 0.25,
  showNrtrExitLabels = true,
  onIndicatorSettingsChange,
  onSaveConfig,
  saveStatus,
  livePrice,
  onLivePriceUpdate,
}: LightweightChartPanelProps) {
  const normalizedSymbol = normalizeSymbol(symbol)
  const normalizedTimeframe = normalizeTimeframe(timeframe)
  const { candles, overlayPayload: unifiedOverlayPayload, unifiedIntelligence, isLoading, errorText, debugLog } = useChartCandles(
    apiBaseUrl,
    isClient,
    normalizedSymbol,
    normalizedTimeframe,
    compact ? 300 : 700,
    compact ? 10000 : 5000,
    enabled,
    priority,
    onLivePriceUpdate
  )

  const updateIndicatorSettings = (patch: Partial<ChartStrategySettings>) => {
    if (!onIndicatorSettingsChange) return

    onIndicatorSettingsChange({
      smmaLength,
      nrtrMode,
      nrtrAtrLength,
      nrtrAtrMultiplier,
      nrtrPercent,
      showNrtrExitLabels,
      ...patch,
    })
  }

  useEffect(() => {
    onCandlesUpdate?.(candles)
  }, [candles, onCandlesUpdate])

  useEffect(() => {
    onOverlayPayloadUpdate?.(unifiedOverlayPayload)
  }, [onOverlayPayloadUpdate, unifiedOverlayPayload])

  useEffect(() => {
    onUnifiedIntelligenceUpdate?.(unifiedIntelligence)
  }, [onUnifiedIntelligenceUpdate, unifiedIntelligence])

  const chartGhostCandles = useMemo(() => {
    if (ghostCandles.length > 0) return ghostCandles
    if (compact) return []

    const engineGhostCandles = buildGhostCandlesForChart(engineState, candles, normalizedTimeframe)

    if (engineGhostCandles.length > 0) {
      return engineGhostCandles
    }

    const unifiedGhostCandles = getGhostCandlesFromUnifiedIntelligence(unifiedIntelligence)

    if (unifiedGhostCandles.length > 0) {
      return buildGhostCandlesForChart(
        { ghostCandles: unifiedGhostCandles },
        candles,
        normalizedTimeframe
      )
    }

    const overlayGhostCandles = getGhostCandlesFromUnifiedOverlay(unifiedOverlayPayload)

    if (overlayGhostCandles.length > 0) {
      return buildGhostCandlesForChart(
        { ghostCandles: overlayGhostCandles },
        candles,
        normalizedTimeframe
      )
    }

    return []
  }, [candles, compact, engineState, ghostCandles, normalizedTimeframe, unifiedIntelligence, unifiedOverlayPayload])

  const overlayStableCandleKey = useMemo(() => {
    if (candles.length === 0) return 'empty'

    // Use the previous candle as the overlay anchor. The current live candle can
    // change many times per minute; overlays should not rebuild on every tick.
    const anchorIndex = candles.length > 1 ? candles.length - 2 : candles.length - 1
    const anchor = candles[anchorIndex]
    const anchorTime = anchor ? String(anchor.time) : 'na'
    const anchorClose = anchor ? Number(anchor.close).toFixed(8) : 'na'

    return `${candles.length}:${anchorTime}:${anchorClose}`
  }, [candles])

  const overlayBaseCandles = useMemo(() => {
    if (candles.length <= 1) return candles

    // Exclude the still-forming live candle from fallback SMC/AlphaX overlay
    // calculations. This keeps OB/zones/profile from blinking intrabar.
    return candles.slice(0, -1)
  }, [candles, overlayStableCandleKey])

  const overlayPayload = useMemo(() => {
    if (!showOverlayLines || compact) return null

    const backendOverlayPayload = getUnifiedOverlayPayload(
      unifiedOverlayPayload,
      engineState
    )

    const fallbackPayload = overlayBaseCandles.length >= 20
      ? buildChartOverlayPayload(dashboardCandlesToOverlayCandles(overlayBaseCandles), {
          smcSwingLength: 3,
          smcUseCloseBreak: true,
          alphaXLookback: 20,
          alphaXRejectionWickPercent: 45,
          maxLines: 12,
          maxZones: 12,
          maxMarkers: 20,
        })
      : null

    /**
     * Critical rule:
     * Do not let PD/profile loading replace SMC drawings.
     *
     * Backend overlay provides:
     * - Premium / Equilibrium / Discount
     * - Liquidity profile bars
     * - DLM / ghost extras
     *
     * Fallback SMC provides the currently stable:
     * - BOS / CHoCH lines
     * - order blocks
     */
    return mergeStableOverlayPayloads(fallbackPayload, backendOverlayPayload, overlayBaseCandles, symbol)
  }, [compact, engineState, overlayBaseCandles, showOverlayLines, symbol, unifiedOverlayPayload])

  const scorecards = useMemo(() => {
    return getScorecardsFromOverlayPayload(
      unifiedOverlayPayload,
      engineState,
      overlayPayload
    )
  }, [candles, engineState, overlayPayload, unifiedOverlayPayload])

  const mlFeatures = useMemo(() => {
    return getMlFeaturesFromOverlayPayload(
      unifiedOverlayPayload,
      engineState,
      overlayPayload
    )
  }, [engineState, overlayPayload, unifiedOverlayPayload])

  const visualScorecardBundle = useMemo(() => {
    return buildVisualOverlayScorecards(
      candles,
      overlayPayload,
      unifiedOverlayPayload,
      engineState
    )
  }, [candles, engineState, overlayPayload, unifiedOverlayPayload])

  const chartDataReady = candles.length >= 20

  const scorecardsForPanel = useMemo(() => {
    if (!chartDataReady) return null

    const visualScorecards = visualScorecardBundle?.scorecards
    const liveScorecards = scorecards as any

    if (!visualScorecards) return liveScorecards ?? null

    return {
      ...(liveScorecards ?? {}),
      ...visualScorecards,
      overall: {
        ...(liveScorecards?.overall ?? {}),
        ...visualScorecards.overall,
      },
      smc: {
        ...(liveScorecards?.smc ?? {}),
        ...visualScorecards.smc,
      },
      orderBlocks: {
        ...(liveScorecards?.orderBlocks ?? {}),
        ...visualScorecards.orderBlocks,
      },
      pdZones: {
        ...(liveScorecards?.pdZones ?? {}),
        ...visualScorecards.pdZones,
      },
      liquidityProfile: {
        ...(liveScorecards?.liquidityProfile ?? {}),
        ...visualScorecards.liquidityProfile,
      },
      ghost: {
        ...(liveScorecards?.ghost ?? {}),
        ...visualScorecards.ghost,
      },
      activeFactors: {
        ...(liveScorecards?.activeFactors ?? {}),
        ...visualScorecards.activeFactors,
      },
    }
  }, [chartDataReady, scorecards, visualScorecardBundle])

  const mlFeaturesForPanel = useMemo(() => {
    if (!chartDataReady) return null

    const merged = {
      ...(mlFeatures as any ?? {}),
      ...(visualScorecardBundle?.mlFeatures ?? {}),
    }

    return hasUsefulObjectKeys(merged) ? merged : null
  }, [chartDataReady, mlFeatures, visualScorecardBundle])

  useEffect(() => {
    if (compact || !onScorecardsUpdate || !chartDataReady) return

    if (scorecardsForPanel || mlFeaturesForPanel) {
      onScorecardsUpdate(scorecardsForPanel, mlFeaturesForPanel)
    }
  }, [chartDataReady, compact, mlFeaturesForPanel, onScorecardsUpdate, scorecardsForPanel])

  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800/80 p-4 shadow-xl">
      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-300">
            {title}
          </h2>
          <p className="text-xs text-gray-500">
            Lightweight Charts • Raw OHLC truth • HA visual toggle
          </p>
          {livePrice && livePrice > 0 ? (
            <div className="mt-1 text-[11px] font-black text-emerald-300">
              Shared live price: {formatSharedLivePrice(livePrice)}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={normalizedSymbol}
            onChange={(event) =>
              onChange({
                symbol: normalizeSymbol(event.target.value),
                timeframe: normalizedTimeframe,
                candleMode,
              })
            }
            className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-amber-400"
          >
            {chartSymbols.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select
            value={normalizedTimeframe}
            onChange={(event) =>
              onChange({
                symbol: normalizedSymbol,
                timeframe: normalizeTimeframe(event.target.value),
                candleMode,
              })
            }
            className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-amber-400"
          >
            {chartTimeframes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select
            value={candleMode}
            onChange={(event) =>
              onChange({
                symbol: normalizedSymbol,
                timeframe: normalizedTimeframe,
                candleMode: event.target.value as CandleModeLabel,
              })
            }
            className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-amber-400"
          >
            <option value="Regular">Regular</option>
            <option value="Heikin Ashi">Heikin Ashi</option>
          </select>
        </div>
      </div>

      {onIndicatorSettingsChange && (
        <div className="mb-3 rounded-xl border border-dark-700 bg-dark-900/50 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Chart Strategy Settings
              </div>
              <div className="text-[10px] text-gray-500">
                {compact ? 'Mini chart confirmation uses NRTR flip or SMMA direction only.' : 'Main chart controls entries, exits, and NRTR table.'}
              </div>
            </div>

            {onSaveConfig && (
              <div className="flex items-center gap-2">
                {saveStatus && (
                  <span className="text-[10px] font-semibold text-emerald-300">
                    {saveStatus}
                  </span>
                )}
                <button
                  type="button"
                  onClick={onSaveConfig}
                  className="rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-emerald-300 hover:bg-emerald-500 hover:text-black"
                >
                  Save
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <label className="flex flex-col gap-1 text-[10px] text-gray-400">
              <span>SMMA</span>
              <input
                type="number"
                min={1}
                max={500}
                value={smmaLength}
                onChange={(event) => updateIndicatorSettings({ smmaLength: Math.max(1, Math.floor(Number(event.target.value) || 1)) })}
                className="rounded-lg border border-dark-600 bg-dark-900 px-2 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-amber-400"
              />
            </label>

            <label className="flex flex-col gap-1 text-[10px] text-gray-400">
              <span>NRTR mode</span>
              <select
                value={nrtrMode}
                onChange={(event) => updateIndicatorSettings({ nrtrMode: event.target.value as NrtrOverlayMode })}
                className="rounded-lg border border-dark-600 bg-dark-900 px-2 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-amber-400"
              >
                <option value="ATR-Based">ATR-Based</option>
                <option value="Percentage">Percentage</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[10px] text-gray-400">
              <span>ATR length</span>
              <input
                type="number"
                min={1}
                max={200}
                value={nrtrAtrLength}
                onChange={(event) => updateIndicatorSettings({ nrtrAtrLength: Math.max(1, Math.floor(Number(event.target.value) || 1)) })}
                className="rounded-lg border border-dark-600 bg-dark-900 px-2 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-amber-400"
              />
            </label>

            <label className="flex flex-col gap-1 text-[10px] text-gray-400">
              <span>ATR mult</span>
              <input
                type="number"
                min={0.1}
                max={20}
                step={0.05}
                value={nrtrAtrMultiplier}
                onChange={(event) => updateIndicatorSettings({ nrtrAtrMultiplier: Math.max(0.1, Number(event.target.value) || 0.1) })}
                className="rounded-lg border border-dark-600 bg-dark-900 px-2 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-amber-400"
              />
            </label>

            <label className="flex flex-col gap-1 text-[10px] text-gray-400">
              <span>NRTR %</span>
              <input
                type="number"
                min={0.01}
                max={20}
                step={0.01}
                value={nrtrPercent}
                onChange={(event) => updateIndicatorSettings({ nrtrPercent: Math.max(0.01, Number(event.target.value) || 0.01) })}
                className="rounded-lg border border-dark-600 bg-dark-900 px-2 py-2 text-xs font-semibold text-gray-200 outline-none focus:border-amber-400"
              />
            </label>

            {!compact && (
              <label className="flex flex-col gap-1 text-[10px] text-gray-400">
                <span>Exit labels</span>
                <button
                  type="button"
                  onClick={() => updateIndicatorSettings({ showNrtrExitLabels: !showNrtrExitLabels })}
                  className={`rounded-lg border px-2 py-2 text-xs font-black uppercase tracking-wide ${
                    showNrtrExitLabels
                      ? 'border-amber-400/40 bg-amber-400/15 text-amber-300'
                      : 'border-dark-600 bg-dark-900 text-gray-400'
                  }`}
                >
                  {showNrtrExitLabels ? 'On' : 'Off'}
                </button>
              </label>
            )}
          </div>
        </div>
      )}

      {errorText && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {errorText}
        </div>
      )}

      {!enabled && candles.length === 0 && (
        <div className="mb-3 rounded-lg border border-blue-400/20 bg-blue-400/10 px-3 py-2 text-xs text-blue-300">
          Waiting for main chart candles first...
        </div>
      )}

      {isLoading && candles.length === 0 && (
        <div className="mb-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          Loading candles...
        </div>
      )}

      {debugLog.length > 0 && (
        <details
          className="mb-3 rounded-lg border border-blue-400/20 bg-blue-400/10 px-3 py-2 text-[10px] text-blue-100"
          open={!compact}
        >
          <summary className="cursor-pointer select-none font-black uppercase tracking-wide text-blue-300">
            Chart candle load log • {normalizedSymbol} • {normalizedTimeframe} • {candles.length} plotted
          </summary>
          <div className="mt-2 max-h-40 space-y-1 overflow-auto font-mono leading-4">
            {debugLog.map((item, index) => (
              <div
                key={`${item.time}-${item.stage}-${index}`}
                className={
                  item.level === 'error'
                    ? 'text-red-300'
                    : item.level === 'warn'
                      ? 'text-amber-300'
                      : item.level === 'success'
                        ? 'text-emerald-300'
                        : 'text-blue-100'
                }
              >
                <span className="text-gray-500">{item.time}</span> {item.message}
              </div>
            ))}
          </div>
        </details>
      )}

      <LightweightCandlestickChart
        candles={candles}
        ghostCandles={chartGhostCandles}
        overlayLines={overlayPayload?.lines ?? []}
        overlayPayload={overlayPayload}
        showOverlayLines={showOverlayLines}
        showCanvasOverlay={showOverlayLines}
        showOverlayZones={showOverlayLines}
        showOverlayLabels={showOverlayLines}
        showLiquidityProfile={showOverlayLines}
        // Main and mini charts all show the same user-controlled SMMA + NRTR.
        // Mini charts use NRTR flip state only; NRTR exit logic/table stays off there.
        showSmma20
        smmaLength={smmaLength}
        showNrtr
        nrtrMode={nrtrMode}
        nrtrAtrLength={nrtrAtrLength}
        nrtrAtrMultiplier={nrtrAtrMultiplier}
        nrtrPercent={nrtrPercent}
        showNrtrExitLabels={!compact && showNrtrExitLabels}
        nrtrExitMode={compact ? 'Off' : 'Pivot Pullback'}
        showNrtrStats
        nrtrStatsCollapsedOnly={compact}
        mode={candleModeToLightweightMode(candleMode)}
        height={height}
        symbol={normalizedSymbol}
        timeframe={normalizedTimeframe}
      />

      {showOverlayStatus && (
        <div className="mt-4 space-y-4">
          <ChartOverlayStatusPanel
            candles={dashboardCandlesToOverlayCandles(candles)}
            title="Unified Python SMC + AlphaX Overlay"
            compact
          />

          {!compact && (
            chartDataReady && (scorecardsForPanel || mlFeaturesForPanel) ? (
              <ScorecardsPanel
                scorecards={scorecardsForPanel as any}
                mlFeatures={mlFeaturesForPanel as any}
                overlayPayload={overlayPayload as any}
                overlaySources={[
                  unifiedOverlayPayload as any,
                  engineState as any,
                ]}
              />
            ) : (
              <DashboardWaitingCard
                title={chartDataReady ? 'Waiting for ML scorecards...' : 'Waiting for main candles...'}
                message={
                  chartDataReady
                    ? 'The main chart has candles. ML scorecards will appear after the overlay engine creates scorecards from those loaded candles.'
                    : 'ML scorecards are paused until the main chart has at least 20 candles. This prevents fallback bull/bear values from showing before candle data exists.'
                }
              />
            )
          )}
        </div>
      )}
    </div>
  )
}

function getScorecardDirection(value: unknown): 'bullish' | 'bearish' | 'neutral' {
  const text = String(value ?? '').toLowerCase()

  if (text.includes('bull') || text.includes('buy') || text.includes('long')) return 'bullish'
  if (text.includes('bear') || text.includes('sell') || text.includes('short')) return 'bearish'

  return 'neutral'
}

function scorecardPct(value: unknown, multiplier = 1) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(100, Math.round(number * multiplier)))
}

function getScorecardSignalText(direction: string, fallback = 'Neutral') {
  if (direction === 'bullish') return 'Bullish'
  if (direction === 'bearish') return 'Bearish'
  return fallback
}

function buildScorecardSignalPatch(scorecards: any, mlFeatures: any) {
  const overallDirection = getScorecardDirection(scorecards?.overall?.direction)
  const smcDirection = getScorecardDirection(
    Number(scorecards?.smc?.bullishEvents ?? 0) > Number(scorecards?.smc?.bearishEvents ?? 0)
      ? 'bullish'
      : Number(scorecards?.smc?.bearishEvents ?? 0) > Number(scorecards?.smc?.bullishEvents ?? 0)
        ? 'bearish'
        : overallDirection
  )
  const profileDirection = getScorecardDirection(
    scorecards?.liquidityProfile?.direction ??
      scorecards?.pdZones?.direction ??
      overallDirection
  )
  const ghostDirection = getScorecardDirection(scorecards?.ghost?.direction)
  // NRTR is intentionally not part of the ML hierarchy.
  // It remains a chart/strategy entry-exit tool only.
  const nrtrDirection = 'neutral'

  const confirmation = scorecardPct(scorecards?.overall?.confirmationScore)
  const bullScore = scorecardPct(scorecards?.overall?.bullScore, 10)
  const bearScore = scorecardPct(scorecards?.overall?.bearScore, 10)
  const smcStrength = scorecardPct(scorecards?.smc?.qualityScore, 10)
  const profileStrength = scorecardPct(scorecards?.liquidityProfile?.qualityScore, 10)
  const pdStrength = scorecardPct(scorecards?.pdZones?.qualityScore, 10)
  const obStrength = scorecardPct(scorecards?.orderBlocks?.qualityScore, 10)
  const ghostConfidence = scorecardPct(scorecards?.ghost?.confidence)
  const hiddenStrength = scorecardPct(scorecards?.hiddenContext?.qualityScore, 10)

  const alphaStrength = Math.max(profileStrength, pdStrength)
  const coreDirection = overallDirection === 'neutral' ? smcDirection : overallDirection

  return {
    chartScorecards: scorecards,
    chartMlFeatures: mlFeatures,
    scorecardLinked: true,

    confidence: confirmation,
    bullScore: Math.max(bullScore, coreDirection === 'bullish' ? confirmation : 0),
    bearScore: Math.max(bearScore, coreDirection === 'bearish' ? confirmation : 0),
    netBias: Number(scorecards?.overall?.netBias ?? mlFeatures?.overallNetBias ?? 0),

    entry: Number(scorecards?.overall?.entryPrice ?? mlFeatures?.entryPrice ?? 0) || undefined,
    targetPrice: Number(scorecards?.overall?.targetPrice ?? mlFeatures?.targetPrice ?? mlFeatures?.takeProfitPrice ?? mlFeatures?.tp1 ?? 0) || undefined,
    target: Number(scorecards?.overall?.targetPrice ?? mlFeatures?.targetPrice ?? mlFeatures?.takeProfitPrice ?? mlFeatures?.tp1 ?? 0) || undefined,
    takeProfitPrice: Number(scorecards?.overall?.targetPrice ?? mlFeatures?.targetPrice ?? mlFeatures?.takeProfitPrice ?? mlFeatures?.tp1 ?? 0) || undefined,
    tp1: Number(scorecards?.overall?.targetPrice ?? mlFeatures?.targetPrice ?? mlFeatures?.takeProfitPrice ?? mlFeatures?.tp1 ?? 0) || undefined,
    stopPrice: Number(scorecards?.overall?.stopPrice ?? mlFeatures?.stopPrice ?? 0) || undefined,
    riskReward: Number(scorecards?.overall?.riskReward ?? mlFeatures?.riskReward ?? 0) || undefined,
    targetSource: scorecards?.overall?.targetSource ?? mlFeatures?.targetSource,
    stopSource: scorecards?.overall?.stopSource ?? mlFeatures?.stopSource,

    smc: getScorecardSignalText(smcDirection),
    smcDirection,
    smcStrength,

    alphax: getScorecardSignalText(profileDirection),
    alphaxDirection: profileDirection,
    alphaxStrength: alphaStrength,
    alphaxBullPressure: profileDirection === 'bullish' ? alphaStrength : 0,
    alphaxBearPressure: profileDirection === 'bearish' ? alphaStrength : 0,

    ghost: getScorecardSignalText(ghostDirection, 'Neutral'),
    ghostDirection,
    ghostConfidence,

    nrtr: getScorecardSignalText(nrtrDirection, 'Neutral'),
    nrtrDirection,
    nrtrStrength: 0,

    orderBlocks: getScorecardSignalText(smcDirection),
    orderBlockStrength: obStrength,
    pdZoneStrength: pdStrength,
    hiddenContextStrength: hiddenStrength,

    chartOverlayToggles: {
      smc: Number(scorecards?.activeFactors?.smcEvents ?? 0) > 0 || smcStrength > 0,
      ghost: Number(scorecards?.activeFactors?.ghostCandles ?? 0) > 0 || ghostConfidence > 0,
      liquidityProfile: Number(scorecards?.activeFactors?.profileBins ?? 0) > 0 || profileStrength > 0,
      orderBlocks: Number(scorecards?.activeFactors?.orderBlocks ?? 0) > 0 || obStrength > 0,
    },
  }
}


export default function Dashboard() {
  const [isClient, setIsClient] = useState(false)
  const [pythonEngineState, setPythonEngineState] =
    useState<PythonEngineState | null>(null)
  const [projectionEngine, setProjectionEngine] =
    useState<ProjectionEngineState | null>(null)
  const [timeframeEngineStates, setTimeframeEngineStates] =
    useState<Record<string, PythonEngineState | null>>({})
  const [sharedTechnicalSentiment, setSharedTechnicalSentiment] =
    useState<TechnicalSentiment | null>(null)
  const [timeframeTechnicalSentiments, setTimeframeTechnicalSentiments] =
    useState<Record<string, TechnicalSentiment | null>>({})
  const [factorTechnicalSentiment, setFactorTechnicalSentiment] =
    useState<TechnicalSentiment | null>(null)
  const [activeChartPrice, setActiveChartPrice] = useState<number | null>(null)
  const [sharedLivePrices, setSharedLivePrices] = useState<Record<string, LiveFeedSnapshot>>({})
  const [chartScorecards, setChartScorecards] = useState<any | null>(null)
  const [chartMlFeatures, setChartMlFeatures] = useState<any | null>(null)
  const [strategyTesterResults, setStrategyTesterResults] = useState<any | null>(null)
  const [mainChartCandles, setMainChartCandles] = useState<DashboardCandle[]>([])
  const [miniChartOneCandles, setMiniChartOneCandles] = useState<DashboardCandle[]>([])
  const [miniChartTwoCandles, setMiniChartTwoCandles] = useState<DashboardCandle[]>([])
  const [mainChartOverlayPayload, setMainChartOverlayPayload] = useState<any | null>(null)
  const [mainUnifiedIntelligence, setMainUnifiedIntelligence] = useState<any | null>(null)
  const defaultChartSettings: ChartStrategySettings = {
    smmaLength: 20,
    nrtrMode: 'ATR-Based',
    nrtrAtrLength: 14,
    nrtrAtrMultiplier: 1,
    nrtrPercent: 0.25,
    showNrtrExitLabels: true,
  }
  const [mainChartIndicatorSettings, setMainChartIndicatorSettings] = useState<ChartStrategySettings>(defaultChartSettings)
  const [miniChartOneIndicatorSettings, setMiniChartOneIndicatorSettings] = useState<ChartStrategySettings>(defaultChartSettings)
  const [miniChartTwoIndicatorSettings, setMiniChartTwoIndicatorSettings] = useState<ChartStrategySettings>(defaultChartSettings)
  const [lastSavedChartKey, setLastSavedChartKey] = useState<ChartConfigKey | null>(null)
  const [chartConfigsHydrated, setChartConfigsHydrated] = useState(false)

  const [mainChartSelection, setMainChartSelection] = useState<ChartSelection>({
    symbol: 'MES1!',
    timeframe: '1m',
    candleMode: 'Heikin Ashi',
  })

  const [miniChartOneSelection, setMiniChartOneSelection] = useState<ChartSelection>({
    symbol: 'MES1!',
    timeframe: '1m',
    candleMode: 'Heikin Ashi',
  })

  const [miniChartTwoSelection, setMiniChartTwoSelection] = useState<ChartSelection>({
    symbol: 'MES1!',
    timeframe: '1m',
    candleMode: 'Heikin Ashi',
  })
  const [miniChartOneManualTimeframe, setMiniChartOneManualTimeframe] = useState(false)
  const [miniChartTwoManualTimeframe, setMiniChartTwoManualTimeframe] = useState(false)


  useEffect(() => {
    if (!isClient) return

    let cancelled = false

    const applyConfig = (key: ChartConfigKey, config: SavedChartConfig | null) => {
      if (!config) return

      if (key === 'main') {
        setMainChartSelection(config.selection)
        setMainChartIndicatorSettings(config.settings)
      }

      if (key === 'mini1') {
        // Mini charts default to the main chart symbol/timeframe. Only keep saved
        // indicator settings here so stale saved mini symbols/timeframes cannot
        // override the active main-chart context on page load.
        setMiniChartOneIndicatorSettings(config.settings)
      }

      if (key === 'mini2') {
        // Mini charts default to the main chart symbol/timeframe. Only keep saved
        // indicator settings here so stale saved mini symbols/timeframes cannot
        // override the active main-chart context on page load.
        setMiniChartTwoIndicatorSettings(config.settings)
      }
    }

    async function hydrateChartConfigs() {
      const localConfigs: Partial<Record<ChartConfigKey, SavedChartConfig | null>> = {
        main: readSavedChartConfig('main'),
        mini1: readSavedChartConfig('mini1'),
        mini2: readSavedChartConfig('mini2'),
      }

      try {
        const backendConfigs = await fetchBackendChartConfigs()
        if (cancelled) return

        ;(['main', 'mini1', 'mini2'] as ChartConfigKey[]).forEach((key) => {
          const config = backendConfigs[key] ?? localConfigs[key] ?? null
          applyConfig(key, config)

          // Keep browser localStorage in sync so refresh still has an instant fallback.
          if (config) {
            writeSavedChartConfig(key, config.selection, config.settings)
          }
        })
      } catch (error) {
        console.error('Backend chart settings unavailable, using local chart settings:', error)
        if (cancelled) return

        applyConfig('main', localConfigs.main ?? null)
        applyConfig('mini1', localConfigs.mini1 ?? null)
        applyConfig('mini2', localConfigs.mini2 ?? null)
      } finally {
        if (!cancelled) {
          setChartConfigsHydrated(true)
        }
      }
    }

    hydrateChartConfigs()

    return () => {
      cancelled = true
    }
  }, [isClient])

  const saveChartConfig = useCallback(async (
    key: ChartConfigKey,
    selection: ChartSelection,
    settings: ChartStrategySettings
  ) => {
    if (!isClient) return

    // Save locally immediately, then sync to backend database for all computers.
    const localSaved = writeSavedChartConfig(key, selection, settings)

    try {
      await saveBackendChartConfig(key, selection, settings)
      setLastSavedChartKey(key)
      window.setTimeout(() => {
        setLastSavedChartKey((current) => current === key ? null : current)
      }, 2200)
    } catch (error) {
      console.error('Unable to save chart config to backend database:', error)

      if (localSaved) {
        setLastSavedChartKey(key)
        window.setTimeout(() => {
          setLastSavedChartKey((current) => current === key ? null : current)
        }, 2200)
      }
    }
  }, [isClient])

  const handleLivePriceUpdate = useCallback((snapshot: LiveFeedSnapshot) => {
    const normalizedSnapshot = writeSharedLivePriceCache(snapshot)
    if (!normalizedSnapshot) return

    setSharedLivePrices((current) => ({
      ...current,
      [sharedLivePriceKey(normalizedSnapshot.symbol)]: normalizedSnapshot,
    }))
  }, [])

  useEffect(() => {
    setIsClient(true)
  }, [])

  const selectedSymbol = normalizeSymbol(mainChartSelection.symbol || 'MES1!')
  const selectedTimeframe = normalizeTimeframe(mainChartSelection.timeframe || '1m')

  // Mini charts always inherit the active main-chart symbol. Their timeframe
  // defaults to the main chart timeframe, then can be changed manually from each
  // mini chart dropdown to request a fresh historical candle set for that TF.
  const miniOneSymbol = selectedSymbol
  const miniTwoSymbol = selectedSymbol
  const miniOneTimeframe = normalizeTimeframe(miniChartOneSelection.timeframe || selectedTimeframe)
  const miniTwoTimeframe = normalizeTimeframe(miniChartTwoSelection.timeframe || selectedTimeframe)

  const selectedLivePrice = sharedLivePrices[sharedLivePriceKey(selectedSymbol)]?.price ?? activeChartPrice ?? null
  const miniOneLivePrice = sharedLivePrices[sharedLivePriceKey(miniOneSymbol)]?.price ?? selectedLivePrice
  const miniTwoLivePrice = sharedLivePrices[sharedLivePriceKey(miniTwoSymbol)]?.price ?? selectedLivePrice

  useEffect(() => {
    // Keep mini symbols locked to the main chart and keep timeframe synced until
    // the user manually selects another mini timeframe. This makes every mini
    // chart load with the same symbol/timeframe as the main chart by default.
    setMiniChartOneSelection((current) => ({
      symbol: selectedSymbol,
      timeframe: miniChartOneManualTimeframe
        ? normalizeTimeframe(current.timeframe || selectedTimeframe)
        : selectedTimeframe,
      candleMode: current.candleMode || mainChartSelection.candleMode,
    }))

    setMiniChartTwoSelection((current) => ({
      symbol: selectedSymbol,
      timeframe: miniChartTwoManualTimeframe
        ? normalizeTimeframe(current.timeframe || selectedTimeframe)
        : selectedTimeframe,
      candleMode: current.candleMode || mainChartSelection.candleMode,
    }))
  }, [
    selectedSymbol,
    selectedTimeframe,
    mainChartSelection.candleMode,
    miniChartOneManualTimeframe,
    miniChartTwoManualTimeframe,
  ])

  const {
    latestSignal,
    recentSignals,
    connectionStatus,
    lastUpdateTime,
    apiBaseUrl,
  } = useApiPolling({
    symbol: selectedSymbol,
    timeframe: selectedTimeframe,
    enabled: chartConfigsHydrated,
    pollMs: 10000,
  })

  useEffect(() => {
    if (!isClient || !apiBaseUrl || !chartConfigsHydrated) return

    let cancelled = false
    let inFlight = false

    const liveRequests = Array.from(
      new Map(
        [
          { symbol: selectedSymbol, timeframe: selectedTimeframe },
          { symbol: miniOneSymbol, timeframe: miniOneTimeframe },
          { symbol: miniTwoSymbol, timeframe: miniTwoTimeframe },
        ].map((item) => [sharedLivePriceKey(item.symbol), item])
      ).values()
    )

    async function refreshSharedLivePrices() {
      if (inFlight) return
      inFlight = true

      try {
        const snapshots = await Promise.allSettled(
          liveRequests.map((item) => fetchBackendSharedLivePrice(apiBaseUrl, item.symbol, item.timeframe))
        )

        if (cancelled) return

        const nextSnapshots: Record<string, LiveFeedSnapshot> = {}

        snapshots.forEach((result) => {
          if (result.status !== 'fulfilled' || !result.value) return

          const normalizedSnapshot = writeSharedLivePriceCache(result.value)
          if (!normalizedSnapshot) return

          nextSnapshots[sharedLivePriceKey(normalizedSnapshot.symbol)] = normalizedSnapshot
        })

        if (Object.keys(nextSnapshots).length > 0) {
          setSharedLivePrices((current) => ({
            ...current,
            ...nextSnapshots,
          }))
        }
      } catch (error) {
        console.error('Shared live price refresh failed:', error)
      } finally {
        inFlight = false
      }
    }

    refreshSharedLivePrices()
    const intervalId = window.setInterval(refreshSharedLivePrices, 2500)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [
    apiBaseUrl,
    chartConfigsHydrated,
    isClient,
    miniOneSymbol,
    miniOneTimeframe,
    miniTwoSymbol,
    miniTwoTimeframe,
    selectedSymbol,
    selectedTimeframe,
  ])

  const dashboardTimeframes = useMemo(
    () => Array.from(new Set([selectedTimeframe, miniOneTimeframe, miniTwoTimeframe])),
    [selectedTimeframe, miniOneTimeframe, miniTwoTimeframe]
  )

  const overallTimeframeLabel = dashboardTimeframes.join(' / ')
  const FactorConfirmationTableLoose = FactorConfirmationTable as any

  const mainCandlesReady = mainChartCandles.length >= 20
  const mainOverlayReady = mainCandlesReady && Boolean(chartScorecards || chartMlFeatures)

  useEffect(() => {
    const sharedLive = readSharedLivePriceCache(selectedSymbol)
    if (sharedLive?.price && sharedLive.price > 0) {
      setActiveChartPrice(sharedLive.price)
      return
    }

    const latestCandle = mainChartCandles[mainChartCandles.length - 1]
    const latestClose = toFiniteNumber(latestCandle?.close, NaN)

    if (Number.isFinite(latestClose) && latestClose > 0) {
      setActiveChartPrice(latestClose)
    } else {
      setActiveChartPrice(null)
    }
  }, [mainChartCandles, selectedSymbol, sharedLivePrices])


  useEffect(() => {
    clearSharedChartCachesForSymbolSwitch(selectedSymbol, selectedTimeframe)
    setFactorTechnicalSentiment(null)
    setChartScorecards(null)
    setChartMlFeatures(null)
    setStrategyTesterResults(null)
    setPythonEngineState(null)
    setProjectionEngine(null)
    setTimeframeEngineStates({})
    setSharedTechnicalSentiment(null)
    setTimeframeTechnicalSentiments({})
    setMainChartOverlayPayload(null)
  }, [selectedSymbol, selectedTimeframe, overallTimeframeLabel])

  useEffect(() => {
    if (!isClient || !apiBaseUrl || !mainCandlesReady) return

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
  }, [apiBaseUrl, isClient, selectedSymbol, selectedTimeframe, dashboardTimeframes, mainCandlesReady])

  useEffect(() => {
    if (!isClient || !apiBaseUrl || !mainCandlesReady) return

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
          const mainOnlySentiment = nextSentiments[selectedTimeframe] ?? null

          setTimeframeTechnicalSentiments(nextSentiments)
          setSharedTechnicalSentiment(mainOnlySentiment)
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
  }, [apiBaseUrl, isClient, selectedSymbol, selectedTimeframe, dashboardTimeframes, mainCandlesReady])

  const primaryEngineState = useMemo(() => {
    if (!projectionEngine) return pythonEngineState

    const projectionGhosts = getProjectionGhostCandles(projectionEngine)

    return {
      ...(pythonEngineState ?? {}),
      ...projectionEngine,
      projectionEngine,
      unifiedProjectionEngine: projectionEngine,
      overlayPayload: (pythonEngineState as any)?.overlayPayload,
      chartOverlays: (pythonEngineState as any)?.chartOverlays,
      ghostCandles: projectionGhosts.length > 0
        ? projectionGhosts
        : getPythonGhostCandles(pythonEngineState),
      ghostEngine: {
        phase: 'phase6_unified_projection_engine',
        source: 'api/projection_engine.py',
        count: projectionGhosts.length,
      },
    } as PythonEngineState
  }, [projectionEngine, pythonEngineState])

  const mergedUnifiedIntelligence = useMemo(() => {
    return mergeProjectionEngineIntoUnifiedIntelligence(mainUnifiedIntelligence, projectionEngine)
  }, [mainUnifiedIntelligence, projectionEngine])

  const augmentedLatestSignal = useMemo(() => {
    const sharedTargetMlContext = buildSharedTargetMlContext(
      projectionEngine,
      latestSignal,
      mainChartOverlayPayload,
      mergedUnifiedIntelligence,
      primaryEngineState,
      timeframeEngineStates
    )

    const mainGhostConfidence = getAverageGhostConfidence(primaryEngineState)
    const overallGhostConfidence = getOverallGhostConfidence(timeframeEngineStates, dashboardTimeframes)
    const ghostConfidence = Math.max(mainGhostConfidence, overallGhostConfidence)
    const pythonGhostText =
      getOverallGhostText(timeframeEngineStates, dashboardTimeframes) ||
      getPythonGhostText(primaryEngineState)

    const scorecardPatch = mainOverlayReady && chartScorecards
      ? buildScorecardSignalPatch(chartScorecards, chartMlFeatures)
      : {}

    return {
      ...latestSignal,
      ...scorecardPatch,

      // Overall dashboard logic now uses the active chart as the master context.
      symbol: selectedSymbol,
      timeframe: overallTimeframeLabel,
      primaryTimeframe: selectedTimeframe,
      activeSymbol: selectedSymbol,
      activeTimeframe: selectedTimeframe,
      price: selectedLivePrice ?? latestSignal?.price ?? latestSignal?.current ?? latestSignal?.entry,
      current: selectedLivePrice ?? latestSignal?.current ?? latestSignal?.price ?? latestSignal?.entry,
      entry: isPriceNearActiveScale(latestSignal?.entry ?? latestSignal?.price, activeChartPrice)
        ? latestSignal?.entry ?? latestSignal?.price
        : selectedLivePrice ?? latestSignal?.entry ?? latestSignal?.price,
      miniTimeframes: [miniOneTimeframe, miniTwoTimeframe],
      analysisTimeframes: dashboardTimeframes,
      multiTimeframeMode: true,

      // Python ghost score is now blended across main + mini timeframe engine states.
      confidence: Math.max(
        Number((scorecardPatch as any)?.confidence ?? 0),
        Number(latestSignal?.confidence ?? 0),
        ghostConfidence
      ),
      ghost: (scorecardPatch as any)?.ghost || pythonGhostText || latestSignal?.ghost || 'Multi-Timeframe Python Ghost Projection',
      ghostConfidence: Math.max(Number((scorecardPatch as any)?.ghostConfidence ?? 0), ghostConfidence),
      pythonGhostEngine: Boolean(ghostConfidence || pythonGhostText || (scorecardPatch as any)?.ghostConfidence),

      // Shared technical meter is main-chart only. Mini charts are confirmation filters,
      // not part of the 12-indicator Market Sentiment gauge.
      technicalSentiment: sharedTechnicalSentiment ?? undefined,
      indicators: sharedTechnicalSentiment?.indicators,
      technicalIndicators: sharedTechnicalSentiment?.technicalIndicators,
      technicalMeter: sharedTechnicalSentiment?.technicalMeter,
      factors: sharedTechnicalSentiment?.factors,
      timeframeTechnicalSentiments,
      timeframeEngineStates,

      chartCandleMode: mainChartSelection.candleMode,
      chartOverlayToggles: (scorecardPatch as any)?.chartOverlayToggles ?? (latestSignal as any)?.chartOverlayToggles ?? {
        smc: true,
        ghost: true,
        liquidityProfile: true,
        orderBlocks: true,
      },

      // Keep scorecard-derived factor fields on top after base signal normalization.
      ...(scorecardPatch as any),

      // Phase 6 unified projection engine is now the canonical shared brain.
      projectionEngine,
      unifiedProjectionEngine: projectionEngine,
      projectionMode: projectionEngine?.projectionMode,
      projectionModeLabel: projectionEngine?.projectionModeLabel,
      aiPermission: projectionEngine?.aiPermission,
      targetGhostAlignment: projectionEngine?.alignment,
      ghostPath: projectionEngine?.ghostPath,
      marketState: projectionEngine?.marketState,
      learning: projectionEngine?.learning,

      // Shared Target ML context is the canonical target source for all panels.
      // Ghost Projection, Recent Signals, AI Trader, and future paper trader
      // should all read these same fields.
      ...sharedTargetMlContext,
    }
  }, [
    latestSignal,
    projectionEngine,
    primaryEngineState,
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
    selectedLivePrice,
    mainChartSelection.candleMode,
    chartScorecards,
    chartMlFeatures,
    mainChartOverlayPayload,
    mergedUnifiedIntelligence,
    mainOverlayReady,
  ])

  const matrixScorecards = useMemo(() => {
    const mainNrtr = buildNrtrUnifiedStrategyContext(mainChartCandles, mainChartIndicatorSettings)
    const miniOneNrtr = buildNrtrUnifiedStrategyContext(miniChartOneCandles, miniChartOneIndicatorSettings)
    const miniTwoNrtr = buildNrtrUnifiedStrategyContext(miniChartTwoCandles, miniChartTwoIndicatorSettings)

    const nrtrCharts = [
      {
        ...mainNrtr,
        key: "nrtr-main",
        source: "NRTR Main",
        label: "NRTR Main",
        chartRole: "main",
        symbol: selectedSymbol,
        timeframe: selectedTimeframe,
        candleCount: mainChartCandles.length,
      },
      {
        ...miniOneNrtr,
        key: "nrtr-mini-1",
        source: "NRTR Mini 1",
        label: "NRTR Mini 1",
        chartRole: "mini-1",
        symbol: miniOneSymbol,
        timeframe: miniOneTimeframe,
        candleCount: miniChartOneCandles.length,
      },
      {
        ...miniTwoNrtr,
        key: "nrtr-mini-2",
        source: "NRTR Mini 2",
        label: "NRTR Mini 2",
        chartRole: "mini-2",
        symbol: miniTwoSymbol,
        timeframe: miniTwoTimeframe,
        candleCount: miniChartTwoCandles.length,
      },
    ]

    return {
      ...(chartScorecards ?? {}),
      nrtr: mainNrtr,
      nrtrMain: mainNrtr,
      nrtrMiniOne: miniOneNrtr,
      nrtrMiniTwo: miniTwoNrtr,
      nrtrCharts,
      nrtrStrategyFeeds: nrtrCharts,
    }
  }, [
    chartScorecards,
    mainChartCandles,
    miniChartOneCandles,
    miniChartTwoCandles,
    mainChartIndicatorSettings,
    miniChartOneIndicatorSettings,
    miniChartTwoIndicatorSettings,
    selectedSymbol,
    selectedTimeframe,
    miniOneSymbol,
    miniOneTimeframe,
    miniTwoSymbol,
    miniTwoTimeframe,
  ])

  const matrixMlFeatures = useMemo(() => {
    const nrtrCharts = matrixScorecards?.nrtrCharts ?? []

    return {
      ...(chartMlFeatures ?? {}),
      nrtrStrategyFeeds: nrtrCharts,
      nrtrUsedForMl: 0,
      nrtrPurpose: "strategy_context_only",
    }
  }, [chartMlFeatures, matrixScorecards])

  useEffect(() => {
    if (!isClient || !apiBaseUrl || !mainCandlesReady || mainChartCandles.length === 0) return

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function buildProjectionEngine() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/projection-engine/build`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
          body: JSON.stringify({
            symbol: selectedSymbol,
            timeframe: selectedTimeframe,
            candles: dashboardCandlesToOverlayCandles(mainChartCandles).slice(-700),
            scorecards: matrixScorecards,
            mlFeatures: matrixMlFeatures,
            overlayPayload: mainChartOverlayPayload,
            unifiedIntelligence: mergedUnifiedIntelligence,
            externalTables: {
              technicalSentiment: sharedTechnicalSentiment,
              timeframeTechnicalSentiments,
            },
            signal: {
              ...(latestSignal ?? {}),
              symbol: selectedSymbol,
              timeframe: selectedTimeframe,
              price: selectedLivePrice ?? activeChartPrice ?? latestSignal?.price ?? latestSignal?.current,
              current: selectedLivePrice ?? activeChartPrice ?? latestSignal?.current ?? latestSignal?.price,
            },
            ghostCount: 3,
            autoRegister: true,
          }),
        })

        if (!response.ok) {
          throw new Error(`Projection engine request failed: ${response.status}`)
        }

        const json = await response.json()

        if (!cancelled && json && typeof json === 'object') {
          setProjectionEngine(json as ProjectionEngineState)
        }
      } catch (error) {
        console.error('Unified projection engine sync error:', error)

        if (!cancelled) {
          setProjectionEngine(null)
        }
      }
    }

    buildProjectionEngine()
    intervalId = setInterval(buildProjectionEngine, 7000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [
    activeChartPrice,
    selectedLivePrice,
    apiBaseUrl,
    isClient,
    latestSignal,
    mainCandlesReady,
    mainChartCandles,
    mainChartOverlayPayload,
    mainUnifiedIntelligence,
    matrixMlFeatures,
    matrixScorecards,
    selectedSymbol,
    selectedTimeframe,
    sharedTechnicalSentiment,
    timeframeTechnicalSentiments,
  ])

  const safeDashboardStatus = getSafeDashboardStatus({
    error: null,
    updatedAt: latestSignal?.createdAt ?? null,
    signal: latestSignal,
    candlesCount: mainChartCandles.length,
  })

  const coreDashboardDataLoaded =
    Boolean(latestSignal && typeof latestSignal === "object") ||
    mainChartCandles.length > 0 ||
    miniChartOneCandles.length > 0 ||
    miniChartTwoCandles.length > 0

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
        isPriceNearActiveScale(candidatePrice, selectedLivePrice ?? activeChartPrice)
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
            status={coreDashboardDataLoaded ? 'Connected' : connectionStatus}
            lastUpdateTime={coreDashboardDataLoaded ? (lastUpdateTime ?? new Date().toISOString()) : lastUpdateTime}
          />
        </div>
      </motion.div>

      {/* Main Grid */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column */}
        <div className="space-y-6 lg:col-span-2">
          {mainOverlayReady ? (
            <SignalCard signal={augmentedLatestSignal} />
          ) : (
            <DashboardWaitingCard
              title={mainCandlesReady ? 'Waiting for overlay scorecards...' : 'Waiting for main candles...'}
              message={
                mainCandlesReady
                  ? 'The dashboard has candles. Bull/bear score, confidence, net bias, and technical meter will appear after the overlay engine creates scorecards from the loaded chart.'
                  : 'Main chart candles must load first. Bull/bear score, confidence, net bias, and all signal values are paused so they do not calculate from empty candle data.'
              }
            />
          )}

          <LightweightChartPanel
            title="Main Chart"
            symbol={selectedSymbol}
            timeframe={selectedTimeframe}
            candleMode={mainChartSelection.candleMode}
            height={760}
            smmaLength={mainChartIndicatorSettings.smmaLength}
            nrtrMode={mainChartIndicatorSettings.nrtrMode}
            nrtrAtrLength={mainChartIndicatorSettings.nrtrAtrLength}
            nrtrAtrMultiplier={mainChartIndicatorSettings.nrtrAtrMultiplier}
            nrtrPercent={mainChartIndicatorSettings.nrtrPercent}
            showNrtrExitLabels={mainChartIndicatorSettings.showNrtrExitLabels ?? true}
            onIndicatorSettingsChange={setMainChartIndicatorSettings}
            onSaveConfig={() => saveChartConfig('main', mainChartSelection, mainChartIndicatorSettings)}
            saveStatus={lastSavedChartKey === 'main' ? 'Saved' : ''}
            apiBaseUrl={apiBaseUrl}
            isClient={isClient}
            enabled={chartConfigsHydrated}
            priority="main"
            livePrice={selectedLivePrice}
            onLivePriceUpdate={handleLivePriceUpdate}
            engineState={primaryEngineState}
            ghostCandles={buildGhostCandlesForChart(primaryEngineState, mainChartCandles, selectedTimeframe)}
            showOverlayLines
            onCandlesUpdate={setMainChartCandles}
            onOverlayPayloadUpdate={setMainChartOverlayPayload}
            onUnifiedIntelligenceUpdate={setMainUnifiedIntelligence}
            onScorecardsUpdate={(nextScorecards, nextMlFeatures) => {
              setChartScorecards(nextScorecards ?? null)
              setChartMlFeatures(nextMlFeatures ?? null)
            }}
            onChange={(selection) => {
              setMiniChartOneManualTimeframe(false)
              setMiniChartTwoManualTimeframe(false)
              setMainChartSelection({
                symbol: normalizeSymbol(selection.symbol),
                timeframe: normalizeTimeframe(selection.timeframe),
                candleMode: selection.candleMode,
              })
            }}
          />

          {/* Two Smaller Charts */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <LightweightChartPanel
              title="Mini Chart 1"
              symbol={miniOneSymbol}
              timeframe={miniOneTimeframe}
              candleMode={miniChartOneSelection.candleMode}
              height={390}
              compact
              smmaLength={miniChartOneIndicatorSettings.smmaLength}
              nrtrMode={miniChartOneIndicatorSettings.nrtrMode}
              nrtrAtrLength={miniChartOneIndicatorSettings.nrtrAtrLength}
              nrtrAtrMultiplier={miniChartOneIndicatorSettings.nrtrAtrMultiplier}
              nrtrPercent={miniChartOneIndicatorSettings.nrtrPercent}
              onIndicatorSettingsChange={setMiniChartOneIndicatorSettings}
              onSaveConfig={() => saveChartConfig('mini1', { ...miniChartOneSelection, symbol: selectedSymbol }, miniChartOneIndicatorSettings)}
              saveStatus={lastSavedChartKey === 'mini1' ? 'Saved' : ''}
              apiBaseUrl={apiBaseUrl}
              isClient={isClient}
              enabled={chartConfigsHydrated && mainCandlesReady}
              priority="mini"
              livePrice={miniOneLivePrice}
              onLivePriceUpdate={handleLivePriceUpdate}
              onCandlesUpdate={setMiniChartOneCandles}
              onChange={(selection) => {
                const nextTimeframe = normalizeTimeframe(selection.timeframe || miniOneTimeframe)
                setMiniChartOneManualTimeframe(nextTimeframe !== selectedTimeframe)
                setMiniChartOneSelection({
                  symbol: selectedSymbol,
                  timeframe: nextTimeframe,
                  candleMode: selection.candleMode,
                })
              }}
            />

            <LightweightChartPanel
              title="Mini Chart 2"
              symbol={miniTwoSymbol}
              timeframe={miniTwoTimeframe}
              candleMode={miniChartTwoSelection.candleMode}
              height={390}
              compact
              smmaLength={miniChartTwoIndicatorSettings.smmaLength}
              nrtrMode={miniChartTwoIndicatorSettings.nrtrMode}
              nrtrAtrLength={miniChartTwoIndicatorSettings.nrtrAtrLength}
              nrtrAtrMultiplier={miniChartTwoIndicatorSettings.nrtrAtrMultiplier}
              nrtrPercent={miniChartTwoIndicatorSettings.nrtrPercent}
              onIndicatorSettingsChange={setMiniChartTwoIndicatorSettings}
              onSaveConfig={() => saveChartConfig('mini2', { ...miniChartTwoSelection, symbol: selectedSymbol }, miniChartTwoIndicatorSettings)}
              saveStatus={lastSavedChartKey === 'mini2' ? 'Saved' : ''}
              apiBaseUrl={apiBaseUrl}
              isClient={isClient}
              enabled={chartConfigsHydrated && mainCandlesReady}
              priority="mini"
              livePrice={miniTwoLivePrice}
              onLivePriceUpdate={handleLivePriceUpdate}
              onCandlesUpdate={setMiniChartTwoCandles}
              onChange={(selection) => {
                const nextTimeframe = normalizeTimeframe(selection.timeframe || miniTwoTimeframe)
                setMiniChartTwoManualTimeframe(nextTimeframe !== selectedTimeframe)
                setMiniChartTwoSelection({
                  symbol: selectedSymbol,
                  timeframe: nextTimeframe,
                  candleMode: selection.candleMode,
                })
              }}
            />
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {mainOverlayReady ? (
            <>
              <MarketSentimentGauge
                signal={{
                  ...(augmentedLatestSignal as any),
                  timeframe: selectedTimeframe,
                  primaryTimeframe: selectedTimeframe,
                  analysisTimeframes: [selectedTimeframe],
                  miniTimeframes: [],
                  multiTimeframeMode: false,
                }}
                technicalSentiment={(sharedTechnicalSentiment ?? factorTechnicalSentiment) as any}
              />


              <WarningsPanel signal={augmentedLatestSignal} />
            </>
          ) : (
            <DashboardWaitingCard
              title={mainCandlesReady ? 'Waiting for overlay engine...' : 'Waiting for main candles...'}
              message={
                mainCandlesReady
                  ? 'Main candles are loaded. Scorecards, external data, sentiment, and alerts will start after the main overlay payload is ready.'
                  : 'The dashboard loads the main chart first. Mini charts and all other panels wait so they do not calculate from empty candle data.'
              }
            />
          )}
        </div>
      </div>

      {/* Second Row */}
      {mainOverlayReady ? (
        <>
          <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <UnifiedIntelligenceMatrix
                signal={augmentedLatestSignal as any}
                unifiedIntelligence={mergedUnifiedIntelligence}
                overlayPayload={mainChartOverlayPayload}
                scorecards={matrixScorecards}
                mlFeatures={matrixMlFeatures}
                technicalSentiment={sharedTechnicalSentiment as any}
                activeSymbol={selectedSymbol}
                activeTimeframe={selectedTimeframe}
                activePrice={selectedLivePrice ?? activeChartPrice ?? undefined}
              />
            </div>

            <GhostCandleProjection
              signal={augmentedLatestSignal}
              activeSymbol={selectedSymbol}
              activeTimeframe={selectedTimeframe}
              activePrice={selectedLivePrice ?? activeChartPrice ?? undefined}
              overlayPayload={mainChartOverlayPayload}
              scorecards={chartScorecards}
              unifiedIntelligence={mergedUnifiedIntelligence}
            />
          </div>

          <RecentSignalsTable
            signals={visibleRecentSignals}
            latestSignal={augmentedLatestSignal}
            activeSymbol={selectedSymbol}
            activeTimeframe={selectedTimeframe}
            activePrice={selectedLivePrice ?? activeChartPrice ?? undefined}
            chartCards={[
              {
                label: 'Main Chart',
                symbol: selectedSymbol,
                timeframe: selectedTimeframe,
                candles: mainChartCandles,
                latestSignal: augmentedLatestSignal,
                activePrice: selectedLivePrice ?? activeChartPrice ?? undefined,
                settings: mainChartIndicatorSettings,
                overlayPayload: mainChartOverlayPayload,
                unifiedIntelligence: mergedUnifiedIntelligence,
              },
              {
                label: 'Mini Chart 1',
                symbol: miniOneSymbol,
                timeframe: miniOneTimeframe,
                candles: miniChartOneCandles,
                latestSignal: augmentedLatestSignal,
                settings: miniChartOneIndicatorSettings,
                overlayPayload: mainChartOverlayPayload,
                unifiedIntelligence: mergedUnifiedIntelligence,
              },
              {
                label: 'Mini Chart 2',
                symbol: miniTwoSymbol,
                timeframe: miniTwoTimeframe,
                candles: miniChartTwoCandles,
                latestSignal: augmentedLatestSignal,
                settings: miniChartTwoIndicatorSettings,
                overlayPayload: mainChartOverlayPayload,
                unifiedIntelligence: mergedUnifiedIntelligence,
              },
            ]}
          />

          <AiBrainContextPanel
            symbol={selectedSymbol}
            timeframe={selectedTimeframe}
            signal={augmentedLatestSignal}
            scorecards={matrixScorecards}
            mlFeatures={matrixMlFeatures}
            overlayPayload={mainChartOverlayPayload}
            unifiedIntelligence={mergedUnifiedIntelligence}
            aiDecision={augmentedLatestSignal as any}
            mainSettings={mainChartIndicatorSettings}
            miniOneSettings={miniChartOneIndicatorSettings}
            miniTwoSettings={miniChartTwoIndicatorSettings}
          />

          <div className="rounded-2xl border border-purple-400/30 bg-purple-950/10 p-1">
            <AiTraderPanel
              apiBaseUrl={apiBaseUrl}
              symbol={selectedSymbol}
              timeframe={selectedTimeframe}
              activePrice={selectedLivePrice ?? activeChartPrice ?? undefined}
              signal={augmentedLatestSignal}
              scorecards={matrixScorecards}
              overlayPayload={mainChartOverlayPayload}
              unifiedIntelligence={mergedUnifiedIntelligence}
              candles={mainChartCandles}
              strategyTesterResults={strategyTesterResults}
            />
          </div>

          <StrategyTesterPanel
            apiBaseUrl={apiBaseUrl}
            symbol={selectedSymbol}
            timeframe={selectedTimeframe}
            mainCandles={mainChartCandles}
            miniOneCandles={miniChartOneCandles}
            miniTwoCandles={miniChartTwoCandles}
            mainSettings={mainChartIndicatorSettings}
            miniOneSettings={miniChartOneIndicatorSettings}
            miniTwoSettings={miniChartTwoIndicatorSettings}
            onResultsUpdate={setStrategyTesterResults}
            onApplyMainSettings={(settings: ChartStrategySettings) => {
              setMainChartIndicatorSettings(settings)
              saveChartConfig('main', mainChartSelection, settings)
            }}
          />
        </>
      ) : (
        <div className="mb-6">
          <DashboardWaitingCard
            title="External panels paused"
            message="Factor confirmation, external data, ghost projections, and recent signals will load after the main candles and overlay payload are ready."
          />
        </div>
      )}

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
