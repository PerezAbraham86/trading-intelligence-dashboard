'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'

type TradingSignal = {
  eventType?: string
  symbol?: string
  timeframe?: string
  signal?: string
  confidence?: number
  bullScore?: number
  bearScore?: number
  netBias?: number
  smc?: string
  alphax?: string
  ghost?: string
  openInterest?: string
  footprint?: string
  session?: string
  fredMacro?: string
  finraShortVolume?: string
  cot?: string

  // Python technical meter payload. This lets Market Sentiment use the same
  // technical source that Factor Confirmation already shows.
  indicators?: SentimentIndicator[]
  technicalIndicators?: SentimentIndicator[]
  technicalMeter?: SentimentIndicator[]
  factors?: SentimentIndicator[]
  technicalSentiment?: Partial<SentimentData>
  sentiment?: Partial<SentimentData>
}

type SentimentIndicator = {
  name: string
  value: number
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | string
}

type SentimentData = {
  eventType: string
  symbol: string
  timeframe: string
  sentiment: number
  sentimentStatus: string
  bearCount: number
  neutralCount: number
  bullCount: number
  bearPct: number
  neutralPct: number
  bullPct: number
  activeCount: number
  price?: number
  time?: number
  createdAt?: string
  indicators?: SentimentIndicator[]
  technicalIndicators?: SentimentIndicator[]
  technicalMeter?: SentimentIndicator[]
  factors?: SentimentIndicator[]
}

type MarketSentimentGaugeProps = {
  signal?: TradingSignal
  technicalSentiment?: SentimentData | null
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://trading-intelligence-dashboard.onrender.com'

const DEFAULT_SENTIMENT: SentimentData = {
  eventType: 'SENTIMENT_UPDATE',
  symbol: 'WAITING',
  timeframe: 'Waiting',
  sentiment: 50,
  sentimentStatus: 'Waiting',
  bearCount: 0,
  neutralCount: 0,
  bullCount: 0,
  bearPct: 0,
  neutralPct: 0,
  bullPct: 0,
  activeCount: 0,
  price: 0,
}

const TECHNICAL_ORDER = [
  'RSI',
  'Stochastic',
  'Stoch RSI',
  'CCI',
  'Bull Bear Power',
  'Momentum',
  'Moving Average',
  'VWAP',
  'Bollinger Bands',
  'Supertrend',
  'Linear Regression',
  'Market Structure',
]

function normalizeSymbol(value: unknown) {
  return String(value ?? 'WAITING')
    .trim()
    .toUpperCase()
    .replace('BINANCE:', '')
    .replace('COINBASE:', '')
    .replace('CRYPTO:', '')
    .replace('CME_MINI:', '')
    .replace('CME:', '')
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

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function asIndicatorArray(value: unknown): SentimentIndicator[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null

      const raw = item as Record<string, unknown>
      const name = String(raw.name ?? raw.factor ?? raw.label ?? raw.indicator ?? '').trim()

      if (!name) return null

      const value = Number(raw.value ?? raw.strength ?? raw.score ?? 50)
      const rawSignal = String(raw.signal ?? raw.status ?? raw.side ?? '').toUpperCase()
      const signal =
        rawSignal === 'BULLISH' || rawSignal === 'BEARISH' || rawSignal === 'NEUTRAL'
          ? rawSignal
          : value > 60
            ? 'BULLISH'
            : value < 40
              ? 'BEARISH'
              : 'NEUTRAL'

      return {
        name,
        value: clamp(value),
        signal,
      }
    })
    .filter((item): item is SentimentIndicator => Boolean(item))
}

