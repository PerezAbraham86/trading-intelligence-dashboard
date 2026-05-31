'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts'

const API_BASE_URL = 'https://trading-intelligence-dashboard.onrender.com'
const DEFAULT_VISIBLE_CANDLES = 120
const CACHE_TTL_MS = 1000 * 60 * 5
const LOCAL_STORAGE_PREFIX = 'marketbos:candles:'

const GREEN = '#26a69a'
const RED = '#ef5350'
const GRID = '#1f2937'
const TEXT = '#9ca3af'
const BG = '#0f1115'

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

const memoryCandleCache = new Map<string, CachedCandles>()
const inflightCandleRequests = new Map<string, Promise<Candle[]>>()

const timeframeOptions = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1D']
const candleModeOptions: CandleMode[] = ['Regular', 'Heikin Ashi']
const symbolOptions = ['BTCUSD', 'ETHUSD', 'SPY', 'ES1!', 'MES1!']

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
  if (tf === '15') return '15m'
  if (tf === '30') return '30m'
  if (tf === '60') return '1h'
  if (tf === '120') return '2h'
  if (tf === '240') return '4h'
  if (tf === 'd' || tf === '1d') return '1D'

  return tf
}

function normalizeDefaultTimeframe(value: any, fallback = '1m'): string {
  const normalized = normalizeTimeframe(value || fallback)
  return timeframeOptions.includes(normalized) ? normalized : fallback
}

