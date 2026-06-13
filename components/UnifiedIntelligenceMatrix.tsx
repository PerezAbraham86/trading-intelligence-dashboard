'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'

type UnifiedIntelligenceMatrixProps = {
  signal?: any
  unifiedIntelligence?: any | null
  overlayPayload?: any | null
  scorecards?: any | null
  mlFeatures?: any | null
  technicalSentiment?: any | null
  activeSymbol?: string
  activeTimeframe?: string
  activePrice?: number
}

type MatrixRow = {
  key: string
  source: string
  system?: string
  direction: string
  score: number | null
  confidence: number | null
  status: string
  details: string
}

type MatrixSummary = {
  active: number
  bullish: number
  bearish: number
  avgConfidence: number
  bias: 'Bullish' | 'Bearish' | 'Neutral'
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clampPercent(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const normalized = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed
  return Math.max(0, Math.min(100, Math.round(normalized)))
}

function firstValue(...values: unknown[]): any {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value
  }

  return undefined
}

function getPath(source: any, path: string, fallback?: any): any {
  const parts = path.split('.')
  let current = source

  for (const part of parts) {
    if (!current || typeof current !== 'object') return fallback
    current = current[part]
  }

  return current ?? fallback
}

function normalizeDirection(value: unknown): 'bullish' | 'bearish' | 'neutral' | 'active' | 'inactive' | 'pending' {
  const text = String(value ?? '').toLowerCase()

  if (text.includes('bull') || text.includes('buy') || text.includes('long') || text.includes('demand')) return 'bullish'
  if (text.includes('bear') || text.includes('sell') || text.includes('short') || text.includes('supply')) return 'bearish'
  if (text.includes('active') || text.includes('open') || text.includes('live') || text === 'ready') return 'active'
  if (text.includes('inactive') || text.includes('disabled') || text.includes('unavailable')) return 'inactive'
  if (text.includes('pending') || text.includes('waiting') || text.includes('not_wired') || text.includes('learning') || text.includes('wait')) return 'pending'

  return 'neutral'
}

function directionLabel(value: unknown): string {
  const direction = normalizeDirection(value)

  if (direction === 'bullish') return 'Bullish'
  if (direction === 'bearish') return 'Bearish'
  if (direction === 'active') return 'Active'
  if (direction === 'inactive') return 'Inactive'
  if (direction === 'pending') return 'Waiting'

  return 'Neutral'
}

function normalizeStatus(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return 'Active'

  if (text.includes('_')) {
    return text
      .split('_')
      .map((item) => item.charAt(0).toUpperCase() + item.slice(1).toLowerCase())
      .join(' ')
  }

  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
}

function directionClass(value: unknown): string {
  const direction = normalizeDirection(value)

  if (direction === 'bullish' || direction === 'active') return 'text-emerald-400'
  if (direction === 'bearish' || direction === 'inactive') return 'text-red-400'
  if (direction === 'pending') return 'text-yellow-300'

  return 'text-gray-300'
}

function badgeClass(value: unknown): string {
  const direction = normalizeDirection(value)

  if (direction === 'bullish' || direction === 'active') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
  if (direction === 'bearish' || direction === 'inactive') return 'border-red-400/30 bg-red-400/10 text-red-300'
  if (direction === 'pending') return 'border-yellow-400/30 bg-yellow-400/10 text-yellow-300'

  return 'border-dark-600 bg-dark-900/60 text-gray-300'
}

function scoreBarClass(value: unknown): string {
  const direction = normalizeDirection(value)

  if (direction === 'bullish' || direction === 'active') return 'bg-emerald-400'
  if (direction === 'bearish' || direction === 'inactive') return 'bg-red-400'
  if (direction === 'pending') return 'bg-yellow-300'

  return 'bg-blue-400'
}

function formatNumber(value: unknown, digits = 2): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'

  if (Math.abs(parsed) >= 1000) {
    return parsed.toLocaleString(undefined, { maximumFractionDigits: digits })
  }

  return parsed.toFixed(digits)
}

function formatDetails(parts: Array<string | number | null | undefined | false>): string {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== false && String(part).trim() !== '')
    .map((part) => String(part))
    .join(' • ')
}

function getScore(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return clampPercent(parsed)
  }

  return null
}

