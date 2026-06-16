'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts'

const API_BASE_URL = 'https://trading-intelligence-dashboard.onrender.com'
const DEFAULT_VISIBLE_CANDLES = 78
const CACHE_TTL_MS = 1000 * 60 * 5
const LOCAL_STORAGE_PREFIX = 'marketbos:v12:smart-fallback-fast-switch:'
const CHART_SETTINGS_PREFIX = 'marketbos:chart-settings:v1:'
const MAIN_CANDLES_READY_KEY = 'marketbos:main-candles-ready:v1'
const PRIMARY_CANDLE_TIMEFRAMES = ['1m', '5m', '10m', '15m']
let primaryCandlePreloadStarted: string | null = null

const GREEN = '#26a69a'
const RED = '#ef5350'
const GRID = '#1f2937'
const TEXT = '#9ca3af'
const BG = '#0f1115'

const GHOST_LEADING_GAP_BARS = 0
const PROFILE_LEADING_GAP_BARS = 14
const ALPHA_PROFILE_WIDTH_BARS = 22
const MAX_SMC_LABELS = 7
const MAX_LIQUIDITY_LABELS = 5
const MAX_ZONE_COUNT = 6

type Candle = {
  time: string
  epoch?: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
  symbol?: string
  timeframe?: string
  provider?: string
}

type LivePricePayload = {
  symbol?: string
  timeframe?: string
  price?: number
  time?: string
  timestamp?: string
  epoch?: number
  bucketEpoch?: number
  timeframeSeconds?: number
  provider?: string | null
  source?: string
  createdAt?: string
}

type OverlayDirection = 'bullish' | 'bearish' | 'neutral' | string

type ChartZone = {
  startTime?: string
  endTime?: string
  top?: number
  bottom?: number
  label?: string
  direction?: OverlayDirection
  kind?: string
}

type ChartMarker = {
  time?: string
  fromTime?: string
  price?: number
  label?: string
  tag?: string
  direction?: OverlayDirection
  scope?: string
  kind?: string
  score?: number
  grade?: string
  pressurePct?: number
}

type DlmLevel = {
  label?: string
  price?: number
  direction?: OverlayDirection
}

type GhostCandle = {
  label?: string
  open?: number
  high?: number
  low?: number
  close?: number
  confidence?: number
  direction?: OverlayDirection
  source?: string
}

type ChartOverlays = {
  smcEvents?: ChartMarker[]
  zones?: ChartZone[]
  liquidityEvents?: ChartMarker[]
  dlmLevels?: DlmLevel[]
  dlmConfluenceMarkers?: ChartMarker[]
  scoreMarkers?: ChartMarker[]
  ghostCandles?: GhostCandle[]
  alphaProfileBins?: any[]
  alphaProfileMeta?: any
  source?: string
}

type OverlayRenderStatus = 'off' | 'loading' | 'real' | 'cached' | 'fallback' | 'empty'

function getOverlayRenderStatusLabel(status: OverlayRenderStatus) {
  if (status === 'real') return 'Overlay Real'
  if (status === 'cached') return 'Overlay Cached'
  if (status === 'fallback') return 'Overlay Fallback'
  if (status === 'loading') return 'Overlay Loading'
  if (status === 'empty') return 'Overlay Empty'
  return 'Overlay Off'
}

function getOverlayRenderStatusClass(status: OverlayRenderStatus) {
  if (status === 'real') return 'border-emerald-400/60 bg-emerald-400/10 text-emerald-300'
  if (status === 'cached') return 'border-blue-400/60 bg-blue-400/10 text-blue-300'
  if (status === 'fallback') return 'border-yellow-400/60 bg-yellow-400/10 text-yellow-300'
  if (status === 'loading') return 'border-cyan-400/50 bg-cyan-400/10 text-cyan-300'
  if (status === 'empty') return 'border-red-400/50 bg-red-400/10 text-red-300'
  return 'border-dark-600 bg-dark-900/60 text-gray-500'
}

type CandleMode = 'Regular' | 'Heikin Ashi'
type SmmaOverlayLength = 'Off' | '20' | '50'
type NrtrOverlayMode = 'Off' | 'ATR-Based' | 'Percentage'
type NrtrExitMode = 'Off' | 'Pivot Pullback' | 'Internal SuperTrend End'
type NrtrPresetMode = 'Scalping' | 'Swing' | 'Long'

type OverlayToggleKey = 'smc' | 'ghost' | 'liquidityProfile' | 'orderBlocks'

type OverlayToggles = Record<OverlayToggleKey, boolean>

const DEFAULT_OVERLAY_TOGGLES: OverlayToggles = {
  smc: false,
  ghost: false,
  liquidityProfile: false,
  orderBlocks: false,
}

const WARM_ALL_OVERLAY_TOGGLES: OverlayToggles = {
  smc: true,
  ghost: true,
  liquidityProfile: true,
  orderBlocks: true,
}

const warmedOverlayRawCacheKeys = new Set<string>()

function hasAnyOverlayEnabled(toggles: OverlayToggles) {
  return toggles.smc || toggles.ghost || toggles.liquidityProfile || toggles.orderBlocks
}

const MAIN_CHART_OVERLAY_TOGGLES_KEY = 'marketbos:main-chart-overlay-toggles:v1'

function emitMainChartOverlayToggles(detail: {
  symbol: string
  timeframe: string
  toggles: OverlayToggles
}) {
  if (typeof window === 'undefined') return

  const payload = {
    ...detail,
    savedAt: Date.now(),
  }

  try {
    window.localStorage.setItem(MAIN_CHART_OVERLAY_TOGGLES_KEY, JSON.stringify(payload))
  } catch {
    // Ignore localStorage quota/private-mode failures.
  }

  window.dispatchEvent(
    new CustomEvent('marketbos:overlay-toggles', {
      detail: payload,
    })
  )
}

type EChartsCandlestickChartProps = {
  heightClass?: string
  compact?: boolean
  chartTitle?: string
  enableAdvancedOverlays?: boolean
  defaultSymbol?: string
  defaultTimeframe?: string
  defaultCandleMode?: CandleMode
  allowCompactHistory?: boolean
  showControls?: boolean
  lockSymbolToDefault?: boolean
  followDefaultSymbol?: boolean
  onChartSelectionChange?: (selection: {
    symbol: string
    timeframe: string
    candleMode: CandleMode
    compact: boolean
    chartTitle?: string
  }) => void
  latestSignal?: any
  recentSignals?: any[]
  recentCandles?: any[]
}

type CachedCandles = {
  candles: Candle[]
  savedAt: number
}

// Shared across every chart instance on the page.
// One network request per symbol + timeframe; every chart reuses the same stored 500 candles.
// Cache key intentionally ignores chart size so main + mini charts share the exact same candles.
const memoryCandleCache = new Map<string, CachedCandles>()
const inflightCandleRequests = new Map<string, Promise<Candle[]>>()

const timeframeOptions = ['1m', '5m', '10m', '15m', '30m']
const candleModeOptions: CandleMode[] = ['Regular', 'Heikin Ashi']
// Keep this list aligned with backend-supported symbols.
// This prevents the UI from hiding symbols that the API can already serve.
const symbolOptions = ['BTCUSD', 'ETHUSD', 'SPY', 'MES1!']

function normalizeSymbol(value: any): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace('CME_MINI:', '')
    .replace('CME:', '')
    .replace('BINANCE:', '')
    .replace('COINBASE:', '')
    .replace('CRYPTO:', '')
}

function normalizeDefaultSymbol(value: any, fallback = 'BTCUSD'): string {
  const normalized = normalizeSymbol(value || fallback)

  if (normalized === 'MES1' || normalized === 'MES1!') return 'MES1!'
  if (normalized.includes('MES')) return 'MES1!'
  if (normalized.includes('SPY')) return 'SPY'
  if (normalized.includes('ETH')) return 'ETHUSD'
  if (normalized.includes('BTC')) return 'BTCUSD'

  return normalized || fallback
}

const SHARED_LIVE_PRICE_EVENT = 'marketbos:shared-live-price:v1'

type SharedLivePriceRecord = {
  symbol: string
  price: number
  provider?: string
  source?: string
  updatedAt: number
}

const sharedLivePriceBySymbol = new Map<string, SharedLivePriceRecord>()

function getSharedLivePrice(symbol: string): number | null {
  const normalizedSymbol = normalizeDefaultSymbol(symbol)
  const record = sharedLivePriceBySymbol.get(normalizedSymbol)
  const price = Number(record?.price)
  return Number.isFinite(price) && price > 0 ? price : null
}

function setSharedLivePriceForSymbol(symbol: string, live: LivePricePayload | null) {
  if (typeof window === 'undefined' || !live) return

  const normalizedSymbol = normalizeDefaultSymbol(live.symbol ?? symbol)
  const price = Number(live.price)

  if (!normalizedSymbol || !Number.isFinite(price) || price <= 0) return

  const record: SharedLivePriceRecord = {
    symbol: normalizedSymbol,
    price,
    provider: String(live.provider ?? ''),
    source: String(live.source ?? ''),
    updatedAt: Date.now(),
  }

  sharedLivePriceBySymbol.set(normalizedSymbol, record)

  window.dispatchEvent(
    new CustomEvent(SHARED_LIVE_PRICE_EVENT, {
      detail: record,
    })
  )
}

function normalizeTimeframe(value: any): string {
  const tf = String(value ?? '').trim().toLowerCase()

  if (tf === '1') return '1m'
  if (tf === '3') return '3m'
  if (tf === '5') return '5m'
  if (tf === '10') return '10m'
  if (tf === '15') return '15m'
  if (tf === '30') return '30m'

  return timeframeOptions.includes(tf) ? tf : '1m'
}

function normalizeDefaultTimeframe(value: any, fallback = '1m'): string {
  const normalized = normalizeTimeframe(value || fallback)
  return timeframeOptions.includes(normalized) ? normalized : fallback
}

function timeframeSeconds(timeframe: string): number {
  const tf = normalizeTimeframe(timeframe)
  const mapping: Record<string, number> = {
    '1m': 60,
    '5m': 300,
    '10m': 600,
    '15m': 900,
    '30m': 1800,
  }

  return mapping[tf] ?? 60
}

function floorEpochToTimeframe(epoch: number, timeframe: string): number {
  const seconds = timeframeSeconds(timeframe)
  return Math.floor(epoch / seconds) * seconds
}

function isoFromEpochSeconds(epoch: number): string {
  return new Date(epoch * 1000).toISOString()
}

function compactPrice(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function extractOhlcFromTooltipParam(param: any): [number, number, number, number] | null {
  const raw =
    Array.isArray(param?.value)
      ? param.value
      : Array.isArray(param?.data?.value)
        ? param.data.value
        : Array.isArray(param?.data)
          ? param.data
          : []

  const values = raw.map((item: any) => Number(item)).filter((item: number) => Number.isFinite(item))

  if (values.length < 4) return null

  // ECharts can return candlestick tooltip values as:
  // [open, close, low, high]
  // or sometimes [dataIndex/categoryIndex, open, close, low, high].
  // The old tooltip was reading index 499 as "Open", causing Open: 499.00.
  const ohlc = values.length >= 5 ? values.slice(-4) : values.slice(0, 4)

  return [ohlc[0], ohlc[1], ohlc[2], ohlc[3]]
}


function toNumber(value: any): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toEpochSeconds(value: any): number | undefined {
  if (value === null || value === undefined || value === '') return undefined

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value > 1000000000000 ? value / 1000 : value)
  }

  const numeric = Number(value)
  if (Number.isFinite(numeric)) {
    return Math.floor(numeric > 1000000000000 ? numeric / 1000 : numeric)
  }

  const parsed = Date.parse(String(value))
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000)

  return undefined
}

function formatAxisTime(value: any, fallbackIndex: number): string {
  if (typeof value === 'string' && value.length > 0) return value

  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value > 1000000000000 ? value : value * 1000
    const date = new Date(timestamp)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }

  return `Bar ${fallbackIndex + 1}`
}

function shortAxisLabel(value: any): string {
  const text = String(value ?? '')
  const date = new Date(text)

  if (!Number.isNaN(date.getTime())) {
    const month = date.getMonth() + 1
    const day = date.getDate()
    const hour = date.getHours().toString().padStart(2, '0')
    const minute = date.getMinutes().toString().padStart(2, '0')
    return `${month}/${day} ${hour}:${minute}`
  }

  return text
}

function candleFromAny(raw: any, index: number): Candle | null {
  if (Array.isArray(raw)) {
    const timeFirst = typeof raw[0] === 'string' || Number(raw[0]) > 100000
    const time = timeFirst ? raw[0] : undefined
    const offset = timeFirst ? 1 : 0

    const open = toNumber(raw[offset])
    const high = toNumber(raw[offset + 1])
    const low = toNumber(raw[offset + 2])
    const close = toNumber(raw[offset + 3])
    const volume = toNumber(raw[offset + 4]) ?? undefined

    if (open === null || high === null || low === null || close === null) return null

    return {
      time: formatAxisTime(time, index),
      epoch: toEpochSeconds(time),
      open,
      high,
      low,
      close,
      volume,
    }
  }

  const open =
    toNumber(raw?.open) ??
    toNumber(raw?.o) ??
    toNumber(raw?.Open) ??
    toNumber(raw?.OPEN)

  const high =
    toNumber(raw?.high) ??
    toNumber(raw?.h) ??
    toNumber(raw?.High) ??
    toNumber(raw?.HIGH)

  const low =
    toNumber(raw?.low) ??
    toNumber(raw?.l) ??
    toNumber(raw?.Low) ??
    toNumber(raw?.LOW)

  const close =
    toNumber(raw?.close) ??
    toNumber(raw?.c) ??
    toNumber(raw?.Close) ??
    toNumber(raw?.CLOSE) ??
    toNumber(raw?.price) ??
    toNumber(raw?.last)

  if (open === null || high === null || low === null || close === null) return null

  const rawTime =
    raw?.epoch ??
    raw?.time ??
    raw?.timestamp ??
    raw?.createdAt ??
    raw?.t ??
    raw?.T ??
    raw?.date ??
    raw?.datetime ??
    raw?.Timestamp

  const formattedTime = formatAxisTime(rawTime, index)

  return {
    time: formattedTime,
    epoch: toEpochSeconds(raw?.epoch ?? rawTime ?? formattedTime),
    open,
    high,
    low,
    close,
    volume:
      toNumber(raw?.volume) ??
      toNumber(raw?.v) ??
      toNumber(raw?.Volume) ??
      undefined,
    symbol: raw?.symbol ?? raw?.ticker ?? raw?.S ?? raw?.s,
    timeframe: raw?.timeframe ?? raw?.tf ?? raw?.interval,
    provider: raw?.provider,
  }
}

function extractCandleArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []

  if (payload.candle && typeof payload.candle === 'object') return [payload.candle]
  if (payload.latest && typeof payload.latest === 'object') return [payload.latest]

  const directKeys = ['candles', 'bars', 'data', 'items', 'results', 'historicalCandles']

  for (const key of directKeys) {
    if (Array.isArray(payload[key])) return payload[key]
  }

  const nestedSources = [payload.data, payload.result, payload.payload, payload.response]

  for (const nested of nestedSources) {
    if (!nested || typeof nested !== 'object') continue

    if (nested.candle && typeof nested.candle === 'object') return [nested.candle]
    if (nested.latest && typeof nested.latest === 'object') return [nested.latest]

    for (const key of directKeys) {
      if (Array.isArray(nested[key])) return nested[key]
    }
  }

  return []
}