function extractTechnicalIndicators(data: SentimentData | Partial<SentimentData> | null | undefined): SentimentIndicator[] {
  if (!data) return []

  const merged = [
    ...asIndicatorArray(data.indicators),
    ...asIndicatorArray(data.technicalIndicators),
    ...asIndicatorArray(data.technicalMeter),
    ...asIndicatorArray(data.factors),
  ]

  const byName = new Map<string, SentimentIndicator>()

  for (const indicator of merged) {
    const key = indicator.name.trim().toLowerCase()
    if (!byName.has(key)) {
      byName.set(key, indicator)
    }
  }

  const sorted: SentimentIndicator[] = []

  for (const expectedName of TECHNICAL_ORDER) {
    const found = Array.from(byName.values()).find(
      (indicator) => indicator.name.trim().toLowerCase() === expectedName.toLowerCase()
    )

    if (found) sorted.push(found)
  }

  for (const indicator of byName.values()) {
    if (!sorted.some((item) => item.name.toLowerCase() === indicator.name.toLowerCase())) {
      sorted.push(indicator)
    }
  }

  return sorted
}

function buildTechnicalSentimentFromSignal(
  signal: TradingSignal | undefined,
  selectedSymbol: string,
  selectedTimeframe: string
): SentimentData | null {
  if (!signal) return null

  const signalRecord = signal as unknown as Record<string, unknown>
  const nestedTechnical =
    signalRecord.technicalSentiment && typeof signalRecord.technicalSentiment === 'object'
      ? (signalRecord.technicalSentiment as Partial<SentimentData>)
      : signalRecord.sentiment && typeof signalRecord.sentiment === 'object'
        ? (signalRecord.sentiment as Partial<SentimentData>)
        : null

  const candidate: SentimentData = {
    eventType: 'PYTHON_TECHNICAL_SENTIMENT',
    symbol: selectedSymbol,
    timeframe: selectedTimeframe,
    sentiment: Number(nestedTechnical?.sentiment ?? signalRecord.sentiment ?? 50),
    sentimentStatus: String(nestedTechnical?.sentimentStatus ?? signalRecord.sentimentStatus ?? 'Mixed'),
    bearCount: Number(nestedTechnical?.bearCount ?? signalRecord.bearCount ?? 0),
    neutralCount: Number(nestedTechnical?.neutralCount ?? signalRecord.neutralCount ?? 0),
    bullCount: Number(nestedTechnical?.bullCount ?? signalRecord.bullCount ?? 0),
    bearPct: Number(nestedTechnical?.bearPct ?? signalRecord.bearPct ?? 0),
    neutralPct: Number(nestedTechnical?.neutralPct ?? signalRecord.neutralPct ?? 0),
    bullPct: Number(nestedTechnical?.bullPct ?? signalRecord.bullPct ?? 0),
    activeCount: Number(nestedTechnical?.activeCount ?? signalRecord.activeCount ?? 0),
    price: Number(signalRecord.price ?? signalRecord.current ?? 0),
    indicators: [
      ...asIndicatorArray(signal.indicators),
      ...asIndicatorArray(signal.technicalIndicators),
      ...asIndicatorArray(signal.technicalMeter),
      ...asIndicatorArray(signal.factors),
      ...asIndicatorArray(nestedTechnical?.indicators),
      ...asIndicatorArray(nestedTechnical?.technicalIndicators),
      ...asIndicatorArray(nestedTechnical?.technicalMeter),
      ...asIndicatorArray(nestedTechnical?.factors),
    ],
  }

  return extractTechnicalIndicators(candidate).length > 0 ? candidate : null
}

function isBullishText(value?: string) {
  const lower = String(value ?? '').toLowerCase()

  return (
    lower.includes('bull') ||
    lower.includes('buy') ||
    lower.includes('up') ||
    lower.includes('long') ||
    lower.includes('positive')
  )
}

function isBearishText(value?: string) {
  const lower = String(value ?? '').toLowerCase()

  return (
    lower.includes('bear') ||
    lower.includes('sell') ||
    lower.includes('down') ||
    lower.includes('short') ||
    lower.includes('negative')
  )
}

function isNeutralText(value?: string) {
  const lower = String(value ?? '').toLowerCase()

  return (
    !lower ||
    lower.includes('waiting') ||
    lower.includes('neutral') ||
    lower.includes('none') ||
    lower.includes('no signal')
  )
}

