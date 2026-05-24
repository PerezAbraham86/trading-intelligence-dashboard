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
}

type MarketSentimentGaugeProps = {
  signal?: TradingSignal
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

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
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
      // Non-waiting custom text counts as active neutral.
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

export default function MarketSentimentGauge({ signal }: MarketSentimentGaugeProps) {
  const [apiSentiment, setApiSentiment] = useState<SentimentData>(DEFAULT_SENTIMENT)

  useEffect(() => {
    const fetchSentiment = async () => {
      try {
        const params = new URLSearchParams({
          symbol: String(signal?.symbol ?? 'BTCUSD'),
          timeframe: String(signal?.timeframe ?? '1m'),
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

  const signalSentiment = useMemo(() => buildSentimentFromSignal(signal), [signal])
  const hasTechnicalSentiment =
    apiSentiment.eventType === 'PYTHON_TECHNICAL_SENTIMENT' &&
    Array.isArray(apiSentiment.indicators) &&
    apiSentiment.indicators.length > 0

  // Prefer the full 12-indicator Python technical meter when available.
  // Fallback to the lighter dashboard-signal sentiment only while Python is loading.
  const sentiment = hasTechnicalSentiment ? apiSentiment : signalSentiment ?? apiSentiment

  const value = clamp(Number(sentiment.sentiment ?? 50))
  const needleRotation = -90 + (value / 100) * 180

  const statusColor = getStatusColor(sentiment.sentimentStatus)

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

      <div className="relative mx-auto h-44 w-full max-w-sm">
        <svg viewBox="0 0 240 150" className="h-full w-full">
          <path
            d="M 30 120 A 90 90 0 0 1 210 120"
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="8"
            strokeLinecap="round"
          />

          <path
            d="M 30 120 A 90 90 0 0 1 75 42"
            fill="none"
            stroke="#ef4444"
            strokeWidth="8"
            strokeLinecap="round"
            opacity={value <= 40 ? 1 : 0.35}
          />

          <path
            d="M 75 42 A 90 90 0 0 1 165 42"
            fill="none"
            stroke="#9ca3af"
            strokeWidth="8"
            strokeLinecap="round"
            opacity={value > 40 && value <= 60 ? 1 : 0.35}
          />

          <path
            d="M 165 42 A 90 90 0 0 1 210 120"
            fill="none"
            stroke="#3b82f6"
            strokeWidth="8"
            strokeLinecap="round"
            opacity={value > 60 ? 1 : 0.35}
          />

          <text x="30" y="98" fill="#ef4444" fontSize="10" textAnchor="middle">
            Bearish
          </text>
          <text x="120" y="28" fill="#9ca3af" fontSize="10" textAnchor="middle">
            Neutral
          </text>
          <text x="210" y="98" fill="#3b82f6" fontSize="10" textAnchor="middle">
            Bullish
          </text>

          <g
            style={{
              transform: `rotate(${needleRotation}deg)`,
              transformOrigin: '120px 120px',
              transition: 'transform 0.5s ease',
            }}
          >
            <line
              x1="120"
              y1="120"
              x2="120"
              y2="46"
              stroke="rgba(255,255,255,0.9)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>

          <circle cx="120" cy="120" r="7" fill="rgba(255,255,255,0.85)" />
        </svg>
      </div>

      <div className="text-center">
        <p className={`text-xl font-bold ${statusColor}`}>
          {sentiment.sentimentStatus}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-2xl font-bold text-red-400">
              {sentiment.bearCount}
            </p>
            <p className="text-[10px] uppercase text-red-400">Bearish</p>
            <p className="text-xs text-gray-500">
              {sentiment.bearPct.toFixed(1)}%
            </p>
          </div>

          <div>
            <p className="text-2xl font-bold text-gray-300">
              {sentiment.neutralCount}
            </p>
            <p className="text-[10px] uppercase text-gray-400">Neutral</p>
            <p className="text-xs text-gray-500">
              {sentiment.neutralPct.toFixed(1)}%
            </p>
          </div>

          <div>
            <p className="text-2xl font-bold text-blue-400">
              {sentiment.bullCount}
            </p>
            <p className="text-[10px] uppercase text-blue-400">Bullish</p>
            <p className="text-xs text-gray-500">
              {sentiment.bullPct.toFixed(1)}%
            </p>
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-500">
          Active indicators: {sentiment.activeCount}
        </p>

        {Array.isArray(sentiment.indicators) && sentiment.indicators.length > 0 && (
          <div className="mt-4 rounded-lg border border-dark-600 bg-dark-900/35 p-3 text-left">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
                Technical Meter
              </p>
              <p className="text-xs text-gray-500">
                {sentiment.indicators.length} indicators
              </p>
            </div>

            <div className="grid grid-cols-1 gap-1">
              {sentiment.indicators.map((indicator) => {
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
      </div>
    </motion.div>
  )
}
