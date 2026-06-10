'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'

type RecentSignal = {
  symbol?: string
  timeframe?: string
  primaryTimeframe?: string
  signal?: string
  type?: string
  confidence?: number
  price?: number
  entry?: number
  current?: number
  target?: number
  targetPrice?: number
  takeProfitPrice?: number
  tp1?: number
  pnl?: number
  percent?: number
  status?: string
  createdAt?: string
  mlFeatures?: Record<string, unknown>
  chartMlFeatures?: Record<string, unknown>
  scorecards?: Record<string, unknown>
  chartScorecards?: Record<string, unknown>
  unifiedIntelligence?: Record<string, unknown>
  overlayPayload?: Record<string, unknown>
}

type ChartCardCandle = {
  time?: unknown
  open?: number
  high?: number
  low?: number
  close?: number
  volume?: number
}

type ChartCardStrategySettings = {
  smmaLength?: number
  nrtrMode?: 'Off' | 'ATR-Based' | 'Percentage'
  nrtrAtrLength?: number
  nrtrAtrMultiplier?: number
  nrtrPercent?: number
}

type ChartSignalCardInput = {
  label: string
  symbol?: string
  timeframe?: string
  candles?: ChartCardCandle[]
  latestSignal?: RecentSignal
  activePrice?: number
  settings?: ChartCardStrategySettings
}

type RecentSignalsTableProps = {
  signals: RecentSignal[]
  latestSignal?: RecentSignal
  activeSymbol?: string
  activeTimeframe?: string
  activePrice?: number
  chartCards?: ChartSignalCardInput[]
}

type SignalCardView = {
  id: string
  label: string
  symbol: string
  timeframe: string
  type: 'BUY' | 'SELL' | 'HOLD'
  confidence: number
  confidenceLabel: 'LOW' | 'MEDIUM' | 'HIGH'
  entry: number | null
  target: number | null
  current: number | null
  pnl: number | null
  pnlPercent: number | null
  maxPnl: number | null
  maxPnlPercent: number | null
  bodyText: string
  statusText: string
  updatedAt?: string
}

function normalizeSymbol(value?: string) {
  const raw = String(value ?? 'BTCUSD')
    .trim()
    .toUpperCase()
    .replace('BINANCE:', '')
    .replace('COINBASE:', '')
    .replace('CRYPTO:', '')
    .replace('CME_MINI:', '')
    .replace('CME:', '')

  if (raw === 'MES1' || raw === 'MES1!' || raw.includes('MES')) return 'MES1!'
  if (raw.includes('BTC')) return 'BTCUSD'
  if (raw.includes('ETH')) return 'ETHUSD'
  if (raw.includes('SPY')) return 'SPY'

  return raw || 'BTCUSD'
}

function normalizeTimeframe(value?: string) {
  const raw = String(value ?? '1m').trim().toLowerCase()
  const tf = raw.includes('/') ? raw.split('/')[0]?.trim() ?? raw : raw

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

function timeframeMatches(value: unknown, activeTimeframe: string) {
  const text = String(value ?? '').trim()

  if (text.includes('/')) {
    return text
      .split('/')
      .map((item) => normalizeTimeframe(item.trim()))
      .includes(normalizeTimeframe(activeTimeframe))
  }

  return normalizeTimeframe(text) === normalizeTimeframe(activeTimeframe)
}

function isPriceNearActiveScale(signal: RecentSignal, activePrice?: number) {
  const price = Number(signal.current ?? signal.price ?? signal.entry ?? 0)
  if (!Number.isFinite(price) || price <= 0) return false
  if (!activePrice || !Number.isFinite(activePrice) || activePrice <= 0) return true

  return Math.abs(price - activePrice) / activePrice <= 0.2
}

function normalizeSignalType(value?: string): 'BUY' | 'SELL' | 'HOLD' {
  const type = String(value ?? 'HOLD').toUpperCase()

  if (type.includes('BUY') || type.includes('BULL') || type.includes('LONG')) return 'BUY'
  if (type.includes('SELL') || type.includes('BEAR') || type.includes('SHORT')) return 'SELL'

  return 'HOLD'
}

function isPlaceholderSignal(signal?: RecentSignal) {
  if (!signal) return true

  const symbol = String(signal.symbol ?? '').toUpperCase()
  const status = String(signal.status ?? '').toLowerCase()
  const entry = Number(signal.entry ?? signal.price ?? 0)
  const current = Number(signal.current ?? signal.price ?? 0)

  return (
    symbol === 'WAITING' ||
    status === 'waiting' ||
    (!entry && !current && !Number(signal.confidence ?? 0))
  )
}

function formatPrice(value?: number | null) {
  if (value === null || value === undefined) return '—'

  const numeric = Number(value)

  if (!Number.isFinite(numeric) || numeric <= 0) return '—'
  if (Math.abs(numeric) >= 1000) return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (Math.abs(numeric) >= 100) return numeric.toFixed(2)
  if (Math.abs(numeric) >= 10) return numeric.toFixed(3)

  return numeric.toFixed(4)
}

function formatTime(value?: string) {
  if (!value) return new Date().toLocaleTimeString()

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleTimeString()
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function getSignalClass(type: 'BUY' | 'SELL' | 'HOLD') {
  if (type === 'BUY') return 'border-emerald-500/45 bg-emerald-500/10 text-emerald-400'
  if (type === 'SELL') return 'border-red-500/45 bg-red-500/10 text-red-400'

  return 'border-amber-400/45 bg-amber-400/10 text-amber-300'
}

function getConfidenceLabel(confidence: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (confidence >= 70) return 'HIGH'
  if (confidence >= 45) return 'MEDIUM'
  return 'LOW'
}

function getConfidenceClass(label: 'LOW' | 'MEDIUM' | 'HIGH') {
  if (label === 'HIGH') return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
  if (label === 'MEDIUM') return 'border-amber-400/40 bg-amber-400/15 text-amber-300'
  return 'border-red-500/40 bg-red-500/15 text-red-400'
}

function getLatestClose(candles?: ChartCardCandle[]) {
  if (!Array.isArray(candles) || candles.length === 0) return null

  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const close = Number(candles[index]?.close)
    if (Number.isFinite(close) && close > 0) return close
  }

  return null
}

function calculateAtr(candles?: ChartCardCandle[], length = 14) {
  if (!Array.isArray(candles) || candles.length < 2) return 0

  const valid = candles
    .filter((candle) =>
      Number.isFinite(Number(candle.high)) &&
      Number.isFinite(Number(candle.low)) &&
      Number.isFinite(Number(candle.close))
    )
    .slice(-Math.max(length + 1, 2))

  if (valid.length < 2) return 0

  const trueRanges = valid.slice(1).map((candle, index) => {
    const previousClose = Number(valid[index].close)
    const high = Number(candle.high)
    const low = Number(candle.low)

    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose)
    )
  })

  if (trueRanges.length === 0) return 0

  return trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length
}

