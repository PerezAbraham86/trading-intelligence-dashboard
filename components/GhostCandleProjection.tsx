'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'

type TradingSignal = {
  symbol?: string
  timeframe?: string
  price?: number
  signal?: string
  confidence?: number
  netBias?: number
  ghost?: string
}

type GhostCandleProjectionProps = {
  signal?: TradingSignal
}

type GhostCandle = {
  label: string
  direction: 'UP' | 'DOWN' | 'NEUTRAL'
  confidence: number
  open: number
  high: number
  low: number
  close: number
  source?: 'python' | 'chart' | 'fallback'
  targetReaction?: string
  targetSeverity?: number
}

type EngineState = {
  ghostCandles?: any[]
  ghostProjections?: any[]
  projections?: any[]
  ghostEngine?: {
    phase?: string
    source?: string
    count?: number
  }
  source?: {
    symbol?: string
    timeframe?: string
  }
}

const API_BASE_URL = 'https://trading-intelligence-dashboard.onrender.com'

function roundPrice(value: number) {
  return Number(value.toFixed(2))
}

function toNumber(value: any): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeSymbol(value: any): string {
  return String(value ?? 'BTCUSD')
    .trim()
    .toUpperCase()
    .replace('BINANCE:', '')
    .replace('COINBASE:', '')
    .replace('CRYPTO:', '')
    .replace('CME_MINI:', '')
    .replace('CME:', '')
}

function normalizeTimeframe(value: any): string {
  const tf = String(value ?? '1m').trim().toLowerCase()

  if (tf === '1') return '1m'
  if (tf === '3') return '3m'
  if (tf === '5') return '5m'
  if (tf === '15') return '15m'
  if (tf === '30') return '30m'
  if (tf === '60') return '1h'
  if (tf === '120') return '2h'
  if (tf === '240') return '4h'
  if (tf === 'd' || tf === '1d') return '1d'
  if (tf === 'w' || tf === '1w') return '1w'

  return tf || '1m'
}

function normalizeDirection(value: any, open: number, close: number): 'UP' | 'DOWN' | 'NEUTRAL' {
  const text = String(value ?? '').toLowerCase()

  if (text.includes('up') || text.includes('bull') || text.includes('buy') || text === '1') {
    return 'UP'
  }

  if (text.includes('down') || text.includes('bear') || text.includes('sell') || text === '-1') {
    return 'DOWN'
  }

  if (close > open) return 'UP'
  if (close < open) return 'DOWN'

  return 'NEUTRAL'
}

function buildFallbackGhostCandles(signal?: TradingSignal): GhostCandle[] {
  const price = Number(signal?.price ?? 0)
  const confidence = Number(signal?.confidence ?? 0)
  const netBias = Number(signal?.netBias ?? 0)

  const isBearish = signal?.signal === 'SELL' || netBias < 0
  const direction: 'UP' | 'DOWN' = isBearish ? 'DOWN' : 'UP'
  const step = price > 0 ? Math.max(price * 0.00035, 0.25) : 5
  const base = price > 0 ? price : 4575

  return [1, 2, 3].map((num) => {
    const biasStep = isBearish ? -step * num : step * num
    const open = base + biasStep - (isBearish ? -step : step) * 0.5
    const close = base + biasStep
    const high = Math.max(open, close) + step
    const low = Math.min(open, close) - step

    return {
      label: `Ghost #${num}`,
      direction,
      confidence: Math.max(0, Math.min(100, confidence - (num - 1) * 4)),
      open: roundPrice(open),
      high: roundPrice(high),
      low: roundPrice(low),
      close: roundPrice(close),
      source: 'fallback',
    }
  })
}

function normalizeEngineGhostCandles(engineState: EngineState | null): GhostCandle[] {
  if (!engineState) return []

  const rawGhosts = Array.isArray(engineState.ghostCandles)
    ? engineState.ghostCandles
    : Array.isArray(engineState.ghostProjections)
      ? engineState.ghostProjections
      : Array.isArray(engineState.projections)
        ? engineState.projections
        : []

  if (rawGhosts.length === 0) return []

  const candles: GhostCandle[] = []

  rawGhosts.slice(0, 3).forEach((ghost: any, index: number) => {
    const open =
      toNumber(ghost.open) ??
      toNumber(ghost.o) ??
      toNumber(ghost.ghostOpen) ??
      toNumber(ghost.projectedOpen)

    const high =
      toNumber(ghost.high) ??
      toNumber(ghost.h) ??
      toNumber(ghost.ghostHigh) ??
      toNumber(ghost.projectedHigh)

    const low =
      toNumber(ghost.low) ??
      toNumber(ghost.l) ??
      toNumber(ghost.ghostLow) ??
      toNumber(ghost.projectedLow)

    const close =
      toNumber(ghost.close) ??
      toNumber(ghost.c) ??
      toNumber(ghost.ghostClose) ??
      toNumber(ghost.projectedClose)

    if (open === null || high === null || low === null || close === null) return

    const confidenceRaw =
      toNumber(ghost.confidence) ??
      toNumber(ghost.percent) ??
      toNumber(ghost.probability) ??
      toNumber(ghost.score) ??
      0

    const source = String(ghost.source ?? engineState.ghostEngine?.source ?? '').toLowerCase()
    const isPython = source.includes('python') || Boolean(engineState.ghostEngine)

    candles.push({
      label: `${isPython ? 'PY' : 'Ghost'} #${index + 1}`,
      direction: normalizeDirection(ghost.direction ?? ghost.dir ?? ghost.signal, open, close),
      confidence: Math.round(Math.max(0, Math.min(100, confidenceRaw))),
      open: roundPrice(open),
      high: roundPrice(high),
      low: roundPrice(low),
      close: roundPrice(close),
      source: isPython ? 'python' : 'chart',
      targetReaction: typeof ghost.targetReaction === 'string' ? ghost.targetReaction : undefined,
      targetSeverity:
        typeof ghost.targetSeverity === 'number'
          ? ghost.targetSeverity
          : toNumber(ghost.targetSeverity) ?? undefined,
    })
  })

  return candles
}

