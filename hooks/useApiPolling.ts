import { useEffect, useState, useCallback, useRef } from 'react'

export type ConnectionStatus = 'connected' | 'waiting' | 'error'

export interface LatestSignal {
  symbol: string
  timeframe: string
  signal: 'BUY' | 'SELL' | 'NEUTRAL'
  confidence: number
  bullScore: number
  bearScore: number
  netBias: string
  price: number
  warnings?: string[]
}

export interface Factor {
  name: string
  smc?: number
  alphax?: number
  ghost?: number
  openInterest?: number
  footprint?: number
  session?: number
  fredMacro?: number
  finraShortVolume?: number
  cot?: number
}

export interface RecentSignal {
  id: number
  symbol: string
  type: 'BUY' | 'SELL'
  entry: number
  current: number
  pnl: number
  pnlPct: number
  status: 'open' | 'closed'
}

const API_BASE_URL = 'https://trading-intelligence-dashboard.onrender.com'
const POLL_INTERVAL = 3000 // 3 seconds

// Mock data as fallback
const MOCK_LATEST_SIGNAL: LatestSignal = {
  symbol: 'ES1!',
  timeframe: '5m',
  signal: 'BUY',
  confidence: 82,
  bullScore: 78,
  bearScore: 22,
  netBias: '+56',
  price: 4570.50,
  warnings: ['FOMC Meeting in 2 hours', 'Chop Zone at 42%']
}

const MOCK_RECENT_SIGNALS: RecentSignal[] = [
  { id: 1, symbol: 'ES1!', type: 'BUY', entry: 4570, current: 4585, pnl: 15, pnlPct: 0.33, status: 'open' },
  { id: 2, symbol: 'ES1!', type: 'SELL', entry: 4555, current: 4570, pnl: -15, pnlPct: -0.33, status: 'open' },
  { id: 3, symbol: 'ES1!', type: 'BUY', entry: 4540, current: 4550, pnl: 10, pnlPct: 0.22, status: 'closed' },
  { id: 4, symbol: 'ES1!', type: 'BUY', entry: 4520, current: 4535, pnl: 15, pnlPct: 0.36, status: 'closed' },
  { id: 5, symbol: 'ES1!', type: 'SELL', entry: 4510, current: 4500, pnl: 10, pnlPct: 0.22, status: 'closed' },
]

export function useApiPolling() {
  const [latestSignal, setLatestSignal] = useState<LatestSignal>(MOCK_LATEST_SIGNAL)
  const [recentSignals, setRecentSignals] = useState<RecentSignal[]>(MOCK_RECENT_SIGNALS)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('waiting')
  const [lastUpdateTime, setLastUpdateTime] = useState<Date>(new Date())
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchLatestSignal = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/latest-signal`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setLatestSignal(data)
      setConnectionStatus('connected')
      setLastUpdateTime(new Date())
      return data
    } catch (error) {
      console.error('Failed to fetch latest signal:', error)
      setConnectionStatus('error')
      // Keep using mock data as fallback
      return null
    }
  }, [])

  const fetchRecentSignals = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/recent-signals`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setRecentSignals(data)
      setConnectionStatus('connected')
      setLastUpdateTime(new Date())
      return data
    } catch (error) {
      console.error('Failed to fetch recent signals:', error)
      setConnectionStatus('error')
      // Keep using mock data as fallback
      return null
    }
  }, [])

  const startPolling = useCallback(() => {
    setConnectionStatus('waiting')

    // Initial fetch
    fetchLatestSignal()
    fetchRecentSignals()

    // Set up polling interval
    pollIntervalRef.current = setInterval(() => {
      fetchLatestSignal()
      fetchRecentSignals()
    }, POLL_INTERVAL)
  }, [fetchLatestSignal, fetchRecentSignals])

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }, [])

  useEffect(() => {
    startPolling()
    return () => stopPolling()
  }, [startPolling, stopPolling])

  return {
    latestSignal,
    recentSignals,
    connectionStatus,
    lastUpdateTime,
    refetch: async () => {
      await fetchLatestSignal()
      await fetchRecentSignals()
    }
  }
}
