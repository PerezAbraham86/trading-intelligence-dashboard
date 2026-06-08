'use client'

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
  ghostDirection?: string
  ghostConfidence?: number
}

type GhostCandleProjectionProps = {
  signal?: TradingSignal
  activeSymbol?: string
  activeTimeframe?: string
  activePrice?: number
  overlayPayload?: OverlayPayload | null
  scorecards?: any | null
  unifiedIntelligence?: any | null
}

type GhostCandle = {
  label: string
  direction: 'UP' | 'DOWN' | 'NEUTRAL'
  confidence: number
  open: number
  high: number
  low: number
  close: number
  source?: 'python' | 'chart' | 'scorecard' | 'unified'
  targetReaction?: string
  targetSeverity?: number
  priceScaleWarning?: boolean
}

type OverlayPayload = {
  symbol?: string
  timeframe?: string
  ghostCandles?: any[]
  chartOverlays?: {
    ghostCandles?: any[]
  }
  overlays?: {
    ghostCandles?: any[]
  }
  scorecards?: any
  mlFeatures?: any
  unifiedIntelligence?: any
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

function clamp(value: number, low = 0, high = 100) {
  return Math.max(low, Math.min(high, value))
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
  if (raw === 'ES1' || raw === 'ES1!' || raw.includes('ES')) return 'ES1!'
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

  if (!raw) return true

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

  return Math.abs(price - activePrice) / activePrice <= 0.35
}

function normalizeDirection(value: any, open: number, close: number): 'UP' | 'DOWN' | 'NEUTRAL' {
  const text = String(value ?? '').toLowerCase()

  if (text.includes('up') || text.includes('bull') || text.includes('buy') || text === '1') return 'UP'
  if (text.includes('down') || text.includes('bear') || text.includes('sell') || text === '-1') return 'DOWN'
  if (close > open) return 'UP'
  if (close < open) return 'DOWN'

  return 'NEUTRAL'
}

function readUnifiedGhostCandles(unifiedIntelligence: any | null | undefined): any[] {
  if (!unifiedIntelligence || typeof unifiedIntelligence !== 'object') return []

  const candidates = [
    unifiedIntelligence.ghostProjection?.candles,
    unifiedIntelligence.ghostProjection?.ghostCandles,
    unifiedIntelligence.components?.ghost?.candles,
    unifiedIntelligence.components?.ghost?.ghostCandles,
    unifiedIntelligence.ghostCandles,
    unifiedIntelligence.projections,
  ]

  for (const value of candidates) {
    if (Array.isArray(value) && value.length > 0) return value
  }

  return []
}

function getUnifiedProjectionScorecards(unifiedIntelligence: any | null | undefined) {
  if (!unifiedIntelligence || typeof unifiedIntelligence !== 'object') return null

  const ghost = unifiedIntelligence.components?.ghost
  const market = unifiedIntelligence.marketSentiment
  const aiTrader = unifiedIntelligence.aiTrader

  return {
    ghost: {
      direction: ghost?.direction ?? unifiedIntelligence.ghostProjection?.direction,
      confidence: ghost?.confidence ?? unifiedIntelligence.ghostProjection?.confidence,
    },
    overall: {
      direction: market?.direction ?? aiTrader?.direction,
      confirmationScore: market?.strength ?? aiTrader?.confidence,
    },
  }
}

function readRawGhostCandles(payload: OverlayPayload | null): any[] {
  if (!payload || typeof payload !== 'object') return []

  const candidates = [
    payload.ghostCandles,
    payload.chartOverlays?.ghostCandles,
    payload.overlays?.ghostCandles,
    (payload as any).chartOverlayPayload?.ghostCandles,
    (payload as any).mlFeatures?.ghostCandles,
    (payload as any).scorecards?.ghost?.ghostCandles,
  ]

  for (const value of candidates) {
    if (Array.isArray(value) && value.length > 0) return value
  }

  return []
}

function normalizeRawGhostCandles(rawGhosts: any[], sourceText: string): GhostCandle[] {
  const candles: GhostCandle[] = []

  rawGhosts.slice(0, 3).forEach((ghost: any, index: number) => {
    const open =
      toNumber(ghost.open) ??
      toNumber(ghost.o) ??
      toNumber(ghost.ghostOpen) ??
      toNumber(ghost.projectedOpen) ??
      toNumber(ghost.haOpen)
    const high =
      toNumber(ghost.high) ??
      toNumber(ghost.h) ??
      toNumber(ghost.ghostHigh) ??
      toNumber(ghost.projectedHigh) ??
      toNumber(ghost.haHigh)
    const low =
      toNumber(ghost.low) ??
      toNumber(ghost.l) ??
      toNumber(ghost.ghostLow) ??
      toNumber(ghost.projectedLow) ??
      toNumber(ghost.haLow)
    const close =
      toNumber(ghost.close) ??
      toNumber(ghost.c) ??
      toNumber(ghost.ghostClose) ??
      toNumber(ghost.projectedClose) ??
      toNumber(ghost.haClose)

    if (open === null || high === null || low === null || close === null) return

    const confidenceRaw =
      toNumber(ghost.confidence) ??
      toNumber(ghost.percent) ??
      toNumber(ghost.probability) ??
      toNumber(ghost.score) ??
      toNumber(ghost.trust) ??
      0

    const source = String(ghost.source ?? sourceText ?? '').toLowerCase()
    const isUnified = source.includes('unified') || sourceText.toLowerCase().includes('unified')
    const isPython = source.includes('python') || sourceText.toLowerCase().includes('python')

    candles.push({
      label: ghost.label ? String(ghost.label) : `${isUnified ? 'UI' : isPython ? 'PY' : 'Ghost'} #${index + 1}`,
      direction: normalizeDirection(ghost.direction ?? ghost.dir ?? ghost.signal, open, close),
      confidence: Math.round(clamp(confidenceRaw)),
      open: roundPrice(open),
      high: roundPrice(high),
      low: roundPrice(low),
      close: roundPrice(close),
      source: isUnified ? 'unified' : isPython ? 'python' : 'chart',
      targetReaction: typeof ghost.targetReaction === 'string' ? ghost.targetReaction : undefined,
      targetSeverity: typeof ghost.targetSeverity === 'number' ? ghost.targetSeverity : toNumber(ghost.targetSeverity) ?? undefined,
    })
  })

  return candles
}

function scorecardDirection(scorecards: any, signal?: TradingSignal): 'UP' | 'DOWN' | 'NEUTRAL' {
  const text = String(
    scorecards?.ghost?.direction ??
      scorecards?.overall?.direction ??
      signal?.ghostDirection ??
      signal?.ghost ??
      signal?.signal ??
      ''
  ).toLowerCase()

  if (text.includes('bull') || text.includes('buy') || text.includes('up')) return 'UP'
  if (text.includes('bear') || text.includes('sell') || text.includes('down')) return 'DOWN'
  return 'NEUTRAL'
}

function buildScorecardBackedProjection(
  signal: TradingSignal | undefined,
  scorecards: any,
  activePrice?: number
): GhostCandle[] {
  const base = toNumber(activePrice) ?? toNumber(signal?.current) ?? toNumber(signal?.price) ?? toNumber(signal?.entry)
  if (!base || base <= 0) return []

  const direction = scorecardDirection(scorecards, signal)
  if (direction === 'NEUTRAL') return []

  const confidence = Math.round(
    clamp(
      toNumber(scorecards?.ghost?.confidence) ??
        toNumber(signal?.ghostConfidence) ??
        toNumber(signal?.confidence) ??
        toNumber(scorecards?.overall?.confirmationScore) ??
        21,
      5,
      99
    )
  )

  const step = Math.max(base * 0.00018, 0.5)
  const wick = Math.max(base * 0.00012, 0.25)
  const candles: GhostCandle[] = []

  let previousClose = base
  for (let index = 0; index < 3; index += 1) {
    const move = step * (index + 1) * (direction === 'UP' ? 1 : -1)
    const open = previousClose
    const close = base + move
    const high = Math.max(open, close) + wick * (index + 1)
    const low = Math.min(open, close) - wick * (index + 1)

    candles.push({
      label: `PY #${index + 1}`,
      direction,
      confidence: Math.max(10, confidence - index * 4),
      open: roundPrice(open),
      high: roundPrice(high),
      low: roundPrice(low),
      close: roundPrice(close),
      source: 'scorecard',
      targetReaction: 'scorecard_backed_projection_waiting_for_raw_ghost_candles',
      targetSeverity: confidence / 100,
    })

    previousClose = close
  }

  return candles
}

function getSyncedGhostCandles(
  payload: OverlayPayload | null,
  activeSymbol: string,
  activeTimeframe: string,
  activePrice?: number,
  signal?: TradingSignal,
  scorecards?: any,
  unifiedIntelligence?: any | null
) {
  const payloadSymbol = normalizeSymbol(payload?.symbol ?? activeSymbol)
  const payloadTimeframe = normalizeTimeframe(payload?.timeframe ?? activeTimeframe)

  if (payload && payloadSymbol !== normalizeSymbol(activeSymbol)) return []
  if (payload && !isSameTimeframe(payloadTimeframe, activeTimeframe)) return []

  const unifiedGhosts = readUnifiedGhostCandles(unifiedIntelligence ?? (payload as any)?.unifiedIntelligence)
  const rawGhosts = unifiedGhosts.length > 0 ? unifiedGhosts : readRawGhostCandles(payload)
  const normalized = normalizeRawGhostCandles(
    rawGhosts,
    unifiedGhosts.length > 0 ? 'unified_intelligence' : String(payload?.source ?? 'python')
  )

  if (normalized.length > 0) {
    const priceMatched = normalized.filter((ghost) =>
      [ghost.open, ghost.high, ghost.low, ghost.close].every((price) => isPriceNearActiveScale(price, activePrice))
    )

    if (priceMatched.length > 0) return priceMatched

    return normalized.map((ghost) => ({
      ...ghost,
      priceScaleWarning: true,
    }))
  }

  return buildScorecardBackedProjection(
    signal,
    scorecards ?? getUnifiedProjectionScorecards(unifiedIntelligence ?? (payload as any)?.unifiedIntelligence) ?? payload?.scorecards,
    activePrice
  )
}

function getProjectionText(candles: GhostCandle[], signal?: TradingSignal) {
  const first = candles[0]

  if (!first) return 'Waiting for synced chart ghost'

  if (first.source === 'unified') {
    if (first.direction === 'UP') return 'Unified Bullish Projection'
    if (first.direction === 'DOWN') return 'Unified Bearish Projection'
    return 'Unified Neutral Projection'
  }

  if (first.source === 'scorecard') {
    if (first.direction === 'UP') return 'Scorecard Bullish Projection'
    if (first.direction === 'DOWN') return 'Scorecard Bearish Projection'
    return 'Scorecard Neutral Projection'
  }

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
  overlayPayload,
  scorecards,
  unifiedIntelligence,
}: GhostCandleProjectionProps) {
  const symbol = normalizeSymbol(activeSymbol ?? signal?.activeSymbol ?? signal?.symbol)
  const timeframe = normalizeTimeframe(activeTimeframe ?? signal?.activeTimeframe ?? signal?.primaryTimeframe ?? signal?.timeframe)

  const [fetchedOverlayPayload, setFetchedOverlayPayload] = useState<OverlayPayload | null>(null)
  const [engineStatus, setEngineStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')

  useEffect(() => {
    if (overlayPayload) {
      setEngineStatus('loaded')
      return
    }

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchSyncedGhosts() {
      setEngineStatus((current) => (current === 'loaded' ? current : 'loading'))

      try {
        const params = new URLSearchParams({
          symbol,
          timeframe,
          limit: '500',
          smc: 'true',
          ghost: 'true',
          profile: 'true',
          orderBlocks: 'true',
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
          setFetchedOverlayPayload(json && typeof json === 'object' ? json : null)
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
  }, [symbol, timeframe, overlayPayload])

  const activePayload = useMemo(() => {
    const base = overlayPayload ?? fetchedOverlayPayload
    if (!base || !unifiedIntelligence) return base
    return {
      ...base,
      unifiedIntelligence,
    }
  }, [fetchedOverlayPayload, overlayPayload, unifiedIntelligence])

  const candles = useMemo(
    () => getSyncedGhostCandles(activePayload, symbol, timeframe, activePrice, signal, scorecards, unifiedIntelligence),
    [activePayload, symbol, timeframe, activePrice, signal, scorecards, unifiedIntelligence]
  )

  const projectionText = getProjectionText(candles, signal)
  const isUnifiedPowered = candles.some((candle) => candle.source === 'unified')
  const isPythonPowered = candles.some((candle) => candle.source === 'python')
  const isScorecardBacked = candles.some((candle) => candle.source === 'scorecard')
  const rawGhostCount = readRawGhostCandles(activePayload).length

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
            {isUnifiedPowered
              ? `Unified Intelligence • ${symbol} • ${timeframe}`
              : isPythonPowered
                ? `Synced Python engine • ${symbol} • ${timeframe}`
                : isScorecardBacked
                ? `Scorecard-backed projection • ${symbol} • ${timeframe}`
                : engineStatus === 'error'
                  ? `No synced ghost data • ${symbol} • ${timeframe}`
                  : `Waiting for synced chart ghost • ${symbol} • ${timeframe}`}
          </p>
          {rawGhostCount > 0 && candles.some((candle) => candle.priceScaleWarning) && (
            <p className="mt-1 text-[10px] text-yellow-400">
              Raw ghost candles were found, but their price scale did not perfectly match the active chart. Showing them anyway.
            </p>
          )}
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

                    {candle.source === 'unified' && (
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${styles.sourceBadge}`}>
                        UNIFIED AI
                      </span>
                    )}

                    {candle.source === 'python' && (
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${styles.sourceBadge}`}>
                        SYNCED PYTHON
                      </span>
                    )}

                    {candle.source === 'scorecard' && (
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${styles.sourceBadge}`}>
                        SCORECARD BACKED
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