function mergeCandlesByTime(candles: Candle[]): Candle[] {
  const merged = new Map<string, Candle>()

  for (const candle of candles) {
    if (!candle) continue

    const epoch = candle.epoch ?? toEpochSeconds(candle.time)
    const open = toNumber(candle.open)
    const high = toNumber(candle.high)
    const low = toNumber(candle.low)
    const close = toNumber(candle.close)

    if (epoch === undefined || open === null || high === null || low === null || close === null) continue

    merged.set(String(epoch), {
      ...candle,
      time: candle.time || new Date(epoch * 1000).toISOString(),
      epoch,
      open,
      high,
      low,
      close,
    })
  }

  return Array.from(merged.values()).sort((a, b) => {
    const aEpoch = a.epoch ?? toEpochSeconds(a.time) ?? 0
    const bEpoch = b.epoch ?? toEpochSeconds(b.time) ?? 0
    return aEpoch - bEpoch
  })
}

function convertToHeikinAshi(candles: Candle[]): Candle[] {
  if (candles.length === 0) return []

  const haCandles: Candle[] = []

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]
    const haClose = (candle.open + candle.high + candle.low + candle.close) / 4
    const haOpen =
      i === 0
        ? (candle.open + candle.close) / 2
        : (haCandles[i - 1].open + haCandles[i - 1].close) / 2
    const haHigh = Math.max(candle.high, haOpen, haClose)
    const haLow = Math.min(candle.low, haOpen, haClose)

    haCandles.push({
      time: candle.time,
      epoch: candle.epoch,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      volume: candle.volume,
      symbol: candle.symbol,
      timeframe: candle.timeframe,
      provider: candle.provider,
    })
  }

  return haCandles
}


function getCandleCacheKey(symbol: string, timeframe: string) {
  return `${normalizeDefaultSymbol(symbol)}::${normalizeTimeframe(timeframe)}`
}

function requestedLimitNumber(limit: string): number {
  const parsed = Number(limit)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500
}

function getChartSettingsKey(compact: boolean, chartTitle?: string, fallbackTimeframe = '1m') {
  const identity = compact ? chartTitle || `mini-${fallbackTimeframe}` : 'main'
  return `${CHART_SETTINGS_PREFIX}${identity}`
}

function readChartSettings(key: string): Partial<{ symbol: string; timeframe: string; candleMode: CandleMode; overlayToggles: OverlayToggles; smmaOverlayLength: SmmaOverlayLength; nrtrOverlayMode: NrtrOverlayMode; nrtrExitMode: NrtrExitMode; nrtrPresetMode: NrtrPresetMode }> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return {}

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}

    return parsed
  } catch {
    return {}
  }
}

function saveChartSettings(
  key: string,
  settings: Partial<{ symbol: string; timeframe: string; candleMode: CandleMode; overlayToggles: OverlayToggles; smmaOverlayLength: SmmaOverlayLength; nrtrOverlayMode: NrtrOverlayMode; nrtrExitMode: NrtrExitMode; nrtrPresetMode: NrtrPresetMode }>
) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(key, JSON.stringify(settings))
  } catch {
    // Ignore storage quota/private-mode failures.
  }
}

function candleDataSignature(candles: Candle[]) {
  if (candles.length === 0) return 'empty'

  const first = candles[0]
  const last = candles[candles.length - 1]
  const firstEpoch = first.epoch ?? toEpochSeconds(first.time) ?? first.time
  const lastEpoch = last.epoch ?? toEpochSeconds(last.time) ?? last.time
  const lastClose = Number.isFinite(Number(last.close)) ? Number(last.close).toFixed(4) : 'na'

  return `${candles.length}:${firstEpoch}:${lastEpoch}:${lastClose}`
}

function overlayLayoutSignature(overlays?: ChartOverlays | null) {
  if (!overlays) return 'no-overlays'

  const ghostCount = Array.isArray(overlays.ghostCandles) ? overlays.ghostCandles.length : 0
  const profileCount = Array.isArray(overlays.alphaProfileBins) ? overlays.alphaProfileBins.length : 0
  const zoneCount = Array.isArray(overlays.zones) ? overlays.zones.length : 0
  const smcCount = Array.isArray(overlays.smcEvents) ? overlays.smcEvents.length : 0
  const liquidityCount = Array.isArray(overlays.liquidityEvents) ? overlays.liquidityEvents.length : 0

  return `${ghostCount}:${profileCount}:${zoneCount}:${smcCount}:${liquidityCount}`
}

function readMemoryCache(cacheKey: string): Candle[] | null {
  const cached = memoryCandleCache.get(cacheKey)
  if (!cached) return null

  if (Date.now() - cached.savedAt > CACHE_TTL_MS) {
    memoryCandleCache.delete(cacheKey)
    return null
  }

  return cached.candles
}

function readLocalStorageCache(cacheKey: string): Candle[] | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${cacheKey}`)
    if (!raw) return null

    const parsed = JSON.parse(raw) as CachedCandles
    if (!parsed || !Array.isArray(parsed.candles)) return null

    if (Date.now() - Number(parsed.savedAt ?? 0) > CACHE_TTL_MS) {
      window.localStorage.removeItem(`${LOCAL_STORAGE_PREFIX}${cacheKey}`)
      return null
    }

    memoryCandleCache.set(cacheKey, parsed)
    return parsed.candles
  } catch {
    return null
  }
}

function saveCandleCache(cacheKey: string, candles: Candle[]) {
  if (candles.length === 0) return

  const payload: CachedCandles = {
    candles,
    savedAt: Date.now(),
  }

  memoryCandleCache.set(cacheKey, payload)

  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${cacheKey}`, JSON.stringify(payload))
  } catch {
    // Ignore storage quota/private-mode failures.
  }
}


function emitMainCandleGateEvent(detail: Record<string, any>) {
  if (typeof window === 'undefined') return

  window.dispatchEvent(
    new CustomEvent('marketbos:candle-gate', {
      detail,
    })
  )
}

function setMainCandlesReady(detail: Record<string, any>) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(
      MAIN_CANDLES_READY_KEY,
      JSON.stringify({
        ...detail,
        ready: true,
        savedAt: Date.now(),
      })
    )
  } catch {
    // Ignore private-mode/quota errors.
  }

  emitMainCandleGateEvent({
    ...detail,
    ready: true,
  })
}

function setMainCandlesLoading(detail: Record<string, any>) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(
      MAIN_CANDLES_READY_KEY,
      JSON.stringify({
        ...detail,
        ready: false,
        savedAt: Date.now(),
      })
    )
  } catch {
    // Ignore private-mode/quota errors.
  }

  emitMainCandleGateEvent({
    ...detail,
    ready: false,
  })
}

function readMainCandlesReadyForSymbol(symbol: string) {
  if (typeof window === 'undefined') return false

  try {
    const raw = window.localStorage.getItem(MAIN_CANDLES_READY_KEY)
    if (!raw) return false

    const parsed = JSON.parse(raw)
    const storedSymbol = normalizeDefaultSymbol(parsed?.symbol ?? '')
    const count = Number(parsed?.count ?? 0)

    return Boolean(parsed?.ready) && count > 0 && storedSymbol === normalizeDefaultSymbol(symbol)
  } catch {
    return false
  }
}

async function preloadPrimaryCandles(
  signal?: AbortSignal,
  prioritySymbol = 'BTCUSD',
  priorityTimeframe = '1m'
) {
  // Speed fix:
  // Do not auto-preload multiple timeframes while the user is switching charts.
  // The previous preloader could make BTCUSD and MES1! feel delayed because it
  // requested 1m/5m/10m/15m in the background and competed with the selected chart.
  // Keep this as a safe no-op for now. The selected symbol/timeframe fetch is the priority.
  void signal
  void prioritySymbol
  void priorityTimeframe
  return
}


