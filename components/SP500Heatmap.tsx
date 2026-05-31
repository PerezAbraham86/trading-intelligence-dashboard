'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'

type HeatmapStock = {
  symbol: string
  displaySymbol?: string
  name?: string
  price?: number
  change?: number
  changePercent?: number
  marketCap?: number
  marketCapBillions?: number
  marketTime?: number
}

type HeatmapSector = {
  name: string
  changePercent: number
  marketCap: number
  marketCapBillions?: number
  stocks: HeatmapStock[]
}

type HeatmapPayload = {
  eventType?: string
  source?: string
  note?: string
  isLiveSnapshot?: boolean
  createdAt?: string
  count?: number
  sectorCount?: number
  overallChangePercent?: number
  gainers?: number
  losers?: number
  neutral?: number
  sectors?: HeatmapSector[]
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://trading-intelligence-dashboard.onrender.com'

function formatPct(value: number | undefined) {
  const number = Number(value ?? 0)
  const sign = number > 0 ? '+' : ''
  return `${sign}${number.toFixed(2)}%`
}

function formatPrice(value: number | undefined) {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number) || number <= 0) return '—'
  return number.toLocaleString(undefined, {
    minimumFractionDigits: number >= 100 ? 2 : 2,
    maximumFractionDigits: number >= 100 ? 2 : 4,
  })
}

function tileStyle(changePercent: number | undefined, marketCap: number | undefined) {
  const change = Math.max(-5, Math.min(5, Number(changePercent ?? 0)))
  const abs = Math.min(Math.abs(change), 5)
  const opacity = 0.28 + abs * 0.11
  const positive = change > 0
  const negative = change < 0

  const cap = Math.max(Number(marketCap ?? 1), 1)
  const basis = Math.max(54, Math.min(155, 42 + Math.log10(cap) * 8))

  return {
    flexBasis: `${basis}px`,
    flexGrow: Math.max(1, Math.min(5, Math.log10(cap) - 8)),
    background: positive
      ? `linear-gradient(135deg, rgba(16, 185, 129, ${opacity}), rgba(21, 128, 61, ${opacity + 0.08}))`
      : negative
        ? `linear-gradient(135deg, rgba(248, 113, 113, ${opacity}), rgba(127, 29, 29, ${opacity + 0.08}))`
        : 'linear-gradient(135deg, rgba(31, 41, 55, 0.85), rgba(17, 24, 39, 0.95))',
    borderColor: positive
      ? 'rgba(52, 211, 153, 0.24)'
      : negative
        ? 'rgba(248, 113, 113, 0.22)'
        : 'rgba(75, 85, 99, 0.26)',
  }
}

function textColor(changePercent: number | undefined) {
  const change = Number(changePercent ?? 0)
  if (change > 0) return 'text-emerald-300'
  if (change < 0) return 'text-red-300'
  return 'text-gray-300'
}

export default function SP500Heatmap() {
  const [data, setData] = useState<HeatmapPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchHeatmap() {
      try {
        setError('')

        const response = await fetch(`${API_BASE_URL}/api/sp500-heatmap`, {
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error(`Heatmap request failed: ${response.status}`)
        }

        const json = await response.json()

        if (!cancelled) {
          setData(json && typeof json === 'object' ? json : null)
          setIsLoading(false)
        }
      } catch (err) {
        console.error('S&P 500 heatmap fetch error:', err)
        if (!cancelled) {
          setError('Heatmap unavailable')
          setIsLoading(false)
        }
      }
    }

    fetchHeatmap()
    intervalId = setInterval(fetchHeatmap, 60000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [])

  const sectors = useMemo(() => data?.sectors ?? [], [data])
  const overall = Number(data?.overallChangePercent ?? 0)
  const topSectors = sectors.slice(0, 7)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-4 shadow-lg"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">S&amp;P 500 Heatmap</h2>
          <p className="text-xs text-gray-500">
            Live snapshot • top weighted S&amp;P sectors
          </p>
        </div>

        <div className={`rounded-full border border-dark-600 bg-dark-900/50 px-3 py-1 text-xs font-bold ${textColor(overall)}`}>
          {formatPct(overall)}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center text-[11px]">
        <div className="rounded-lg bg-dark-900/45 p-2">
          <p className="text-gray-500">Gainers</p>
          <p className="font-bold text-emerald-300">{data?.gainers ?? 0}</p>
        </div>
        <div className="rounded-lg bg-dark-900/45 p-2">
          <p className="text-gray-500">Neutral</p>
          <p className="font-bold text-gray-300">{data?.neutral ?? 0}</p>
        </div>
        <div className="rounded-lg bg-dark-900/45 p-2">
          <p className="text-gray-500">Losers</p>
          <p className="font-bold text-red-300">{data?.losers ?? 0}</p>
        </div>
      </div>

      {isLoading && (
        <div className="flex h-64 items-center justify-center rounded-lg border border-dark-700 bg-dark-900/40 text-sm text-gray-500">
          Loading S&amp;P 500 heatmap...
        </div>
      )}

      {!isLoading && error && (
        <div className="flex h-64 items-center justify-center rounded-lg border border-red-400/30 bg-red-950/20 text-sm text-red-300">
          {error}
        </div>
      )}

      {!isLoading && !error && (
        <div className="max-h-[520px] space-y-2 overflow-hidden rounded-lg border border-dark-700 bg-dark-900/40 p-2">
          {topSectors.map((sector) => (
            <section key={sector.name} className="rounded-lg border border-dark-700/70 bg-dark-950/30 p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="truncate text-[11px] font-bold uppercase tracking-wide text-gray-300">
                  {sector.name}
                </p>
                <p className={`text-[11px] font-bold ${textColor(sector.changePercent)}`}>
                  {formatPct(sector.changePercent)}
                </p>
              </div>

              <div className="flex min-h-[86px] flex-wrap gap-1">
                {sector.stocks.slice(0, 9).map((stock) => (
                  <div
                    key={`${sector.name}-${stock.symbol}`}
                    title={`${stock.name ?? stock.displaySymbol ?? stock.symbol} | ${formatPct(stock.changePercent)} | $${formatPrice(stock.price)}`}
                    className="min-h-[54px] min-w-[54px] rounded-md border p-1.5 text-white shadow-inner"
                    style={tileStyle(stock.changePercent, stock.marketCap)}
                  >
                    <div className="truncate text-[11px] font-extrabold">
                      {stock.displaySymbol ?? stock.symbol}
                    </div>
                    <div className={`text-[10px] font-bold ${textColor(stock.changePercent)}`}>
                      {formatPct(stock.changePercent)}
                    </div>
                    <div className="mt-0.5 truncate text-[9px] text-gray-300/80">
                      ${formatPrice(stock.price)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-500">
        <span>{data?.count ?? 0} large S&amp;P names • {data?.sectorCount ?? 0} sectors</span>
        <span>Source: Yahoo Finance quote snapshot</span>
      </div>
    </motion.div>
  )
}
