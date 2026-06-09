'use client'

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
  direction: string
  score: number | null
  confidence: number | null
  status: string
  details: string
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clampPercent(value: unknown, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const normalized = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed
  return Math.max(0, Math.min(100, Math.round(normalized)))
}

function normalizeDirection(value: unknown): 'bullish' | 'bearish' | 'neutral' | 'active' | 'inactive' | 'pending' {
  const text = String(value ?? '').toLowerCase()

  if (text.includes('bull') || text.includes('buy') || text.includes('long') || text.includes('demand')) {
    return 'bullish'
  }

  if (text.includes('bear') || text.includes('sell') || text.includes('short') || text.includes('supply')) {
    return 'bearish'
  }

  if (text.includes('active') || text.includes('open') || text.includes('live')) return 'active'
  if (text.includes('inactive') || text.includes('disabled') || text.includes('unavailable')) return 'inactive'
  if (text.includes('pending') || text.includes('waiting') || text.includes('not_wired')) return 'pending'

  return 'neutral'
}

function directionLabel(value: unknown) {
  const direction = normalizeDirection(value)
  if (direction === 'bullish') return 'Bullish'
  if (direction === 'bearish') return 'Bearish'
  if (direction === 'active') return 'Active'
  if (direction === 'inactive') return 'Inactive'
  if (direction === 'pending') return 'Pending'
  return 'Neutral'
}

function directionClass(value: unknown) {
  const direction = normalizeDirection(value)

  if (direction === 'bullish' || direction === 'active') return 'text-emerald-400'
  if (direction === 'bearish' || direction === 'inactive') return 'text-red-400'
  if (direction === 'pending') return 'text-yellow-300'

  return 'text-gray-300'
}

function badgeClass(value: unknown) {
  const direction = normalizeDirection(value)

  if (direction === 'bullish' || direction === 'active') {
    return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
  }

  if (direction === 'bearish' || direction === 'inactive') {
    return 'border-red-400/30 bg-red-400/10 text-red-300'
  }

  if (direction === 'pending') {
    return 'border-yellow-400/30 bg-yellow-400/10 text-yellow-300'
  }

  return 'border-dark-600 bg-dark-900/60 text-gray-300'
}

function getPath(source: any, path: string, fallback?: any) {
  const parts = path.split('.')
  let current = source

  for (const part of parts) {
    if (!current || typeof current !== 'object') return fallback
    current = current[part]
  }

  return current ?? fallback
}

function firstValue(...values: unknown[]) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value
  }

  return undefined
}

function getScore(...values: unknown[]) {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return clampPercent(parsed)
  }

  return null
}

function formatNumber(value: unknown, digits = 2) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'

  if (Math.abs(parsed) >= 1000) {
    return parsed.toLocaleString(undefined, { maximumFractionDigits: digits })
  }

  return parsed.toFixed(digits)
}

function formatPrice(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return '—'

  if (Math.abs(parsed) >= 1000) {
    return parsed.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }

  if (Math.abs(parsed) >= 100) return parsed.toFixed(2)
  if (Math.abs(parsed) >= 10) return parsed.toFixed(3)
  return parsed.toFixed(4)
}

function formatDetails(parts: Array<string | number | null | undefined | false>) {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== false && String(part).trim() !== '')
    .map((part) => String(part))
    .join(' • ')
}

function scoreBarClass(value: unknown) {
  const direction = normalizeDirection(value)
  if (direction === 'bullish' || direction === 'active') return 'bg-emerald-400'
  if (direction === 'bearish' || direction === 'inactive') return 'bg-red-400'
  if (direction === 'pending') return 'bg-yellow-300'
  return 'bg-blue-400'
}

function normalizeStatus(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return 'Active'

  if (text.includes('_')) {
    return text
      .split('_')
      .map((item) => item.charAt(0).toUpperCase() + item.slice(1).toLowerCase())
      .join(' ')
  }

  return text.charAt(0).toUpperCase() + text.slice(1)
}

