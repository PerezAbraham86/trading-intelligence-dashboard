'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts'

const API_BASE_URL = 'https://trading-intelligence-dashboard.onrender.com'
const DEFAULT_VISIBLE_CANDLES = 120

const GREEN = '#26a69a'
const RED = '#ef5350'
const BLUE = '#3b82f6'
const YELLOW = '#facc15'
const PURPLE = '#a855f7'
const CYAN = '#22d3ee'
const ORANGE = '#fb923c'
const PINK = '#f472b6'
const GRAY = '#94a3b8'
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
type SmcDisplayMode = 'Clean' | 'Full' | 'Structure Only' | 'Zones Only'

type StructureEvent = {
  time?: string
  fromTime?: string
  price: number
  tag?: string
  label?: string
  direction?: 'bullish' | 'bearish' | 'neutral' | string
  scope?: string
  kind?: string
}

type DlmLevel = {
  label?: string
  price: number
  direction?: 'neutral' | 'bullish' | 'bearish' | string
  kind?: string
}

type Zone = {
  startTime?: string
  endTime?: string
  time?: string
  top: number
  bottom: number
  label?: string
  direction?: 'bullish' | 'bearish' | 'neutral' | string
  kind?: string
}

type LiquidityEvent = {
  time?: string
  fromTime?: string
  price: number
  label?: string
  direction?: 'bullish' | 'bearish' | 'neutral' | string
  kind?: string
  touches?: number
}

type ScoreMarker = {
  time?: string
  price: number
  label?: string
  direction?: 'bullish' | 'bearish' | 'neutral' | string
  kind?: string
  score?: number
  grade?: 'A' | 'B' | 'C' | string
}

type AlphaProfileBin = {
  index: number
  top: number
  bottom: number
  mid: number
  volume?: number
  buyVolume?: number
  sellVolume?: number
  widthPct?: number
  buyWidthPct?: number
  sellWidthPct?: number
  isPoc?: boolean
  isBuyLiquidity?: boolean
  isSellLiquidity?: boolean
  direction?: 'bullish' | 'bearish' | 'neutral' | string
  dominantSide?: 'bullish' | 'bearish' | 'neutral' | string
  label?: string
}

type GhostCandle = {
  index?: number
  slot?: string
  label?: string
  open: number
  high: number
  low: number
  close: number
  confidence?: number
  direction?: 'up' | 'down' | 'bullish' | 'bearish' | 'neutral' | string
}

type EngineState = {
  symbol?: string
  timeframe?: string
  source?: {
    symbol?: string
    timeframe?: string
    dataProvider?: string
  }
  candles?: any[]
  heikinAshiCandles?: any[]
  smcEvents?: StructureEvent[]
  dlmLevels?: DlmLevel[]
  zones?: Zone[]
  liquidityEvents?: LiquidityEvent[]
  dlmConfluenceMarkers?: ScoreMarker[]
  scoreMarkers?: ScoreMarker[]
  alphaProfileBins?: AlphaProfileBin[]
  alphaFvgs?: Zone[]
  alphaSweeps?: LiquidityEvent[]
  ghostCandles?: GhostCandle[]
  ghostProjections?: GhostCandle[]
  projections?: GhostCandle[]
  technicalSentiment?: any
  sentiment?: any
  status?: string
  engine?: string
  phase?: string
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

function isFuturesSymbol(symbol: string) {
  const normalized = normalizeDefaultSymbol(symbol, symbol)
  return normalized === 'MES1!' || normalized === 'ES1!'
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

  if (text.startsWith('__ghost_')) return text.replace('__ghost_', 'Ghost ')
  if (text.startsWith('__profile_')) return ''

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
    add('CME_MINI:MES1!')
  } else if (normalized === 'ES1!' || compact === 'ES1' || (compact.includes('ES') && !compact.includes('MES'))) {
    add('ES1!')
    add('ES1')
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

async function fetchCandles(symbol: string, timeframe: string, limit: string): Promise<Candle[]> {
  // Historical candles are now the source of truth for stocks/crypto/futures.
  // main.py handles Alpaca for BTC/ETH/SPY and InsightSentry for ES/MES.
  const endpoints = ['/api/historical-candles']

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
        })

        if (!response.ok) continue

        const json = await response.json()
        const candles = extractCandleArray(json)
          .map(candleFromAny)
          .filter((candle): candle is Candle => candle !== null)

        if (candles.length > 0) return mergeCandlesByTime(candles)
      } catch (error) {
        console.error(`Candle fetch error: ${path} ${candidate}`, error)
      }
    }
  }

  return []
}

