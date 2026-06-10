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
  target?: number
  targetPrice?: number
  takeProfitPrice?: number
  tp1?: number
  targetMl?: any
  targetPlan?: any
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

  // Target ML fields
  targetMlAligned?: boolean
  targetPrice?: number | null
  finalTargetPrice?: number | null
  targetSource?: string
  targetConfidence?: number | null
  targetMlReady?: boolean
  ghostConfidenceBoost?: number | null

  // Ghost ML fields
  mlAdjusted?: boolean
  mlReady?: boolean
  mlReason?: string
  mlConfidenceMultiplier?: number | null
  mlConfidenceBonus?: number | null
  mlProjectionMultiplier?: number | null
  mlHierarchy?: string
  nrtrUsedForMl?: number
  smmaUsedForMl?: number
}

type OverlayPayload = {
  symbol?: string
  timeframe?: string
  ghostCandles?: any[]
  ghostProjections?: any[]
  projections?: any[]
  targetMl?: any
  targetPlan?: any
  targetMlStatus?: any
  chartOverlays?: {
    ghostCandles?: any[]
    targetMl?: any
    targetPlan?: any
  }
  overlays?: {
    ghostCandles?: any[]
    targetMl?: any
    targetPlan?: any
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

function formatNumber(value: any, digits = 2) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'
  return parsed.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })
}

function formatPrice(value: any) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return '—'
  if (Math.abs(parsed) >= 1000) return parsed.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (Math.abs(parsed) >= 100) return parsed.toFixed(2)
  if (Math.abs(parsed) >= 10) return parsed.toFixed(3)
  return parsed.toFixed(4)
}

function formatPercent(value: any) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'
  return `${parsed.toFixed(1)}%`
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
    payload.ghostProjections,
    payload.projections,
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

function readTargetPlan(payload: OverlayPayload | null, signal?: TradingSignal) {
  if (!payload && !signal) return null

  const candidates = [
    payload?.targetMl,
    payload?.targetPlan,
    payload?.chartOverlays?.targetMl,
    payload?.chartOverlays?.targetPlan,
    payload?.overlays?.targetMl,
    payload?.overlays?.targetPlan,
    (payload as any)?.chartOverlayPayload?.targetMl,
    (payload as any)?.chartOverlayPayload?.targetPlan,
    signal?.targetMl,
    signal?.targetPlan,
  ]

  for (const value of candidates) {
    if (value && typeof value === 'object') return value
  }

  const target = signal?.targetPrice ?? signal?.target ?? signal?.takeProfitPrice ?? signal?.tp1
  if (target) {
    return {
      targetPrice: target,
      targetConfidence: signal?.confidence,
      targetSource: 'signal',
      targetMlReady: false,
    }
  }

  return null
}