function symbolsMatch(inputSymbol: any, selectedSymbol: any): boolean {
  const input = normalizeSymbol(inputSymbol)
  const selected = normalizeSymbol(selectedSymbol)

  if (!input || !selected) return false
  if (input === selected) return true
  if (selected === 'BTCUSD' && input.includes('BTC')) return true
  if (selected === 'ETHUSD' && input.includes('ETH')) return true
  if (selected === 'SPY' && input.includes('SPY')) return true
  if (selected === 'MES1!' && input.includes('MES')) return true
  if (selected === 'ES1!' && input.includes('ES') && !input.includes('MES')) return true

  return false
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

function getApiSymbolCandidates(symbol: string): string[] {
  const normalized = normalizeDefaultSymbol(symbol, symbol)
  const compact = normalizeSymbol(normalized).replace('!', '')
  const candidates: string[] = []

  const add = (value: string) => {
    const cleaned = String(value ?? '').trim()
    if (cleaned && !candidates.includes(cleaned)) candidates.push(cleaned)
  }

  add(normalized)

  if (normalized === 'MES1!' || compact === 'MES1' || compact.includes('MES')) {
    add('MES1!')
    add('MES1')
    add('MES')
    add('/MES')
    add('CME_MINI:MES1!')
  } else if (normalized === 'ES1!' || compact === 'ES1' || (compact.includes('ES') && !compact.includes('MES'))) {
    add('ES1!')
    add('ES1')
    add('ES')
    add('/ES')
    add('CME_MINI:ES1!')
  } else if (compact.includes('SPY')) {
    add('SPY')
  } else if (compact.includes('BTC')) {
    add('BTCUSD')
    add('BTC/USD')
    add('XBTUSD')
  } else if (compact.includes('ETH')) {
    add('ETHUSD')
    add('ETH/USD')
  }

  return candidates
}

function getCandleCacheKey(symbol: string, timeframe: string, limit: string) {
  return `${normalizeDefaultSymbol(symbol)}::${normalizeTimeframe(timeframe)}::${limit}`
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

async function fetchCandlesFromNetwork(
  symbol: string,
  timeframe: string,
  limit: string,
  signal?: AbortSignal
): Promise<Candle[]> {
  const endpoints = [
    '/api/historical-candles',
    '/api/candles',
    '/api/recent-candles',
    '/api/live-candle',
    '/api/provider-debug',
  ]

  for (const path of endpoints) {
    for (const candidate of getApiSymbolCandidates(symbol)) {
      const params = new URLSearchParams({
        symbol: candidate,
        timeframe: normalizeTimeframe(timeframe),
        limit,
      })

      try {
        const response = await fetch(`${API_BASE_URL}${path}?${params.toString()}`, {
          cache: 'no-store',
          signal,
        })

        if (!response.ok) continue

        const json = await response.json()
        const candles = extractCandleArray(json)
          .map(candleFromAny)
          .filter((candle): candle is Candle => candle !== null)

        if (candles.length > 0) return mergeCandlesByTime(candles)
      } catch (error: any) {
        if (error?.name === 'AbortError') throw error
        console.error(`Candle fetch error: ${path} ${candidate}`, error)
      }
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
  const cacheKey = getCandleCacheKey(symbol, timeframe, limit)

  const cached = readMemoryCache(cacheKey) ?? readLocalStorageCache(cacheKey)
  if (cached && cached.length > 0) return cached

  const existingRequest = inflightCandleRequests.get(cacheKey)
  if (existingRequest) return existingRequest

  const request = fetchCandlesFromNetwork(symbol, timeframe, limit, signal)
    .then((candles) => {
      saveCandleCache(cacheKey, candles)
      return candles
    })
    .finally(() => {
      inflightCandleRequests.delete(cacheKey)
    })

  inflightCandleRequests.set(cacheKey, request)
  return request
}

function buildCandlesFromRecentCandles(
  candlesInput: any[] | undefined,
  selectedSymbol: string,
  selectedTimeframe: string
): Candle[] {
  if (!Array.isArray(candlesInput) || candlesInput.length === 0) return []

  const normalizedTimeframe = normalizeTimeframe(selectedTimeframe)

  return candlesInput
    .filter((candle) => {
      const candleSymbol = candle?.symbol ?? candle?.ticker ?? candle?.S ?? candle?.s ?? candle?.contract ?? candle?.instrument
      const candleTimeframe = candle?.timeframe ?? candle?.tf ?? candle?.interval

      const symbolOk = candleSymbol ? symbolsMatch(candleSymbol, selectedSymbol) : true
      const timeframeOk = candleTimeframe ? normalizeTimeframe(candleTimeframe) === normalizedTimeframe : true

      return symbolOk && timeframeOk
    })
    .map(candleFromAny)
    .filter((candle): candle is Candle => candle !== null)
}

function buildCandlesFromSignals(
  signals: any[] | undefined,
  selectedSymbol: string,
  selectedTimeframe: string
): Candle[] {
  if (!Array.isArray(signals) || signals.length === 0) return []

  const normalizedTimeframe = normalizeTimeframe(selectedTimeframe)

  return signals
    .filter((signal) => {
      const timeframeOk = signal?.timeframe ? normalizeTimeframe(signal.timeframe) === normalizedTimeframe : true
      return symbolsMatch(signal?.symbol, selectedSymbol) && timeframeOk
    })
    .map(candleFromAny)
    .filter((candle): candle is Candle => candle !== null)
}

function getInitialZoom(candleCount: number) {
  const visible = Math.min(DEFAULT_VISIBLE_CANDLES, Math.max(candleCount, 1))

  return {
    startValue: Math.max(0, candleCount - visible),
    endValue: Math.max(0, candleCount - 1),
  }
}

function buildChartOption({
  symbol,
  timeframe,
  candleMode,
  candles,
  compact,
  loading,
}: {
  symbol: string
  timeframe: string
  candleMode: CandleMode
  candles: Candle[]
  compact: boolean
  loading: boolean
}): echarts.EChartsOption {
  const activeCandles = candleMode === 'Heikin Ashi' ? convertToHeikinAshi(candles) : candles
  const xAxisData = activeCandles.map((candle) => candle.time)
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

  const zoom = getInitialZoom(activeCandles.length)

  return {
    backgroundColor: BG,
    animation: false,
    grid: compact
      ? [
          { left: 8, right: 8, top: 8, bottom: 20 },
        ]
      : [
          { left: 58, right: 24, top: 44, bottom: 98 },
          { left: 58, right: 24, height: 46, bottom: 34 },
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

        const data = candleParam.data
        const open = Number(data?.[0])
        const close = Number(data?.[1])
        const low = Number(data?.[2])
        const high = Number(data?.[3])

        return [
          `<strong>${candleParam.axisValue}</strong>`,
          `Open: ${open.toFixed(2)}`,
          `High: ${high.toFixed(2)}`,
          `Low: ${low.toFixed(2)}`,
          `Close: ${close.toFixed(2)}`,
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
            axisLabel: { show: false },
            axisLine: { lineStyle: { color: GRID } },
            axisTick: { show: false },
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
              formatter: shortAxisLabel,
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
            axisLabel: { show: false },
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { show: false },
          },
        ]
      : [
          {
            scale: true,
            position: 'right',
            axisLabel: { color: TEXT },
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
            zoomOnMouseWheel: false,
            moveOnMouseMove: true,
            moveOnMouseWheel: true,
          },
        ]
      : [
          {
            type: 'inside',
            xAxisIndex: [0, 1],
            ...zoom,
            zoomOnMouseWheel: false,
            moveOnMouseMove: true,
            moveOnMouseWheel: true,
          },
          {
            type: 'slider',
            xAxisIndex: [0, 1],
            height: 18,
            bottom: 8,
            ...zoom,
            borderColor: GRID,
            fillerColor: 'rgba(148, 163, 184, 0.14)',
            handleStyle: { color: '#64748b' },
            textStyle: { color: TEXT },
          },
        ],
    graphic:
      activeCandles.length === 0
        ? [
            {
              type: 'text',
              left: 'center',
              top: 'middle',
              style: {
                text: loading ? 'Loading candles...' : 'No candles loaded',
                fill: '#9ca3af',
                fontSize: compact ? 11 : 14,
                fontWeight: 700,
              },
            },
          ]
        : [],
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
            barWidth: '58%',
            barMinWidth: 2,
            barMaxWidth: 10,
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
            barWidth: '58%',
            barMinWidth: 3,
            barMaxWidth: 15,
          },
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
  recentSignals,
  recentCandles,
}: EChartsCandlestickChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)

  const initialSymbol = normalizeDefaultSymbol(
    defaultSymbol ?? latestSignal?.symbol ?? 'BTCUSD',
    'BTCUSD'
  )
  const initialTimeframe = normalizeDefaultTimeframe(defaultTimeframe ?? latestSignal?.timeframe, '1m')
  const initialCandleMode = candleModeOptions.includes(defaultCandleMode) ? defaultCandleMode : 'Heikin Ashi'

  const [symbol, setSymbol] = useState(() => initialSymbol)
  const [timeframe, setTimeframe] = useState(() => initialTimeframe)
  const [candleMode, setCandleMode] = useState<CandleMode>(() => initialCandleMode)
  const [historicalCandles, setHistoricalCandles] = useState<Candle[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'cached' | 'loaded' | 'empty' | 'error'>('idle')

  const candleFetchLimit = compact ? '500' : '1500'

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
    onChartSelectionChange?.({
      symbol,
      timeframe,
      candleMode,
      compact,
      chartTitle,
    })
  }, [symbol, timeframe, candleMode, compact, chartTitle, onChartSelectionChange])

  useEffect(() => {
    void allowCompactHistory

    const controller = new AbortController()
    let cancelled = false

    async function loadCandles() {
      const cacheKey = getCandleCacheKey(symbol, timeframe, candleFetchLimit)
      const cached = readMemoryCache(cacheKey) ?? readLocalStorageCache(cacheKey)

      if (cached && cached.length > 0) {
        setHistoricalCandles(cached)
        setStatus('cached')
      } else {
        setStatus('loading')
      }

      try {
        const candles = await fetchCandlesFromNetwork(symbol, timeframe, candleFetchLimit, controller.signal)

        if (cancelled) return

        if (candles.length > 0) {
          saveCandleCache(cacheKey, candles)
          setHistoricalCandles(candles)
          setStatus('loaded')
        } else if (!cached || cached.length === 0) {
          setHistoricalCandles([])
          setStatus('empty')
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') return

        console.error('Historical candle fetch error:', error)

        if (!cancelled && (!cached || cached.length === 0)) {
          setHistoricalCandles([])
          setStatus('error')
        }
      }
    }

    loadCandles()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [symbol, timeframe, compact, allowCompactHistory, candleFetchLimit])

  const liveCandlesFromCandlesEndpoint = useMemo(
    () => buildCandlesFromRecentCandles(recentCandles, symbol, timeframe),
    [recentCandles, symbol, timeframe]
  )

  const liveCandlesFromSignalsEndpoint = useMemo(
    () => buildCandlesFromSignals(recentSignals, symbol, timeframe),
    [recentSignals, symbol, timeframe]
  )

  const candles = useMemo(
    () =>
      mergeCandlesByTime([
        ...historicalCandles,
        ...liveCandlesFromCandlesEndpoint,
        ...liveCandlesFromSignalsEndpoint,
      ]),
    [historicalCandles, liveCandlesFromCandlesEndpoint, liveCandlesFromSignalsEndpoint]
  )

  useEffect(() => {
    if (!chartRef.current) return

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current)
    }

    const option = buildChartOption({
      symbol,
      timeframe,
      candleMode,
      candles,
      compact,
      loading: status === 'loading',
    })

    chartInstance.current.setOption(option, {
      notMerge: false,
      lazyUpdate: true,
    })

    const resize = () => chartInstance.current?.resize()
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
    }
  }, [symbol, timeframe, candleMode, candles, compact, status])

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose()
      chartInstance.current = null
    }
  }, [])

  const statusBadge =
    status === 'loading'
      ? candles.length > 0
        ? 'Refreshing'
        : 'Loading Candles'
      : status === 'cached'
        ? `${candles.length} Cached`
        : status === 'loaded'
          ? `${candles.length} Candles`
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
    ? `rounded-full border px-2 py-1 text-[10px] ${status === 'loaded' || status === 'cached' ? 'border-emerald-500/50 text-emerald-400' : 'border-yellow-500/50 text-yellow-400'}`
    : `rounded-full border px-3 py-1 text-sm ${status === 'loaded' || status === 'cached' ? 'border-emerald-500/50 text-emerald-400' : 'border-yellow-500/50 text-yellow-400'}`

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
