import React, { useMemo } from 'react'
import { buildNeuralBrainScorecard } from '@/lib/neuralBrain'

type AnyRecord = Record<string, any>

type ScorecardBundle = {
  version?: string
  asOfTime?: unknown
  symbolPrice?: number
  overall?: {
    direction?: string
    netBias?: number
    confirmationScore?: number
    conflictScore?: number
    bullScore?: number
    bearScore?: number
    contextScore?: number
  }
  smc?: {
    qualityScore?: number
    bullishEvents?: number
    bearishEvents?: number
  }
  orderBlocks?: {
    qualityScore?: number
    bullishZones?: number
    bearishZones?: number
  }
  pdZones?: {
    qualityScore?: number
  }
  liquidityProfile?: {
    qualityScore?: number
    profileBinCount?: number
    strongBins?: number
  }
  nrtr?: {
    direction?: string
    agreesWithSmc?: boolean
  }
  ghost?: {
    direction?: string
    confidence?: number
    count?: number
  }
  hiddenContext?: {
    qualityScore?: number
    eqhEqlCount?: number
    fvgCount?: number
    sweepCount?: number
    displacementCount?: number
    inducementCount?: number
  }
  activeFactors?: Record<string, number>
}

type MlFeatures = Record<string, number | string | boolean | null | undefined>

type ScorecardsPanelProps = {
  scorecards?: ScorecardBundle | null
  mlFeatures?: MlFeatures | null
  overlayPayload?: AnyRecord | null
  overlaySources?: Array<AnyRecord | null | undefined>
  compact?: boolean
}

