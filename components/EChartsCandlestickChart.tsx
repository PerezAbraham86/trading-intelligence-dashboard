'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts'

type Candle = {
  time: string
  open: number
  close: number
  low: number
  high: number
}

type CandleMode = 'Regular' | 'Heikin Ashi'

type StructureDirection = 'bullish' | 'bearish'
type StructureScope = 'internal' | 'swing'
type StructureTag = 'BOS' | 'CHoCH' | 'iBOS' | 'iCHoCH' | 'HH' | 'HL' | 'LH' | 'LL'

type SmcStructureEvent = {
  time: string
  fromTime?: string
  price: number
  tag: StructureTag
  direction: StructureDirection
  scope: StructureScope
}

type DlmLevel = {
  label: string
  price: number
  direction: 'neutral' | 'bullish' | 'bearish'
}

type ZoneDirection = 'bullish' | 'bearish' | 'neutral'
type ZoneKind = 'internal_ob' | 'swing_ob' | 'fvg' | 'premium' | 'equilibrium' | 'discount'

type SmcZone = {
  startTime: string
  endTime: string
  top: number
  bottom: number
  label: string
  direction: ZoneDirection
  kind: ZoneKind
}

type LiquidityKind =
  | 'eqh'
  | 'eql'
  | 'internal_sweep'
  | 'swing_sweep'
  | 'liquidity_pool'
  | 'inducement'

type LiquidityEvent = {
  time: string
  fromTime?: string
  price: number
  label: string
  direction: 'bullish' | 'bearish' | 'neutral'
  kind: LiquidityKind
  touches?: number
}

type DlmConfluenceMarker = {
  time: string
  price: number
  label: string
  direction: 'bullish' | 'bearish' | 'neutral'
  kind: 'poc_touch' | 'liquidity_touch' | 'ob_confirm' | 'entry_confirm' | 'pressure'
  pressurePct?: number
}

type ScoreMarker = {
  time: string
  price: number
  label: string
  direction: 'bullish' | 'bearish' | 'neutral'
  kind:
    | 'setup_score'
    | 'institutional_score'
    | 'execution_quality'
    | 'trend_phase'
    | 'htf_bias'
    | 'session'
  score?: number
  grade?: 'A' | 'B' | 'C'
}

type ChartOverlayPayload = {
  smcEvents?: SmcStructureEvent[]
  dlmLevels?: DlmLevel[]
  zones?: SmcZone[]
  liquidityEvents?: LiquidityEvent[]
  dlmConfluenceMarkers?: DlmConfluenceMarker[]
  scoreMarkers?: ScoreMarker[]
}

