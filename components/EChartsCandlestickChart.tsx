'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts'

const API_BASE_URL = 'https://trading-intelligence-dashboard.onrender.com'
const DEFAULT_VISIBLE_CANDLES = 78
const CACHE_TTL_MS = 1000 * 60 * 5
const LOCAL_STORAGE_PREFIX = 'marketbos:v9:python-smc-alphax-ghost:'
const CHART_SETTINGS_PREFIX = 'marketbos:chart-settings:v1:'
const MAIN_CANDLES_READY_KEY = 'marketbos:main-candles-ready:v1'
const PRIMARY_CANDLE_SYMBOLS = ['BTCUSD', 'MES1!', 'SPY']
const PRIMARY_CANDLE_TIMEFRAMES = ['1m', '5m', '10m', '15m']
let primaryCandlePreloadStarted = false

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

type CandleMode = 'Regular' | 'Heikin Ashi'

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
const symbolOptions = ['BTCUSD', 'MES1!']

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
  if (normalized === 'ES1' || normalized === 'ES1!') return 'ES1!'
  if (normalized.includes('MES')) return 'MES1!'
  if (normalized.includes('ES') && !normalized.includes('MES')) return 'ES1!'
  if (normalized.includes('SPY')) return 'SPY'
  if (normalized.includes('ETH')) return 'ETHUSD'
  if (normalized.includes('BTC')) return 'BTCUSD'

  return normalized || fallback
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

function readChartSettings(key: string): Partial<{ symbol: string; timeframe: string; candleMode: CandleMode }> {
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
  settings: Partial<{ symbol: string; timeframe: string; candleMode: CandleMode }>
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
  if (typeof window === 'undefined') return
  if (primaryCandlePreloadStarted) return

  primaryCandlePreloadStarted = true

  const symbols = Array.from(
    new Set([
      normalizeDefaultSymbol(prioritySymbol),
      ...PRIMARY_CANDLE_SYMBOLS,
    ])
  )

  const timeframes = Array.from(
    new Set([
      normalizeDefaultTimeframe(priorityTimeframe),
      ...PRIMARY_CANDLE_TIMEFRAMES,
    ])
  )

  const params = new URLSearchParams({
    symbols: symbols.join(','),
    timeframes: timeframes.join(','),
    limit: '500',
  })

  try {
    await fetch(`${API_BASE_URL}/api/preload-candles?${params.toString()}`, {
      cache: 'no-store',
      signal,
    })
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error
    console.warn('Primary candle preload failed:', error)
  }
}


async function fetchCandlesFromNetwork(
  symbol: string,
  timeframe: string,
  limit: string,
  signal?: AbortSignal
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol: normalizeDefaultSymbol(symbol),
    timeframe: normalizeTimeframe(timeframe),
    limit,
  })

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
  const requestedLimit = requestedLimitNumber(limit)

  const cached = readMemoryCache(cacheKey) ?? readLocalStorageCache(cacheKey)

  // Important:
  // Old BTCUSD caches could contain short pages like 332 / 69 / 23 candles.
  // Do not treat those as complete when the chart is requesting 500.
  // Show short cached candles only through the load effect while a fresh
  // network request replaces them with the full 500 from the backend.
  if (cached && cached.length >= requestedLimit) return cached

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

function getOverlayCacheKey(symbol: string, timeframe: string) {
  return `${normalizeDefaultSymbol(symbol)}::${normalizeTimeframe(timeframe)}`
}

function readOverlayMemoryCache(symbol: string, timeframe: string, maxAgeMs = 15000) {
  const key = getOverlayCacheKey(symbol, timeframe)
  const cached = overlayMemoryCache.get(key)
  if (!cached) return null

  if (Date.now() - cached.createdAt > maxAgeMs) return null
  return cached.payload
}

function saveOverlayMemoryCache(symbol: string, timeframe: string, payload: any) {
  const key = getOverlayCacheKey(symbol, timeframe)
  overlayMemoryCache.set(key, {
    createdAt: Date.now(),
    payload,
  })
}