async function fetchCandlesFromNetwork(
  symbol: string,
  timeframe: string,
  limit: string,
  signal?: AbortSignal
): Promise<Candle[]> {
  // Send only the dashboard symbol.
  // api/main.py maps MES1! to the confirmed InsightSentry code CME_MINI:MES1!.
  const params = new URLSearchParams({
    symbol: normalizeDefaultSymbol(symbol),
    timeframe: normalizeTimeframe(timeframe),
    limit,
  })

  // Fast path first, safety fallback only if empty.
  // This keeps BTCUSD protected while keeping MES1! fast.
  const routes = [
    '/api/candles',
    '/api/merged-candles',
    '/api/historical-candles',
  ]

  for (const route of routes) {
    try {
      const response = await fetch(`${API_BASE_URL}${route}?${params.toString()}`, {
        cache: 'no-store',
        signal,
      })

      if (!response.ok) continue

      const json = await response.json()
      const candles = extractCandleArray(json)
        .map(candleFromAny)
        .filter((candle): candle is Candle => candle !== null)

      const merged = mergeCandlesByTime(candles)

      if (merged.length > 0) {
        return merged
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') throw error
      console.error(`Candle fetch error: ${route} ${symbol} ${timeframe}`, error)
    }
  }

  return []
}


async function fetchCandles(
  symbol: string,
  timeframe: string,
  limit: string,
  signal?: AbortSignal
): Promise<Candle[]> {
  const cacheKey = getCandleCacheKey(symbol, timeframe)

  const cached = readMemoryCache(cacheKey) ?? readLocalStorageCache(cacheKey)

  // Speed fix:
  // Any valid cached candle set should display immediately when switching
  // symbols/timeframes. Do not block the chart waiting for a full 500 refresh.
  // A later WebSocket/background refresh can update live data, but chart switching
  // must stay instant.
  if (cached && cached.length > 0) return cached

  const existingRequest = inflightCandleRequests.get(cacheKey)
  if (existingRequest) return existingRequest

  const request = fetchCandlesFromNetwork(symbol, timeframe, limit, signal)
    .then((candles) => {
      if (candles.length > 0) {
        saveCandleCache(cacheKey, candles)
        return candles
      }

      return cached ?? []
    })
    .finally(() => {
      inflightCandleRequests.delete(cacheKey)
    })

  inflightCandleRequests.set(cacheKey, request)
  return request
}



async function fetchLivePrice(
  symbol: string,
  timeframe: string,
  signal?: AbortSignal
): Promise<LivePricePayload | null> {
  const params = new URLSearchParams({
    symbol: normalizeDefaultSymbol(symbol),
    timeframe: normalizeTimeframe(timeframe),
  })

  try {
    const response = await fetch(`${API_BASE_URL}/api/live-price?${params.toString()}`, {
      cache: 'no-store',
      signal,
    })

    if (!response.ok) return null

    const json = await response.json()
    const price = Number(json?.price)

    if (!Number.isFinite(price) || price <= 0) return null

    return json as LivePricePayload
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error
    console.error(`Live price fetch error: /api/live-price ${symbol} ${timeframe}`, error)
    return null
  }
}

function applyLivePriceToCandles(
  candles: Candle[],
  livePrice: LivePricePayload | null,
  timeframe: string,
  maxCandles = 500
): Candle[] {
  if (!livePrice || candles.length === 0) return candles

  const price = Number(livePrice.price)
  if (!Number.isFinite(price) || price <= 0) return candles

  const liveEpoch =
    toEpochSeconds(livePrice.epoch) ??
    toEpochSeconds(livePrice.time) ??
    toEpochSeconds(livePrice.timestamp) ??
    Math.floor(Date.now() / 1000)

  const liveBucket =
    Number.isFinite(Number(livePrice.bucketEpoch)) && Number(livePrice.bucketEpoch) > 0
      ? Math.floor(Number(livePrice.bucketEpoch))
      : floorEpochToTimeframe(liveEpoch, timeframe)

  const last = candles[candles.length - 1]
  const lastEpoch = last.epoch ?? toEpochSeconds(last.time) ?? liveBucket
  const lastBucket = floorEpochToTimeframe(lastEpoch, timeframe)

  // Ignore old live payloads so they never pull the chart backwards.
  if (liveBucket < lastBucket) return candles

  const next = candles.slice()

  if (liveBucket === lastBucket) {
    const updated: Candle = {
      ...last,
      high: Math.max(Number(last.high), price),
      low: Math.min(Number(last.low), price),
      close: price,
      volume: Number(last.volume ?? 0),
      provider: livePrice.provider || last.provider,
    }

    next[next.length - 1] = updated
    return next
  }

  const newCandle: Candle = {
    time: isoFromEpochSeconds(liveBucket),
    epoch: liveBucket,
    open: Number(last.close),
    high: Math.max(Number(last.close), price),
    low: Math.min(Number(last.close), price),
    close: price,
    volume: 0,
    symbol: normalizeDefaultSymbol(livePrice.symbol ?? last.symbol),
    timeframe: normalizeTimeframe(livePrice.timeframe ?? timeframe),
    provider: livePrice.provider ?? 'live',
  }

  next.push(newCandle)
  return next.slice(-maxCandles)
}

function getInitialZoom(candleCount: number, totalCount = candleCount) {
  const safeCandleCount = Math.max(candleCount, 1)
  const safeTotal = Math.max(totalCount, safeCandleCount, 1)
  const visible = Math.min(DEFAULT_VISIBLE_CANDLES, safeTotal)

  // Anchor the default view around the current live candle, not the far-right
  // synthetic AlphaX profile labels. This keeps candle bodies readable while
  // still leaving enough space to see ghost candles and the liquidity profile.
  const rightPadding = Math.max(0, Math.min(safeTotal - safeCandleCount, GHOST_LEADING_GAP_BARS + 5))
  const endValue = Math.min(safeTotal - 1, safeCandleCount - 1 + rightPadding)

  return {
    startValue: Math.max(0, endValue - visible + 1),
    endValue,
  }
}

function overlayColor(direction: any, opacity = 1) {
  const side = String(direction ?? '').toLowerCase()
  if (side.includes('bull')) return `rgba(38, 166, 154, ${opacity})`
  if (side.includes('bear')) return `rgba(239, 83, 80, ${opacity})`
  return `rgba(156, 163, 175, ${opacity})`
}

function overlayTextColor(direction: any) {
  const side = String(direction ?? '').toLowerCase()
  if (side.includes('bull')) return '#26a69a'
  if (side.includes('bear')) return '#ef5350'
  return '#9ca3af'
}

function nearestAxisTime(rawTime: any, axisCandles: Candle[]): string | undefined {
  if (!rawTime || axisCandles.length === 0) return undefined

  const rawEpoch = toEpochSeconds(rawTime)
  if (rawEpoch === undefined) return String(rawTime)

  let best = axisCandles[0]
  let bestDistance = Math.abs((best.epoch ?? toEpochSeconds(best.time) ?? 0) - rawEpoch)

  for (const candle of axisCandles) {
    const epoch = candle.epoch ?? toEpochSeconds(candle.time)
    if (epoch === undefined) continue
    const distance = Math.abs(epoch - rawEpoch)
    if (distance < bestDistance) {
      best = candle
      bestDistance = distance
    }
  }

  return best.time
}

function buildFutureGhostAxisLabels(candles: Candle[], ghosts: GhostCandle[], timeframe: string) {
  if (candles.length === 0 || ghosts.length === 0) return []

  const last = candles[candles.length - 1]
  const lastEpoch = last.epoch ?? toEpochSeconds(last.time) ?? Math.floor(Date.now() / 1000)
  const seconds = timeframeSeconds(timeframe)

  return ghosts.map((_, index) => isoFromEpochSeconds(lastEpoch + seconds * (index + 1)))
}

function buildZoneMarkAreas(zones: ChartZone[] | undefined, axisCandles: Candle[]) {
  if (!Array.isArray(zones)) return []

  const cleanedZones = zones
    .filter((zone) => {
      const kind = String(zone.kind ?? '').toLowerCase()
      return (
        kind.includes('premium') ||
        kind.includes('discount') ||
        kind.includes('equilibrium') ||
        kind.includes('ob') ||
        kind.includes('fvg')
      )
    })
    .slice(-MAX_ZONE_COUNT)

  return cleanedZones
    .map((zone) => {
      const top = toNumber(zone.top)
      const bottom = toNumber(zone.bottom)
      if (top === null || bottom === null) return null

      const start = nearestAxisTime(zone.startTime, axisCandles) ?? axisCandles[Math.max(0, axisCandles.length - 160)]?.time
      const end = nearestAxisTime(zone.endTime, axisCandles) ?? axisCandles[axisCandles.length - 1]?.time
      if (!start || !end) return null

      const kind = String(zone.kind ?? '').toLowerCase()
      const isPdZone = kind.includes('premium') || kind.includes('discount') || kind.includes('equilibrium')

      return [
        {
          xAxis: start,
          yAxis: Math.max(top, bottom),
          itemStyle: {
            color: overlayColor(zone.direction, isPdZone ? 0.10 : 0.14),
            borderColor: overlayColor(zone.direction, isPdZone ? 0.24 : 0.38),
            borderWidth: isPdZone ? 0.75 : 1,
          },
          label: {
            show: isPdZone,
            color: overlayTextColor(zone.direction),
            fontSize: 10,
            fontWeight: 700,
            formatter: zone.label ?? zone.kind ?? '',
          },
        },
        {
          xAxis: end,
          yAxis: Math.min(top, bottom),
        },
      ]
    })
    .filter(Boolean) as any[]
}

function buildMarkerData(
  markers: ChartMarker[] | undefined,
  axisCandles: Candle[],
  maxCount = 8,
  showLabels = true
) {
  if (!Array.isArray(markers)) return []

  return markers
    .slice(-maxCount)
    .map((marker) => {
      const price = toNumber(marker.price)
      const time = nearestAxisTime(marker.time, axisCandles)
      if (price === null || !time) return null

      const label = String(marker.tag ?? marker.label ?? marker.kind ?? '')
      const direction = String(marker.direction ?? '').toLowerCase()
      const isBearish = direction.includes('bear')

      return {
        value: [time, price],
        name: label,
        marker,
        symbol: label.toLowerCase().includes('sweep') || label.toLowerCase().includes('pool') ? 'diamond' : 'circle',
        itemStyle: {
          color: overlayTextColor(marker.direction),
          borderColor: '#111827',
          borderWidth: 1,
          opacity: 0.95,
        },
        label: {
          show: showLabels && Boolean(label),
          formatter: label
            .replace('Buy-Side Sweep', 'BS Sweep')
            .replace('Sell-Side Sweep', 'SS Sweep')
            .replace('Buy-Side Pool', 'BS Pool')
            .replace('Sell-Side Pool', 'SS Pool')
            .replace('Bullish FVG', 'Bull FVG')
            .replace('Bearish FVG', 'Bear FVG'),
          color: overlayTextColor(marker.direction),
          fontSize: 9,
          fontWeight: 700,
          backgroundColor: 'rgba(15,17,21,0.55)',
          borderRadius: 3,
          padding: [1, 3],
          position: isBearish ? 'top' : 'bottom',
          distance: 5,
        },
      }
    })
    .filter(Boolean) as any[]
}

function buildDlmMarkLines(levels: DlmLevel[] | undefined) {
  if (!Array.isArray(levels)) return []

  return levels
    .map((level) => {
      const price = toNumber(level.price)
      if (price === null) return null

      const label = String(level.label ?? 'DLM')
      const isPoc = label.toLowerCase().includes('poc')

      return {
        yAxis: price,
        name: label,
        lineStyle: {
          color: isPoc ? '#d1d5db' : overlayTextColor(level.direction),
          width: isPoc ? 1.25 : 1,
          type: isPoc ? 'solid' : 'dotted',
          opacity: isPoc ? 0.9 : 0.45,
        },
        label: {
          show: isPoc,
          formatter: isPoc ? 'AlphaX POC' : '',
          color: '#d1d5db',
          fontSize: 10,
          fontWeight: 700,
          backgroundColor: 'rgba(15,17,21,0.72)',
          borderRadius: 3,
          padding: [2, 4],
        },
      }
    })
    .filter(Boolean) as any[]
}

function buildGhostCandleData(activeLength: number, ghosts: GhostCandle[], leadingGap = 0) {
  const empty = Array.from({ length: activeLength + leadingGap }, () => '-')
  const ghostData = ghosts.map((ghost) => {
    const open = toNumber(ghost.open)
    const close = toNumber(ghost.close)
    const low = toNumber(ghost.low)
    const high = toNumber(ghost.high)
    if (open === null || close === null || low === null || high === null) return '-'
    return [open, close, low, high]
  })

  return [...empty, ...ghostData]
}

function buildFutureSpacerLabels(startIndex: number, count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${startIndex + index + 1}`)
}

function buildAlphaProfileFutureLabels(startIndex: number, count = ALPHA_PROFILE_WIDTH_BARS) {
  return buildFutureSpacerLabels(startIndex, count, 'AlphaProfile')
}

function buildAlphaProfileCustomData(
  bins: any[] | undefined,
  xStartIndex: number,
  activeCandles: Candle[]
) {
  if (!Array.isArray(bins) || bins.length === 0 || activeCandles.length === 0) return []

  return bins
    .map((bin) => {
      const price = toNumber(bin.price)
      const volumePct = toNumber(bin.volumePct)
      const buyPct = toNumber(bin.buyPct)
      const sellPct = toNumber(bin.sellPct)
      if (price === null || volumePct === null) return null

      const direction = String(bin.direction ?? (buyPct !== null && sellPct !== null && buyPct >= sellPct ? 'bullish' : 'bearish')).toLowerCase()
      const clampedVolume = Math.max(2, Math.min(100, volumePct))

      return {
        value: [xStartIndex, price, clampedVolume, direction.includes('bear') ? -1 : 1],
        bin,
      }
    })
    .filter(Boolean) as any[]
}

function buildAlphaProfileRenderItem() {
  return (params: any, api: any) => {
    const xIndex = api.value(0)
    const price = api.value(1)
    const volumePct = api.value(2)
    const side = api.value(3)

    const point = api.coord([xIndex, price])
    const maxWidth = Math.max(34, Math.min(118, api.getWidth() * 0.115))
    const width = Math.max(8, (Number(volumePct) / 100) * maxWidth)
    const height = 5
    const fill = side < 0
      ? `rgba(239, 83, 80, ${0.24 + Math.min(Number(volumePct), 100) / 180})`
      : `rgba(38, 166, 154, ${0.24 + Math.min(Number(volumePct), 100) / 180})`

    return {
      type: 'rect',
      shape: {
        x: point[0],
        y: point[1] - height / 2,
        width,
        height,
      },
      style: {
        fill,
        stroke: side < 0 ? 'rgba(239, 83, 80, 0.72)' : 'rgba(38, 166, 154, 0.72)',
        lineWidth: 0.5,
      },
      silent: true,
    }
  }
}

const overlayMemoryCache = new Map<string, { createdAt: number; payload: any }>()

function getOverlayFlagKey(toggles: OverlayToggles) {
  return `smc=${Number(toggles.smc)}:ghost=${Number(toggles.ghost)}:profile=${Number(toggles.liquidityProfile)}:ob=${Number(toggles.orderBlocks)}`
}

function getOverlayCacheKey(symbol: string, timeframe: string, toggles: OverlayToggles = DEFAULT_OVERLAY_TOGGLES) {
  return `${normalizeDefaultSymbol(symbol)}::${normalizeTimeframe(timeframe)}::${getOverlayFlagKey(toggles)}`
}

function readOverlayMemoryCache(symbol: string, timeframe: string, toggles: OverlayToggles = DEFAULT_OVERLAY_TOGGLES, maxAgeMs = 15000) {
  const key = getOverlayCacheKey(symbol, timeframe, toggles)
  const cached = overlayMemoryCache.get(key)
  if (!cached) return null

  if (Date.now() - cached.createdAt > maxAgeMs) return null
  return cached.payload
}

function saveOverlayMemoryCache(symbol: string, timeframe: string, toggles: OverlayToggles, payload: any) {
  const key = getOverlayCacheKey(symbol, timeframe, toggles)
  overlayMemoryCache.set(key, {
    createdAt: Date.now(),
    payload,
  })
}

function overlayHasRequestedData(overlays: ChartOverlays | null | undefined, toggles: OverlayToggles) {
  if (!overlays || typeof overlays !== 'object') return false

  const hasSmc =
    (Array.isArray(overlays.smcEvents) && overlays.smcEvents.length > 0) ||
    (Array.isArray(overlays.liquidityEvents) && overlays.liquidityEvents.length > 0)

  const hasGhost =
    Array.isArray(overlays.ghostCandles) && overlays.ghostCandles.length > 0

  const hasProfile =
    (Array.isArray(overlays.alphaProfileBins) && overlays.alphaProfileBins.length > 0) ||
    (Array.isArray(overlays.dlmLevels) && overlays.dlmLevels.length > 0)

  const hasOrderBlocks =
    Array.isArray(overlays.zones) && overlays.zones.length > 0

  return (
    (toggles.smc && hasSmc) ||
    (toggles.ghost && hasGhost) ||
    (toggles.liquidityProfile && hasProfile) ||
    (toggles.orderBlocks && hasOrderBlocks)
  )
}

function getBackendOverlayStatus(engine: any, overlays: ChartOverlays | null | undefined, toggles: OverlayToggles): OverlayRenderStatus {
  if (!overlayHasRequestedData(overlays, toggles)) return 'empty'

  const cacheText = [
    engine?.cache,
    engine?.rawCache,
    engine?.source,
    overlays?.source,
    (overlays as any)?.__backendCache,
    (overlays as any)?.__backendRawCache,
    (overlays as any)?.__backendSource,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const fallbackApplied = Boolean(
    engine?.chartOverlays?.fallbackVisualsApplied ||
    (overlays as any)?.fallbackVisualsApplied ||
    (overlays as any)?.__fallbackApplied
  )

  const sourceText = String(overlays?.source ?? engine?.source ?? '').toLowerCase()
  const isClientFallback = sourceText.includes('client_guaranteed_overlay_fallback')

  if (isClientFallback) return 'fallback'

  // Backend refreshed raw overlay cache from candle data/heavy engine during this request.
  if (
    cacheText.includes('raw_refreshed') ||
    cacheText.includes('refreshed') ||
    cacheText.includes('python_only_no_webhook')
  ) {
    return fallbackApplied ? 'cached' : 'real'
  }

  // Backend used an already-warmed / filtered cache.
  if (
    cacheText.includes('raw_fresh') ||
    cacheText.includes('fresh') ||
    cacheText.includes('filtered_from_raw_cache') ||
    cacheText.includes('cache')
  ) {
    return 'cached'
  }

  return fallbackApplied ? 'fallback' : 'real'
}

function buildClientFallbackOverlays(candles: Candle[], toggles: OverlayToggles): ChartOverlays | null {
  if (!hasAnyOverlayEnabled(toggles) || candles.length < 5) return null

  const recent = candles.slice(-Math.min(candles.length, 180))
  const last = candles[candles.length - 1]
  const start = recent[0]
  const highs = recent.map((candle) => Number(candle.high)).filter(Number.isFinite)
  const lows = recent.map((candle) => Number(candle.low)).filter(Number.isFinite)
  const closes = recent.map((candle) => Number(candle.close)).filter(Number.isFinite)

  if (highs.length === 0 || lows.length === 0 || closes.length === 0) return null

  const high = Math.max(...highs)
  const low = Math.min(...lows)
  const span = Math.max(high - low, Math.abs(Number(last.close || 0)) * 0.0005, 0.0001)
  const mid = (high + low) / 2
  const lastClose = Number(last.close)
  const lastTime = last.time
  const startTime = start.time
  const direction = lastClose >= mid ? 'bullish' : 'bearish'

  const fallback: ChartOverlays = {
    source: 'client_guaranteed_overlay_fallback',
  }

  if (toggles.smc) {
    fallback.smcEvents = [
      {
        time: lastTime,
        price: lastClose,
        label: direction === 'bullish' ? 'BOS' : 'CHoCH',
        direction,
        kind: 'client_fallback_smc',
        score: 55,
      },
    ]

    fallback.liquidityEvents = [
      {
        time: lastTime,
        price: high,
        label: 'BS Sweep',
        direction: 'bearish',
        kind: 'client_fallback_buy_side_sweep',
      },
      {
        time: lastTime,
        price: low,
        label: 'SS Sweep',
        direction: 'bullish',
        kind: 'client_fallback_sell_side_sweep',
      },
    ]
  }

  if (toggles.orderBlocks) {
    fallback.zones = [
      {
        startTime,
        endTime: lastTime,
        top: high,
        bottom: mid,
        label: 'Premium',
        direction: 'bearish',
        kind: 'premium_zone',
      },
      {
        startTime,
        endTime: lastTime,
        top: mid,
        bottom: low,
        label: 'Discount',
        direction: 'bullish',
        kind: 'discount_zone',
      },
    ]
  }

  if (toggles.liquidityProfile) {
    fallback.dlmLevels = [
      {
        label: 'AlphaX POC',
        price: mid,
        direction: 'neutral',
      },
      {
        label: 'DLM Buy Liquidity',
        price: low + span * 0.25,
        direction: 'bullish',
      },
      {
        label: 'DLM Sell Liquidity',
        price: high - span * 0.25,
        direction: 'bearish',
      },
    ]

    fallback.alphaProfileMeta = {
      pocPrice: mid,
      low,
      high,
      source: 'client_fallback_profile',
    }

    fallback.alphaProfileBins = Array.from({ length: 24 }, (_, index) => {
      const binLow = low + (span * index) / 24
      const binHigh = low + (span * (index + 1)) / 24
      const price = (binLow + binHigh) / 2
      const touches = closes.filter((close) => close >= binLow && close <= binHigh).length
      const volumePct = Math.max(4, Math.min(100, (touches / Math.max(closes.length, 1)) * 260))

      return {
        price,
        low: binLow,
        high: binHigh,
        volumePct,
        direction: price <= mid ? 'bullish' : 'bearish',
        label: `${Math.round(volumePct)}%`,
      }
    })
  }

  if (toggles.ghost) {
    const currentDirection =
      closes.length >= 2 && closes[closes.length - 1] >= closes[closes.length - 2]
        ? 'bullish'
        : 'bearish'
    const sign = currentDirection === 'bullish' ? 1 : -1
    const step = span * 0.035

    fallback.ghostCandles = Array.from({ length: 3 }, (_, index) => {
      const move = step * (index + 1) * sign
      const open = lastClose + move * 0.35
      const close = lastClose + move
      const highValue = Math.max(open, close) + step * 0.45
      const lowValue = Math.min(open, close) - step * 0.45

      return {
        label: `Ghost #${index + 1}`,
        open,
        high: highValue,
        low: lowValue,
        close,
        confidence: Math.max(18, 50 - index * 8),
        direction: currentDirection,
        source: 'client_fallback_ghost',
      }
    })
  }

  return fallback
}

