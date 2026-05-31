'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ExternalLink, Newspaper } from 'lucide-react'

type NewsArticle = {
  title: string
  summary?: string
  url?: string
  source?: string
  publishedAt?: string
  tickers?: string[]
  sentiment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | string
  sentimentScore?: number
}

type NewsPayload = {
  eventType?: string
  symbol?: string
  newsSymbol?: string
  category?: string
  source?: string
  createdAt?: string
  count?: number
  limit?: number
  newsScore?: number
  status?: string
  bullish?: number
  bearish?: number
  neutral?: number
  articles?: NewsArticle[]
}

type TickerNewsFeedProps = {
  symbol?: string
  limit?: number
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://trading-intelligence-dashboard.onrender.com'

function normalizeSymbol(value: unknown) {
  return String(value ?? 'SPY')
    .trim()
    .toUpperCase()
    .replace('BINANCE:', '')
    .replace('COINBASE:', '')
    .replace('CRYPTO:', '')
    .replace('CME_MINI:', '')
    .replace('CME:', '')
}

function formatTime(value: string | undefined) {
  if (!value) return 'now'

  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 'now'

  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000))
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function scoreColor(score: number | undefined) {
  const value = Number(score ?? 50)
  if (value >= 60) return 'text-emerald-300'
  if (value <= 40) return 'text-red-300'
  return 'text-gray-300'
}

function sentimentClasses(sentiment: string | undefined) {
  const side = String(sentiment ?? 'NEUTRAL').toUpperCase()

  if (side === 'BULLISH') {
    return {
      badge: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
      border: 'border-emerald-400/25 bg-emerald-950/10',
    }
  }

  if (side === 'BEARISH') {
    return {
      badge: 'border-red-400/40 bg-red-400/10 text-red-300',
      border: 'border-red-400/25 bg-red-950/10',
    }
  }

  return {
    badge: 'border-gray-400/30 bg-gray-400/10 text-gray-300',
    border: 'border-dark-600 bg-dark-900/35',
  }
}

function cleanSummary(value: string | undefined) {
  const raw = String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()

  if (raw.length <= 120) return raw
  return `${raw.slice(0, 120)}...`
}

export default function TickerNewsFeed({ symbol = 'SPY', limit = 8 }: TickerNewsFeedProps) {
  const [data, setData] = useState<NewsPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const normalizedSymbol = normalizeSymbol(symbol)

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchNews() {
      try {
        setError('')

        const params = new URLSearchParams({
          symbol: normalizedSymbol,
          limit: String(limit),
        })

        const response = await fetch(`${API_BASE_URL}/api/ticker-news?${params.toString()}`, {
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error(`Ticker news request failed: ${response.status}`)
        }

        const json = await response.json()

        if (!cancelled) {
          setData(json && typeof json === 'object' ? json : null)
          setIsLoading(false)
        }
      } catch (err) {
        console.error('Ticker news feed error:', err)
        if (!cancelled) {
          setError('Ticker news unavailable')
          setIsLoading(false)
        }
      }
    }

    fetchNews()
    intervalId = setInterval(fetchNews, 120000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [normalizedSymbol, limit])

  const articles = useMemo(() => data?.articles ?? [], [data])
  const score = Number(data?.newsScore ?? 50)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-4 shadow-lg"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 rounded-lg bg-dark-900/70 p-2 text-blue-300">
            <Newspaper size={16} />
          </div>

          <div>
            <h2 className="text-lg font-bold text-white">Ticker News Feed</h2>
            <p className="text-xs text-gray-500">
              {data?.newsSymbol ?? normalizedSymbol} • {data?.category ?? 'market'} news
            </p>
          </div>
        </div>

        <div className={`rounded-full border border-dark-600 bg-dark-900/50 px-3 py-1 text-xs font-bold ${scoreColor(score)}`}>
          {Math.round(score)}%
        </div>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center text-[11px]">
        <div className="rounded-lg bg-dark-900/45 p-2">
          <p className="text-gray-500">Bullish</p>
          <p className="font-bold text-emerald-300">{data?.bullish ?? 0}</p>
        </div>
        <div className="rounded-lg bg-dark-900/45 p-2">
          <p className="text-gray-500">Neutral</p>
          <p className="font-bold text-gray-300">{data?.neutral ?? 0}</p>
        </div>
        <div className="rounded-lg bg-dark-900/45 p-2">
          <p className="text-gray-500">Bearish</p>
          <p className="font-bold text-red-300">{data?.bearish ?? 0}</p>
        </div>
      </div>

      {isLoading && (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dark-700 bg-dark-900/40 text-sm text-gray-500">
          Loading ticker news...
        </div>
      )}

      {!isLoading && error && (
        <div className="flex h-40 items-center justify-center rounded-lg border border-red-400/30 bg-red-950/20 text-sm text-red-300">
          {error}
        </div>
      )}

      {!isLoading && !error && articles.length === 0 && (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dark-700 bg-dark-900/40 text-sm text-gray-500">
          No ticker news returned yet.
        </div>
      )}

      {!isLoading && !error && articles.length > 0 && (
        <div className="max-h-[430px] space-y-2 overflow-hidden">
          {articles.slice(0, limit).map((article, index) => {
            const classes = sentimentClasses(article.sentiment)
            const title = article.title || 'Untitled news item'
            const summary = cleanSummary(article.summary)

            const content = (
              <div className={`rounded-lg border p-3 ${classes.border}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${classes.badge}`}>
                    {String(article.sentiment ?? 'NEUTRAL').toUpperCase()}
                  </span>

                  <span className="text-[10px] text-gray-500">
                    {formatTime(article.publishedAt)}
                  </span>
                </div>

                <p className="line-clamp-2 text-sm font-bold leading-snug text-white">
                  {title}
                </p>

                {summary && (
                  <p className="mt-1 line-clamp-2 text-xs leading-snug text-gray-400">
                    {summary}
                  </p>
                )}

                <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-gray-500">
                  <span className="truncate">
                    {article.source ?? data?.source ?? 'News'}{' '}
                    {Array.isArray(article.tickers) && article.tickers.length > 0
                      ? `• ${article.tickers.slice(0, 3).join(', ')}`
                      : ''}
                  </span>

                  <span className={scoreColor(article.sentimentScore)}>
                    {Math.round(Number(article.sentimentScore ?? 50))}%
                  </span>
                </div>
              </div>
            )

            if (article.url) {
              return (
                <a
                  key={`${article.title}-${index}`}
                  href={article.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group block"
                >
                  <div className="relative">
                    {content}
                    <ExternalLink
                      size={12}
                      className="absolute right-2 top-2 text-gray-500 opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </div>
                </a>
              )
            }

            return (
              <div key={`${article.title}-${index}`}>
                {content}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-500">
        <span>{data?.status ?? 'News'} • {data?.count ?? 0} articles</span>
        <span>Source: {data?.source ?? 'ticker news'}</span>
      </div>
    </motion.div>
  )
}