async function fetchEngineState(symbol: string, timeframe: string, limit: string): Promise<EngineState | null> {
  const params = new URLSearchParams({
    symbol: normalizeDefaultSymbol(symbol, symbol),
    timeframe: normalizeTimeframe(timeframe),
    limit,
  })

  try {
    const response = await fetch(`${API_BASE_URL}/api/engine-state?${params.toString()}`, {
      cache: 'no-store',
    })

    if (!response.ok) return null

    const json = await response.json()

    if (json && typeof json === 'object') return json as EngineState
  } catch (error) {
    console.error('Engine state fetch error:', error)
  }

  return null
}

function engineMatchesSelection(engineState: EngineState | null, symbol: string, timeframe: string): boolean {
  if (!engineState) return false

  const sourceSymbol =
    engineState.source?.symbol ??
    engineState.symbol ??
    engineState.candles?.[0]?.symbol

  const sourceTimeframe =
    engineState.source?.timeframe ??
    engineState.timeframe ??
    engineState.candles?.[0]?.timeframe

  const symbolOk = symbolsMatch(sourceSymbol, symbol)
  const timeframeOk = normalizeTimeframe(sourceTimeframe || timeframe) === normalizeTimeframe(timeframe)

  return symbolOk && timeframeOk
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

      const symbolOk = candleSymbol ? symbolsMatch(candleSymbol, selectedSymbol) : false
      const timeframeOk = candleTimeframe ? normalizeTimeframe(candleTimeframe) === normalizedTimeframe : false

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
      const timeframeOk = signal?.timeframe ? normalizeTimeframe(signal.timeframe) === normalizedTimeframe : false
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

function getCandlePriceRange(candles: Candle[]) {
  if (!candles.length) {
    return {
      min: 0,
      max: 0,
      paddedMin: 0,
      paddedMax: 0,
      hasRange: false,
    }
  }

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const candle of candles) {
    min = Math.min(min, candle.low, candle.open, candle.close)
    max = Math.max(max, candle.high, candle.open, candle.close)
  }

  const rawRange = Math.max(max - min, Math.abs(max) * 0.001, 1)
  const pad = rawRange * 0.35

  return {
    min,
    max,
    paddedMin: min - pad,
    paddedMax: max + pad,
    hasRange: Number.isFinite(min) && Number.isFinite(max),
  }
}

function priceInRange(price: any, range: ReturnType<typeof getCandlePriceRange>) {
  const value = Number(price)
  if (!range.hasRange || !Number.isFinite(value)) return false
  return value >= range.paddedMin && value <= range.paddedMax
}

function zoneInRange(zone: Zone, range: ReturnType<typeof getCandlePriceRange>) {
  const top = Number(zone.top)
  const bottom = Number(zone.bottom)
  if (!range.hasRange || !Number.isFinite(top) || !Number.isFinite(bottom)) return false
  return Math.max(top, bottom) >= range.paddedMin && Math.min(top, bottom) <= range.paddedMax
}

function profileInRange(bin: AlphaProfileBin, range: ReturnType<typeof getCandlePriceRange>) {
  const top = Number(bin.top)
  const bottom = Number(bin.bottom)
  const mid = Number(bin.mid)
  if (!range.hasRange) return false
  return (
    priceInRange(mid, range) ||
    (Number.isFinite(top) && Number.isFinite(bottom) && Math.max(top, bottom) >= range.paddedMin && Math.min(top, bottom) <= range.paddedMax)
  )
}

function colorForDirection(direction?: string, fallback = BLUE) {
  const text = String(direction ?? '').toLowerCase()
  if (text.includes('bull') || text.includes('buy') || text === 'up') return GREEN
  if (text.includes('bear') || text.includes('sell') || text === 'down') return RED
  if (text.includes('neutral')) return BLUE
  return fallback
}

function colorForKind(kind?: string, direction?: string) {
  const text = String(kind ?? '').toLowerCase()

  if (text.includes('poc')) return CYAN
  if (text.includes('score')) return ORANGE
  if (text.includes('session')) return GRAY
  if (text.includes('fvg')) return PURPLE
  if (text.includes('inducement')) return YELLOW
  if (text.includes('liquidity')) return PURPLE

  return colorForDirection(direction)
}

function safeArray<T>(value: any): T[] {
  return Array.isArray(value) ? value : []
}

function normalizeZone(zone: Zone): Zone | null {
  const top = Number(zone.top)
  const bottom = Number(zone.bottom)
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null

  return {
    ...zone,
    top: Math.max(top, bottom),
    bottom: Math.min(top, bottom),
    startTime: zone.startTime ?? zone.time,
    endTime: zone.endTime ?? zone.startTime ?? zone.time,
    label: zone.label ?? zone.kind ?? 'Zone',
  }
}

