'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts'


const DEFAULT_VISIBLE_CANDLES = 90
const FUTURES_DEFAULT_VISIBLE_CANDLES = 120

function getDefaultVisibleCandleCount(symbol: string) {
  const normalized = normalizeSymbol(symbol)

  if (
    normalized.includes('MES') ||
    normalized.includes('ES1') ||
    normalized.includes('MNQ') ||
    normalized.includes('NQ1')
  ) {
    return FUTURES_DEFAULT_VISIBLE_CANDLES
  }

  return DEFAULT_VISIBLE_CANDLES
}

function buildInitialDataZoom(count: number, symbol: string) {
  const visible = Math.min(getDefaultVisibleCandleCount(symbol), Math.max(count, 1))
  const startValue = Math.max(0, count - visible)
  const endValue = Math.max(0, count - 1)

  return {
    startValue,
    endValue,
  }
}


type Candle = {
  time: string
  open: number
  close: number
  low: number
  high: number
  volume?: number
}

type GhostCandle = {
  slot: string
  label: string
  open: number
  close: number
  low: number
  high: number
  confidence: number
  direction: 'bullish' | 'bearish' | 'neutral'
  source?: 'python' | 'chart'
}

type CandleMode = 'Regular' | 'Heikin Ashi'
type SmcDisplayMode = 'Clean' | 'Full' | 'Structure Only' | 'Zones Only'

type SmcStructureEvent = {
  time: string
  fromTime?: string
  price: number
  tag: string
  direction: 'bullish' | 'bearish'
  scope?: 'internal' | 'swing'
}

type DlmLevel = {
  label: string
  price: number
  direction: 'neutral' | 'bullish' | 'bearish'
  kind?: string
}

type SmcZone = {
  startTime: string
  endTime: string
  top: number
  bottom: number
  label: string
  direction: 'bullish' | 'bearish' | 'neutral'
  kind: string
}

type LiquidityEvent = {
  time: string
  fromTime?: string
  price: number
  label: string
  direction: 'bullish' | 'bearish' | 'neutral'
  kind: string
  touches?: number
}

type DlmConfluenceMarker = {
  time: string
  price: number
  label: string
  direction: 'bullish' | 'bearish' | 'neutral'
  kind: string
  pressurePct?: number
}

type ScoreMarker = {
  time: string
  price: number
  label: string
  direction: 'bullish' | 'bearish' | 'neutral'
  kind: string
  score?: number
  grade?: 'A' | 'B' | 'C'
}

type AlphaProfileBin = {
  index: number
  top: number
  bottom: number
  mid: number
  volume?: number
  buyVolume?: number
  sellVolume?: number
  widthPct: number
  buyWidthPct?: number
  sellWidthPct?: number
  isPoc?: boolean
  isBuyLiquidity?: boolean
  isSellLiquidity?: boolean
  direction?: 'bullish' | 'bearish' | 'neutral'
  dominantSide?: 'bullish' | 'bearish' | 'neutral'
  label?: string
}

type ChartOverlayPayload = {
  smcEvents?: SmcStructureEvent[]
  dlmLevels?: DlmLevel[]
  zones?: SmcZone[]
  liquidityEvents?: LiquidityEvent[]
  dlmConfluenceMarkers?: DlmConfluenceMarker[]
  scoreMarkers?: ScoreMarker[]
}

type EngineState = ChartOverlayPayload & {
  engine?: string
  phase?: string
  status?: string
  candles?: any[]
  heikinAshiCandles?: any[]
  alphaProfileBins?: AlphaProfileBin[]
  alphaProfileMeta?: any
  alphaFvgs?: SmcZone[]
  alphaSweeps?: LiquidityEvent[]
  ghostCandles?: any[]
  ghostProjections?: any[]
  projections?: any[]
  alphaBullPressure?: number
  alphaBearPressure?: number
  signal?: string
  confidence?: number
  bullScore?: number
  bearScore?: number
  netBias?: number
  price?: number
  source?: any
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

const GREEN = '#089981'
const RED = '#F23645'
const BLUE = '#2157f3'
const TEAL = '#26a69a'
const LIGHT_RED = '#ff4d5e'
const YELLOW = '#facc15'
const PURPLE = '#a855f7'
const CYAN = '#22d3ee'
const ORANGE = '#fb923c'
const PINK = '#f472b6'
const GRAY = '#94a3b8'

const MAX_INTERNAL_OB_ZONES = 4
const MAX_SWING_OB_ZONES = 2
const MAX_FVG_ZONES = 2
const MAX_ALPHA_FVG_ZONES = 1
const MAX_GENERIC_ZONES = 2
const MAX_ZONE_LOOKBACK_CANDLES = 180
const MAX_CLEAN_STRUCTURE_EVENTS = 18
const MAX_FULL_STRUCTURE_EVENTS = 60
const MAX_CLEAN_LIQUIDITY_EVENTS = 10
const MAX_FULL_LIQUIDITY_EVENTS = 40
const MAX_CLEAN_SCORE_MARKERS = 2
const MAX_FULL_SCORE_MARKERS = 12

// Reserved empty x-axis space between live candles and the right liquidity profile.
// This keeps future Ghost Candles from colliding with AlphaX / liquidity profile bars.
const GHOST_CANDLE_RESERVED_SLOTS = 14
const GHOST_CANDLE_COUNT = 3
const RIGHT_PROFILE_SLOT_COUNT = 56
const SHOW_LIVE_PRICE_LINE = true

const API_BASE_URL = 'https://trading-intelligence-dashboard.onrender.com'

const timeframeOptions = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1D']
const candleModeOptions: CandleMode[] = ['Regular', 'Heikin Ashi']

const sampleCandles: Candle[] = [
  { time: '5/20 09:00', open: 76450, close: 76680, low: 76380, high: 76750 },
  { time: '5/20 10:00', open: 76680, close: 76520, low: 76420, high: 76720 },
  { time: '5/20 11:00', open: 76520, close: 76810, low: 76490, high: 76890 },
  { time: '5/20 12:00', open: 76810, close: 77020, low: 76720, high: 77100 },
  { time: '5/20 13:00', open: 77020, close: 76910, low: 76840, high: 77140 },
  { time: '5/20 14:00', open: 76910, close: 77280, low: 76860, high: 77340 },
  { time: '5/20 15:00', open: 77280, close: 77150, low: 77090, high: 77410 },
  { time: '5/20 16:00', open: 77150, close: 77520, low: 77080, high: 77610 },
  { time: '5/20 17:00', open: 77520, close: 77840, low: 77480, high: 77930 },
  { time: '5/20 18:00', open: 77840, close: 77660, low: 77580, high: 77910 },
  { time: '5/20 19:00', open: 77660, close: 77420, low: 77360, high: 77740 },
  { time: '5/20 20:00', open: 77420, close: 77180, low: 77090, high: 77500 },
  { time: '5/20 21:00', open: 77180, close: 76900, low: 76820, high: 77240 },
  { time: '5/20 22:00', open: 76900, close: 76640, low: 76550, high: 76980 },
  { time: '5/20 23:00', open: 76640, close: 76280, low: 76120, high: 76710 },
  { time: '5/21 00:00', open: 76280, close: 75940, low: 75840, high: 76320 },
  { time: '5/21 01:00', open: 75940, close: 75680, low: 75590, high: 76020 },
  { time: '5/21 02:00', open: 75680, close: 75420, low: 75380, high: 75760 },
  { time: '5/21 03:00', open: 75420, close: 75880, low: 75350, high: 75960 },
  { time: '5/21 04:00', open: 75880, close: 76240, low: 75810, high: 76380 },
  { time: '5/21 05:00', open: 76240, close: 76060, low: 75940, high: 76310 },
  { time: '5/21 06:00', open: 76060, close: 76580, low: 76020, high: 76690 },
]


function isCleanBaselineBtc(symbol: string) {
  const normalized = normalizeSymbol(symbol)
  return normalized === 'BTCUSD' || normalized === 'BTCUSDT'
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
  if (tf === 'd' || tf === '1d') return '1d'
  if (tf === 'w' || tf === '1w') return '1w'

  return tf
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

function isFuturesDashboardSymbol(value: any): boolean {
  const normalized = normalizeDefaultSymbol(value, '')
  return normalized === 'MES1!' || normalized === 'ES1!'
}

function normalizeDefaultTimeframe(value: any, fallback = '1m'): string {
  const normalized = normalizeTimeframe(value || fallback)
  return timeframeOptions.includes(normalized) ? normalized : fallback
}

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

function symbolsMatch(signalSymbolRaw: any, selectedSymbolRaw: any): boolean {
  const signalSymbol = normalizeSymbol(signalSymbolRaw)
  const selectedSymbol = normalizeSymbol(selectedSymbolRaw)

  if (!signalSymbol || !selectedSymbol) return false
  if (signalSymbol === selectedSymbol) return true

  if (selectedSymbol === 'MES1!' && signalSymbol.includes('MES')) return true
  if (selectedSymbol === 'ES1!' && signalSymbol.includes('ES')) return true
  if (selectedSymbol === 'BTCUSD' && signalSymbol.includes('BTC')) return true
  if (selectedSymbol === 'ETHUSD' && signalSymbol.includes('ETH')) return true
  if (selectedSymbol === 'SPY' && signalSymbol.includes('SPY')) return true

  return false
}

function toNumber(value: any): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatAxisTime(value: any, fallbackIndex: number): string {
  if (typeof value === 'string' && value.length > 0) return value

  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value > 1000000000000 ? value : value * 1000
    const date = new Date(timestamp)

    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }

  return `Live ${fallbackIndex + 1}`
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

  return text.replace('__profile_', '')
}

function scaleCandlesForSymbol(candles: Candle[], symbol: string): Candle[] {
  const normalized = normalizeSymbol(symbol)

  if (normalized.includes('BTC')) return candles

  let targetBase = 6000
  let rangeMult = 0.002

  if (normalized.includes('ETH')) {
    targetBase = 3800
    rangeMult = 0.003
  } else if (normalized.includes('MES') || normalized.includes('ES')) {
    targetBase = 6000
    rangeMult = 0.0012
  } else if (normalized.includes('SPY')) {
    targetBase = 530
    rangeMult = 0.0018
  }

  const firstClose = candles[0]?.close ?? 1

  return candles.map((candle) => {
    const openRatio = (candle.open - firstClose) / firstClose
    const highRatio = (candle.high - firstClose) / firstClose
    const lowRatio = (candle.low - firstClose) / firstClose
    const closeRatio = (candle.close - firstClose) / firstClose

    return {
      time: candle.time,
      open: Number((targetBase * (1 + openRatio * rangeMult * 100)).toFixed(2)),
      high: Number((targetBase * (1 + highRatio * rangeMult * 100)).toFixed(2)),
      low: Number((targetBase * (1 + lowRatio * rangeMult * 100)).toFixed(2)),
      close: Number((targetBase * (1 + closeRatio * rangeMult * 100)).toFixed(2)),
    }
  })
}

function getSampleCandlesForSymbol(symbol: string): Candle[] {
  return scaleCandlesForSymbol(sampleCandles, symbol)
}

function candleFromAny(raw: any, index: number): Candle | null {
  const open = toNumber(raw?.open)
  const high = toNumber(raw?.high)
  const low = toNumber(raw?.low)
  const close = toNumber(raw?.close)

  if (open === null || high === null || low === null || close === null) return null

  return {
    time: formatAxisTime(raw?.time ?? raw?.timestamp ?? raw?.createdAt, index),
    open,
    high,
    low,
    close,
    volume: toNumber(raw?.volume) ?? undefined,
  }
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
      const timeframeMatch =
        normalizeTimeframe(candle.timeframe) === normalizedTimeframe ||
        !candle.timeframe

      return symbolsMatch(candle.symbol, selectedSymbol) && timeframeMatch
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
      const timeframeMatch =
        normalizeTimeframe(signal.timeframe) === normalizedTimeframe ||
        !signal.timeframe

      return symbolsMatch(signal.symbol, selectedSymbol) && timeframeMatch
    })
    .map((signal, index) => {
      const open = toNumber(signal.open)
      const high = toNumber(signal.high)
      const low = toNumber(signal.low)
      const close =
        toNumber(signal.close) ??
        toNumber(signal.current) ??
        toNumber(signal.price)

      if (open === null || high === null || low === null || close === null) {
        return null
      }

      return {
        time: formatAxisTime(signal.time ?? signal.timestamp ?? signal.createdAt, index),
        open,
        high,
        low,
        close,
      }
    })
    .filter((candle): candle is Candle => candle !== null)
}

