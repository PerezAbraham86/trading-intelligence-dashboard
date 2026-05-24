'use client'

import { useCallback, useEffect, useState } from 'react'

const API_BASE_URL = 'https://trading-intelligence-dashboard.onrender.com'

export type ConnectionStatus = 'Connected' | 'Waiting' | 'Error'

export type CandleData = {
  time: number | string
  open: number
  high: number
  low: number
  close: number
  volume?: number
  symbol: string
  timeframe: string
  createdAt?: string
}

export type TradingSignal = {
  eventType?: string
  status?: string
  symbol: string
  timeframe: string
  signal: 'BUY' | 'SELL' | 'NEUTRAL' | string
  confidence: number
  bullScore: number
  bearScore: number
  netBias: number
  price: number

  time?: number | string
  timestamp?: number | string
  open?: number
  high?: number
  low?: number
  close?: number
  volume?: number

  entry?: number
  current?: number
  pnl?: number
  percent?: number

  smc: string
  alphax: string
  ghost: string
  chartOverlays?: string

  openInterest: string
  footprint: string
  session: string
  fredMacro: string
  finraShortVolume: string
  cot: string
  warnings: string[]
  createdAt?: string

  bullPressure?: number
  bearPressure?: number
  ghostConfidence?: number
  chopRisk?: number
  macroRisk?: number
}

export type RecentSignal = {
  eventType?: string
  status?: string
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

  time?: number | string
  timestamp?: number | string
  open?: number
  high?: number
  low?: number
  close?: number
  volume?: number

  smc?: string
  alphax?: string
  ghost?: string
  chartOverlays?: string

  entry?: number
  current?: number
  pnl?: number
  percent?: number
}