function getProjectionText(candles: GhostCandle[], signal?: TradingSignal) {
  const first = candles[0]

  if (!first) return signal?.ghost ?? 'Waiting'

  if (first.source === 'python') {
    if (first.direction === 'UP') return 'Python Bullish Projection'
    if (first.direction === 'DOWN') return 'Python Bearish Projection'
    return 'Python Neutral Projection'
  }

  if (first.direction === 'UP') return 'Bullish Projection'
  if (first.direction === 'DOWN') return 'Bearish Projection'

  return signal?.ghost ?? 'Neutral Projection'
}

function getDirectionStyles(direction: GhostCandle['direction']) {
  if (direction === 'UP') {
    return {
      text: 'text-emerald-400',
      badge: 'bg-emerald-500/20 text-emerald-400',
      sourceBadge: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
      arrow: '↗',
    }
  }

  if (direction === 'DOWN') {
    return {
      text: 'text-red-400',
      badge: 'bg-red-500/20 text-red-400',
      sourceBadge: 'border-red-500/40 bg-red-500/10 text-red-300',
      arrow: '↘',
    }
  }

  return {
    text: 'text-yellow-400',
    badge: 'bg-yellow-500/20 text-yellow-400',
    sourceBadge: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
    arrow: '→',
  }
}

function formatReaction(value?: string) {
  if (!value) return ''

  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function GhostCandleProjection({
  signal,
}: GhostCandleProjectionProps) {
  const symbol = normalizeSymbol(signal?.symbol)
  const timeframe = normalizeTimeframe(signal?.timeframe)

  const [engineState, setEngineState] = useState<EngineState | null>(null)
  const [engineStatus, setEngineStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchEngineGhosts() {
      setEngineStatus((current) => (current === 'loaded' ? current : 'loading'))

      try {
        const params = new URLSearchParams({
          symbol,
          timeframe,
          limit: '500',
        })

        const response = await fetch(`${API_BASE_URL}/api/engine-state?${params.toString()}`, {
          cache: 'no-store',
        })

        if (!response.ok) {
          if (!cancelled) setEngineStatus('error')
          return
        }

        const json = await response.json()

        if (!cancelled) {
          setEngineState(json && typeof json === 'object' ? json : null)
          setEngineStatus('loaded')
        }
      } catch (error) {
        console.error('Ghost projection engine fetch error:', error)

        if (!cancelled) setEngineStatus('error')
      }
    }

    fetchEngineGhosts()
    intervalId = setInterval(fetchEngineGhosts, 15000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [symbol, timeframe])

  const pythonCandles = useMemo(() => normalizeEngineGhostCandles(engineState), [engineState])
  const fallbackCandles = useMemo(() => buildFallbackGhostCandles(signal), [signal])
  const candles = pythonCandles.length > 0 ? pythonCandles : fallbackCandles
  const projectionText = getProjectionText(candles, signal)
  const isPythonPowered = candles.some((candle) => candle.source === 'python')

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Ghost Candle Projections</h2>
          <p className="mt-1 text-xs text-gray-500">
            {isPythonPowered
              ? `Python engine • ${symbol} • ${timeframe}`
              : engineStatus === 'error'
                ? 'Python engine unavailable • fallback projection'
                : 'Waiting for Python engine'}
          </p>
        </div>

        <span className="text-right text-xs text-gray-500">
          {projectionText}
        </span>
      </div>

      <div className="space-y-3">
        {candles.map((candle, index) => {
          const styles = getDirectionStyles(candle.direction)
          const reactionText = formatReaction(candle.targetReaction)

          return (
            <motion.div
              key={`${candle.label}-${index}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.05 * index }}
              className="rounded-lg bg-dark-700/70 p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-gray-300">
                    {candle.label}
                  </span>

                  <span className={`text-xs font-bold ${styles.text}`}>
                    {styles.arrow} {candle.direction}
                  </span>

                  {candle.source === 'python' && (
                    <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${styles.sourceBadge}`}>
                      PYTHON
                    </span>
                  )}
                </div>

                <span className={`rounded px-2 py-1 text-xs font-bold ${styles.badge}`}>
                  {candle.confidence}%
                </span>
              </div>

              <div className="grid grid-cols-4 gap-3 text-xs">
                <div>
                  <p className="text-gray-500">O</p>
                  <p className="font-bold text-white">{candle.open}</p>
                </div>

                <div>
                  <p className="text-gray-500">H</p>
                  <p className="font-bold text-white">{candle.high}</p>
                </div>

                <div>
                  <p className="text-gray-500">L</p>
                  <p className="font-bold text-white">{candle.low}</p>
                </div>

                <div>
                  <p className="text-gray-500">C</p>
                  <p className="font-bold text-white">{candle.close}</p>
                </div>
              </div>

              {reactionText && (
                <div className="mt-3 rounded-md border border-dark-600 bg-dark-900/40 px-3 py-2 text-xs text-gray-400">
                  Target reaction:{' '}
                  <span className="font-bold text-gray-200">{reactionText}</span>
                  {typeof candle.targetSeverity === 'number' && (
                    <span className="ml-2 text-gray-500">
                      ({Math.round(candle.targetSeverity * 100)}%)
                    </span>
                  )}
                </div>
              )}
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}