function mergeCandlesByTime(candles: Candle[]): Candle[] {
  const merged = new Map<string, Candle>()

  for (const candle of candles) {
    merged.set(candle.time, candle)
  }

  return Array.from(merged.values()).sort((a, b) => {
    const aTime = Date.parse(a.time)
    const bTime = Date.parse(b.time)

    if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime

    return a.time.localeCompare(b.time)
  })
}

function safeParseJson(value: any): any {
  if (!value) return null
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return null

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function extractOverlayPayload(latestSignal?: any): ChartOverlayPayload {
  const smcPayload = safeParseJson(latestSignal?.smc)
  const alphaxPayload = safeParseJson(latestSignal?.alphax)
  const chartPayload = safeParseJson(latestSignal?.chartOverlays)

  const merged = {
    ...(chartPayload && typeof chartPayload === 'object' ? chartPayload : {}),
    ...(smcPayload && typeof smcPayload === 'object' ? smcPayload : {}),
    ...(alphaxPayload && typeof alphaxPayload === 'object' ? alphaxPayload : {}),
  }

  return {
    smcEvents: Array.isArray(merged.smcEvents) ? merged.smcEvents : undefined,
    dlmLevels: Array.isArray(merged.dlmLevels) ? merged.dlmLevels : undefined,
    zones: Array.isArray(merged.zones) ? merged.zones : undefined,
    liquidityEvents: Array.isArray(merged.liquidityEvents)
      ? merged.liquidityEvents
      : undefined,
    dlmConfluenceMarkers: Array.isArray(merged.dlmConfluenceMarkers)
      ? merged.dlmConfluenceMarkers
      : undefined,
    scoreMarkers: Array.isArray(merged.scoreMarkers) ? merged.scoreMarkers : undefined,
  }
}

function convertToHeikinAshi(candles: Candle[]): Candle[] {
  if (candles.length === 0) return []

  const haCandles: Candle[] = []

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const haClose = (c.open + c.high + c.low + c.close) / 4
    const haOpen =
      i === 0
        ? (c.open + c.close) / 2
        : (haCandles[i - 1].open + haCandles[i - 1].close) / 2
    const haHigh = Math.max(c.high, haOpen, haClose)
    const haLow = Math.min(c.low, haOpen, haClose)

    haCandles.push({
      time: c.time,
      open: Number(haOpen.toFixed(2)),
      close: Number(haClose.toFixed(2)),
      low: Number(haLow.toFixed(2)),
      high: Number(haHigh.toFixed(2)),
      volume: c.volume,
    })
  }

  return haCandles
}

function getStructureColor(direction: 'bullish' | 'bearish') {
  return direction === 'bullish' ? GREEN : RED
}

function getDlmColor(direction: DlmLevel['direction']) {
  if (direction === 'bullish') return GREEN
  if (direction === 'bearish') return RED
  return BLUE
}

function getLiquidityColor(event: LiquidityEvent) {
  if (event.kind === 'inducement') return YELLOW
  if (event.kind === 'liquidity_pool') return PURPLE
  if (event.direction === 'bullish') return GREEN
  if (event.direction === 'bearish') return RED
  return BLUE
}

function getDlmConfluenceColor(marker: DlmConfluenceMarker) {
  if (marker.kind === 'poc_touch') return CYAN
  if (marker.kind === 'ob_confirm') return BLUE
  if (marker.kind === 'entry_confirm') return GREEN
  if (marker.direction === 'bullish') return GREEN
  if (marker.direction === 'bearish') return RED
  return CYAN
}

function getScoreColor(marker: ScoreMarker) {
  if (marker.kind === 'institutional_score') return ORANGE
  if (marker.kind === 'execution_quality') return PINK
  if (marker.kind === 'trend_phase') return PURPLE
  if (marker.kind === 'htf_bias') return CYAN
  if (marker.kind === 'session') return GRAY
  if (marker.direction === 'bullish') return GREEN
  if (marker.direction === 'bearish') return RED
  return YELLOW
}


