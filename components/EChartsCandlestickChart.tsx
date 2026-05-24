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

const spySampleCandles: Candle[] = [
  { time: '5/20 09:00', open: 529.1, close: 529.8, low: 528.8, high: 530.2 },
  { time: '5/20 10:00', open: 529.8, close: 530.4, low: 529.5, high: 530.9 },
  { time: '5/20 11:00', open: 530.4, close: 529.7, low: 529.2, high: 530.6 },
  { time: '5/20 12:00', open: 529.7, close: 531.1, low: 529.6, high: 531.4 },
  { time: '5/20 13:00', open: 531.1, close: 531.9, low: 530.8, high: 532.2 },
  { time: '5/20 14:00', open: 531.9, close: 531.3, low: 530.9, high: 532.1 },
  { time: '5/20 15:00', open: 531.3, close: 532.6, low: 531.0, high: 533.0 },
  { time: '5/20 16:00', open: 532.6, close: 532.2, low: 531.7, high: 532.9 },
  { time: '5/20 17:00', open: 532.2, close: 533.5, low: 531.9, high: 533.8 },
  { time: '5/20 18:00', open: 533.5, close: 532.8, low: 532.4, high: 533.9 },
  { time: '5/20 19:00', open: 532.8, close: 531.6, low: 531.2, high: 533.0 },
  { time: '5/20 20:00', open: 531.6, close: 530.7, low: 530.2, high: 531.9 },
  { time: '5/20 21:00', open: 530.7, close: 529.9, low: 529.4, high: 531.0 },
  { time: '5/20 22:00', open: 529.9, close: 530.8, low: 529.6, high: 531.2 },
  { time: '5/20 23:00', open: 530.8, close: 531.7, low: 530.5, high: 532.0 },
  { time: '5/21 00:00', open: 531.7, close: 532.4, low: 531.3, high: 532.7 },
]

const btcSampleCandles: Candle[] = [
  { time: '5/20 09:00', open: 106250, close: 106780, low: 105950, high: 107100 },
  { time: '5/20 10:00', open: 106780, close: 106420, low: 106100, high: 107020 },
  { time: '5/20 11:00', open: 106420, close: 107350, low: 106260, high: 107820 },
  { time: '5/20 12:00', open: 107350, close: 108120, low: 107000, high: 108450 },
  { time: '5/20 13:00', open: 108120, close: 107780, low: 107300, high: 108700 },
  { time: '5/20 14:00', open: 107780, close: 108950, low: 107550, high: 109240 },
  { time: '5/20 15:00', open: 108950, close: 108300, low: 107980, high: 109400 },
  { time: '5/20 16:00', open: 108300, close: 109180, low: 108020, high: 109620 },
  { time: '5/20 17:00', open: 109180, close: 110020, low: 108900, high: 110450 },
  { time: '5/20 18:00', open: 110020, close: 109300, low: 108850, high: 110200 },
  { time: '5/20 19:00', open: 109300, close: 108450, low: 108100, high: 109640 },
  { time: '5/20 20:00', open: 108450, close: 107620, low: 107250, high: 108900 },
  { time: '5/20 21:00', open: 107620, close: 106980, low: 106500, high: 108000 },
  { time: '5/20 22:00', open: 106980, close: 107850, low: 106700, high: 108220 },
  { time: '5/20 23:00', open: 107850, close: 108670, low: 107400, high: 109100 },
  { time: '5/21 00:00', open: 108670, close: 109420, low: 108200, high: 109850 },
]