function extractGhostCandles(engineState: EngineState | null): GhostCandle[] {
  if (!engineState) return []

  const candidates = [
    ...safeArray<GhostCandle>(engineState.ghostProjections),
    ...safeArray<GhostCandle>(engineState.ghostCandles),
    ...safeArray<GhostCandle>(engineState.projections),
  ]

  const valid: GhostCandle[] = []

  for (const item of candidates) {
    const open = toNumber((item as any)?.open)
    const high = toNumber((item as any)?.high)
    const low = toNumber((item as any)?.low)
    const close = toNumber((item as any)?.close)

    if (open === null || high === null || low === null || close === null) continue

    valid.push({
      ...item,
      open,
      high,
      low,
      close,
    })
  }

  return valid.slice(0, 10)
}

function buildOverlayData(engineState: EngineState | null, activeCandles: Candle[], showFull: boolean) {
  const range = getCandlePriceRange(activeCandles)

  if (!engineState || !range.hasRange) {
    return {
      markLines: [] as any[],
      markAreas: [] as any[],
      markPoints: [] as any[],
      profileBins: [] as AlphaProfileBin[],
      ghostCandles: [] as GhostCandle[],
      rejectedOverlayCount: 0,
    }
  }

  let rejectedOverlayCount = 0

  const addRejected = () => {
    rejectedOverlayCount += 1
  }

  const markLines: any[] = []
  const markAreas: any[] = []
  const markPoints: any[] = []

  const dlmLevels = safeArray<DlmLevel>(engineState.dlmLevels)
  const smcEvents = safeArray<StructureEvent>(engineState.smcEvents)
  const liquidityEvents = [
    ...safeArray<LiquidityEvent>(engineState.liquidityEvents),
    ...safeArray<LiquidityEvent>(engineState.alphaSweeps),
  ]
  const scoreMarkers = [
    ...safeArray<ScoreMarker>(engineState.scoreMarkers),
    ...safeArray<ScoreMarker>(engineState.dlmConfluenceMarkers),
  ]

  for (const level of dlmLevels.slice(-80)) {
    const price = Number(level.price)
    if (!priceInRange(price, range)) {
      addRejected()
      continue
    }

    const color = colorForKind(level.kind, level.direction)

    markLines.push({
      name: level.label ?? level.kind ?? 'DLM',
      yAxis: price,
      lineStyle: {
        color,
        width: String(level.kind ?? '').toLowerCase().includes('poc') ? 2 : 1,
        type: String(level.direction ?? '').toLowerCase().includes('neutral') ? 'dashed' : 'solid',
      },
      label: {
        show: !String(level.label ?? '').toLowerCase().includes('bin'),
        formatter: level.label ?? level.kind ?? 'DLM',
        color,
        fontSize: 10,
      },
    })
  }

  const normalizedZones = [
    ...safeArray<Zone>(engineState.zones),
    ...safeArray<Zone>(engineState.alphaFvgs),
  ]
    .map(normalizeZone)
    .filter((zone): zone is Zone => Boolean(zone))

  for (const zone of normalizedZones.slice(-(showFull ? 80 : 22))) {
    if (!zoneInRange(zone, range)) {
      addRejected()
      continue
    }

    const color = colorForKind(zone.kind, zone.direction)
    const start = zone.startTime ?? activeCandles[Math.max(0, activeCandles.length - 80)]?.time
    const end = zone.endTime ?? activeCandles[activeCandles.length - 1]?.time

    markAreas.push([
      {
        xAxis: start,
        yAxis: zone.top,
        itemStyle: {
          color: `${color}22`,
          borderColor: `${color}88`,
          borderWidth: 1,
        },
        label: {
          show: !showFull ? false : true,
          formatter: zone.label ?? zone.kind ?? 'Zone',
          color,
          fontSize: 10,
        },
      },
      {
        xAxis: end,
        yAxis: zone.bottom,
      },
    ])
  }

  for (const event of smcEvents.slice(-(showFull ? 80 : 24))) {
    const price = Number(event.price)
    if (!priceInRange(price, range)) {
      addRejected()
      continue
    }

    const color = colorForKind(event.kind, event.direction)

    markPoints.push({
      name: event.tag ?? event.label ?? 'SMC',
      coord: [event.time ?? activeCandles[activeCandles.length - 1]?.time, price],
      value: event.tag ?? event.label ?? 'SMC',
      symbol: 'pin',
      symbolSize: showFull ? 32 : 26,
      itemStyle: { color },
      label: {
        color: '#ffffff',
        fontSize: 9,
        formatter: event.tag ?? event.label ?? '',
      },
    })
  }

  for (const event of liquidityEvents.slice(-(showFull ? 80 : 24))) {
    const price = Number(event.price)
    if (!priceInRange(price, range)) {
      addRejected()
      continue
    }

    const color = colorForKind(event.kind, event.direction)

    markPoints.push({
      name: event.label ?? event.kind ?? 'Liquidity',
      coord: [event.time ?? activeCandles[activeCandles.length - 1]?.time, price],
      value: event.label ?? event.kind ?? 'LQ',
      symbol: 'diamond',
      symbolSize: showFull ? 18 : 14,
      itemStyle: { color },
      label: {
        color,
        fontSize: 9,
        formatter: event.label ?? event.kind ?? '',
        position: 'top',
      },
    })
  }

  for (const marker of scoreMarkers.slice(-(showFull ? 50 : 12))) {
    const price = Number(marker.price)
    if (!priceInRange(price, range)) {
      addRejected()
      continue
    }

    const color = colorForKind(marker.kind, marker.direction)

    markPoints.push({
      name: marker.label ?? marker.kind ?? 'Score',
      coord: [marker.time ?? activeCandles[activeCandles.length - 1]?.time, price],
      value: marker.label ?? marker.grade ?? marker.score ?? 'Score',
      symbol: 'circle',
      symbolSize: 16,
      itemStyle: { color },
      label: {
        color,
        fontSize: 9,
        formatter: marker.label ?? marker.grade ?? String(marker.score ?? ''),
        position: 'bottom',
      },
    })
  }

  const profileBins = safeArray<AlphaProfileBin>(engineState.alphaProfileBins)
    .filter((bin) => {
      const ok = profileInRange(bin, range)
      if (!ok) addRejected()
      return ok
    })
    .slice(-40)

  const ghostCandles = extractGhostCandles(engineState).filter((ghost) => {
    const ok =
      priceInRange(ghost.open, range) ||
      priceInRange(ghost.close, range) ||
      (Math.max(ghost.high, ghost.low) >= range.paddedMin && Math.min(ghost.high, ghost.low) <= range.paddedMax)

    if (!ok) addRejected()
    return ok
  })

  return {
    markLines,
    markAreas,
    markPoints,
    profileBins,
    ghostCandles,
    rejectedOverlayCount,
  }
}