function getValidCandles(candles?: ChartCardCandle[]) {
  return Array.isArray(candles)
    ? candles.filter((candle) =>
        Number.isFinite(Number(candle.open)) &&
        Number.isFinite(Number(candle.high)) &&
        Number.isFinite(Number(candle.low)) &&
        Number.isFinite(Number(candle.close))
      )
    : []
}

type NrtrPoint = {
  direction: 1 | -1 | 0
  value: number | null
  buy: boolean
  sell: boolean
}

function calculateSmma(candles?: ChartCardCandle[], length = 20) {
  const valid = getValidCandles(candles)
  const safeLength = Math.max(1, Math.floor(Number(length) || 20))
  let smma: number | null = null
  let runningSum = 0

  for (let index = 0; index < valid.length; index += 1) {
    const close = Number(valid[index].close)
    runningSum += close

    if (index < safeLength - 1) continue

    if (index === safeLength - 1) {
      smma = runningSum / safeLength
    } else if (smma !== null) {
      smma = (smma * (safeLength - 1) + close) / safeLength
    }
  }

  return Number.isFinite(Number(smma)) ? Number(smma) : null
}

function calculateAtrSeries(candles?: ChartCardCandle[], length = 14): Array<number | null> {
  const valid = getValidCandles(candles)
  const safeLength = Math.max(1, Math.floor(Number(length) || 14))
  const atrValues: Array<number | null> = Array(valid.length).fill(null)

  if (valid.length === 0) return atrValues

  const trueRanges = valid.map((candle, index) => {
    const previousClose = index > 0 ? Number(valid[index - 1].close) : Number(candle.close)
    const high = Number(candle.high)
    const low = Number(candle.low)

    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose)
    )
  })

  let seedSum = 0

  for (let index = 0; index < trueRanges.length; index += 1) {
    if (index < safeLength) {
      seedSum += trueRanges[index]
      if (index === safeLength - 1) atrValues[index] = seedSum / safeLength
      continue
    }

    const previousAtr = atrValues[index - 1]
    atrValues[index] = previousAtr === null ? null : (previousAtr * (safeLength - 1) + trueRanges[index]) / safeLength
  }

  return atrValues
}

function calculateNrtrAtr(candles?: ChartCardCandle[], atrLength = 14, multiplier = 3): NrtrPoint[] {
  const valid = getValidCandles(candles)
  const result: NrtrPoint[] = []
  const atrValues = calculateAtrSeries(valid, atrLength)
  const safeMultiplier = Math.max(0.1, Number(multiplier) || 3)
  let finalUpper: number | null = null
  let finalLower: number | null = null
  let previousSuperTrend: number | null = null
  let previousFinalUpper: number | null = null
  let previousFinalLower: number | null = null
  let direction: 1 | -1 | 0 = 0

  for (let index = 0; index < valid.length; index += 1) {
    const candle = valid[index]
    const atr = atrValues[index]
    const previousClose = index > 0 ? Number(valid[index - 1].close) : Number(candle.close)
    const previousDirection = direction

    if (atr === null || !Number.isFinite(atr)) {
      result.push({ direction: 0, value: null, buy: false, sell: false })
      continue
    }

    const high = Number(candle.high)
    const low = Number(candle.low)
    const close = Number(candle.close)
    const hl2 = (high + low) / 2
    const basicUpper = hl2 + safeMultiplier * atr
    const basicLower = hl2 - safeMultiplier * atr

    if (previousFinalUpper === null || previousFinalLower === null) {
      finalUpper = basicUpper
      finalLower = basicLower
    } else {
      finalUpper = basicUpper < previousFinalUpper || previousClose > previousFinalUpper ? basicUpper : previousFinalUpper
      finalLower = basicLower > previousFinalLower || previousClose < previousFinalLower ? basicLower : previousFinalLower
    }

    if (previousSuperTrend === null) {
      direction = close >= hl2 ? 1 : -1
    } else if (previousFinalUpper !== null && Math.abs(previousSuperTrend - previousFinalUpper) <= 1e-10) {
      direction = close > Number(finalUpper) ? 1 : -1
    } else {
      direction = close < Number(finalLower) ? -1 : 1
    }

    const value = direction === 1 ? finalLower : finalUpper
    result.push({
      direction,
      value: Number.isFinite(Number(value)) ? Number(value) : null,
      buy: index > 0 && previousDirection === -1 && direction === 1,
      sell: index > 0 && previousDirection === 1 && direction === -1,
    })

    previousSuperTrend = value
    previousFinalUpper = finalUpper
    previousFinalLower = finalLower
  }

  return result
}