const ethSampleCandles: Candle[] = [
  { time: '5/20 09:00', open: 3850, close: 3884, low: 3825, high: 3902 },
  { time: '5/20 10:00', open: 3884, close: 3862, low: 3848, high: 3896 },
  { time: '5/20 11:00', open: 3862, close: 3915, low: 3850, high: 3938 },
  { time: '5/20 12:00', open: 3915, close: 3952, low: 3902, high: 3970 },
  { time: '5/20 13:00', open: 3952, close: 3936, low: 3918, high: 3968 },
  { time: '5/20 14:00', open: 3936, close: 3984, low: 3920, high: 4004 },
  { time: '5/20 15:00', open: 3984, close: 3962, low: 3945, high: 3998 },
  { time: '5/20 16:00', open: 3962, close: 4012, low: 3950, high: 4035 },
  { time: '5/20 17:00', open: 4012, close: 4055, low: 4005, high: 4078 },
  { time: '5/20 18:00', open: 4055, close: 4020, low: 4002, high: 4064 },
  { time: '5/20 19:00', open: 4020, close: 3988, low: 3970, high: 4033 },
  { time: '5/20 20:00', open: 3988, close: 3950, low: 3934, high: 4001 },
  { time: '5/20 21:00', open: 3950, close: 3924, low: 3908, high: 3962 },
  { time: '5/20 22:00', open: 3924, close: 3968, low: 3912, high: 3984 },
  { time: '5/20 23:00', open: 3968, close: 4005, low: 3955, high: 4022 },
  { time: '5/21 00:00', open: 4005, close: 4040, low: 3992, high: 4060 },
]

const esSampleCandles: Candle[] = [
  { time: '5/20 09:00', open: 5940.25, close: 5948.5, low: 5936.25, high: 5952.25 },
  { time: '5/20 10:00', open: 5948.5, close: 5955.75, low: 5944.5, high: 5959.25 },
  { time: '5/20 11:00', open: 5955.75, close: 5949.25, low: 5945.0, high: 5958.0 },
  { time: '5/20 12:00', open: 5949.25, close: 5961.5, low: 5948.0, high: 5965.25 },
  { time: '5/20 13:00', open: 5961.5, close: 5968.75, low: 5958.25, high: 5972.0 },
  { time: '5/20 14:00', open: 5968.75, close: 5962.25, low: 5957.75, high: 5970.5 },
  { time: '5/20 15:00', open: 5962.25, close: 5976.0, low: 5959.0, high: 5980.0 },
  { time: '5/20 16:00', open: 5976.0, close: 5971.25, low: 5966.0, high: 5979.25 },
  { time: '5/20 17:00', open: 5971.25, close: 5984.75, low: 5969.5, high: 5988.25 },
  { time: '5/20 18:00', open: 5984.75, close: 5977.25, low: 5972.25, high: 5987.5 },
  { time: '5/20 19:00', open: 5977.25, close: 5965.5, low: 5960.25, high: 5980.0 },
  { time: '5/20 20:00', open: 5965.5, close: 5956.75, low: 5952.0, high: 5969.25 },
  { time: '5/20 21:00', open: 5956.75, close: 5948.25, low: 5944.5, high: 5960.25 },
  { time: '5/20 22:00', open: 5948.25, close: 5957.5, low: 5945.75, high: 5961.0 },
  { time: '5/20 23:00', open: 5957.5, close: 5966.75, low: 5954.25, high: 5970.0 },
  { time: '5/21 00:00', open: 5966.75, close: 5974.25, low: 5962.25, high: 5978.0 },
]

function getCanonicalSymbol(symbol: string): string {
  const normalized = String(symbol ?? '').toUpperCase().replace(/^.*:/, '')

  if (normalized.includes('MES')) return 'MES'
  if (normalized.includes('ES')) return 'ES'
  if (normalized.includes('BTC')) return 'BTC'
  if (normalized.includes('ETH')) return 'ETH'
  if (normalized.includes('SPY')) return 'SPY'

  return normalized
}

function getSampleCandlesForSymbol(symbol: string): Candle[] {
  const canonical = getCanonicalSymbol(symbol)

  if (canonical === 'BTC') return btcSampleCandles
  if (canonical === 'ETH') return ethSampleCandles
  if (canonical === 'MES') return esSampleCandles
  if (canonical === 'ES') return esSampleCandles

  return spySampleCandles
}