function getStatusColor(status: string) {
  const lower = status.toLowerCase()

  if (lower.includes('bear')) return 'text-red-400'
  if (lower.includes('bull')) return 'text-blue-400'
  if (lower.includes('neutral')) return 'text-gray-300'

  return 'text-yellow-400'
}

function buildSentimentFromSignal(signal?: TradingSignal): SentimentData | null {
  if (!signal) return null

  const symbol = String(signal.symbol ?? 'WAITING')
  const timeframe = String(signal.timeframe ?? '1m')
  const bullScore = clamp(Number(signal.bullScore ?? 50))
  const bearScore = clamp(Number(signal.bearScore ?? 50))
  const netBias = Number(signal.netBias ?? bullScore - bearScore)
  const confidence = clamp(Number(signal.confidence ?? Math.abs(netBias)))

  const factors = [
    signal.smc,
    signal.alphax,
    signal.ghost,
    signal.openInterest,
    signal.footprint,
    signal.session,
    signal.fredMacro,
    signal.finraShortVolume,
    signal.cot,
  ]

  let bullCount = 0
  let bearCount = 0
  let neutralCount = 0

  factors.forEach((factor) => {
    if (isBullishText(factor)) {
      bullCount += 1
    } else if (isBearishText(factor)) {
      bearCount += 1
    } else if (!isNeutralText(factor)) {
      neutralCount += 1
    }
  })

  const dashboardSignal = String(signal.signal ?? '').toUpperCase()

  if (dashboardSignal === 'BUY') bullCount += 1
  else if (dashboardSignal === 'SELL') bearCount += 1
  else neutralCount += 1

  if (bullScore > bearScore + 3) bullCount += 1
  else if (bearScore > bullScore + 3) bearCount += 1
  else neutralCount += 1

  if (confidence >= 12) {
    if (netBias > 0) bullCount += 1
    else if (netBias < 0) bearCount += 1
    else neutralCount += 1
  } else {
    neutralCount += 1
  }

  const activeCount = bullCount + bearCount + neutralCount
  const safeActiveCount = Math.max(activeCount, 1)

  const bullPct = (bullCount / safeActiveCount) * 100
  const bearPct = (bearCount / safeActiveCount) * 100
  const neutralPct = (neutralCount / safeActiveCount) * 100

  const pressureSentiment = clamp(50 + (bullScore - bearScore) / 2)
  const voteSentiment = clamp(50 + ((bullPct - bearPct) / 100) * 50)
  const sentiment = clamp(pressureSentiment * 0.6 + voteSentiment * 0.4)

  const sentimentStatus =
    sentiment >= 61
      ? 'Python Bullish'
      : sentiment <= 39
        ? 'Python Bearish'
        : Math.abs(netBias) >= 8
          ? netBias > 0
            ? 'Bullish Lean'
            : 'Bearish Lean'
          : 'Python Neutral'

  return {
    eventType: 'PYTHON_DASHBOARD_SENTIMENT',
    symbol,
    timeframe,
    sentiment,
    sentimentStatus,
    bearCount,
    neutralCount,
    bullCount,
    bearPct,
    neutralPct,
    bullPct,
    activeCount,
    price: 0,
  }
}