function calculateNrtrPercentage(candles?: ChartCardCandle[], percent = 0.25): NrtrPoint[] {
  const valid = getValidCandles(candles)
  const result: NrtrPoint[] = []
  if (valid.length === 0) return result

  const coefficient = Math.max(0.01, Math.min(20, Number(percent) || 0.25)) / 100
  let trend: 1 | -1 = 1
  let highestPoint = Number(valid[0].high)
  let lowestPoint = Number(valid[0].low)
  let nrtr = highestPoint * (1 - coefficient)

  for (let index = 0; index < valid.length; index += 1) {
    const candle = valid[index]
    const previousTrend = trend
    const high = Number(candle.high)
    const low = Number(candle.low)

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
      direction: trend,
      value: Number.isFinite(nrtr) ? nrtr : null,
      buy: index > 0 && trend === 1 && previousTrend === -1,
      sell: index > 0 && trend === -1 && previousTrend === 1,
    })
  }

  return result
}

function calculateNrtr(candles?: ChartCardCandle[], settings?: ChartCardStrategySettings) {
  if (settings?.nrtrMode === 'Percentage') {
    return calculateNrtrPercentage(candles, settings.nrtrPercent ?? 0.25)
  }

  return calculateNrtrAtr(candles, settings?.nrtrAtrLength ?? 14, settings?.nrtrAtrMultiplier ?? 3)
}

function inferChartTrend(candles?: ChartCardCandle[], settings?: ChartCardStrategySettings) {
  const valid = getValidCandles(candles)

  if (valid.length < 3) {
    return {
      type: 'HOLD' as const,
      confidence: 0,
      momentum: 0,
      source: 'No candle data',
      targetBasis: 0,
    }
  }

  const latest = getLatestClose(valid)
  const lookbackIndex = Math.max(0, valid.length - 6)
  const lookback = Number(valid[lookbackIndex]?.close)
  const atr = calculateAtr(valid, settings?.nrtrAtrLength ?? 14)
  const smma = calculateSmma(valid, settings?.smmaLength ?? 20)
  const nrtrPoints = settings?.nrtrMode === 'Off' ? [] : calculateNrtr(valid, settings)
  const latestNrtr = [...nrtrPoints].reverse().find((point) => point.direction !== 0 && point.value !== null)

  if (!latest || !Number.isFinite(lookback) || lookback <= 0) {
    return {
      type: 'HOLD' as const,
      confidence: 0,
      momentum: 0,
      source: 'No clean price',
      targetBasis: atr,
    }
  }

  const move = latest - lookback
  const normalizedMove = atr > 0 ? move / atr : move / Math.max(Math.abs(latest) * 0.001, 0.01)
  const smmaDirection = smma === null ? 'neutral' : latest > smma ? 'bullish' : latest < smma ? 'bearish' : 'neutral'

  if (latestNrtr) {
    const nrtrType = latestNrtr.direction === 1 ? 'BUY' as const : latestNrtr.direction === -1 ? 'SELL' as const : 'HOLD' as const
    const agreesWithSmma =
      (nrtrType === 'BUY' && smmaDirection === 'bullish') ||
      (nrtrType === 'SELL' && smmaDirection === 'bearish')
    const distance = latestNrtr.value && latest > 0 ? Math.abs(latest - latestNrtr.value) / latest : 0
    const confidence = clampPercent(48 + Math.min(28, Math.abs(normalizedMove) * 8) + (agreesWithSmma ? 18 : 0) + Math.min(12, distance * 1200))

    return {
      type: nrtrType,
      confidence,
      momentum: normalizedMove,
      source: agreesWithSmma ? 'NRTR + SMMA agreement' : 'NRTR active trade',
      targetBasis: Math.max(atr, Math.abs(latest - Number(latestNrtr.value ?? latest))),
    }
  }

  const confidence = clampPercent(35 + Math.min(45, Math.abs(normalizedMove) * 16) + (smmaDirection !== 'neutral' ? 10 : 0))

  if (smmaDirection === 'bullish') {
    return {
      type: 'BUY' as const,
      confidence,
      momentum: normalizedMove,
      source: 'SMMA direction',
      targetBasis: atr,
    }
  }

  if (smmaDirection === 'bearish') {
    return {
      type: 'SELL' as const,
      confidence,
      momentum: normalizedMove,
      source: 'SMMA direction',
      targetBasis: atr,
    }
  }

  if (normalizedMove >= 0.35) {
    return {
      type: 'BUY' as const,
      confidence,
      momentum: normalizedMove,
      source: 'Candle momentum',
      targetBasis: atr,
    }
  }

  if (normalizedMove <= -0.35) {
    return {
      type: 'SELL' as const,
      confidence,
      momentum: normalizedMove,
      source: 'Candle momentum',
      targetBasis: atr,
    }
  }

  return {
    type: 'HOLD' as const,
    confidence: clampPercent(Math.max(25, confidence - 15)),
    momentum: normalizedMove,
    source: 'No clean direction',
    targetBasis: atr,
  }
}

function isSignalLinkedToActiveChart(signal: RecentSignal, activeSymbol: string, activeTimeframe: string, activePrice?: number) {
  const symbol = normalizeSymbol(signal.symbol)
  const timeframe = signal.primaryTimeframe ?? signal.timeframe

  return (
    symbol === normalizeSymbol(activeSymbol) &&
    timeframeMatches(timeframe, activeTimeframe) &&
    isPriceNearActiveScale(signal, activePrice)
  )
}


function resolveLiveCurrentPrice(
  activePrice?: number,
  candles?: ChartCardCandle[],
  latestSignal?: RecentSignal,
  fallbackSignal?: RecentSignal
) {
  const candidates = [
    activePrice,
    getLatestClose(candles),
    latestSignal?.current,
    latestSignal?.price,
    fallbackSignal?.current,
    fallbackSignal?.price,
    fallbackSignal?.entry,
    latestSignal?.entry,
  ]

  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value) && value > 0) return value
  }

  return NaN
}

