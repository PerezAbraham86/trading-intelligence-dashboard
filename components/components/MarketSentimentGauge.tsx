'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

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
  return Math.max(0, Math.min(100, value))
}

function getStatusColor(status: string) {
  const lower = status.toLowerCase()

  if (lower.includes('bear')) return 'text-red-400'
  if (lower.includes('bull')) return 'text-blue-400'
  if (lower.includes('neutral')) return 'text-gray-300'

  return 'text-yellow-400'
}

export default function MarketSentimentGauge() {
  const [sentiment, setSentiment] = useState<SentimentData>(DEFAULT_SENTIMENT)

  useEffect(() => {
    const fetchSentiment = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/latest-sentiment`, {
          cache: 'no-store',
        })

        if (!response.ok) return

        const data: SentimentData = await response.json()
        setSentiment(data)
      } catch (error) {
        console.error('Failed to fetch sentiment:', error)
      }
    }

    fetchSentiment()

    const interval = window.setInterval(fetchSentiment, 3000)

    return () => {
      window.clearInterval(interval)
    }
  }, [])

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
              stroke="rgba(255,255,255,0.85)"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>

          <circle cx="120" cy="120" r="7" fill="rgba(255,255,255,0.8)" />
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
      </div>
    </motion.div>
  )
}