type EChartsCandlestickChartProps = {
  heightClass?: string
  compact?: boolean
  chartTitle?: string
  enableAdvancedOverlays?: boolean
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

const sampleSmcEvents: SmcStructureEvent[] = [
  {
    time: '5/20 13:00',
    fromTime: '5/20 11:00',
    price: 77100,
    tag: 'iBOS',
    direction: 'bullish',
    scope: 'internal',
  },
  {
    time: '5/20 17:00',
    fromTime: '5/20 14:00',
    price: 77930,
    tag: 'BOS',
    direction: 'bullish',
    scope: 'swing',
  },
  {
    time: '5/20 21:00',
    fromTime: '5/20 18:00',
    price: 77090,
    tag: 'iCHoCH',
    direction: 'bearish',
    scope: 'internal',
  },
  {
    time: '5/20 23:00',
    fromTime: '5/20 20:00',
    price: 76120,
    tag: 'CHoCH',
    direction: 'bearish',
    scope: 'swing',
  },
  {
    time: '5/21 03:00',
    price: 75350,
    tag: 'LL',
    direction: 'bearish',
    scope: 'swing',
  },
  {
    time: '5/21 06:00',
    price: 76690,
    tag: 'LH',
    direction: 'bearish',
    scope: 'swing',
  },
]

const sampleDlmLevels: DlmLevel[] = [
  { label: 'AlphaX POC', price: 76580, direction: 'neutral' },
  { label: 'DLM Buy Liquidity', price: 75840, direction: 'bullish' },
  { label: 'DLM Sell Liquidity', price: 77840, direction: 'bearish' },
]

const sampleZones: SmcZone[] = [
  {
    startTime: '5/20 12:00',
    endTime: '5/20 18:00',
    top: 77100,
    bottom: 76720,
    label: 'Internal Bullish OB',
    direction: 'bullish',
    kind: 'internal_ob',
  },
  {
    startTime: '5/20 18:00',
    endTime: '5/21 02:00',
    top: 77910,
    bottom: 77580,
    label: 'Internal Bearish OB',
    direction: 'bearish',
    kind: 'internal_ob',
  },
  {
    startTime: '5/20 14:00',
    endTime: '5/21 06:00',
    top: 77410,
    bottom: 77090,
    label: 'Swing Bullish OB',
    direction: 'bullish',
    kind: 'swing_ob',
  },
  {
    startTime: '5/20 21:00',
    endTime: '5/21 06:00',
    top: 76980,
    bottom: 76550,
    label: 'Bearish FVG',
    direction: 'bearish',
    kind: 'fvg',
  },
  {
    startTime: '5/21 01:00',
    endTime: '5/21 06:00',
    top: 76020,
    bottom: 75840,
    label: 'Bullish FVG',
    direction: 'bullish',
    kind: 'fvg',
  },
  {
    startTime: '5/20 09:00',
    endTime: '5/21 06:00',
    top: 77930,
    bottom: 77220,
    label: 'Premium',
    direction: 'bearish',
    kind: 'premium',
  },
  {
    startTime: '5/20 09:00',
    endTime: '5/21 06:00',
    top: 77220,
    bottom: 76680,
    label: 'Equilibrium',
    direction: 'neutral',
    kind: 'equilibrium',
  },
  {
    startTime: '5/20 09:00',
    endTime: '5/21 06:00',
    top: 76680,
    bottom: 75350,
    label: 'Discount',
    direction: 'bullish',
    kind: 'discount',
  },
]

const sampleLiquidityEvents: LiquidityEvent[] = [
  {
    time: '5/20 15:00',
    fromTime: '5/20 12:00',
    price: 77100,
    label: 'EQH',
    direction: 'bearish',
    kind: 'eqh',
    touches: 2,
  },
  {
    time: '5/21 02:00',
    fromTime: '5/20 23:00',
    price: 75840,
    label: 'EQL',
    direction: 'bullish',
    kind: 'eql',
    touches: 2,
  },
  {
    time: '5/20 18:00',
    price: 77910,
    label: 'LSH',
    direction: 'bearish',
    kind: 'swing_sweep',
  },
  {
    time: '5/21 01:00',
    price: 75590,
    label: 'iLS',
    direction: 'bullish',
    kind: 'internal_sweep',
  },
  {
    time: '5/21 03:00',
    price: 75350,
    label: 'Sell-Side Pool',
    direction: 'bullish',
    kind: 'liquidity_pool',
    touches: 3,
  },
  {
    time: '5/20 17:00',
    price: 77930,
    label: 'Buy-Side Pool',
    direction: 'bearish',
    kind: 'liquidity_pool',
    touches: 3,
  },
  {
    time: '5/20 20:00',
    price: 77500,
    label: 'Inducement',
    direction: 'bearish',
    kind: 'inducement',
  },
]

const sampleDlmConfluenceMarkers: DlmConfluenceMarker[] = [
  {
    time: '5/20 13:00',
    price: 76720,
    label: 'DLM OB Confirm',
    direction: 'bullish',
    kind: 'ob_confirm',
    pressurePct: 62,
  },
  {
    time: '5/20 17:00',
    price: 77840,
    label: 'Sell Liquidity Hit',
    direction: 'bearish',
    kind: 'liquidity_touch',
    pressurePct: 58,
  },
  {
    time: '5/21 01:00',
    price: 75840,
    label: 'Buy Liquidity Hit',
    direction: 'bullish',
    kind: 'liquidity_touch',
    pressurePct: 64,
  },
  {
    time: '5/21 04:00',
    price: 76580,
    label: 'POC Touch',
    direction: 'neutral',
    kind: 'poc_touch',
    pressurePct: 50,
  },
  {
    time: '5/21 06:00',
    price: 76690,
    label: 'DLM Entry Confirm',
    direction: 'bullish',
    kind: 'entry_confirm',
    pressurePct: 67,
  },
]

const sampleScoreMarkers: ScoreMarker[] = [
  {
    time: '5/20 13:00',
    price: 76840,
    label: 'Setup Score',
    direction: 'bullish',
    kind: 'setup_score',
    score: 6,
    grade: 'A',
  },
  {
    time: '5/20 17:00',
    price: 77610,
    label: 'Inst Score',
    direction: 'bullish',
    kind: 'institutional_score',
    score: 12,
    grade: 'A',
  },
  {
    time: '5/20 21:00',
    price: 77240,
    label: 'Exec Q',
    direction: 'bearish',
    kind: 'execution_quality',
    score: 8,
    grade: 'B',
  },
  {
    time: '5/20 23:00',
    price: 76710,
    label: 'Trend Phase',
    direction: 'bearish',
    kind: 'trend_phase',
    score: 7,
    grade: 'B',
  },
  {
    time: '5/21 03:00',
    price: 75590,
    label: 'HTF Bias',
    direction: 'bullish',
    kind: 'htf_bias',
    score: 5,
    grade: 'B',
  },
  {
    time: '5/21 05:00',
    price: 76310,
    label: 'NY AM',
    direction: 'neutral',
    kind: 'session',
    score: 1,
    grade: 'C',
  },
]

const timeframeOptions = ['1m', '5m', '15m', '1h', '4h', '1D']
const candleModeOptions: CandleMode[] = ['Regular', 'Heikin Ashi']

function toNumber(value: any): number | null {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function formatSignalTime(value: any, fallbackIndex: number): string {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value > 1000000000000 ? value : value * 1000
    const date = new Date(timestamp)

    if (!Number.isNaN(date.getTime())) {
      const month = date.getMonth() + 1
      const day = date.getDate()
      const hour = date.getHours().toString().padStart(2, '0')
      const minute = date.getMinutes().toString().padStart(2, '0')

      return `${month}/${day} ${hour}:${minute}`
    }
  }

  return `Live ${fallbackIndex + 1}`
}

function buildCandlesFromSignals(
  signals: any[] | undefined,
  selectedSymbol: string,
  selectedTimeframe: string
): Candle[] {
  if (!Array.isArray(signals) || signals.length === 0) {
    return []
  }

  const normalizedTimeframe = normalizeTimeframe(selectedTimeframe)

  const filtered = signals.filter((signal) => {
    const timeframeMatch =
      normalizeTimeframe(signal.timeframe) === normalizedTimeframe ||
      !signal.timeframe

    return symbolsMatch(signal.symbol, selectedSymbol) && timeframeMatch
  })

  const source = filtered.length > 0 ? filtered : []

  const candles = source
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
        time: formatSignalTime(signal.time ?? signal.timestamp ?? signal.createdAt, index),
        open,
        high,
        low,
        close,
      }
    })
    .filter((candle): candle is Candle => candle !== null)

  return candles
}

