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
  system?: string
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

function firstValue(...values: unknown[]) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value
  }

  return undefined
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
  if (text.includes('pending') || text.includes('waiting') || text.includes('not_wired') || text.includes('learning')) return 'pending'

  return 'neutral'
}

function directionLabel(value: unknown) {
  const direction = normalizeDirection(value)

  if (direction === 'bullish') return 'Bullish'
  if (direction === 'bearish') return 'Bearish'
  if (direction === 'active') return 'Active'
  if (direction === 'inactive') return 'Inactive'
  if (direction === 'pending') return 'Waiting'

  return 'Neutral'
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

function scoreBarClass(value: unknown) {
  const direction = normalizeDirection(value)

  if (direction === 'bullish' || direction === 'active') return 'bg-emerald-400'
  if (direction === 'bearish' || direction === 'inactive') return 'bg-red-400'
  if (direction === 'pending') return 'bg-yellow-300'

  return 'bg-blue-400'
}

function formatNumber(value: unknown, digits = 2) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'

  if (Math.abs(parsed) >= 1000) {
    return parsed.toLocaleString(undefined, { maximumFractionDigits: digits })
  }

  return parsed.toFixed(digits)
}

function formatDetails(parts: Array<string | number | null | undefined | false>) {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== false && String(part).trim() !== '')
    .map((part) => String(part))
    .join(' • ')
}