function mergeOverlayFallback(
  overlays: ChartOverlays | null | undefined,
  fallback: ChartOverlays | null,
  toggles: OverlayToggles
): ChartOverlays | null {
  if (!fallback) return overlays ?? null

  const merged: ChartOverlays = {
    ...(overlays ?? {}),
    source: overlays?.source ?? fallback.source,
  }

  if (toggles.smc) {
    if (!Array.isArray(merged.smcEvents) || merged.smcEvents.length === 0) {
      merged.smcEvents = fallback.smcEvents
    }
    if (!Array.isArray(merged.liquidityEvents) || merged.liquidityEvents.length === 0) {
      merged.liquidityEvents = fallback.liquidityEvents
    }
  }

  if (toggles.orderBlocks && (!Array.isArray(merged.zones) || merged.zones.length === 0)) {
    merged.zones = fallback.zones
  }

  if (toggles.liquidityProfile) {
    if (!Array.isArray(merged.dlmLevels) || merged.dlmLevels.length === 0) {
      merged.dlmLevels = fallback.dlmLevels
    }
    if (!Array.isArray(merged.alphaProfileBins) || merged.alphaProfileBins.length === 0) {
      merged.alphaProfileBins = fallback.alphaProfileBins
    }
    if (!merged.alphaProfileMeta || Object.keys(merged.alphaProfileMeta).length === 0) {
      merged.alphaProfileMeta = fallback.alphaProfileMeta
    }
  }

  if (toggles.ghost && (!Array.isArray(merged.ghostCandles) || merged.ghostCandles.length === 0)) {
    merged.ghostCandles = fallback.ghostCandles
  }

  ;(merged as any).__fallbackApplied = Boolean(
    (toggles.smc && (
      merged.smcEvents === fallback.smcEvents ||
      merged.liquidityEvents === fallback.liquidityEvents
    )) ||
    (toggles.orderBlocks && merged.zones === fallback.zones) ||
    (toggles.liquidityProfile && (
      merged.dlmLevels === fallback.dlmLevels ||
      merged.alphaProfileBins === fallback.alphaProfileBins
    )) ||
    (toggles.ghost && merged.ghostCandles === fallback.ghostCandles)
  )

  return merged
}

function overlayPayloadMatches(payload: any, symbol: string, timeframe: string) {
  if (!payload || typeof payload !== 'object') return false

  const payloadSymbol = normalizeDefaultSymbol(payload.symbol ?? symbol)
  const payloadTimeframe = normalizeDefaultTimeframe(payload.timeframe ?? timeframe)

  return (
    payloadSymbol === normalizeDefaultSymbol(symbol) &&
    payloadTimeframe === normalizeDefaultTimeframe(timeframe)
  )
}

function overlayPayloadHasRequestedData(overlays: ChartOverlays | null | undefined, toggles: OverlayToggles) {
  if (!overlays || typeof overlays !== 'object') return false

  const hasSmc =
    Array.isArray(overlays.smcEvents) && overlays.smcEvents.length > 0 ||
    Array.isArray(overlays.liquidityEvents) && overlays.liquidityEvents.length > 0

  const hasGhost =
    Array.isArray(overlays.ghostCandles) && overlays.ghostCandles.length > 0

  const hasProfile =
    Array.isArray(overlays.alphaProfileBins) && overlays.alphaProfileBins.length > 0 ||
    Array.isArray(overlays.dlmLevels) && overlays.dlmLevels.length > 0

  const hasOrderBlocks =
    Array.isArray(overlays.zones) && overlays.zones.length > 0

  return (
    (toggles.smc && hasSmc) ||
    (toggles.ghost && hasGhost) ||
    (toggles.liquidityProfile && hasProfile) ||
    (toggles.orderBlocks && hasOrderBlocks)
  )
}

async function fetchChartOverlays(
  symbol: string,
  timeframe: string,
  toggles: OverlayToggles,
  signal?: AbortSignal
): Promise<any | null> {
  const params = new URLSearchParams({
    symbol: normalizeDefaultSymbol(symbol),
    timeframe: normalizeTimeframe(timeframe),
    limit: '500',
    smc: String(Boolean(toggles.smc)),
    ghost: String(Boolean(toggles.ghost)),
    profile: String(Boolean(toggles.liquidityProfile)),
    orderBlocks: String(Boolean(toggles.orderBlocks)),
  })

  try {
    const response = await fetch(`${API_BASE_URL}/api/chart-overlays?${params.toString()}`, {
      cache: 'no-store',
      signal,
    })

    if (!response.ok) return null
    const json = await response.json()

    if (!overlayPayloadMatches(json, symbol, timeframe)) {
      console.warn('Ignored mismatched chart overlay payload:', {
        requestedSymbol: symbol,
        requestedTimeframe: timeframe,
        payloadSymbol: json?.symbol,
        payloadTimeframe: json?.timeframe,
      })
      return null
    }

    saveOverlayMemoryCache(symbol, timeframe, toggles, json)
    return json
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error
    console.error(`Chart overlay fetch error: /api/chart-overlays ${symbol} ${timeframe}`, error)
    return readOverlayMemoryCache(symbol, timeframe, toggles, 120000)
  }
}

async function warmChartOverlayRawCache(
  symbol: string,
  timeframe: string,
  signal?: AbortSignal
) {
  const normalizedSymbol = normalizeDefaultSymbol(symbol)
  const normalizedTimeframe = normalizeTimeframe(timeframe)
  const warmKey = `${normalizedSymbol}::${normalizedTimeframe}`

  if (warmedOverlayRawCacheKeys.has(warmKey)) return
  warmedOverlayRawCacheKeys.add(warmKey)

  try {
    // This silently warms the backend raw overlay cache.
    // It does not draw anything. Toggle requests after this should filter cached raw overlays quickly.
    await fetchChartOverlays(normalizedSymbol, normalizedTimeframe, WARM_ALL_OVERLAY_TOGGLES, signal)
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error
    warmedOverlayRawCacheKeys.delete(warmKey)
    console.warn('Overlay warm cache failed:', error)
  }
}


function normalizeSmmaOverlayLength(value: unknown): SmmaOverlayLength {
  const text = String(value ?? 'Off')
  if (text === '20') return '20'
  if (text === '50') return '50'
  return 'Off'
}

function calculateSmma(values: number[], length: number) {
  const result: Array<number | null> = Array(values.length).fill(null)

  if (!Number.isFinite(length) || length <= 0 || values.length < length) {
    return result
  }

  let seedSum = 0

  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index])

    if (!Number.isFinite(value)) {
      result[index] = null
      continue
    }

    if (index < length) {
      seedSum += value

      if (index === length - 1) {
        result[index] = seedSum / length
      }

      continue
    }

    const previous = result[index - 1]
    result[index] =
      previous === null || !Number.isFinite(previous)
        ? null
        : (previous * (length - 1) + value) / length
  }

  return result
}

function normalizeNrtrOverlayMode(value: unknown): NrtrOverlayMode {
  const text = String(value ?? 'Off')
  if (text === 'ATR-Based') return 'ATR-Based'
  if (text === 'Percentage') return 'Percentage'
  return 'Off'
}

function normalizeNrtrExitMode(value: unknown): NrtrExitMode {
  const text = String(value ?? 'Off')
  if (text === 'Pivot Pullback') return 'Pivot Pullback'
  if (text === 'Internal SuperTrend End') return 'Internal SuperTrend End'
  return 'Off'
}

function normalizeNrtrPresetMode(value: unknown): NrtrPresetMode {
  const text = String(value ?? 'Scalping')
  if (text === 'Swing') return 'Swing'
  if (text === 'Long') return 'Long'
  return 'Scalping'
}

function getNrtrPresetValues(preset: NrtrPresetMode) {
  if (preset === 'Long') {
    return {
      atrMultiplier: 5.0,
      percent: 0.5,
      label: 'Long',
    }
  }

  if (preset === 'Swing') {
    return {
      atrMultiplier: 3.0,
      percent: 0.25,
      label: 'Swing',
    }
  }

  return {
    atrMultiplier: 1.5,
    percent: 0.15,
    label: 'Scalping',
  }
}

type NrtrExitPoint = {
  time: string
  value: number
  direction: 1 | -1
  label: string
}

type NrtrPoint = {
  time: string
  value: number | null
  direction: 1 | -1 | 0
  buy: boolean
  sell: boolean
}

function calculateAtr(candles: Candle[], length: number) {
  const atrValues: Array<number | null> = Array(candles.length).fill(null)

  if (candles.length === 0 || length <= 0) return atrValues

  const trueRanges = candles.map((candle, index) => {
    const high = Number(candle.high)
    const low = Number(candle.low)
    const previousClose = index > 0 ? Number(candles[index - 1].close) : Number(candle.close)

    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose)
    )
  })

  let seedSum = 0

  for (let index = 0; index < trueRanges.length; index += 1) {
    const value = trueRanges[index]

    if (index < length) {
      seedSum += value

      if (index === length - 1) {
        atrValues[index] = seedSum / length
      }

      continue
    }

    const previousAtr = atrValues[index - 1]

    atrValues[index] =
      previousAtr === null || !Number.isFinite(previousAtr)
        ? null
        : (previousAtr * (length - 1) + value) / length
  }

  return atrValues
}

function calculateNrtrPercentage(candles: Candle[], percent = 0.25): NrtrPoint[] {
  const result: NrtrPoint[] = []
  const coefficient = Math.max(0, Math.min(100, percent)) / 100

  if (candles.length === 0) return result

  let trend: 1 | -1 = 1
  let highestPoint = Number(candles[0].high)
  let lowestPoint = Number(candles[0].low)
  let nrtr = highestPoint * (1 - coefficient)

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]
    const high = Number(candle.high)
    const low = Number(candle.low)
    const previousTrend = trend

    if (trend === 1) {
      if (high > highestPoint) highestPoint = high
      nrtr = highestPoint * (1 - coefficient)

      if (low <= nrtr) {
        trend = -1
        lowestPoint = low
        nrtr = lowestPoint * (1 + coefficient)
      }
    } else {
      if (low < lowestPoint) lowestPoint = low
      nrtr = lowestPoint * (1 + coefficient)

      if (high >= nrtr) {
        trend = 1
        highestPoint = high
        nrtr = highestPoint * (1 - coefficient)
      }
    }

    result.push({
      time: candle.time,
      value: Number.isFinite(nrtr) ? nrtr : null,
      direction: trend,
      buy: index > 0 && trend === 1 && previousTrend === -1,
      sell: index > 0 && trend === -1 && previousTrend === 1,
    })
  }

  return result
}

function calculateNrtrAtrSuperTrend(candles: Candle[], atrLength = 14, atrMultiplier = 3): NrtrPoint[] {
  const result: NrtrPoint[] = []
  if (candles.length === 0) return result

  // TradingView ta.supertrend-compatible logic:
  // Pine cpDir is -1 in bullish mode and +1 in bearish mode.
  // This dashboard uses +1 bullish and -1 bearish, so we invert that behavior.
  const atrValues = calculateAtr(candles, atrLength)

  let finalUpper: number | null = null
  let finalLower: number | null = null
  let previousSuperTrend: number | null = null
  let previousFinalUpper: number | null = null
  let previousFinalLower: number | null = null
  let direction: 1 | -1 | 0 = 0

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]
    const high = Number(candle.high)
    const low = Number(candle.low)
    const close = Number(candle.close)
    const previousClose = index > 0 ? Number(candles[index - 1].close) : close
    const atr = atrValues[index]
    const previousDirection = direction

    if (atr === null || !Number.isFinite(atr)) {
      result.push({
        time: candle.time,
        value: null,
        direction: 0,
        buy: false,
        sell: false,
      })
      continue
    }

    const hl2 = (high + low) / 2
    const basicUpper = hl2 + atrMultiplier * atr
    const basicLower = hl2 - atrMultiplier * atr

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

    // Match the standard SuperTrend state transition:
    // if previous ST was the upper band, price must close above upper band to flip bullish;
    // if previous ST was the lower band, price must close below lower band to flip bearish.
    if (previousSuperTrend === null) {
      direction = close >= hl2 ? 1 : -1
    } else if (previousFinalUpper !== null && Math.abs(previousSuperTrend - previousFinalUpper) <= 1e-10) {
      direction = close > finalUpper ? 1 : -1
    } else {
      direction = close < finalLower ? -1 : 1
    }

    const superTrend = direction === 1 ? finalLower : finalUpper

    result.push({
      time: candle.time,
      value: Number.isFinite(superTrend ?? NaN) ? Number(superTrend) : null,
      direction,
      buy: index > 0 && previousDirection === -1 && direction === 1,
      sell: index > 0 && previousDirection === 1 && direction === -1,
    })

    previousSuperTrend = superTrend
    previousFinalUpper = finalUpper
    previousFinalLower = finalLower
  }

  return result
}

function calculateNrtrOverlay(candles: Candle[], mode: NrtrOverlayMode, preset: NrtrPresetMode) {
  const presetValues = getNrtrPresetValues(preset)

  if (mode === 'ATR-Based') {
    return calculateNrtrAtrSuperTrend(candles, 14, presetValues.atrMultiplier)
  }

  if (mode === 'Percentage') {
    return calculateNrtrPercentage(candles, presetValues.percent)
  }

  return []
}