function getArrayPath(...values: unknown[]): any[] {
  for (const value of values) {
    if (Array.isArray(value)) return value
  }

  return []
}

function statusFromScore(score: number | null, active = false): string {
  if (score !== null && score > 0) return active ? 'Active' : 'Learning'
  return active ? 'Active' : 'Waiting'
}

function readProjectionEngine(signal: any, unifiedIntelligence: any, overlayPayload: any): any {
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
        candidate.marketState ||
        candidate.activeTargetPrice
      )
    ) {
      return candidate
    }
  }

  return null
}

function projectionTargetPrice(projectionEngine: any): any {
  return firstValue(
    projectionEngine?.activeTargetPrice,
    projectionEngine?.target?.price,
    projectionEngine?.targetPrice,
    projectionEngine?.targetPlan?.targetPrice,
    projectionEngine?.targetMl?.targetPrice,
    projectionEngine?.finalTargetPrice,
    projectionEngine?.ghostOverlayTargetPrice,
    projectionEngine?.ghostPath?.targetPrice,
    projectionEngine?.ghostPath?.endPrice,
  )
}

function projectionTargetConfidence(projectionEngine: any): number | null {
  return getScore(
    projectionEngine?.activeTargetConfidence,
    projectionEngine?.target?.confidence,
    projectionEngine?.targetPlan?.targetConfidence,
    projectionEngine?.targetMl?.targetConfidence,
    projectionEngine?.targetConfidence,
  )
}

function projectionGhostCandles(projectionEngine: any): any[] {
  const candidates = [
    projectionEngine?.ghostPath?.candles,
    projectionEngine?.ghostCandles,
    projectionEngine?.ghosts,
    projectionEngine?.ghostProjection?.candles,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate
  }

  return []
}