function makeProfileSeries(profileBins: AlphaProfileBin[], xAxisData: string[], showProfile: boolean) {
  if (!showProfile || profileBins.length === 0) return []

  const firstProfileIndex = xAxisData.findIndex((item) => item.startsWith('__profile_'))
  if (firstProfileIndex < 0) return []

  const maxWidth = Math.max(...profileBins.map((bin) => Number(bin.widthPct ?? bin.buyWidthPct ?? bin.sellWidthPct ?? 0)), 1)

  return [
    {
      name: 'AlphaX Profile',
      type: 'custom',
      coordinateSystem: 'cartesian2d',
      clip: true,
      silent: true,
      z: 5,
      renderItem: (params: any, api: any) => {
        const bin = profileBins[params.dataIndex]
        if (!bin) return null

        const top = Number(bin.top)
        const bottom = Number(bin.bottom)
        const mid = Number(bin.mid)
        const widthPct = Math.max(Number(bin.widthPct ?? 0), Number(bin.buyWidthPct ?? 0), Number(bin.sellWidthPct ?? 0))
        const slotWidth = Math.max(1, Math.round((widthPct / maxWidth) * 18))
        const color = bin.isPoc ? CYAN : colorForDirection(bin.dominantSide ?? bin.direction, BLUE)

        const p1 = api.coord([firstProfileIndex, top])
        const p2 = api.coord([firstProfileIndex + slotWidth, bottom])
        const height = Math.max(2, Math.abs(p2[1] - p1[1]))

        return {
          type: 'rect',
          shape: {
            x: p1[0],
            y: Math.min(p1[1], p2[1]),
            width: Math.max(3, p2[0] - p1[0]),
            height,
          },
          style: {
            fill: `${color}66`,
            stroke: `${color}aa`,
            lineWidth: bin.isPoc ? 1.5 : 0.8,
          },
        }
      },
      data: profileBins.map((bin) => [firstProfileIndex, bin.mid, bin.widthPct ?? 0]),
    },
  ]
}