function buildCandlesFromRecentCandles(
  candlesInput: any[] | undefined,
  selectedSymbol: string,
  selectedTimeframe: string
): Candle[] {
  if (!Array.isArray(candlesInput) || candlesInput.length === 0) {
    return []
  }

  const normalizedTimeframe = normalizeTimeframe(selectedTimeframe)

  const filtered = candlesInput.filter((candle) => {
    const timeframeMatch =
      normalizeTimeframe(candle.timeframe) === normalizedTimeframe ||
      !candle.timeframe

    return symbolsMatch(candle.symbol, selectedSymbol) && timeframeMatch
  })

  return filtered
    .map((candle, index) => {
      const open = toNumber(candle.open)
      const high = toNumber(candle.high)
      const low = toNumber(candle.low)
      const close = toNumber(candle.close)

      if (open === null || high === null || low === null || close === null) {
        return null
      }

      return {
        time: formatSignalTime(candle.time ?? candle.timestamp ?? candle.createdAt, index),
        open,
        high,
        low,
        close,
      }
    })
    .filter((candle): candle is Candle => candle !== null)
}

function safeParseJson(value: any): any {
  if (!value) {
    return null
  }

  if (typeof value === 'object') {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

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
    })
  }

  return haCandles
}

function getStructureColor(direction: StructureDirection) {
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

function getZoneStyle(zone: SmcZone, compact: boolean) {
  if (zone.kind === 'premium') {
    return {
      color: 'rgba(242, 54, 69, 0.06)',
      borderColor: 'rgba(242, 54, 69, 0.18)',
    }
  }

  if (zone.kind === 'equilibrium') {
    return {
      color: 'rgba(135, 139, 148, 0.045)',
      borderColor: 'rgba(135, 139, 148, 0.16)',
    }
  }

  if (zone.kind === 'discount') {
    return {
      color: 'rgba(8, 153, 129, 0.06)',
      borderColor: 'rgba(8, 153, 129, 0.18)',
    }
  }

  if (zone.kind === 'fvg') {
    return zone.direction === 'bullish'
      ? {
          color: compact ? 'rgba(0, 255, 104, 0.08)' : 'rgba(0, 255, 104, 0.12)',
          borderColor: 'rgba(0, 255, 104, 0.32)',
        }
      : {
          color: compact ? 'rgba(255, 0, 8, 0.08)' : 'rgba(255, 0, 8, 0.12)',
          borderColor: 'rgba(255, 0, 8, 0.32)',
        }
  }

  if (zone.kind === 'swing_ob') {
    return zone.direction === 'bullish'
      ? {
          color: compact ? 'rgba(24, 72, 204, 0.10)' : 'rgba(24, 72, 204, 0.16)',
          borderColor: 'rgba(24, 72, 204, 0.42)',
        }
      : {
          color: compact ? 'rgba(178, 40, 51, 0.10)' : 'rgba(178, 40, 51, 0.16)',
          borderColor: 'rgba(178, 40, 51, 0.42)',
        }
  }

  return zone.direction === 'bullish'
    ? {
        color: compact ? 'rgba(49, 121, 245, 0.10)' : 'rgba(49, 121, 245, 0.16)',
        borderColor: 'rgba(49, 121, 245, 0.42)',
      }
    : {
        color: compact ? 'rgba(247, 124, 128, 0.10)' : 'rgba(247, 124, 128, 0.16)',
        borderColor: 'rgba(247, 124, 128, 0.42)',
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
      symbolSize: compact ? 28 : 38,
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
        fontSize: compact ? 8 : 10,
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

function buildZoneMarkAreas(zones: SmcZone[], compact: boolean) {
  return zones.map((zone) => {
    const style = getZoneStyle(zone, compact)

    return [
      {
        xAxis: zone.startTime,
        yAxis: zone.top,
        itemStyle: {
          color: style.color,
          borderColor: style.borderColor,
          borderWidth: zone.kind === 'swing_ob' ? 1.4 : 1,
          borderType: zone.kind === 'fvg' ? 'dashed' : 'solid',
        },
        label: {
          show: !compact,
          formatter: zone.label,
          color: style.borderColor,
          fontSize: 10,
          fontWeight: 700,
          position: 'insideTopLeft',
          backgroundColor: 'rgba(15, 17, 21, 0.60)',
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
        event.kind === 'inducement'
    )
    .map((event) => {
      const color = getLiquidityColor(event)
      const isTopLabel = event.direction === 'bearish'

      return {
        name: event.label,
        coord: [event.time, event.price],
        value: event.label,
        symbol: event.kind === 'inducement' ? 'diamond' : 'pin',
        symbolSize: compact ? 26 : event.kind === 'inducement' ? 34 : 38,
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
          fontSize: compact ? 8 : 10,
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
      symbolSize: compact ? 18 : marker.kind === 'entry_confirm' ? 24 : 20,
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
          ? 20
          : marker.kind === 'institutional_score'
            ? 30
            : marker.kind === 'trend_phase'
              ? 28
              : 24,
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

export default function EChartsCandlestickChart({
  heightClass = 'h-[650px]',
  compact = false,
  chartTitle,
  enableAdvancedOverlays = true,
  latestSignal,
  recentSignals,
  recentCandles,
}: EChartsCandlestickChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)

  const [symbol, setSymbol] = useState('SPY')
  const [timeframe, setTimeframe] = useState('1m')
  const [candleMode, setCandleMode] = useState<CandleMode>('Heikin Ashi')
  const [showSmc, setShowSmc] = useState(true)
  const [showDlm, setShowDlm] = useState(true)
  const [showZones, setShowZones] = useState(true)
  const [showLiquidity, setShowLiquidity] = useState(true)
  const [showScores, setShowScores] = useState(true)

  const liveCandlesFromCandlesEndpoint = useMemo(
    () => buildCandlesFromRecentCandles(recentCandles, symbol, timeframe),
    [recentCandles, symbol, timeframe]
  )

  const liveCandlesFromSignalsEndpoint = useMemo(
    () => buildCandlesFromSignals(recentSignals, symbol, timeframe),
    [recentSignals, symbol, timeframe]
  )

  const liveCandles =
    liveCandlesFromCandlesEndpoint.length > 0
      ? liveCandlesFromCandlesEndpoint
      : liveCandlesFromSignalsEndpoint

  const usingLiveCandles = liveCandles.length >= 2

  const symbolSampleCandles = useMemo(() => {
    return getSampleCandlesForSymbol(symbol)
  }, [symbol])

  const baseCandles = usingLiveCandles ? liveCandles : symbolSampleCandles

  const overlayPayload = useMemo(
    () => extractOverlayPayload(latestSignal),
    [latestSignal]
  )

  const activeSmcEvents =
    overlayPayload.smcEvents && overlayPayload.smcEvents.length > 0
      ? overlayPayload.smcEvents
      : sampleSmcEvents

  const activeDlmLevels =
    overlayPayload.dlmLevels && overlayPayload.dlmLevels.length > 0
      ? overlayPayload.dlmLevels
      : sampleDlmLevels

  const activeZones =
    overlayPayload.zones && overlayPayload.zones.length > 0
      ? overlayPayload.zones
      : sampleZones

  const activeLiquidityEvents =
    overlayPayload.liquidityEvents && overlayPayload.liquidityEvents.length > 0
      ? overlayPayload.liquidityEvents
      : sampleLiquidityEvents

  const activeDlmConfluenceMarkers =
    overlayPayload.dlmConfluenceMarkers &&
    overlayPayload.dlmConfluenceMarkers.length > 0
      ? overlayPayload.dlmConfluenceMarkers
      : sampleDlmConfluenceMarkers

  const activeScoreMarkers =
    overlayPayload.scoreMarkers && overlayPayload.scoreMarkers.length > 0
      ? overlayPayload.scoreMarkers
      : sampleScoreMarkers

  useEffect(() => {
    if (!chartRef.current) return

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, 'dark', {
        renderer: 'canvas',
      })
    }

    const activeCandles =
      candleMode === 'Heikin Ashi' ? convertToHeikinAshi(baseCandles) : baseCandles

    const times = activeCandles.map((c) => c.time)

    const candleData = activeCandles.map((c) => [
      c.open,
      c.close,
      c.low,
      c.high,
    ])

    const option: any = {
      backgroundColor: '#0f1115',
      animation: false,

      grid: {
        left: compact ? 4 : 10,
        right: compact ? 48 : 86,
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

          if (!item || !item.data) return ''

          const data = item.data as number[]
          const open = data[1]
          const close = data[2]
          const low = data[3]
          const high = data[4]

          return `
            <div style="font-size:12px;">
              <div style="margin-bottom:4px;color:#e5e7eb;font-weight:700;">
                ${item.axisValue}
              </div>
              <div style="color:#94a3b8;">${symbol} • ${timeframe} • ${candleMode}</div>
              <div style="color:#64748b;">${usingLiveCandles ? 'Live API candles' : 'Sample candles'}</div>
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
        data: times,
        boundaryGap: true,
        axisLine: {
          lineStyle: {
            color: 'rgba(148, 163, 184, 0.25)',
          },
        },
        axisLabel: {
          color: '#94a3b8',
          fontSize: compact ? 8 : 11,
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
          type: 'inside',
          xAxisIndex: 0,
          start: 0,
          end: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
        },
      ],

      series: [
        {
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

          markArea: {
            silent: true,
            data:
              enableAdvancedOverlays && showZones
                ? buildZoneMarkAreas(activeZones, compact)
                : [],
          },

          markLine: {
            silent: true,
            symbol: 'none',
            data: enableAdvancedOverlays
              ? [
                  ...(showSmc ? buildSmcMarkLines(activeSmcEvents) : []),
                  ...(showDlm ? buildDlmMarkLines(activeDlmLevels, compact) : []),
                  ...(showLiquidity
                    ? buildLiquidityMarkLines(activeLiquidityEvents, compact)
                    : []),
                ]
              : [],
          },

          markPoint: {
            silent: true,
            data: enableAdvancedOverlays
              ? [
                  ...(showSmc ? buildSmcMarkPoints(activeSmcEvents, compact) : []),
                  ...(showLiquidity
                    ? buildLiquidityMarkPoints(activeLiquidityEvents, compact)
                    : []),
                  ...(showDlm
                    ? buildDlmConfluenceMarkPoints(
                        activeDlmConfluenceMarkers,
                        compact
                      )
                    : []),
                  ...(showScores
                    ? buildScoreMarkPoints(activeScoreMarkers, compact)
                    : []),
                ]
              : [],
          },
        },
      ],
    }

    chartInstance.current.setOption(option, true)

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
    enableAdvancedOverlays,
    baseCandles,
    activeSmcEvents,
    activeDlmLevels,
    activeZones,
    activeLiquidityEvents,
    activeDlmConfluenceMarkers,
    activeScoreMarkers,
    usingLiveCandles,
    recentCandles,
  ])

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose()
      chartInstance.current = null
    }
  }, [])

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
            onChange={(e) => setSymbol(e.target.value)}
            className="rounded-md border border-dark-700 bg-[#151922] px-3 py-1.5 text-sm text-gray-100 outline-none"
          >
            <option value="BTCUSD">BTCUSD</option>
            <option value="ETHUSD">ETHUSD</option>
            <option value="SPY">SPY</option>
            <option value="ES1!">ES1!</option>
          </select>

          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
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
            </>
          )}
        </div>

        {!compact && (
          <div className="flex items-center gap-2">
            <div
              className={`rounded-full border px-3 py-1 text-sm ${
                usingLiveCandles
                  ? 'border-emerald-500/50 text-emerald-400'
                  : 'border-yellow-500/50 text-yellow-400'
              }`}
            >
              {usingLiveCandles ? 'Live API Candles' : 'Sample Candles'}
            </div>

            <div className="rounded-full border border-emerald-500/50 px-3 py-1 text-sm text-emerald-400">
              {enableAdvancedOverlays ? 'Chart Engine v3I' : 'Chart Engine v2'}
            </div>
          </div>
        )}
      </div>

      <div ref={chartRef} className="h-full w-full flex-1" />
    </div>
  )
}
