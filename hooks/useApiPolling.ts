'use client'

import { useCallback, useEffect, useState } from 'react'

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://trading-intelligence-dashboard.onrender.com'

export type ConnectionStatus = 'Connected' | 'Waiting' | 'Error'

type ChartOverlayToggles = {
  smc?: boolean
  ghost?: boolean
  liquidityProfile?: boolean
  orderBlocks?: boolean
}

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
  chartOverlayToggles?: ChartOverlayToggles

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
  chartOverlayToggles?: ChartOverlayToggles

  entry?: number
  current?: number
  pnl?: number
  percent?: number
}

type UseApiPollingOptions = {
  symbol?: string
  timeframe?: string
  enabled?: boolean
  pollMs?: number
}

const fallbackSignal: TradingSignal = {
  eventType: 'WAITING',
  status: 'Waiting',
  symbol: 'MES1!',
  timeframe: '1m',
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
  chartOverlayToggles: {
    smc: false,
    ghost: false,
    liquidityProfile: false,
    orderBlocks: false,
  },

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

function normalizeSymbol(value: unknown): string {
  const raw = String(value ?? 'MES1!').trim().toUpperCase()

  if (raw.includes('MES')) return 'MES1!'
  if (raw.includes('BTC')) return 'BTCUSD'
  if (raw.includes('ETH')) return 'ETHUSD'
  if (raw.includes('SPY')) return 'SPY'

  return raw || 'MES1!'
}

function normalizeTimeframe(value: unknown): string {
  const raw = String(value ?? '1m').trim().toLowerCase()
  const map: Record<string, string> = {
    '1': '1m',
    '1m': '1m',
    '3': '3m',
    '3m': '3m',
    '5': '5m',
    '5m': '5m',
    '10': '10m',
    '10m': '10m',
    '15': '15m',
    '15m': '15m',
    '30': '30m',
    '30m': '30m',
    '60': '1h',
    '1h': '1h',
    '1d': '1d',
  }

  return map[raw] ?? raw ?? '1m'
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeChartOverlayToggles(value: unknown): ChartOverlayToggles | undefined {
  if (!isObject(value)) return undefined

  return {
    smc: Boolean(value.smc),
    ghost: Boolean(value.ghost),
    liquidityProfile: Boolean(value.liquidityProfile),
    orderBlocks: Boolean(value.orderBlocks),
  }
}

function unwrapObjectPayload(raw: unknown, keys: string[]): unknown {
  if (!isObject(raw)) return raw

  for (const key of keys) {
    const value = raw[key]

    if (isObject(value)) {
      return value
    }
  }

  return raw
}

function unwrapArrayPayload(raw: unknown, keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw
  if (!isObject(raw)) return []

  for (const key of keys) {
    const value = raw[key]

    if (Array.isArray(value)) {
      return value
    }
  }

  return []
}

function normalizeSignal(rawInput: Partial<TradingSignal> | any): TradingSignal {
  const raw = unwrapObjectPayload(rawInput, [
    'signal',
    'latestSignal',
    'latest',
    'data',
    'result',
  ]) as Partial<TradingSignal> | any

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
    symbol: normalizeSymbol(raw.symbol ?? fallbackSignal.symbol),
    timeframe: normalizeTimeframe(raw.timeframe ?? fallbackSignal.timeframe),
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
    chartOverlayToggles:
      normalizeChartOverlayToggles(raw.chartOverlayToggles) ??
      fallbackSignal.chartOverlayToggles,
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

function normalizeRecentSignals(rawInput: unknown): RecentSignal[] {
  const raw = unwrapArrayPayload(rawInput, [
    'signals',
    'recentSignals',
    'rows',
    'items',
    'data',
    'result',
  ])

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
      symbol: normalizeSymbol(item.symbol ?? 'MES1!'),
      timeframe: normalizeTimeframe(item.timeframe ?? '1m'),
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
      chartOverlayToggles: normalizeChartOverlayToggles(item.chartOverlayToggles),
      entry: toNumber(item.entry ?? price, price),
      current: toNumber(item.current ?? close ?? price, price),
      pnl: toNumber(item.pnl, 0),
      percent: toNumber(item.percent, 0),
    }
  })
}

function normalizeRecentCandles(rawInput: unknown): CandleData[] {
  const raw = unwrapArrayPayload(rawInput, [
    'candles',
    'recentCandles',
    'bars',
    'rows',
    'items',
    'data',
    'result',
  ])

  return raw
    .map((item: any): CandleData | null => {
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
        symbol: normalizeSymbol(item.symbol ?? 'MES1!'),
        timeframe: normalizeTimeframe(item.timeframe ?? '1m'),
        createdAt: item.createdAt ?? new Date().toISOString(),
      }
    })
    .filter((item): item is CandleData => item !== null)
}

export function useApiPolling(options: UseApiPollingOptions = {}) {
  const normalizedSymbol = normalizeSymbol(options.symbol ?? 'MES1!')
  const normalizedTimeframe = normalizeTimeframe(options.timeframe ?? '1m')
  const enabled = options.enabled ?? true
  const pollMs = Math.max(5000, Number(options.pollMs ?? 10000) || 10000)

  const [latestSignal, setLatestSignal] = useState<TradingSignal>(fallbackSignal)
  const [recentSignals, setRecentSignals] = useState<RecentSignal[]>([])
  const [recentCandles, setRecentCandles] = useState<CandleData[]>([])
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('Waiting')
  const [lastUpdateTime, setLastUpdateTime] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const fetchDashboardData = useCallback(async () => {
    if (!enabled) {
      setConnectionStatus('Waiting')
      return
    }

    const params = new URLSearchParams({
      symbol: normalizedSymbol,
      timeframe: normalizedTimeframe,
      limit: '50',
    })

    try {
      const [latestRes, recentRes, candlesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/latest-signal?${params.toString()}`, {
          cache: 'no-store',
        }),
        fetch(`${API_BASE_URL}/api/recent-signals?${params.toString()}`, {
          cache: 'no-store',
        }),
        fetch(`${API_BASE_URL}/api/recent-candles?${params.toString()}`, {
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

      const nextRecentSignals = normalizeRecentSignals(recentJson)
      const nextRecentCandles = normalizeRecentCandles(candlesJson)

      setRecentSignals((prev) =>
        nextRecentSignals.length > 0 ? nextRecentSignals : prev
      )

      setRecentCandles((prev) =>
        nextRecentCandles.length > 0 ? nextRecentCandles : prev
      )

      setConnectionStatus('Connected')
      setLastUpdateTime(new Date().toLocaleTimeString())
      setErrorMessage(null)
    } catch (error) {
      console.error('API polling error:', error)
      setConnectionStatus('Error')
      setErrorMessage(error instanceof Error ? error.message : 'Unknown API polling error')
      setLatestSignal((prev) => prev ?? fallbackSignal)
    }
  }, [enabled, normalizedSymbol, normalizedTimeframe])

  useEffect(() => {
    if (!enabled) {
      setConnectionStatus('Waiting')
      return
    }

    setConnectionStatus('Waiting')
    fetchDashboardData()

    const interval = window.setInterval(() => {
      fetchDashboardData()
    }, pollMs)

    return () => {
      window.clearInterval(interval)
    }
  }, [enabled, fetchDashboardData, pollMs])

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