function normalizeTechnicalSentiment(
  sentiment: SentimentData,
  selectedSymbol: string,
  selectedTimeframe: string
): SentimentData {
  const indicators = extractTechnicalIndicators(sentiment)

  if (indicators.length === 0) {
    return {
      ...sentiment,
      symbol: selectedSymbol,
      timeframe: selectedTimeframe,
    }
  }

  let bullCount = 0
  let bearCount = 0
  let neutralCount = 0

  const cleanedIndicators = indicators.map((indicator) => {
    const value = clamp(Number(indicator.value ?? 50))
    const side = String(indicator.signal ?? '').toUpperCase()
    const normalizedSide =
      side === 'BULLISH' || side === 'BEARISH' || side === 'NEUTRAL'
        ? side
        : value > 60
          ? 'BULLISH'
          : value < 40
            ? 'BEARISH'
            : 'NEUTRAL'

    if (normalizedSide === 'BULLISH') bullCount += 1
    else if (normalizedSide === 'BEARISH') bearCount += 1
    else neutralCount += 1

    return {
      ...indicator,
      value,
      signal: normalizedSide,
    }
  })

  const activeCount = cleanedIndicators.length
  const safeActiveCount = Math.max(activeCount, 1)

  const bullPct = (bullCount / safeActiveCount) * 100
  const bearPct = (bearCount / safeActiveCount) * 100
  const neutralPct = (neutralCount / safeActiveCount) * 100
  const technicalAverage =
    cleanedIndicators.reduce((sum, indicator) => sum + Number(indicator.value ?? 50), 0) /
    safeActiveCount

  const sentimentStatus =
    bullCount > bearCount && bullCount > neutralCount
      ? bullPct >= 70
        ? 'Strong Bullish'
        : 'Mostly Bullish'
      : bearCount > bullCount && bearCount > neutralCount
        ? bearPct >= 70
          ? 'Strong Bearish'
          : 'Mostly Bearish'
        : neutralCount > bullCount && neutralCount > bearCount
          ? 'Mostly Neutral'
          : technicalAverage > 60
            ? 'Bullish Lean'
            : technicalAverage < 40
              ? 'Bearish Lean'
              : 'Mixed'

  return {
    ...sentiment,
    eventType: 'PYTHON_TECHNICAL_SENTIMENT',
    symbol: selectedSymbol,
    timeframe: selectedTimeframe,
    sentiment: clamp(technicalAverage),
    sentimentStatus,
    bearCount,
    neutralCount,
    bullCount,
    bearPct,
    neutralPct,
    bullPct,
    activeCount,
    indicators: cleanedIndicators,
  }
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const angleRad = (angleDeg * Math.PI) / 180

  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy - radius * Math.sin(angleRad),
  }
}

function getGaugeZone(value: number) {
  if (value <= 20) return 'Strong Bearish'
  if (value <= 40) return 'Bearish'
  if (value <= 60) return 'Neutral'
  if (value <= 80) return 'Bullish'
  return 'Strong Bullish'
}

function isActiveGaugeLabel(label: string, value: number) {
  return getGaugeZone(value) === label
}