const referenceOverlayTimes = [
  '5/20 09:00',
  '5/20 10:00',
  '5/20 11:00',
  '5/20 12:00',
  '5/20 13:00',
  '5/20 14:00',
  '5/20 15:00',
  '5/20 16:00',
  '5/20 17:00',
  '5/20 18:00',
  '5/20 19:00',
  '5/20 20:00',
  '5/20 21:00',
  '5/20 22:00',
  '5/20 23:00',
  '5/21 00:00',
  '5/21 01:00',
  '5/21 02:00',
  '5/21 03:00',
  '5/21 04:00',
  '5/21 05:00',
  '5/21 06:00',
]

const REFERENCE_OVERLAY_LOW = 75350
const REFERENCE_OVERLAY_HIGH = 77930

function getCandlePriceRange(candles: Candle[]) {
  if (candles.length === 0) {
    return {
      low: REFERENCE_OVERLAY_LOW,
      high: REFERENCE_OVERLAY_HIGH,
    }
  }

  const lows = candles.map((candle) => candle.low)
  const highs = candles.map((candle) => candle.high)
  const low = Math.min(...lows)
  const high = Math.max(...highs)
  const range = Math.max(high - low, 0.00001)
  const padding = range * 0.04

  return {
    low: low - padding,
    high: high + padding,
  }
}

function remapReferencePrice(price: number, candles: Candle[]) {
  const range = getCandlePriceRange(candles)
  const referenceRange = REFERENCE_OVERLAY_HIGH - REFERENCE_OVERLAY_LOW
  const normalized = (price - REFERENCE_OVERLAY_LOW) / referenceRange
  const mapped = range.low + normalized * (range.high - range.low)

  return Number(mapped.toFixed(5))
}

function remapReferenceTime(time: string, candles: Candle[]) {
  if (candles.length === 0) return time

  const referenceIndex = referenceOverlayTimes.indexOf(time)

  if (referenceIndex === -1) {
    return candles[Math.min(candles.length - 1, Math.floor(candles.length / 2))].time
  }

  const targetIndex = Math.round(
    (referenceIndex / Math.max(referenceOverlayTimes.length - 1, 1)) *
      Math.max(candles.length - 1, 0)
  )

  return candles[Math.min(Math.max(targetIndex, 0), candles.length - 1)].time
}