function resolveLockedEntryPrice(
  current: number,
  latestSignal?: RecentSignal,
  fallbackSignal?: RecentSignal
) {
  const candidates = [
    latestSignal?.entry,
    fallbackSignal?.entry,
    latestSignal?.price,
    fallbackSignal?.price,
  ]

  for (const candidate of candidates) {
    const value = Number(candidate)
    if (
      Number.isFinite(value) &&
      value > 0 &&
      Number.isFinite(current) &&
      current > 0 &&
      Math.abs(value - current) / current <= 0.2
    ) {
      return value
    }
  }

  return Number.isFinite(current) && current > 0 ? current : null
}


function readNumberPath(source: unknown, path: string[]) {
  let current: unknown = source

  for (const key of path) {
    if (!current || typeof current !== 'object') return NaN
    current = (current as Record<string, unknown>)[key]
  }

  const numeric = Number(current)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : NaN
}

function resolveChartNrtrEntryPrice(
  latestSignal?: RecentSignal,
  fallbackSignal?: RecentSignal,
  currentPrice?: number
) {
  const sources = [latestSignal as unknown, fallbackSignal as unknown].filter(Boolean)

  const paths = [
    ['nrtrEntry'],
    ['nrtrEntryPrice'],
    ['entryPrice'],
    ['entry'],
    ['price'],

    ['strategy', 'entry'],
    ['strategy', 'entryPrice'],
    ['strategy', 'nrtrEntry'],
    ['strategy', 'nrtrEntryPrice'],

    ['chartStrategy', 'entry'],
    ['chartStrategy', 'entryPrice'],
    ['chartStrategy', 'nrtrEntry'],
    ['chartStrategy', 'nrtrEntryPrice'],

    ['nrtr', 'entry'],
    ['nrtr', 'entryPrice'],
    ['nrtr', 'signalEntry'],
    ['nrtr', 'triggerPrice'],
    ['nrtr', 'flipPrice'],

    ['scorecards', 'nrtr', 'entry'],
    ['scorecards', 'nrtr', 'entryPrice'],
    ['scorecards', 'nrtrStrategy', 'entry'],
    ['scorecards', 'nrtrStrategy', 'entryPrice'],
    ['scorecards', 'nrtrMatrix', 'entry'],
    ['scorecards', 'nrtrMatrix', 'entryPrice'],

    ['chartScorecards', 'nrtr', 'entry'],
    ['chartScorecards', 'nrtr', 'entryPrice'],
    ['chartScorecards', 'nrtrStrategy', 'entry'],
    ['chartScorecards', 'nrtrStrategy', 'entryPrice'],
    ['chartScorecards', 'nrtrMatrix', 'entry'],
    ['chartScorecards', 'nrtrMatrix', 'entryPrice'],
  ]

  for (const source of sources) {
    for (const path of paths) {
      const candidate = readNumberPath(source, path)
      if (!Number.isFinite(candidate) || candidate <= 0) continue

      if (currentPrice && Number.isFinite(currentPrice) && currentPrice > 0) {
        const distance = Math.abs(candidate - currentPrice) / currentPrice
        if (distance > 0.35) continue
      }

      return candidate
    }
  }

  return null
}


function calculateRecentSignalsAtr(candles: ChartCardCandle[], length: number) {
  if (!Array.isArray(candles) || candles.length < 2) return []

  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return Number(candle.high) - Number(candle.low)

    const previousClose = Number(candles[index - 1]?.close)
    const high = Number(candle.high)
    const low = Number(candle.low)

    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    )
  })

  return candles.map((_, index) => {
    if (index < length) return NaN

    const sample = trueRanges.slice(index - length + 1, index + 1)
    return sample.reduce((sum, value) => sum + value, 0) / sample.length
  })
}


function getRecentSignalCandleTime(candle?: ChartCardCandle): string | number | undefined {
  const value = candle?.time

  if (typeof value === 'string' || typeof value === 'number') return value

  return undefined
}

function calculateRecentSignalsNrtrDirection(candles: ChartCardCandle[], settings?: ChartCardStrategySettings) {
  if (!Array.isArray(candles) || candles.length < 3 || !settings || settings.nrtrMode === 'Off') {
    return []
  }

  const atr = calculateRecentSignalsAtr(candles, Math.max(1, settings.nrtrAtrLength ?? 5))
  const result: Array<{
    index: number
    time?: number | string
    direction: 1 | -1 | 0
    stop: number
    entrySignal: 1 | -1 | 0
  }> = []

  let direction: 1 | -1 | 0 = 0
  let trailingStop = Number(candles[0]?.close ?? 0)

  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index]
    const previous = candles[index - 1]
    const close = Number(candle.close)
    const previousClose = Number(previous.close)

    if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(previousClose)) {
      result.push({
        index,
        time: getRecentSignalCandleTime(candle),
        direction,
        stop: trailingStop,
        entrySignal: 0,
      })
      continue
    }

    const distance =
      settings.nrtrMode === 'Percentage'
        ? close * ((settings.nrtrPercent ?? 0.25) / 100)
        : Number.isFinite(atr[index])
          ? atr[index] * (settings.nrtrAtrMultiplier ?? 1.25)
          : Math.max(close * 0.001, 0.25)

    if (!Number.isFinite(distance) || distance <= 0) {
      result.push({
        index,
        time: getRecentSignalCandleTime(candle),
        direction,
        stop: trailingStop,
        entrySignal: 0,
      })
      continue
    }

    if (direction === 0) {
      direction = close >= previousClose ? 1 : -1
      trailingStop = direction === 1 ? close - distance : close + distance
      result.push({
        index,
        time: getRecentSignalCandleTime(candle),
        direction,
        stop: trailingStop,
        entrySignal: direction,
      })
      continue
    }

    let entrySignal: 1 | -1 | 0 = 0

    if (direction === 1) {
      const candidateStop = Math.max(trailingStop, close - distance)

      if (close < candidateStop) {
        direction = -1
        trailingStop = close + distance
        entrySignal = -1
      } else {
        trailingStop = candidateStop
      }
    } else {
      const candidateStop = Math.min(trailingStop, close + distance)

      if (close > candidateStop) {
        direction = 1
        trailingStop = close - distance
        entrySignal = 1
      } else {
        trailingStop = candidateStop
      }
    }

    result.push({
      index,
      time: getRecentSignalCandleTime(candle),
      direction,
      stop: trailingStop,
      entrySignal,
    })
  }

  return result
}