function normalizeRawGhostCandles(rawGhosts: any[], sourceText: string, targetPlan?: any): GhostCandle[] {
  const candles: GhostCandle[] = []

  rawGhosts.slice(0, 10).forEach((ghost: any, index: number) => {
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

    // Per-row ghost target:
    // Prefer the ghost candle's own projected target/close.
    // The final Target ML objective stays available as finalTargetPrice.
    const targetPrice =
      toNumber(ghost.ghostTargetPrice) ??
      toNumber(ghost.projectedTargetPrice) ??
      toNumber(ghost.targetPrice) ??
      toNumber(ghost.target) ??
      toNumber(ghost.close) ??
      toNumber(ghost.c) ??
      null

    const finalTargetPrice =
      toNumber(ghost.finalTargetPrice) ??
      toNumber(ghost.overallTargetPrice) ??
      toNumber(targetPlan?.targetPrice) ??
      toNumber(targetPlan?.target) ??
      null

    const targetConfidence =
      toNumber(ghost.targetConfidence) ??
      toNumber(targetPlan?.targetConfidence) ??
      null

    const ghostConfidenceBoost =
      toNumber(ghost.ghostConfidenceBoost) ??
      toNumber(targetPlan?.ghostConfidenceBoost) ??
      null

    const targetMlReady = Boolean(ghost.targetMlReady ?? targetPlan?.targetMlReady)
    const targetMlAligned = Boolean(ghost.targetMlAligned ?? targetPlan?.targetMlAligned ?? targetPrice)
    const targetSource = String(ghost.targetSource ?? targetPlan?.targetSource ?? targetPlan?.source ?? '').trim()

    // Display confidence must allow Target ML to lift ghost confidence.
    // Old UI waited for Unified confirmation only, which kept ghost confidence stuck.
    const targetLift =
      targetConfidence !== null && targetConfidence > 0
        ? Math.max(0, (targetConfidence - confidenceRaw) * 0.35)
        : 0
    const boostLift = ghostConfidenceBoost !== null ? Math.max(0, ghostConfidenceBoost) : 0
    const displayedConfidence = clamp(confidenceRaw + targetLift + boostLift)

    const rawReaction =
      typeof ghost.targetReaction === 'string'
        ? ghost.targetReaction
        : targetMlAligned
          ? 'target_ml_alignment_active'
          : undefined

    const targetReaction =
      rawReaction && rawReaction.toLowerCase().includes('waiting_for_unified')
        ? targetMlAligned
          ? 'target_ml_alignment_active'
          : rawReaction
        : rawReaction

    candles.push({
      label: ghost.label ? String(ghost.label) : `${isUnified ? 'UI' : isPython ? 'PY' : 'Ghost'} #${index + 1}`,
      direction: normalizeDirection(ghost.direction ?? ghost.dir ?? ghost.signal, open, close),
      confidence: Math.round(clamp(displayedConfidence)),
      open: roundPrice(open),
      high: roundPrice(high),
      low: roundPrice(low),
      close: roundPrice(close),
      source: isUnified ? 'unified' : isPython ? 'python' : 'chart',
      targetReaction,
      targetSeverity: typeof ghost.targetSeverity === 'number' ? ghost.targetSeverity : toNumber(ghost.targetSeverity) ?? undefined,
      targetMlAligned,
      targetPrice,
      finalTargetPrice,
      targetSource,
      targetConfidence,
      targetMlReady,
      ghostConfidenceBoost,
      mlAdjusted: Boolean(ghost.mlAdjusted),
      mlReady: Boolean(ghost.mlReady),
      mlReason: typeof ghost.mlReason === 'string' ? ghost.mlReason : undefined,
      mlConfidenceMultiplier: toNumber(ghost.mlConfidenceMultiplier),
      mlConfidenceBonus: toNumber(ghost.mlConfidenceBonus),
      mlProjectionMultiplier: toNumber(ghost.mlProjectionMultiplier),
      mlHierarchy: typeof ghost.mlHierarchy === 'string' ? ghost.mlHierarchy : undefined,
      nrtrUsedForMl: toNumber(ghost.nrtrUsedForMl) ?? 0,
      smmaUsedForMl: toNumber(ghost.smmaUsedForMl) ?? 0,
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

  const targetPrice = toNumber(signal?.targetPrice) ?? toNumber(signal?.target) ?? toNumber(signal?.takeProfitPrice) ?? toNumber(signal?.tp1)
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

  const step = targetPrice
    ? Math.abs(targetPrice - base) / 3
    : Math.max(base * 0.00018, 0.5)
  const wick = Math.max(base * 0.00012, 0.25)
  const candles: GhostCandle[] = []

  let previousClose = base
  for (let index = 0; index < 3; index += 1) {
    const progress = (index + 1) / 3
    const move = targetPrice
      ? (targetPrice - base) * progress
      : step * (index + 1) * (direction === 'UP' ? 1 : -1)
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
      targetReaction: targetPrice ? 'scorecard_target_aligned_projection' : 'scorecard_backed_projection_waiting_for_raw_ghost_candles',
      targetSeverity: confidence / 100,
      targetMlAligned: Boolean(targetPrice),
      targetPrice: targetPrice ?? null,
      targetSource: 'scorecard_signal',
      targetConfidence: confidence,
      targetMlReady: false,
      ghostConfidenceBoost: 0,
      nrtrUsedForMl: 0,
      smmaUsedForMl: 0,
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

  const targetPlan = readTargetPlan(payload, signal)
  const unifiedGhosts = readUnifiedGhostCandles(unifiedIntelligence ?? (payload as any)?.unifiedIntelligence)
  const rawGhosts = unifiedGhosts.length > 0 ? unifiedGhosts : readRawGhostCandles(payload)
  const normalized = normalizeRawGhostCandles(
    rawGhosts,
    unifiedGhosts.length > 0 ? 'unified_intelligence' : String(payload?.source ?? 'python'),
    targetPlan
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

  if (first.targetMlAligned || first.targetPrice) {
    if (first.direction === 'UP') return 'Target ML-Aligned Bullish Projection'
    if (first.direction === 'DOWN') return 'Target ML-Aligned Bearish Projection'
    return 'Target ML-Aligned Neutral Projection'
  }

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

function MiniInfo({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-dark-600 bg-dark-900/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500">{label}</p>
      <p className={`mt-1 text-xs font-bold ${accent ? 'text-cyan-300' : 'text-gray-100'}`}>{value}</p>
    </div>
  )
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
  const isTargetMlAligned = candles.some((candle) => candle.targetMlAligned)
  const rawGhostCount = readRawGhostCandles(activePayload).length
  const targetPlan = readTargetPlan(activePayload, signal)

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
            {isTargetMlAligned
              ? `Target ML aligned • ${symbol} • ${timeframe}`
              : isUnifiedPowered
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

      {targetPlan && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <MiniInfo label="Final ML Target" value={formatPrice(targetPlan.targetPrice ?? targetPlan.target)} accent />
          <MiniInfo label="Source" value={String(targetPlan.targetSource ?? targetPlan.source ?? '—')} />
          <MiniInfo label="Confidence" value={formatPercent(targetPlan.targetConfidence)} accent={Number(targetPlan.targetConfidence) >= 60} />
          <MiniInfo label="Target ML" value={targetPlan.targetMlReady ? 'READY' : 'LEARNING'} />
          <MiniInfo label="Ghost Boost" value={formatNumber(targetPlan.ghostConfidenceBoost, 2)} accent={Number(targetPlan.ghostConfidenceBoost) > 0} />
        </div>
      )}

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

                    {candle.targetMlAligned && (
                      <span className="rounded border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                        TARGET ML ALIGNED
                      </span>
                    )}

                    {candle.mlAdjusted && (
                      <span className="rounded border border-purple-400/40 bg-purple-400/10 px-2 py-0.5 text-[10px] font-bold text-purple-300">
                        GHOST ML
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
                    <p className="font-bold text-white">{formatPrice(candle.open)}</p>
                  </div>

                  <div>
                    <p className="text-gray-500">H</p>
                    <p className="font-bold text-white">{formatPrice(candle.high)}</p>
                  </div>

                  <div>
                    <p className="text-gray-500">L</p>
                    <p className="font-bold text-white">{formatPrice(candle.low)}</p>
                  </div>

                  <div>
                    <p className="text-gray-500">C</p>
                    <p className="font-bold text-white">{formatPrice(candle.close)}</p>
                  </div>
                </div>

                {(candle.targetMlAligned || candle.targetPrice || candle.targetConfidence) && (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
                    <MiniInfo label={`${candle.label} Target`} value={formatPrice(candle.targetPrice)} accent />
                    <MiniInfo label="Final ML Target" value={formatPrice(candle.finalTargetPrice)} />
                    <MiniInfo label="Target Conf" value={formatPercent(candle.targetConfidence)} accent={Number(candle.targetConfidence) >= 60} />
                    <MiniInfo label="Target Ready" value={candle.targetMlReady ? 'YES' : 'LEARNING'} />
                    <MiniInfo label="Ghost Boost" value={formatNumber(candle.ghostConfidenceBoost, 2)} accent={Number(candle.ghostConfidenceBoost) > 0} />
                  </div>
                )}

                {(candle.mlAdjusted || candle.mlReady || candle.mlProjectionMultiplier) && (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                    <MiniInfo label="Ghost ML Ready" value={candle.mlReady ? 'YES' : 'LEARNING'} />
                    <MiniInfo label="Projection x" value={formatNumber(candle.mlProjectionMultiplier, 4)} />
                    <MiniInfo label="Confidence x" value={formatNumber(candle.mlConfidenceMultiplier, 4)} />
                    <MiniInfo label="ML Reason" value={candle.mlReason || '—'} />
                  </div>
                )}

                {reactionText && (
                  <div className="mt-3 rounded-md border border-dark-600 bg-dark-900/40 px-3 py-2 text-xs text-gray-400">
                    Target reaction:{' '}
                    <span className="font-bold text-gray-200">{reactionText}</span>{candle.targetPrice && (<span className="ml-2 text-cyan-300">• {candle.label} target {formatPrice(candle.targetPrice)}</span>)}
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