function buildDemoOverlayPayload(candles: Candle[]): Required<ChartOverlayPayload> {
  return {
    smcEvents: sampleSmcEvents.map((event) => ({
      ...event,
      time: remapReferenceTime(event.time, candles),
      fromTime: event.fromTime ? remapReferenceTime(event.fromTime, candles) : undefined,
      price: remapReferencePrice(event.price, candles),
    })),

    dlmLevels: sampleDlmLevels.map((level) => ({
      ...level,
      price: remapReferencePrice(level.price, candles),
    })),

    zones: sampleZones.map((zone) => ({
      ...zone,
      startTime: remapReferenceTime(zone.startTime, candles),
      endTime: remapReferenceTime(zone.endTime, candles),
      top: remapReferencePrice(zone.top, candles),
      bottom: remapReferencePrice(zone.bottom, candles),
    })),

    liquidityEvents: sampleLiquidityEvents.map((event) => ({
      ...event,
      time: remapReferenceTime(event.time, candles),
      fromTime: event.fromTime ? remapReferenceTime(event.fromTime, candles) : undefined,
      price: remapReferencePrice(event.price, candles),
    })),

    dlmConfluenceMarkers: sampleDlmConfluenceMarkers.map((marker) => ({
      ...marker,
      time: remapReferenceTime(marker.time, candles),
      price: remapReferencePrice(marker.price, candles),
    })),

    scoreMarkers: sampleScoreMarkers.map((marker) => ({
      ...marker,
      time: remapReferenceTime(marker.time, candles),
      price: remapReferencePrice(marker.price, candles),
    })),
  }
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

  const normalizedSymbol = String(selectedSymbol ?? '').toUpperCase()
  const normalizedTimeframe = String(selectedTimeframe ?? '').toLowerCase()
  const canonicalSelectedSymbol = getCanonicalSymbol(normalizedSymbol)

  const filtered = signals.filter((signal) => {
    const signalSymbol = String(signal.symbol ?? '').toUpperCase()
    const signalTimeframe = String(signal.timeframe ?? '').toLowerCase()
    const canonicalSignalSymbol = getCanonicalSymbol(signalSymbol)

    const symbolMatch =
      signalSymbol === normalizedSymbol ||
      signalSymbol.includes(normalizedSymbol) ||
      normalizedSymbol.includes(signalSymbol) ||
      canonicalSignalSymbol === canonicalSelectedSymbol

    const timeframeMatch =
      !signalTimeframe ||
      signalTimeframe === normalizedTimeframe

    return symbolMatch && timeframeMatch
  })

  const source = filtered

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
}: EChartsCandlestickChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)

  const [symbol, setSymbol] = useState('MES1!')
  const [timeframe, setTimeframe] = useState('1m')
  const [candleMode, setCandleMode] = useState<CandleMode>('Heikin Ashi')
  const [showSmc, setShowSmc] = useState(true)
  const [showDlm, setShowDlm] = useState(true)
  const [showZones, setShowZones] = useState(true)
  const [showLiquidity, setShowLiquidity] = useState(true)
  const [showScores, setShowScores] = useState(true)

  const liveCandles = useMemo(
    () => buildCandlesFromSignals(recentSignals, symbol, timeframe),
    [recentSignals, symbol, timeframe]
  )
  const usingLiveCandles = liveCandles.length >= 3

  const symbolSampleCandles = useMemo(() => {
    return getSampleCandlesForSymbol(symbol)
  }, [symbol])

  const baseCandles = usingLiveCandles ? liveCandles : symbolSampleCandles

  const demoOverlayPayload = useMemo(() => {
    return buildDemoOverlayPayload(baseCandles)
  }, [baseCandles])

  const overlayPayload = useMemo(
    () => extractOverlayPayload(latestSignal),
    [latestSignal]
  )

  const activeSmcEvents =
    overlayPayload.smcEvents && overlayPayload.smcEvents.length > 0
      ? overlayPayload.smcEvents
      : demoOverlayPayload.smcEvents

  const activeDlmLevels =
    overlayPayload.dlmLevels && overlayPayload.dlmLevels.length > 0
      ? overlayPayload.dlmLevels
      : demoOverlayPayload.dlmLevels

  const activeZones =
    overlayPayload.zones && overlayPayload.zones.length > 0
      ? overlayPayload.zones
      : demoOverlayPayload.zones

  const activeLiquidityEvents =
    overlayPayload.liquidityEvents && overlayPayload.liquidityEvents.length > 0
      ? overlayPayload.liquidityEvents
      : demoOverlayPayload.liquidityEvents

  const activeDlmConfluenceMarkers =
    overlayPayload.dlmConfluenceMarkers &&
    overlayPayload.dlmConfluenceMarkers.length > 0
      ? overlayPayload.dlmConfluenceMarkers
      : demoOverlayPayload.dlmConfluenceMarkers

  const activeScoreMarkers =
    overlayPayload.scoreMarkers && overlayPayload.scoreMarkers.length > 0
      ? overlayPayload.scoreMarkers
      : demoOverlayPayload.scoreMarkers

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
            <option value="MES1!">MES1!</option>
            <option value="ES1!">ES1!</option>
            <option value="BTCUSD">BTCUSD</option>
            <option value="ETHUSD">ETHUSD</option>
            <option value="SPY">SPY</option>
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
              {enableAdvancedOverlays ? 'Chart Engine v3G.1' : 'Chart Engine v2'}
            </div>
          </div>
        )}
      </div>

      <div ref={chartRef} className="h-full w-full flex-1" />
    </div>
  )
}