function calculateNrtrExitPoints(
  candles: Candle[],
  nrtrPoints: NrtrPoint[],
  exitMode: NrtrExitMode,
  pivotLength = 5
): NrtrExitPoint[] {
  if (exitMode === 'Off' || candles.length === 0 || nrtrPoints.length === 0) return []

  const exits: NrtrExitPoint[] = []
  let exitLocked = false

  const internalPoints =
    exitMode === 'Internal SuperTrend End'
      ? calculateNrtrAtrSuperTrend(candles, 10, 1.5)
      : []

  for (let index = 1; index < candles.length; index += 1) {
    const point = nrtrPoints[index]
    const previousPoint = nrtrPoints[index - 1]
    const direction = point?.direction ?? 0
    const previousDirection = previousPoint?.direction ?? 0

    if (direction !== previousDirection) {
      exitLocked = false
    }

    if (direction === 0) continue

    if (exitMode === 'Pivot Pullback') {
      const lookbackStart = Math.max(0, index - pivotLength)
      const previousLookbackStart = Math.max(0, index - 1 - pivotLength)
      const previousWindow = candles.slice(previousLookbackStart, index)
      const currentWindow = candles.slice(lookbackStart, index + 1)

      const previousHighest = Math.max(...previousWindow.map((candle) => Number(candle.high)))
      const previousLowest = Math.min(...previousWindow.map((candle) => Number(candle.low)))
      const currentHighest = Math.max(...currentWindow.map((candle) => Number(candle.high)))
      const currentLowest = Math.min(...currentWindow.map((candle) => Number(candle.low)))

      const candle = candles[index]
      const previousCandle = candles[index - 1]
      const trendValue = Number(point.value ?? NaN)
      const previousTrendValue = Number(previousPoint?.value ?? NaN)

      const newExtremeLong =
        direction === 1 &&
        Number(candle.high) > previousHighest

      const newExtremeShort =
        direction === -1 &&
        Number(candle.low) < previousLowest

      if (newExtremeLong || newExtremeShort) {
        exitLocked = false
      }

      const exitLong =
        direction === 1 &&
        Number(previousCandle.high) >= previousHighest &&
        Number(candle.close) < Number(previousCandle.close) &&
        Number.isFinite(trendValue) &&
        Number.isFinite(previousTrendValue) &&
        trendValue <= previousTrendValue

      const exitShort =
        direction === -1 &&
        Number(previousCandle.low) <= previousLowest &&
        Number(candle.close) > Number(previousCandle.close) &&
        Number.isFinite(trendValue) &&
        Number.isFinite(previousTrendValue) &&
        trendValue >= previousTrendValue

      if (!exitLocked && exitLong) {
        exits.push({
          time: candle.time,
          value: Number(candle.high),
          direction: 1,
          label: 'Exit Long',
        })
        exitLocked = true
      }

      if (!exitLocked && exitShort) {
        exits.push({
          time: candle.time,
          value: Number(candle.low),
          direction: -1,
          label: 'Exit Short',
        })
        exitLocked = true
      }

      void currentHighest
      void currentLowest
    }

    if (exitMode === 'Internal SuperTrend End') {
      const internalPoint = internalPoints[index]
      const previousInternalPoint = internalPoints[index - 1]

      if (!internalPoint || !previousInternalPoint) continue

      const internalResetLong =
        direction === 1 &&
        internalPoint.direction === 1 &&
        previousInternalPoint.direction === -1

      const internalResetShort =
        direction === -1 &&
        internalPoint.direction === -1 &&
        previousInternalPoint.direction === 1

      if (internalResetLong || internalResetShort) {
        exitLocked = false
      }

      const exitLong =
        direction === 1 &&
        internalPoint.direction === -1 &&
        previousInternalPoint.direction === 1

      const exitShort =
        direction === -1 &&
        internalPoint.direction === 1 &&
        previousInternalPoint.direction === -1

      const candle = candles[index]

      if (!exitLocked && exitLong) {
        exits.push({
          time: candle.time,
          value: Number(candle.high),
          direction: 1,
          label: 'Exit Long',
        })
        exitLocked = true
      }

      if (!exitLocked && exitShort) {
        exits.push({
          time: candle.time,
          value: Number(candle.low),
          direction: -1,
          label: 'Exit Short',
        })
        exitLocked = true
      }
    }
  }

  return exits
}

type NrtrTradeStats = {
  direction: 1 | -1 | 0
  directionText: string
  entryPrice: number | null
  entryTime: string | null
  currentPrice: number | null
  trailingStop: number | null
  pnlPoints: number | null
  pnlPercent: number | null
  lockedProfit: number | null
  lockedPercent: number | null
  moveDistance: number | null
  barsInTrade: number
  lastSignalText: string
}

function formatSignedNumber(value: number | null | undefined, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const number = Number(value)
  const sign = number > 0 ? '+' : ''
  return `${sign}${number.toFixed(decimals)}`
}

function calculateNrtrTradeStats(candles: Candle[], points: NrtrPoint[], currentPriceOverride?: number | null): NrtrTradeStats {
  const overridePrice = Number(currentPriceOverride)
  const lastCandleClose = candles.length > 0 ? Number(candles[candles.length - 1].close) : NaN
  const effectiveCurrentPrice = Number.isFinite(overridePrice) && overridePrice > 0 ? overridePrice : lastCandleClose

  const empty: NrtrTradeStats = {
    direction: 0,
    directionText: 'Flat',
    entryPrice: null,
    entryTime: null,
    currentPrice: Number.isFinite(effectiveCurrentPrice) ? effectiveCurrentPrice : null,
    trailingStop: null,
    pnlPoints: null,
    pnlPercent: null,
    lockedProfit: null,
    lockedPercent: null,
    moveDistance: null,
    barsInTrade: 0,
    lastSignalText: 'No Signal',
  }

  if (candles.length === 0 || points.length === 0) return empty

  let direction: 1 | -1 | 0 = 0
  let entryPrice: number | null = null
  let entryTime: string | null = null
  let entryIndex = -1
  let lastSignalText = 'No Signal'

  points.forEach((point, index) => {
    if (point.buy) {
      direction = 1
      entryPrice = Number(candles[index]?.close)
      entryTime = candles[index]?.time ?? null
      entryIndex = index
      lastSignalText = 'BUY'
    }

    if (point.sell) {
      direction = -1
      entryPrice = Number(candles[index]?.close)
      entryTime = candles[index]?.time ?? null
      entryIndex = index
      lastSignalText = 'SELL'
    }
  })

  const latestPoint = points[points.length - 1]
  const currentPrice = Number.isFinite(effectiveCurrentPrice) ? effectiveCurrentPrice : Number(candles[candles.length - 1].close)
  const trailingStop = latestPoint?.value ?? null

  if (direction === 0 || entryPrice === null || !Number.isFinite(entryPrice)) {
    return {
      ...empty,
      direction: latestPoint?.direction ?? 0,
      directionText: latestPoint?.direction === 1 ? 'Bullish' : latestPoint?.direction === -1 ? 'Bearish' : 'Flat',
      trailingStop,
      lastSignalText,
    }
  }

  const pnlPoints = direction === 1 ? currentPrice - entryPrice : entryPrice - currentPrice
  const pnlPercent = entryPrice !== 0 ? (pnlPoints / entryPrice) * 100 : null
  const trailingStopNumber = Number(trailingStop ?? NaN)
  const lockedProfit =
    Number.isFinite(trailingStopNumber)
      ? direction === 1
        ? trailingStopNumber - entryPrice
        : entryPrice - trailingStopNumber
      : null

  const tradeCandles = entryIndex >= 0 ? candles.slice(entryIndex) : []
  const profitExtreme =
    tradeCandles.length > 0
      ? direction === 1
        ? Math.max(...tradeCandles.map((candle) => Number(candle.high)))
        : Math.min(...tradeCandles.map((candle) => Number(candle.low)))
      : null

  const moveDistance =
    profitExtreme !== null && Number.isFinite(profitExtreme)
      ? direction === 1
        ? profitExtreme - entryPrice
        : entryPrice - profitExtreme
      : null

  const lockedPercent =
    lockedProfit !== null &&
    moveDistance !== null &&
    Number.isFinite(lockedProfit) &&
    Number.isFinite(moveDistance) &&
    moveDistance > 0
      ? (lockedProfit / moveDistance) * 100
      : null

  return {
    direction,
    directionText: direction === 1 ? 'Long' : 'Short',
    entryPrice,
    entryTime,
    currentPrice,
    trailingStop,
    pnlPoints,
    pnlPercent,
    lockedProfit,
    lockedPercent,
    moveDistance,
    barsInTrade: entryIndex >= 0 ? candles.length - 1 - entryIndex : 0,
    lastSignalText,
  }
}