function getActiveNrtrTradeFromCandles(candles?: ChartCardCandle[], settings?: ChartCardStrategySettings) {
  if (!Array.isArray(candles) || candles.length < 3 || !settings || settings.nrtrMode === 'Off') {
    return null
  }

  const nrtr = calculateRecentSignalsNrtrDirection(candles, settings)
  if (!nrtr.length) return null

  let activeTrade: {
    side: 'BUY' | 'SELL'
    entry: number
    entryIndex: number
    entryTime?: number | string
    stop: number
  } | null = null

  for (const point of nrtr) {
    if (!point.entrySignal) continue

    const candle = candles[point.index]
    const entry = Number(candle?.close)

    if (!Number.isFinite(entry) || entry <= 0) continue

    activeTrade = {
      side: point.entrySignal === 1 ? 'BUY' : 'SELL',
      entry,
      entryIndex: point.index,
      entryTime: getRecentSignalCandleTime(candle),
      stop: point.stop,
    }
  }

  if (!activeTrade) return null

  return {
    ...activeTrade,
    currentDirection: nrtr[nrtr.length - 1]?.direction ?? 0,
    currentStop: nrtr[nrtr.length - 1]?.stop ?? activeTrade.stop,
  }
}

function resolveChartSignalEntryPrice({
  latestSignal,
  fallbackSignal,
  currentPrice,
  candles,
  settings,
  signalType,
}: {
  latestSignal?: RecentSignal
  fallbackSignal?: RecentSignal
  currentPrice?: number
  candles?: ChartCardCandle[]
  settings?: ChartCardStrategySettings
  signalType: 'BUY' | 'SELL' | 'HOLD'
}) {
  const activeNrtrTrade = getActiveNrtrTradeFromCandles(candles, settings)

  // Highest priority: calculate the chart's active NRTR trade entry directly from
  // that chart's candles/settings. This keeps Recent Signals aligned with strategy tables.
  if (activeNrtrTrade && activeNrtrTrade.side === signalType && activeNrtrTrade.entry > 0) {
    return activeNrtrTrade.entry
  }

  const nrtrEntry = resolveChartNrtrEntryPrice(latestSignal, fallbackSignal, currentPrice)

  if (nrtrEntry && nrtrEntry > 0) return nrtrEntry

  const lockedSignalEntry = resolveLockedEntryPrice(
    Number(currentPrice ?? NaN),
    latestSignal,
    fallbackSignal,
  )

  if (
    lockedSignalEntry &&
    lockedSignalEntry > 0 &&
    currentPrice &&
    Math.abs(lockedSignalEntry - currentPrice) / currentPrice > 0.00005
  ) {
    return lockedSignalEntry
  }

  // Last resort: use the previous candle close as the latest chart-trigger entry,
  // not the current live price. This prevents Entry and Current from always matching.
  if (Array.isArray(candles) && candles.length >= 2) {
    const previousClose = Number(candles[candles.length - 2]?.close)
    if (Number.isFinite(previousClose) && previousClose > 0) return previousClose
  }

  if (Array.isArray(candles) && candles.length >= 1) {
    const latestOpen = Number(candles[candles.length - 1]?.open)
    if (Number.isFinite(latestOpen) && latestOpen > 0) return latestOpen
  }

  return null
}

function calculateDirectionalPnl({
  entry,
  current,
  signalType,
  symbol,
}: {
  entry: number | null
  current: number | null
  signalType: 'BUY' | 'SELL' | 'HOLD'
  symbol: string
}) {
  if (!entry || !current || entry <= 0 || current <= 0 || signalType === 'HOLD') {
    return { pnl: null, pnlPercent: null }
  }

  const direction = signalType === 'BUY' ? 1 : -1
  const pointMove = (current - entry) * direction
  const pointValue =
    symbol.includes('MES') ? 5 :
    symbol.includes('ES') ? 50 :
    1

  return {
    pnl: pointMove * pointValue,
    pnlPercent: (pointMove / entry) * 100,
  }
}

function calculateMaxDirectionalPnl({
  entry,
  target,
  signalType,
  symbol,
}: {
  entry: number | null
  target: number | null
  signalType: 'BUY' | 'SELL' | 'HOLD'
  symbol: string
}) {
  if (!entry || !target || entry <= 0 || target <= 0 || signalType === 'HOLD') {
    return { maxPnl: null, maxPnlPercent: null }
  }

  const direction = signalType === 'BUY' ? 1 : -1
  const pointMove = (target - entry) * direction
  const pointValue =
    symbol.includes('MES') ? 5 :
    symbol.includes('ES') ? 50 :
    1

  return {
    maxPnl: pointMove * pointValue,
    maxPnlPercent: (pointMove / entry) * 100,
  }
}