function getGhostCandles(unifiedIntelligence: any): any[] {
  const candidates = [
    getPath(unifiedIntelligence, 'ghostProjection.candles'),
    getPath(unifiedIntelligence, 'ghostProjection.projections'),
    getPath(unifiedIntelligence, 'components.ghost.candles'),
    getPath(unifiedIntelligence, 'components.ghost.projections'),
    unifiedIntelligence?.ghostCandles,
    unifiedIntelligence?.ghostProjections,
    unifiedIntelligence?.projections,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate
  }

  return []
}

function normalizeGhostDirectionValue(value: unknown): 'bullish' | 'bearish' | 'neutral' | null {
  const text = String(value ?? '').toLowerCase()

  if (!text) return null

  if (
    text.includes('bull') ||
    text.includes('buy') ||
    text.includes('long') ||
    text.includes('up') ||
    text.includes('demand')
  ) {
    return 'bullish'
  }

  if (
    text.includes('bear') ||
    text.includes('sell') ||
    text.includes('short') ||
    text.includes('down') ||
    text.includes('supply')
  ) {
    return 'bearish'
  }

  if (text.includes('neutral') || text.includes('mixed') || text.includes('waiting')) return 'neutral'

  return null
}

function inferGhostDirectionFromCandles(candles: any[]): 'bullish' | 'bearish' | 'neutral' | null {
  if (!Array.isArray(candles) || candles.length === 0) return null

  const firstDirectional = candles
    .map((candle) =>
      normalizeGhostDirectionValue(
        firstValue(
          candle?.direction,
          candle?.signal,
          candle?.side,
          candle?.bias,
          candle?.label,
          candle?.targetReaction,
          candle?.reason
        )
      )
    )
    .find((direction) => direction === 'bullish' || direction === 'bearish')

  if (firstDirectional) return firstDirectional

  let bullish = 0
  let bearish = 0

  for (const candle of candles) {
    const open = Number(candle?.open ?? candle?.o)
    const close = Number(candle?.close ?? candle?.c)

    if (Number.isFinite(open) && Number.isFinite(close)) {
      if (close > open) bullish += 1
      else if (close < open) bearish += 1
    }
  }

  if (bullish > bearish) return 'bullish'
  if (bearish > bullish) return 'bearish'

  return null
}