// Returns any because this chart builds dynamic ECharts series conditionally.
// EChartsOption's strict union type rejects valid runtime markArea/markLine series.
function buildChartOption({
  symbol,
  timeframe,
  candleMode,
  candles,
  compact,
  loading,
  chartOverlays,
  overlayToggles = DEFAULT_OVERLAY_TOGGLES,
  smmaOverlayLength = 'Off',
  nrtrOverlayMode = 'Off',
  nrtrExitMode = 'Off',
  nrtrPresetMode = 'Scalping',
  sharedLivePrice = null,
}: {
  symbol: string
  timeframe: string
  candleMode: CandleMode
  candles: Candle[]
  compact: boolean
  loading: boolean
  chartOverlays?: ChartOverlays | null
  overlayToggles?: OverlayToggles
  smmaOverlayLength?: SmmaOverlayLength
  nrtrOverlayMode?: NrtrOverlayMode
  nrtrExitMode?: NrtrExitMode
  nrtrPresetMode?: NrtrPresetMode
  sharedLivePrice?: number | null
}): any {
  const activeCandles = candleMode === 'Heikin Ashi' ? convertToHeikinAshi(candles) : candles
  const latestRealClose = candles.length > 0 ? Number(candles[candles.length - 1].close) : NaN
  const livePriceNumber = Number(sharedLivePrice)
  const chartCurrentPrice = Number.isFinite(livePriceNumber) && livePriceNumber > 0 ? livePriceNumber : latestRealClose
  const fallbackOverlays = !compact ? buildClientFallbackOverlays(activeCandles, overlayToggles) : null
  const drawableChartOverlays = !compact
    ? mergeOverlayFallback(chartOverlays, fallbackOverlays, overlayToggles)
    : chartOverlays
  const overlayGhostCandles = !compact && overlayToggles.ghost && Array.isArray(drawableChartOverlays?.ghostCandles) ? drawableChartOverlays?.ghostCandles ?? [] : []
  const alphaProfileBins = !compact && overlayToggles.liquidityProfile && Array.isArray(drawableChartOverlays?.alphaProfileBins) ? drawableChartOverlays?.alphaProfileBins ?? [] : []
  const ghostSpacerLabels = overlayGhostCandles.length > 0
    ? buildFutureSpacerLabels(activeCandles.length, GHOST_LEADING_GAP_BARS, 'GhostGap')
    : []
  const futureGhostLabels = buildFutureGhostAxisLabels(
    [...activeCandles, ...ghostSpacerLabels.map((time) => ({ time, open: 0, high: 0, low: 0, close: 0 })) as Candle[]],
    overlayGhostCandles,
    timeframe
  )
  const profileSpacerLabels = alphaProfileBins.length > 0
    ? buildFutureSpacerLabels(activeCandles.length + ghostSpacerLabels.length + futureGhostLabels.length, PROFILE_LEADING_GAP_BARS, 'ProfileGap')
    : []
  const alphaProfileStartIndex =
    activeCandles.length + ghostSpacerLabels.length + futureGhostLabels.length + profileSpacerLabels.length + 1
  const alphaProfileLabels = alphaProfileBins.length > 0
    ? buildAlphaProfileFutureLabels(alphaProfileStartIndex, ALPHA_PROFILE_WIDTH_BARS)
    : []
  const xAxisData = [
    ...activeCandles.map((candle) => candle.time),
    ...ghostSpacerLabels,
    ...futureGhostLabels,
    ...profileSpacerLabels,
    ...alphaProfileLabels,
  ]
  const candleData = activeCandles.map((candle) => [
    candle.open,
    candle.close,
    candle.low,
    candle.high,
  ])

  const smmaLength = smmaOverlayLength === '20' ? 20 : smmaOverlayLength === '50' ? 50 : 0
  const smmaValues =
    !compact && smmaLength > 0
      ? calculateSmma(activeCandles.map((candle) => Number(candle.close)), smmaLength)
      : []
  const smmaData =
    !compact && smmaLength > 0
      ? activeCandles.map((candle, index) => [
          candle.time,
          smmaValues[index] === null ? null : Number(smmaValues[index]),
        ])
      : []

  const nrtrPresetValues = getNrtrPresetValues(nrtrPresetMode)
  const nrtrPoints = !compact && nrtrOverlayMode !== 'Off'
    ? calculateNrtrOverlay(activeCandles, nrtrOverlayMode, nrtrPresetMode)
    : []

  const nrtrBullData = nrtrPoints.map((point) => [
    point.time,
    point.direction === 1 ? point.value : null,
  ])

  const nrtrBearData = nrtrPoints.map((point) => [
    point.time,
    point.direction === -1 ? point.value : null,
  ])

  const nrtrBuyMarkers = nrtrPoints
    .filter((point) => point.buy && point.value !== null)
    .map((point) => ({
      value: [point.time, point.value],
      itemStyle: {
        color: '#22c55e',
      },
      label: {
        show: true,
        formatter: 'BUY',
        color: '#ffffff',
        fontSize: 9,
        fontWeight: 900,
        backgroundColor: '#16a34a',
        borderRadius: 4,
        padding: [3, 5],
      },
    }))

  const nrtrSellMarkers = nrtrPoints
    .filter((point) => point.sell && point.value !== null)
    .map((point) => ({
      value: [point.time, point.value],
      itemStyle: {
        color: '#ef4444',
      },
      label: {
        show: true,
        formatter: 'SELL',
        color: '#ffffff',
        fontSize: 9,
        fontWeight: 900,
        backgroundColor: '#dc2626',
        borderRadius: 4,
        padding: [3, 5],
      },
    }))

  const nrtrExitPoints =
    !compact && nrtrOverlayMode !== 'Off' && nrtrExitMode !== 'Off'
      ? calculateNrtrExitPoints(activeCandles, nrtrPoints, nrtrExitMode, 5)
      : []

  const nrtrExitMarkers = nrtrExitPoints.map((point) => ({
    value: [point.time, point.value],
    itemStyle: {
      color: point.direction === 1 ? '#22c55e' : '#ef4444',
    },
    label: {
      show: true,
      formatter: 'X',
      color: point.direction === 1 ? '#22c55e' : '#ef4444',
      fontSize: 16,
      fontWeight: 900,
      backgroundColor: 'rgba(15, 23, 42, 0.72)',
      borderRadius: 4,
      padding: [1, 4],
    },
  }))

  const nrtrTradeStats =
    !compact && nrtrOverlayMode !== 'Off'
      ? calculateNrtrTradeStats(activeCandles, nrtrPoints, chartCurrentPrice)
      : null

  const nrtrPnlPositive = Number(nrtrTradeStats?.pnlPoints ?? 0) >= 0
  const nrtrEntryPrice = Number(nrtrTradeStats?.entryPrice ?? NaN)
  const nrtrTrailPrice = Number(nrtrTradeStats?.trailingStop ?? NaN)
  const nrtrLockedProfit = Number(nrtrTradeStats?.lockedProfit ?? NaN)
  const nrtrEntryTime = nrtrTradeStats?.entryTime ?? null
  const latestCandleTime = activeCandles[activeCandles.length - 1]?.time ?? null
  const hasNrtrEntryPrice = Number.isFinite(nrtrEntryPrice)
  const hasNrtrLockedProfit =
    hasNrtrEntryPrice &&
    Number.isFinite(nrtrTrailPrice) &&
    Number.isFinite(nrtrLockedProfit) &&
    nrtrLockedProfit > 0 &&
    Boolean(nrtrEntryTime) &&
    Boolean(latestCandleTime)

  const nrtrProfitAreaData =
    hasNrtrLockedProfit
      ? [[
          {
            xAxis: nrtrEntryTime,
            yAxis: nrtrTradeStats?.direction === 1
              ? Math.max(nrtrEntryPrice, nrtrTrailPrice)
              : Math.max(nrtrEntryPrice, nrtrTrailPrice),
            itemStyle: {
              color: nrtrTradeStats?.direction === 1
                ? 'rgba(34, 197, 94, 0.16)'
                : 'rgba(239, 68, 68, 0.16)',
              borderColor: nrtrTradeStats?.direction === 1
                ? 'rgba(34, 197, 94, 0.42)'
                : 'rgba(239, 68, 68, 0.42)',
              borderWidth: 1,
            },
          },
          {
            xAxis: latestCandleTime,
            yAxis: nrtrTradeStats?.direction === 1
              ? Math.min(nrtrEntryPrice, nrtrTrailPrice)
              : Math.min(nrtrEntryPrice, nrtrTrailPrice),
          },
        ]]
      : []

  const volumeData = activeCandles.map((candle, index) => ({
    value: candle.volume ?? 0,
    itemStyle: {
      color: candle.close >= candle.open ? GREEN : RED,
      opacity: compact ? 0.22 : 0.35,
    },
    xAxis: index,
  }))

  const zoneMarkAreas = !compact && overlayToggles.orderBlocks ? buildZoneMarkAreas(drawableChartOverlays?.zones, activeCandles) : []
  const smcMarkerData = !compact && overlayToggles.smc ? buildMarkerData(drawableChartOverlays?.smcEvents, activeCandles, MAX_SMC_LABELS, true) : []
  const liquidityMarkerData = !compact && overlayToggles.smc ? buildMarkerData(drawableChartOverlays?.liquidityEvents, activeCandles, MAX_LIQUIDITY_LABELS, true) : []
  const scoreMarkerData: any[] = []
  const dlmMarkLines = !compact && overlayToggles.liquidityProfile ? buildDlmMarkLines(drawableChartOverlays?.dlmLevels) : []
  const alphaProfileData = !compact ? buildAlphaProfileCustomData(alphaProfileBins, alphaProfileStartIndex, activeCandles) : []
  const ghostData = !compact ? buildGhostCandleData(activeCandles.length, overlayGhostCandles, ghostSpacerLabels.length) : []

  const zoom = getInitialZoom(activeCandles.length, xAxisData.length)

  return {
    backgroundColor: BG,
    animation: false,
    grid: compact
      ? [
          // Mini charts remain one pane only, but now include price + time scales.
          { left: 8, right: 48, top: 8, bottom: 30 },
        ]
      : [
          // Slider scrollbar removed. Keep a clean price pane + volume pane layout.
          { left: 58, right: 136, top: 44, bottom: 84 },
          { left: 58, right: 136, height: 46, bottom: 18 },
        ],
    title: compact
      ? undefined
      : {
          text: `${symbol} · ${timeframe} · ${candleMode}`,
          left: 16,
          top: 10,
          textStyle: {
            color: '#e5e7eb',
            fontSize: 13,
            fontWeight: 700,
          },
        },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        label: {
          backgroundColor: '#111827',
        },
      },
      formatter: (params: any) => {
        const candleParam = Array.isArray(params)
          ? params.find((param) => param.seriesType === 'candlestick')
          : params

        if (!candleParam) return ''

        const ohlc = extractOhlcFromTooltipParam(candleParam)

        if (!ohlc) return ''

        const [open, close, low, high] = ohlc

        return [
          `<strong>${candleParam.axisValue}</strong>`,
          `Open: ${compactPrice(open)}`,
          `High: ${compactPrice(high)}`,
          `Low: ${compactPrice(low)}`,
          `Close: ${compactPrice(close)}`,
        ].join('<br/>')
      },
    },
    axisPointer: {
      link: compact ? [] : [{ xAxisIndex: 'all' }],
    },
    xAxis: compact
      ? [
          {
            type: 'category',
            data: xAxisData,
            boundaryGap: true,
            axisLine: { lineStyle: { color: GRID } },
            axisTick: { show: false },
            axisLabel: {
              color: TEXT,
              formatter: (value: string) =>
                String(value).includes('GhostGap') || String(value).includes('ProfileGap') || String(value).includes('AlphaProfile')
                  ? ''
                  : shortAxisLabel(value),
              fontSize: 9,
              margin: 8,
              hideOverlap: true,
            },
            splitLine: { show: false },
          },
        ]
      : [
          {
            type: 'category',
            data: xAxisData,
            boundaryGap: true,
            axisLine: { lineStyle: { color: GRID } },
            axisTick: { show: false },
            axisLabel: {
              color: TEXT,
              formatter: (value: string) =>
                String(value).includes('GhostGap') || String(value).includes('ProfileGap') || String(value).includes('AlphaProfile')
                  ? ''
                  : shortAxisLabel(value),
            },
            splitLine: { show: false },
          },
          {
            type: 'category',
            gridIndex: 1,
            data: xAxisData,
            boundaryGap: true,
            axisLine: { lineStyle: { color: GRID } },
            axisTick: { show: false },
            axisLabel: { show: false },
            splitLine: { show: false },
          },
        ],
    yAxis: compact
      ? [
          {
            scale: true,
            position: 'right',
            axisLabel: {
              show: true,
              color: TEXT,
              fontSize: 9,
              margin: 8,
            },
            axisLine: { lineStyle: { color: GRID } },
            axisTick: { show: false },
            splitLine: { lineStyle: { color: GRID, opacity: 0.35 } },
          },
        ]
      : [
          {
            scale: true,
            position: 'right',
            axisLabel: { color: TEXT, margin: 14 },
            axisLine: { lineStyle: { color: GRID } },
            splitLine: { lineStyle: { color: GRID, opacity: 0.55 } },
          },
          {
            scale: true,
            gridIndex: 1,
            axisLabel: { show: false },
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { show: false },
          },
        ],
    dataZoom: compact
      ? [
          {
            type: 'inside',
            xAxisIndex: [0],
            ...zoom,
            zoomOnMouseWheel: true,
            moveOnMouseMove: true,
            moveOnMouseWheel: true,
          },
        ]
      : [
          {
            // Inside zoom/pan remains active, but the visible slider scrollbar is removed.
            type: 'inside',
            xAxisIndex: [0, 1],
            ...zoom,
            zoomOnMouseWheel: true,
            moveOnMouseMove: true,
            moveOnMouseWheel: true,
          },
        ],
    // Keep one stable graphic element so old empty-state text is actively hidden
    // after cached or loaded candles are visible. This prevents ECharts/zrender from
    // keeping a stale loading overlay when setOption uses lazy merged updates.
    graphic: [
      {
        id: 'empty-state-text',
        type: 'text',
        left: 'center',
        top: 'middle',
        silent: true,
        invisible: activeCandles.length > 0,
        style: {
          text: activeCandles.length === 0
            ? loading
              ? 'Preparing selected candles...'
              : 'No candles loaded'
            : '',
          fill: '#9ca3af',
          fontSize: compact ? 11 : 14,
          fontWeight: 700,
        },
      },
      ...(!compact && nrtrOverlayMode !== 'Off' && nrtrTradeStats
        ? [
            {
              id: 'nrtr-trade-panel-bg',
              type: 'rect',
              right: 148,
              top: 44,
              z: 80,
              silent: true,
              shape: {
                width: 228,
                height: 106,
                r: 8,
              },
              style: {
                fill: 'rgba(15, 23, 42, 0.78)',
                stroke: nrtrTradeStats.direction === 1
                  ? 'rgba(34, 197, 94, 0.45)'
                  : nrtrTradeStats.direction === -1
                    ? 'rgba(239, 68, 68, 0.45)'
                    : 'rgba(148, 163, 184, 0.28)',
                lineWidth: 1,
              },
            },
            {
              id: 'nrtr-trade-panel-text',
              type: 'text',
              right: 160,
              top: 54,
              z: 81,
              silent: true,
              style: {
                text: [
                  `NRTR+ ${nrtrOverlayMode} · ${nrtrPresetValues.label} · ${nrtrTradeStats.directionText}`,
                  `Entry: ${compactPrice(Number(nrtrTradeStats.entryPrice ?? NaN))}    Trail: ${compactPrice(Number(nrtrTradeStats.trailingStop ?? NaN))}`,
                  `P&L: ${formatSignedNumber(nrtrTradeStats.pnlPoints, 2)}  (${formatSignedNumber(nrtrTradeStats.pnlPercent, 3)}%)`,
                  `Locked: ${formatSignedNumber(nrtrTradeStats.lockedProfit, 2)}  (${formatSignedNumber(nrtrTradeStats.lockedPercent, 1)}%)`,
                  `Bars: ${nrtrTradeStats.barsInTrade}    Last: ${nrtrTradeStats.lastSignalText}    ${nrtrOverlayMode === 'ATR-Based' ? `ATRx${nrtrPresetValues.atrMultiplier}` : `${nrtrPresetValues.percent}%`}`,
                ].join('\n'),
                fill: '#e5e7eb',
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 18,
                rich: {},
              },
            },
            {
              id: 'nrtr-trade-panel-pnl-dot',
              type: 'circle',
              right: 356,
              top: 69,
              z: 82,
              silent: true,
              shape: {
                r: 4,
              },
              style: {
                fill: nrtrPnlPositive ? '#22c55e' : '#ef4444',
              },
            },
          ]
        : []),
    ],
    series: compact
      ? [
          {
            name: `${symbol} ${candleMode}`,
            type: 'candlestick',
            data: candleData,
            itemStyle: {
              color: GREEN,
              color0: RED,
              borderColor: GREEN,
              borderColor0: RED,
            },
            barWidth: '68%',
            barMinWidth: 2,
            barMaxWidth: 10,
            markLine: Number.isFinite(chartCurrentPrice)
              ? {
                  silent: true,
                  symbol: ['none', 'none'],
                  animation: false,
                  label: {
                    show: true,
                    position: 'end',
                    formatter: () => compactPrice(chartCurrentPrice),
                    color: '#d1fae5',
                    backgroundColor: '#047857',
                    borderRadius: 4,
                    padding: [3, 5],
                    fontSize: 9,
                    fontWeight: 700,
                  },
                  lineStyle: {
                    color: '#10b981',
                    width: 1,
                    type: 'dashed',
                    opacity: 0.85,
                  },
                  data: [{ yAxis: chartCurrentPrice }],
                }
              : undefined,
          },
        ]
      : [
          {
            name: `${symbol} ${candleMode}`,
            type: 'candlestick',
            data: candleData,
            itemStyle: {
              color: GREEN,
              color0: RED,
              borderColor: GREEN,
              borderColor0: RED,
            },
            barWidth: '68%',
            barMinWidth: 4,
            barMaxWidth: 18,
            markLine: Number.isFinite(chartCurrentPrice)
              ? {
                  silent: true,
                  symbol: ['none', 'none'],
                  animation: false,
                  label: {
                    show: true,
                    position: 'end',
                    formatter: () => compactPrice(chartCurrentPrice),
                    color: '#d1fae5',
                    backgroundColor: '#047857',
                    borderRadius: 4,
                    padding: [4, 6],
                    fontSize: 11,
                    fontWeight: 700,
                  },
                  lineStyle: {
                    color: '#10b981',
                    width: 1,
                    type: 'dashed',
                    opacity: 0.9,
                  },
                  data: [{ yAxis: chartCurrentPrice }],
                }
              : undefined,
          },
          ...(smmaLength > 0
            ? [
                {
                  name: `SMMA ${smmaLength}`,
                  type: 'line',
                  data: smmaData,
                  symbol: 'none',
                  smooth: true,
                  connectNulls: true,
                  lineStyle: {
                    color: smmaLength === 20 ? '#60a5fa' : '#fbbf24',
                    width: 2,
                    opacity: 0.95,
                  },
                  emphasis: {
                    disabled: true,
                  },
                  z: 9,
                },
              ]
            : []),
          ...(nrtrOverlayMode !== 'Off'
            ? [
                {
                  name: `${nrtrOverlayMode} NRTR+ Long`,
                  type: 'line',
                  data: nrtrBullData,
                  symbol: 'none',
                  connectNulls: false,
                  lineStyle: {
                    color: '#22c55e',
                    width: 2,
                    opacity: 0.95,
                  },
                  emphasis: {
                    disabled: true,
                  },
                  z: 10,
                },
                {
                  name: `${nrtrOverlayMode} NRTR+ Short`,
                  type: 'line',
                  data: nrtrBearData,
                  symbol: 'none',
                  connectNulls: false,
                  lineStyle: {
                    color: '#ef4444',
                    width: 2,
                    opacity: 0.95,
                  },
                  emphasis: {
                    disabled: true,
                  },
                  z: 10,
                },
              ]
            : []),
          ...(nrtrBuyMarkers.length > 0
            ? [
                {
                  name: 'NRTR+ Buy',
                  type: 'scatter',
                  data: nrtrBuyMarkers,
                  symbol: 'triangle',
                  symbolSize: 14,
                  z: 24,
                },
              ]
            : []),
          ...(nrtrSellMarkers.length > 0
            ? [
                {
                  name: 'NRTR+ Sell',
                  type: 'scatter',
                  data: nrtrSellMarkers,
                  symbol: 'triangle',
                  symbolRotate: 180,
                  symbolSize: 14,
                  z: 24,
                },
              ]
            : []),
          ...(nrtrExitMarkers.length > 0
            ? [
                {
                  name: 'NRTR+ Exit X',
                  type: 'scatter',
                  data: nrtrExitMarkers,
                  symbol: 'path://M -6 -6 L 6 6 M 6 -6 L -6 6',
                  symbolSize: 18,
                  lineStyle: {
                    width: 3,
                  },
                  z: 25,
                },
              ]
            : []),
          ...(nrtrProfitAreaData.length > 0
            ? [
                {
                  name: 'NRTR+ Locked Profit Area',
                  type: 'line',
                  data: [],
                  silent: true,
                  markArea: {
                    silent: true,
                    data: nrtrProfitAreaData,
                  },
                  z: 7,
                },
              ]
            : []),
          ...(!compact && nrtrOverlayMode !== 'Off' && hasNrtrEntryPrice
            ? [
                {
                  name: 'NRTR+ Entry',
                  type: 'line',
                  data: [],
                  silent: true,
                  markLine: {
                    silent: true,
                    symbol: ['none', 'none'],
                    label: {
                      show: true,
                      position: 'end',
                      formatter: () => 'NRTR Entry',
                      color: '#e5e7eb',
                      backgroundColor: 'rgba(99, 102, 241, 0.72)',
                      borderRadius: 4,
                      padding: [3, 5],
                      fontSize: 10,
                      fontWeight: 800,
                    },
                    lineStyle: {
                      color: 'rgba(129, 140, 248, 0.78)',
                      width: 1,
                      type: 'dashed',
                    },
                    data: [{ yAxis: nrtrEntryPrice }],
                  },
                  z: 8,
                },
              ]
            : []),
          ...(zoneMarkAreas.length > 0
            ? [
                {
                  name: 'Python SMC Zones',
                  type: 'line',
                  data: [],
                  silent: true,
                  markArea: {
                    silent: true,
                    data: zoneMarkAreas,
                  },
                },
              ]
            : []),
          ...(dlmMarkLines.length > 0
            ? [
                {
                  name: 'AlphaX DLM Levels',
                  type: 'line',
                  data: [],
                  silent: true,
                  markLine: {
                    silent: true,
                    symbol: ['none', 'none'],
                    data: dlmMarkLines,
                  },
                },
              ]
            : []),
          ...(smcMarkerData.length > 0
            ? [
                {
                  name: 'SMC BOS / CHoCH',
                  type: 'scatter',
                  data: smcMarkerData,
                  symbolSize: 7,
                  z: 20,
                },
              ]
            : []),
          ...(liquidityMarkerData.length > 0
            ? [
                {
                  name: 'Liquidity Sweeps',
                  type: 'scatter',
                  data: liquidityMarkerData,
                  symbol: 'diamond',
                  symbolSize: 8,
                  z: 21,
                },
              ]
            : []),
          ...(scoreMarkerData.length > 0
            ? [
                {
                  name: 'Python Score',
                  type: 'scatter',
                  data: scoreMarkerData,
                  symbol: 'pin',
                  symbolSize: 20,
                  z: 22,
                },
              ]
            : []),
          ...(alphaProfileData.length > 0
            ? [
                {
                  name: 'AlphaX DLM Liquidity Profile',
                  type: 'custom',
                  data: alphaProfileData,
                  renderItem: buildAlphaProfileRenderItem(),
                  encode: { x: 0, y: 1 },
                  silent: true,
                  z: 12,
                  tooltip: {
                    formatter: (param: any) => {
                      const bin = param?.data?.bin ?? {}
                      return [
                        '<strong>AlphaX DLM Liquidity</strong>',
                        `Price: ${compactPrice(Number(bin.price))}`,
                        `Volume: ${Number(bin.volumePct ?? 0).toFixed(0)}%`,
                        `Buy: ${Number(bin.buyPct ?? 0).toFixed(0)}%`,
                        `Sell: ${Number(bin.sellPct ?? 0).toFixed(0)}%`,
                      ].join('<br/>')
                    },
                  },
                },
              ]
            : []),
          ...(ghostData.length > activeCandles.length
            ? [
                {
                  name: 'Python HA Ghost Candles',
                  type: 'candlestick',
                  data: ghostData,
                  itemStyle: {
                    color: 'rgba(38, 166, 154, 0.24)',
                    color0: 'rgba(239, 83, 80, 0.24)',
                    borderColor: 'rgba(167, 243, 208, 0.98)',
                    borderColor0: 'rgba(252, 165, 165, 0.98)',
                    borderWidth: 2,
                    opacity: 0.92,
                  },
                  emphasis: {
                    itemStyle: {
                      color: 'rgba(38, 166, 154, 0.34)',
                      color0: 'rgba(239, 83, 80, 0.34)',
                      borderColor: 'rgba(209, 250, 229, 1)',
                      borderColor0: 'rgba(254, 202, 202, 1)',
                      borderWidth: 2,
                    },
                  },
                  barWidth: '34%',
                  barMinWidth: 3,
                  barMaxWidth: 9,
                  z: 23,
                },
                {
                  name: 'Ghost Start Separator',
                  type: 'line',
                  data: [],
                  silent: true,
                  markLine: {
                    silent: true,
                    symbol: ['none', 'none'],
                    label: {
                      show: true,
                      formatter: 'Ghost',
                      color: '#a7f3d0',
                      fontSize: 10,
                      fontWeight: 800,
                      backgroundColor: 'rgba(15,17,21,0.72)',
                      borderRadius: 3,
                      padding: [2, 4],
                    },
                    lineStyle: {
                      color: 'rgba(167, 243, 208, 0.72)',
                      width: 1,
                      type: 'dashed',
                    },
                    data: [
                      {
                        xAxis: xAxisData[Math.max(0, activeCandles.length)],
                      },
                    ],
                  },
                  z: 22,
                },
              ]
            : []),
          {
            name: 'Volume',
            type: 'bar',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: volumeData,
            large: true,
          },
        ],
  }
}