function formatPnl(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const numeric = Number(value)
  const sign = numeric > 0 ? '+' : ''
  return `${sign}${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function formatPnlPercent(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const numeric = Number(value)
  const sign = numeric > 0 ? '+' : ''
  return `${sign}${numeric.toFixed(2)}%`
}

function buildLiveSnapshot(latestSignal?: RecentSignal, activeSymbol = 'BTCUSD', activeTimeframe = '1m', activePrice?: number): RecentSignal {
  const liveCurrent = Number(activePrice ?? latestSignal?.current ?? latestSignal?.price ?? latestSignal?.entry ?? 0)
  const lockedEntry = resolveLockedEntryPrice(liveCurrent, latestSignal, latestSignal)
  const type = normalizeSignalType(latestSignal?.signal ?? latestSignal?.type)

  return {
    symbol: normalizeSymbol(activeSymbol),
    timeframe: normalizeTimeframe(activeTimeframe),
    signal: type,
    confidence: Number(latestSignal?.confidence ?? 0),
    entry: Number(lockedEntry ?? liveCurrent),
    current: liveCurrent,
    price: liveCurrent,
    pnl: 0,
    percent: 0,
    status: 'Live Snapshot',
    createdAt: latestSignal?.createdAt ?? new Date().toISOString(),
  }
}

function getNumberFromPath(source: unknown, path: string[]) {
  let current: unknown = source

  for (const key of path) {
    if (!current || typeof current !== 'object') return NaN
    current = (current as Record<string, unknown>)[key]
  }

  const number = Number(current)
  return Number.isFinite(number) ? number : NaN
}

function getTrueMlSmcTargetPrice(
  latestSignal?: RecentSignal,
  fallbackSignal?: RecentSignal,
  currentPrice?: number,
  signalType?: 'BUY' | 'SELL' | 'HOLD'
) {
  const sources = [latestSignal as unknown, fallbackSignal as unknown].filter(Boolean)

  const targetPaths = [
    // New Target ML payloads.
    ['targetMl', 'targetPrice'],
    ['targetMl', 'target'],
    ['targetMl', 'takeProfitPrice'],
    ['targetMl', 'tp1'],
    ['targetMl', 'finalTargetPrice'],
    ['targetMl', 'overallTargetPrice'],

    ['targetPlan', 'targetPrice'],
    ['targetPlan', 'target'],
    ['targetPlan', 'takeProfitPrice'],
    ['targetPlan', 'tp1'],
    ['targetPlan', 'finalTargetPrice'],
    ['targetPlan', 'overallTargetPrice'],

    // New per-ghost target fields.
    ['ghostTargetPrice'],
    ['projectedTargetPrice'],
    ['finalTargetPrice'],
    ['overallTargetPrice'],

    ['mlFeatures', 'targetPrice'],
    ['mlFeatures', 'target_price'],
    ['mlFeatures', 'takeProfitPrice'],
    ['mlFeatures', 'take_profit_price'],
    ['mlFeatures', 'tp1'],
    ['mlFeatures', 'tp1Price'],

    ['chartMlFeatures', 'targetPrice'],
    ['chartMlFeatures', 'target_price'],
    ['chartMlFeatures', 'takeProfitPrice'],
    ['chartMlFeatures', 'take_profit_price'],
    ['chartMlFeatures', 'tp1'],
    ['chartMlFeatures', 'tp1Price'],

    ['scorecards', 'overall', 'targetPrice'],
    ['scorecards', 'overall', 'target_price'],
    ['scorecards', 'overall', 'takeProfitPrice'],
    ['scorecards', 'overall', 'take_profit_price'],
    ['scorecards', 'overall', 'tp1'],
    ['scorecards', 'overall', 'tp1Price'],

    ['chartScorecards', 'overall', 'targetPrice'],
    ['chartScorecards', 'overall', 'target_price'],
    ['chartScorecards', 'overall', 'takeProfitPrice'],
    ['chartScorecards', 'overall', 'take_profit_price'],
    ['chartScorecards', 'overall', 'tp1'],
    ['chartScorecards', 'overall', 'tp1Price'],

    ['chartScorecards', 'smc', 'targetPrice'],
    ['chartScorecards', 'smc', 'target_price'],
    ['chartScorecards', 'smc', 'takeProfitPrice'],
    ['chartScorecards', 'smc', 'tp1'],

    ['chartScorecards', 'ghost', 'targetPrice'],
    ['chartScorecards', 'ghost', 'target_price'],
    ['chartScorecards', 'ghost', 'takeProfitPrice'],
    ['chartScorecards', 'ghost', 'tp1'],

    ['unifiedIntelligence', 'targetMl', 'targetPrice'],
    ['unifiedIntelligence', 'targetMl', 'target'],
    ['unifiedIntelligence', 'targetPlan', 'targetPrice'],
    ['unifiedIntelligence', 'targetPlan', 'target'],
    ['unifiedIntelligence', 'finalTargetPrice'],
    ['unifiedIntelligence', 'overallTargetPrice'],

    ['unifiedIntelligence', 'targetPrice'],
    ['unifiedIntelligence', 'target_price'],
    ['unifiedIntelligence', 'takeProfitPrice'],
    ['unifiedIntelligence', 'tp1'],
    ['unifiedIntelligence', 'tradePlan', 'targetPrice'],
    ['unifiedIntelligence', 'tradePlan', 'target_price'],
    ['unifiedIntelligence', 'tradePlan', 'takeProfitPrice'],
    ['unifiedIntelligence', 'tradePlan', 'take_profit_price'],
    ['unifiedIntelligence', 'tradePlan', 'tp1'],
    ['unifiedIntelligence', 'tradePlan', 'tp1Price'],

    ['overlayPayload', 'targetMl', 'targetPrice'],
    ['overlayPayload', 'targetMl', 'target'],
    ['overlayPayload', 'targetMl', 'takeProfitPrice'],
    ['overlayPayload', 'targetMl', 'tp1'],
    ['overlayPayload', 'targetPlan', 'targetPrice'],
    ['overlayPayload', 'targetPlan', 'target'],
    ['overlayPayload', 'targetPlan', 'takeProfitPrice'],
    ['overlayPayload', 'targetPlan', 'tp1'],
    ['overlayPayload', 'finalTargetPrice'],
    ['overlayPayload', 'overallTargetPrice'],

    ['overlayPayload', 'targetPrice'],
    ['overlayPayload', 'target_price'],
    ['overlayPayload', 'takeProfitPrice'],
    ['overlayPayload', 'tp1'],
    ['overlayPayload', 'tradePlan', 'targetPrice'],
    ['overlayPayload', 'tradePlan', 'target_price'],
    ['overlayPayload', 'tradePlan', 'takeProfitPrice'],
    ['overlayPayload', 'tradePlan', 'take_profit_price'],
    ['overlayPayload', 'tradePlan', 'tp1'],
    ['overlayPayload', 'tradePlan', 'tp1Price'],

    ['targetPrice'],
    ['target'],
    ['takeProfitPrice'],
    ['tp1'],
    ['tp1Price'],
  ]

  for (const source of sources) {
    for (const path of targetPaths) {
      const candidate = getNumberFromPath(source, path)

      if (!Number.isFinite(candidate) || candidate <= 0) continue

      if (currentPrice && Number.isFinite(currentPrice) && currentPrice > 0) {
        const distance = Math.abs(candidate - currentPrice) / currentPrice

        // Reject obviously wrong scale values.
        if (distance > 0.35) continue

        // True targets must be directional. A BUY target should be above price,
        // and a SELL target should be below price.
        if (signalType === 'BUY' && candidate <= currentPrice) continue
        if (signalType === 'SELL' && candidate >= currentPrice) continue
      }

      return candidate
    }
  }

  return null
}

function buildCardFromChart(input: ChartSignalCardInput, fallbackSignal?: RecentSignal): SignalCardView {
  const symbol = normalizeSymbol(input.symbol ?? fallbackSignal?.symbol)
  const timeframe = normalizeTimeframe(input.timeframe ?? fallbackSignal?.primaryTimeframe ?? fallbackSignal?.timeframe)

  // Current Price follows live active chart price first.
  const current = Number(resolveLiveCurrentPrice(input.activePrice, input.candles, input.latestSignal, fallbackSignal))
  const hasCurrent = Number.isFinite(current) && current > 0
  const trend = inferChartTrend(input.candles, input.settings)

  const activeNrtrTradeForType = getActiveNrtrTradeFromCandles(input.candles, input.settings)
  const signalType = normalizeSignalType(input.latestSignal?.signal ?? input.latestSignal?.type ?? fallbackSignal?.signal ?? fallbackSignal?.type)
  const type =
    activeNrtrTradeForType?.side ??
    (input.label.toLowerCase().includes('main') && signalType !== 'HOLD' ? signalType : trend.type)
  const signalConfidence = Number(input.latestSignal?.confidence ?? fallbackSignal?.confidence ?? 0)
  const confidence = clampPercent(
    input.label.toLowerCase().includes('main')
      ? Math.max(trend.confidence, Number.isFinite(signalConfidence) ? signalConfidence : 0)
      : trend.confidence
  )
  const confidenceLabel = getConfidenceLabel(confidence)

  // Entry comes from chart strategy/NRTR trigger first, not live current.
  const entry = resolveChartSignalEntryPrice({
    latestSignal: input.latestSignal,
    fallbackSignal,
    currentPrice: hasCurrent ? current : undefined,
    candles: input.candles,
    settings: input.settings,
    signalType: type,
  })

  // True target rule:
  // Do NOT generate synthetic targets from ATR/NRTR/SMMA here.
  // The target must come from the ML/SMC payload. If the backend/system has not
  // produced a target yet, show "—" instead of inventing one.
  const target = getTrueMlSmcTargetPrice(
    input.latestSignal,
    fallbackSignal,
    hasCurrent ? current : undefined,
    type
  )

  const pnlData = calculateDirectionalPnl({
    entry,
    current: hasCurrent ? current : null,
    signalType: type,
    symbol,
  })

  const maxPnlData = calculateMaxDirectionalPnl({
    entry,
    target,
    signalType: type,
    symbol,
  })

  const statusText = type === 'BUY'
    ? 'Bullish chart signal'
    : type === 'SELL'
      ? 'Bearish chart signal'
      : 'Hold / no clean signal'

  const settingsText = input.settings
    ? `Settings: SMMA ${input.settings.smmaLength ?? 20}, ${input.settings.nrtrMode ?? 'ATR-Based'} ${input.settings.nrtrMode === 'Percentage' ? `${input.settings.nrtrPercent ?? 0.25}%` : `${input.settings.nrtrAtrLength ?? 14} x${input.settings.nrtrAtrMultiplier ?? 3}`}.`
    : ''

  const targetText = target === null
    ? 'Target waiting for ML/SMC.'
    : 'Target from ML/SMC.'

  const bodyText = input.label.toLowerCase().includes('main')
    ? `Main chart signal card. ${trend.source}. ${targetText} ${settingsText}`
    : `Mini chart confirmation card. ${trend.source}. ${targetText} ${settingsText}`

  return {
    id: `${input.label}-${symbol}-${timeframe}`,
    label: input.label,
    symbol,
    timeframe,
    type,
    confidence,
    confidenceLabel,
    entry,
    target,
    current: hasCurrent ? current : null,
    pnl: pnlData.pnl,
    pnlPercent: pnlData.pnlPercent,
    maxPnl: maxPnlData.maxPnl,
    maxPnlPercent: maxPnlData.maxPnlPercent,
    bodyText,
    statusText,
    updatedAt: input.latestSignal?.createdAt ?? fallbackSignal?.createdAt,
  }
}

function buildFallbackCards(
  latestSignal: RecentSignal | undefined,
  activeSymbol: string | undefined,
  activeTimeframe: string | undefined,
  activePrice: number | undefined
) {
  const symbol = normalizeSymbol(activeSymbol ?? latestSignal?.symbol)
  const timeframe = normalizeTimeframe(activeTimeframe ?? latestSignal?.primaryTimeframe ?? latestSignal?.timeframe)

  return [
    buildCardFromChart({ label: 'Main Chart', symbol, timeframe, latestSignal, activePrice }, latestSignal),
    buildCardFromChart({ label: 'Mini Chart 1', symbol, timeframe: '5m', latestSignal, activePrice }, latestSignal),
    buildCardFromChart({ label: 'Mini Chart 2', symbol, timeframe: '15m', latestSignal, activePrice }, latestSignal),
  ]
}

function SignalScoreCard({ card }: { card: SignalCardView }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex min-h-[300px] flex-col rounded-2xl border border-dark-600 bg-dark-900/45 p-6 shadow-lg"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">{card.label}</p>
          <h3 className="mt-2 text-2xl font-black text-white">{card.symbol}</h3>
          <p className="mt-1 text-sm font-semibold text-gray-500">{card.timeframe}</p>
        </div>

        <div className={`rounded-lg border px-4 py-3 text-lg font-black ${getSignalClass(card.type)}`}>
          {card.type === 'BUY' ? '↗ BUY' : card.type === 'SELL' ? '↘ SELL' : '— HOLD'}
        </div>
      </div>

      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-semibold text-gray-400">Entry</span>
          <span className="text-lg font-black text-white">{formatPrice(card.entry)}</span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-semibold text-gray-400">Target</span>
          <span className="text-lg font-black text-white">{formatPrice(card.target)}</span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-semibold text-gray-400">Current Price</span>
          <span className="text-lg font-black text-white">{formatPrice(card.current)}</span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-semibold text-gray-400">P&L</span>
          <span className={`text-lg font-black ${
            Number(card.pnl ?? 0) > 0
              ? 'text-emerald-300'
              : Number(card.pnl ?? 0) < 0
                ? 'text-red-300'
                : 'text-white'
          }`}>
            {formatPnl(card.pnl)} <span className="text-sm text-gray-400">({formatPnlPercent(card.pnlPercent)})</span>
          </span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-semibold text-gray-400">Max P&L</span>
          <span className={`text-lg font-black ${
            Number(card.maxPnl ?? 0) > 0
              ? 'text-emerald-300'
              : Number(card.maxPnl ?? 0) < 0
                ? 'text-red-300'
                : 'text-white'
          }`}>
            {formatPnl(card.maxPnl)} <span className="text-sm text-gray-400">({formatPnlPercent(card.maxPnlPercent)})</span>
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-base font-semibold text-gray-400">Confidence</span>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-black ${getConfidenceClass(card.confidenceLabel)}`}>
              {card.confidenceLabel}
            </span>
            <span className="text-sm font-bold text-gray-300">{card.confidence}%</span>
          </div>
        </div>
      </div>

      <div className="my-5 h-px bg-dark-600" />

      <p className="min-h-[64px] flex-1 text-sm font-medium leading-6 text-gray-400">
        {card.statusText}. {card.bodyText}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button className="rounded-lg border border-dark-600 bg-dark-900/70 px-3 py-3 text-sm font-bold text-gray-300 hover:border-emerald-400/50 hover:text-emerald-300">
          ↙ Chart
        </button>
        <button className="rounded-lg border border-dark-600 bg-dark-900/70 px-3 py-3 text-sm font-bold text-gray-300 hover:border-amber-400/50 hover:text-amber-300">
          ↗ Paper Trade
        </button>
      </div>
    </motion.div>
  )
}

