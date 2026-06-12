import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'

type AiTraderPanelProps = {
  apiBaseUrl?: string
  symbol: string
  timeframe: string
  activePrice?: number
  signal?: any
  scorecards?: any
  overlayPayload?: any
  unifiedIntelligence?: any
  projectionEngine?: any
  candles?: any[]
}

type AiTraderDecision = {
  eventType?: string
  status?: string
  dashboardOnly?: boolean
  brokerConnected?: boolean
  allowedToTrade?: boolean
  decision?: 'BUY' | 'SELL' | 'HOLD' | string
  rawDecision?: 'BUY' | 'SELL' | 'HOLD' | string
  confidence?: number
  baseConfidence?: number
  learningAdjustment?: number
  confidenceGrade?: string
  symbol?: string
  timeframe?: string
  entry?: number
  target?: number
  stop?: number
  riskReward?: number
  currentPrice?: number
  currentPnl?: number
  maxPnl?: number
  riskPnl?: number
  reason?: string
  reasons?: string[]
  details?: any
  createdAt?: string
}

type AiTraderSummary = {
  eventType?: string
  status?: string
  dashboardOnly?: boolean
  brokerConnected?: boolean
  openTrades?: any[]
  closedTrades?: any[]
  recentClosedTrades?: any[]
  openCount?: number
  closedCount?: number
  decisionStats?: {
    samples?: number
    buyBias?: number
    sellBias?: number
    holdCount?: number
    tradeReadyCount?: number
    avgConfidence?: number
  }
  memoryStatus?: {
    stage?: string
    message?: string
    bucketDecisionStats?: any
    overallDecisionStats?: any
    bucketClosedStats?: any
    overallClosedStats?: any
  }
  stats?: {
    samples?: number
    wins?: number
    losses?: number
    winRate?: number
    profitFactor?: number
    avgPnl?: number
    avgR?: number
  }
}

function toFiniteNumber(value: any, fallback = 0) {
  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : fallback
}

function formatPrice(value: any) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) return '—'

  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: parsed > 100 ? 2 : 4,
    maximumFractionDigits: parsed > 100 ? 2 : 6,
  })
}

function formatMoney(value: any) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) return '—'

  const sign = parsed > 0 ? '+' : parsed < 0 ? '-' : ''

  return `${sign}$${Math.abs(parsed).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatPercent(value: any) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) return '—'

  return `${(parsed * 100).toFixed(1)}%`
}

function formatCount(value: any) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) return '0'

  return parsed.toLocaleString()
}

function formatAiStage(value: any) {
  const raw = String(value ?? 'WARMING_UP').replace(/_/g, ' ').toLowerCase()

  return raw.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getBlockerAnalysis(decision: AiTraderDecision | null, summary: AiTraderSummary | null, minConfidence: number, minRiskReward: number) {
  const blockers: Array<{ label: string; detail: string; severity: 'high' | 'medium' | 'low' }> = []

  const confidence = toFiniteNumber(decision?.confidence, 0)
  const riskReward = toFiniteNumber(decision?.riskReward, 0)
  const directional = decision?.details?.directionalContext ?? {}
  const memoryStatus = summary?.memoryStatus ?? decision?.details?.memoryStatus ?? {}
  const targetConfidence = toFiniteNumber(directional?.targetConfidence, 0)
  const ghostConfidence = toFiniteNumber(directional?.ghostConfidence, 0)
  const entryConfidence = toFiniteNumber(directional?.entryConfidence, 0)
  const nrtrConflicts = toFiniteNumber(directional?.nrtrConflictCount, 0)
  const nrtrAgreements = toFiniteNumber(directional?.nrtrAgreementCount, 0)

  if (confidence < minConfidence) {
    blockers.push({
      label: 'Confidence below threshold',
      detail: `${confidence.toFixed(1)}% / required ${minConfidence.toFixed(1)}%`,
      severity: 'high',
    })
  }

  if (riskReward > 0 && riskReward < minRiskReward) {
    blockers.push({
      label: 'Risk/Reward below minimum',
      detail: `${riskReward.toFixed(2)}R / required ${minRiskReward.toFixed(2)}R`,
      severity: 'high',
    })
  }

  if (targetConfidence <= 0) {
    blockers.push({
      label: 'Target ML confidence missing',
      detail: 'Target exists, but confidence is not flowing into the AI context yet.',
      severity: 'medium',
    })
  } else if (targetConfidence < 50) {
    blockers.push({
      label: 'Target ML is weak',
      detail: `${targetConfidence.toFixed(1)} confidence`,
      severity: 'medium',
    })
  }

  if (ghostConfidence > 0 && ghostConfidence < 45) {
    blockers.push({
      label: 'Ghost ML is weak',
      detail: `${ghostConfidence.toFixed(1)} confidence`,
      severity: 'medium',
    })
  }

  if (entryConfidence > 0 && entryConfidence < 55) {
    blockers.push({
      label: 'Entry ML is weak',
      detail: `${entryConfidence.toFixed(1)} confidence`,
      severity: 'medium',
    })
  }

  if (nrtrConflicts > 0) {
    blockers.push({
      label: 'NRTR conflict',
      detail: `${nrtrConflicts} chart(s) conflict, ${nrtrAgreements} agree`,
      severity: 'medium',
    })
  }

  if (toFiniteNumber(summary?.closedCount, 0) < 8) {
    blockers.push({
      label: 'Trade memory not mature',
      detail: String(memoryStatus?.message ?? 'Need more closed dashboard AI trades.'),
      severity: 'low',
    })
  }

  if (blockers.length === 0 && decision?.allowedToTrade) {
    blockers.push({
      label: 'No active blocker',
      detail: 'AI is allowed to open dashboard paper trades.',
      severity: 'low',
    })
  }

  if (blockers.length === 0) {
    blockers.push({
      label: 'Waiting for clean setup',
      detail: 'No major blocker found, but AI has not confirmed trade readiness.',
      severity: 'low',
    })
  }

  return blockers
}

function BlockerBadge({ severity }: { severity: 'high' | 'medium' | 'low' }) {
  const className =
    severity === 'high'
      ? 'border-red-400/30 bg-red-400/10 text-red-200'
      : severity === 'medium'
        ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
        : 'border-blue-400/30 bg-blue-400/10 text-blue-200'

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${className}`}>
      {severity}
    </span>
  )
}

function getMlStrengthLabel(value: any) {
  const score = toFiniteNumber(value, 0)

  if (score >= 75) return 'Strong'
  if (score >= 55) return 'Active'
  if (score > 0) return 'Learning'

  return 'Waiting'
}

function getMlStrengthTone(value: any): 'neutral' | 'bull' | 'bear' | 'warn' {
  const score = toFiniteNumber(value, 0)

  if (score >= 55) return 'bull'
  if (score > 0) return 'warn'

  return 'neutral'
}