export default function EChartsCandlestickChart({
  heightClass = 'h-[650px]',
  compact = false,
  chartTitle,
  defaultSymbol,
  defaultTimeframe = '1m',
  defaultCandleMode = 'Heikin Ashi',
  allowCompactHistory = true,
  showControls = true,
  lockSymbolToDefault = false,
  followDefaultSymbol = false,
  enableAdvancedOverlays = false,
  onChartSelectionChange,
  latestSignal,
}: EChartsCandlestickChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)
  const activeCacheKeyRef = useRef<string>('')
  const chartIdentityRef = useRef<string>('')
  const dataSignatureRef = useRef<string>('')
  const overlayLayoutSignatureRef = useRef<string>('')
  const overlayIdentityRef = useRef<string>('')
  const lastGoodChartOverlaysRef = useRef<ChartOverlays | null>(null)
  const userZoomedRef = useRef(false)
  const [mainCandleGateTick, setMainCandleGateTick] = useState(0)

  const chartSettingsKey = getChartSettingsKey(compact, chartTitle, defaultTimeframe)
  const savedChartSettings = typeof window === 'undefined' ? {} : readChartSettings(chartSettingsKey)

  const initialSymbol = normalizeDefaultSymbol(
    savedChartSettings.symbol ?? defaultSymbol ?? latestSignal?.symbol ?? 'BTCUSD',
    'BTCUSD'
  )
  const initialTimeframe = normalizeDefaultTimeframe(
    savedChartSettings.timeframe ?? defaultTimeframe ?? latestSignal?.timeframe,
    '1m'
  )
  const initialCandleMode = candleModeOptions.includes(savedChartSettings.candleMode as CandleMode)
    ? savedChartSettings.candleMode as CandleMode
    : candleModeOptions.includes(defaultCandleMode)
      ? defaultCandleMode
      : 'Heikin Ashi'

  const initialOverlayToggles: OverlayToggles = {
    ...DEFAULT_OVERLAY_TOGGLES,
    ...(savedChartSettings.overlayToggles && typeof savedChartSettings.overlayToggles === 'object'
      ? savedChartSettings.overlayToggles
      : {}),
  }

  const initialSmmaOverlayLength = normalizeSmmaOverlayLength(savedChartSettings.smmaOverlayLength)

  const initialNrtrOverlayMode = normalizeNrtrOverlayMode(savedChartSettings.nrtrOverlayMode)

  const initialNrtrExitMode = normalizeNrtrExitMode(savedChartSettings.nrtrExitMode)

  const initialNrtrPresetMode = normalizeNrtrPresetMode(savedChartSettings.nrtrPresetMode)

  const [symbol, setSymbol] = useState(() => initialSymbol)
  const [timeframe, setTimeframe] = useState(() => initialTimeframe)
  const [candleMode, setCandleMode] = useState<CandleMode>(() => initialCandleMode)
  const [overlayToggles, setOverlayToggles] = useState<OverlayToggles>(() => initialOverlayToggles)
  const [smmaOverlayLength, setSmmaOverlayLength] = useState<SmmaOverlayLength>(() => initialSmmaOverlayLength)
  const [nrtrOverlayMode, setNrtrOverlayMode] = useState<NrtrOverlayMode>(() => initialNrtrOverlayMode)
  const [nrtrExitMode, setNrtrExitMode] = useState<NrtrExitMode>(() => initialNrtrExitMode)
  const [nrtrPresetMode, setNrtrPresetMode] = useState<NrtrPresetMode>(() => initialNrtrPresetMode)
  const [historicalCandles, setHistoricalCandles] = useState<Candle[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'cached' | 'loaded' | 'empty' | 'error'>('idle')
  const [liveProvider, setLiveProvider] = useState<string>('')
  const [sharedLivePrice, setSharedLivePrice] = useState<number | null>(() => getSharedLivePrice(initialSymbol))
  const [chartOverlays, setChartOverlays] = useState<ChartOverlays | null>(null)
  const [overlayRenderStatus, setOverlayRenderStatus] = useState<OverlayRenderStatus>('off')

  const candleFetchLimit = '500'

  const handleSymbolChange = (value: string) => {
    if (lockSymbolToDefault) return
    setSymbol(normalizeDefaultSymbol(value, symbol))
  }

  const handleTimeframeChange = (value: string) => {
    setTimeframe(normalizeDefaultTimeframe(value, timeframe))
  }

  const handleCandleModeChange = (value: string) => {
    setCandleMode(value as CandleMode)
  }

  const handleOverlayToggle = (key: OverlayToggleKey) => {
    setOverlayToggles((current) => ({
      ...current,
      [key]: !current[key],
    }))
  }

  const handleSmmaOverlayChange = (value: string) => {
    setSmmaOverlayLength(normalizeSmmaOverlayLength(value))
  }

  const handleNrtrOverlayChange = (value: string) => {
    setNrtrOverlayMode(normalizeNrtrOverlayMode(value))
  }

  const handleNrtrExitModeChange = (value: string) => {
    setNrtrExitMode(normalizeNrtrExitMode(value))
  }

  const handleNrtrPresetModeChange = (value: string) => {
    setNrtrPresetMode(normalizeNrtrPresetMode(value))
  }

  useEffect(() => {
    if (!followDefaultSymbol) return

    // Follow only the explicit parent/default symbol.
    // Do not use latestSignal here because it can pull mini charts or compact charts
    // away from their own selected symbol during API polling.
    const nextSymbol = normalizeDefaultSymbol(defaultSymbol ?? symbol, symbol)

    if (nextSymbol && nextSymbol !== symbol) {
      setSymbol(nextSymbol)
    }
  }, [defaultSymbol, followDefaultSymbol, symbol])

  useEffect(() => {
    saveChartSettings(chartSettingsKey, {
      symbol,
      timeframe,
      candleMode,
      overlayToggles,
      smmaOverlayLength,
      nrtrOverlayMode,
      nrtrExitMode,
      nrtrPresetMode,
    })
  }, [chartSettingsKey, symbol, timeframe, candleMode, overlayToggles, smmaOverlayLength, nrtrOverlayMode, nrtrExitMode, nrtrPresetMode])

  useEffect(() => {
    if (compact) return

    emitMainChartOverlayToggles({
      symbol,
      timeframe,
      toggles: overlayToggles,
    })
  }, [compact, symbol, timeframe, overlayToggles])

  useEffect(() => {
    onChartSelectionChange?.({
      symbol,
      timeframe,
      candleMode,
      compact,
      chartTitle,
    })
  }, [symbol, timeframe, candleMode, compact, chartTitle, onChartSelectionChange])

  useEffect(() => {
    const onGate = () => setMainCandleGateTick((value) => value + 1)

    window.addEventListener('marketbos:candle-gate', onGate)
    window.addEventListener('storage', onGate)

    return () => {
      window.removeEventListener('marketbos:candle-gate', onGate)
      window.removeEventListener('storage', onGate)
    }
  }, [])


  useEffect(() => {
    const applySharedLivePrice = (record: any) => {
      const recordSymbol = normalizeDefaultSymbol(record?.symbol ?? '')
      if (recordSymbol !== normalizeDefaultSymbol(symbol)) return

      const price = Number(record?.price)
      setSharedLivePrice(Number.isFinite(price) && price > 0 ? price : null)
    }

    setSharedLivePrice(getSharedLivePrice(symbol))

    const onSharedLivePrice = (event: Event) => {
      applySharedLivePrice((event as CustomEvent).detail)
    }

    window.addEventListener(SHARED_LIVE_PRICE_EVENT, onSharedLivePrice)

    return () => {
      window.removeEventListener(SHARED_LIVE_PRICE_EVENT, onSharedLivePrice)
    }
  }, [symbol])

  useEffect(() => {
    void allowCompactHistory

    const controller = new AbortController()
    let cancelled = false

    async function loadCandles() {
      const cacheKey = getCandleCacheKey(symbol, timeframe)
      activeCacheKeyRef.current = cacheKey

      const cached = readMemoryCache(cacheKey) ?? readLocalStorageCache(cacheKey)

      if (!compact && (!cached || cached.length === 0)) {
        setMainCandlesLoading({
          symbol,
          timeframe,
          candleMode,
          count: 0,
          status: 'loading',
        })
      }

      if (cached && cached.length > 0) {
        // Show cache instantly if available. Never make visible cached candles look like
        // they are still loading during a timeframe/symbol switch.
        setHistoricalCandles(cached)
        setStatus('cached')

        if (!compact) {
          setMainCandlesReady({
            symbol,
            timeframe,
            candleMode,
            count: cached.length,
            status: 'cached',
          })

          window.setTimeout(() => {
            preloadPrimaryCandles(controller.signal, symbol, timeframe).catch((error: any) => {
              if (error?.name !== 'AbortError') {
                console.warn('Primary candle preload from cache failed:', error)
              }
            })
          }, 250)
        }
      } else {
        // Important: clear the previous timeframe's candles immediately.
        // This prevents a 5m or 15m dropdown from visually showing old 1m candles.
        setHistoricalCandles([])

        // Mini charts should not block on the candle gate.
        // The shared memory/localStorage/inflight candle cache already prevents duplicate work.
        // This keeps main + mini charts loading the same selected timeframe immediately.
        setStatus('loading')
      }

      try {
        const candles = await fetchCandles(symbol, timeframe, candleFetchLimit, controller.signal)

        if (cancelled || activeCacheKeyRef.current !== cacheKey) return

        if (candles.length > 0) {
          saveCandleCache(cacheKey, candles)
          setHistoricalCandles(candles)
          setStatus('loaded')

          if (!compact) {
            setMainCandlesReady({
              symbol,
              timeframe,
              candleMode,
              count: candles.length,
              status: 'loaded',
            })

            // Preload is intentionally disabled in fast-switch mode.
            // The selected symbol/timeframe fetch always stays priority.
            preloadPrimaryCandles(controller.signal, symbol, timeframe).catch((error: any) => {
              if (error?.name !== 'AbortError') {
                console.warn('Primary candle preload after main ready failed:', error)
              }
            })
          }
        } else if (!cached || cached.length === 0) {
          setHistoricalCandles([])
          setStatus('empty')

          if (!compact) {
            setMainCandlesLoading({
              symbol,
              timeframe,
              candleMode,
              count: 0,
              status: 'empty',
            })
          }
        } else {
          // Background refresh returned empty, but valid cached candles are visible.
          // Keep the correct cached timeframe and do not stay stuck on refreshing/loading.
          setStatus('loaded')
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') return

        console.error('Historical candle fetch error:', error)

        if (!cancelled && activeCacheKeyRef.current === cacheKey) {
          if (cached && cached.length > 0) {
            setStatus('loaded')
          } else {
            setHistoricalCandles([])
            setStatus('error')

            if (!compact) {
              setMainCandlesLoading({
                symbol,
                timeframe,
                candleMode,
                count: 0,
                status: 'error',
              })
            }
          }
        }
      }
    }

    loadCandles()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [symbol, timeframe, compact, allowCompactHistory, candleFetchLimit])

  useEffect(() => {
    if (compact) return
    if (historicalCandles.length === 0) return

    const controller = new AbortController()
    const warmId = window.setTimeout(() => {
      warmChartOverlayRawCache(symbol, timeframe, controller.signal).catch((error: any) => {
        if (error?.name !== 'AbortError') {
          console.warn('Overlay background warm failed:', error)
        }
      })
    }, 350)

    return () => {
      controller.abort()
      window.clearTimeout(warmId)
    }
  }, [symbol, timeframe, compact, historicalCandles.length])

  useEffect(() => {
    if (historicalCandles.length === 0) return

    const controller = new AbortController()
    let cancelled = false

    async function pollLivePrice() {
      try {
        const live = await fetchLivePrice(symbol, timeframe, controller.signal)

        if (cancelled || !live) return

        setSharedLivePriceForSymbol(symbol, live)
        setLiveProvider(String(live.source || live.provider || 'live'))

        setHistoricalCandles((current) => {
          if (current.length === 0) return current

          const updated = applyLivePriceToCandles(
            current,
            live,
            timeframe,
            requestedLimitNumber(candleFetchLimit)
          )

          const cacheKey = getCandleCacheKey(symbol, timeframe)
          saveCandleCache(cacheKey, updated)

          if (!compact && updated.length > 0) {
            setMainCandlesReady({
              symbol,
              timeframe,
              candleMode,
              count: updated.length,
              status: 'live-updated',
            })
          }

          return updated
        })
      } catch (error: any) {
        if (error?.name === 'AbortError') return
      }
    }

    pollLivePrice()
    const intervalId = window.setInterval(pollLivePrice, 1000)

    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(intervalId)
    }
  }, [symbol, timeframe, historicalCandles.length, candleFetchLimit])

  useEffect(() => {
    const overlayIdentity = `${symbol}::${timeframe}::${compact}`

    // Clear only when the actual chart identity changes.
    // Live ticks/new candles should never wipe drawings.
    if (overlayIdentityRef.current !== overlayIdentity) {
      overlayIdentityRef.current = overlayIdentity
      lastGoodChartOverlaysRef.current = null
      setChartOverlays(null)
    }

    if (compact || historicalCandles.length === 0 || !hasAnyOverlayEnabled(overlayToggles)) {
      lastGoodChartOverlaysRef.current = null
      setChartOverlays(null)
      return
    }

    const cached = readOverlayMemoryCache(symbol, timeframe, overlayToggles, 120000)
    if (
      cached?.chartOverlays &&
      typeof cached.chartOverlays === 'object' &&
      overlayPayloadMatches(cached, symbol, timeframe) &&
      overlayPayloadHasRequestedData(cached.chartOverlays as ChartOverlays, overlayToggles)
    ) {
      const cachedOverlays = cached.chartOverlays as ChartOverlays
      ;(cachedOverlays as any).__backendCache = String(cached?.cache ?? 'frontend_memory_cache')
      ;(cachedOverlays as any).__backendRawCache = String(cached?.rawCache ?? '')
      ;(cachedOverlays as any).__backendSource = String(cached?.source ?? '')
      lastGoodChartOverlaysRef.current = cachedOverlays
      setChartOverlays(cachedOverlays)
      setOverlayRenderStatus(getBackendOverlayStatus(cached, cachedOverlays, overlayToggles) === 'real' ? 'cached' : getBackendOverlayStatus(cached, cachedOverlays, overlayToggles))
    } else if (lastGoodChartOverlaysRef.current) {
      setChartOverlays(lastGoodChartOverlaysRef.current)
      setOverlayRenderStatus('cached')
    }

    const controller = new AbortController()
    let cancelled = false

    async function pollChartOverlays() {
      try {
        const engine = await fetchChartOverlays(symbol, timeframe, overlayToggles, controller.signal)
        if (cancelled) return

        if (!overlayPayloadMatches(engine, symbol, timeframe)) {
          // Do not clear good drawings because one refresh response was mismatched.
          return
        }

        const overlays = engine?.chartOverlays && typeof engine.chartOverlays === 'object'
          ? engine.chartOverlays as ChartOverlays
          : null

        if (overlayPayloadHasRequestedData(overlays, overlayToggles)) {
          ;(overlays as any).__backendCache = String(engine?.cache ?? '')
          ;(overlays as any).__backendRawCache = String(engine?.rawCache ?? '')
          ;(overlays as any).__backendSource = String(engine?.source ?? '')
          ;(overlays as any).__fallbackApplied = Boolean((overlays as any)?.fallbackVisualsApplied)
          lastGoodChartOverlaysRef.current = overlays
          setChartOverlays(overlays)

          setOverlayRenderStatus(getBackendOverlayStatus(engine, overlays, overlayToggles))
        } else if (lastGoodChartOverlaysRef.current) {
          // Backend can briefly return Waiting/empty while a live candle or new bucket is updating.
          // Keep the previous drawings visible until the next successful overlay payload arrives.
          setChartOverlays(lastGoodChartOverlaysRef.current)
          setOverlayRenderStatus('cached')
        } else if (hasAnyOverlayEnabled(overlayToggles) && historicalCandles.length > 0) {
          // The chart still draws client-side fallback overlays from the loaded candles.
          // Do not show "Overlay Empty" when fallback drawings are visible.
          setOverlayRenderStatus('fallback')
        } else {
          setOverlayRenderStatus('empty')
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') return
        if (lastGoodChartOverlaysRef.current) {
          setChartOverlays(lastGoodChartOverlaysRef.current)
          setOverlayRenderStatus('cached')
        }
      }
    }

    const firstLoadId = window.setTimeout(pollChartOverlays, cached ? 0 : 75)
    const intervalId = window.setInterval(pollChartOverlays, 45000)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(firstLoadId)
      window.clearInterval(intervalId)
    }
  }, [symbol, timeframe, compact, historicalCandles.length, overlayToggles.smc, overlayToggles.ghost, overlayToggles.liquidityProfile, overlayToggles.orderBlocks])

  const candles = useMemo(
    () => historicalCandles,
    [historicalCandles]
  )

  useEffect(() => {
    if (!chartRef.current) return

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current)
      chartInstance.current.on('datazoom', () => {
        userZoomedRef.current = true
      })
    }

    const effectiveChartOverlays =
      chartOverlays ??
      (hasAnyOverlayEnabled(overlayToggles) ? lastGoodChartOverlaysRef.current : null)

    if (!compact && hasAnyOverlayEnabled(overlayToggles) && candles.length > 0) {
      const hasBackendOverlayData = overlayHasRequestedData(effectiveChartOverlays, overlayToggles)

      if (!hasBackendOverlayData) {
        setOverlayRenderStatus((current) =>
          current === 'real' || current === 'cached' ? current : 'fallback'
        )
      }
    }

    const option = buildChartOption({
      symbol,
      timeframe,
      candleMode,
      candles,
      compact,
      loading: status === 'loading' && candles.length === 0,
      chartOverlays: effectiveChartOverlays,
      overlayToggles,
      smmaOverlayLength,
      nrtrOverlayMode,
      nrtrExitMode,
      nrtrPresetMode,
      sharedLivePrice,
    })

    const chartIdentity = `${symbol}::${timeframe}::${candleMode}::${compact}`
    const dataSignature = candleDataSignature(candles)
    const layoutSignature = overlayLayoutSignature(effectiveChartOverlays)
    const identityChanged = chartIdentityRef.current !== chartIdentity
    const dataChanged = dataSignatureRef.current !== dataSignature
    const overlayLayoutChanged = overlayLayoutSignatureRef.current !== layoutSignature
    chartIdentityRef.current = chartIdentity
    dataSignatureRef.current = dataSignature
    overlayLayoutSignatureRef.current = layoutSignature

    if (identityChanged) {
      // Full reset only when symbol/timeframe/candle type changes.
      // Live ticks and overlay refreshes should not wipe the chart.
      userZoomedRef.current = false
      chartInstance.current.clear()
      chartInstance.current.setOption(option, true)
    } else {
      // Fast path for live tick updates, overlay refreshes, and status refreshes.
      // Preserve the current zoom/pan so the chart does not snap back when
      // scrolling through historical candles or inspecting ghost/liquidity zones.
      const currentOption = chartInstance.current.getOption() as any
      const currentDataZoom = Array.isArray(currentOption?.dataZoom)
        ? currentOption.dataZoom
        : []

      if (currentDataZoom.length > 0) {
        option.dataZoom = currentDataZoom
      }

      chartInstance.current.setOption(option, {
        notMerge: false,
        lazyUpdate: true,
        replaceMerge: ['graphic', 'series', 'xAxis', 'yAxis'],
      })
    }

    const resize = () => chartInstance.current?.resize()
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
    }
  }, [symbol, timeframe, candleMode, candles, compact, status, chartOverlays, overlayToggles, smmaOverlayLength, nrtrOverlayMode, nrtrExitMode, nrtrPresetMode, sharedLivePrice])

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose()
      chartInstance.current = null
    }
  }, [])

  // Status display rule:
  // If candles are visible, always show the candle count.
  // Background refreshes should never leave the badge stuck on "Refreshing"
  // and should never keep a stale center "Preparing selected candles..." label on the chart.
  const hasVisibleCandles = candles.length > 0

  const statusBadge = hasVisibleCandles
    ? `${candles.length} Candles${liveProvider ? ' · Live' : ''}`
    : status === 'loading'
      ? 'Loading Candles'
      : status === 'empty'
        ? 'No Candles'
        : status === 'error'
          ? 'Candle Error'
          : 'Ready'

  const headerClass = compact
    ? 'flex flex-wrap items-center justify-between gap-2 border-b border-dark-700 px-2 py-2'
    : 'flex flex-wrap items-center justify-between gap-3 border-b border-dark-700 px-4 py-3'

  const selectClass = compact
    ? 'rounded-md border border-dark-700 bg-[#151922] px-2 py-1 text-[10px] text-gray-100 outline-none'
    : 'rounded-md border border-dark-700 bg-[#151922] px-3 py-1.5 text-sm text-gray-100 outline-none'

  const lockedSymbolClass = compact
    ? 'rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-300'
    : 'rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm font-bold text-amber-300'

  const badgeClass = compact
    ? `rounded-full border px-2 py-1 text-[10px] ${hasVisibleCandles ? 'border-emerald-500/50 text-emerald-400' : 'border-yellow-500/50 text-yellow-400'}`
    : `rounded-full border px-3 py-1 text-sm ${hasVisibleCandles ? 'border-emerald-500/50 text-emerald-400' : 'border-yellow-500/50 text-yellow-400'}`

  return (
    <div className={`flex ${heightClass} w-full flex-col overflow-hidden rounded-2xl border border-dark-700 bg-[#0f1115]`}>
      {showControls && (
        <div className={headerClass}>
          <div className="flex flex-wrap items-center gap-2">
            <div className={compact ? 'rounded-full bg-orange-500 px-1.5 py-0.5 text-[9px] font-bold text-white' : 'rounded-full bg-orange-500 px-2 py-1 text-xs font-bold text-white'}>
              ₿
            </div>

            {chartTitle && !compact && <span className="text-xs font-semibold text-gray-300">{chartTitle}</span>}

            {lockSymbolToDefault ? (
              <span className={lockedSymbolClass}>{symbol}</span>
            ) : (
              <select
                value={symbol}
                onChange={(event) => handleSymbolChange(event.target.value)}
                className={selectClass}
              >
                {symbolOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            )}

            <select
              value={timeframe}
              onChange={(event) => handleTimeframeChange(event.target.value)}
              className={selectClass}
            >
              {timeframeOptions.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>

            <select
              value={candleMode}
              onChange={(event) => handleCandleModeChange(event.target.value)}
              className={selectClass}
            >
              {candleModeOptions.map((mode) => (
                <option key={mode} value={mode}>
                  {compact ? mode.replace('Heikin Ashi', 'HA') : mode}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {!compact && enableAdvancedOverlays && (
              <div className="flex flex-wrap items-center gap-1">
                {([
                  ['smc', 'SMC'],
                  ['ghost', 'Ghost'],
                  ['liquidityProfile', 'Profile'],
                  ['orderBlocks', 'OB'],
                ] as Array<[OverlayToggleKey, string]>).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleOverlayToggle(key)}
                    className={`rounded-full border px-2 py-1 text-[10px] font-bold transition ${
                      overlayToggles[key]
                        ? 'border-emerald-400/60 bg-emerald-400/10 text-emerald-300'
                        : 'border-dark-600 bg-dark-900/60 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                    }`}
                    title={`${label} overlay ${overlayToggles[key] ? 'enabled' : 'disabled'}`}
                  >
                    {label}
                  </button>
                ))}

                <select
                  value={smmaOverlayLength}
                  onChange={(event) => handleSmmaOverlayChange(event.target.value)}
                  className={`rounded-full border px-2 py-1 text-[10px] font-bold outline-none transition ${
                    smmaOverlayLength !== 'Off'
                      ? 'border-blue-400/60 bg-blue-400/10 text-blue-300'
                      : 'border-dark-600 bg-dark-900/60 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                  }`}
                  title="Optional SMMA overlay"
                >
                  <option value="Off">SMMA Off</option>
                  <option value="20">SMMA 20</option>
                  <option value="50">SMMA 50</option>
                </select>

                <select
                  value={nrtrOverlayMode}
                  onChange={(event) => handleNrtrOverlayChange(event.target.value)}
                  className={`rounded-full border px-2 py-1 text-[10px] font-bold outline-none transition ${
                    nrtrOverlayMode !== 'Off'
                      ? 'border-purple-400/60 bg-purple-400/10 text-purple-300'
                      : 'border-dark-600 bg-dark-900/60 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                  }`}
                  title="Optional NRTR+ trailing stop overlay"
                >
                  <option value="Off">NRTR Off</option>
                  <option value="ATR-Based">NRTR ATR</option>
                  <option value="Percentage">NRTR %</option>
                </select>

                <select
                  value={nrtrPresetMode}
                  onChange={(event) => handleNrtrPresetModeChange(event.target.value)}
                  disabled={nrtrOverlayMode === 'Off'}
                  className={`rounded-full border px-2 py-1 text-[10px] font-bold outline-none transition ${
                    nrtrOverlayMode !== 'Off'
                      ? 'border-violet-400/60 bg-violet-400/10 text-violet-300'
                      : 'border-dark-600 bg-dark-900/60 text-gray-500 hover:border-gray-500 hover:text-gray-300 disabled:opacity-50'
                  }`}
                  title="NRTR+ preset: Scalping, Swing, or Long"
                >
                  <option value="Scalping">NRTR Scalping</option>
                  <option value="Swing">NRTR Swing</option>
                  <option value="Long">NRTR Long</option>
                </select>

                <select
                  value={nrtrExitMode}
                  onChange={(event) => handleNrtrExitModeChange(event.target.value)}
                  disabled={nrtrOverlayMode === 'Off'}
                  className={`rounded-full border px-2 py-1 text-[10px] font-bold outline-none transition ${
                    nrtrOverlayMode !== 'Off' && nrtrExitMode !== 'Off'
                      ? 'border-rose-400/60 bg-rose-400/10 text-rose-300'
                      : 'border-dark-600 bg-dark-900/60 text-gray-500 hover:border-gray-500 hover:text-gray-300 disabled:opacity-50'
                  }`}
                  title="Optional NRTR+ exit X mode"
                >
                  <option value="Off">Exit Off</option>
                  <option value="Pivot Pullback">Exit Pivot</option>
                  <option value="Internal SuperTrend End">Exit Internal ST</option>
                </select>

                <div
                  className={`rounded-full border px-2 py-1 text-[10px] font-bold ${getOverlayRenderStatusClass(overlayRenderStatus)}`}
                  title="Shows whether chart overlays are real backend data, cached backend data, fallback, loading, empty, or off."
                >
                  {getOverlayRenderStatusLabel(overlayRenderStatus)}
                </div>
              </div>
            )}

            <div className={badgeClass}>
              {statusBadge}
            </div>
          </div>
        </div>
      )}

      <div ref={chartRef} className="min-h-0 flex-1" />
    </div>
  )
}