export default function RecentSignalsTable({
  signals,
  latestSignal,
  activeSymbol,
  activeTimeframe,
  activePrice,
  chartCards,
}: RecentSignalsTableProps) {
  const symbol = normalizeSymbol(activeSymbol ?? latestSignal?.symbol)
  const timeframe = normalizeTimeframe(activeTimeframe ?? latestSignal?.primaryTimeframe ?? latestSignal?.timeframe)

  const displaySignal = useMemo(() => {
    const cleanSignals = Array.isArray(signals)
      ? signals.filter((signal) => !isPlaceholderSignal(signal))
      : []

    const linkedSignals = cleanSignals.filter((signal) =>
      isSignalLinkedToActiveChart(signal, symbol, timeframe, activePrice)
    )

    return linkedSignals[0] ?? buildLiveSnapshot(latestSignal, symbol, timeframe, activePrice)
  }, [signals, latestSignal, symbol, timeframe, activePrice])

  const cards = useMemo(() => {
    if (Array.isArray(chartCards) && chartCards.length > 0) {
      return chartCards.slice(0, 3).map((card) =>
        buildCardFromChart(
          {
            ...card,
            activePrice: activePrice ?? card.activePrice,
            latestSignal: card.latestSignal ?? displaySignal,
          },
          displaySignal
        )
      )
    }

    return buildFallbackCards(displaySignal, symbol, timeframe, activePrice)
  }, [chartCards, displaySignal, symbol, timeframe, activePrice])

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Recent Signals</h2>
          <p className="mt-1 text-xs text-gray-500">
            3 chart signal cards • main chart + mini confirmations • {symbol} • {timeframe}
          </p>
        </div>

        <div className="rounded-lg border border-dark-600 bg-dark-900/40 px-3 py-2 text-right">
          <p className="text-xs text-gray-500">Updated</p>
          <p className="text-sm font-bold text-white">{formatTime(displaySignal.createdAt)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {cards.map((card) => (
          <SignalScoreCard key={card.id} card={card} />
        ))}
      </div>
    </motion.div>
  )
}
