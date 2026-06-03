use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'

type TradingSignal = {
  symbol?: string
  timeframe?: string
  primaryTimeframe?: string
  activeSymbol?: string
  activeTimeframe?: string
  price?: number
  current?: number
  entry?: number
  signal?: string
  confidence?: number
  netBias?: number
  ghost?: string
}

type GhostCandleProjectionProps = {
  signal?: TradingSignal
  activeSymbol?: string
  activeTimeframe?: string
  activePrice?: number
}

type GhostCandle = {
  label: string
  direction: 'UP' | 'DOWN' | 'NEUTRAL'
  confidence: number
  open: number
  high: number
  low: number
  close: number
  source?: 'python' | 'chart'
  targetReaction?: string
  targetSeverity?: number
}

type OverlayPayload = {
  symbol?: string
  timeframe?: string
  ghostCandles?: any[]
  chartOverlays?: {
    ghostCandles?: any[]
  }
  overlayFlags?: Record<string, boolean>
  source?: string
  status?: string
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
  const raw = String(value ?? 'BTCUSD')
    .trim()
    .toUpperCase()
    .replace('BINANCE:', '')
    .replace('COINBASE:', '')
    .replace('CRYPTO:', '')
    .replace('CME_MINI:', '')
    .replace('CME:', '')

  if (raw === 'MES1' || raw === 'MES1!' || raw.includes('MES')) return 'MES1!'
  if (raw.includes('BTC')) return 'BTCUSD'
  if (raw.includes('ETH')) return 'ETHUSD'
  if (raw.includes('SPY')) return 'SPY'

  return raw || 'BTCUSD'
}

function normalizeTimeframe(value: any): string {
  const tf = String(value ?? '1m').trim().toLowerCase()

  if (tf.includes('/')) return normalizeTimeframe(tf.split('/')[0]?.trim())
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

function isSameTimeframe(value: any, activeTimeframe: string) {
  const raw = String(value ?? '').trim()

  if (raw.includes('/')) {
    return raw
      .split('/')
      .map((item) => normalizeTimeframe(item.trim()))
      .includes(normalizeTimeframe(activeTimeframe))
  }

  return normalizeTimeframe(raw) === normalizeTimeframe(activeTimeframe)
}

function isPriceNearActiveScale(price: number, activePrice?: number) {
  if (!Number.isFinite(price) || price <= 0) return false
  if (!activePrice || !Number.isFinite(activePrice) || activePrice <= 0) return true

  return Math.abs(price - activePrice) / activePrice <= 0.2
}

function normalizeDirection(value: any, open: number, close: number): 'UP' | 'DOWN' | 'NEUTRAL' {
  const text = String(value ?? '').toLowerCase()

  if (text.includes('up') || text.includes('bull') || text.includes('buy') || text === '1') return 'UP'
  if (text.includes('down') || text.includes('bear') || text.includes('sell') || text === '-1') return 'DOWN'
  if (close > open) return 'UP'
  if (close < open) return 'DOWN'

  return 'NEUTRAL'
}

function normalizeRawGhostCandles(rawGhosts: any[], sourceText: string): GhostCandle[] {
  const candles: GhostCandle[] = []

  rawGhosts.slice(0, 3).forEach((ghost: any, index: number) => {
    const open = toNumber(ghost.open) ?? toNumber(ghost.o) ?? toNumber(ghost.ghostOpen) ?? toNumber(ghost.projectedOpen)
    const high = toNumber(ghost.high) ?? toNumber(ghost.h) ?? toNumber(ghost.ghostHigh) ?? toNumber(ghost.projectedHigh)
    const low = toNumber(ghost.low) ?? toNumber(ghost.l) ?? toNumber(ghost.ghostLow) ?? toNumber(ghost.projectedLow)
    const close = toNumber(ghost.close) ?? toNumber(ghost.c) ?? toNumber(ghost.ghostClose) ?? toNumber(ghost.projectedClose)

    if (open === null || high === null || low === null || close === null) return

    const confidenceRaw =
      toNumber(ghost.confidence) ??
      toNumber(ghost.percent) ??
      toNumber(ghost.probability) ??
      toNumber(ghost.score) ??
      0

    const source = String(ghost.source ?? sourceText ?? '').toLowerCase()
    const isPython = source.includes('python') || sourceText.toLowerCase().includes('python')

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
      targetSeverity: typeof ghost.targetSeverity === 'number' ? ghost.targetSeverity : toNumber(ghost.targetSeverity) ?? undefined,
    })
  })

  return candles
}