function toNumber(value: unknown, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function formatNumber(value: unknown, decimals = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return number.toFixed(decimals)
}

function formatSigned(value: unknown, decimals = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${number > 0 ? '+' : ''}${number.toFixed(decimals)}`
}

function directionColor(direction?: string) {
  const value = String(direction ?? '').toLowerCase()
  if (value.includes('bull') || value.includes('buy') || value.includes('long')) return 'text-emerald-300'
  if (value.includes('bear') || value.includes('sell') || value.includes('short')) return 'text-red-300'
  return 'text-yellow-300'
}

function meterColor(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 'bg-slate-700'
  if (number >= 70) return 'bg-emerald-400'
  if (number >= 45) return 'bg-yellow-400'
  return 'bg-red-400'
}

function riskMeterColor(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 'bg-slate-700'
  if (number >= 70) return 'bg-red-400'
  if (number >= 45) return 'bg-yellow-400'
  return 'bg-emerald-400'
}

function normalizeDirection(value: unknown): 'bullish' | 'bearish' | 'neutral' {
  const text = String(value ?? '').toLowerCase()
  if (text.includes('bull') || text.includes('buy') || text.includes('long') || text.includes('up') || text.includes('demand')) return 'bullish'
  if (text.includes('bear') || text.includes('sell') || text.includes('short') || text.includes('down') || text.includes('supply')) return 'bearish'
  return 'neutral'
}

function getDirectionValue(direction: unknown) {
  const normalized = normalizeDirection(direction)
  if (normalized === 'bullish') return 1
  if (normalized === 'bearish') return -1
  return 0
}

function uniqueByStableKey(items: AnyRecord[]) {
  const seen = new Set<string>()
  const unique: AnyRecord[] = []

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const key = JSON.stringify({
      id: item.id,
      type: item.type,
      kind: item.kind,
      label: item.label,
      time: item.time,
      index: item.index,
      price: item.price,
      high: item.high ?? item.top,
      low: item.low ?? item.bottom,
      start: item.startTime ?? item.start,
      end: item.endTime ?? item.end,
    })
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }

  return unique
}

function normalizePayloadSources(...sources: Array<AnyRecord | null | undefined>) {
  const flattened: AnyRecord[] = []

  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    flattened.push(source)

    for (const key of ['overlayPayload', 'chartOverlays', 'chart_overlays', 'overlays', 'latestSignal', 'signal', 'engineState', 'data']) {
      const candidate = source[key]
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        flattened.push(candidate as AnyRecord)
      }
    }

    const latestOverlay = source.latestSignal?.overlayPayload
    if (latestOverlay && typeof latestOverlay === 'object') {
      flattened.push(latestOverlay as AnyRecord)
    }
  }

  return flattened
}

function getArray(payload: AnyRecord | null | undefined, ...keys: string[]) {
  if (!payload || typeof payload !== 'object') return [] as AnyRecord[]
  for (const key of keys) {
    const value = payload[key]
    if (Array.isArray(value)) return value as AnyRecord[]
  }
  return [] as AnyRecord[]
}

function getArrayFromSources(sources: AnyRecord[], ...keys: string[]) {
  return uniqueByStableKey(sources.flatMap((source) => getArray(source, ...keys)))
}

function scanArraysByKey(source: unknown, keyMatcher: (key: string) => boolean, maxDepth = 4) {
  const results: AnyRecord[] = []
  const seen = new Set<unknown>()

  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== 'object' || depth > maxDepth || seen.has(value)) return
    seen.add(value)

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }

    for (const [key, child] of Object.entries(value as AnyRecord)) {
      if (Array.isArray(child) && keyMatcher(key.toLowerCase())) {
        results.push(...(child.filter((item) => item && typeof item === 'object') as AnyRecord[]))
      }
      if (child && typeof child === 'object') visit(child, depth + 1)
    }
  }

  visit(source, 0)
  return uniqueByStableKey(results)
}

function getItemQuality(item: AnyRecord | undefined | null, fallback = 5) {
  if (!item || typeof item !== 'object') return fallback
  const quality = toNumber(item.qualityScore ?? item.quality_score, NaN)
  if (Number.isFinite(quality) && quality > 0) return Math.max(1, Math.min(10, quality))
  const score = toNumber(item.score ?? item.confidence ?? item.strength, NaN)
  if (Number.isFinite(score) && score > 0) return score > 10 ? Math.max(1, Math.min(10, score / 10)) : Math.max(1, Math.min(10, score))
  return fallback
}

function average(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value))
  if (!clean.length) return 0
  return clean.reduce((sum, value) => sum + value, 0) / clean.length
}

function getUsefulScorecardStrength(scorecards: ScorecardBundle | null | undefined) {
  if (!scorecards) return 0
  const factors = scorecards.activeFactors ?? {}
  const factorTotal = Object.values(factors).reduce((sum, value) => sum + Number(value || 0), 0)

  return (
    toNumber(scorecards.overall?.confirmationScore, 0) +
    toNumber(scorecards.smc?.qualityScore, 0) +
    toNumber(scorecards.orderBlocks?.qualityScore, 0) +
    toNumber(scorecards.pdZones?.qualityScore, 0) +
    toNumber(scorecards.liquidityProfile?.qualityScore, 0) +
    toNumber(scorecards.hiddenContext?.qualityScore, 0) +
    factorTotal
  )
}

function hasUsefulScorecards(value: unknown): value is ScorecardBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return getUsefulScorecardStrength(value as ScorecardBundle) > 0
}

function getActiveFactorTotal(scorecards: ScorecardBundle | null | undefined) {
  const factors = scorecards?.activeFactors ?? {}
  return Object.values(factors).reduce((sum, value) => sum + Number(value || 0), 0)
}

function buildFallbackScorecardsFromOverlayPayload(
  overlayPayload?: AnyRecord | null,
  mlFeatures?: MlFeatures | null,
  overlaySources?: Array<AnyRecord | null | undefined>
): ScorecardBundle | null {
  const sources = normalizePayloadSources(overlayPayload, ...(overlaySources ?? []))
  if (sources.length === 0) return null

  const smcEvents = uniqueByStableKey([
    ...getArrayFromSources(sources, 'smcEvents', 'structureEvents'),
    ...getArrayFromSources(sources, 'lines').filter((line) => {
      const label = String(line.label ?? line.type ?? '').toLowerCase()
      return label.includes('bos') || label.includes('choch') || label.includes('mss')
    }),
  ])

  const zones = uniqueByStableKey([
    ...getArrayFromSources(sources, 'zones', 'overlayZones', 'chartZones', 'orderBlocks', 'pdZones', 'premiumDiscountZones'),
    ...sources.flatMap((source) => scanArraysByKey(source, (key) => key.includes('zone') || key.includes('orderblock') || key.includes('premium') || key.includes('discount'))),
  ])

  const orderBlocks = uniqueByStableKey([
    ...getArrayFromSources(sources, 'orderBlocks'),
    ...zones.filter((zone) => String(zone.label ?? zone.kind ?? zone.type ?? '').toLowerCase().includes('ob') || String(zone.label ?? zone.kind ?? zone.type ?? '').toLowerCase().includes('order')),
  ])

  const pdZones = zones.filter((zone) => {
    const label = String(zone.label ?? zone.kind ?? zone.type ?? zone.zoneType ?? zone.name ?? '').toLowerCase()
    return label.includes('premium') || label.includes('discount') || label.includes('equilibrium') || label.includes('pd')
  })

  const profileBins = uniqueByStableKey([
    ...getArrayFromSources(sources, 'liquidityProfileBins', 'alphaProfileBins', 'profileBins', 'dlmProfileBins', 'bins'),
    ...sources.flatMap((source) => scanArraysByKey(source, (key) => key.includes('profilebin') || key.includes('liquidityprofile') || key.includes('dlmprofile') || key === 'bins')),
  ])

  const ghostCandles = getArrayFromSources(sources, 'ghostCandles', 'ghostProjections', 'projections')
  const liquidityEvents = getArrayFromSources(sources, 'liquidityEvents')

  const recentSmc = smcEvents.slice(-10)
  const recentObs = orderBlocks.slice(-10)
  const smcBull = recentSmc.filter((item) => normalizeDirection(item.direction ?? item.label ?? item.type) === 'bullish').length
  const smcBear = recentSmc.filter((item) => normalizeDirection(item.direction ?? item.label ?? item.type) === 'bearish').length
  const obBull = recentObs.filter((item) => normalizeDirection(item.direction ?? item.label ?? item.type) === 'bullish').length
  const obBear = recentObs.filter((item) => normalizeDirection(item.direction ?? item.label ?? item.type) === 'bearish').length

  const smcQuality = average(recentSmc.map((item) => getItemQuality(item, 5)))
  const obQuality = average(recentObs.map((item) => getItemQuality(item, 5)))
  const pdQuality = pdZones.length ? Math.max(4.5, average(pdZones.map((item) => getItemQuality(item, 4)))) : 0
  const profileQuality = profileBins.length ? Math.max(4.5, average(profileBins.map((item) => getItemQuality(item, 3)))) : 0

  const sweepCount = toNumber((mlFeatures as AnyRecord | null)?.sweepCount, liquidityEvents.length)
  const fvgCount = toNumber((mlFeatures as AnyRecord | null)?.fairValueGapCount ?? (mlFeatures as AnyRecord | null)?.fvgCount, 0)
  const eqhEqlCount = toNumber((mlFeatures as AnyRecord | null)?.equalHighLowCount ?? (mlFeatures as AnyRecord | null)?.eqhEqlCount, 0)
  const displacementCount = toNumber((mlFeatures as AnyRecord | null)?.displacementCount, 0)
  const inducementCount = toNumber((mlFeatures as AnyRecord | null)?.inducementCount, 0)
  const hiddenQuality = Math.min(10, sweepCount * 1.2 + displacementCount + inducementCount * 0.7 + fvgCount * 0.6 + eqhEqlCount * 0.5)

  const ghost = ghostCandles[0] || {}
  const ghostDirection = normalizeDirection(ghost.direction ?? ghost.bias)
  let ghostConfidence = toNumber(ghost.confidence ?? ghost.probability ?? ghost.score, 0)
  if (ghostConfidence > 0 && ghostConfidence <= 1) ghostConfidence *= 100

  const nrtrDirection = normalizeDirection((mlFeatures as AnyRecord | null)?.nrtrDirection ?? (overlayPayload as AnyRecord | null)?.nrtr?.direction)

  let bullScore = smcBull * 1.5 + obBull * 1.2
  let bearScore = smcBear * 1.5 + obBear * 1.2
  if (nrtrDirection === 'bullish') bullScore += 2
  if (nrtrDirection === 'bearish') bearScore += 2
  if (ghostDirection === 'bullish') bullScore += Math.min(3, ghostConfidence / 35)
  if (ghostDirection === 'bearish') bearScore += Math.min(3, ghostConfidence / 35)

  const netBias = bullScore - bearScore
  const direction = netBias >= 3 ? 'bullish' : netBias <= -3 ? 'bearish' : 'neutral'
  const contextScore = smcQuality * 0.28 + obQuality * 0.24 + pdQuality * 0.18 + profileQuality * 0.15 + hiddenQuality * 0.15
  const conflictScore = Math.min(100, (nrtrDirection !== 'neutral' && direction !== 'neutral' && nrtrDirection !== direction ? 30 : 0) + (ghostDirection !== 'neutral' && direction !== 'neutral' && ghostDirection !== direction ? 25 : 0))

  return {
    version: 'frontend-overlay-scorecards-v2-neural-ready',
    asOfTime: sources[0]?.asOfTime ?? sources[0]?.createdAt,
    overall: {
      direction,
      netBias: Number(netBias.toFixed(2)),
      confirmationScore: Math.max(0, Math.min(100, Number((contextScore * 10).toFixed(2)))),
      conflictScore: Number(conflictScore.toFixed(2)),
      bullScore: Number(bullScore.toFixed(2)),
      bearScore: Number(bearScore.toFixed(2)),
      contextScore: Number(contextScore.toFixed(2)),
    },
    smc: { qualityScore: Number(smcQuality.toFixed(2)), bullishEvents: smcBull, bearishEvents: smcBear },
    orderBlocks: { qualityScore: Number(obQuality.toFixed(2)), bullishZones: obBull, bearishZones: obBear },
    pdZones: { qualityScore: Number(pdQuality.toFixed(2)) },
    liquidityProfile: { qualityScore: Number(profileQuality.toFixed(2)), profileBinCount: profileBins.length, strongBins: profileBins.length },
    nrtr: {
      direction: nrtrDirection,
      agreesWithSmc: nrtrDirection === 'neutral' ? false : (nrtrDirection === 'bullish' && smcBull >= smcBear) || (nrtrDirection === 'bearish' && smcBear >= smcBull),
    },
    ghost: { direction: ghostDirection, confidence: Number(ghostConfidence.toFixed(2)), count: ghostCandles.length },
    hiddenContext: { qualityScore: Number(hiddenQuality.toFixed(2)), eqhEqlCount, fvgCount, sweepCount, displacementCount, inducementCount },
    activeFactors: {
      smcEvents: recentSmc.length,
      orderBlocks: recentObs.length,
      pdZones: pdZones.length,
      profileBins: profileBins.length,
      ghostCandles: ghostCandles.length,
      eqhEql: eqhEqlCount,
      fvg: fvgCount,
      sweeps: sweepCount,
      displacement: displacementCount,
      inducement: inducementCount,
      nrtr: nrtrDirection !== 'neutral' ? 1 : 0,
    },
  }
}

function buildFallbackMlFeatures(scorecards: ScorecardBundle | null, existingFeatures?: MlFeatures | null): MlFeatures | null {
  if (existingFeatures && Object.keys(existingFeatures).length > 0) return existingFeatures
  if (!scorecards) return null

  return {
    overallDirection: getDirectionValue(scorecards.overall?.direction ?? 'neutral'),
    overallNetBias: scorecards.overall?.netBias,
    overallConfirmationScore: scorecards.overall?.confirmationScore,
    overallConflictScore: scorecards.overall?.conflictScore,
    smcQualityScore: scorecards.smc?.qualityScore,
    orderBlockQualityScore: scorecards.orderBlocks?.qualityScore,
    pdQualityScore: scorecards.pdZones?.qualityScore,
    liquidityProfileQualityScore: scorecards.liquidityProfile?.qualityScore,
    hiddenContextQualityScore: scorecards.hiddenContext?.qualityScore,
    nrtrDirection: getDirectionValue(scorecards.nrtr?.direction ?? 'neutral'),
    nrtrAgreesWithSmc: scorecards.nrtr?.agreesWithSmc ? 1 : 0,
    ghostDirection: getDirectionValue(scorecards.ghost?.direction ?? 'neutral'),
    ghostConfidence: scorecards.ghost?.confidence,
    eqhEqlCount: scorecards.hiddenContext?.eqhEqlCount,
    fairValueGapCount: scorecards.hiddenContext?.fvgCount,
    sweepCount: scorecards.hiddenContext?.sweepCount,
    displacementCount: scorecards.hiddenContext?.displacementCount,
    inducementCount: scorecards.hiddenContext?.inducementCount,
    bullScore: scorecards.overall?.bullScore,
    bearScore: scorecards.overall?.bearScore,
  }
}

function ScoreRow({
  label,
  value,
  suffix = '',
  risk = false,
}: {
  label: string
  value: unknown
  suffix?: string
  risk?: boolean
}) {
  const number = Number(value)
  const width = Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-slate-400">{label}</span>
        <span className="text-[11px] font-semibold text-slate-100">
          {formatNumber(value, 0)}
          {suffix}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${risk ? riskMeterColor(width) : meterColor(width)}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function MiniStat({ label, value, colorClass = 'text-slate-100' }: { label: string; value: unknown; colorClass?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-black/20 p-3 text-[11px]">
      <div className="text-slate-500">{label}</div>
      <div className={`mt-1 font-semibold ${colorClass}`}>{String(value ?? '—')}</div>
    </div>
  )
}

export default function ScorecardsPanel({
  scorecards,
  mlFeatures,
  overlayPayload,
  overlaySources = [],
  compact = false,
}: ScorecardsPanelProps) {
  const fallbackScorecards = useMemo(() => {
    return buildFallbackScorecardsFromOverlayPayload(overlayPayload, mlFeatures, overlaySources)
  }, [mlFeatures, overlayPayload, overlaySources])

  const activeScorecards = hasUsefulScorecards(scorecards) ? scorecards : fallbackScorecards
  const activeMlFeatures = buildFallbackMlFeatures(activeScorecards, mlFeatures)

  const neuralBrain = useMemo(() => {
    if (!activeScorecards) return null

    const sources = normalizePayloadSources(overlayPayload, ...overlaySources)
    const sourceWithSymbol = sources.find((source) => source.symbol || source.timeframe) ?? {}
    const sourceWithUnified = sources.find((source) => source.unifiedIntelligence || source.eventType === 'UNIFIED_INTELLIGENCE') ?? {}
    const sourceWithExternal = sources.find((source) => source.externalData || source.externalTables) ?? {}

    return buildNeuralBrainScorecard({
      symbol: String(sourceWithSymbol.symbol ?? overlayPayload?.symbol ?? 'MES1!'),
      timeframe: String(sourceWithSymbol.timeframe ?? overlayPayload?.timeframe ?? '1m'),
      scorecards: activeScorecards as AnyRecord,
      mlFeatures: (activeMlFeatures ?? {}) as AnyRecord,
      overlayPayload: overlayPayload ?? {},
      unifiedIntelligence: (sourceWithUnified.unifiedIntelligence ?? sourceWithUnified) as AnyRecord,
      externalData: (sourceWithExternal.externalData ?? sourceWithExternal.externalTables ?? {}) as AnyRecord,
    })
  }, [activeMlFeatures, activeScorecards, overlayPayload, overlaySources])

  if (!activeScorecards) {
    return (
      <div className="rounded-xl border border-slate-800 bg-[#0b1020] p-4">
        <div className="text-sm font-semibold text-slate-100">ML Scorecards</div>
        <div className="mt-1 text-xs text-slate-500">Waiting for unified overlay scorecards.</div>
      </div>
    )
  }

  const overall = activeScorecards.overall ?? {}
  const hidden = activeScorecards.hiddenContext ?? {}
  const activeFactors = activeScorecards.activeFactors ?? {}
  const activeFeatureCount = activeMlFeatures ? Object.keys(activeMlFeatures).length : 0

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0b1020] p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">ML Scorecards</div>
          <div className="mt-1 text-[11px] text-slate-500">
            SMC + OB + PD + DLM + Ghost + NRTR linked into ML-ready features
          </div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-black/25 px-3 py-2 text-right">
          <div className={`text-xs font-semibold uppercase ${directionColor(overall.direction)}`}>
            {overall.direction ?? 'Neutral'}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            Net {formatSigned(overall.netBias, 1)}
          </div>
        </div>
      </div>

      {neuralBrain && (
        <div className="mt-4 rounded-xl border border-cyan-400/25 bg-cyan-950/10 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-cyan-200">Neural Brain</div>
              <div className="mt-1 text-[11px] text-slate-500">
                Observer mode: scoring only, not controlling entries or ghost candles yet
              </div>
            </div>

            <div className="rounded-lg border border-cyan-400/20 bg-black/25 px-3 py-2 text-right">
              <div className={`text-xs font-semibold uppercase ${directionColor(neuralBrain.bestDirection)}`}>
                {neuralBrain.bestDirection}
              </div>
              <div className="mt-1 text-[10px] text-slate-400">
                {neuralBrain.noTradeWarning ? 'Risk Watch' : 'Aligned'}
              </div>
            </div>
          </div>

          <div className={`mt-4 grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-2 xl:grid-cols-3'}`}>
            <ScoreRow label="Brain Buy" value={neuralBrain.buyConfidence} suffix="%" />
            <ScoreRow label="Brain Sell" value={neuralBrain.sellConfidence} suffix="%" />
            <ScoreRow label="Target Hit" value={neuralBrain.targetHitProbability} suffix="%" />
            <ScoreRow label="Reversal Risk" value={neuralBrain.reversalRisk} suffix="%" risk />
            <ScoreRow label="Chop Risk" value={neuralBrain.chopRisk} suffix="%" risk />
            <ScoreRow label="Decision Strength" value={Math.max(neuralBrain.buyConfidence, neuralBrain.sellConfidence)} suffix="%" />
          </div>

          <div className="mt-3 rounded-lg border border-slate-800 bg-black/20 p-3 text-[11px] text-slate-300">
            <span className="text-slate-500">Decision:</span>{' '}
            <span className={`font-semibold ${directionColor(neuralBrain.bestDirection)}`}>
              {neuralBrain.decision.replaceAll('_', ' ')}
            </span>
          </div>
        </div>
      )}

      <div className={`mt-4 grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-2 xl:grid-cols-3'}`}>
        <ScoreRow label="Overall Confirmation" value={overall.confirmationScore} suffix="%" />
        <ScoreRow label="Conflict Risk" value={overall.conflictScore} suffix="%" risk />
        <ScoreRow label="SMC Quality" value={(activeScorecards.smc?.qualityScore ?? 0) * 10} suffix="%" />
        <ScoreRow label="Order Block Quality" value={(activeScorecards.orderBlocks?.qualityScore ?? 0) * 10} suffix="%" />
        <ScoreRow label="PD Zone Quality" value={(activeScorecards.pdZones?.qualityScore ?? 0) * 10} suffix="%" />
        <ScoreRow label="Liquidity Profile Quality" value={(activeScorecards.liquidityProfile?.qualityScore ?? 0) * 10} suffix="%" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-[11px] text-slate-300 md:grid-cols-4">
        <MiniStat label="NRTR" value={activeScorecards.nrtr?.direction ?? 'neutral'} colorClass={directionColor(activeScorecards.nrtr?.direction)} />
        <MiniStat label="Ghost" value={`${activeScorecards.ghost?.direction ?? 'neutral'} • ${formatNumber(activeScorecards.ghost?.confidence, 0)}%`} colorClass={directionColor(activeScorecards.ghost?.direction)} />
        <MiniStat label="Hidden Context" value={`${formatNumber(hidden.qualityScore, 1)}/10`} />
        <MiniStat label="ML Features" value={activeFeatureCount} />
      </div>

      <div className="mt-4 grid grid-cols-5 gap-2 text-center text-[10px] text-slate-400">
        <div className="rounded-md bg-black/20 p-2">
          <div className="font-semibold text-slate-200">{activeFactors.smcEvents ?? 0}</div>
          <div>SMC</div>
        </div>
        <div className="rounded-md bg-black/20 p-2">
          <div className="font-semibold text-slate-200">{activeFactors.orderBlocks ?? 0}</div>
          <div>OB</div>
        </div>
        <div className="rounded-md bg-black/20 p-2">
          <div className="font-semibold text-slate-200">{activeFactors.profileBins ?? 0}</div>
          <div>DLM</div>
        </div>
        <div className="rounded-md bg-black/20 p-2">
          <div className="font-semibold text-slate-200">{hidden.fvgCount ?? 0}</div>
          <div>FVG</div>
        </div>
        <div className="rounded-md bg-black/20 p-2">
          <div className="font-semibold text-slate-200">{hidden.eqhEqlCount ?? 0}</div>
          <div>EQH/EQL</div>
        </div>
      </div>
    </div>
  )
}
