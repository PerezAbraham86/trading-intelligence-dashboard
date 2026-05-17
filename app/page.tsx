'use client'

import { useCallback, useEffect, useState } from 'react'

const API_BASE_URL = 'https://trading-intelligence-dashboard.onrender.com'

export type ConnectionStatus = 'Connected' | 'Waiting' | 'Error'

export type TradingSignal = {
  symbol: string
  timeframe: string
  signal: 'BUY' | 'SELL' | 'NEUTRAL' | string
  confidence: number
  bullScore: number
  bearScore: number
  netBias: number
  price: number
  smc: string
  alphax: string
  ghost: string
  openInterest: string
  footprint: string
  session: string
  fredMacro: string
  finraShortVolume: string
  cot: string
  warnings: string[]
  createdAt?: string

  // Optional dashboard fields for existing components
  bullPressure?: number
  bearPressure?: number
  ghostConfidence?: number
  chopRisk?: number
  macroRisk?: number
}

export type RecentSignal = {
  symbol: string
  timeframe?: string
  signal?: string
  type?: string
  confidence?: number
  bullScore?: number
  bearScore?: number
  netBias?: number
  price?: number
  createdAt?: string
  entry?: number
  current?: number
  pnl?: number
  percent?: number
  status?: string
}

const fallbackSignal: TradingSignal = {
  symbol: 'WAITING',
  timeframe: '1d',
  signal: 'NEUTRAL',
  confidence: 0,
  bullScore: 50,
  bearScore: 50,
  netBias: 0,
  price: 0,
  smc: 'Awaiting signal',
  alphax: 'Awaiting signal',
  ghost: 'Awaiting signal',
  openInterest: 'Awaiting signal',
  footprint: 'Awaiting signal',
  session: 'Market awaiting alert',
  fredMacro: 'Neutral',
  finraShortVolume: 'Awaiting signal',
  cot: 'Awaiting signal',
  warnings: ['No signal received yet'],
  createdAt: new Date().toISOString(),
  bullPressure: 50,
  bearPressure: 50,
  ghostConfidence: 0,
  chopRisk: 0,
  macroRisk: 0,
}

function normalizeSignal(raw: Partial<TradingSignal>): TradingSignal {
  const bullScore = Number(raw.bullScore ?? fallbackSignal.bullScore)
  const bearScore = Number(raw.bearScore ?? fallbackSignal.bearScore)
  const confidence = Number(raw.confidence ?? fallbackSignal.confidence)

  return {
    ...fallbackSignal,
    ...raw,
    symbol: raw.symbol ?? fallbackSignal.symbol,
    timeframe: raw.timeframe ?? fallbackSignal.timeframe,
    signal: raw.signal ?? fallbackSignal.signal,
    confidence,
    bullScore,
    bearScore,
    netBias: Number(raw.netBias ?? bullScore - bearScore),
    price: Number(raw.price ?? fallbackSignal.price),
    warnings: Array.isArray(raw.warnings) ? raw.warnings : fallbackSignal.warnings,

    // These keep your existing dashboard gauges working.
    bullPressure: Number(raw.bullPressure ?? bullScore),
    bearPressure: Number(raw.bearPressure ?? bearScore),
    ghostConfidence: Number(raw.ghostConfidence ?? confidence),
    chopRisk: Number(raw.chopRisk ?? 0),
    macroRisk: Number(raw.macroRisk ?? 0),
  }
}

function normalizeRecentSignals(raw: unknown): RecentSignal[] {
  if (!Array.isArray(raw)) return []

  return raw.map((item: any, index: number) => {
    const signal = item.signal ?? item.type ?? 'NEUTRAL'
    const price = Number(item.price ?? item.current ?? 0)

    return {
      symbol: item.symbol ?? 'WAITING',
      timeframe: item.timeframe ?? '1d',
      signal,
      type: signal,
      confidence: Number(item.confidence ?? 0),
      bullScore: Number(item.bullScore ?? 50),
      bearScore: Number(item.bearScore ?? 50),
      netBias: Number(item.netBias ?? 0),
      price,
      createdAt: item.createdAt ?? new Date().toISOString(),

      // Optional values for your existing table
      entry: Number(item.entry ?? price),
      current: Number(item.current ?? price),
      pnl: Number(item.pnl ?? 0),
      percent: Number(item.percent ?? 0),
      status: item.status ?? (index === 0 ? 'Open' : 'Closed'),
    }
  })
}

export function useApiPolling() {
  const [latestSignal, setLatestSignal] = useState<TradingSignal>(fallbackSignal)
  const [recentSignals, setRecentSignals] = useState<RecentSignal[]>([])
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('Waiting')
  const [lastUpdateTime, setLastUpdateTime] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const fetchDashboardData = useCallback(async () => {
    try {
      const [latestRes, recentRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/latest-signal`, {
          cache: 'no-store',
        }),
        fetch(`${API_BASE_URL}/api/recent-signals`, {
          cache: 'no-store',
        }),
      ])

      if (!latestRes.ok) {
        throw new Error(`Latest signal request failed: ${latestRes.status}`)
      }

      if (!recentRes.ok) {
        throw new Error(`Recent signals request failed: ${recentRes.status}`)
      }

      const latestJson = await latestRes.json()
      const recentJson = await recentRes.json()

      setLatestSignal(normalizeSignal(latestJson))
      setRecentSignals(normalizeRecentSignals(recentJson))
      setConnectionStatus('Connected')
      setLastUpdateTime(new Date().toLocaleTimeString())
      setErrorMessage(null)
    } catch (error) {
      console.error('API polling error:', error)

      setConnectionStatus('Error')
      setErrorMessage(error instanceof Error ? error.message : 'Unknown API polling error')

      // Keep fallback only if no real signal has loaded yet.
      setLatestSignal((prev) => prev ?? fallbackSignal)
    }
  }, [])

  useEffect(() => {
    setConnectionStatus('Waiting')

    fetchDashboardData()

    const interval = window.setInterval(() => {
      fetchDashboardData()
    }, 3000)

    return () => {
      window.clearInterval(interval)
    }
  }, [fetchDashboardData])

  return {
    latestSignal,
    recentSignals,
    connectionStatus,
    lastUpdateTime,
    errorMessage,
    apiBaseUrl: API_BASE_URL,
  }
}