export default function MarketSentimentGauge({
  signal,
  technicalSentiment: sharedTechnicalSentiment,
}: MarketSentimentGaugeProps) {
  const [apiSentiment, setApiSentiment] = useState<SentimentData>(DEFAULT_SENTIMENT)
  const [engineSentiment, setEngineSentiment] = useState<SentimentData | null>(null)

  useEffect(() => {
    const fetchSentiment = async () => {
      try {
        const params = new URLSearchParams({
          symbol: normalizeSymbol(signal?.symbol ?? 'BTCUSD'),
          timeframe: normalizeTimeframe(signal?.timeframe ?? '1m'),
          limit: '500',
        })

        const response = await fetch(`${API_BASE_URL}/api/latest-sentiment?${params.toString()}`, {
          cache: 'no-store',
        })

        if (!response.ok) return

        const data: SentimentData = await response.json()
        setApiSentiment(data)
      } catch (error) {
        console.error('Failed to fetch sentiment:', error)
      }
    }

    fetchSentiment()
    const interval = window.setInterval(fetchSentiment, 10000)

    return () => {
      window.clearInterval(interval)
    }
  }, [signal?.symbol, signal?.timeframe])

  useEffect(() => {
    setEngineSentiment(null)

    // Shared app/page.tsx technical sentiment is the source of truth.
    // Only fetch engine sentiment as a fallback if no shared sentiment exists.
    if (sharedTechnicalSentiment) return

    const fetchEngineSentiment = async () => {
      try {
        const selectedSymbol = normalizeSymbol(signal?.symbol ?? 'BTCUSD')
        const selectedTimeframe = normalizeTimeframe(signal?.timeframe ?? '1m')

        const params = new URLSearchParams({
          symbol: selectedSymbol,
          timeframe: selectedTimeframe,
          limit: '300',
        })

        const response = await fetch(`${API_BASE_URL}/api/engine-state?${params.toString()}`, {
          cache: 'no-store',
        })

        if (!response.ok) return

        const data = await response.json()
        const raw = data && typeof data === 'object' ? data as Record<string, unknown> : {}

        const nestedTechnical =
          raw.technicalSentiment && typeof raw.technicalSentiment === 'object'
            ? raw.technicalSentiment as Partial<SentimentData>
            : raw.sentiment && typeof raw.sentiment === 'object'
              ? raw.sentiment as Partial<SentimentData>
              : null

        const candidate: SentimentData = {
          eventType: 'PYTHON_TECHNICAL_SENTIMENT',
          symbol: selectedSymbol,
          timeframe: selectedTimeframe,
          sentiment: Number(nestedTechnical?.sentiment ?? raw.sentiment ?? 50),
          sentimentStatus: String(nestedTechnical?.sentimentStatus ?? raw.sentimentStatus ?? 'Mixed'),
          bearCount: Number(nestedTechnical?.bearCount ?? raw.bearCount ?? 0),
          neutralCount: Number(nestedTechnical?.neutralCount ?? raw.neutralCount ?? 0),
          bullCount: Number(nestedTechnical?.bullCount ?? raw.bullCount ?? 0),
          bearPct: Number(nestedTechnical?.bearPct ?? raw.bearPct ?? 0),
          neutralPct: Number(nestedTechnical?.neutralPct ?? raw.neutralPct ?? 0),
          bullPct: Number(nestedTechnical?.bullPct ?? raw.bullPct ?? 0),
          activeCount: Number(nestedTechnical?.activeCount ?? raw.activeCount ?? 0),
          price: Number(raw.price ?? raw.current ?? 0),
          indicators: [
            ...asIndicatorArray(raw.indicators),
            ...asIndicatorArray(raw.technicalIndicators),
            ...asIndicatorArray(raw.technicalMeter),
            ...asIndicatorArray(raw.factors),
            ...asIndicatorArray(nestedTechnical?.indicators),
            ...asIndicatorArray(nestedTechnical?.technicalIndicators),
            ...asIndicatorArray(nestedTechnical?.technicalMeter),
            ...asIndicatorArray(nestedTechnical?.factors),
          ],
        }

        if (extractTechnicalIndicators(candidate).length > 0) {
          setEngineSentiment(candidate)
        }
      } catch (error) {
        console.error('Failed to fetch engine technical sentiment:', error)
      }
    }

    fetchEngineSentiment()
    const interval = window.setInterval(fetchEngineSentiment, 10000)

    return () => {
      window.clearInterval(interval)
    }
  }, [signal?.symbol, signal?.timeframe, sharedTechnicalSentiment])

  const signalSentiment = useMemo(() => buildSentimentFromSignal(signal), [signal])

  const selectedSymbol = normalizeSymbol(signal?.symbol ?? signalSentiment?.symbol ?? 'WAITING')
  const selectedTimeframe = normalizeTimeframe(signal?.timeframe ?? signalSentiment?.timeframe ?? '1m')

  const apiSymbol = normalizeSymbol(apiSentiment.symbol)
  const apiTimeframe = normalizeTimeframe(apiSentiment.timeframe)

  const apiMatchesMainChart =
    apiSymbol === selectedSymbol && apiTimeframe === selectedTimeframe

  const apiTechnicalIndicators = extractTechnicalIndicators(apiSentiment)
  const engineTechnicalIndicators = extractTechnicalIndicators(engineSentiment)
  const sharedTechnicalIndicators = extractTechnicalIndicators(sharedTechnicalSentiment)
  const signalTechnicalSentiment = buildTechnicalSentimentFromSignal(
    signal,
    selectedSymbol,
    selectedTimeframe
  )
  const signalTechnicalIndicators = extractTechnicalIndicators(signalTechnicalSentiment)

  const apiHasTechnicalSentiment =
    apiMatchesMainChart &&
    apiSentiment.eventType === 'PYTHON_TECHNICAL_SENTIMENT' &&
    apiTechnicalIndicators.length > 0

  // HARD RULE:
  // If app/page.tsx provides technicalSentiment from FactorConfirmationTable,
  // use that exact indicator object so Market Sentiment and Factor Confirmation stay synced.
  const bestTechnicalSentiment =
    sharedTechnicalIndicators.length > 0
      ? sharedTechnicalSentiment
      : apiHasTechnicalSentiment
        ? apiSentiment
        : engineTechnicalIndicators.length > 0
          ? engineSentiment
          : signalTechnicalIndicators.length > 0
            ? signalTechnicalSentiment
            : null

  const sentiment = bestTechnicalSentiment
    ? normalizeTechnicalSentiment(bestTechnicalSentiment as SentimentData, selectedSymbol, selectedTimeframe)
    : {
        ...(signalSentiment ?? apiSentiment),
        symbol: selectedSymbol,
        timeframe: selectedTimeframe,
      }

  const value = clamp(Number(sentiment.sentiment ?? 50))
  const statusColor = getStatusColor(sentiment.sentimentStatus)
  const technicalIndicators = extractTechnicalIndicators(sentiment)

  const gaugeStartAngle = 160
  const gaugeEndAngle = 20
  const needleAngle = gaugeStartAngle - (value / 100) * (gaugeStartAngle - gaugeEndAngle)
  const needleEnd = polarToCartesian(160, 150, 82, needleAngle)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Market Sentiment</h2>
          <p className="text-xs text-gray-400">
            {sentiment.symbol} • {sentiment.timeframe} timeframe
          </p>
        </div>

        <div className="rounded-full border border-dark-600 bg-dark-700/70 px-3 py-1 text-xs text-gray-300">
          {Math.round(value)}%
        </div>
      </div>

      <div className="mx-auto w-full max-w-sm">
        <div className="relative h-[185px] w-full">
          <svg viewBox="0 0 320 185" className="h-full w-full overflow-visible">
            <defs>
              <linearGradient
                id="marketbos-sentiment-gradient"
                x1="45"
                y1="150"
                x2="275"
                y2="150"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#ff2d55" />
                <stop offset="50%" stopColor="#3f3f46" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>

              <filter id="marketbos-needle-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#000000" floodOpacity="0.65" />
              </filter>
            </defs>

            {/* Base arc */}
            <path
              d="M 45 150 A 115 115 0 0 1 275 150"
              fill="none"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="7"
              strokeLinecap="butt"
              pathLength={100}
            />

            {/* Sentiment progress arc */}
            <path
              d="M 45 150 A 115 115 0 0 1 275 150"
              fill="none"
              stroke="url(#marketbos-sentiment-gradient)"
              strokeWidth="7"
              strokeLinecap="butt"
              pathLength={100}
              strokeDasharray={`${value} ${100 - value}`}
              className="transition-all duration-500"
            />

            {/* Angular end caps to match the TradingView meter style */}
            <line
              x1="45"
              y1="150"
              x2="52"
              y2="121"
              stroke={value <= 40 ? '#ff2d55' : 'rgba(255,255,255,0.15)'}
              strokeWidth="7"
              strokeLinecap="butt"
            />
            <line
              x1="275"
              y1="150"
              x2="268"
              y2="121"
              stroke={value > 60 ? '#3b82f6' : 'rgba(255,255,255,0.15)'}
              strokeWidth="7"
              strokeLinecap="butt"
            />

            {/* Labels only around the arc, never over the center status text */}
            <text
              x="30"
              y="128"
              fill={isActiveGaugeLabel('Strong Bearish', value) ? '#ff2d55' : '#6b7280'}
              fontSize="11"
              textAnchor="middle"
              fontWeight={isActiveGaugeLabel('Strong Bearish', value) ? 700 : 600}
            >
              <tspan x="30" dy="0">Strong</tspan>
              <tspan x="30" dy="13">Bearish</tspan>
            </text>

            <text
              x="76"
              y="48"
              fill={isActiveGaugeLabel('Bearish', value) ? '#ff2d55' : '#6b7280'}
              fontSize="11"
              textAnchor="middle"
              fontWeight={isActiveGaugeLabel('Bearish', value) ? 700 : 600}
            >
              Bearish
            </text>

            <text
              x="160"
              y="24"
              fill={isActiveGaugeLabel('Neutral', value) ? '#e5e7eb' : '#6b7280'}
              fontSize="11"
              textAnchor="middle"
              fontWeight={isActiveGaugeLabel('Neutral', value) ? 700 : 600}
            >
              Neutral
            </text>

            <text
              x="244"
              y="48"
              fill={isActiveGaugeLabel('Bullish', value) ? '#3b82f6' : '#6b7280'}
              fontSize="11"
              textAnchor="middle"
              fontWeight={isActiveGaugeLabel('Bullish', value) ? 700 : 600}
            >
              Bullish
            </text>

            <text
              x="290"
              y="128"
              fill={isActiveGaugeLabel('Strong Bullish', value) ? '#3b82f6' : '#6b7280'}
              fontSize="11"
              textAnchor="middle"
              fontWeight={isActiveGaugeLabel('Strong Bullish', value) ? 700 : 600}
            >
              <tspan x="290" dy="0">Strong</tspan>
              <tspan x="290" dy="13">Bullish</tspan>
            </text>

            <line
              x1="160"
              y1="150"
              x2={needleEnd.x}
              y2={needleEnd.y}
              stroke="rgba(255,255,255,0.78)"
              strokeWidth="3"
              strokeLinecap="round"
              filter="url(#marketbos-needle-shadow)"
              className="transition-all duration-500"
            />
            <line
              x1="160"
              y1="150"
              x2={needleEnd.x}
              y2={needleEnd.y}
              stroke="rgba(255,255,255,0.95)"
              strokeWidth="1.2"
              strokeLinecap="round"
              className="transition-all duration-500"
            />

            <circle cx="160" cy="150" r="8" fill="rgba(255,255,255,0.86)" />
            <circle cx="160" cy="150" r="3" fill="rgba(15,17,21,0.55)" />
          </svg>
        </div>

        <div className="mt-[-6px] text-center">
          <p className={`text-xl font-bold ${statusColor}`}>
            {sentiment.sentimentStatus}
          </p>

          <div className="mx-auto mt-3 grid max-w-[245px] grid-cols-3 gap-5 text-center">
            <div>
              <p className="text-2xl font-bold text-red-400">
                {sentiment.bearCount}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-red-400">Bearish</p>
            </div>

            <div>
              <p className="text-2xl font-bold text-gray-300">
                {sentiment.neutralCount}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Neutral</p>
            </div>

            <div>
              <p className="text-2xl font-bold text-blue-400">
                {sentiment.bullCount}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-blue-400">Bullish</p>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-gray-500">
        Technical indicators: {technicalIndicators.length > 0
          ? technicalIndicators.length
          : sentiment.activeCount}
      </p>

      {technicalIndicators.length > 0 && (
        <div className="mt-4 rounded-lg border border-dark-600 bg-dark-900/35 p-3 text-left">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
              Technical Meter
            </p>
            <p className="text-xs text-gray-500">
              {technicalIndicators.length} indicators
            </p>
          </div>

          <div className="grid grid-cols-1 gap-1">
            {technicalIndicators.map((indicator) => {
              const side = String(indicator.signal ?? '').toUpperCase()
              const sideClass =
                side === 'BULLISH'
                  ? 'text-blue-400'
                  : side === 'BEARISH'
                    ? 'text-red-400'
                    : 'text-gray-300'

              return (
                <div
                  key={indicator.name}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-[11px]"
                >
                  <span className="truncate text-gray-400">
                    {indicator.name}
                  </span>
                  <span className={`font-bold ${sideClass}`}>
                    {side}
                  </span>
                  <span className="min-w-[42px] text-right font-bold text-white">
                    {Math.round(Number(indicator.value ?? 0))}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </motion.div>
  )
}