function zoneTimeValue(value: any): number {
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function zonePriority(zone: SmcZone): number {
  if (zone.kind === 'premium') return 100
  if (zone.kind === 'equilibrium') return 99
  if (zone.kind === 'discount') return 98
  if (zone.kind === 'internal_ob') return 80
  if (zone.kind === 'swing_ob') return 70
  if (zone.kind === 'fvg') return 55
  if (zone.kind === 'alpha_fvg') return 45
  return 20
}

function normalizeZoneKind(kind: string): string {
  const text = String(kind ?? '').toLowerCase()

  if (text.includes('premium')) return 'premium'
  if (text.includes('equilibrium')) return 'equilibrium'
  if (text === 'eq' || text.includes('eq_')) return 'equilibrium'
  if (text.includes('discount')) return 'discount'
  if (text.includes('swing') && text.includes('ob')) return 'swing_ob'
  if (text.includes('internal') && text.includes('ob')) return 'internal_ob'
  if (text.includes('alpha') && text.includes('fvg')) return 'alpha_fvg'
  if (text.includes('fvg')) return 'fvg'
  if (text.includes('ob')) return 'internal_ob'

  return text
}

function normalizeZone(zone: SmcZone): SmcZone | null {
  const top = Number(zone.top)
  const bottom = Number(zone.bottom)

  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null

  const normalizedTop = Math.max(top, bottom)
  const normalizedBottom = Math.min(top, bottom)

  if (normalizedTop === normalizedBottom) return null

  const kind = normalizeZoneKind(zone.kind)

  return {
    ...zone,
    kind,
    top: normalizedTop,
    bottom: normalizedBottom,
    direction:
      zone.direction === 'bullish' || zone.direction === 'bearish'
        ? zone.direction
        : kind === 'premium'
          ? 'bearish'
          : kind === 'discount'
            ? 'bullish'
            : 'neutral',
    label:
      zone.label ||
      (kind === 'premium'
        ? 'Premium'
        : kind === 'equilibrium'
          ? 'Equilibrium'
          : kind === 'discount'
            ? 'Discount'
            : kind === 'internal_ob'
              ? zone.direction === 'bullish'
                ? 'Internal Bullish OB'
                : 'Internal Bearish OB'
              : kind === 'swing_ob'
                ? zone.direction === 'bullish'
                  ? 'Swing Bullish OB'
                  : 'Swing Bearish OB'
                : kind === 'alpha_fvg'
                  ? 'AlphaX FVG'
                  : 'FVG'),
  }
}

function getZoneEndTime(zone: SmcZone): number {
  return zoneTimeValue(zone.endTime || zone.startTime)
}

function filterZonesPineStyle(
  zones: SmcZone[],
  candles: Candle[],
  compact: boolean,
  displayMode: SmcDisplayMode
): SmcZone[] {
  if (!Array.isArray(zones) || zones.length === 0) return []
  if (compact || displayMode === 'Structure Only') return []

  const normalized = zones
    .map(normalizeZone)
    .filter((zone): zone is SmcZone => zone !== null)

  if (normalized.length === 0) return []

  const candleTimes = candles.map((candle) => candle.time)
  const recentTimeSet = new Set(
    candleTimes.slice(Math.max(0, candleTimes.length - MAX_ZONE_LOOKBACK_CANDLES))
  )

  const firstRecentMs = zoneTimeValue(
    candleTimes[Math.max(0, candleTimes.length - MAX_ZONE_LOOKBACK_CANDLES)]
  )
  const lastMs = zoneTimeValue(candleTimes[candleTimes.length - 1])

  const isCurrentEnough = (zone: SmcZone) => {
    if (recentTimeSet.has(zone.startTime) || recentTimeSet.has(zone.endTime)) return true

    const startMs = zoneTimeValue(zone.startTime)
    const endMs = zoneTimeValue(zone.endTime)

    if (!firstRecentMs || !lastMs || !startMs || !endMs) return false

    return endMs >= firstRecentMs && startMs <= lastMs
  }

  const currentZones = normalized.filter(isCurrentEnough)

  const latestByKind = (kind: string, limit: number) =>
    currentZones
      .filter((zone) => zone.kind === kind)
      .sort((a, b) => getZoneEndTime(b) - getZoneEndTime(a))
      .slice(0, limit)

  const latestDirectional = (kind: string, perDirectionLimit: number) => {
    const bullish = currentZones
      .filter((zone) => zone.kind === kind && zone.direction === 'bullish')
      .sort((a, b) => getZoneEndTime(b) - getZoneEndTime(a))
      .slice(0, perDirectionLimit)

    const bearish = currentZones
      .filter((zone) => zone.kind === kind && zone.direction === 'bearish')
      .sort((a, b) => getZoneEndTime(b) - getZoneEndTime(a))
      .slice(0, perDirectionLimit)

    return [...bullish, ...bearish]
  }

  const pdZones = ['premium', 'equilibrium', 'discount']
    .map((kind) =>
      currentZones
        .filter((zone) => zone.kind === kind)
        .sort((a, b) => getZoneEndTime(b) - getZoneEndTime(a))[0]
    )
    .filter((zone): zone is SmcZone => Boolean(zone))

  const zoneMultiplier = displayMode === 'Full' ? 2 : 1

  const selected = [
    ...pdZones,
    ...latestDirectional('internal_ob', Math.ceil((MAX_INTERNAL_OB_ZONES * zoneMultiplier) / 2)),
    ...latestDirectional('swing_ob', Math.ceil((MAX_SWING_OB_ZONES * zoneMultiplier) / 2)),
    ...latestByKind('fvg', MAX_FVG_ZONES * zoneMultiplier),
    ...latestByKind('alpha_fvg', MAX_ALPHA_FVG_ZONES * zoneMultiplier),
    ...currentZones
      .filter(
        (zone) =>
          ![
            'premium',
            'equilibrium',
            'discount',
            'internal_ob',
            'swing_ob',
            'fvg',
            'alpha_fvg',
          ].includes(zone.kind)
      )
      .sort((a, b) => getZoneEndTime(b) - getZoneEndTime(a))
      .slice(0, MAX_GENERIC_ZONES * zoneMultiplier),
  ]

  const deduped = new Map<string, SmcZone>()

  for (const zone of selected) {
    const key = [
      zone.kind,
      zone.direction,
      Math.round(zone.top * 100) / 100,
      Math.round(zone.bottom * 100) / 100,
      zone.startTime,
    ].join('|')

    if (!deduped.has(key)) deduped.set(key, zone)
  }

  return Array.from(deduped.values()).sort((a, b) => {
    const priorityDiff = zonePriority(b) - zonePriority(a)
    if (priorityDiff !== 0) return priorityDiff
    return getZoneEndTime(a) - getZoneEndTime(b)
  })
}

function shouldShowZoneLabel(zone: SmcZone, compact: boolean, displayMode: SmcDisplayMode): boolean {
  if (compact) return false
  if (displayMode === 'Clean') {
    return zone.kind === 'premium' || zone.kind === 'equilibrium' || zone.kind === 'discount'
  }

  return (
    zone.kind === 'premium' ||
    zone.kind === 'equilibrium' ||
    zone.kind === 'discount' ||
    zone.kind === 'internal_ob' ||
    zone.kind === 'swing_ob'
  )
}

function eventTimeValue(value: any): number {
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function isMajorStructureEvent(event: SmcStructureEvent): boolean {
  const tag = String(event.tag ?? '').toUpperCase()
  return (
    event.scope === 'swing' ||
    tag === 'BOS' ||
    tag === 'CHOCH' ||
    tag === 'MSS' ||
    tag === 'IBOS' ||
    tag === 'ICHOCH'
  )
}

function filterSmcEventsForDisplay(
  events: SmcStructureEvent[],
  displayMode: SmcDisplayMode,
  compact: boolean
): SmcStructureEvent[] {
  if (!Array.isArray(events) || compact || displayMode === 'Zones Only') return []

  const sorted = [...events].sort((a, b) => eventTimeValue(a.time) - eventTimeValue(b.time))
  const major = sorted.filter(isMajorStructureEvent)
  const source = displayMode === 'Full' ? sorted : major
  const limit = displayMode === 'Full' ? MAX_FULL_STRUCTURE_EVENTS : MAX_CLEAN_STRUCTURE_EVENTS

  return source.slice(-limit)
}

function isMajorLiquidityEvent(event: LiquidityEvent): boolean {
  return (
    event.kind === 'liquidity_pool' ||
    event.kind === 'sweep' ||
    event.kind === 'internal_sweep' ||
    event.kind === 'swing_sweep' ||
    event.kind === 'alpha_sweep'
  )
}

function filterLiquidityEventsForDisplay(
  events: LiquidityEvent[],
  displayMode: SmcDisplayMode,
  compact: boolean
): LiquidityEvent[] {
  if (!Array.isArray(events) || compact || displayMode === 'Structure Only') return []

  const sorted = [...events]
    .filter((event) => (displayMode === 'Full' ? true : isMajorLiquidityEvent(event)))
    .sort((a, b) => eventTimeValue(a.time || a.fromTime) - eventTimeValue(b.time || b.fromTime))

  const limit = displayMode === 'Full' ? MAX_FULL_LIQUIDITY_EVENTS : MAX_CLEAN_LIQUIDITY_EVENTS

  return sorted.slice(-limit)
}

function filterScoreMarkersForDisplay(
  markers: ScoreMarker[],
  displayMode: SmcDisplayMode,
  compact: boolean
): ScoreMarker[] {
  if (!Array.isArray(markers) || compact || displayMode !== 'Full') return []

  return [...markers]
    .sort((a, b) => eventTimeValue(a.time) - eventTimeValue(b.time))
    .slice(-MAX_FULL_SCORE_MARKERS)
}

function getZoneStyle(zone: SmcZone, compact: boolean) {
  if (zone.kind === 'premium') {
    return {
      color: compact ? 'rgba(242, 54, 69, 0.018)' : 'rgba(242, 54, 69, 0.035)',
      borderColor: 'rgba(242, 54, 69, 0.18)',
    }
  }

  if (zone.kind === 'equilibrium') {
    return {
      color: compact ? 'rgba(135, 139, 148, 0.015)' : 'rgba(135, 139, 148, 0.03)',
      borderColor: 'rgba(135, 139, 148, 0.14)',
    }
  }

  if (zone.kind === 'discount') {
    return {
      color: compact ? 'rgba(8, 153, 129, 0.018)' : 'rgba(8, 153, 129, 0.035)',
      borderColor: 'rgba(8, 153, 129, 0.18)',
    }
  }

  if (zone.kind === 'fvg' || zone.kind === 'alpha_fvg') {
    return zone.direction === 'bullish'
      ? {
          color: compact ? 'rgba(0, 255, 104, 0.020)' : 'rgba(0, 255, 104, 0.040)',
          borderColor: 'rgba(0, 255, 104, 0.18)',
        }
      : {
          color: compact ? 'rgba(255, 0, 8, 0.020)' : 'rgba(255, 0, 8, 0.040)',
          borderColor: 'rgba(255, 0, 8, 0.18)',
        }
  }

  if (zone.kind === 'swing_ob') {
    return zone.direction === 'bullish'
      ? {
          color: compact ? 'rgba(24, 72, 204, 0.040)' : 'rgba(24, 72, 204, 0.065)',
          borderColor: 'rgba(24, 72, 204, 0.32)',
        }
      : {
          color: compact ? 'rgba(178, 40, 51, 0.040)' : 'rgba(178, 40, 51, 0.065)',
          borderColor: 'rgba(178, 40, 51, 0.32)',
        }
  }

  return zone.direction === 'bullish'
    ? {
        color: compact ? 'rgba(49, 121, 245, 0.040)' : 'rgba(49, 121, 245, 0.065)',
        borderColor: 'rgba(49, 121, 245, 0.32)',
      }
    : {
        color: compact ? 'rgba(247, 124, 128, 0.040)' : 'rgba(247, 124, 128, 0.065)',
        borderColor: 'rgba(247, 124, 128, 0.32)',
      }
}

function buildSmcMarkLines(events: SmcStructureEvent[]) {
  return events
    .filter((event) => event.fromTime)
    .map((event) => {
      const color = getStructureColor(event.direction)

      return [
        {
          coord: [event.fromTime, event.price],
          lineStyle: {
            color,
            width: event.scope === 'swing' ? 2 : 1,
            type: event.scope === 'swing' ? 'solid' : 'dashed',
          },
          symbol: 'none',
        },
        {
          coord: [event.time, event.price],
          symbol: 'none',
          label: {
            show: true,
            formatter: event.tag,
            color,
            fontSize: event.scope === 'swing' ? 11 : 10,
            fontWeight: 700,
            backgroundColor: 'rgba(15, 17, 21, 0.88)',
            borderColor: color,
            borderWidth: 1,
            borderRadius: 4,
            padding: [3, 6],
          },
        },
      ]
    })
}

function buildSmcMarkPoints(events: SmcStructureEvent[], compact: boolean) {
  return events.map((event) => {
    const color = getStructureColor(event.direction)
    const isTopLabel =
      event.direction === 'bearish' ||
      event.tag === 'HH' ||
      event.tag === 'LH' ||
      event.tag === 'CHoCH' ||
      event.tag === 'iCHoCH'

    return {
      name: event.tag,
      coord: [event.time, event.price],
      value: event.tag,
      symbol: 'pin',
      symbolSize: compact ? 24 : 34,
      symbolRotate: isTopLabel ? 0 : 180,
      itemStyle: {
        color: 'rgba(15, 17, 21, 0.95)',
        borderColor: color,
        borderWidth: 1,
      },
      label: {
        show: true,
        formatter: event.tag,
        color,
        fontSize: compact ? 8 : 9,
        fontWeight: 700,
      },
    }
  })
}

function buildDlmMarkLines(levels: DlmLevel[], compact: boolean) {
  return levels.map((level) => {
    const color = getDlmColor(level.direction)

    return {
      yAxis: level.price,
      name: level.label,
      symbol: 'none',
      lineStyle: {
        color,
        width: level.direction === 'neutral' ? 2 : 1,
        type: level.direction === 'neutral' ? 'solid' : 'dashed',
        opacity: level.direction === 'neutral' ? 0.8 : 0.55,
      },
      label: {
        show: !compact,
        formatter: level.label,
        color,
        fontSize: 10,
        fontWeight: 700,
        position: 'end',
        backgroundColor: 'rgba(15, 17, 21, 0.88)',
        borderColor: color,
        borderWidth: 1,
        borderRadius: 4,
        padding: [3, 6],
      },
    }
  })
}

function buildZoneMarkAreas(zones: SmcZone[], compact: boolean, displayMode: SmcDisplayMode) {
  return zones.map((zone) => {
    const style = getZoneStyle(zone, compact)
    const showLabel = shouldShowZoneLabel(zone, compact, displayMode)

    return [
      {
        xAxis: zone.startTime,
        yAxis: zone.top,
        itemStyle: {
          color: style.color,
          borderColor: style.borderColor,
          borderWidth: zone.kind === 'swing_ob' ? 1.2 : zone.kind === 'internal_ob' ? 1 : 0.8,
          borderType: zone.kind === 'fvg' || zone.kind === 'alpha_fvg' ? 'dashed' : 'solid',
        },
        label: {
          show: showLabel,
          formatter: zone.label,
          color: style.borderColor,
          fontSize: displayMode === 'Clean' ? 8 : 9,
          fontWeight: 700,
          position:
            zone.kind === 'premium'
              ? 'insideTop'
              : zone.kind === 'discount'
                ? 'insideBottom'
                : zone.kind === 'equilibrium'
                  ? 'inside'
                  : 'insideTopLeft',
          backgroundColor: 'rgba(15, 17, 21, 0.42)',
          borderRadius: 4,
          padding: [2, 5],
        },
      },
      {
        xAxis: zone.endTime,
        yAxis: zone.bottom,
      },
    ]
  })
}

function buildLiquidityMarkLines(events: LiquidityEvent[], compact: boolean) {
  return events
    .filter(
      (event) =>
        event.kind === 'eqh' ||
        event.kind === 'eql' ||
        event.kind === 'liquidity_pool'
    )
    .map((event) => {
      const color = getLiquidityColor(event)

      if (event.fromTime) {
        return [
          {
            coord: [event.fromTime, event.price],
            lineStyle: {
              color,
              width: event.kind === 'liquidity_pool' ? 2 : 1,
              type: event.kind === 'liquidity_pool' ? 'dashed' : 'dotted',
              opacity: event.kind === 'liquidity_pool' ? 0.7 : 0.85,
            },
            symbol: 'none',
          },
          {
            coord: [event.time, event.price],
            symbol: 'none',
            label: {
              show: !compact,
              formatter:
                event.touches && event.touches > 1
                  ? `${event.label} x${event.touches}`
                  : event.label,
              color,
              fontSize: 10,
              fontWeight: 700,
              backgroundColor: 'rgba(15, 17, 21, 0.88)',
              borderColor: color,
              borderWidth: 1,
              borderRadius: 4,
              padding: [3, 6],
            },
          },
        ]
      }

      return {
        yAxis: event.price,
        name: event.label,
        symbol: 'none',
        lineStyle: {
          color,
          width: 1.5,
          type: 'dashed',
          opacity: 0.65,
        },
        label: {
          show: !compact,
          formatter:
            event.touches && event.touches > 1
              ? `${event.label} x${event.touches}`
              : event.label,
          color,
          fontSize: 10,
          fontWeight: 700,
          position: 'end',
          backgroundColor: 'rgba(15, 17, 21, 0.88)',
          borderColor: color,
          borderWidth: 1,
          borderRadius: 4,
          padding: [3, 6],
        },
      }
    })
}

function buildLiquidityMarkPoints(events: LiquidityEvent[], compact: boolean) {
  return events
    .filter(
      (event) =>
        event.kind === 'internal_sweep' ||
        event.kind === 'swing_sweep' ||
        event.kind === 'inducement' ||
        event.kind === 'sweep' ||
        event.kind === 'alpha_sweep'
    )
    .map((event) => {
      const color = getLiquidityColor(event)
      const isTopLabel = event.direction === 'bearish'

      return {
        name: event.label,
        coord: [event.time, event.price],
        value: event.label,
        symbol: event.kind === 'inducement' ? 'diamond' : 'pin',
        symbolSize: compact ? 24 : event.kind === 'inducement' ? 32 : 34,
        symbolRotate: isTopLabel ? 0 : 180,
        itemStyle: {
          color: 'rgba(15, 17, 21, 0.95)',
          borderColor: color,
          borderWidth: 1,
        },
        label: {
          show: true,
          formatter: event.label,
          color,
          fontSize: compact ? 8 : 9,
          fontWeight: 700,
        },
      }
    })
}

function buildDlmConfluenceMarkPoints(
  markers: DlmConfluenceMarker[],
  compact: boolean
) {
  return markers.map((marker) => {
    const color = getDlmConfluenceColor(marker)
    const isTopLabel = marker.direction === 'bearish'
    const pressureText =
      typeof marker.pressurePct === 'number' ? ` ${marker.pressurePct}%` : ''

    return {
      name: marker.label,
      coord: [marker.time, marker.price],
      value: `${marker.label}${pressureText}`,
      symbol: marker.kind === 'entry_confirm' ? 'triangle' : 'circle',
      symbolSize: compact ? 16 : marker.kind === 'entry_confirm' ? 22 : 18,
      symbolRotate: marker.direction === 'bearish' ? 180 : 0,
      itemStyle: {
        color,
        opacity: 0.95,
        borderColor: '#0f1115',
        borderWidth: 2,
      },
      label: {
        show: !compact,
        formatter: `${marker.label}${pressureText}`,
        color,
        fontSize: 10,
        fontWeight: 800,
        position: isTopLabel ? 'top' : 'bottom',
        backgroundColor: 'rgba(15, 17, 21, 0.88)',
        borderColor: color,
        borderWidth: 1,
        borderRadius: 4,
        padding: [3, 6],
      },
    }
  })
}

function buildScoreMarkPoints(markers: ScoreMarker[], compact: boolean) {
  return markers.map((marker) => {
    const color = getScoreColor(marker)
    const scoreText = typeof marker.score === 'number' ? ` ${marker.score}` : ''
    const gradeText = marker.grade ? ` ${marker.grade}` : ''
    const label = `${marker.label}${scoreText}${gradeText}`
    const isTopLabel = marker.direction === 'bearish' || marker.kind === 'session'

    return {
      name: marker.label,
      coord: [marker.time, marker.price],
      value: label,
      symbol:
        marker.kind === 'institutional_score'
          ? 'rect'
          : marker.kind === 'execution_quality'
            ? 'diamond'
            : marker.kind === 'trend_phase'
              ? 'roundRect'
              : 'circle',
      symbolSize:
        compact
          ? 18
          : marker.kind === 'institutional_score'
            ? 28
            : marker.kind === 'trend_phase'
              ? 26
              : 22,
      itemStyle: {
        color: 'rgba(15, 17, 21, 0.96)',
        borderColor: color,
        borderWidth: 2,
      },
      label: {
        show: !compact,
        formatter: label,
        color,
        fontSize: 10,
        fontWeight: 800,
        position: isTopLabel ? 'top' : 'bottom',
        backgroundColor: 'rgba(15, 17, 21, 0.90)',
        borderColor: color,
        borderWidth: 1,
        borderRadius: 4,
        padding: [3, 6],
      },
    }
  })
}


function averageRange(candles: Candle[], lookback = 20): number {
  if (candles.length === 0) return 1

  const slice = candles.slice(Math.max(0, candles.length - lookback))
  const total = slice.reduce((sum, candle) => sum + Math.max(candle.high - candle.low, 0), 0)
  const avg = total / Math.max(1, slice.length)

  return avg > 0 ? avg : Math.max(Math.abs(slice[slice.length - 1]?.close ?? 1) * 0.001, 1)
}

function averageCloseMomentum(candles: Candle[], lookback = 8): number {
  if (candles.length < 2) return 0

  const start = Math.max(1, candles.length - lookback)
  let weighted = 0
  let weightSum = 0

  for (let i = start; i < candles.length; i++) {
    const weight = i - start + 1
    weighted += (candles[i].close - candles[i - 1].close) * weight
    weightSum += weight
  }

  return weightSum > 0 ? weighted / weightSum : 0
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getGhostSlot(index: number, ghostSlots: string[]): string {
  // Space projected candles across the reserved ghost zone.
  // This prevents PY1/PY2/PY3 and their confidence badges from stacking too tightly.
  if (!ghostSlots.length) return `__ghost_gap_${index + 1}`

  const preferredIndexes = [1, 4, 7, 10, 12]
  const preferredIndex = preferredIndexes[index] ?? index * 3 + 1
  const safeIndex = Math.max(0, Math.min(ghostSlots.length - 1, preferredIndex))

  return ghostSlots[safeIndex]
}

function buildGhostCandlesFromChart(candles: Candle[], ghostSlots: string[]): GhostCandle[] {
  if (candles.length < 3 || ghostSlots.length === 0) return []

  const last = candles[candles.length - 1]
  const previous = candles[candles.length - 2]
  const range = averageRange(candles, 20)
  const momentum = averageCloseMomentum(candles, 8)
  const immediateBias = last.close - previous.close
  const directionSeed = momentum !== 0 ? momentum : immediateBias
  const baseDirection = directionSeed >= 0 ? 1 : -1
  const minBody = Math.max(range * 0.10, Math.abs(last.close) * 0.00004)
  const maxBody = Math.max(range * 0.75, minBody)

  let prevOpen = last.open
  let prevClose = last.close

  return ghostSlots.slice(0, GHOST_CANDLE_COUNT).map((slot, index) => {
    const decay = Math.pow(0.72, index)
    const sequenceOpen = (prevOpen + prevClose) / 2
    const rawMove = momentum * decay + baseDirection * range * 0.11 * decay
    const direction = rawMove >= 0 ? 1 : -1
    const bodySize = clampNumber(Math.abs(rawMove), minBody, maxBody)
    const sequenceClose = sequenceOpen + direction * bodySize

    const top = Math.max(sequenceOpen, sequenceClose)
    const bottom = Math.min(sequenceOpen, sequenceClose)
    const wickScale = 0.22 + index * 0.05
    const upperWick = range * wickScale * (direction < 0 ? 1.25 : 0.85)
    const lowerWick = range * wickScale * (direction > 0 ? 1.25 : 0.85)
    const high = top + upperWick
    const low = bottom - lowerWick
    const confidence = Math.round(clampNumber((Math.abs(momentum) / Math.max(range, 1e-9)) * 45 + 18 - index * 6, 4, 88))

    prevOpen = sequenceOpen
    prevClose = sequenceClose

    return {
      slot,
      label: `Ghost #${index + 1}`,
      open: Number(sequenceOpen.toFixed(4)),
      close: Number(sequenceClose.toFixed(4)),
      low: Number(low.toFixed(4)),
      high: Number(high.toFixed(4)),
      confidence,
      direction: direction > 0 ? 'bullish' : 'bearish',
    }
  })
}


function toFiniteNumber(value: any): number | null {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function normalizeGhostDirection(value: any, open: number, close: number): 'bullish' | 'bearish' | 'neutral' {
  const text = String(value ?? '').toLowerCase()

  if (text.includes('up') || text.includes('bull') || text.includes('buy') || text === '1') return 'bullish'
  if (text.includes('down') || text.includes('bear') || text.includes('sell') || text === '-1') return 'bearish'

  if (close > open) return 'bullish'
  if (close < open) return 'bearish'

  return 'neutral'
}

function buildGhostCandlesFromEngine(engineState: EngineState | null, ghostSlots: string[]): GhostCandle[] {
  if (!engineState || ghostSlots.length === 0) return []

  const rawGhosts = Array.isArray(engineState.ghostCandles)
    ? engineState.ghostCandles
    : Array.isArray(engineState.ghostProjections)
      ? engineState.ghostProjections
      : Array.isArray(engineState.projections)
        ? engineState.projections
        : []

  if (rawGhosts.length === 0) return []

  const normalizedGhosts: GhostCandle[] = []

  rawGhosts
    .slice(0, Math.min(GHOST_CANDLE_COUNT, ghostSlots.length))
    .forEach((ghost: any, index: number) => {
      const open =
        toFiniteNumber(ghost.open) ??
        toFiniteNumber(ghost.o) ??
        toFiniteNumber(ghost.ghostOpen) ??
        toFiniteNumber(ghost.projectedOpen)

      const high =
        toFiniteNumber(ghost.high) ??
        toFiniteNumber(ghost.h) ??
        toFiniteNumber(ghost.ghostHigh) ??
        toFiniteNumber(ghost.projectedHigh)

      const low =
        toFiniteNumber(ghost.low) ??
        toFiniteNumber(ghost.l) ??
        toFiniteNumber(ghost.ghostLow) ??
        toFiniteNumber(ghost.projectedLow)

      const close =
        toFiniteNumber(ghost.close) ??
        toFiniteNumber(ghost.c) ??
        toFiniteNumber(ghost.ghostClose) ??
        toFiniteNumber(ghost.projectedClose)

      if (open === null || high === null || low === null || close === null) return

      const confidenceRaw =
        toFiniteNumber(ghost.confidence) ??
        toFiniteNumber(ghost.percent) ??
        toFiniteNumber(ghost.probability) ??
        toFiniteNumber(ghost.score) ??
        0

      const confidence = Math.round(clampNumber(confidenceRaw, 0, 100))
      const direction = normalizeGhostDirection(ghost.direction ?? ghost.dir ?? ghost.signal, open, close)

      normalizedGhosts.push({
        slot: getGhostSlot(index, ghostSlots),
        label: String(ghost.label ?? `Python Ghost #${index + 1}`),
        open,
        high,
        low,
        close,
        confidence,
        direction,
        source: 'python',
      })
    })

  return normalizedGhosts
}

function buildGhostCandles(engineState: EngineState | null, candles: Candle[], ghostSlots: string[]): GhostCandle[] {
  const pythonGhosts = buildGhostCandlesFromEngine(engineState, ghostSlots)

  if (pythonGhosts.length > 0) return pythonGhosts

  return buildGhostCandlesFromChart(candles, ghostSlots).map((ghost) => ({
    ...ghost,
    source: 'chart' as const,
  }))
}

function buildGhostLiveMarker(latestClose: number | null, ghostGapSlots: string[], compact: boolean): any[] {
  if (latestClose === null || compact || ghostGapSlots.length === 0) return []

  return [
    {
      coord: [ghostGapSlots[0], latestClose],
      symbol: 'circle',
      symbolSize: 10,
      itemStyle: {
        color: '#22d3ee',
        borderColor: '#ffffff',
        borderWidth: 2,
        shadowBlur: 12,
        shadowColor: '#22d3ee',
      },
      label: {
        show: true,
        formatter: `⬤ LIVE ${Number(latestClose).toFixed(2)}`,
        color: '#22d3ee',
        fontSize: 10,
        fontWeight: 900,
        position: 'right',
        backgroundColor: 'rgba(15, 17, 21, 0.95)',
        borderColor: '#22d3ee',
        borderWidth: 1,
        borderRadius: 4,
        padding: [4, 7],
      },
    },
  ]
}

function buildGhostCandleSeries(ghostCandles: GhostCandle[], compact: boolean): any[] {
  if (!Array.isArray(ghostCandles) || ghostCandles.length === 0 || compact) return []

  const data = ghostCandles.map((ghost, index) => ({
    value: [
      ghost.slot,
      ghost.open,
      ghost.close,
      ghost.low,
      ghost.high,
      ghost.label,
      ghost.confidence,
      ghost.direction,
      index + 1,
      ghost.source ?? 'chart',
    ],
    ghost,
  }))

  return [
    {
      name: 'Ghost Candle Projection',
      type: 'custom',
      coordinateSystem: 'cartesian2d',
      silent: true,
      z: 20,
      data,
      renderItem: (_params: any, api: any) => {
        const slot = api.value(0)
        const open = Number(api.value(1))
        const close = Number(api.value(2))
        const low = Number(api.value(3))
        const high = Number(api.value(4))
        const confidence = Number(api.value(6))
        const direction = String(api.value(7))
        const ghostNumber = Number(api.value(8))
        const ghostSource = String(api.value(9) ?? 'chart')

        const xPoint = api.coord([slot, close])
        const highPoint = api.coord([slot, high])
        const lowPoint = api.coord([slot, low])
        const openPoint = api.coord([slot, open])
        const closePoint = api.coord([slot, close])
        const slotSize = api.size([1, 0])?.[0] ?? 12

        const candleWidth = Math.max(9, slotSize * 0.82)
        const bodyX = xPoint[0] - candleWidth / 2
        const bodyY = Math.min(openPoint[1], closePoint[1])
        const bodyHeight = Math.max(4, Math.abs(openPoint[1] - closePoint[1]))
        const bull = direction === 'bullish'

        const bodyColor = bull ? 'rgba(8, 153, 129, 0.74)' : 'rgba(242, 54, 69, 0.74)'
        const borderColor = bull ? 'rgba(38, 255, 180, 1)' : 'rgba(255, 82, 112, 1)'
        const wickColor = bull ? 'rgba(38, 255, 180, 0.96)' : 'rgba(255, 82, 112, 0.96)'
        const badgeColor = bull ? 'rgba(8, 153, 129, 0.95)' : 'rgba(242, 54, 69, 0.95)'

        const labelText = `${ghostSource === 'python' ? 'PY' : 'G'}${ghostNumber} ${confidence}%`

        // Keep the confidence badge locked directly above/below its own ghost candle.
        // Previous version shifted labelX right, making the percentage look one candle ahead.
        const labelX = xPoint[0]
        const labelYOffset = 22 + (Math.max(ghostNumber, 1) - 1) * 16
        const labelY = bull ? highPoint[1] - labelYOffset : lowPoint[1] + labelYOffset

        return {
          type: 'group',
          children: [
            {
              type: 'line',
              shape: {
                x1: xPoint[0],
                y1: highPoint[1],
                x2: xPoint[0],
                y2: lowPoint[1],
              },
              style: {
                stroke: wickColor,
                lineWidth: 2.6,
                lineDash: [5, 3],
                shadowBlur: 8,
                shadowColor: wickColor,
              },
            },
            {
              type: 'rect',
              shape: {
                x: bodyX,
                y: bodyY,
                width: candleWidth,
                height: bodyHeight,
                r: 2,
              },
              style: {
                fill: bodyColor,
                stroke: borderColor,
                lineWidth: 2.2,
                shadowBlur: 10,
                shadowColor: borderColor,
              },
            },
            {
              type: 'text',
              style: {
                text: labelText,
                x: labelX,
                y: labelY,
                fill: '#ffffff',
                backgroundColor: badgeColor,
                borderColor,
                borderWidth: 1,
                borderRadius: 4,
                padding: [3, 6],
                font: '900 10px sans-serif',
                align: 'center',
                verticalAlign: 'middle',
                shadowBlur: 6,
                shadowColor: 'rgba(0,0,0,0.7)',
              },
            },
            {
              type: 'text',
              style: {
                text: `${ghostSource === 'python' ? 'PY ' : ''}${bull ? 'UP' : 'DOWN'}`,
                x: xPoint[0],
                y: bull ? highPoint[1] - 38 : lowPoint[1] + 38,
                fill: borderColor,
                font: '800 9px sans-serif',
                align: 'center',
                verticalAlign: 'middle',
              },
            },
          ],
        }
      },
      encode: { x: 0, y: [1, 2, 3, 4] },
    },
  ]
}

function buildAlphaProfileSeries(
  alphaProfileBins: AlphaProfileBin[],
  profileSlots: string[],
  compact: boolean
): any[] {
  if (!Array.isArray(alphaProfileBins) || alphaProfileBins.length === 0 || profileSlots.length < 4) {
    return []
  }

  const maxSlot = profileSlots.length - 1

  const bars = alphaProfileBins
    .map((bin) => {
      const widthPct = Number(bin.widthPct ?? 0)
      const top = Number(bin.top)
      const bottom = Number(bin.bottom)
      const mid = Number(bin.mid)

      if (
        !Number.isFinite(widthPct) ||
        !Number.isFinite(top) ||
        !Number.isFinite(bottom) ||
        !Number.isFinite(mid)
      ) {
        return null
      }

      const widthSlots = Math.max(1, Math.min(maxSlot, Math.round((widthPct / 100) * maxSlot)))
      const startSlot = profileSlots[0]
      const endSlot = profileSlots[widthSlots]
      const direction = bin.direction === 'bullish' ? 'bullish' : 'bearish'
      const isPoc = Boolean(bin.isPoc)

      return {
        value: [
          startSlot,
          bottom,
          endSlot,
          top,
          mid,
          widthPct,
          bin.label ?? `${Math.round(widthPct)}%`,
        ],
        itemStyle: {
          color: isPoc
            ? 'rgba(255, 152, 0, 0.38)'
            : direction === 'bullish'
              ? 'rgba(8, 153, 129, 0.30)'
              : 'rgba(242, 54, 69, 0.30)',
          borderColor: isPoc
            ? 'rgba(255, 152, 0, 0.85)'
            : direction === 'bullish'
              ? 'rgba(8, 153, 129, 0.65)'
              : 'rgba(242, 54, 69, 0.65)',
          borderWidth: isPoc ? 1.5 : 0,
        },
        bin,
      }
    })
    .filter(Boolean)

  const labels = alphaProfileBins
    .filter((bin) => Number(bin.widthPct ?? 0) >= (compact ? 18 : 8) || bin.isPoc)
    .map((bin) => {
      const widthPct = Number(bin.widthPct ?? 0)
      const widthSlots = Math.max(1, Math.min(maxSlot, Math.round((widthPct / 100) * maxSlot)))
      const labelSlot = profileSlots[Math.min(maxSlot, widthSlots + 1)]
      const direction = bin.direction === 'bullish' ? 'bullish' : 'bearish'

      return {
        value: [labelSlot, Number(bin.mid), `${Math.round(widthPct)}%`],
        label: {
          show: !compact,
          formatter: `${Math.round(widthPct)}%`,
          color: bin.isPoc
            ? '#ff9800'
            : direction === 'bullish'
              ? '#22c7a9'
              : '#ff4d5e',
          fontSize: 10,
          fontWeight: 700,
          position: 'right',
        },
        itemStyle: { color: 'transparent' },
      }
    })

  return [
    {
      name: 'AlphaX DLM Profile',
      type: 'custom',
      coordinateSystem: 'cartesian2d',
      silent: true,
      z: 6,
      data: bars,
      renderItem: (_params: any, api: any) => {
        const x1 = api.value(0)
        const yBottom = api.value(1)
        const x2 = api.value(2)
        const yTop = api.value(3)

        const p1 = api.coord([x1, yBottom])
        const p2 = api.coord([x2, yTop])

        const x = p1[0]
        const y = p2[1]
        const width = Math.max(1, p2[0] - p1[0])
        const height = Math.max(1, p1[1] - p2[1])

        return {
          type: 'rect',
          shape: { x, y, width, height },
          style: api.style(),
        }
      },
      encode: { x: [0, 2], y: [1, 3] },
    },
    {
      name: 'AlphaX DLM Profile Labels',
      type: 'scatter',
      silent: true,
      z: 9,
      symbolSize: 1,
      data: labels,
      encode: { x: 0, y: 1 },
      label: {
        show: true,
        formatter: (params: any) => params?.data?.value?.[2] ?? '',
      },
    },
  ]
}

function preserveAxisZoom(option: any, chart: echarts.ECharts | null) {
  const previousOption = chart?.getOption?.() as any
  const previousZooms = Array.isArray(previousOption?.dataZoom)
    ? previousOption.dataZoom
    : []

  if (!Array.isArray(option.dataZoom) || previousZooms.length === 0) {
    return option
  }

  const getPreviousZoom = (id: string, index: number) => {
    return (
      previousZooms.find((zoom: any) => zoom?.id === id) ??
      previousZooms[index] ??
      null
    )
  }

  option.dataZoom = option.dataZoom.map((zoom: any, index: number) => {
    const previousZoom = getPreviousZoom(zoom?.id, index)

    if (!previousZoom) return zoom

    const preserved = { ...zoom }

    if (typeof previousZoom.start === 'number') preserved.start = previousZoom.start
    if (typeof previousZoom.end === 'number') preserved.end = previousZoom.end
    // Do not preserve startValue/endValue.
    // Those categorical locks caused the chart to stay pinned to a tiny live window
    // after MES1!/ES1! loaded the full InsightSentry historical array.

    return preserved
  })

  return option
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
  const initialCandleMode = candleModeOptions.includes(defaultCandleMode)
    ? defaultCandleMode
    : 'Heikin Ashi'

  const [symbol, setSymbol] = useState(initialSymbol)
  const cleanBaselineBtc = isCleanBaselineBtc(symbol)
  const [timeframe, setTimeframe] = useState(initialTimeframe)
  const [candleMode, setCandleMode] = useState<CandleMode>(initialCandleMode)

  useEffect(() => {
    onChartSelectionChange?.({
      symbol,
      timeframe,
      candleMode,
      compact,
      chartTitle,
    })
  }, [symbol, timeframe, candleMode, compact, chartTitle, onChartSelectionChange])

  const [showSmc, setShowSmc] = useState(true)
  const [showDlm, setShowDlm] = useState(true)
  const [showZones, setShowZones] = useState(true)
  const [showLiquidity, setShowLiquidity] = useState(true)
  const [showScores, setShowScores] = useState(true)
  const [showGhost, setShowGhost] = useState(true)
  const [smcDisplayMode, setSmcDisplayMode] = useState<SmcDisplayMode>('Clean')
  const [engineState, setEngineState] = useState<EngineState | null>(null)
  const [engineStatus, setEngineStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [historicalCandles, setHistoricalCandles] = useState<any[]>([])
  const [historicalStatus, setHistoricalStatus] = useState<'idle' | 'loading' | 'loaded' | 'unavailable' | 'error'>('idle')

  const isFuturesChart = isFuturesDashboardSymbol(symbol)
  const candleFetchLimit = isFuturesChart ? '300' : '5000'

  useEffect(() => {
    const nextSymbol = normalizeDefaultSymbol(
      defaultSymbol ?? (compact ? symbol : latestSignal?.symbol),
      compact ? symbol : 'BTCUSD'
    )

    if (nextSymbol && nextSymbol !== symbol) {
      setSymbol(nextSymbol)
    }
  }, [defaultSymbol, latestSignal?.symbol])

  useEffect(() => {
    const nextTimeframe = normalizeDefaultTimeframe(
      defaultTimeframe ?? (compact ? timeframe : latestSignal?.timeframe),
      timeframe || '1m'
    )

    if (nextTimeframe && nextTimeframe !== timeframe) {
      setTimeframe(nextTimeframe)
    }
  }, [defaultTimeframe, latestSignal?.timeframe])

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchEngineState() {
      if (compact || !enableAdvancedOverlays) return

      setEngineStatus((current) => (current === 'loaded' ? current : 'loading'))

      try {
        const params = new URLSearchParams({
          symbol,
          timeframe,
          limit: candleFetchLimit,
        })

        const response = await fetch(`${API_BASE_URL}/api/engine-state?${params.toString()}`, {
          cache: 'no-store',
        })

        if (!response.ok) {
          if (!cancelled) setEngineStatus('error')
          return
        }

        const json = await response.json()

        if (!cancelled) {
          setEngineState(json && typeof json === 'object' ? json : null)
          setEngineStatus('loaded')
        }
      } catch (error) {
        console.error('Engine-state fetch error:', error)

        if (!cancelled) setEngineStatus('error')
      }
    }

    fetchEngineState()
    intervalId = setInterval(fetchEngineState, 15000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [symbol, timeframe, compact, enableAdvancedOverlays, candleFetchLimit])

  useEffect(() => {
    let cancelled = false

    async function fetchHistoricalCandles() {
      if (compact && !allowCompactHistory) return

      setHistoricalStatus('loading')

      try {
        const params = new URLSearchParams({
          symbol,
          timeframe,
          limit: candleFetchLimit,
        })

        const response = await fetch(`${API_BASE_URL}/api/historical-candles?${params.toString()}`, {
          cache: 'no-store',
        })

        if (!response.ok) {
          if (!cancelled) {
            setHistoricalCandles([])
            setHistoricalStatus(response.status === 404 ? 'unavailable' : 'error')
          }
          return
        }

        const json = await response.json()

        if (!cancelled) {
          setHistoricalCandles(Array.isArray(json) ? json : [])
          setHistoricalStatus(Array.isArray(json) && json.length > 0 ? 'loaded' : 'unavailable')
        }
      } catch (error) {
        console.error('Historical candle fetch error:', error)

        if (!cancelled) {
          setHistoricalCandles([])
          setHistoricalStatus('error')
        }
      }
    }

    fetchHistoricalCandles()

    return () => {
      cancelled = true
    }
  }, [symbol, timeframe, compact, allowCompactHistory, candleFetchLimit])

  const engineCandles = useMemo(
    () =>
      Array.isArray(engineState?.candles)
        ? engineState.candles.map(candleFromAny).filter((candle): candle is Candle => candle !== null)
        : [],
    [engineState]
  )

  const engineHaCandles = useMemo(
    () =>
      Array.isArray(engineState?.heikinAshiCandles)
        ? engineState.heikinAshiCandles.map(candleFromAny).filter((candle): candle is Candle => candle !== null)
        : [],
    [engineState]
  )

  const liveCandlesFromCandlesEndpoint = useMemo(
    () => buildCandlesFromRecentCandles(recentCandles, symbol, timeframe),
    [recentCandles, symbol, timeframe]
  )

  const liveCandlesFromSignalsEndpoint = useMemo(
    () => buildCandlesFromSignals(recentSignals, symbol, timeframe),
    [recentSignals, symbol, timeframe]
  )

  const historicalCandlesFromAlpaca = useMemo(
    () => buildCandlesFromRecentCandles(historicalCandles, symbol, timeframe),
    [historicalCandles, symbol, timeframe]
  )

  const liveCandles = useMemo(() => {
    // Futures route rule:
    // MES1!/ES1! should come from InsightSentry-backed Python engine/history only.
    // Do not let TradingView alert candles or recent signal candles replace the historical array.
    if (isFuturesChart) {
      const futuresCandles = mergeCandlesByTime([
        ...historicalCandlesFromAlpaca,
        ...engineCandles,
      ])

      if (futuresCandles.length > 0) {
        return futuresCandles
      }
    }

    // Normal route rule:
    // Historical candles remain the base source.
    // Engine/live candles update or append, but do not wipe history.
    const primaryCandles = mergeCandlesByTime([
      ...historicalCandlesFromAlpaca,
      ...engineCandles,
      ...liveCandlesFromCandlesEndpoint,
    ])

    if (primaryCandles.length > 0) {
      return primaryCandles
    }

    return mergeCandlesByTime([
      ...liveCandlesFromSignalsEndpoint,
    ])
  }, [
    isFuturesChart,
    engineCandles,
    historicalCandlesFromAlpaca,
    liveCandlesFromCandlesEndpoint,
    liveCandlesFromSignalsEndpoint,
  ])

  const lastValidLiveCandlesRef = useRef<Candle[]>([])

  if (liveCandles.length > 0) {
    lastValidLiveCandlesRef.current = liveCandles
  }

  const stickyLiveCandles =
    liveCandles.length > 0 ? liveCandles : lastValidLiveCandlesRef.current

  const usingLiveCandles = stickyLiveCandles.length >= 1
  const symbolSampleCandles = useMemo(() => getSampleCandlesForSymbol(symbol), [symbol])

  // BTC clean baseline:
  // Use the backend historical/engine candles first, not the sticky latest live array.
  // This makes BTC behave like a newly added normal chart before we re-add overlays.
  const baseCandles =
    cleanBaselineBtc && engineCandles.length > 0
      ? engineCandles
      : usingLiveCandles
        ? stickyLiveCandles
        : symbolSampleCandles

  const overlayPayload = useMemo(() => extractOverlayPayload(latestSignal), [latestSignal])

  const engineAvailable = Boolean(engineState && engineStatus === 'loaded' && engineCandles.length > 0)

  const rawSmcEvents = Array.isArray(engineState?.smcEvents)
    ? engineState?.smcEvents ?? []
    : overlayPayload.smcEvents ?? []

  const activeSmcEvents = useMemo(
    () => filterSmcEventsForDisplay(rawSmcEvents, smcDisplayMode, compact),
    [rawSmcEvents, smcDisplayMode, compact]
  )

  const activeDlmLevels = Array.isArray(engineState?.dlmLevels)
    ? engineState?.dlmLevels ?? []
    : overlayPayload.dlmLevels ?? []

  const rawActiveZones = [
    ...(Array.isArray(engineState?.zones) ? engineState?.zones ?? [] : overlayPayload.zones ?? []),
    ...(Array.isArray(engineState?.alphaFvgs) ? engineState?.alphaFvgs ?? [] : []),
  ]

  const activeZones = useMemo(
    () => filterZonesPineStyle(rawActiveZones, baseCandles, compact, smcDisplayMode),
    [rawActiveZones, baseCandles, compact, smcDisplayMode]
  )

  const rawLiquidityEvents = [
    ...(Array.isArray(engineState?.liquidityEvents)
      ? engineState?.liquidityEvents ?? []
      : overlayPayload.liquidityEvents ?? []),
    ...(Array.isArray(engineState?.alphaSweeps) ? engineState?.alphaSweeps ?? [] : []),
  ]

  const activeLiquidityEvents = useMemo(
    () => filterLiquidityEventsForDisplay(rawLiquidityEvents, smcDisplayMode, compact),
    [rawLiquidityEvents, smcDisplayMode, compact]
  )

  const activeDlmConfluenceMarkers = Array.isArray(engineState?.dlmConfluenceMarkers)
    ? engineState?.dlmConfluenceMarkers ?? []
    : overlayPayload.dlmConfluenceMarkers ?? []

  const rawScoreMarkers = Array.isArray(engineState?.scoreMarkers)
    ? engineState?.scoreMarkers ?? []
    : overlayPayload.scoreMarkers ?? []

  const activeScoreMarkers = useMemo(
    () => filterScoreMarkersForDisplay(rawScoreMarkers, smcDisplayMode, compact),
    [rawScoreMarkers, smcDisplayMode, compact]
  )

  const alphaProfileBins = Array.isArray(engineState?.alphaProfileBins)
    ? engineState?.alphaProfileBins ?? []
    : []

  useEffect(() => {
    if (!chartRef.current) return

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, 'dark', {
        renderer: 'canvas',
      })
    }

    const activeCandles =
      cleanBaselineBtc
        ? baseCandles
        : candleMode === 'Heikin Ashi'
          ? convertToHeikinAshi(baseCandles)
          : baseCandles

    const candleTimes = activeCandles.map((c) => c.time)
    const showRightProfile =
      !cleanBaselineBtc && enableAdvancedOverlays && showDlm && !compact && alphaProfileBins.length > 0

    const ghostGapSlots = !compact
      ? Array.from({ length: GHOST_CANDLE_RESERVED_SLOTS }, (_, index) => `__ghost_gap_${index + 1}`)
      : []

    const profileSlots = showRightProfile
      ? Array.from({ length: RIGHT_PROFILE_SLOT_COUNT }, (_, index) => `__profile_${index + 1}`)
      : []

    const ghostCandles = enableAdvancedOverlays && showGhost
      ? buildGhostCandles(engineState, activeCandles, ghostGapSlots)
      : []

    const xAxisData = [...candleTimes, ...ghostGapSlots, ...profileSlots]

    const candleData = activeCandles.map((c) => [
      c.open,
      c.close,
      c.low,
      c.high,
    ])

    const effectiveShowSmc = showSmc && smcDisplayMode !== 'Zones Only'
    const effectiveShowZones = showZones && smcDisplayMode !== 'Structure Only'
    const effectiveShowLiquidity = showLiquidity && smcDisplayMode !== 'Structure Only'
    const effectiveShowScores = showScores && smcDisplayMode === 'Full'

    const markLineData = enableAdvancedOverlays
      ? [
          ...(effectiveShowSmc ? buildSmcMarkLines(activeSmcEvents) : []),
          ...(showDlm ? buildDlmMarkLines(activeDlmLevels, compact) : []),
          ...(effectiveShowLiquidity ? buildLiquidityMarkLines(activeLiquidityEvents, compact) : []),
        ]
      : []

    const markPointData = enableAdvancedOverlays
      ? [
          ...(effectiveShowSmc ? buildSmcMarkPoints(activeSmcEvents, compact) : []),
          ...(effectiveShowLiquidity ? buildLiquidityMarkPoints(activeLiquidityEvents, compact) : []),
          ...(showDlm && smcDisplayMode === 'Full'
            ? buildDlmConfluenceMarkPoints(activeDlmConfluenceMarkers, compact)
            : []),
          ...(effectiveShowScores ? buildScoreMarkPoints(activeScoreMarkers, compact) : []),
          ...buildGhostLiveMarker(
            activeCandles.length > 0 ? activeCandles[activeCandles.length - 1].close : null,
            ghostGapSlots,
            compact
          ),
        ]
      : []

    const latestClose = activeCandles.length > 0 ? activeCandles[activeCandles.length - 1].close : null

    const livePriceLineData =
      SHOW_LIVE_PRICE_LINE && latestClose !== null
        ? [
            {
              yAxis: latestClose,
              name: 'Live Price',
              symbol: 'none',
              lineStyle: {
                color: 'rgba(34, 211, 238, 0.95)',
                width: 2.4,
                type: 'solid',
              },
              label: {
                show: !compact,
                formatter: `⬤ LIVE ${Number(latestClose).toFixed(2)}`,
                color: '#22d3ee',
                fontSize: 10,
                fontWeight: 900,
                position: 'end',
                backgroundColor: 'rgba(15, 17, 21, 0.92)',
                borderColor: '#22d3ee',
                borderWidth: 1,
                borderRadius: 4,
                padding: [3, 6],
              },
            },
          ]
        : []

    const ghostZoneMarkArea =
      enableAdvancedOverlays && showGhost && ghostGapSlots.length > 0 && !compact
        ? [
            [
              {
                xAxis: ghostGapSlots[0],
                itemStyle: {
                  color: 'rgba(34, 211, 238, 0.035)',
                },
                label: {
                  show: true,
                  formatter: 'GHOST ZONE',
                  color: 'rgba(34, 211, 238, 0.90)',
                  fontSize: 10,
                  fontWeight: 900,
                  position: 'insideTop',
                  backgroundColor: 'rgba(15, 17, 21, 0.70)',
                  borderColor: 'rgba(34, 211, 238, 0.45)',
                  borderWidth: 1,
                  borderRadius: 4,
                  padding: [3, 6],
                },
              },
              {
                xAxis: ghostGapSlots[Math.min(GHOST_CANDLE_RESERVED_SLOTS - 1, ghostGapSlots.length - 1)],
              },
            ],
          ]
        : []

    const option: any = {
      backgroundColor: '#0f1115',
      animation: false,

      grid: {
        left: compact ? 4 : 10,
        right: compact ? 48 : showRightProfile ? 28 : 86,
        top: compact ? 12 : 30,
        bottom: compact ? 20 : 35,
        containLabel: true,
      },

      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          crossStyle: {
            color: 'rgba(148, 163, 184, 0.55)',
            type: 'dashed',
          },
        },
        backgroundColor: 'rgba(15, 17, 21, 0.95)',
        borderColor: 'rgba(71, 85, 105, 0.8)',
        textStyle: {
          color: '#e5e7eb',
          fontSize: 12,
        },
        formatter: (params: any) => {
          const item = Array.isArray(params) ? params[0] : params

          if (
            !item ||
            !item.data ||
            String(item.axisValue).startsWith('__profile_') ||
            String(item.axisValue).startsWith('__ghost_gap_')
          ) return ''

          const data = item.data as number[]
          const open = data[1]
          const close = data[2]
          const low = data[3]
          const high = data[4]

          return `
            <div style="font-size:12px;">
              <div style="margin-bottom:4px;color:#e5e7eb;font-weight:700;">
                ${shortAxisLabel(item.axisValue)}
              </div>
              <div style="color:#94a3b8;">${symbol} • ${timeframe} • ${candleMode}</div>
              <div style="color:#64748b;">${
                isFuturesChart
                  ? 'InsightSentry futures + Python SMC engine'
                  : engineAvailable
                    ? 'Python SMC + AlphaX engine'
                    : usingLiveCandles
                      ? historicalCandlesFromAlpaca.length > 0
                        ? 'Alpaca history + live candles'
                        : 'Live API candles'
                      : 'Sample candles'
              }</div>
              <div style="margin-top:6px;color:#e5e7eb;">O&nbsp;&nbsp;${open}</div>
              <div style="color:#e5e7eb;">H&nbsp;&nbsp;${high}</div>
              <div style="color:#e5e7eb;">L&nbsp;&nbsp;${low}</div>
              <div style="color:#e5e7eb;">C&nbsp;&nbsp;${close}</div>
            </div>
          `
        },
      },

      xAxis: {
        type: 'category',
        data: xAxisData,
        boundaryGap: true,
        axisLine: {
          lineStyle: {
            color: 'rgba(148, 163, 184, 0.25)',
          },
        },
        axisLabel: {
          color: '#94a3b8',
          fontSize: compact ? 8 : 11,
          formatter: (value: string) => {
            const text = String(value)
            if (text.startsWith('__profile_') || text.startsWith('__ghost_gap_')) return ''
            return shortAxisLabel(value)
          },
        },
        splitLine: {
          show: false,
        },
      },

      yAxis: {
        scale: true,
        position: 'right',
        axisLine: {
          show: false,
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: '#94a3b8',
          fontSize: compact ? 8 : 11,
        },
        splitLine: {
          lineStyle: {
            color: 'rgba(148, 163, 184, 0.08)',
          },
        },
      },

      dataZoom: [
        {
          id: 'main-x-scroll',
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'none',
          start: compact ? 72 : isFuturesChart ? 0 : 68,
          
          minSpan: 5,
          maxSpan: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: true,
          preventDefaultMouseMove: true,
          throttle: 35,
        },
        {
          id: 'main-y-scale',
          type: 'inside',
          yAxisIndex: 0,
          filterMode: 'none',
          ...buildInitialDataZoom(xAxisData.length, symbol),
          
          minSpan: 5,
          maxSpan: 100,
          zoomOnMouseWheel: 'shift',
          moveOnMouseMove: false,
          moveOnMouseWheel: false,
          preventDefaultMouseMove: false,
          throttle: 35,
        },
      ],

      series: [
        {
          id: 'main-candles',
          name: `${symbol} ${candleMode}`,
          type: 'candlestick',
          data: candleData,
          itemStyle: {
            color: TEAL,
            color0: LIGHT_RED,
            borderColor: TEAL,
            borderColor0: LIGHT_RED,
          },
          barWidth: compact ? '48%' : '58%',
          barMinWidth: 3,
          barMaxWidth: 14,

          markArea: cleanBaselineBtc ? undefined : {
            silent: true,
            data: [
              ...(enableAdvancedOverlays && effectiveShowZones
                ? buildZoneMarkAreas(activeZones, compact, smcDisplayMode)
                : []),
              ...ghostZoneMarkArea,
            ],
          },

          markLine: cleanBaselineBtc ? undefined : {
            silent: true,
            symbol: 'none',
            data: [...markLineData, ...livePriceLineData],
          },

          markPoint: cleanBaselineBtc ? undefined : {
            silent: true,
            data: markPointData,
          },
        },
        ...(enableAdvancedOverlays && showGhost
          ? buildGhostCandleSeries(ghostCandles, compact)
          : []),
        ...(showRightProfile
          ? buildAlphaProfileSeries(alphaProfileBins, profileSlots, compact)
          : []),
      ],
    }

    const optionWithPreservedZoom = preserveAxisZoom(option, chartInstance.current)

    chartInstance.current.setOption(optionWithPreservedZoom, {
      notMerge: false,
      replaceMerge: ['series'],
      lazyUpdate: false,
    })

    const resize = () => {
      chartInstance.current?.resize()
    }

    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
    }
  }, [
    symbol,
    timeframe,
    candleMode,
    compact,
    showSmc,
    showDlm,
    showZones,
    showLiquidity,
    showScores,
    showGhost,
    smcDisplayMode,
    enableAdvancedOverlays,
    baseCandles,
    engineHaCandles,
    activeSmcEvents,
    activeDlmLevels,
    activeZones,
    activeLiquidityEvents,
    activeDlmConfluenceMarkers,
    activeScoreMarkers,
    alphaProfileBins,
    usingLiveCandles,
    historicalCandlesFromAlpaca,
    engineAvailable,
    engineState,
    isFuturesChart,
  ])

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose()
      chartInstance.current = null
    }
  }, [])

  const dataBadge = isFuturesChart && (engineAvailable || historicalCandlesFromAlpaca.length > 0)
    ? 'InsightSentry Futures'
    : engineAvailable
      ? 'Python SMC Engine'
      : usingLiveCandles
        ? historicalCandlesFromAlpaca.length > 0
          ? 'Alpaca + Live Candles'
          : 'Live API Candles'
        : historicalStatus === 'loading'
          ? 'Loading History'
          : 'Sample Candles'

  const liveBadge = engineAvailable ? 'Python SMC Live' : engineStatus === 'loading' ? 'Loading SMC' : 'Live SMC/AlphaX'

  return (
    <div
      className={`flex ${heightClass} w-full flex-col overflow-hidden rounded-2xl border border-dark-700 bg-[#0f1115]`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dark-700 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-full bg-orange-500 px-2 py-1 text-xs font-bold text-white">
            ₿
          </div>

          {chartTitle && (
            <span className="text-xs font-semibold text-gray-300">
              {chartTitle}
            </span>
          )}

          <select
            value={symbol}
            onChange={(e) => setSymbol(normalizeDefaultSymbol(e.target.value, symbol))}
            className="rounded-md border border-dark-700 bg-[#151922] px-3 py-1.5 text-sm text-gray-100 outline-none"
          >
            <option value="BTCUSD">BTCUSD</option>
            <option value="ETHUSD">ETHUSD</option>
            <option value="SPY">SPY</option>
            <option value="ES1!">ES1!</option>
            <option value="MES1!">MES1!</option>
          </select>

          <select
            value={timeframe}
            onChange={(e) => setTimeframe(normalizeDefaultTimeframe(e.target.value, timeframe))}
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
            onChange={(e) => setCandleMode(e.target.value as CandleMode)}
            className="rounded-md border border-dark-700 bg-[#151922] px-3 py-1.5 text-sm text-gray-100 outline-none"
          >
            {candleModeOptions.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>

          {!compact && enableAdvancedOverlays && (
            <select
              value={smcDisplayMode}
              onChange={(e) => setSmcDisplayMode(e.target.value as SmcDisplayMode)}
              className="rounded-md border border-dark-700 bg-[#151922] px-3 py-1.5 text-sm text-gray-100 outline-none"
            >
              <option value="Clean">Clean</option>
              <option value="Full">Full</option>
              <option value="Structure Only">Structure Only</option>
              <option value="Zones Only">Zones Only</option>
            </select>
          )}

          {!compact && enableAdvancedOverlays && (
            <>
              <button
                type="button"
                onClick={() => setShowSmc((value) => !value)}
                className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                  showSmc
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                    : 'border-dark-700 bg-[#151922] text-gray-400'
                }`}
              >
                SMC
              </button>

              <button
                type="button"
                onClick={() => setShowZones((value) => !value)}
                className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                  showZones
                    ? 'border-purple-500/50 bg-purple-500/10 text-purple-300'
                    : 'border-dark-700 bg-[#151922] text-gray-400'
                }`}
              >
                Zones
              </button>

              <button
                type="button"
                onClick={() => setShowLiquidity((value) => !value)}
                className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                  showLiquidity
                    ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-300'
                    : 'border-dark-700 bg-[#151922] text-gray-400'
                }`}
              >
                Liquidity
              </button>

              <button
                type="button"
                onClick={() => setShowDlm((value) => !value)}
                className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                  showDlm
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-300'
                    : 'border-dark-700 bg-[#151922] text-gray-400'
                }`}
              >
                AlphaX DLM
              </button>

              <button
                type="button"
                onClick={() => setShowScores((value) => !value)}
                className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                  showScores
                    ? 'border-orange-500/50 bg-orange-500/10 text-orange-300'
                    : 'border-dark-700 bg-[#151922] text-gray-400'
                }`}
              >
                Scores
              </button>

              <button
                type="button"
                onClick={() => setShowGhost((value) => !value)}
                className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                  showGhost
                    ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                    : 'border-dark-700 bg-[#151922] text-gray-400'
                }`}
              >
                Ghost
              </button>
            </>
          )}
        </div>

        {!compact && (
          <div className="flex items-center gap-2">
            <div
              className={`rounded-full border px-3 py-1 text-sm ${
                engineAvailable || usingLiveCandles
                  ? 'border-emerald-500/50 text-emerald-400'
                  : 'border-yellow-500/50 text-yellow-400'
              }`}
            >
              {dataBadge}
            </div>

            <div
              className={`rounded-full border px-3 py-1 text-sm ${
                engineAvailable
                  ? 'border-blue-500/50 text-blue-300'
                  : 'border-slate-500/50 text-slate-300'
              }`}
            >
              {liveBadge}
            </div>

            <div className="rounded-full border border-emerald-500/50 px-3 py-1 text-sm text-emerald-400">
              {enableAdvancedOverlays ? 'Chart Engine v3AJ' : 'Chart Engine v2'}
            </div>
          </div>
        )}
      </div>

      <div ref={chartRef} className="h-full w-full flex-1" />
    </div>
  )
}