function buildChartOption({
  symbol,
  timeframe,
  candleMode,
  candles,
  engineState,
  compact,
  loading,
  enableAdvancedOverlays,
  smcDisplayMode,
  showSmc,
  showDlm,
  showZones,
  showLiquidity,
  showScores,
  showGhost,
  showProfile,
}: {
  symbol: string
  timeframe: string
  candleMode: CandleMode
  candles: Candle[]
  engineState: EngineState | null
  compact: boolean
  loading: boolean
  enableAdvancedOverlays: boolean
  smcDisplayMode: SmcDisplayMode
  showSmc: boolean
  showDlm: boolean
  showZones: boolean
  showLiquidity: boolean
  showScores: boolean
  showGhost: boolean
  showProfile: boolean
}): echarts.EChartsOption {
  const activeCandles = candleMode === 'Heikin Ashi' ? convertToHeikinAshi(candles) : candles
  const showFull = smcDisplayMode === 'Full'

  const overlays = enableAdvancedOverlays
    ? buildOverlayData(engineState, activeCandles, showFull)
    : {
        markLines: [] as any[],
        markAreas: [] as any[],
        markPoints: [] as any[],
        profileBins: [] as AlphaProfileBin[],
        ghostCandles: [] as GhostCandle[],
        rejectedOverlayCount: 0,
      }

  const visibleGhosts = showGhost ? overlays.ghostCandles : []
  const profileSlotCount = showProfile && overlays.profileBins.length > 0 ? 24 : 0
  const ghostSlots = visibleGhosts.map((_, index) => `__ghost_${index + 1}`)
  const profileSlots = Array.from({ length: profileSlotCount }, (_, index) => `__profile_${index + 1}`)

  const xAxisData = [
    ...activeCandles.map((candle) => candle.time),
    ...ghostSlots,
    ...profileSlots,
  ]

  const candleData = [
    ...activeCandles.map((candle) => [
      candle.open,
      candle.close,
      candle.low,
      candle.high,
    ]),
    ...Array.from({ length: ghostSlots.length + profileSlots.length }, () => '-'),
  ]

  const ghostData = [
    ...Array.from({ length: activeCandles.length }, () => '-'),
    ...visibleGhosts.map((ghost) => [
      ghost.open,
      ghost.close,
      ghost.low,
      ghost.high,
    ]),
    ...Array.from({ length: profileSlots.length }, () => '-'),
  ]

  const volumeData = [
    ...activeCandles.map((candle, index) => ({
      value: candle.volume ?? 0,
      itemStyle: {
        color: candle.close >= candle.open ? GREEN : RED,
        opacity: compact ? 0.22 : 0.35,
      },
      xAxis: index,
    })),
    ...Array.from({ length: ghostSlots.length + profileSlots.length }, () => ({ value: 0 })),
  ]

  const zoom = getInitialZoom(activeCandles.length)
  const activeMarkLines = showDlm ? overlays.markLines : []
  const activeMarkAreas = showZones ? overlays.markAreas : []
  const activeMarkPoints = [
    ...(showSmc || showLiquidity || showScores ? overlays.markPoints : []),
  ]

  const profileSeries = makeProfileSeries(overlays.profileBins, xAxisData, showProfile && !compact)
  const sourceText =
    engineState?.source?.dataProvider ??
    activeCandles[activeCandles.length - 1]?.provider ??
    (isFuturesSymbol(symbol) ? 'InsightSentry' : 'Alpaca')

  return {
    backgroundColor: BG,
    animation: false,
    grid: compact
      ? [
          { left: 8, right: 8, top: 8, bottom: 20 },
        ]
      : [
          { left: 58, right: profileSlotCount > 0 ? 74 : 24, top: 44, bottom: 98 },
          { left: 58, right: profileSlotCount > 0 ? 74 : 24, height: 46, bottom: 34 },
        ],
    title: compact
      ? undefined
      : {
          text: `${symbol} · ${timeframe} · ${candleMode} · ${sourceText}`,
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
          ? params.find((param) => param.seriesType === 'candlestick' && Array.isArray(param.data))
          : params

        if (!candleParam || !Array.isArray(candleParam.data)) return ''

        const data = candleParam.data
        const open = Number(data?.[0])
        const close = Number(data?.[1])
        const low = Number(data?.[2])
        const high = Number(data?.[3])

        if (![open, high, low, close].every(Number.isFinite)) return ''

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
            id: 'main-x-scroll',
            type: 'inside',
            xAxisIndex: [0],
            ...zoom,
            zoomOnMouseWheel: false,
            moveOnMouseMove: true,
            moveOnMouseWheel: true,
            filterMode: 'none',
          },
        ]
      : [
          {
            id: 'main-x-scroll',
            type: 'inside',
            xAxisIndex: [0, 1],
            ...zoom,
            zoomOnMouseWheel: false,
            moveOnMouseMove: true,
            moveOnMouseWheel: true,
            filterMode: 'none',
          },
          {
            id: 'main-x-slider',
            type: 'slider',
            xAxisIndex: [0, 1],
            height: 18,
            bottom: 8,
            ...zoom,
            borderColor: GRID,
            fillerColor: 'rgba(148, 163, 184, 0.14)',
            handleStyle: { color: '#64748b' },
            textStyle: { color: TEXT },
            filterMode: 'none',
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
            id: 'main-candles',
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
            markLine: {
              silent: true,
              symbol: ['none', 'none'],
              data: activeMarkLines,
            },
            markArea: {
              silent: true,
              data: activeMarkAreas,
            },
            markPoint: {
              data: activeMarkPoints,
            },
          },
          {
            id: 'ghost-candles',
            name: 'Python Ghost Candles',
            type: 'candlestick',
            data: ghostData,
            itemStyle: {
              color: `${CYAN}99`,
              color0: `${PINK}99`,
              borderColor: CYAN,
              borderColor0: PINK,
              opacity: 0.55,
            },
            barWidth: '46%',
            barMinWidth: 3,
            barMaxWidth: 12,
            z: 12,
          },
          {
            name: 'Volume',
            type: 'bar',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: volumeData,
            large: true,
          },
          ...profileSeries,
        ],
  }
}