async function fetchChartOverlays(
  symbol: string,
  timeframe: string,
  signal?: AbortSignal
): Promise<any | null> {
  const params = new URLSearchParams({
    symbol: normalizeDefaultSymbol(symbol),
    timeframe: normalizeTimeframe(timeframe),
    limit: '500',
  })

  try {
    const response = await fetch(`${API_BASE_URL}/api/chart-overlays?${params.toString()}`, {
      cache: 'no-store',
      signal,
    })

    if (!response.ok) return null
    const json = await response.json()
    saveOverlayMemoryCache(symbol, timeframe, json)
    return json
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error
    console.error(`Chart overlay fetch error: /api/chart-overlays ${symbol} ${timeframe}`, error)
    return readOverlayMemoryCache(symbol, timeframe, 60000)
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
}: {
  symbol: string
  timeframe: string
  candleMode: CandleMode
  candles: Candle[]
  compact: boolean
  loading: boolean
  chartOverlays?: ChartOverlays | null
}): any {
  const activeCandles = candleMode === 'Heikin Ashi' ? convertToHeikinAshi(candles) : candles
  const latestRealClose = candles.length > 0 ? Number(candles[candles.length - 1].close) : NaN
  const overlayGhostCandles = !compact && Array.isArray(chartOverlays?.ghostCandles) ? chartOverlays?.ghostCandles ?? [] : []
  const alphaProfileBins = !compact && Array.isArray(chartOverlays?.alphaProfileBins) ? chartOverlays?.alphaProfileBins ?? [] : []
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
  const volumeData = activeCandles.map((candle, index) => ({
    value: candle.volume ?? 0,
    itemStyle: {
      color: candle.close >= candle.open ? GREEN : RED,
      opacity: compact ? 0.22 : 0.35,
    },
    xAxis: index,
  }))

  const zoneMarkAreas = !compact ? buildZoneMarkAreas(chartOverlays?.zones, activeCandles) : []
  const smcMarkerData = !compact ? buildMarkerData(chartOverlays?.smcEvents, activeCandles, MAX_SMC_LABELS, true) : []
  const liquidityMarkerData = !compact ? buildMarkerData(chartOverlays?.liquidityEvents, activeCandles, MAX_LIQUIDITY_LABELS, true) : []
  const scoreMarkerData: any[] = []
  const dlmMarkLines = !compact ? buildDlmMarkLines(chartOverlays?.dlmLevels) : []
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
            markLine: Number.isFinite(latestRealClose)
              ? {
                  silent: true,
                  symbol: ['none', 'none'],
                  animation: false,
                  label: {
                    show: true,
                    position: 'end',
                    formatter: () => compactPrice(latestRealClose),
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
                  data: [{ yAxis: latestRealClose }],
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
            markLine: Number.isFinite(latestRealClose)
              ? {
                  silent: true,
                  symbol: ['none', 'none'],
                  animation: false,
                  label: {
                    show: true,
                    position: 'end',
                    formatter: () => compactPrice(latestRealClose),
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
                  data: [{ yAxis: latestRealClose }],
                }
              : undefined,
          },
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
  onChartSelectionChange,
  latestSignal,
}: EChartsCandlestickChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)
  const activeCacheKeyRef = useRef<string>('')
  const chartIdentityRef = useRef<string>('')
  const dataSignatureRef = useRef<string>('')
  const overlayLayoutSignatureRef = useRef<string>('')
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

  const [symbol, setSymbol] = useState(() => initialSymbol)
  const [timeframe, setTimeframe] = useState(() => initialTimeframe)
  const [candleMode, setCandleMode] = useState<CandleMode>(() => initialCandleMode)
  const [historicalCandles, setHistoricalCandles] = useState<Candle[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'cached' | 'loaded' | 'empty' | 'error'>('idle')
  const [liveProvider, setLiveProvider] = useState<string>('')
  const [chartOverlays, setChartOverlays] = useState<ChartOverlays | null>(null)

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

  useEffect(() => {
    if (!followDefaultSymbol) return

    const nextSymbol = normalizeDefaultSymbol(defaultSymbol ?? latestSignal?.symbol ?? symbol, symbol)
    if (nextSymbol && nextSymbol !== symbol) {
      setSymbol(nextSymbol)
    }
  }, [defaultSymbol, latestSignal?.symbol, followDefaultSymbol, symbol])

  useEffect(() => {
    saveChartSettings(chartSettingsKey, {
      symbol,
      timeframe,
      candleMode,
    })
  }, [chartSettingsKey, symbol, timeframe, candleMode])

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

      const requestedLimit = requestedLimitNumber(candleFetchLimit)
      const cachedIsComplete = Boolean(cached && cached.length >= requestedLimit)

      if (cached && cached.length > 0) {
        // Show cache instantly if available, but still refresh below if it is short.
        setHistoricalCandles(cached)
        setStatus(cachedIsComplete ? 'cached' : 'loading')

        if (!compact) {
          setMainCandlesReady({
            symbol,
            timeframe,
            candleMode,
            count: cached.length,
            status: cachedIsComplete ? 'cached' : 'cached-refreshing',
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

        if (compact && !readMainCandlesReadyForSymbol(symbol)) {
          setStatus('waiting')
          return
        }

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

            // Only after the selected main chart candles are ready do we warm up
            // other symbols/timeframes in the background.
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
    if (historicalCandles.length === 0) return

    const controller = new AbortController()
    let cancelled = false

    async function pollLivePrice() {
      try {
        const live = await fetchLivePrice(symbol, timeframe, controller.signal)

        if (cancelled || !live) return

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
    if (compact || historicalCandles.length === 0) {
      setChartOverlays(null)
      return
    }

    const cached = readOverlayMemoryCache(symbol, timeframe, 60000)
    if (cached?.chartOverlays && typeof cached.chartOverlays === 'object') {
      setChartOverlays(cached.chartOverlays as ChartOverlays)
    }

    const controller = new AbortController()
    let cancelled = false

    async function pollChartOverlays() {
      try {
        const engine = await fetchChartOverlays(symbol, timeframe, controller.signal)
        if (cancelled) return
        const overlays = engine?.chartOverlays && typeof engine.chartOverlays === 'object'
          ? engine.chartOverlays as ChartOverlays
          : null

        if (overlays) {
          setChartOverlays(overlays)
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') return
      }
    }

    // Delay overlays slightly so the candle chart paints first.
    const firstLoadId = window.setTimeout(pollChartOverlays, 250)
    const intervalId = window.setInterval(pollChartOverlays, 15000)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(firstLoadId)
      window.clearInterval(intervalId)
    }
  }, [symbol, timeframe, compact, historicalCandles.length])

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

    const option = buildChartOption({
      symbol,
      timeframe,
      candleMode,
      candles,
      compact,
      loading: status === 'loading' && candles.length === 0,
      chartOverlays,
    })

    const chartIdentity = `${symbol}::${timeframe}::${candleMode}::${compact}`
    const dataSignature = candleDataSignature(candles)
    const layoutSignature = overlayLayoutSignature(chartOverlays)
    const identityChanged = chartIdentityRef.current !== chartIdentity
    const dataChanged = dataSignatureRef.current !== dataSignature
    const overlayLayoutChanged = overlayLayoutSignatureRef.current !== layoutSignature
    chartIdentityRef.current = chartIdentity
    dataSignatureRef.current = dataSignature
    overlayLayoutSignatureRef.current = layoutSignature

    if (identityChanged) {
      // Full reset only when symbol/timeframe/candle type changes.
      // Live ticks should update the current candle without wiping the chart.
      userZoomedRef.current = false
      chartInstance.current.clear()
      chartInstance.current.setOption(option, true)
    } else {
      // Fast path for live tick updates and status refreshes.
      // Preserve the user's current zoom/pan so the chart does not snap back
      // when they scroll right to inspect ghost candles or the liquidity profile.
      const currentOption = chartInstance.current.getOption() as any
      const shouldPreserveUserZoom =
        userZoomedRef.current &&
        !overlayLayoutChanged &&
        Array.isArray(currentOption?.dataZoom) &&
        currentOption.dataZoom.length > 0

      if (shouldPreserveUserZoom) {
        option.dataZoom = currentOption.dataZoom
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
  }, [symbol, timeframe, candleMode, candles, compact, status, chartOverlays])

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

          <div className="flex items-center gap-2">
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