function averageGhostConfidence(candles: any[]): number | null {
  const values = candles
    .map((candle) => Number(candle?.confidence ?? candle?.score ?? candle?.probability))
    .filter((value) => Number.isFinite(value) && value > 0)

  if (values.length === 0) return null

  return clampPercent(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function getGhostProjection(unifiedIntelligence: any, scorecards: any) {
  const candles = getGhostCandles(unifiedIntelligence)
  const candle = getPath(unifiedIntelligence, 'ghostProjection.candles.0', null) ?? candles[0] ?? null
  const inferredDirection = inferGhostDirectionFromCandles(candles)
  const projectionDirection = normalizeGhostDirectionValue(
    firstValue(
      candle?.direction,
      candle?.signal,
      candle?.side,
      candle?.bias,
      getPath(unifiedIntelligence, 'ghostProjection.direction'),
      getPath(unifiedIntelligence, 'ghostProjection.bias'),
      getPath(unifiedIntelligence, 'components.ghost.direction')
    )
  )
  const scorecardDirection = normalizeGhostDirectionValue(scorecards?.ghost?.direction)
  const direction = firstValue(
    projectionDirection && projectionDirection !== 'neutral' ? projectionDirection : undefined,
    inferredDirection,
    scorecardDirection,
    projectionDirection,
    'neutral'
  )
  const confidence = getScore(
    candle?.confidence,
    getPath(unifiedIntelligence, 'ghostProjection.confidence'),
    averageGhostConfidence(candles),
    getPath(unifiedIntelligence, 'components.ghost.confidence'),
    scorecards?.ghost?.confidence
  )

  return { candle, candles, direction, confidence }
}

function extractExternalItems(unifiedIntelligence: any, signal: any, overlayPayload: any): any[] {
  const candidates = [
    getPath(unifiedIntelligence, 'components.external.items'),
    getPath(unifiedIntelligence, 'external.items'),
    getPath(unifiedIntelligence, 'externalFactors.items'),
    unifiedIntelligence?.externalFactors,
    signal?.externalFactors,
    signal?.externalData,
    overlayPayload?.externalFactors,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }

  return []
}

function externalRow(
  key: string,
  label: string,
  aliases: string[],
  items: any[],
  fallback?: Partial<MatrixRow>
): MatrixRow {
  const lowerAliases = aliases.map((item) => item.toLowerCase())
  const item = items.find((entry) => {
    const haystack = [
      entry?.key,
      entry?.name,
      entry?.label,
      entry?.source,
      entry?.type,
    ]
      .map((value) => String(value ?? '').toLowerCase())
      .join(' ')

    return lowerAliases.some((alias) => haystack.includes(alias))
  })

  const direction = firstValue(item?.direction, item?.status, fallback?.direction, 'inactive')
  const score = getScore(item?.strength, item?.score, item?.value, fallback?.score ?? 0)
  const confidence = getScore(item?.confidence, item?.quality, item?.strength, fallback?.confidence ?? score ?? 0)
  const status = normalizeStatus(firstValue(item?.status, fallback?.status, item ? 'active' : 'inactive'))

  return {
    key,
    source: label,
    direction: directionLabel(direction),
    score,
    confidence,
    status,
    details: formatDetails([
      item?.reason,
      item?.source,
      item?.label && item.label !== label ? item.label : null,
      fallback?.details,
    ]) || (item ? 'Live external source available' : 'No active value from source'),
  }
}

function buildRows({
  signal,
  unifiedIntelligence,
  overlayPayload,
  scorecards,
  mlFeatures,
  technicalSentiment,
}: UnifiedIntelligenceMatrixProps): MatrixRow[] {
  const rows: MatrixRow[] = []
  const components = unifiedIntelligence?.components ?? {}
  const externalItems = extractExternalItems(unifiedIntelligence, signal, overlayPayload)
  const ghost = getGhostProjection(unifiedIntelligence, scorecards)

  const smcDirection = firstValue(components.smc?.direction, scorecards?.overall?.direction, signal?.smc)
  rows.push({
    key: 'smc',
    source: 'SMC Structure',
    direction: directionLabel(smcDirection),
    score: getScore(components.smc?.score, scorecards?.smc?.qualityScore, signal?.smcScore),
    confidence: getScore(components.smc?.confidence, scorecards?.smc?.qualityScore, signal?.smcQuality),
    status: normalizeStatus(firstValue(components.smc?.status, 'active')),
    details: formatDetails([
      components.smc?.latestStructure ?? signal?.latestStructure,
      `Events ${firstValue(components.smc?.eventCount, scorecards?.activeFactors?.smcEvents, scorecards?.smc?.bullishEvents) ?? 0}`,
      components.smc?.reason,
    ]),
  })

  rows.push({
    key: 'alphax',
    source: 'AlphaX DLM / Profile',
    direction: directionLabel(firstValue(components.liquidity?.direction, scorecards?.liquidityProfile?.direction, signal?.alphaXBias)),
    score: getScore(components.liquidity?.score, scorecards?.liquidityProfile?.qualityScore, signal?.liquidityProfileQuality),
    confidence: getScore(components.liquidity?.confidence, scorecards?.liquidityProfile?.qualityScore),
    status: normalizeStatus(firstValue(components.liquidity?.status, 'active')),
    details: formatDetails([
      components.liquidity?.reason,
      `Profile bins ${firstValue(components.liquidity?.liquidityProfileBinCount, scorecards?.liquidityProfile?.profileBinCount, 0)}`,
      `DLM ${firstValue(components.liquidity?.dlmLevelCount, scorecards?.activeFactors?.profileBins, 0)}`,
    ]),
  })

  rows.push({
    key: 'order-blocks',
    source: 'Order Blocks',
    direction: directionLabel(firstValue(scorecards?.orderBlocks?.direction, scorecards?.overall?.direction, components.smc?.direction)),
    score: getScore(scorecards?.orderBlocks?.qualityScore, signal?.orderBlockQuality),
    confidence: getScore(scorecards?.orderBlocks?.qualityScore, signal?.orderBlockQuality),
    status: normalizeStatus(firstValue(scorecards?.orderBlocks ? 'active' : null, 'active')),
    details: formatDetails([
      `Bullish ${firstValue(scorecards?.orderBlocks?.bullishZones, 0)}`,
      `Bearish ${firstValue(scorecards?.orderBlocks?.bearishZones, 0)}`,
      `Zones ${firstValue(scorecards?.activeFactors?.orderBlocks, 0)}`,
    ]),
  })

  const ghostCount = firstValue(
    getPath(unifiedIntelligence, 'ghostProjection.candles.length'),
    Array.isArray(ghost.candles) ? ghost.candles.length : undefined,
    scorecards?.ghost?.count,
    0
  )
  const ghostIsActive = Boolean(
    Number(ghostCount) > 0 ||
      ghost.confidence ||
      normalizeGhostDirectionValue(ghost.direction) === 'bullish' ||
      normalizeGhostDirectionValue(ghost.direction) === 'bearish'
  )

  rows.push({
    key: 'ghost',
    source: 'Python Ghost Candles',
    direction: directionLabel(ghost.direction),
    score: ghost.confidence,
    confidence: ghost.confidence,
    status: normalizeStatus(ghostIsActive ? 'active' : firstValue(getPath(unifiedIntelligence, 'ghostProjection.status'), components.ghost?.status, 'waiting')),
    details: formatDetails([
      getPath(unifiedIntelligence, 'ghostProjection.reason'),
      ghost.candle?.targetReaction,
      `Projections ${ghostCount}`,
    ]),
  })

  const nrtrDirectionValue = toNumber(mlFeatures?.nrtrDirection, 0)
  const nrtrDirectionFromFeatures =
    nrtrDirectionValue > 0 ? 'bullish' : nrtrDirectionValue < 0 ? 'bearish' : undefined
  const nrtrIsActive = Boolean(
    scorecards?.nrtr ||
      nrtrDirectionFromFeatures ||
      Number.isFinite(Number(scorecards?.nrtr?.barsInTrend)) ||
      Number.isFinite(Number(scorecards?.nrtr?.distancePercent)) ||
      Number.isFinite(Number(components.nrtr?.barsInTrend)) ||
      Number.isFinite(Number(components.nrtr?.distancePercent))
  )

  rows.push({
    key: 'nrtr',
    source: 'NRTR',
    direction: directionLabel(firstValue(scorecards?.nrtr?.direction, nrtrDirectionFromFeatures, components.nrtr?.direction)),
    score: getScore(scorecards?.nrtr?.distancePercent, components.nrtr?.distancePercent, components.nrtr?.score),
    confidence: getScore(
      Math.abs(nrtrDirectionValue) * 100 || undefined,
      components.nrtr?.confidence,
      scorecards?.nrtr?.distancePercent
    ),
    status: normalizeStatus(nrtrIsActive ? 'active' : firstValue(components.nrtr?.status, 'waiting')),
    details: formatDetails([
      `Bars ${firstValue(scorecards?.nrtr?.barsInTrend, components.nrtr?.barsInTrend, 0)}`,
      `Distance ${formatNumber(firstValue(scorecards?.nrtr?.distancePercent, components.nrtr?.distancePercent, 0), 2)}%`,
      `Locked ${formatNumber(firstValue(scorecards?.nrtr?.lockedProfit, components.nrtr?.lockedProfit, 0), 2)}`,
    ]),
  })

  rows.push({
    key: 'smma',
    source: 'SMMA',
    direction: directionLabel(firstValue(components.smma?.direction, components.smma?.signal, 'neutral')),
    score: getScore(components.smma?.score, components.smma?.distancePercent),
    confidence: getScore(components.smma?.confidence, components.smma?.score),
    status: normalizeStatus(firstValue(components.smma?.status, 'active')),
    details: formatDetails([
      components.smma?.reason,
      components.smma?.length ? `Length ${components.smma.length}` : null,
      components.smma?.distancePercent ? `Distance ${formatNumber(components.smma.distancePercent, 2)}%` : null,
    ]) || 'Chart-level SMMA direction is available on each chart',
  })

  rows.push({
    key: 'session',
    source: 'Session',
    direction: directionLabel(firstValue(signal?.session, components.session?.direction, 'active')),
    score: getScore(signal?.sessionScore, components.session?.score, 100),
    confidence: getScore(signal?.sessionScore, components.session?.confidence, 100),
    status: normalizeStatus(firstValue(components.session?.status, 'active')),
    details: formatDetails([components.session?.reason, signal?.sessionDetails]) || 'Session filter active',
  })

  rows.push(externalRow('options', 'Options Flow', ['options', 'option flow'], externalItems, {
    direction: signal?.optionsFlow ?? 'inactive',
    score: signal?.optionsFlowStrength ?? 0,
    confidence: signal?.optionsBullPressure ?? signal?.optionsFlowStrength ?? 0,
    details: signal?.optionsFlowReason,
  }))

  rows.push(externalRow('open-interest', 'Open Interest', ['open interest', 'openinterest'], externalItems, {
    direction: signal?.openInterest ?? 'inactive',
    score: signal?.openInterestStrength ?? 0,
    confidence: signal?.openInterestStrength ?? 0,
    details: signal?.openInterestReason,
  }))

  rows.push(externalRow('footprint', 'Footprint Delta', ['footprint', 'delta', 'quote pressure'], externalItems, {
    direction: signal?.footprint ?? 'inactive',
    score: signal?.footprintStrength ?? 0,
    confidence: signal?.footprintStrength ?? 0,
    details: signal?.footprintReason,
  }))

  rows.push(externalRow('fred', 'FRED Macro', ['fred', 'macro'], externalItems, {
    direction: signal?.fredMacro ?? 'neutral',
    score: signal?.fredMacroStrength ?? 0,
    confidence: signal?.fredMacroStrength ?? 0,
    details: signal?.fredMacroReason,
  }))

  rows.push(externalRow('finra', 'FINRA Short Volume', ['finra', 'short volume'], externalItems, {
    direction: signal?.finraShortVolume ?? 'inactive',
    score: signal?.finraShortVolumeStrength ?? 0,
    confidence: signal?.finraShortVolumeStrength ?? 0,
    details: signal?.finraShortVolumeReason ?? 'Equity source only when available',
  }))

  rows.push(externalRow('cot', 'COT', ['cot', 'commitment'], externalItems, {
    direction: signal?.cot ?? 'pending',
    score: signal?.cotStrength ?? 0,
    confidence: signal?.cotStrength ?? 0,
    details: signal?.cotReason ?? 'CFTC COT pending',
  }))

  const mlFeatureCount =
    firstValue(
      components.ml?.featureCount,
      unifiedIntelligence?.featureVector ? Object.keys(unifiedIntelligence.featureVector).length : undefined,
      mlFeatures ? Object.keys(mlFeatures).length : undefined,
      signal?.mlFeatureCount
    ) ?? 0

  const technicalIndicatorCount = firstValue(
    technicalSentiment?.activeCount,
    technicalSentiment?.indicators?.length,
    technicalSentiment?.technicalIndicators?.length,
    technicalSentiment?.technicalMeter?.length,
    0
  )
  const mlIsActive = Boolean(
    Number(mlFeatureCount) > 0 ||
      Number(technicalIndicatorCount) > 0 ||
      scorecards?.overall ||
      mlFeatures ||
      unifiedIntelligence?.aiTrader
  )

  rows.push({
    key: 'ml',
    source: 'ML Features',
    direction: directionLabel(firstValue(scorecards?.overall?.direction, unifiedIntelligence?.aiTrader?.direction, components.ml?.direction)),
    score: getScore(scorecards?.overall?.confirmationScore, unifiedIntelligence?.aiTrader?.confidence, components.ml?.score),
    confidence: getScore(scorecards?.overall?.confirmationScore, unifiedIntelligence?.aiTrader?.confidence, components.ml?.confidence),
    status: normalizeStatus(mlIsActive ? 'active' : firstValue(components.ml?.status, 'waiting')),
    details: formatDetails([
      `Features ${mlFeatureCount}`,
      `Net ${formatNumber(firstValue(unifiedIntelligence?.aiTrader?.netScore, scorecards?.overall?.netBias, 0), 2)}`,
      `Technical indicators ${technicalIndicatorCount}`,
    ]),
  })

  return rows
}

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: 'bull' | 'bear' | 'warn' | 'neutral'
}) {
  const color =
    accent === 'bull'
      ? 'text-emerald-300'
      : accent === 'bear'
        ? 'text-red-300'
        : accent === 'warn'
          ? 'text-yellow-300'
          : 'text-white'

  return (
    <div className="rounded-xl border border-dark-700 bg-dark-900/60 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className={`mt-1 text-lg font-bold ${color}`}>{value}</div>
    </div>
  )
}