export default function EChartsCandlestickChart({
  heightClass = 'h-[650px]',
  compact = false,
  chartTitle,
  enableAdvancedOverlays = true,
  defaultSymbol,
  defaultTimeframe = '1m',
  defaultCandleMode = 'Heikin Ashi',
  allowCompactHistory = true,
  onChartSelectionChange,
  latestSignal,
  recentSignals,
  recentCandles,
}: EChartsCandlestickChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)

  const initialSymbol = normalizeDefaultSymbol(
    defaultSymbol ?? (compact ? 'SPY' : latestSignal?.symbol),
    compact ? 'SPY' : 'BTCUSD'
  )
  const initialTimeframe = normalizeDefaultTimeframe(defaultTimeframe ?? latestSignal?.timeframe, '1m')
  const initialCandleMode = candleModeOptions.includes(defaultCandleMode) ? defaultCandleMode : 'Heikin Ashi'

  const [symbol, setSymbol] = useState(initialSymbol)
  const [timeframe, setTimeframe] = useState(initialTimeframe)
  const [candleMode, setCandleMode] = useState<CandleMode>(initialCandleMode)
  const [historicalCandles, setHistoricalCandles] = useState<Candle[]>([])
  const [engineState, setEngineState] = useState<EngineState | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'empty' | 'error'>('idle')
  const [engineStatus, setEngineStatus] = useState<'idle' | 'loading' | 'loaded' | 'empty' | 'error'>('idle')

  const [showSmc, setShowSmc] = useState(true)
  const [showDlm, setShowDlm] = useState(true)
  const [showZones, setShowZones] = useState(true)
  const [showLiquidity, setShowLiquidity] = useState(true)
  const [showScores, setShowScores] = useState(true)
  const [showGhost, setShowGhost] = useState(true)
  const [showProfile, setShowProfile] = useState(true)
  const [smcDisplayMode, setSmcDisplayMode] = useState<SmcDisplayMode>('Clean')

  const candleFetchLimit = compact ? '500' : '1500'
  const engineFetchLimit = compact ? '500' : '1000'

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
    const nextSymbol = normalizeDefaultSymbol(
      defaultSymbol ?? (compact ? symbol : latestSignal?.symbol),
      compact ? symbol : 'BTCUSD'
    )

    if (nextSymbol && nextSymbol !== symbol) setSymbol(nextSymbol)
  }, [defaultSymbol, latestSignal?.symbol])

  useEffect(() => {
    const nextTimeframe = normalizeDefaultTimeframe(
      defaultTimeframe ?? (compact ? timeframe : latestSignal?.timeframe),
      timeframe || '1m'
    )

    if (nextTimeframe && nextTimeframe !== timeframe) setTimeframe(nextTimeframe)
  }, [defaultTimeframe, latestSignal?.timeframe])

  useEffect(() => {
    void allowCompactHistory

    let cancelled = false

    async function loadCandles() {
      setStatus('loading')

      try {
        const candles = await fetchCandles(symbol, timeframe, candleFetchLimit)

        if (cancelled) return

        setHistoricalCandles(candles)
        setStatus(candles.length > 0 ? 'loaded' : 'empty')
      } catch (error) {
        console.error('Historical candle fetch error:', error)

        if (!cancelled) {
          setHistoricalCandles([])
          setStatus('error')
        }
      }
    }

    loadCandles()

    return () => {
      cancelled = true
    }
  }, [symbol, timeframe, compact, allowCompactHistory, candleFetchLimit])

  useEffect(() => {
    if (compact || !enableAdvancedOverlays) {
      setEngineState(null)
      setEngineStatus('idle')
      return
    }

    let cancelled = false

    async function loadEngineState() {
      setEngineStatus('loading')

      try {
        const state = await fetchEngineState(symbol, timeframe, engineFetchLimit)

        if (cancelled) return

        if (state && engineMatchesSelection(state, symbol, timeframe)) {
          setEngineState(state)
          setEngineStatus('loaded')
        } else {
          setEngineState(null)
          setEngineStatus(state ? 'empty' : 'error')
        }
      } catch (error) {
        console.error('Engine state fetch error:', error)

        if (!cancelled) {
          setEngineState(null)
          setEngineStatus('error')
        }
      }
    }

    loadEngineState()
    const intervalId = window.setInterval(loadEngineState, 15000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [symbol, timeframe, compact, enableAdvancedOverlays, engineFetchLimit])

  const liveCandlesFromCandlesEndpoint = useMemo(
    () => buildCandlesFromRecentCandles(recentCandles, symbol, timeframe),
    [recentCandles, symbol, timeframe]
  )

  const liveCandlesFromSignalsEndpoint = useMemo(
    () => buildCandlesFromSignals(recentSignals, symbol, timeframe),
    [recentSignals, symbol, timeframe]
  )

  const candles = useMemo(() => {
    // Historical / Render backend is the base.
    // Recent signals/candles are only merged when their symbol + timeframe are explicit matches.
    return mergeCandlesByTime([
      ...historicalCandles,
      ...liveCandlesFromCandlesEndpoint,
      ...liveCandlesFromSignalsEndpoint,
    ])
  }, [historicalCandles, liveCandlesFromCandlesEndpoint, liveCandlesFromSignalsEndpoint])

  const currentEngineState = engineMatchesSelection(engineState, symbol, timeframe) ? engineState : null

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
      engineState: currentEngineState,
      compact,
      loading: status === 'loading',
      enableAdvancedOverlays,
      smcDisplayMode,
      showSmc,
      showDlm,
      showZones,
      showLiquidity,
      showScores,
      showGhost,
      showProfile,
    })

    chartInstance.current.setOption(option, {
      notMerge: true,
      lazyUpdate: false,
    })

    const resize = () => chartInstance.current?.resize()
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
    }
  }, [
    symbol,
    timeframe,
    candleMode,
    candles,
    currentEngineState,
    compact,
    status,
    enableAdvancedOverlays,
    smcDisplayMode,
    showSmc,
    showDlm,
    showZones,
    showLiquidity,
    showScores,
    showGhost,
    showProfile,
  ])

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose()
      chartInstance.current = null
    }
  }, [])

  const activeCandleRange = useMemo(() => getCandlePriceRange(candles), [candles])
  const overlayDiagnostics = useMemo(
    () => buildOverlayData(currentEngineState, candles, smcDisplayMode === 'Full'),
    [currentEngineState, candles, smcDisplayMode]
  )

  const statusBadge =
    status === 'loading'
      ? 'Loading Candles'
      : status === 'loaded'
        ? `${candles.length} Candles`
        : status === 'empty'
          ? 'No Candles'
          : status === 'error'
            ? 'Candle Error'
            : 'Ready'

  const engineBadge =
    engineStatus === 'loading'
      ? 'Loading Engine'
      : engineStatus === 'loaded'
        ? 'SMC + AlphaX Live'
        : engineStatus === 'empty'
          ? 'Engine Waiting'
          : engineStatus === 'error'
            ? 'Engine Error'
            : 'Engine Ready'

  const providerBadge =
    currentEngineState?.source?.dataProvider ??
    historicalCandles[historicalCandles.length - 1]?.provider ??
    (isFuturesSymbol(symbol) ? 'InsightSentry' : 'Alpaca')

  return (
    <div className={`flex ${heightClass} w-full flex-col overflow-hidden rounded-2xl border border-dark-700 bg-[#0f1115]`}>
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dark-700 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full bg-orange-500 px-2 py-1 text-xs font-bold text-white">
              ₿
            </div>

            {chartTitle && <span className="text-xs font-semibold text-gray-300">{chartTitle}</span>}

            <select
              value={symbol}
              onChange={(event) => setSymbol(normalizeDefaultSymbol(event.target.value, symbol))}
              className="rounded-md border border-dark-700 bg-[#151922] px-3 py-1.5 text-sm text-gray-100 outline-none"
            >
              {symbolOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <select
              value={timeframe}
              onChange={(event) => setTimeframe(normalizeDefaultTimeframe(event.target.value, timeframe))}
              className="rounded-md border border-dark-700 bg-[#151922] px-3 py-1.5 text-sm text-gray-100 outline-none"
            >
              {timeframeOptions.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>

            <select
              value={candleMode}
              onChange={(event) => setCandleMode(event.target.value as CandleMode)}
              className="rounded-md border border-dark-700 bg-[#151922] px-3 py-1.5 text-sm text-gray-100 outline-none"
            >
              {candleModeOptions.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>

            <select
              value={smcDisplayMode}
              onChange={(event) => setSmcDisplayMode(event.target.value as SmcDisplayMode)}
              className="rounded-md border border-dark-700 bg-[#151922] px-3 py-1.5 text-sm text-gray-100 outline-none"
            >
              <option value="Clean">Clean</option>
              <option value="Full">Full</option>
              <option value="Structure Only">Structure Only</option>
              <option value="Zones Only">Zones Only</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className={`rounded-full border px-3 py-1 text-sm ${status === 'loaded' ? 'border-emerald-500/50 text-emerald-400' : 'border-yellow-500/50 text-yellow-400'}`}>
              {statusBadge}
            </div>

            <div className={`rounded-full border px-3 py-1 text-sm ${engineStatus === 'loaded' ? 'border-cyan-500/50 text-cyan-400' : 'border-slate-500/50 text-slate-300'}`}>
              {engineBadge}
            </div>

            <div className="rounded-full border border-slate-500/50 px-3 py-1 text-sm text-slate-300">
              {providerBadge}
            </div>

            <div className="rounded-full border border-slate-500/50 px-3 py-1 text-sm text-slate-300">
              Chart v3AS
            </div>
          </div>
        </div>
      )}

      {!compact && (
        <div className="flex flex-wrap items-center gap-2 border-b border-dark-700 bg-[#111827]/60 px-4 py-2 text-xs text-gray-300">
          <button
            type="button"
            onClick={() => setShowSmc((value) => !value)}
            className={`rounded-md border px-2 py-1 ${showSmc ? 'border-emerald-500/50 text-emerald-400' : 'border-dark-600 text-gray-500'}`}
          >
            SMC
          </button>

          <button
            type="button"
            onClick={() => setShowDlm((value) => !value)}
            className={`rounded-md border px-2 py-1 ${showDlm ? 'border-blue-500/50 text-blue-400' : 'border-dark-600 text-gray-500'}`}
          >
            DLM
          </button>

          <button
            type="button"
            onClick={() => setShowZones((value) => !value)}
            className={`rounded-md border px-2 py-1 ${showZones ? 'border-purple-500/50 text-purple-400' : 'border-dark-600 text-gray-500'}`}
          >
            Zones
          </button>

          <button
            type="button"
            onClick={() => setShowLiquidity((value) => !value)}
            className={`rounded-md border px-2 py-1 ${showLiquidity ? 'border-yellow-500/50 text-yellow-400' : 'border-dark-600 text-gray-500'}`}
          >
            Liquidity
          </button>

          <button
            type="button"
            onClick={() => setShowScores((value) => !value)}
            className={`rounded-md border px-2 py-1 ${showScores ? 'border-orange-500/50 text-orange-400' : 'border-dark-600 text-gray-500'}`}
          >
            Scores
          </button>

          <button
            type="button"
            onClick={() => setShowGhost((value) => !value)}
            className={`rounded-md border px-2 py-1 ${showGhost ? 'border-pink-500/50 text-pink-400' : 'border-dark-600 text-gray-500'}`}
          >
            Ghost
          </button>

          <button
            type="button"
            onClick={() => setShowProfile((value) => !value)}
            className={`rounded-md border px-2 py-1 ${showProfile ? 'border-cyan-500/50 text-cyan-400' : 'border-dark-600 text-gray-500'}`}
          >
            AlphaX Profile
          </button>

          <span className="ml-auto text-[11px] text-gray-500">
            Range {activeCandleRange.hasRange ? `${activeCandleRange.min.toFixed(2)} - ${activeCandleRange.max.toFixed(2)}` : 'n/a'}
            {' '}· Filtered overlays {overlayDiagnostics.rejectedOverlayCount}
          </span>
        </div>
      )}

      <div ref={chartRef} className="h-full w-full flex-1" />
    </div>
  )
}