function getScore(...values: unknown[]) {
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

function getGhostCandles(unifiedIntelligence: any, overlayPayload: any, scorecards: any): any[] {
  const candidates = [
    getPath(unifiedIntelligence, 'ghostProjection.candles'),
    getPath(unifiedIntelligence, 'ghostProjection.projections'),
    getPath(unifiedIntelligence, 'components.ghost.candles'),
    getPath(unifiedIntelligence, 'components.ghost.projections'),
    unifiedIntelligence?.ghostCandles,
    unifiedIntelligence?.ghostProjections,
    unifiedIntelligence?.projections,
    overlayPayload?.ghostCandles,
    scorecards?.ghost?.ghostCandles,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate
  }

  return []
}

function inferGhostDirection(candles: any[], fallback: unknown) {
  const text = String(fallback ?? '').toLowerCase()
  if (text.includes('bull') || text.includes('buy') || text.includes('up')) return 'bullish'
  if (text.includes('bear') || text.includes('sell') || text.includes('down')) return 'bearish'

  let bullish = 0
  let bearish = 0

  for (const candle of candles) {
    const open = Number(candle?.open ?? candle?.o)
    const close = Number(candle?.close ?? candle?.c)
    if (!Number.isFinite(open) || !Number.isFinite(close)) continue
    if (close > open) bullish += 1
    if (close < open) bearish += 1
  }

  if (bullish > bearish) return 'bullish'
  if (bearish > bullish) return 'bearish'
  return 'neutral'
}

function averageGhostConfidence(candles: any[]): number | null {
  const values = candles
    .map((candle) => Number(candle?.confidence ?? candle?.score ?? candle?.probability))
    .filter((value) => Number.isFinite(value) && value > 0)

  if (values.length === 0) return null

  return clampPercent(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function getSmcRow(signal: any, unifiedIntelligence: any, overlayPayload: any, scorecards: any): MatrixRow {
  const components = unifiedIntelligence?.components ?? {}
  const smcEvents = getArrayPath(
    components.smc?.events,
    components.smc?.smcEvents,
    unifiedIntelligence?.smcEvents,
    overlayPayload?.smcEvents,
    overlayPayload?.lines,
    scorecards?.smc?.events,
    signal?.smcEvents
  )

  const latestEvent = smcEvents.length ? smcEvents[smcEvents.length - 1] : null
  const direction = firstValue(
    latestEvent?.direction,
    latestEvent?.bias,
    latestEvent?.side,
    latestEvent?.label,
    components.smc?.direction,
    scorecards?.smc?.direction,
    scorecards?.overall?.direction,
    signal?.smc
  )

  const score = getScore(
    components.smc?.score,
    components.smc?.qualityScore,
    scorecards?.smc?.qualityScore,
    signal?.smcScore,
    signal?.smcQuality
  )

  return {
    key: 'smc',
    source: 'SMC Structure',
    system: 'MARKET',
    direction: directionLabel(direction),
    score,
    confidence: getScore(components.smc?.confidence, scorecards?.smc?.qualityScore, score),
    status: normalizeStatus(smcEvents.length || score ? 'active' : 'waiting'),
    details: formatDetails([
      latestEvent?.label ?? latestEvent?.type ?? latestEvent?.tag,
      `Events ${smcEvents.length || scorecards?.activeFactors?.smcEvents || 0}`,
      components.smc?.reason,
    ]),
  }
}

function getNrtrRows(scorecards: any, mlFeatures: any): MatrixRow[] {
  const feeds =
    getArrayPath(scorecards?.nrtrCharts, scorecards?.nrtrStrategyFeeds, mlFeatures?.nrtrStrategyFeeds)

  if (feeds.length > 0) {
    return feeds.map((feed: any, index: number) => {
      const label =
        feed?.source ??
        feed?.label ??
        (index === 0 ? 'NRTR Main' : index === 1 ? 'NRTR Mini 1' : 'NRTR Mini 2')

      const direction = firstValue(feed?.direction, feed?.signal, feed?.side, 'neutral')
      const score = getScore(feed?.score, feed?.confidence, feed?.distancePercent)
      const confidence = getScore(feed?.confidence, feed?.score, feed?.distancePercent)

      return {
        key: String(feed?.key ?? `nrtr-feed-${index}`),
        source: String(label),
        system: 'STRATEGY',
        direction: directionLabel(direction),
        score,
        confidence,
        status: normalizeStatus(firstValue(feed?.status, feed?.state, score ? 'active' : 'waiting')),
        details: formatDetails([
          feed?.symbol && feed?.timeframe ? `${feed.symbol} • ${feed.timeframe}` : null,
          feed?.details ?? feed?.detail,
          feed?.candleCount ? `Candles ${feed.candleCount}` : null,
          'Strategy context only',
        ]),
      }
    })
  }

  const nrtr = scorecards?.nrtrMatrix ?? scorecards?.nrtrStrategy ?? scorecards?.nrtr ?? scorecards?.nrtrStrategyContext
  const nrtrDirectionValue = toNumber(mlFeatures?.nrtrDirection, 0)
  const nrtrDirectionFromFeatures =
    nrtrDirectionValue > 0 ? 'bullish' : nrtrDirectionValue < 0 ? 'bearish' : undefined

  return [
    {
      key: 'nrtr',
      source: 'NRTR Main',
      system: 'STRATEGY',
      direction: directionLabel(firstValue(nrtr?.direction, nrtrDirectionFromFeatures, nrtr?.signal, 'neutral')),
      score: getScore(nrtr?.score, nrtr?.confidence, nrtr?.distancePercent),
      confidence: getScore(nrtr?.confidence, Math.abs(nrtrDirectionValue) * 100 || undefined, nrtr?.score),
      status: normalizeStatus(firstValue(nrtr?.status, nrtr?.state, nrtr ? 'active' : 'waiting')),
      details: formatDetails([
        nrtr?.details ?? nrtr?.detail,
        nrtr?.barsInTrend ? `Bars ${nrtr.barsInTrend}` : null,
        nrtr?.distancePercent ? `Distance ${formatNumber(nrtr.distancePercent, 2)}%` : null,
        'Strategy context only',
      ]),
    },
  ]
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

  rows.push(getSmcRow(signal, unifiedIntelligence, overlayPayload, scorecards))

  rows.push({
    key: 'alphax',
    source: 'AlphaX DLM / Profile',
    system: 'MARKET',
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
    system: 'MARKET',
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

  const ghostCandles = getGhostCandles(unifiedIntelligence, overlayPayload, scorecards)
  const ghostDirection = inferGhostDirection(
    ghostCandles,
    firstValue(
      getPath(unifiedIntelligence, 'ghostProjection.direction'),
      getPath(unifiedIntelligence, 'components.ghost.direction'),
      scorecards?.ghost?.direction
    )
  )
  const ghostConfidence = getScore(
    ghostCandles[0]?.confidence,
    getPath(unifiedIntelligence, 'ghostProjection.confidence'),
    averageGhostConfidence(ghostCandles),
    getPath(unifiedIntelligence, 'components.ghost.confidence'),
    scorecards?.ghost?.confidence
  )

  rows.push({
    key: 'ghost',
    source: 'Python Ghost Candles',
    system: 'ML',
    direction: directionLabel(ghostDirection),
    score: ghostConfidence,
    confidence: ghostConfidence,
    status: normalizeStatus(ghostCandles.length || ghostConfidence ? 'active' : 'waiting'),
    details: formatDetails([
      getPath(unifiedIntelligence, 'ghostProjection.reason'),
      ghostCandles[0]?.targetReaction,
      `Projections ${ghostCandles.length || scorecards?.ghost?.count || 0}`,
    ]),
  })

  rows.push(...getNrtrRows(scorecards, mlFeatures))

  rows.push({
    key: 'smma',
    source: 'SMMA',
    system: 'STRATEGY',
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
    system: 'MARKET',
    direction: directionLabel(firstValue(signal?.session, components.session?.direction, 'active')),
    score: getScore(signal?.sessionScore, components.session?.score, 100),
    confidence: getScore(signal?.sessionScore, components.session?.confidence, 100),
    status: normalizeStatus(firstValue(components.session?.status, 'active')),
    details: formatDetails([
      components.session?.reason,
      signal?.sessionName,
      'Session filter active',
    ]),
  })

  rows.push({
    key: 'market-sentiment',
    source: 'Market Sentiment Gauge (12 Indicators)',
    system: 'MARKET',
    direction: directionLabel(firstValue(technicalSentiment?.sentimentStatus, signal?.technicalSentiment?.sentimentStatus, 'active')),
    score: getScore(technicalSentiment?.sentiment, signal?.technicalSentiment?.sentiment, signal?.technicalScore),
    confidence: getScore(technicalSentiment?.confidence, technicalSentiment?.sentiment, signal?.technicalScore),
    status: normalizeStatus(firstValue(technicalSentiment ? 'active' : null, 'waiting')),
    details: formatDetails([
      'Main chart only',
      `Indicators ${firstValue(technicalSentiment?.activeCount, technicalSentiment?.indicators?.length, 0)}`,
      technicalSentiment?.sentimentLabel,
    ]),
  })

  rows.push({
    key: 'options-flow',
    source: 'Options Flow',
    system: 'EXTERNAL',
    direction: directionLabel(firstValue(components.optionsFlow?.direction, signal?.optionsFlowDirection, 'active')),
    score: getScore(components.optionsFlow?.score, signal?.optionsFlowScore),
    confidence: getScore(components.optionsFlow?.confidence, signal?.optionsFlowConfidence),
    status: normalizeStatus(firstValue(components.optionsFlow?.status, signal?.optionsFlowStatus, 'active')),
    details: formatDetails([
      components.optionsFlow?.reason,
      signal?.optionsFlowDetail,
    ]) || 'Options flow source available',
  })

  rows.push({
    key: 'open-interest',
    source: 'Open Interest',
    system: 'EXTERNAL',
    direction: directionLabel(firstValue(components.openInterest?.direction, signal?.openInterestDirection, 'inactive')),
    score: getScore(components.openInterest?.score, signal?.openInterestScore),
    confidence: getScore(components.openInterest?.confidence, signal?.openInterestConfidence),
    status: normalizeStatus(firstValue(components.openInterest?.status, signal?.openInterestStatus, 'unavailable')),
    details: formatDetails([
      components.openInterest?.reason,
      signal?.openInterestDetail,
    ]) || 'Open interest unavailable',
  })

  rows.push({
    key: 'footprint-delta',
    source: 'Footprint Delta',
    system: 'EXTERNAL',
    direction: directionLabel(firstValue(components.footprint?.direction, signal?.footprintDirection, 'inactive')),
    score: getScore(components.footprint?.score, signal?.footprintScore),
    confidence: getScore(components.footprint?.confidence, signal?.footprintConfidence),
    status: normalizeStatus(firstValue(components.footprint?.status, signal?.footprintStatus, 'unavailable')),
    details: formatDetails([
      components.footprint?.reason,
      signal?.footprintDetail,
    ]) || 'Footprint feed unavailable',
  })

  rows.push({
    key: 'fred-macro',
    source: 'FRED Macro',
    system: 'EXTERNAL',
    direction: directionLabel(firstValue(components.fred?.direction, signal?.fredDirection, 'active')),
    score: getScore(components.fred?.score, signal?.fredScore),
    confidence: getScore(components.fred?.confidence, signal?.fredConfidence),
    status: normalizeStatus(firstValue(components.fred?.status, signal?.fredStatus, 'active')),
    details: formatDetails([
      components.fred?.reason,
      signal?.fredDetail,
    ]) || 'Macro context active',
  })

  rows.push({
    key: 'finra-short-volume',
    source: 'FINRA Short Volume',
    system: 'EXTERNAL',
    direction: directionLabel(firstValue(components.finra?.direction, signal?.finraDirection, 'inactive')),
    score: getScore(components.finra?.score, signal?.finraScore),
    confidence: getScore(components.finra?.confidence, signal?.finraConfidence),
    status: normalizeStatus(firstValue(components.finra?.status, signal?.finraStatus, 'unavailable')),
    details: formatDetails([
      components.finra?.reason,
      signal?.finraDetail,
    ]) || 'Short volume feed unavailable',
  })

  rows.push({
    key: 'cot',
    source: 'COT',
    system: 'EXTERNAL',
    direction: directionLabel(firstValue(components.cot?.direction, signal?.cotDirection, 'inactive')),
    score: getScore(components.cot?.score, signal?.cotScore),
    confidence: getScore(components.cot?.confidence, signal?.cotConfidence),
    status: normalizeStatus(firstValue(components.cot?.status, signal?.cotStatus, 'unavailable')),
    details: formatDetails([
      components.cot?.reason,
      signal?.cotDetail,
    ]) || 'COT feed unavailable',
  })

  rows.push({
    key: 'ml-features',
    source: 'ML Features',
    system: 'ML',
    direction: directionLabel(firstValue(mlFeatures?.overallDirection, signal?.mlDirection, 'active')),
    score: getScore(mlFeatures?.overallConfirmationScore, signal?.mlScore),
    confidence: getScore(mlFeatures?.confidence, mlFeatures?.overallConfirmationScore, signal?.mlConfidence),
    status: normalizeStatus(firstValue(mlFeatures ? 'active' : null, 'waiting')),
    details: formatDetails([
      `Features ${Object.keys(mlFeatures ?? {}).length}`,
      mlFeatures?.mlHierarchy,
      'NRTR strategy feeds are separated from ML hierarchy',
    ]),
  })

  return rows
}

function summarizeRows(rows: MatrixRow[]) {
  const active = rows.filter((row) => normalizeDirection(row.status) === 'active' || String(row.status).toLowerCase() === 'active').length
  const bullish = rows.filter((row) => normalizeDirection(row.direction) === 'bullish').length
  const bearish = rows.filter((row) => normalizeDirection(row.direction) === 'bearish').length
  const avgConfidenceValues = rows
    .map((row) => row.confidence ?? row.score)
    .filter((value): value is number => Number.isFinite(Number(value)))

  const avgConfidence = avgConfidenceValues.length
    ? Math.round(avgConfidenceValues.reduce((sum, value) => sum + Number(value), 0) / avgConfidenceValues.length)
    : 0

  const bias =
    bearish > bullish ? 'Bearish' :
    bullish > bearish ? 'Bullish' :
    'Neutral'

  return {
    active,
    bullish,
    bearish,
    avgConfidence,
    bias,
  }
}

export default function UnifiedIntelligenceMatrix(props: UnifiedIntelligenceMatrixProps) {
  const rows = buildRows(props)
  const summary = summarizeRows(rows)

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
            Combined SMC, AlphaX, Ghost, NRTR, SMMA, external data, pressure, and ML context •{' '}
            {props.activeSymbol ?? props.signal?.symbol ?? 'MES1!'} • {props.activeTimeframe ?? props.signal?.activeTimeframe ?? props.signal?.timeframe ?? '1m'}
          </p>
        </div>

        <div className="rounded-lg border border-dark-600 bg-dark-900/60 px-3 py-2 text-right">
          <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Overall Bias</p>
          <p className={`text-sm font-bold ${directionClass(summary.bias)}`}>{summary.bias}</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-lg bg-dark-900/50 p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Avg Confidence</p>
          <p className="mt-1 text-lg font-bold text-cyan-300">{summary.avgConfidence}%</p>
        </div>
        <div className="rounded-lg bg-dark-900/50 p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Active</p>
          <p className="mt-1 text-lg font-bold text-emerald-300">{summary.active}</p>
        </div>
        <div className="rounded-lg bg-dark-900/50 p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Bullish</p>
          <p className="mt-1 text-lg font-bold text-emerald-300">{summary.bullish}</p>
        </div>
        <div className="rounded-lg bg-dark-900/50 p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Bearish</p>
          <p className="mt-1 text-lg font-bold text-red-300">{summary.bearish}</p>
        </div>
        <div className="rounded-lg bg-dark-900/50 p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-gray-500">Total Sources</p>
          <p className="mt-1 text-lg font-bold text-white">{rows.length}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-dark-700">
        <div className="grid grid-cols-[1.15fr_0.75fr_0.75fr_0.9fr_2.3fr] gap-0 border-b border-dark-700 bg-dark-900/70 px-4 py-3 text-[10px] uppercase tracking-[0.16em] text-gray-500">
          <div>Source</div>
          <div>Status</div>
          <div>Score</div>
          <div>Direction</div>
          <div>Details</div>
        </div>

        <div className="divide-y divide-dark-700">
          {rows.map((row) => {
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

                <div className={`font-bold ${directionClass(row.direction)}`}>
                  {row.direction}
                </div>

                <div className="truncate text-gray-400" title={row.details}>
                  {row.details || '—'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-dark-700 bg-dark-900/50 px-3 py-2 text-xs text-gray-500">
        Builder: MARKETBOS unified matrix. NRTR Main, Mini 1, and Mini 2 are separated strategy feeds. They are not used for Ghost ML or Target ML hierarchy.
      </div>
    </motion.div>
  )
}