function MatrixRowView({ row }: { row: MatrixRow }) {
  const score = row.score ?? row.confidence ?? 0

  return (
    <tr className="border-b border-dark-700/70 align-top">
      <td className="py-4 pr-4">
        <div className="font-semibold text-white">{row.source}</div>
        <div className={`mt-1 text-[10px] font-bold uppercase tracking-wide ${directionClass(row.direction)}`}>
          {row.direction}
        </div>
      </td>

      <td className="py-4 pr-4">
        <span className={`inline-flex rounded-lg border px-2 py-1 text-xs font-bold ${badgeClass(row.direction)}`}>
          {row.status}
        </span>
      </td>

      <td className="py-4 pr-4">
        <div className="flex items-center gap-2">
          <div className="h-2 min-w-[96px] flex-1 overflow-hidden rounded-full bg-dark-700">
            <div
              className={`h-full rounded-full ${scoreBarClass(row.direction)}`}
              style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
            />
          </div>
          <div className="w-12 text-right text-xs font-bold text-white">
            {row.score === null ? '—' : `${Math.round(score)}%`}
          </div>
        </div>
      </td>

      <td className="py-4 pr-4 text-xs leading-relaxed text-gray-400">
        {row.details || '—'}
      </td>
    </tr>
  )
}

export default function UnifiedIntelligenceMatrix({
  signal,
  unifiedIntelligence,
  overlayPayload,
  scorecards,
  mlFeatures,
  technicalSentiment,
  activeSymbol,
  activeTimeframe,
  activePrice,
}: UnifiedIntelligenceMatrixProps) {
  const rows = buildRows({
    signal,
    unifiedIntelligence,
    overlayPayload,
    scorecards,
    mlFeatures,
    technicalSentiment,
    activeSymbol,
    activeTimeframe,
    activePrice,
  })

  const ghost = getGhostProjection(unifiedIntelligence, scorecards)
  const overallDirection = firstValue(
    unifiedIntelligence?.marketSentiment?.label,
    unifiedIntelligence?.marketSentiment?.direction,
    unifiedIntelligence?.aiTrader?.direction,
    scorecards?.overall?.direction,
    signal?.technical,
    signal?.signal,
    'neutral'
  )

  const bullPressure = getScore(
    signal?.bullPressure,
    signal?.bullScore,
    getPath(unifiedIntelligence, 'marketSentiment.bullScore'),
    scorecards?.overall?.bullScore
  ) ?? 0

  const bearPressure = getScore(
    signal?.bearPressure,
    signal?.bearScore,
    getPath(unifiedIntelligence, 'marketSentiment.bearScore'),
    scorecards?.overall?.bearScore
  ) ?? 0

  const confirmation = getScore(
    signal?.confidence,
    getPath(unifiedIntelligence, 'aiTrader.confidence'),
    scorecards?.overall?.confirmationScore
  ) ?? 0

  const conflict = getScore(signal?.conflictRisk, scorecards?.overall?.conflictScore, getPath(unifiedIntelligence, 'aiTrader.conflictScore')) ?? 0
  const netBias = toNumber(firstValue(signal?.netBias, scorecards?.overall?.netBias, getPath(unifiedIntelligence, 'aiTrader.netScore')), 0)
  const activeCount = rows.filter((row) => !['Inactive', 'Pending'].includes(row.status)).length
  const bullishCount = rows.filter((row) => normalizeDirection(row.direction) === 'bullish' || normalizeDirection(row.direction) === 'active').length
  const bearishCount = rows.filter((row) => normalizeDirection(row.direction) === 'bearish').length

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/80 p-5 shadow-xl"
    >
      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Unified Intelligence Matrix</h2>
          <p className="mt-1 text-xs text-gray-500">
            Combined SMC, AlphaX, Ghost, NRTR, SMMA, external data, pressure, and ML context •{' '}
            {activeSymbol ?? signal?.symbol ?? 'Chart'} • {activeTimeframe ?? signal?.timeframe ?? 'TF'}
          </p>
        </div>

        <div className={`rounded-xl border px-4 py-3 text-right ${badgeClass(overallDirection)}`}>
          <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
            Combined Bias
          </div>
          <div className="text-lg font-black">{directionLabel(overallDirection)}</div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <SummaryTile label="Price" value={formatPrice(activePrice ?? signal?.current ?? signal?.price)} />
        <SummaryTile label="Confidence" value={`${confirmation}%`} accent={confirmation >= 60 ? 'bull' : confirmation <= 40 ? 'bear' : 'warn'} />
        <SummaryTile label="Bull pressure" value={`${bullPressure}%`} accent="bull" />
        <SummaryTile label="Bear pressure" value={`${bearPressure}%`} accent="bear" />
        <SummaryTile label="Net bias" value={`${netBias > 0 ? '+' : ''}${formatNumber(netBias, 1)}`} accent={netBias > 0 ? 'bull' : netBias < 0 ? 'bear' : 'neutral'} />
        <SummaryTile label="Ghost" value={`${ghost.confidence ?? 0}%`} accent={normalizeDirection(ghost.direction) === 'bullish' ? 'bull' : normalizeDirection(ghost.direction) === 'bearish' ? 'bear' : 'neutral'} />
        <SummaryTile label="Conflict" value={`${conflict}%`} accent={conflict >= 50 ? 'bear' : conflict >= 25 ? 'warn' : 'bull'} />
        <SummaryTile label="Active" value={`${activeCount}/${rows.length}`} accent={bullishCount > bearishCount ? 'bull' : bearishCount > bullishCount ? 'bear' : 'neutral'} />
      </div>

      <div className="mb-4 grid grid-cols-3 overflow-hidden rounded-xl border border-dark-700 bg-dark-900/50 text-center">
        <div className="p-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Active</div>
          <div className="text-lg font-bold text-white">{activeCount}</div>
        </div>
        <div className="border-x border-dark-700 p-3">
          <div className="text-[10px] uppercase tracking-wide text-red-300">Bear</div>
          <div className="text-lg font-bold text-red-300">{bearishCount}</div>
        </div>
        <div className="p-3">
          <div className="text-[10px] uppercase tracking-wide text-emerald-300">Bull</div>
          <div className="text-lg font-bold text-emerald-300">{bullishCount}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[940px] text-left text-sm">
          <thead>
            <tr className="border-b border-dark-700 text-[10px] uppercase tracking-wide text-gray-500">
              <th className="py-3 pr-4">Source</th>
              <th className="py-3 pr-4">Status</th>
              <th className="py-3 pr-4">Score</th>
              <th className="py-3 pr-4">Details</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <MatrixRowView key={row.key} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-lg border border-dark-700 bg-dark-900/40 px-3 py-2 text-xs text-gray-500">
        Bull/Bear balance: {bullPressure}% / {bearPressure}% • External rows use live backend source data when available • Matrix removes duplicate panels without dropping their values.
      </div>
    </motion.div>
  )
}