function averageGhostConfidence(ghostCandles: any[]): number | null {
  const values = ghostCandles
    .map((candle) => Number(candle?.confidence ?? candle?.targetConfidence ?? candle?.probability))
    .filter((value) => Number.isFinite(value))

  if (!values.length) return null

  return clampPercent(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function inferGhostDirection(ghostCandles: any[], fallback?: any): string {
  const first = ghostCandles[0]
  const last = ghostCandles[ghostCandles.length - 1]
  const start = Number(first?.open ?? first?.o ?? first?.close ?? first?.c)
  const end = Number(last?.close ?? last?.c)

  if (Number.isFinite(start) && Number.isFinite(end) && start !== end) {
    return end > start ? 'bullish' : 'bearish'
  }

  return directionLabel(fallback)
}

function getGhostCandles(unifiedIntelligence: any, overlayPayload: any, scorecards: any): any[] {
  const candidates = [
    unifiedIntelligence?.projectionEngine?.ghostPath?.candles,
    unifiedIntelligence?.projectionEngine?.ghostCandles,
    unifiedIntelligence?.ghostPath?.candles,
    unifiedIntelligence?.ghostCandles,
    overlayPayload?.projectionEngine?.ghostPath?.candles,
    overlayPayload?.ghostCandles,
    scorecards?.ghost?.candles,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate
  }

  return []
}

function formatProjectionSource(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return 'Unified Projection Engine'

  return raw
    .replace(/_/g, ' ')
    .replace(/:/g, ' • ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function addRow(rows: MatrixRow[], row: MatrixRow): void {
  rows.push({
    ...row,
    score: row.score === undefined ? null : row.score,
    confidence: row.confidence === undefined ? null : row.confidence,
    status: row.status || 'Waiting',
    direction: row.direction || 'Neutral',
    details: row.details || '—',
  })
}

function getProjectionEngineRows(projectionEngine: any): MatrixRow[] {
  if (!projectionEngine || typeof projectionEngine !== 'object') return []

  const rows: MatrixRow[] = []
  const marketState = projectionEngine.marketState ?? {}
  const target = projectionEngine.target ?? {}
  const ghostPath = projectionEngine.ghostPath ?? {}
  const alignment = projectionEngine.alignment ?? {}
  const mode = projectionEngine.mode ?? {}
  const learning = projectionEngine.learning ?? {}
  const targetPrice = projectionTargetPrice(projectionEngine)
  const targetConfidence = projectionTargetConfidence(projectionEngine)
  const ghostCandles = projectionGhostCandles(projectionEngine)
  const ghostConfidence = getScore(
    ghostPath.confidence,
    projectionEngine.ghostConfidence,
    averageGhostConfidence(ghostCandles),
    projectionEngine?.ghostProjection?.confidence,
  )
  const alignmentScore = getScore(alignment.score, projectionEngine.alignmentScore)
  const marketDirection = firstValue(marketState.direction, target.direction, ghostPath.direction, 'neutral')
  const aiPermission = firstValue(projectionEngine.aiPermission, 'WAIT')
  const targetSource = firstValue(projectionEngine.activeTargetSource, target.source, projectionEngine.targetPlan?.source, 'Unified Projection Engine')
  const targetType = firstValue(projectionEngine.activeTargetType, target.type, projectionEngine.targetPlan?.type, 'TARGET')

  addRow(rows, {
    key: 'projection-engine',
    source: 'Unified Projection Engine',
    system: 'MASTER',
    direction: directionLabel(marketDirection),
    score: getScore(marketState.confidence, alignmentScore, targetConfidence),
    confidence: getScore(marketState.confidence, alignmentScore, targetConfidence),
    status: normalizeStatus(projectionEngine.status ?? 'ready'),
    details: formatDetails([
      mode.label ?? projectionEngine.projectionModeLabel ?? projectionEngine.projectionMode,
      targetPrice !== undefined ? `Target ${formatNumber(targetPrice, 2)}` : 'No target',
      `AI ${aiPermission}`,
      alignment.label ? `Alignment ${alignment.label}` : null,
    ]),
  })

  addRow(rows, {
    key: 'projection-target',
    source: 'Self-Learning Target',
    system: 'TARGET',
    direction: directionLabel(firstValue(target.direction, marketDirection)),
    score: targetConfidence,
    confidence: targetConfidence,
    status: normalizeStatus(target.available === false ? 'waiting' : targetConfidence ? 'active' : 'waiting'),
    details: formatDetails([
      `Price ${formatNumber(targetPrice, 2)}`,
      formatProjectionSource(targetSource),
      String(targetType),
      target.reason,
    ]),
  })

  addRow(rows, {
    key: 'projection-ghost-route',
    source: 'Target-Guided Ghost Route',
    system: 'GHOST',
    direction: directionLabel(firstValue(ghostPath.direction, target.direction)),
    score: ghostConfidence,
    confidence: ghostConfidence,
    status: normalizeStatus(ghostPath.available === false ? 'waiting' : ghostConfidence ? 'active' : 'waiting'),
    details: formatDetails([
      `Candles ${ghostCandles.length}`,
      `End ${formatNumber(ghostPath.endPrice, 2)}`,
      `Target ${formatNumber(ghostPath.targetPrice ?? targetPrice, 2)}`,
      ghostPath.reason,
    ]),
  })

  addRow(rows, {
    key: 'projection-alignment',
    source: 'Target ↔ Ghost Alignment',
    system: 'SYNC',
    direction: directionLabel(alignment.conflict ? 'pending' : alignment.targetAndGhostAgree ? 'active' : 'neutral'),
    score: alignmentScore,
    confidence: alignmentScore,
    status: normalizeStatus(alignment.conflict ? 'conflict' : alignment.targetAndGhostAgree ? 'active' : 'learning'),
    details: formatDetails([
      alignment.label,
      alignment.reason,
      alignment.distanceErrorPoints !== undefined ? `Error ${formatNumber(alignment.distanceErrorPoints, 2)} pts` : null,
    ]),
  })

  addRow(rows, {
    key: 'projection-ai-permission',
    source: 'AI Permission',
    system: 'AI',
    direction: directionLabel(String(aiPermission).includes('CAN') ? 'active' : String(aiPermission).includes('CONFLICT') ? 'pending' : 'neutral'),
    score: getScore(alignmentScore, projectionEngine.activeTargetConfidence),
    confidence: getScore(alignmentScore, projectionEngine.activeTargetConfidence),
    status: normalizeStatus(aiPermission),
    details: formatDetails([
      `Mode ${mode.label ?? projectionEngine.projectionModeLabel ?? projectionEngine.projectionMode ?? 'Learning'}`,
      learning.targetHitRate !== undefined ? `Target hit ${(Number(learning.targetHitRate) * 100).toFixed(1)}%` : null,
      learning.directionAccuracy !== undefined ? `Direction ${(Number(learning.directionAccuracy) * 100).toFixed(1)}%` : null,
    ]),
  })

  return rows
}

function getNrtrRows(scorecards: any, mlFeatures: any): MatrixRow[] {
  const feeds = [
    ['nrtr-main', 'NRTR Main', scorecards?.nrtr?.main ?? scorecards?.nrtrMain ?? mlFeatures?.nrtrMain],
    ['nrtr-mini-1', 'NRTR Mini 1', scorecards?.nrtr?.miniOne ?? scorecards?.nrtrMiniOne ?? mlFeatures?.nrtrMiniOne],
    ['nrtr-mini-2', 'NRTR Mini 2', scorecards?.nrtr?.miniTwo ?? scorecards?.nrtrMiniTwo ?? mlFeatures?.nrtrMiniTwo],
  ] as const

  return feeds.map(([key, source, item]) => ({
    key,
    source,
    system: 'STRATEGY',
    direction: directionLabel(firstValue(item?.direction, item?.signal, item?.side, 'neutral')),
    score: getScore(item?.score, item?.confidence, item?.strength),
    confidence: getScore(item?.confidence, item?.score, item?.strength),
    status: normalizeStatus(firstValue(item?.status, item ? 'active' : 'waiting')),
    details: formatDetails([
      item?.reason,
      item?.mode,
      item?.settings,
      item?.bars !== undefined ? `Bars ${item.bars}` : null,
    ]) || 'NRTR strategy context only',
  }))
}

function buildRows(props: UnifiedIntelligenceMatrixProps): MatrixRow[] {
  const { signal, unifiedIntelligence, overlayPayload, scorecards, mlFeatures, technicalSentiment } = props
  const rows: MatrixRow[] = []
  const projectionEngine = readProjectionEngine(signal, unifiedIntelligence, overlayPayload)
  const components = unifiedIntelligence?.components ?? signal?.components ?? {}
  const activeFactors = scorecards?.activeFactors ?? {}
  const ghostCandles = getGhostCandles(unifiedIntelligence, overlayPayload, scorecards)
  const ghostConfidence = getScore(
    ghostCandles[0]?.confidence,
    getPath(unifiedIntelligence, 'projectionEngine.ghostPath.confidence'),
    getPath(unifiedIntelligence, 'ghostProjection.confidence'),
    averageGhostConfidence(ghostCandles),
    scorecards?.ghost?.confidence,
  )
  const ghostDirection = inferGhostDirection(
    ghostCandles,
    firstValue(getPath(unifiedIntelligence, 'ghostProjection.direction'), getPath(unifiedIntelligence, 'components.ghost.direction'), scorecards?.ghost?.direction),
  )
  const targetConfidence = getScore(
    getPath(unifiedIntelligence, 'projectionEngine.target.confidence'),
    getPath(unifiedIntelligence, 'targetMl.confidence'),
    scorecards?.target?.confidence,
  )
  const orderBullish = firstValue(scorecards?.orderBlocks?.bullishZones, activeFactors.orderBlocksBullish, overlayPayload?.orderBlocks?.bullish, 0)
  const orderBearish = firstValue(scorecards?.orderBlocks?.bearishZones, activeFactors.orderBlocksBearish, overlayPayload?.orderBlocks?.bearish, 0)

  rows.push(...getProjectionEngineRows(projectionEngine))

  addRow(rows, {
    key: 'smc-structure',
    source: 'SMC Structure',
    system: 'MARKET',
    direction: directionLabel(firstValue(scorecards?.smc?.direction, components.smc?.direction, signal?.structureDirection, signal?.direction, 'neutral')),
    score: getScore(scorecards?.smc?.score, components.smc?.score, signal?.smcScore),
    confidence: getScore(scorecards?.smc?.confidence, components.smc?.confidence, signal?.smcConfidence),
    status: normalizeStatus(firstValue(scorecards?.smc?.status, components.smc?.status, 'active')),
    details: formatDetails([
      `Events ${firstValue(scorecards?.smc?.events, activeFactors.smc, overlayPayload?.lines?.length, 0)}`,
      scorecards?.smc?.reason,
    ]),
  })

  addRow(rows, {
    key: 'alphax-dlm-feed',
    source: 'AlphaX / DLM Feed',
    system: 'MARKET',
    direction: directionLabel(firstValue(scorecards?.alphaDlm?.direction, components.alphaDlm?.direction, 'neutral')),
    score: getScore(scorecards?.alphaDlm?.score, components.alphaDlm?.score),
    confidence: getScore(scorecards?.alphaDlm?.confidence, components.alphaDlm?.confidence),
    status: normalizeStatus(firstValue(scorecards?.alphaDlm?.status, components.alphaDlm?.status, 'waiting')),
    details: formatDetails([`AlphaX / DLM Score ${formatNumber(firstValue(scorecards?.alphaDlm?.score, components.alphaDlm?.score, 0), 1)}`]),
  })

  addRow(rows, {
    key: 'order-blocks-feed',
    source: 'Order Blocks Feed',
    system: 'MARKET',
    direction: directionLabel(Number(orderBullish) > Number(orderBearish) ? 'bullish' : Number(orderBearish) > Number(orderBullish) ? 'bearish' : 'neutral'),
    score: getScore(scorecards?.orderBlocks?.score, components.orderBlocks?.score),
    confidence: getScore(scorecards?.orderBlocks?.confidence, components.orderBlocks?.confidence),
    status: normalizeStatus(firstValue(scorecards?.orderBlocks?.status, Number(orderBullish) || Number(orderBearish) ? 'active' : 'waiting')),
    details: formatDetails([`Bullish ${orderBullish}`, `Bearish ${orderBearish}`, `Zones ${firstValue(activeFactors.orderBlocks, overlayPayload?.zones?.length, 0)}`]),
  })

  addRow(rows, {
    key: 'liquidity-sweeps-feed',
    source: 'Liquidity / Sweeps Feed',
    system: 'MARKET',
    direction: directionLabel(firstValue(scorecards?.liquidity?.direction, components.liquidity?.direction, 'neutral')),
    score: getScore(scorecards?.liquidity?.score, components.liquidity?.score),
    confidence: getScore(scorecards?.liquidity?.confidence, components.liquidity?.confidence),
    status: normalizeStatus(firstValue(scorecards?.liquidity?.status, 'waiting')),
    details: formatDetails([`Liquidity / Sweeps Score ${formatNumber(firstValue(scorecards?.liquidity?.score, 0), 1)}`]),
  })

  addRow(rows, {
    key: 'fvg-pd-zones-feed',
    source: 'FVG / PD Zones Feed',
    system: 'MARKET',
    direction: directionLabel(firstValue(scorecards?.zones?.direction, components.zones?.direction, 'neutral')),
    score: getScore(scorecards?.zones?.score, components.zones?.score),
    confidence: getScore(scorecards?.zones?.confidence, components.zones?.confidence),
    status: normalizeStatus(firstValue(scorecards?.zones?.status, 'waiting')),
    details: formatDetails([`FVG / PD Zones Score ${formatNumber(firstValue(scorecards?.zones?.score, 0), 1)}`]),
  })

  addRow(rows, {
    key: 'meters-gauges-feed',
    source: 'Meters / Gauges Feed',
    system: 'MARKET',
    direction: directionLabel(firstValue(technicalSentiment?.sentimentStatus, signal?.technicalSentiment?.sentimentStatus, 'neutral')),
    score: getScore(technicalSentiment?.sentiment, signal?.technicalSentiment?.sentiment, signal?.technicalScore),
    confidence: getScore(technicalSentiment?.confidence, technicalSentiment?.sentiment, signal?.technicalScore),
    status: normalizeStatus(firstValue(technicalSentiment ? 'active' : null, 'waiting')),
    details: formatDetails([`Indicators ${firstValue(technicalSentiment?.activeCount, technicalSentiment?.indicators?.length, 0)}`, technicalSentiment?.sentimentLabel]),
  })

  addRow(rows, {
    key: 'external-tables-feed',
    source: 'External Tables Feed',
    system: 'MARKET',
    direction: directionLabel(firstValue(scorecards?.externalTables?.direction, components.externalTables?.direction, 'neutral')),
    score: getScore(scorecards?.externalTables?.score, components.externalTables?.score, 25),
    confidence: getScore(scorecards?.externalTables?.confidence, components.externalTables?.confidence, 25),
    status: normalizeStatus(firstValue(scorecards?.externalTables?.status, 'learning')),
    details: formatDetails([`External Tables Score ${formatNumber(firstValue(scorecards?.externalTables?.score, 25), 1)}`]),
  })

  addRow(rows, {
    key: 'alphax-dlm-profile',
    source: 'AlphaX DLM / Profile',
    system: 'MARKET',
    direction: directionLabel(firstValue(scorecards?.profile?.direction, components.profile?.direction, 'neutral')),
    score: getScore(scorecards?.profile?.score, components.profile?.score, overlayPayload?.liquidityProfileBins?.length ? 5 : null),
    confidence: getScore(scorecards?.profile?.confidence, components.profile?.confidence, overlayPayload?.liquidityProfileBins?.length ? 5 : null),
    status: normalizeStatus(firstValue(scorecards?.profile?.status, overlayPayload?.liquidityProfileBins?.length ? 'active' : 'waiting')),
    details: formatDetails([`Profile bins ${firstValue(overlayPayload?.liquidityProfileBins?.length, 0)}`, `DLM ${firstValue(scorecards?.profile?.dlmScore, components.profile?.dlmScore, 0)}`]),
  })

  addRow(rows, {
    key: 'order-blocks',
    source: 'Order Blocks',
    system: 'MARKET',
    direction: directionLabel(Number(orderBullish) > Number(orderBearish) ? 'bullish' : Number(orderBearish) > Number(orderBullish) ? 'bearish' : 'neutral'),
    score: getScore(scorecards?.orderBlocks?.confidence, scorecards?.orderBlocks?.score),
    confidence: getScore(scorecards?.orderBlocks?.confidence, scorecards?.orderBlocks?.score),
    status: normalizeStatus(Number(orderBullish) || Number(orderBearish) ? 'active' : 'waiting'),
    details: formatDetails([`Bullish ${orderBullish}`, `Bearish ${orderBearish}`, `Zones ${firstValue(activeFactors.orderBlocks, overlayPayload?.zones?.length, 0)}`]),
  })

  addRow(rows, {
    key: 'ghost',
    source: projectionEngine ? 'Projection Engine Ghost Candles' : 'Python Ghost Candles',
    system: 'ML',
    direction: directionLabel(ghostDirection),
    score: ghostConfidence,
    confidence: ghostConfidence,
    status: normalizeStatus(ghostCandles.length || ghostConfidence ? 'active' : 'waiting'),
    details: formatDetails([
      getPath(unifiedIntelligence, 'projectionEngine.ghostPath.reason'),
      getPath(unifiedIntelligence, 'ghostPath.reason'),
      getPath(unifiedIntelligence, 'ghostProjection.reason'),
      ghostCandles[0]?.targetReaction,
      ghostCandles[0]?.projectionMode,
      `Projections ${ghostCandles.length || scorecards?.ghost?.count || 0}`,
    ]),
  })

  rows.push(...getNrtrRows(scorecards, mlFeatures))

  addRow(rows, {
    key: 'smma',
    source: 'SMMA',
    system: 'STRATEGY',
    direction: directionLabel(firstValue(components.smma?.direction, components.smma?.signal, 'neutral')),
    score: getScore(components.smma?.score, components.smma?.distancePercent),
    confidence: getScore(components.smma?.confidence, components.smma?.score),
    status: normalizeStatus(firstValue(components.smma?.status, 'active')),
    details: formatDetails([components.smma?.reason, components.smma?.length ? `Length ${components.smma.length}` : null]) || 'Chart-level SMMA direction is available on each chart',
  })

  addRow(rows, {
    key: 'session',
    source: 'Session',
    system: 'MARKET',
    direction: directionLabel(firstValue(signal?.session, components.session?.direction, 'active')),
    score: getScore(signal?.sessionScore, components.session?.score, 100),
    confidence: getScore(signal?.sessionScore, components.session?.confidence, 100),
    status: normalizeStatus(firstValue(components.session?.status, 'active')),
    details: formatDetails([components.session?.reason, signal?.sessionName, 'Session filter active']),
  })

  addRow(rows, {
    key: 'market-sentiment',
    source: 'Market Sentiment Gauge (12 Indicators)',
    system: 'MARKET',
    direction: directionLabel(firstValue(technicalSentiment?.sentimentStatus, signal?.technicalSentiment?.sentimentStatus, 'active')),
    score: getScore(technicalSentiment?.sentiment, signal?.technicalSentiment?.sentiment, signal?.technicalScore),
    confidence: getScore(technicalSentiment?.confidence, technicalSentiment?.sentiment, signal?.technicalScore),
    status: normalizeStatus(firstValue(technicalSentiment ? 'active' : null, 'waiting')),
    details: formatDetails(['Main chart only', `Indicators ${firstValue(technicalSentiment?.activeCount, technicalSentiment?.indicators?.length, 0)}`, technicalSentiment?.sentimentLabel]),
  })

  const externalRows = [
    ['options-flow', 'Options Flow', components.optionsFlow, signal?.optionsFlowDirection, signal?.optionsFlowScore, 'Options flow source available'],
    ['open-interest', 'Open Interest', components.openInterest, signal?.openInterestDirection, signal?.openInterestScore, 'Open interest unavailable'],
    ['footprint-delta', 'Footprint Delta', components.footprint, signal?.footprintDirection, signal?.footprintScore, 'Footprint feed unavailable'],
    ['fred-macro', 'FRED Macro', components.fred, signal?.fredDirection, signal?.fredScore, 'Macro context active'],
    ['finra-short-volume', 'FINRA Short Volume', components.finra, signal?.finraDirection, signal?.finraScore, 'Short volume feed unavailable'],
    ['cot', 'COT', components.cot, signal?.cotDirection, signal?.cotScore, 'COT feed unavailable'],
  ] as const

  externalRows.forEach(([key, source, item, fallbackDirection, fallbackScore, fallbackDetails]) => {
    addRow(rows, {
      key,
      source,
      system: 'EXTERNAL',
      direction: directionLabel(firstValue(item?.direction, fallbackDirection, item ? 'active' : 'inactive')),
      score: getScore(item?.score, fallbackScore),
      confidence: getScore(item?.confidence, item?.score, fallbackScore),
      status: normalizeStatus(firstValue(item?.status, item ? 'active' : 'unavailable')),
      details: formatDetails([item?.reason, item?.detail, fallbackDetails]),
    })
  })

  addRow(rows, {
    key: 'ml-features',
    source: 'ML Features',
    system: 'ML',
    direction: directionLabel(firstValue(mlFeatures?.overallDirection, signal?.mlDirection, 'active')),
    score: getScore(mlFeatures?.overallConfirmationScore, signal?.mlScore),
    confidence: getScore(mlFeatures?.confidence, mlFeatures?.overallConfirmationScore, signal?.mlConfidence),
    status: normalizeStatus(firstValue(mlFeatures ? 'active' : null, 'waiting')),
    details: formatDetails([`Features ${Object.keys(mlFeatures ?? {}).length}`, mlFeatures?.mlHierarchy, 'NRTR strategy feeds are separated from ML hierarchy']),
  })

  return rows
}

function summarizeRows(rows: MatrixRow[]): MatrixSummary {
  const active = rows.filter((row) => normalizeDirection(row.status) === 'active' || String(row.status).toLowerCase() === 'active').length
  const bullish = rows.filter((row) => normalizeDirection(row.direction) === 'bullish').length
  const bearish = rows.filter((row) => normalizeDirection(row.direction) === 'bearish').length
  const avgConfidenceValues = rows
    .map((row) => row.confidence ?? row.score)
    .filter((value): value is number => Number.isFinite(Number(value)))

  const avgConfidence = avgConfidenceValues.length
    ? Math.round(avgConfidenceValues.reduce((sum, value) => sum + Number(value), 0) / avgConfidenceValues.length)
    : 0

  const bias = bearish > bullish ? 'Bearish' : bullish > bearish ? 'Bullish' : 'Neutral'

  return {
    active,
    bullish,
    bearish,
    avgConfidence,
    bias,
  }
}

export default function UnifiedIntelligenceMatrix(props: UnifiedIntelligenceMatrixProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const rows = useMemo(() => buildRows(props), [props.signal, props.unifiedIntelligence, props.overlayPayload, props.scorecards, props.mlFeatures, props.technicalSentiment])
  const summary = useMemo(() => summarizeRows(rows), [rows])
  const visibleRowCount = isExpanded ? rows.length : 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/80 p-6 shadow-lg"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Unified Intelligence Matrix</h2>
          <p className="mt-1 text-xs text-gray-500">
            Phase 6 unified projection engine • collapsed by default to prevent duplicate dashboard detail •{' '}
            {props.activeSymbol ?? props.signal?.symbol ?? 'MES1!'} • {props.activeTimeframe ?? props.signal?.activeTimeframe ?? props.signal?.timeframe ?? '1m'}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setIsExpanded((value) => !value)}
            className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase tracking-wide text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-400/20"
          >
            {isExpanded ? 'Collapse technicals' : `Expand technicals (${rows.length})`}
          </button>

          <div className="rounded-lg border border-dark-600 bg-dark-900/60 px-3 py-2 text-right">
            <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Overall Bias</p>
            <p className={`text-sm font-bold ${directionClass(summary.bias)}`}>{summary.bias}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryCard label="Avg Confidence" value={`${summary.avgConfidence}%`} tone="cyan" />
        <SummaryCard label="Active" value={summary.active} tone="emerald" />
        <SummaryCard label="Bullish" value={summary.bullish} tone="emerald" />
        <SummaryCard label="Bearish" value={summary.bearish} tone="red" />
        <SummaryCard label="Total Sources" value={rows.length} tone="white" />
      </div>

      {!isExpanded && (
        <div className="mt-4 rounded-lg border border-dark-700 bg-dark-900/40 px-4 py-3 text-xs text-gray-400">
          Technical/source details are collapsed. Expand only when you want to inspect every feed. This keeps the dashboard from repeating the same information already shown in the sentiment, brain, chart, ghost, and AI trader tables.
        </div>
      )}

      {isExpanded && (
        <div className="mt-4 overflow-hidden rounded-lg border border-dark-700">
          <div className="grid grid-cols-[1.15fr_0.75fr_0.75fr_0.9fr_2.3fr] gap-0 border-b border-dark-700 bg-dark-900/70 px-4 py-3 text-[10px] uppercase tracking-[0.16em] text-gray-500">
            <div>Source</div>
            <div>Status</div>
            <div>Score</div>
            <div>Direction</div>
            <div>Details</div>
          </div>

          <div className="divide-y divide-dark-700">
            {rows.slice(0, visibleRowCount).map((row) => {
              const score = row.score ?? row.confidence ?? 0

              return (
                <div
                  key={row.key}
                  className="grid grid-cols-[1.15fr_0.75fr_0.75fr_0.9fr_2.3fr] items-center gap-0 px-4 py-3 text-xs"
                >
                  <div>
                    <p className="font-semibold text-gray-100">{row.source}</p>
                    {row.system && (
                      <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-gray-600">{row.system}</p>
                    )}
                  </div>

                  <div>
                    <span className={`rounded border px-2 py-1 text-[10px] font-bold ${badgeClass(row.status)}`}>
                      {row.status}
                    </span>
                  </div>

                  <div className="pr-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-dark-600">
                        <div
                          className={`h-full rounded-full ${scoreBarClass(row.direction)}`}
                          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                        />
                      </div>
                      <span className="w-8 text-right font-bold text-gray-200">{Math.round(score)}%</span>
                    </div>
                  </div>

                  <div className={`font-bold ${directionClass(row.direction)}`}>{row.direction}</div>

                  <div className="truncate text-gray-400" title={row.details}>{row.details || '—'}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-dark-700 bg-dark-900/50 px-3 py-2 text-xs text-gray-500">
        Builder: MARKETBOS Phase 6 unified matrix. Top summary stays visible; technical feed rows are collapsible to reduce duplicated dashboard information.
      </div>
    </motion.div>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: string | number; tone: 'cyan' | 'emerald' | 'red' | 'white' }) {
  const toneClass =
    tone === 'cyan' ? 'text-cyan-300' :
    tone === 'emerald' ? 'text-emerald-300' :
    tone === 'red' ? 'text-red-300' :
    'text-white'

  return (
    <div className="rounded-lg bg-dark-900/50 p-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${toneClass}`}>{value}</p>
    </div>
  )
}