function getSyncedGhostCandles(payload: OverlayPayload | null, activeSymbol: string, activeTimeframe: string, activePrice?: number) {
  if (!payload) return []

  const payloadSymbol = normalizeSymbol(payload.symbol)
  const payloadTimeframe = normalizeTimeframe(payload.timeframe)

  if (payloadSymbol !== normalizeSymbol(activeSymbol)) return []
  if (!isSameTimeframe(payloadTimeframe, activeTimeframe)) return []

  const rawGhosts = Array.isArray(payload.ghostCandles)
    ? payload.ghostCandles
    : Array.isArray(payload.chartOverlays?.ghostCandles)
      ? payload.chartOverlays?.ghostCandles ?? []
      : []

  const normalized = normalizeRawGhostCandles(rawGhosts, String(payload.source ?? 'python'))

  return normalized.filter((ghost) =>
    [ghost.open, ghost.high, ghost.low, ghost.close].every((price) => isPriceNearActiveScale(price, activePrice))
  )
}

function getProjectionText(candles: GhostCandle[], signal?: TradingSignal) {
  const first = candles[0]

  if (!first) return 'Waiting for synced chart ghost'

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
  activeSymbol,
  activeTimeframe,
  activePrice,
}: GhostCandleProjectionProps) {
  const symbol = normalizeSymbol(activeSymbol ?? signal?.activeSymbol ?? signal?.symbol)
  const timeframe = normalizeTimeframe(activeTimeframe ?? signal?.activeTimeframe ?? signal?.primaryTimeframe ?? signal?.timeframe)

  const [overlayPayload, setOverlayPayload] = useState<OverlayPayload | null>(null)
  const [engineStatus, setEngineStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchSyncedGhosts() {
      setEngineStatus((current) => (current === 'loaded' ? current : 'loading'))

      try {
        const params = new URLSearchParams({
          symbol,
          timeframe,
          limit: '500',
          smc: 'false',
          ghost: 'true',
          profile: 'false',
          orderBlocks: 'false',
        })

        const response = await fetch(`${API_BASE_URL}/api/chart-overlays?${params.toString()}`, {
          cache: 'no-store',
        })

        if (!response.ok) {
          if (!cancelled) setEngineStatus('error')
          return
        }

        const json = await response.json()

        if (!cancelled) {
          setOverlayPayload(json && typeof json === 'object' ? json : null)
          setEngineStatus('loaded')
        }
      } catch (error) {
        console.error('Ghost projection overlay fetch error:', error)

        if (!cancelled) setEngineStatus('error')
      }
    }

    fetchSyncedGhosts()
    intervalId = setInterval(fetchSyncedGhosts, 15000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [symbol, timeframe])

  const candles = useMemo(
    () => getSyncedGhostCandles(overlayPayload, symbol, timeframe, activePrice),
    [overlayPayload, symbol, timeframe, activePrice]
  )

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
              ? `Synced Python engine • ${symbol} • ${timeframe}`
              : engineStatus === 'error'
                ? `No synced ghost data • ${symbol} • ${timeframe}`
                : `Waiting for synced chart ghost • ${symbol} • ${timeframe}`}
          </p>
        </div>

        <span className="text-right text-xs text-gray-500">
          {projectionText}
        </span>
      </div>

      {candles.length === 0 ? (
        <div className="rounded-lg border border-dark-700 bg-dark-900/40 p-4 text-sm text-gray-400">
          Waiting for ghost candles that match the active chart symbol, timeframe, and price scale.
        </div>
      ) : (
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
                        SYNCED PYTHON
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
      )}
    </motion.div>
  )
}
