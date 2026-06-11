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

function sharedCandleKey(symbol: string, timeframe: string) {
  return `${normalizeSymbol(symbol)}::${normalizeTimeframe(timeframe)}`
}

function readSharedCandleCache(symbol: string, timeframe: string, limit: number) {
  const cached = SHARED_CANDLE_CACHE.get(sharedCandleKey(symbol, timeframe))
  if (!cached) return null

  return {
    ...cached,
    candles: cached.candles.slice(-Math.max(1, limit)),
  }
}

async function fetchSharedCandlePayload(
  apiBaseUrl: string,
  symbol: string,
  timeframe: string,
  limit: number
): Promise<SharedCandleCacheEntry> {
  const normalizedSymbol = normalizeSymbol(symbol)
  const normalizedTimeframe = normalizeTimeframe(timeframe)
  const key = sharedCandleKey(normalizedSymbol, normalizedTimeframe)
  const requestedLimit = Math.max(1, limit)

  const activeRequest = SHARED_CANDLE_IN_FLIGHT.get(key)
  if (activeRequest) {
    const activeResult = await activeRequest
    return {
      ...activeResult,
      candles: activeResult.candles.slice(-requestedLimit),
    }
  }

  const request = (async () => {
    const previous = SHARED_CANDLE_CACHE.get(key)
    const apiLimit = Math.max(requestedLimit, previous?.limit ?? 0)

    const params = new URLSearchParams({
      symbol: normalizedSymbol,
      timeframe: normalizedTimeframe,
      limit: String(apiLimit),
      force: 'false',
    })

    const response = await fetch(`${apiBaseUrl}/api/candles?${params.toString()}`, {
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Candle API error ${response.status}`)
    }

    const json = await response.json()
    const candles = normalizeCandlePayload(json)
    const overlayPayload = getUnifiedOverlayPayload(json)
    const unifiedIntelligence = getUnifiedIntelligencePayload(json)

    const entry: SharedCandleCacheEntry = {
      candles,
      overlayPayload,
      unifiedIntelligence,
      updatedAt: Date.now(),
      limit: apiLimit,
      provider: typeof json?.provider === 'string' ? json.provider : undefined,
      source: typeof json?.source === 'string' ? json.source : undefined,
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
       * /api/candles can expose scorecards/mlFeatures at the top level and
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
    unifiedIntelligence.ghostProjection?.candles,
    unifiedIntelligence.ghostProjection?.ghostCandles,
    unifiedIntelligence.components?.ghost?.candles,
    unifiedIntelligence.components?.ghost?.ghostCandles,
    unifiedIntelligence.ghostCandles,
    unifiedIntelligence.projections,
  ]

  for (const value of candidates) {
    if (Array.isArray(value) && value.length > 0) return value as PythonGhostCandle[]
  }

  return []
}

function getGhostCandlesFromUnifiedOverlay(overlayPayload: any | null | undefined): PythonGhostCandle[] {
  if (!overlayPayload || typeof overlayPayload !== 'object') return []

  if (Array.isArray(overlayPayload.ghostCandles)) {
    return overlayPayload.ghostCandles as PythonGhostCandle[]
  }

  if (Array.isArray(overlayPayload.ghostProjections)) {
    return overlayPayload.ghostProjections as PythonGhostCandle[]
  }

  if (Array.isArray(overlayPayload.projections)) {
    return overlayPayload.projections as PythonGhostCandle[]
  }

  return []
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
      source.ghostCandles,
      source.ghostProjections,
      source.projections,
      source.ghostProjection?.candles,
      source.ghostProjection?.ghostCandles,
      source.components?.ghost?.candles,
      source.components?.ghost?.ghostCandles,
      source.overlayPayload?.ghostCandles,
      source.overlayPayload?.ghostProjections,
      source.overlayPayload?.projections,
      source.chartOverlays?.ghostCandles,
      source.chartOverlays?.ghostProjections,
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
    ['targetPrice'],
    ['target'],
    ['takeProfitPrice'],
    ['tp1'],

    ['targetMl', 'finalTargetPrice'],
    ['targetMl', 'overallTargetPrice'],
    ['targetMl', 'targetPrice'],
    ['targetMl', 'target'],

    ['targetPlan', 'finalTargetPrice'],
    ['targetPlan', 'overallTargetPrice'],
    ['targetPlan', 'targetPrice'],
    ['targetPlan', 'target'],
    ['targetPlan', 'takeProfitPrice'],
    ['targetPlan', 'tp1'],

    ['overlayPayload', 'finalTargetPrice'],
    ['overlayPayload', 'overallTargetPrice'],
    ['overlayPayload', 'targetPrice'],
    ['overlayPayload', 'targetMl', 'finalTargetPrice'],
    ['overlayPayload', 'targetMl', 'overallTargetPrice'],
    ['overlayPayload', 'targetMl', 'targetPrice'],
    ['overlayPayload', 'targetPlan', 'finalTargetPrice'],
    ['overlayPayload', 'targetPlan', 'overallTargetPrice'],
    ['overlayPayload', 'targetPlan', 'targetPrice'],

    ['unifiedIntelligence', 'finalTargetPrice'],
    ['unifiedIntelligence', 'overallTargetPrice'],
    ['unifiedIntelligence', 'targetPrice'],
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

  ghosts.forEach((ghost) => {
    if (!ghost || typeof ghost !== 'object') return

    const finalTarget =
      readSharedTargetNumber(ghost, ['finalTargetPrice']) ||
      readSharedTargetNumber(ghost, ['overallTargetPrice']) ||
      readSharedTargetNumber(ghost, ['targetPrice']) ||
      readSharedTargetNumber(ghost, ['ghostTargetPrice']) ||
      readSharedTargetNumber(ghost, ['projectedTargetPrice'])

    if (Number.isFinite(finalTarget) && finalTarget > 0) {
      targetCandidates.push(finalTarget)
    }

    const confidence =
      readSharedTargetNumber(ghost, ['targetConfidence']) ||
      readSharedTargetNumber(ghost, ['targetMlConfidence']) ||
      readSharedTargetNumber(ghost, ['confidence'])

    if (Number.isFinite(confidence) && confidence > 0) {
      confidenceCandidates.push(confidence)
    }

    targetMlReady = targetMlReady || Boolean(ghost.targetMlReady) || Boolean(ghost.targetMlAligned)
    targetMlAligned = targetMlAligned || Boolean(ghost.targetMlAligned)
    targetSource = targetSource || String(ghost.targetSource ?? ghost.source ?? '').trim()
  })

  const finalTargetPrice = targetCandidates.find((value) => Number.isFinite(value) && value > 0) ?? null
  const targetConfidence = confidenceCandidates.length > 0 ? Math.max(...confidenceCandidates) : null

  return {
    finalTargetPrice,
    overallTargetPrice: finalTargetPrice,
    targetPrice: finalTargetPrice,
    target: finalTargetPrice,
    targetConfidence,
    targetMlConfidence: targetConfidence,
    targetMlReady: Boolean(targetMlReady || targetMlAligned || targetConfidence || finalTargetPrice),
    targetMlAligned: Boolean(targetMlAligned || finalTargetPrice),
    targetSource: targetSource || 'shared_target_ml_context',
    targetMl: {
      finalTargetPrice,
      overallTargetPrice: finalTargetPrice,
      targetPrice: finalTargetPrice,
      target: finalTargetPrice,
      targetConfidence,
      confidence: targetConfidence,
      targetMlConfidence: targetConfidence,
      targetMlReady: Boolean(targetMlReady || targetMlAligned || targetConfidence || finalTargetPrice),
      targetMlAligned: Boolean(targetMlAligned || finalTargetPrice),
      source: targetSource || 'shared_target_ml_context',
    },
    targetPlan: {
      finalTargetPrice,
      overallTargetPrice: finalTargetPrice,
      targetPrice: finalTargetPrice,
      target: finalTargetPrice,
      targetConfidence,
      confidence: targetConfidence,
      targetMlReady: Boolean(targetMlReady || targetMlAligned || targetConfidence || finalTargetPrice),
      targetMlAligned: Boolean(targetMlAligned || finalTargetPrice),
      source: targetSource || 'shared_target_ml_context',
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

  return clean.reduce((sum, value) => sum + value, 0) / clean.length
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
    trueRanges.reduce((sum, value) => sum + value, 0) /
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

function buildGhostCandlesForChart(
  engineState: PythonEngineState | null | undefined,
  chartCandles: DashboardCandle[],
  timeframe: string
): GhostCandle[] {
  const pythonGhostCandles = getPythonGhostCandles(engineState)

  if (chartCandles.length === 0 || pythonGhostCandles.length === 0) return []

  const timeframeSeconds = timeframeToSeconds(timeframe)
  const lastRealCandle = chartCandles[chartCandles.length - 1]
  const lastRealTime = timeToUnixSeconds(lastRealCandle.time)
  let previousProjected: DashboardCandle | GhostCandle = lastRealCandle

  return pythonGhostCandles.slice(0, 10).map((ghost, index) => {
    const open = toFiniteNumber(ghost.open ?? ghost.o, NaN)
    const high = toFiniteNumber(ghost.high ?? ghost.h, NaN)
    const low = toFiniteNumber(ghost.low ?? ghost.l, NaN)
    const close = toFiniteNumber(ghost.close ?? ghost.c, NaN)

    const explicitTime = normalizeCandleTime(
      ghost.time ?? ghost.timestamp ?? ghost.t ?? (
        lastRealTime ? lastRealTime + timeframeSeconds * (index + 1) : undefined
      )
    )

    if (
      Number.isFinite(open) &&
      Number.isFinite(high) &&
      Number.isFinite(low) &&
      Number.isFinite(close)
    ) {
      const projected: GhostCandle = {
        time: explicitTime as GhostCandle['time'],
        open,
        high,
        low,
        close,
        confidence: ghost.confidence,
        direction: ghost.direction,
        source: ghost.source ?? 'python',
        label: ghost.label ?? `PY #${index + 1}`,
        reason: ghost.reason,
      }

      // Preserve Target ML + Ghost ML metadata for projection tables/details.
      ;(projected as any).targetMlAligned = Boolean(ghost.targetMlAligned)
      ;(projected as any).targetPrice = toFiniteNumber(ghost.targetPrice, NaN)
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

      previousProjected = projected
      return projected
    }

    const fallback = buildFallbackGhostCandle(
      previousProjected,
      ghost.direction,
      ghost.confidence,
      index,
      timeframeSeconds
    )

    previousProjected = fallback
    return fallback
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
  priority: 'main' | 'mini' = 'main'
) {
  const [candles, setCandles] = useState<DashboardCandle[]>([])
  const [overlayPayload, setOverlayPayload] = useState<any | null>(null)
  const [unifiedIntelligence, setUnifiedIntelligence] = useState<any | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    if (!isClient || !apiBaseUrl) return

    const activeApiBaseUrl = apiBaseUrl
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    function applyCachedPayload() {
      const cached = readSharedCandleCache(symbol, timeframe, limit)
      if (!cached || cancelled) return false

      setCandles(cached.candles)
      setOverlayPayload(cached.overlayPayload)
      setUnifiedIntelligence(cached.unifiedIntelligence)
      setErrorText('')
      return cached.candles.length > 0
    }

    async function fetchCandles() {
      if (!enabled) {
        applyCachedPayload()
        setIsLoading(false)
        return
      }

      try {
        const cachedWasApplied = applyCachedPayload()

        // Priority rule:
        // Main chart owns the refresh. Mini charts reuse main/shared cache when
        // the symbol + timeframe already exist, so identical mini charts do not
        // start a second /api/candles request.
        if (priority === 'mini' && cachedWasApplied) {
          setIsLoading(false)
          return
        }

        setIsLoading(!cachedWasApplied)
        setErrorText('')

        const nextPayload = await fetchSharedCandlePayload(activeApiBaseUrl, symbol, timeframe, limit)

        if (!cancelled) {
          setCandles(nextPayload.candles)
          setOverlayPayload(nextPayload.overlayPayload)
          setUnifiedIntelligence(nextPayload.unifiedIntelligence)
        }
      } catch (error) {
        console.error('Lightweight chart candle sync error:', error)

        if (!cancelled) {
          const cachedWasApplied = applyCachedPayload()
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
    fetchCandles()
    intervalId = setInterval(fetchCandles, pollMs)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [apiBaseUrl, isClient, symbol, timeframe, limit, pollMs, enabled, priority])

  return {
    candles,
    overlayPayload,
    unifiedIntelligence,
    isLoading,
    errorText,
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

function mergeStableOverlayZones(fallbackPayload: any, backendPayload: any) {
  const fallbackZones = Array.isArray(fallbackPayload?.zones) ? fallbackPayload.zones : []
  const backendZones = Array.isArray(backendPayload?.zones) ? backendPayload.zones : []
  const backendOrderBlocks = Array.isArray(backendPayload?.orderBlocks) ? backendPayload.orderBlocks : []

  /**
   * Stable rule:
   * - Fallback/frontend SMC is the source of truth for active BOS/CHoCH OB boxes.
   * - Backend is the source of truth for Premium / Equilibrium / Discount.
   * - Backend orderBlocks are used only if fallback has no order blocks.
   */
  const fallbackOrderBlocks = fallbackZones.filter(isOrderBlockOverlayZone)
  const fallbackOtherZones = fallbackZones.filter((zone: any) => !isOrderBlockOverlayZone(zone))

  const backendPdZones = backendZones.filter(isPdOverlayZone)
  const backendOtherNonOrderZones = backendZones.filter(
    (zone: any) => !isPdOverlayZone(zone) && !isOrderBlockOverlayZone(zone)
  )

  const backendOrderBlockZones = [
    ...backendZones.filter(isOrderBlockOverlayZone),
    ...backendOrderBlocks,
  ]

  const orderBlockSource =
    fallbackOrderBlocks.length > 0 ? fallbackOrderBlocks : backendOrderBlockZones

  const merged: any[] = []
  const seen = new Set<string>()

  for (const zone of [
    ...orderBlockSource,
    ...backendPdZones,
    ...backendOtherNonOrderZones,
    ...fallbackOtherZones.filter((zone: any) => !isPdOverlayZone(zone)),
  ]) {
    if (!zone) continue

    const high = Number(zone.high ?? zone.top)
    const low = Number(zone.low ?? zone.bottom)

    if (!Number.isFinite(high) || !Number.isFinite(low)) continue

    const key = [
      zone.kind ?? zone.type,
      zone.label ?? zone.fullLabel,
      zone.direction,
      Math.round(high * 100) / 100,
      Math.round(low * 100) / 100,
      zone.startIndex ?? zone.startTime,
      zone.endIndex ?? zone.endTime,
    ].join('|')

    if (seen.has(key)) continue

    seen.add(key)
    merged.push(zone)
  }

  return merged
}

function mergeStableOverlayLines(fallbackPayload: any, backendPayload: any) {
  const fallbackLines = Array.isArray(fallbackPayload?.lines) ? fallbackPayload.lines : []
  const backendLines = Array.isArray(backendPayload?.lines) ? backendPayload.lines : []

  /**
   * Stable rule:
   * - Fallback/frontend SMC lines stay visible.
   * - Backend structure lines are used only if fallback has none.
   * - Backend non-structure lines can still come through later.
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
    if (!line) continue

    const price = Number(line.price ?? line.brokenLevel)
    if (!Number.isFinite(price)) continue

    const key = [
      line.type,
      line.label ?? line.tag,
      Math.round(price * 100) / 100,
      line.fromIndex ?? line.pivotIndex ?? line.fromTime,
      line.breakIndex ?? line.index ?? line.time,
    ].join('|')

    if (seen.has(key)) continue

    seen.add(key)
    merged.push(line)
  }

  return merged
}

function mergeStableOverlayPayloads(fallbackPayload: any, backendPayload: any) {
  if (!fallbackPayload && !backendPayload) return null
  if (!backendPayload) return fallbackPayload
  if (!fallbackPayload) return backendPayload

  const fallbackMarkers = Array.isArray(fallbackPayload.markers) ? fallbackPayload.markers : []
  const backendMarkers = Array.isArray(backendPayload.markers) ? backendPayload.markers : []

  const mergedMarkers: any[] = []
  const seenMarkers = new Set<string>()

  for (const marker of [...fallbackMarkers, ...backendMarkers]) {
    if (!marker) continue

    const key = [
      marker.type,
      marker.label,
      marker.price,
      marker.time,
      marker.index,
    ].join('|')

    if (seenMarkers.has(key)) continue

    seenMarkers.add(key)
    mergedMarkers.push(marker)
  }

  const lines = mergeStableOverlayLines(fallbackPayload, backendPayload)
  const zones = mergeStableOverlayZones(fallbackPayload, backendPayload)

  return {
    ...backendPayload,
    // Keep fallback SMC analysis attached because it is the current stable SMC layer.
    smc: fallbackPayload.smc ?? backendPayload.smc,
    alphaX: backendPayload.alphaX ?? fallbackPayload.alphaX,

    // Final merged draw sources.
    lines,
    zones,
    markers: mergedMarkers.slice(-60),

    // Preserve backend unified extras.
    smcEvents: fallbackPayload.smcEvents ?? backendPayload.smcEvents,
    orderBlocks: zones.filter(isOrderBlockOverlayZone),
    liquidityEvents: backendPayload.liquidityEvents ?? fallbackPayload.liquidityEvents,
    liquidityProfileBins:
      backendPayload.liquidityProfileBins ?? fallbackPayload.liquidityProfileBins,
    dlmLevels: backendPayload.dlmLevels ?? fallbackPayload.dlmLevels,
    ghostCandles: backendPayload.ghostCandles ?? fallbackPayload.ghostCandles,
    targetMl: backendPayload.targetMl ?? backendPayload.targetPlan ?? fallbackPayload.targetMl ?? fallbackPayload.targetPlan,
    targetPlan: backendPayload.targetPlan ?? backendPayload.targetMl ?? fallbackPayload.targetPlan ?? fallbackPayload.targetMl,
    targetMlStatus: backendPayload.targetMlStatus ?? fallbackPayload.targetMlStatus,
    targetPrice: backendPayload.targetPrice ?? backendPayload.targetMl?.targetPrice ?? backendPayload.targetPlan?.targetPrice,
    targetConfidence: backendPayload.targetConfidence ?? backendPayload.targetMl?.targetConfidence ?? backendPayload.targetPlan?.targetConfidence,

    summary: {
      ...(fallbackPayload.summary ?? {}),
      ...(backendPayload.summary ?? {}),
      lineCount: lines.length,
      zoneCount: zones.length,
      markerCount: mergedMarkers.length,
      overlayMergeMode: 'fallback-smc-plus-backend-pd-profile',
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
}: LightweightChartPanelProps) {
  const normalizedSymbol = normalizeSymbol(symbol)
  const normalizedTimeframe = normalizeTimeframe(timeframe)
  const { candles, overlayPayload: unifiedOverlayPayload, unifiedIntelligence, isLoading, errorText } = useChartCandles(
    apiBaseUrl,
    isClient,
    normalizedSymbol,
    normalizedTimeframe,
    compact ? 300 : 700,
    compact ? 10000 : 5000,
    enabled,
    priority
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

    return buildGhostCandlesForChart(engineState, candles, normalizedTimeframe)
  }, [candles, compact, engineState, ghostCandles, normalizedTimeframe, unifiedIntelligence, unifiedOverlayPayload])

  const overlayPayload = useMemo(() => {
    if (!showOverlayLines || compact) return null

    const backendOverlayPayload = getUnifiedOverlayPayload(
      unifiedOverlayPayload,
      engineState
    )

    const fallbackPayload = candles.length >= 20
      ? buildChartOverlayPayload(dashboardCandlesToOverlayCandles(candles), {
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
    return mergeStableOverlayPayloads(fallbackPayload, backendOverlayPayload)
  }, [candles, compact, engineState, showOverlayLines, unifiedOverlayPayload])

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
  const [timeframeEngineStates, setTimeframeEngineStates] =
    useState<Record<string, PythonEngineState | null>>({})
  const [sharedTechnicalSentiment, setSharedTechnicalSentiment] =
    useState<TechnicalSentiment | null>(null)
  const [timeframeTechnicalSentiments, setTimeframeTechnicalSentiments] =
    useState<Record<string, TechnicalSentiment | null>>({})
  const [factorTechnicalSentiment, setFactorTechnicalSentiment] =
    useState<TechnicalSentiment | null>(null)
  const [activeChartPrice, setActiveChartPrice] = useState<number | null>(null)
  const [chartScorecards, setChartScorecards] = useState<any | null>(null)
  const [chartMlFeatures, setChartMlFeatures] = useState<any | null>(null)
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
    timeframe: '5m',
    candleMode: 'Heikin Ashi',
  })

  const [miniChartTwoSelection, setMiniChartTwoSelection] = useState<ChartSelection>({
    symbol: 'MES1!',
    timeframe: '15m',
    candleMode: 'Heikin Ashi',
  })


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
        setMiniChartOneSelection(config.selection)
        setMiniChartOneIndicatorSettings(config.settings)
      }

      if (key === 'mini2') {
        setMiniChartTwoSelection(config.selection)
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

  useEffect(() => {
    setIsClient(true)
  }, [])

  const selectedSymbol = normalizeSymbol(mainChartSelection.symbol || 'MES1!')
  const selectedTimeframe = normalizeTimeframe(mainChartSelection.timeframe || '1m')
  const miniOneSymbol = normalizeSymbol(miniChartOneSelection.symbol || 'MES1!')
  const miniTwoSymbol = normalizeSymbol(miniChartTwoSelection.symbol || 'MES1!')
  const miniOneTimeframe = normalizeTimeframe(miniChartOneSelection.timeframe || '5m')
  const miniTwoTimeframe = normalizeTimeframe(miniChartTwoSelection.timeframe || '15m')

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

  const dashboardTimeframes = useMemo(
    () => Array.from(new Set([selectedTimeframe, miniOneTimeframe, miniTwoTimeframe])),
    [selectedTimeframe, miniOneTimeframe, miniTwoTimeframe]
  )

  const overallTimeframeLabel = dashboardTimeframes.join(' / ')
  const FactorConfirmationTableLoose = FactorConfirmationTable as any

  const mainCandlesReady = mainChartCandles.length >= 20
  const mainOverlayReady = mainCandlesReady && Boolean(chartScorecards || chartMlFeatures)

  useEffect(() => {
    const latestCandle = mainChartCandles[mainChartCandles.length - 1]
    const latestClose = toFiniteNumber(latestCandle?.close, NaN)

    if (Number.isFinite(latestClose) && latestClose > 0) {
      setActiveChartPrice(latestClose)
    } else {
      setActiveChartPrice(null)
    }
  }, [mainChartCandles])


  useEffect(() => {
    setFactorTechnicalSentiment(null)
    setChartScorecards(null)
    setChartMlFeatures(null)
    setPythonEngineState(null)
    setTimeframeEngineStates({})
    setSharedTechnicalSentiment(null)
    setTimeframeTechnicalSentiments({})
    setMainChartOverlayPayload(null)
  }, [selectedSymbol, overallTimeframeLabel])

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

  const augmentedLatestSignal = useMemo(() => {
    const sharedTargetMlContext = buildSharedTargetMlContext(
      latestSignal,
      mainChartOverlayPayload,
      mainUnifiedIntelligence,
      pythonEngineState,
      timeframeEngineStates
    )

    const mainGhostConfidence = getAverageGhostConfidence(pythonEngineState)
    const overallGhostConfidence = getOverallGhostConfidence(timeframeEngineStates, dashboardTimeframes)
    const ghostConfidence = Math.max(mainGhostConfidence, overallGhostConfidence)
    const pythonGhostText =
      getOverallGhostText(timeframeEngineStates, dashboardTimeframes) ||
      getPythonGhostText(pythonEngineState)

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
      price: activeChartPrice ?? latestSignal?.price ?? latestSignal?.current ?? latestSignal?.entry,
      current: activeChartPrice ?? latestSignal?.current ?? latestSignal?.price ?? latestSignal?.entry,
      entry: isPriceNearActiveScale(latestSignal?.entry ?? latestSignal?.price, activeChartPrice)
        ? latestSignal?.entry ?? latestSignal?.price
        : activeChartPrice ?? latestSignal?.entry ?? latestSignal?.price,
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

      // Shared Target ML context is the canonical target source for all panels.
      // Ghost Projection, Recent Signals, AI Trader, and future paper trader
      // should all read these same fields.
      ...sharedTargetMlContext,
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
    chartScorecards,
    chartMlFeatures,
    mainChartOverlayPayload,
    mainUnifiedIntelligence,
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
            engineState={pythonEngineState}
            showOverlayLines
            onCandlesUpdate={setMainChartCandles}
            onOverlayPayloadUpdate={setMainChartOverlayPayload}
            onUnifiedIntelligenceUpdate={setMainUnifiedIntelligence}
            onScorecardsUpdate={(nextScorecards, nextMlFeatures) => {
              setChartScorecards(nextScorecards ?? null)
              setChartMlFeatures(nextMlFeatures ?? null)
            }}
            onChange={(selection) => {
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
              onSaveConfig={() => saveChartConfig('mini1', miniChartOneSelection, miniChartOneIndicatorSettings)}
              saveStatus={lastSavedChartKey === 'mini1' ? 'Saved' : ''}
              apiBaseUrl={apiBaseUrl}
              isClient={isClient}
              enabled={chartConfigsHydrated && mainCandlesReady}
              priority="mini"
              onCandlesUpdate={setMiniChartOneCandles}
              onChange={(selection) => {
                setMiniChartOneSelection({
                  symbol: normalizeSymbol(selection.symbol || miniOneSymbol),
                  timeframe: normalizeTimeframe(selection.timeframe || miniOneTimeframe),
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
              onSaveConfig={() => saveChartConfig('mini2', miniChartTwoSelection, miniChartTwoIndicatorSettings)}
              saveStatus={lastSavedChartKey === 'mini2' ? 'Saved' : ''}
              apiBaseUrl={apiBaseUrl}
              isClient={isClient}
              enabled={chartConfigsHydrated && mainCandlesReady}
              priority="mini"
              onCandlesUpdate={setMiniChartTwoCandles}
              onChange={(selection) => {
                setMiniChartTwoSelection({
                  symbol: normalizeSymbol(selection.symbol || miniTwoSymbol),
                  timeframe: normalizeTimeframe(selection.timeframe || miniTwoTimeframe),
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
                unifiedIntelligence={mainUnifiedIntelligence}
                overlayPayload={mainChartOverlayPayload}
                scorecards={matrixScorecards}
                mlFeatures={matrixMlFeatures}
                technicalSentiment={sharedTechnicalSentiment as any}
                activeSymbol={selectedSymbol}
                activeTimeframe={selectedTimeframe}
                activePrice={activeChartPrice ?? undefined}
              />
            </div>

            <GhostCandleProjection
              signal={augmentedLatestSignal}
              activeSymbol={selectedSymbol}
              activeTimeframe={selectedTimeframe}
              activePrice={activeChartPrice ?? undefined}
              overlayPayload={mainChartOverlayPayload}
              scorecards={chartScorecards}
              unifiedIntelligence={mainUnifiedIntelligence}
            />
          </div>

          <RecentSignalsTable
            signals={visibleRecentSignals}
            latestSignal={augmentedLatestSignal}
            activeSymbol={selectedSymbol}
            activeTimeframe={selectedTimeframe}
            activePrice={activeChartPrice ?? undefined}
            chartCards={[
              {
                label: 'Main Chart',
                symbol: selectedSymbol,
                timeframe: selectedTimeframe,
                candles: mainChartCandles,
                latestSignal: augmentedLatestSignal,
                activePrice: activeChartPrice ?? undefined,
                settings: mainChartIndicatorSettings,
                overlayPayload: mainChartOverlayPayload,
                unifiedIntelligence: mainUnifiedIntelligence,
              },
              {
                label: 'Mini Chart 1',
                symbol: miniOneSymbol,
                timeframe: miniOneTimeframe,
                candles: miniChartOneCandles,
                latestSignal: augmentedLatestSignal,
                settings: miniChartOneIndicatorSettings,
                overlayPayload: mainChartOverlayPayload,
                unifiedIntelligence: mainUnifiedIntelligence,
              },
              {
                label: 'Mini Chart 2',
                symbol: miniTwoSymbol,
                timeframe: miniTwoTimeframe,
                candles: miniChartTwoCandles,
                latestSignal: augmentedLatestSignal,
                settings: miniChartTwoIndicatorSettings,
                overlayPayload: mainChartOverlayPayload,
                unifiedIntelligence: mainUnifiedIntelligence,
              },
            ]}
          />

          <div className="rounded-2xl border border-purple-400/30 bg-purple-950/10 p-1">
            <AiTraderPanel
              apiBaseUrl={apiBaseUrl}
              symbol={selectedSymbol}
              timeframe={selectedTimeframe}
              activePrice={activeChartPrice ?? undefined}
              signal={augmentedLatestSignal}
              scorecards={matrixScorecards}
              overlayPayload={mainChartOverlayPayload}
              unifiedIntelligence={mainUnifiedIntelligence}
              candles={mainChartCandles}
            />
          </div>

          <StrategyTesterPanel
            symbol={selectedSymbol}
            timeframe={selectedTimeframe}
            mainCandles={mainChartCandles}
            miniOneCandles={miniChartOneCandles}
            miniTwoCandles={miniChartTwoCandles}
            mainSettings={mainChartIndicatorSettings}
            miniOneSettings={miniChartOneIndicatorSettings}
            miniTwoSettings={miniChartTwoIndicatorSettings}
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