const fallbackSignal: TradingSignal = {
  eventType: 'WAITING',
  status: 'Waiting',
  symbol: 'WAITING',
  timeframe: 'Waiting',
  signal: 'NEUTRAL',
  confidence: 0,
  bullScore: 50,
  bearScore: 50,
  netBias: 0,
  price: 0,

  time: Date.now(),
  timestamp: Date.now(),
  open: 0,
  high: 0,
  low: 0,
  close: 0,
  volume: 0,

  entry: 0,
  current: 0,
  pnl: 0,
  percent: 0,

  smc: 'Awaiting signal',
  alphax: 'Awaiting signal',
  ghost: 'Awaiting signal',
  chartOverlays: '',

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

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeSignal(rawInput: Partial<TradingSignal> | any): TradingSignal {
  const raw = rawInput ?? {}

  const bullScore = toNumber(raw.bullScore, fallbackSignal.bullScore)
  const bearScore = toNumber(raw.bearScore, fallbackSignal.bearScore)
  const confidence = toNumber(raw.confidence, fallbackSignal.confidence)

  const close =
    toOptionalNumber(raw.close) ??
    toOptionalNumber(raw.current) ??
    toOptionalNumber(raw.price) ??
    fallbackSignal.close ??
    0

  const price = toNumber(raw.price ?? close, fallbackSignal.price)

  return {
    ...fallbackSignal,
    ...raw,

    eventType: raw.eventType ?? fallbackSignal.eventType,
    status: raw.status ?? fallbackSignal.status,
    symbol: raw.symbol ?? fallbackSignal.symbol,
    timeframe: raw.timeframe ?? fallbackSignal.timeframe,
    signal: raw.signal ?? fallbackSignal.signal,

    confidence,
    bullScore,
    bearScore,
    netBias: toNumber(raw.netBias, bullScore - bearScore),
    price,

    time: raw.time ?? raw.timestamp ?? raw.createdAt ?? fallbackSignal.time,
    timestamp: raw.timestamp ?? raw.time ?? raw.createdAt ?? fallbackSignal.timestamp,

    open: toNumber(raw.open, price),
    high: toNumber(raw.high, price),
    low: toNumber(raw.low, price),
    close: toNumber(close, price),
    volume: toNumber(raw.volume, 0),

    entry: toNumber(raw.entry, price),
    current: toNumber(raw.current ?? close, price),
    pnl: toNumber(raw.pnl, 0),
    percent: toNumber(raw.percent, 0),

    smc: raw.smc ?? fallbackSignal.smc,
    alphax: raw.alphax ?? fallbackSignal.alphax,
    ghost: raw.ghost ?? fallbackSignal.ghost,
    chartOverlays: raw.chartOverlays ?? fallbackSignal.chartOverlays,

    openInterest: raw.openInterest ?? fallbackSignal.openInterest,
    footprint: raw.footprint ?? fallbackSignal.footprint,
    session: raw.session ?? fallbackSignal.session,
    fredMacro: raw.fredMacro ?? fallbackSignal.fredMacro,
    finraShortVolume: raw.finraShortVolume ?? fallbackSignal.finraShortVolume,
    cot: raw.cot ?? fallbackSignal.cot,

    warnings: Array.isArray(raw.warnings) ? raw.warnings : fallbackSignal.warnings,

    bullPressure: toNumber(raw.bullPressure, bullScore),
    bearPressure: toNumber(raw.bearPressure, bearScore),
    ghostConfidence: toNumber(raw.ghostConfidence, confidence),
    chopRisk: toNumber(raw.chopRisk, 0),
    macroRisk: toNumber(raw.macroRisk, 0),
  }
}

function normalizeRecentSignals(raw: unknown): RecentSignal[] {
  if (!Array.isArray(raw)) return []

  return raw.map((item: any, index: number) => {
    const signal = item.signal ?? item.type ?? 'NEUTRAL'

    const close =
      toOptionalNumber(item.close) ??
      toOptionalNumber(item.current) ??
      toOptionalNumber(item.price) ??
      0

    const price = toNumber(item.price ?? close, 0)

    return {
      eventType: item.eventType,
      status: item.status ?? (index === 0 ? 'Live' : 'Live'),
      symbol: item.symbol ?? 'WAITING',
      timeframe: item.timeframe ?? '1',
      signal,
      type: signal,

      confidence: toNumber(item.confidence, 0),
      bullScore: toNumber(item.bullScore, 50),
      bearScore: toNumber(item.bearScore, 50),
      netBias: toNumber(item.netBias, 0),
      price,

      createdAt: item.createdAt ?? new Date().toISOString(),

      time: item.time ?? item.timestamp ?? item.createdAt ?? new Date().toISOString(),
      timestamp: item.timestamp ?? item.time ?? item.createdAt ?? new Date().toISOString(),
      open: toOptionalNumber(item.open),
      high: toOptionalNumber(item.high),
      low: toOptionalNumber(item.low),
      close: toOptionalNumber(close),
      volume: toOptionalNumber(item.volume),

      smc: item.smc,
      alphax: item.alphax,
      ghost: item.ghost,
      chartOverlays: item.chartOverlays,

      entry: toNumber(item.entry ?? price, price),
      current: toNumber(item.current ?? close ?? price, price),
      pnl: toNumber(item.pnl, 0),
      percent: toNumber(item.percent, 0),
    }
  })
}

function normalizeRecentCandles(raw: unknown): CandleData[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((item: any) => {
      const open = toOptionalNumber(item.open)
      const high = toOptionalNumber(item.high)
      const low = toOptionalNumber(item.low)
      const close = toOptionalNumber(item.close)

      if (
        open === undefined ||
        high === undefined ||
        low === undefined ||
        close === undefined
      ) {
        return null
      }

      return {
        time: item.time ?? item.timestamp ?? item.createdAt ?? new Date().toISOString(),
        open,
        high,
        low,
        close,
        volume: toNumber(item.volume, 0),
        symbol: item.symbol ?? 'UNKNOWN',
        timeframe: item.timeframe ?? '1',
        createdAt: item.createdAt,
      }
    })
    .filter((item): item is CandleData => item !== null)
}

export function useApiPolling() {
  const [latestSignal, setLatestSignal] = useState<TradingSignal>(fallbackSignal)
  const [recentSignals, setRecentSignals] = useState<RecentSignal[]>([])
  const [recentCandles, setRecentCandles] = useState<CandleData[]>([])
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('Waiting')
  const [lastUpdateTime, setLastUpdateTime] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const fetchDashboardData = useCallback(async () => {
    try {
      const [latestRes, recentRes, candlesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/latest-signal`, {
          cache: 'no-store',
        }),
        fetch(`${API_BASE_URL}/api/recent-signals`, {
          cache: 'no-store',
        }),
        fetch(`${API_BASE_URL}/api/recent-candles`, {
          cache: 'no-store',
        }),
      ])

      if (!latestRes.ok) {
        throw new Error(`Latest signal request failed: ${latestRes.status}`)
      }

      if (!recentRes.ok) {
        throw new Error(`Recent signals request failed: ${recentRes.status}`)
      }

      if (!candlesRes.ok) {
        throw new Error(`Recent candles request failed: ${candlesRes.status}`)
      }

      const latestJson = await latestRes.json()
      const recentJson = await recentRes.json()
      const candlesJson = await candlesRes.json()

      setLatestSignal(normalizeSignal(latestJson))
      setRecentSignals(normalizeRecentSignals(recentJson))
      setRecentCandles(normalizeRecentCandles(candlesJson))
      setConnectionStatus('Connected')
      setLastUpdateTime(new Date().toLocaleTimeString())
      setErrorMessage(null)
    } catch (error) {
      console.error('API polling error:', error)

      setConnectionStatus('Error')
      setErrorMessage(error instanceof Error ? error.message : 'Unknown API polling error')
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
    recentCandles,
    connectionStatus,
    lastUpdateTime,
    errorMessage,
    apiBaseUrl: API_BASE_URL,
  }
}