function MlStatusCard({
  title,
  status,
  confidence,
  detail,
  tone = 'neutral',
}: {
  title: string
  status: string
  confidence: number
  detail: string
  tone?: 'neutral' | 'bull' | 'bear' | 'warn'
}) {
  const border =
    tone === 'bull'
      ? 'border-emerald-400/30 bg-emerald-400/10'
      : tone === 'bear'
        ? 'border-red-400/30 bg-red-400/10'
        : tone === 'warn'
          ? 'border-amber-400/30 bg-amber-400/10'
          : 'border-dark-700 bg-dark-900/70'

  const text =
    tone === 'bull'
      ? 'text-emerald-200'
      : tone === 'bear'
        ? 'text-red-200'
        : tone === 'warn'
          ? 'text-amber-200'
          : 'text-gray-200'

  return (
    <div className={`rounded-xl border p-4 ${border}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-xs font-black uppercase tracking-wide text-gray-400">{title}</div>
        <span className={`rounded-full border border-current/30 px-2 py-1 text-[10px] font-black uppercase tracking-wide ${text}`}>
          {status}
        </span>
      </div>
      <div className={`text-2xl font-black ${text}`}>{confidence.toFixed(1)}%</div>
      <div className="mt-2 text-xs leading-5 text-gray-400">{detail}</div>
    </div>
  )
}

function readNumberPath(source: any, paths: string[]) {
  for (const path of paths) {
    const value = path.split('.').reduce((current: any, key: string) => {
      if (current && typeof current === 'object' && key in current) return current[key]
      return undefined
    }, source)

    const parsed = Number(value)

    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }

  return undefined
}

function normalizeDecision(value: any): 'BUY' | 'SELL' | 'HOLD' {
  const raw = String(value ?? '').toUpperCase()

  if (raw.includes('BUY') || raw.includes('LONG') || raw.includes('BULL')) return 'BUY'
  if (raw.includes('SELL') || raw.includes('SHORT') || raw.includes('BEAR')) return 'SELL'

  return 'HOLD'
}

function sanitizeAiTraderPayload(value: any, depth = 0): any {
  if (depth > 6) return null

  if (value === undefined) return null
  if (value === null) return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeAiTraderPayload(item, depth + 1))
  }

  if (typeof value === 'object') {
    const result: Record<string, any> = {}

    Object.entries(value).forEach(([key, entry]) => {
      if (typeof entry === 'function') return
      if (typeof entry === 'symbol') return
      result[key] = sanitizeAiTraderPayload(entry, depth + 1)
    })

    return result
  }

  return null
}

async function readApiError(response: Response) {
  const text = await response.text().catch(() => '')

  if (!text) return `${response.status}`

  try {
    const json = JSON.parse(text)
    return `${response.status}: ${JSON.stringify(json).slice(0, 500)}`
  } catch {
    return `${response.status}: ${text.slice(0, 500)}`
  }
}

function readProjectionEngine(signal: any, overlayPayload: any, unifiedIntelligence: any) {
  const candidates = [
    unifiedIntelligence?.projectionEngine,
    unifiedIntelligence?.unifiedProjectionEngine,
    unifiedIntelligence?.components?.projectionEngine,
    unifiedIntelligence?.components?.unifiedProjectionEngine,
    signal?.projectionEngine,
    signal?.unifiedProjectionEngine,
    overlayPayload?.projectionEngine,
    overlayPayload?.unifiedProjectionEngine,
    overlayPayload?.unifiedIntelligence?.projectionEngine,
    overlayPayload?.unifiedIntelligence?.unifiedProjectionEngine,
    unifiedIntelligence,
  ]

  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === 'object' &&
      (
        candidate.eventType === 'UNIFIED_PROJECTION_ENGINE' ||
        candidate.ghostPath ||
        candidate.target ||
        candidate.alignment ||
        candidate.activeTargetPrice
      )
    ) {
      return candidate
    }
  }

  return null
}

function readProjectionTarget(projectionEngine: any) {
  if (!projectionEngine || typeof projectionEngine !== 'object') return undefined

  return readNumberPath(projectionEngine, [
    'activeTargetPrice',
    'target.price',
    'targetPrice',
    'targetPlan.targetPrice',
    'targetPlan.finalTargetPrice',
    'targetMl.targetPrice',
    'finalTargetPrice',
    'ghostOverlayTargetPrice',
    'ghostPath.targetPrice',
    'ghostPath.endPrice',
  ])
}

function readProjectionGhostConfidence(projectionEngine: any) {
  if (!projectionEngine || typeof projectionEngine !== 'object') return 0

  return Math.max(
    toFiniteNumber(projectionEngine?.ghostConfidence, 0),
    toFiniteNumber(projectionEngine?.ghostPath?.confidence, 0),
    toFiniteNumber(projectionEngine?.alignment?.score, 0),
  )
}

function readProjectionTargetConfidence(projectionEngine: any) {
  if (!projectionEngine || typeof projectionEngine !== 'object') return 0

  const targetType = String(
    projectionEngine?.activeTargetType ??
      projectionEngine?.target?.type ??
      projectionEngine?.targetPlan?.type ??
      ''
  )

  const isGhostOverlay = targetType === 'GHOST_OVERLAY_TARGET'

  if (isGhostOverlay) {
    return 0
  }

  return Math.max(
    toFiniteNumber(projectionEngine?.targetConfidence, 0),
    toFiniteNumber(projectionEngine?.activeTargetConfidence, 0),
    toFiniteNumber(projectionEngine?.target?.confidence, 0),
    toFiniteNumber(projectionEngine?.targetPlan?.targetConfidence, 0),
    toFiniteNumber(projectionEngine?.targetMl?.targetConfidence, 0),
  )
}

function readProjectionSide(projectionEngine: any, fallback: any) {
  const direction = String(
    projectionEngine?.target?.direction ??
      projectionEngine?.ghostPath?.direction ??
      projectionEngine?.marketState?.direction ??
      projectionEngine?.targetDirection ??
      ''
  ).toUpperCase()

  if (direction.includes('BULL') || direction.includes('UP') || direction.includes('BUY')) return 'BUY'
  if (direction.includes('BEAR') || direction.includes('DOWN') || direction.includes('SELL')) return 'SELL'

  return normalizeDecision(fallback)
}

function buildProjectionEngineSnapshot(projectionEngine: any) {
  if (!projectionEngine || typeof projectionEngine !== 'object') {
    return {
      available: false,
      targetPrice: undefined,
      targetConfidence: 0,
      ghostConfidence: 0,
      alignmentScore: 0,
      alignmentLabel: 'Waiting',
      projectionMode: 'WAITING',
      projectionModeLabel: 'Waiting',
      aiPermission: 'WAIT',
      conflict: false,
    }
  }

  const targetPrice = readProjectionTarget(projectionEngine)
  const targetConfidence = readProjectionTargetConfidence(projectionEngine)
  const ghostConfidence = readProjectionGhostConfidence(projectionEngine)
  const alignmentScore = toFiniteNumber(projectionEngine?.alignment?.score, 0)
  const conflict = Boolean(projectionEngine?.alignment?.conflict || projectionEngine?.mode?.conflict)

  return {
    available: Boolean(targetPrice),
    targetPrice,
    targetConfidence,
    ghostConfidence,
    alignmentScore,
    alignmentLabel: String(projectionEngine?.alignment?.label ?? 'Waiting'),
    projectionMode: String(projectionEngine?.projectionMode ?? projectionEngine?.mode?.mode ?? 'WAITING'),
    projectionModeLabel: String(projectionEngine?.projectionModeLabel ?? projectionEngine?.mode?.label ?? 'Waiting'),
    aiPermission: String(projectionEngine?.aiPermission ?? 'WAIT'),
    conflict,
    source: String(projectionEngine?.activeTargetSource ?? projectionEngine?.target?.source ?? 'Unified Projection Engine'),
    targetType: String(projectionEngine?.activeTargetType ?? projectionEngine?.target?.type ?? ''),
    targetSourceLockActive: Boolean(projectionEngine?.targetSourceLockActive),
    targetLockedConfidence: toFiniteNumber(projectionEngine?.targetLockedConfidence ?? projectionEngine?.target?.lockedConfidence ?? targetConfidence, targetConfidence),
    targetLiveConfidence: toFiniteNumber(projectionEngine?.targetLiveConfidence ?? projectionEngine?.target?.liveConfidence ?? targetConfidence, targetConfidence),
    targetLiveSource: String(projectionEngine?.targetLiveSource ?? projectionEngine?.target?.liveTargetSource ?? projectionEngine?.activeTargetSource ?? projectionEngine?.target?.source ?? 'Unified Projection Engine'),
    targetLockedAt: String(projectionEngine?.targetLockedAt ?? projectionEngine?.target?.lockedAt ?? ''),
    learnedReliability: toFiniteNumber(projectionEngine?.targetMl?.learnedReliability ?? projectionEngine?.targetPlan?.learnedReliability ?? 0, 0),
    marketState: projectionEngine?.marketState,
    target: projectionEngine?.target,
    ghostPath: projectionEngine?.ghostPath,
    alignment: projectionEngine?.alignment,
    mode: projectionEngine?.mode,
    learning: projectionEngine?.learning,
  }
}

function inferTargetFromSignal(signal: any) {
  // Real Target Price ML first, then only chart ghost overlay target fallback.
  return readNumberPath(signal, [
    'projectionEngine.activeTargetPrice',
    'projectionEngine.target.price',
    'projectionEngine.targetPrice',
    'projectionEngine.targetPlan.targetPrice',
    'projectionEngine.targetMl.targetPrice',
    'projectionEngine.finalTargetPrice',
    'projectionEngine.ghostOverlayTargetPrice',
    'unifiedProjectionEngine.activeTargetPrice',
    'unifiedProjectionEngine.target.price',
    'unifiedProjectionEngine.targetPrice',
    'unifiedProjectionEngine.targetPlan.targetPrice',
    'unifiedProjectionEngine.targetMl.targetPrice',
    'unifiedProjectionEngine.finalTargetPrice',
    'unifiedProjectionEngine.ghostOverlayTargetPrice',
    'finalTargetPrice',
    'overallTargetPrice',
    'targetMl.finalTargetPrice',
    'targetMl.overallTargetPrice',
    'targetMl.targetPrice',
    'targetPlan.finalTargetPrice',
    'targetPlan.overallTargetPrice',
    'targetPlan.targetPrice',
    'activeTargetPrice',
    'ghostOverlayTargetPrice',
    'targetMl.activeTargetPrice',
    'targetMl.ghostOverlayTargetPrice',
    'targetPlan.activeTargetPrice',
    'targetPlan.ghostOverlayTargetPrice',
    'overlayPayload.finalTargetPrice',
    'overlayPayload.overallTargetPrice',
    'overlayPayload.targetMl.finalTargetPrice',
    'overlayPayload.targetMl.overallTargetPrice',
    'overlayPayload.targetMl.targetPrice',
    'overlayPayload.activeTargetPrice',
    'overlayPayload.ghostOverlayTargetPrice',
  ])
}


function inferEntryFromSignal(signal: any, activePrice?: number) {
  return readNumberPath(signal, [
    'entryPrice',
    'entry',
    'nrtrEntryPrice',
    'strategyEntryPrice',
    'price',
    'close',
  ]) ?? activePrice
}

function readGhostTargetMlContext(source: any) {
  const ghostSources = [
    source?.projectionEngine?.ghostPath?.candles,
    source?.unifiedProjectionEngine?.ghostPath?.candles,
    source?.ghostPath?.candles,
    source?.ghostCandles,
    source?.ghosts,
    source?.projection,
    source?.ghostProjection,
    source?.ghostCandleProjection,
    source?.overlayPayload?.projectionEngine?.ghostPath?.candles,
    source?.overlayPayload?.unifiedProjectionEngine?.ghostPath?.candles,
    source?.overlayPayload?.ghostCandles,
    source?.overlayPayload?.ghosts,
  ]

  let bestTarget = readNumberPath(source, [
    'finalTargetPrice',
    'overallTargetPrice',
    'targetMl.finalTargetPrice',
    'targetMl.overallTargetPrice',
    'targetMl.targetPrice',
    'targetPlan.finalTargetPrice',
    'targetPlan.overallTargetPrice',
    'targetPlan.targetPrice',
  ])
  let bestConfidence = toFiniteNumber(
    source?.targetConfidence ??
    source?.targetMl?.targetConfidence ??
    source?.targetPlan?.targetConfidence,
    0,
  )
  let aligned = Boolean(source?.targetMlAligned ?? source?.targetMl?.targetMlAligned)
  let ready = Boolean(source?.targetMlReady ?? source?.targetMl?.targetMlReady)

  ghostSources.forEach((ghostList) => {
    if (!Array.isArray(ghostList)) return

    ghostList.forEach((ghost: any) => {
      const ghostTarget = readNumberPath(ghost, [
        'finalTargetPrice',
        'overallTargetPrice',
        'ghostTargetPrice',
        'projectedTargetPrice',
        'targetPrice',
        'close',
      ])

      const ghostConfidence = toFiniteNumber(
        ghost?.targetConfidence ??
        ghost?.targetMlConfidence ??
        ghost?.confidence,
        0,
      )

      if (!bestTarget && ghostTarget && ghostTarget > 0) {
        bestTarget = ghostTarget
      }

      if (ghostConfidence > bestConfidence) {
        bestConfidence = ghostConfidence
      }

      aligned = aligned || Boolean(ghost?.targetMlAligned)
      ready = ready || Boolean(ghost?.targetMlReady) || Boolean(ghost?.targetMlAligned) || ghostConfidence > 0
    })
  })

  return {
    targetPrice: bestTarget,
    targetConfidence: bestConfidence,
    targetMlAligned: aligned,
    targetMlReady: ready || aligned || bestConfidence > 0 || Boolean(bestTarget),
  }
}

function buildTargetMlSnapshot(signal: any, overlayPayload: any, unifiedIntelligence?: any) {
  const projectionEngine = readProjectionEngine(signal, overlayPayload, unifiedIntelligence)
  const projectionSnapshot = buildProjectionEngineSnapshot(projectionEngine)
  const signalContext = readGhostTargetMlContext(signal)
  const overlayContext = readGhostTargetMlContext(overlayPayload)

  const targetConfidence = Math.max(
    toFiniteNumber(projectionSnapshot.targetConfidence, 0),
    toFiniteNumber(
      signal?.targetConfidence ??
      signal?.targetMl?.targetConfidence ??
      overlayPayload?.targetConfidence ??
      overlayPayload?.targetMl?.targetConfidence,
      0,
    ),
    toFiniteNumber(signalContext.targetConfidence, 0),
    toFiniteNumber(overlayContext.targetConfidence, 0),
  )

  const targetPrice =
    projectionSnapshot.targetPrice ??
    inferTargetFromSignal(signal) ??
    signalContext.targetPrice ??
    overlayContext.targetPrice ??
    readNumberPath(overlayPayload, [
      'finalTargetPrice',
      'overallTargetPrice',
      'targetPrice',
      'targetMl.targetPrice',
      'targetPlan.targetPrice',
    ])

  const targetMlAligned = Boolean(
    projectionSnapshot.available ||
      Boolean(
        signal?.targetMlAligned ??
          signal?.targetMl?.targetMlAligned ??
          overlayPayload?.targetMlAligned ??
          overlayPayload?.targetMl?.targetMlAligned ??
          signalContext.targetMlAligned ??
          overlayContext.targetMlAligned
      )
  )

  const targetMlReady = Boolean(
    signal?.targetMlReady ||
    signal?.targetMl?.targetMlReady ||
    overlayPayload?.targetMlReady ||
    overlayPayload?.targetMl?.targetMlReady ||
    signalContext.targetMlReady ||
    overlayContext.targetMlReady ||
    targetMlAligned ||
    targetConfidence > 0
  )

  return {
    targetConfidence,
    targetMlReady,
    targetMlAligned,
    targetPrice,
    source:
      projectionSnapshot.source ??
      signal?.targetSource ??
      signal?.targetMl?.source ??
      overlayPayload?.targetSource ??
      overlayPayload?.targetMl?.source ??
      'ghost_target_ml_context',
    projectionEngine: projectionSnapshot,
  }
}

function buildGhostMlSnapshot(signal: any, overlayPayload: any, unifiedIntelligence?: any) {
  const projectionEngine = readProjectionEngine(signal, overlayPayload, unifiedIntelligence)
  const projectionSnapshot = buildProjectionEngineSnapshot(projectionEngine)

  return {
    confidence: Math.max(
      toFiniteNumber(projectionSnapshot.ghostConfidence, 0),
      toFiniteNumber(
        signal?.ghostConfidence ??
      signal?.confidence ??
      signal?.mlConfidence ??
        overlayPayload?.ghostConfidence,
        0,
      )
    ),
    mlReady: Boolean(
      projectionSnapshot.available ||
        Boolean(signal?.mlReady ?? signal?.ghostMlReady ?? overlayPayload?.mlReady)
    ),
    ghostConfidenceBoost: toFiniteNumber(signal?.ghostConfidenceBoost ?? overlayPayload?.ghostConfidenceBoost, 0),
  }
}

function buildEntryMlSnapshot(signal: any) {
  return {
    entryConfidence: toFiniteNumber(signal?.entryConfidence ?? signal?.entryMlConfidence, 0),
    confidence: toFiniteNumber(signal?.entryConfidence ?? signal?.entryMlConfidence, 0),
  }
}

function getLatestCandleClose(candles: any[] | undefined) {
  if (!Array.isArray(candles) || candles.length === 0) return undefined

  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index]
    const close = toFiniteNumber(candle?.close ?? candle?.c, 0)

    if (close > 0) return close
  }

  return undefined
}

function getLiveAiCurrentPrice(activePrice: any, signal: any, candles: any[] | undefined) {
  const candidates = [
    activePrice,
    getLatestCandleClose(candles),
    signal?.current,
    signal?.price,
    signal?.entry,
    signal?.close,
    signal?.last,
  ]

  for (const candidate of candidates) {
    const value = toFiniteNumber(candidate, 0)
    if (value > 0) return value
  }

  return 0
}


function normalizeTradeSide(value: any): 'BUY' | 'SELL' {
  const side = normalizeDecision(value)
  return side === 'SELL' ? 'SELL' : 'BUY'
}

function getTradeLiveCurrentPrice(trade: any, livePrice: number) {
  const live = toFiniteNumber(livePrice, 0)
  if (live > 0) return live

  return toFiniteNumber(
    trade?.currentPrice ??
      trade?.current ??
      trade?.lastPrice ??
      trade?.markPrice ??
      trade?.entry,
    0
  )
}

function calculateLiveTradePnl(trade: any, livePrice: number) {
  const current = getTradeLiveCurrentPrice(trade, livePrice)
  const entry = toFiniteNumber(trade?.entry ?? trade?.entryPrice, 0)
  const side = normalizeTradeSide(trade?.side ?? trade?.decision ?? trade?.rawDecision)
  const quantity = Math.max(1, toFiniteNumber(trade?.quantity ?? trade?.qty ?? trade?.contracts, 1))
  const pointValue = Math.max(1, toFiniteNumber(trade?.pointValue ?? trade?.dollarPerPoint ?? trade?.multiplier, String(trade?.symbol ?? '').toUpperCase().includes('MES') ? 5 : 1))

  if (entry <= 0 || current <= 0) {
    return {
      current,
      pnl: toFiniteNumber(trade?.currentPnl ?? trade?.pnl, 0),
      pnlPercent: toFiniteNumber(trade?.pnlPercent ?? trade?.percent, 0),
      points: 0,
      rMultiple: toFiniteNumber(trade?.rMultiple ?? trade?.r, 0),
    }
  }

  const points = side === 'SELL' ? entry - current : current - entry
  const pnl = points * pointValue * quantity
  const pnlPercent = entry > 0 ? points / entry : 0

  const stop = toFiniteNumber(trade?.stop ?? trade?.stopPrice, 0)
  const riskPoints = stop > 0 ? Math.abs(entry - stop) : 0
  const rMultiple = riskPoints > 0 ? points / riskPoints : toFiniteNumber(trade?.rMultiple ?? trade?.r, 0)

  return {
    current,
    pnl,
    pnlPercent,
    points,
    rMultiple,
  }
}

function StatBox({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'bull' | 'bear' | 'warn'
}) {
  const toneClass =
    tone === 'bull'
      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
      : tone === 'bear'
        ? 'border-red-400/30 bg-red-400/10 text-red-200'
        : tone === 'warn'
          ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
          : 'border-dark-600 bg-dark-800/80 text-gray-200'

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-sm font-black">{value}</div>
    </div>
  )
}

export default function AiTraderPanel({
  apiBaseUrl,
  symbol,
  timeframe,
  activePrice,
  signal,
  scorecards,
  overlayPayload,
  unifiedIntelligence,
  projectionEngine: directProjectionEngine,
  candles,
}: AiTraderPanelProps) {
  const [decision, setDecision] = useState<AiTraderDecision | null>(null)
  const [summary, setSummary] = useState<AiTraderSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [actionStatus, setActionStatus] = useState('')
  const [errorText, setErrorText] = useState('')
  const [autoPaperMode, setAutoPaperMode] = useState(false)
  const [minConfidence, setMinConfidence] = useState(62)
  const [minRiskReward, setMinRiskReward] = useState(1.25)
  const [lastAutoOpenKey, setLastAutoOpenKey] = useState('')

  const liveActivePrice = useMemo(() => {
    return getLiveAiCurrentPrice(activePrice, signal, candles)
  }, [activePrice, signal, candles])

  const activeProjectionEngine = useMemo(() => {
    return directProjectionEngine ?? readProjectionEngine(signal, overlayPayload, unifiedIntelligence)
  }, [directProjectionEngine, signal, overlayPayload, unifiedIntelligence])

  const projectionSnapshot = useMemo(() => {
    return buildProjectionEngineSnapshot(activeProjectionEngine)
  }, [activeProjectionEngine])

  const payload = useMemo(() => {
    const targetSnapshot = buildTargetMlSnapshot(signal, overlayPayload, unifiedIntelligence)
    const target = projectionSnapshot.targetPrice ?? targetSnapshot.targetPrice
    const entry = inferEntryFromSignal(signal, liveActivePrice)
    const side = readProjectionSide(activeProjectionEngine, signal?.signal ?? signal?.type ?? signal?.direction)

    return {
      symbol,
      timeframe,
      currentPrice: liveActivePrice,
      entryPrice: entry,
      targetPrice: target,
      side,
      signal: {
        ...(signal ?? {}),
        projectionEngine: activeProjectionEngine,
        unifiedProjectionEngine: activeProjectionEngine,
        activeTargetPrice: target,
        activeTargetSource: projectionSnapshot.source,
        projectionMode: projectionSnapshot.projectionMode,
        projectionModeLabel: projectionSnapshot.projectionModeLabel,
        aiPermission: projectionSnapshot.aiPermission,
        targetGhostAlignment: projectionSnapshot.alignment,
      },
      scorecards,
      ghostMl: buildGhostMlSnapshot(signal, overlayPayload, unifiedIntelligence),
      targetMl: {
        ...targetSnapshot,
        targetPrice: target,
        targetConfidence: projectionSnapshot.targetConfidence || targetSnapshot.targetConfidence,
        projectionEngine: projectionSnapshot,
      },
      entryMl: buildEntryMlSnapshot(signal),
      nrtrContext: scorecards?.nrtrStrategyFeeds ?? scorecards?.nrtrCharts ?? {},
      unifiedIntelligence: {
        ...(unifiedIntelligence ?? {}),
        projectionEngine: activeProjectionEngine,
        unifiedProjectionEngine: activeProjectionEngine,
      },
      projectionEngine: activeProjectionEngine,
      projectionEngineContext: projectionSnapshot,
      candles: Array.isArray(candles) ? candles.slice(-80) : [],
      context: {
        mode: 'dashboard_only_ai_paper_trader',
        dashboardOnly: true,
        noBroker: true,
        projectionEngineMode: projectionSnapshot.projectionMode,
        projectionEngineLabel: projectionSnapshot.projectionModeLabel,
        aiPermission: projectionSnapshot.aiPermission,
        targetGhostConflict: projectionSnapshot.conflict,
      },
      minConfidence,
      minRiskReward,
    }
  }, [
    liveActivePrice,
    signal,
    scorecards,
    overlayPayload,
    unifiedIntelligence,
    symbol,
    timeframe,
    minConfidence,
    minRiskReward,
    activeProjectionEngine,
    projectionSnapshot,
    candles,
  ])

  const safePayload = useMemo(() => sanitizeAiTraderPayload(payload), [payload])

  const fetchDecision = useCallback(async () => {
    if (!apiBaseUrl) {
      setErrorText('AI Trader is waiting for apiBaseUrl.')
      return
    }

    if (!liveActivePrice || liveActivePrice <= 0) {
      setErrorText('AI Trader is waiting for live price. Check mainChartCandles, activePrice, or latest signal price.')
      return
    }

    try {
      setIsLoading(true)
      setErrorText('')

      const response = await fetch(`${apiBaseUrl}/api/ai-trader/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(safePayload),
      })

      if (!response.ok) {
        throw new Error(`AI trader decision failed: ${await readApiError(response)}`)
      }

      const json = await response.json()
      setDecision(json)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'AI trader decision failed')
    } finally {
      setIsLoading(false)
    }
  }, [apiBaseUrl, liveActivePrice, safePayload])

  const fetchSummary = useCallback(async () => {
    if (!apiBaseUrl) return

    try {
      const params = new URLSearchParams({
        symbol,
        timeframe,
      })

      const response = await fetch(`${apiBaseUrl}/api/ai-trader/summary?${params.toString()}`, {
        cache: 'no-store',
      })

      if (!response.ok) return

      const json = await response.json()
      setSummary(json)
    } catch {
      // Keep the panel usable even if summary temporarily fails.
    }
  }, [apiBaseUrl, symbol, timeframe])

  const evaluateOpenTrades = useCallback(async () => {
    if (!apiBaseUrl) return

    try {
      setActionStatus('Evaluating open AI trades...')

      const response = await fetch(`${apiBaseUrl}/api/ai-trader/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sanitizeAiTraderPayload({
          symbol,
          timeframe,
          currentPrice: liveActivePrice,
          livePrice: liveActivePrice,
          markPrice: liveActivePrice,
          candles: Array.isArray(candles) ? candles.slice(-120) : [],
        })),
      })

      if (!response.ok) {
        throw new Error(`AI trader evaluate failed: ${await readApiError(response)}`)
      }

      const json = await response.json()
      setSummary(json?.summary ?? null)
      setActionStatus(`Evaluated • Closed ${json?.closedCount ?? 0} trade(s)`)
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Evaluate failed')
    }
  }, [apiBaseUrl, liveActivePrice, candles, symbol, timeframe])

  const openDashboardTrade = useCallback(async () => {
    if (!apiBaseUrl) return

    try {
      setActionStatus('Opening dashboard-only AI trade...')

      const response = await fetch(`${apiBaseUrl}/api/ai-trader/open`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(safePayload),
      })

      if (!response.ok) {
        throw new Error(`AI trader open failed: ${await readApiError(response)}`)
      }

      const json = await response.json()
      setDecision(json?.decision ?? decision)
      setSummary(json?.summary ?? summary)
      setActionStatus(json?.opened ? 'Dashboard AI trade opened' : json?.message ?? 'AI trade not opened')
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Open failed')
    }
  }, [apiBaseUrl, safePayload, decision, summary])

  useEffect(() => {
    fetchDecision()
  }, [fetchDecision])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  useEffect(() => {
    if (!autoPaperMode) return
    if (!decision?.allowedToTrade) return

    const side = normalizeDecision(decision.rawDecision ?? decision.decision)
    if (side === 'HOLD') return

    const key = [
      symbol,
      timeframe,
      side,
      Number(decision.entry ?? 0).toFixed(4),
      Number(decision.target ?? 0).toFixed(4),
      Number(decision.stop ?? 0).toFixed(4),
    ].join('|')

    if (key === lastAutoOpenKey) return

    setLastAutoOpenKey(key)
    openDashboardTrade()
  }, [autoPaperMode, decision, lastAutoOpenKey, openDashboardTrade, symbol, timeframe])

  useEffect(() => {
    const id = window.setInterval(() => {
      fetchDecision()
      fetchSummary()
      evaluateOpenTrades()
    }, 15000)

    return () => window.clearInterval(id)
  }, [fetchDecision, fetchSummary, evaluateOpenTrades])

  const aiDecision = normalizeDecision(decision?.decision)
  const rawDecision = normalizeDecision(decision?.rawDecision)
  const decisionTone =
    aiDecision === 'BUY'
      ? 'bull'
      : aiDecision === 'SELL'
        ? 'bear'
        : rawDecision === 'BUY' || rawDecision === 'SELL'
          ? 'warn'
          : 'neutral'

  const activeMemoryStatus =
    decision?.details?.memoryStatus ??
    summary?.memoryStatus ??
    {}

  const activeDecisionStats =
    activeMemoryStatus?.bucketDecisionStats ??
    activeMemoryStatus?.overallDecisionStats ??
    summary?.decisionStats ??
    {}

  const activeClosedStats =
    activeMemoryStatus?.bucketClosedStats ??
    activeMemoryStatus?.overallClosedStats ??
    summary?.stats ??
    {}

  const stats = activeClosedStats
  const decisionStats = activeDecisionStats
  const memoryStatus = activeMemoryStatus
  const blockers = getBlockerAnalysis(
    decision,
    {
      ...(summary ?? {}),
      memoryStatus: activeMemoryStatus,
      decisionStats: activeDecisionStats,
      stats: activeClosedStats,
      closedCount: summary?.closedCount ?? activeClosedStats?.samples ?? 0,
    },
    minConfidence,
    minRiskReward
  )

  const directionalContext = decision?.details?.directionalContext ?? {}
  const ghostMlConfidence = Math.max(
    toFiniteNumber(projectionSnapshot.ghostConfidence, 0),
    toFiniteNumber(directionalContext.ghostConfidence, 0)
  )
  const targetMlConfidence = Math.max(
    toFiniteNumber(projectionSnapshot.targetConfidence, 0),
    toFiniteNumber(directionalContext.targetConfidence, 0)
  )
  const entryMlConfidence = toFiniteNumber(directionalContext.entryConfidence, 0)
  const aiConfidence = toFiniteNumber(decision?.confidence, 0)
  const liveTargetConfidence = toFiniteNumber((projectionSnapshot as any).targetLiveConfidence ?? targetMlConfidence, targetMlConfidence)
  const lockedTargetConfidence = toFiniteNumber((projectionSnapshot as any).targetLockedConfidence ?? targetMlConfidence, targetMlConfidence)
  const targetLearnedReliability = Math.max(
    toFiniteNumber((projectionSnapshot as any).learnedReliability, 0),
    toFiniteNumber((payload as any)?.targetMl?.learnedReliability, 0),
    lockedTargetConfidence,
  )
  const aiSetupConfidence = aiConfidence
  const rrTargetPlan = decision?.details?.rrTargetPlan ?? {}
  const rrPlanMethod = String(rrTargetPlan?.method ?? 'original_target')
  const rrPlanUpgraded = Boolean(rrTargetPlan?.upgraded)
  const rrRequiredTarget = toFiniteNumber(rrTargetPlan?.requiredTarget, 0)
  const originalRiskReward = toFiniteNumber(rrTargetPlan?.originalRiskReward, decision?.riskReward ?? 0)
  const aiMemorySamples = toFiniteNumber(decisionStats.samples, 0)
  const aiMemoryProgress = Math.min(100, (aiMemorySamples / 400) * 100)
  const aiLearnedReliability = Math.max(
    toFiniteNumber(stats.winRate, 0) * 100,
    aiMemorySamples > 0 ? Math.min(100, toFiniteNumber(decisionStats.avgConfidence, 0)) : 0,
  )

  const openTrades = Array.isArray(summary?.openTrades) ? summary?.openTrades ?? [] : []
  const closedTrades =
    Array.isArray(summary?.recentClosedTrades)
      ? summary?.recentClosedTrades ?? []
      : Array.isArray(summary?.closedTrades)
        ? summary?.closedTrades ?? []
        : []

  const liveOpenTrades = openTrades.map((trade: any) => {
    const live = calculateLiveTradePnl(trade, liveActivePrice)

    return {
      ...trade,
      currentPrice: live.current,
      liveCurrentPrice: live.current,
      currentPnl: live.pnl,
      pnl: live.pnl,
      pnlPercent: live.pnlPercent,
      percent: live.pnlPercent,
      livePoints: live.points,
      rMultiple: live.rMultiple,
      liveUpdatedFromChart: live.current > 0,
    }
  })

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mb-6 rounded-2xl border border-purple-400/20 bg-dark-800/90 p-5 shadow-xl"
    >
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black text-white">Dashboard AI Self-Learning Trader</h2>
            <span className="rounded-full border border-purple-400/30 bg-purple-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-purple-200">
              Dashboard Only
            </span>
            <span className="rounded-full border border-red-400/30 bg-red-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-red-200">
              No Broker
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Simulated AI trades only. Learns from dashboard entries, targets, stops, P&amp;L, and closed outcomes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-black ${
            autoPaperMode
              ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
              : 'border-dark-600 bg-dark-900 text-gray-400'
          }`}>
            <input
              type="checkbox"
              checked={autoPaperMode}
              onChange={(event) => setAutoPaperMode(event.target.checked)}
              className="h-3 w-3"
            />
            Auto Paper
          </label>

          <label className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            Min Conf
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={minConfidence}
              onChange={(event) => setMinConfidence(Math.max(1, Math.min(100, Number(event.target.value) || 62)))}
              className="ml-2 w-14 rounded border border-dark-600 bg-dark-800 px-2 py-1 text-xs text-white"
            />
          </label>

          <label className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            Min RR
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.05}
              value={minRiskReward}
              onChange={(event) => setMinRiskReward(Math.max(0.1, Math.min(10, Number(event.target.value) || 1.25)))}
              className="ml-2 w-16 rounded border border-dark-600 bg-dark-800 px-2 py-1 text-xs text-white"
            />
          </label>

          <button
            type="button"
            onClick={fetchDecision}
            className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-xs font-bold text-gray-200 hover:border-purple-300"
          >
            Refresh AI
          </button>
          <button
            type="button"
            onClick={evaluateOpenTrades}
            className="rounded-lg border border-blue-400/30 bg-blue-400/10 px-3 py-2 text-xs font-bold text-blue-200 hover:bg-blue-400/20"
          >
            Evaluate Open
          </button>
          <button
            type="button"
            onClick={openDashboardTrade}
            disabled={!decision?.allowedToTrade}
            className={`rounded-lg px-3 py-2 text-xs font-black ${
              decision?.allowedToTrade
                ? 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20'
                : 'cursor-not-allowed border border-dark-600 bg-dark-900 text-gray-600'
            }`}
          >
            {autoPaperMode ? 'Auto Paper Armed' : 'Open AI Paper Trade'}
          </button>
        </div>
      </div>

      {errorText ? (
        <div className="mb-4 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
          {errorText}
        </div>
      ) : null}

      {actionStatus ? (
        <div className="mb-4 rounded-lg border border-purple-400/20 bg-purple-400/10 px-3 py-2 text-xs text-purple-200">
          {actionStatus}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatBox
          label="AI Decision"
          value={decision?.decision ?? (isLoading ? 'Loading...' : 'WAITING')}
          tone={decisionTone as any}
        />
        <StatBox
          label="Raw Bias"
          value={decision?.rawDecision ?? '—'}
          tone={rawDecision === 'BUY' ? 'bull' : rawDecision === 'SELL' ? 'bear' : 'neutral'}
        />
        <StatBox label="Confidence" value={`${toFiniteNumber(decision?.confidence, 0).toFixed(1)}% ${decision?.confidenceGrade ?? ''}`} tone="neutral" />
        <StatBox label="Auto Paper" value={autoPaperMode ? 'ARMED' : 'OFF'} tone={autoPaperMode ? 'bull' : 'neutral'} />
        <StatBox label="Entry" value={formatPrice(decision?.entry)} />
        <StatBox label="Target" value={formatPrice(decision?.target)} />
        <StatBox label="Stop" value={formatPrice(decision?.stop)} tone="warn" />
        <StatBox label="Current P&L" value={formatMoney(decision?.currentPnl)} tone={toFiniteNumber(decision?.currentPnl, 0) >= 0 ? 'bull' : 'bear'} />
        <StatBox label="Max P&L" value={formatMoney(decision?.maxPnl)} tone={toFiniteNumber(decision?.maxPnl, 0) >= 0 ? 'bull' : 'bear'} />
        <StatBox label="Projection" value={projectionSnapshot.projectionModeLabel || projectionSnapshot.projectionMode} tone={projectionSnapshot.conflict ? 'warn' : projectionSnapshot.available ? 'bull' : 'neutral'} />
        <StatBox label="AI Permission" value={projectionSnapshot.aiPermission} tone={projectionSnapshot.aiPermission === 'CAN_CONSIDER' ? 'bull' : projectionSnapshot.conflict ? 'warn' : 'neutral'} />
      </div>

      <div className="mt-4 rounded-xl border border-dark-700 bg-dark-900/60 p-4">
        <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-black text-white">ML System Status</div>
            <div className="text-xs text-gray-500">
              Live view of Ghost ML, Target Price ML, and AI Trader learning context.
            </div>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
            Background refresh enabled
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatBox
            label="Live Price"
            value={formatPrice(liveActivePrice)}
            tone={liveActivePrice > 0 ? 'bull' : 'warn'}
          />
          <StatBox
            label="Candles"
            value={formatCount(Array.isArray(candles) ? candles.length : 0)}
            tone={Array.isArray(candles) && candles.length > 0 ? 'bull' : 'warn'}
          />
          <StatBox
            label="Payload"
            value={liveActivePrice > 0 ? 'READY' : 'WAITING'}
            tone={liveActivePrice > 0 ? 'bull' : 'warn'}
          />
          <StatBox
            label="Decision Route"
            value={apiBaseUrl ? 'READY' : 'NO API'}
            tone={apiBaseUrl ? 'bull' : 'warn'}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <MlStatusCard
            title="Projection Engine"
            status={projectionSnapshot.available ? projectionSnapshot.projectionModeLabel : 'Waiting'}
            confidence={toFiniteNumber(projectionSnapshot.alignmentScore, 0)}
            tone={projectionSnapshot.conflict ? 'warn' : projectionSnapshot.available ? 'bull' : 'neutral'}
            detail={
              projectionSnapshot.available
                ? `Target ${formatPrice(projectionSnapshot.targetPrice)} • ${projectionSnapshot.aiPermission} • ${projectionSnapshot.alignmentLabel}`
                : 'Waiting for Unified Projection Engine target, ghost route, and alignment.'
            }
          />

          <MlStatusCard
            title="Ghost ML"
            status={getMlStrengthLabel(ghostMlConfidence)}
            confidence={ghostMlConfidence}
            tone={getMlStrengthTone(ghostMlConfidence)}
            detail={
              ghostMlConfidence > 0
                ? 'Ghost ML is contributing to projected candle confidence and AI decision scoring.'
                : 'Waiting for Ghost ML confidence to flow into the AI context.'
            }
          />

          <MlStatusCard
            title="Target Price ML"
            status={(projectionSnapshot as any).targetSourceLockActive ? 'Source Locked' : getMlStrengthLabel(targetMlConfidence)}
            confidence={targetMlConfidence}
            tone={getMlStrengthTone(targetMlConfidence)}
            detail={
              targetMlConfidence > 0
                ? `Live ${liveTargetConfidence.toFixed(1)}% • locked ${lockedTargetConfidence.toFixed(1)}% • learned ${targetLearnedReliability.toFixed(1)}%`
                : 'Waiting for real Target Price ML; using chart ghost overlay only if ML target is unavailable.'
            }
          />

          <MlStatusCard
            title="AI Setup Score"
            status={formatAiStage(memoryStatus.stage)}
            confidence={aiSetupConfidence}
            tone={decision?.allowedToTrade ? 'bull' : aiSetupConfidence >= minConfidence ? 'warn' : 'neutral'}
            detail={
              decision?.allowedToTrade
                ? 'Current setup is trade-ready for dashboard-only paper execution.'
                : `Setup score changes every candle. Memory progress ${aiMemoryProgress.toFixed(1)}% from ${formatCount(aiMemorySamples)} observations.`
            }
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatBox label="Entry ML" value={`${entryMlConfidence.toFixed(1)}%`} tone={getMlStrengthTone(entryMlConfidence)} />
          <StatBox label="Target" value={formatPrice(decision?.target)} />
          <StatBox label="RR" value={`${toFiniteNumber(decision?.riskReward, 0).toFixed(2)}R`} tone={toFiniteNumber(decision?.riskReward, 0) >= minRiskReward ? 'bull' : 'warn'} />
          <StatBox label="Original RR" value={`${originalRiskReward.toFixed(2)}R`} tone={originalRiskReward >= minRiskReward ? 'bull' : 'warn'} />
          <StatBox label="RR Plan" value={rrPlanUpgraded ? 'UPGRADED' : rrPlanMethod.replace(/_/g, ' ').toUpperCase()} tone={rrPlanUpgraded ? 'bull' : toFiniteNumber(decision?.riskReward, 0) >= minRiskReward ? 'bull' : 'warn'} />
          <StatBox label="Required Target" value={formatPrice(rrRequiredTarget)} tone={rrRequiredTarget > 0 ? 'warn' : 'neutral'} />
          <StatBox label="Target Source" value={projectionSnapshot.source || '—'} />
          <StatBox label="Target Live Conf" value={`${liveTargetConfidence.toFixed(1)}%`} tone={getMlStrengthTone(liveTargetConfidence)} />
          <StatBox label="Target Locked Conf" value={`${lockedTargetConfidence.toFixed(1)}%`} tone={(projectionSnapshot as any).targetSourceLockActive ? 'bull' : getMlStrengthTone(lockedTargetConfidence)} />
          <StatBox label="Target Learned" value={`${targetLearnedReliability.toFixed(1)}%`} tone={getMlStrengthTone(targetLearnedReliability)} />
          <StatBox label="Source Lock" value={(projectionSnapshot as any).targetSourceLockActive ? 'ACTIVE' : 'STANDBY'} tone={(projectionSnapshot as any).targetSourceLockActive ? 'bull' : 'neutral'} />
          <StatBox label="AI Setup Conf" value={`${aiSetupConfidence.toFixed(1)}%`} tone={decision?.allowedToTrade ? 'bull' : aiSetupConfidence >= minConfidence ? 'warn' : 'neutral'} />
          <StatBox label="AI Memory Progress" value={`${aiMemoryProgress.toFixed(1)}%`} tone={aiMemorySamples >= 10 ? 'bull' : 'warn'} />
          <StatBox label="AI Learned" value={`${aiLearnedReliability.toFixed(1)}%`} tone={aiMemorySamples >= 10 ? 'bull' : 'neutral'} />
          <StatBox label="Alignment" value={`${toFiniteNumber(projectionSnapshot.alignmentScore, 0).toFixed(1)}%`} tone={projectionSnapshot.conflict ? 'warn' : toFiniteNumber(projectionSnapshot.alignmentScore, 0) >= 60 ? 'bull' : 'neutral'} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-dark-700 bg-dark-900/70 p-4 xl:col-span-2">
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-gray-400">AI Reason</div>
          <p className="text-sm leading-6 text-gray-200">
            {decision?.reason ?? 'Waiting for enough dashboard data to create a decision.'}
          </p>

          {Array.isArray(decision?.reasons) && decision.reasons.length > 0 ? (
            <div className="mt-3 space-y-1">
              {decision.reasons.slice(0, 6).map((reason, index) => (
                <div key={`${reason}-${index}`} className="text-xs text-gray-400">
                  • {reason}
                </div>
              ))}
            </div>
          ) : null}

          {rrTargetPlan?.reason ? (
            <div className={`mt-4 rounded-xl border px-3 py-2 text-xs ${rrPlanUpgraded ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/30 bg-amber-400/10 text-amber-200'}`}>
              <div className="font-black uppercase tracking-wide">RR Builder</div>
              <div className="mt-1 leading-5">
                {String(rrTargetPlan.reason)}
                {rrRequiredTarget > 0 ? ` Required target: ${formatPrice(rrRequiredTarget)}.` : ''}
              </div>
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-dark-700 bg-dark-800/70 p-3">
            <div className="mb-2 text-xs font-black uppercase tracking-wide text-gray-400">Blocker Analysis</div>
            <div className="space-y-2">
              {blockers.slice(0, 6).map((blocker) => (
                <div key={`${blocker.label}-${blocker.detail}`} className="flex flex-col gap-1 rounded-lg border border-dark-700 bg-dark-900/70 px-3 py-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-xs font-black text-white">{blocker.label}</div>
                    <div className="text-xs text-gray-500">{blocker.detail}</div>
                  </div>
                  <BlockerBadge severity={blocker.severity} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-dark-700 bg-dark-900/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs font-black uppercase tracking-wide text-gray-400">Learning Memory</div>
            <span className="rounded-full border border-purple-400/30 bg-purple-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-purple-200">
              {formatAiStage(memoryStatus.stage)}
            </span>
          </div>

          <div className="mb-3 rounded-lg border border-dark-700 bg-dark-800/70 px-3 py-2 text-xs text-gray-300">
            {String(memoryStatus.message ?? 'AI memory is collecting live decision observations.')}
            {toFiniteNumber(decisionStats.samples, 0) > 0 ? (
              <span className="ml-2 font-black text-emerald-300">
                • {formatCount(decisionStats.samples)} live observations loaded
              </span>
            ) : null}
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <StatBox
              label="Live Observations"
              value={formatCount(decisionStats.samples)}
              tone={toFiniteNumber(decisionStats.samples, 0) >= 10 ? 'bull' : 'warn'}
            />
            <StatBox
              label="Memory Source"
              value={decision?.details?.memoryStatus ? 'LIVE DECISION' : summary?.memoryStatus ? 'SUMMARY' : 'WAITING'}
              tone={decision?.details?.memoryStatus ? 'bull' : 'warn'}
            />
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <StatBox label="Setup Confidence" value={`${aiSetupConfidence.toFixed(1)}%`} tone={decision?.allowedToTrade ? 'bull' : aiSetupConfidence >= minConfidence ? 'warn' : 'neutral'} />
            <StatBox label="Memory Progress" value={`${aiMemoryProgress.toFixed(1)}%`} tone={aiMemorySamples >= 10 ? 'bull' : 'warn'} />
            <StatBox label="Learned Reliability" value={`${aiLearnedReliability.toFixed(1)}%`} tone={aiMemorySamples >= 10 ? 'bull' : 'neutral'} />
            <StatBox label="Target Lock" value={(projectionSnapshot as any).targetSourceLockActive ? 'ACTIVE' : 'STANDBY'} tone={(projectionSnapshot as any).targetSourceLockActive ? 'bull' : 'neutral'} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <StatBox label="Decisions" value={formatCount(decisionStats.samples)} />
            <StatBox label="Trade Ready" value={formatCount(decisionStats.tradeReadyCount)} tone="bull" />
            <StatBox label="HOLD Count" value={formatCount(decisionStats.holdCount)} tone="warn" />
            <StatBox label="Avg AI Conf" value={`${toFiniteNumber(decisionStats.avgConfidence, 0).toFixed(1)}%`} />
            <StatBox label="BUY Bias" value={formatCount(decisionStats.buyBias)} tone="bull" />
            <StatBox label="SELL Bias" value={formatCount(decisionStats.sellBias)} tone="bear" />
            <StatBox label="Open" value={String(summary?.openCount ?? 0)} />
            <StatBox label="Closed" value={String(summary?.closedCount ?? 0)} />
            <StatBox label="Win Rate" value={formatPercent(stats.winRate)} tone="bull" />
            <StatBox label="Profit Factor" value={toFiniteNumber(stats.profitFactor, 0).toFixed(2)} />
            <StatBox label="Avg P&L" value={formatMoney(stats.avgPnl)} />
            <StatBox label="Avg R" value={toFiniteNumber(stats.avgR, 0).toFixed(2)} />
          </div>
        </div>
      </div>

      {openTrades.length > 0 ? (
        <div className="mt-4 rounded-xl border border-dark-700 bg-dark-900/70 p-4">
          <div className="mb-1 text-xs font-black uppercase tracking-wide text-gray-400">Open Dashboard AI Trades</div>
          <div className="mb-3 text-[11px] text-gray-500">
            Open trade current price and P&amp;L are recalculated from the live chart price every refresh.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="text-gray-500">
                <tr>
                  <th className="pb-2">Side</th>
                  <th className="pb-2">Entry</th>
                  <th className="pb-2">Target</th>
                  <th className="pb-2">Stop</th>
                  <th className="pb-2">Current</th>
                  <th className="pb-2">P&L</th>
                  <th className="pb-2">P&L %</th>
                  <th className="pb-2">Live R</th>
                  <th className="pb-2">Confidence</th>
                  <th className="pb-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {liveOpenTrades.slice(-5).map((trade: any) => (
                  <tr key={trade.id ?? `${trade.side}-${trade.entryTime}`} className="border-t border-dark-700 text-gray-300">
                    <td className={`py-2 font-black ${normalizeDecision(trade.side) === 'BUY' ? 'text-emerald-300' : 'text-red-300'}`}>
                      {trade.side}
                    </td>
                    <td className="py-2">{formatPrice(trade.entry)}</td>
                    <td className="py-2">{formatPrice(trade.target)}</td>
                    <td className="py-2">{formatPrice(trade.stop)}</td>
                    <td className="py-2">{formatPrice(trade.currentPrice)}</td>
                    <td className={`py-2 font-bold ${toFiniteNumber(trade.currentPnl, 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {formatMoney(trade.currentPnl)}
                    </td>
                    <td className={`py-2 font-bold ${toFiniteNumber(trade.pnlPercent, 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {formatPercent(trade.pnlPercent)}
                    </td>
                    <td className={`py-2 font-bold ${toFiniteNumber(trade.rMultiple, 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {toFiniteNumber(trade.rMultiple, 0).toFixed(2)}R
                    </td>
                    <td className="py-2">{toFiniteNumber(trade.confidence, 0).toFixed(1)}%</td>
                    <td className="max-w-[280px] truncate py-2 text-gray-500">{trade.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {closedTrades.length > 0 ? (
        <div className="mt-4 rounded-xl border border-dark-700 bg-dark-900/70 p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-wide text-gray-400">Recent Closed AI Trades</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="text-gray-500">
                <tr>
                  <th className="pb-2">Result</th>
                  <th className="pb-2">Side</th>
                  <th className="pb-2">Entry</th>
                  <th className="pb-2">Exit</th>
                  <th className="pb-2">Target</th>
                  <th className="pb-2">Stop</th>
                  <th className="pb-2">P&L</th>
                  <th className="pb-2">R</th>
                  <th className="pb-2">Exit Reason</th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.slice(-5).reverse().map((trade: any) => (
                  <tr key={trade.id ?? `${trade.side}-${trade.exitTime}`} className="border-t border-dark-700 text-gray-300">
                    <td className={`py-2 font-black ${String(trade.result).toUpperCase() === 'WIN' ? 'text-emerald-300' : 'text-red-300'}`}>
                      {trade.result ?? 'CLOSED'}
                    </td>
                    <td className={`py-2 font-black ${normalizeDecision(trade.side) === 'BUY' ? 'text-emerald-300' : 'text-red-300'}`}>
                      {trade.side}
                    </td>
                    <td className="py-2">{formatPrice(trade.entry)}</td>
                    <td className="py-2">{formatPrice(trade.exit ?? trade.exitPrice)}</td>
                    <td className="py-2">{formatPrice(trade.target)}</td>
                    <td className="py-2">{formatPrice(trade.stop)}</td>
                    <td className={`py-2 font-bold ${toFiniteNumber(trade.pnl, 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {formatMoney(trade.pnl)}
                    </td>
                    <td className="py-2">{toFiniteNumber(trade.rMultiple, 0).toFixed(2)}</td>
                    <td className="py-2 text-gray-500">{trade.exitReason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

    </motion.div>
  )
}
