import React, { useMemo, useRef } from 'react'

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

function hasUsefulScorecards(value: unknown): value is ScorecardBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const raw = value as AnyRecord

  return Boolean(
    raw.overall ||
      raw.smc ||
      raw.orderBlocks ||
      raw.pdZones ||
      raw.liquidityProfile ||
      raw.hiddenContext ||
      raw.activeFactors
  )
}

function getActiveFactorTotal(scorecards: ScorecardBundle | null | undefined) {
  const factors = scorecards?.activeFactors ?? {}

  return Object.values(factors).reduce((sum, value) => sum + Number(value || 0), 0)
}

function getUsefulScorecardStrength(scorecards: ScorecardBundle | null | undefined) {
  if (!scorecards) return 0

  const confirmation = toNumber(scorecards.overall?.confirmationScore, 0)
  const smc = toNumber(scorecards.smc?.qualityScore, 0)
  const orderBlocks = toNumber(scorecards.orderBlocks?.qualityScore, 0)
  const pd = toNumber(scorecards.pdZones?.qualityScore, 0)
  const profile = toNumber(scorecards.liquidityProfile?.qualityScore, 0)
  const hidden = toNumber(scorecards.hiddenContext?.qualityScore, 0)
  const factors = getActiveFactorTotal(scorecards)

  return confirmation + smc + orderBlocks + pd + profile + hidden + factors
}

function isUsefulScorecardForDisplay(scorecards: ScorecardBundle | null | undefined) {
  return getUsefulScorecardStrength(scorecards) > 0
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

  if (value.includes('bull')) return 'text-emerald-300'
  if (value.includes('bear')) return 'text-red-300'

  return 'text-yellow-300'
}

function meterColor(value: unknown) {
  const number = Number(value)

  if (!Number.isFinite(number)) return 'bg-slate-700'
  if (number >= 70) return 'bg-emerald-400'
  if (number >= 45) return 'bg-yellow-400'

  return 'bg-red-400'
}

function normalizeDirection(value: unknown): 'bullish' | 'bearish' | 'neutral' {
  const text = String(value ?? '').toLowerCase()

  if (text.includes('bull') || text === 'buy' || text === 'long' || text === 'up') return 'bullish'
  if (text.includes('bear') || text === 'sell' || text === 'short' || text === 'down') return 'bearish'

  return 'neutral'
}

function getDirectionValue(direction: string) {
  if (direction === 'bullish') return 1
  if (direction === 'bearish') return -1
  return 0
}

function getItemQuality(item: AnyRecord | undefined | null, fallback = 5) {
  if (!item || typeof item !== 'object') return fallback

  const quality = toNumber(item.qualityScore ?? item.quality_score, NaN)

  if (Number.isFinite(quality) && quality > 0) return Math.max(1, Math.min(10, quality))

  const score = toNumber(item.score ?? item.confidence, NaN)

  if (Number.isFinite(score) && score > 0) {
    return score > 10 ? Math.max(1, Math.min(10, score / 10)) : Math.max(1, Math.min(10, score))
  }

  return fallback
}

function average(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value))

  if (!clean.length) return 0

  return clean.reduce((sum, value) => sum + value, 0) / clean.length
}

function getArray(payload: AnyRecord | null | undefined, ...keys: string[]) {
  if (!payload || typeof payload !== 'object') return []

  for (const key of keys) {
    const value = payload[key]
    if (Array.isArray(value)) return value as AnyRecord[]
  }

  return []
}

function getNestedArray(payload: AnyRecord | null | undefined, nestedKey: string, ...keys: string[]) {
  const nested = payload?.[nestedKey]

  if (!nested || typeof nested !== 'object') return []

  return getArray(nested as AnyRecord, ...keys)
}

function uniqueByStableKey(items: AnyRecord[]) {
  const seen = new Set<string>()
  const unique: AnyRecord[] = []

  for (const item of items) {
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

    const candidateKeys = [
      'overlayPayload',
      'chartOverlays',
      'chart_overlays',
      'overlays',
      'latestSignal',
      'signal',
      'engineState',
      'data',
    ]

    for (const key of candidateKeys) {
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

function getArrayFromSources(sources: AnyRecord[], ...keys: string[]) {
  return uniqueByStableKey(
    sources.flatMap((source) => getArray(source, ...keys))
  )
}

function getNestedArrayFromSources(sources: AnyRecord[], nestedKey: string, ...keys: string[]) {
  return uniqueByStableKey(
    sources.flatMap((source) => getNestedArray(source, nestedKey, ...keys))
  )
}

function getObjectFromSources(sources: AnyRecord[], ...keys: string[]) {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key]
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as AnyRecord
      }
    }
  }

  return {}
}

function getDeepArraysFromSources(
  sources: AnyRecord[],
  keyMatcher: (key: string) => boolean,
  maxDepth = 5
) {
  const results: AnyRecord[] = []
  const seen = new Set<unknown>()

  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== 'object' || depth > maxDepth || seen.has(value)) return
    seen.add(value)

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }

    const objectValue = value as AnyRecord

    for (const [key, child] of Object.entries(objectValue)) {
      if (Array.isArray(child) && keyMatcher(key.toLowerCase())) {
        results.push(...(child.filter((item) => item && typeof item === 'object') as AnyRecord[]))
      }

      if (child && typeof child === 'object') {
        visit(child, depth + 1)
      }
    }
  }

  for (const source of sources) visit(source, 0)

  return uniqueByStableKey(results)
}

function getDeepObjectsByLabelFromSources(
  sources: AnyRecord[],
  labelMatcher: (label: string) => boolean,
  maxDepth = 5
) {
  const results: AnyRecord[] = []
  const seen = new Set<unknown>()

  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== 'object' || depth > maxDepth || seen.has(value)) return
    seen.add(value)

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }

    const objectValue = value as AnyRecord
    const label = String(
      objectValue.label ??
        objectValue.name ??
        objectValue.title ??
        objectValue.type ??
        objectValue.kind ??
        objectValue.zoneType ??
        objectValue.category ??
        ''
    ).toLowerCase()

    if (labelMatcher(label)) {
      results.push(objectValue)
    }

    for (const child of Object.values(objectValue)) {
      if (child && typeof child === 'object') {
        visit(child, depth + 1)
      }
    }
  }

  for (const source of sources) visit(source, 0)

  return uniqueByStableKey(results)
}

function scorePdZone(item: AnyRecord) {
  const explicit = toNumber(item.qualityScore ?? item.quality_score ?? item.score ?? item.strength, NaN)

  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit > 10 ? Math.min(10, explicit / 10) : Math.min(10, explicit)
  }

  const top = toNumber(item.top ?? item.high ?? item.upper ?? item.max, NaN)
  const bottom = toNumber(item.bottom ?? item.low ?? item.lower ?? item.min, NaN)

  if (Number.isFinite(top) && Number.isFinite(bottom) && Math.abs(top - bottom) > 0) {
    return 5
  }

  return getItemQuality(item, 4)
}

function scoreProfileBin(item: AnyRecord) {
  const explicit = toNumber(
    item.liquidityScore ??
      item.score ??
      item.strength ??
      item.weight ??
      item.value,
    NaN
  )

  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit > 10 ? Math.min(10, explicit / 10) : Math.min(10, explicit)
  }

  const percent = toNumber(
    item.widthPct ??
      item.volumePct ??
      item.percent ??
      item.percentage ??
      item.pct ??
      item.relativeSize ??
      item.normalized,
    NaN
  )

  if (Number.isFinite(percent) && percent > 0) {
    return percent > 10 ? Math.min(10, percent / 10) : Math.min(10, percent)
  }

  const volume = toNumber(
    item.volume ??
      item.buyVolume ??
      item.sellVolume ??
      item.totalVolume ??
      item.rawVolume,
    NaN
  )

  if (Number.isFinite(volume) && volume > 0) return 4

  const top = toNumber(item.top ?? item.high ?? item.upper, NaN)
  const bottom = toNumber(item.bottom ?? item.low ?? item.lower, NaN)

  if (Number.isFinite(top) && Number.isFinite(bottom)) return 3

  return 0
}

function buildFallbackScorecardsFromOverlayPayload(
  overlayPayload?: AnyRecord | null,
  mlFeatures?: MlFeatures | null,
  overlaySources?: Array<AnyRecord | null | undefined>
): ScorecardBundle | null {
  const sources = normalizePayloadSources(overlayPayload, ...(overlaySources ?? []))

  if (sources.length === 0) return null

  const smcEvents = [
    ...getArrayFromSources(sources, 'smcEvents', 'structureEvents'),
    ...getArrayFromSources(sources, 'lines').filter((line) => {
      const label = String(line.label ?? line.type ?? '').toLowerCase()
      return label.includes('bos') || label.includes('choch') || label.includes('mss')
    }),
  ]

  const allZones = uniqueByStableKey([
    ...getArrayFromSources(sources, 'zones'),
    ...getArrayFromSources(sources, 'overlayZones'),
    ...getArrayFromSources(sources, 'chartZones'),
    ...getArrayFromSources(sources, 'pdZones'),
    ...getArrayFromSources(sources, 'premiumDiscountZones'),
    ...getArrayFromSources(sources, 'premiumDiscount'),
    ...getArrayFromSources(sources, 'pdLevels'),
    ...getArrayFromSources(sources, 'orderBlockZones'),
    ...getArrayFromSources(sources, 'orderBlocks'),
    ...getArrayFromSources(sources, 'supplyZones'),
    ...getArrayFromSources(sources, 'demandZones'),
    ...getDeepArraysFromSources(
      sources,
      (key) =>
        key.includes('zone') ||
        key.includes('orderblock') ||
        key.includes('premium') ||
        key.includes('discount') ||
        key.includes('equilibrium'),
      4
    ),
  ])
  const orderBlocks = [
    ...getArrayFromSources(sources, 'orderBlocks'),
    ...allZones.filter((zone) => {
      const label = String(zone.label ?? zone.kind ?? zone.type ?? '').toLowerCase()
      return label.includes('ob') || label.includes('order')
    }),
  ]

  const pdZones = uniqueByStableKey([
    ...getArrayFromSources(sources, 'pdZones', 'premiumDiscountZones', 'premiumDiscount', 'pdLevels'),
    ...allZones.filter((zone) => {
      const label = String(zone.label ?? zone.kind ?? zone.type ?? zone.zoneType ?? zone.name ?? '').toLowerCase()
      return (
        label.includes('premium') ||
        label.includes('discount') ||
        label.includes('equilibrium') ||
        label.includes('pd')
      )
    }),
    ...getDeepObjectsByLabelFromSources(
      sources,
      (label) =>
        label.includes('premium') ||
        label.includes('discount') ||
        label.includes('equilibrium') ||
        label.includes('pd'),
      4
    ),
  ])
  const profileBins = uniqueByStableKey([
    ...getArrayFromSources(
      sources,
      'liquidityProfileBins',
      'alphaProfileBins',
      'profileBins',
      'dlmProfileBins',
      'bins',
      'levels'
    ),
    ...getNestedArrayFromSources(sources, 'alphaProfile', 'bins', 'profileBins', 'levels'),
    ...getNestedArrayFromSources(sources, 'liquidityProfile', 'bins', 'profileBins', 'levels'),
    ...getNestedArrayFromSources(sources, 'dlm', 'profileBins', 'bins', 'liquidityProfileBins', 'levels'),
    ...getDeepArraysFromSources(
      sources,
      (key) =>
        key.includes('profilebin') ||
        key.includes('liquidityprofile') ||
        key.includes('dlmprofile') ||
        key === 'bins' ||
        key === 'levels',
      4
    ),
  ])
  const ghostCandles = getArrayFromSources(sources, 'ghostCandles', 'ghostProjections', 'projections')
  const calculationContext = getObjectFromSources(sources, 'calculationContext')
  const mlFeatureContext = getObjectFromSources(sources, 'mlFeatureContext')

  const recentSmc = smcEvents.slice(-10)
  const recentObs = orderBlocks.slice(-10)

  const smcBull = recentSmc.filter((item) => normalizeDirection(item.direction) === 'bullish').length
  const smcBear = recentSmc.filter((item) => normalizeDirection(item.direction) === 'bearish').length

  const obBull = recentObs.filter((item) => normalizeDirection(item.direction) === 'bullish').length
  const obBear = recentObs.filter((item) => normalizeDirection(item.direction) === 'bearish').length

  const smcQuality = average(recentSmc.map((item) => getItemQuality(item, 5)))
  const obQuality = average(recentObs.map((item) => getItemQuality(item, 5)))
  const pdQuality = pdZones.length > 0
    ? Math.max(4.5, average(pdZones.map((item) => scorePdZone(item))))
    : 0
  const profileQuality = profileBins.length > 0
    ? Math.min(10, Math.max(4.5, average(profileBins.map((bin) => scoreProfileBin(bin)))))
    : 0

  const sweepCount = toNumber(
    mlFeatureContext.sweepCount ??
      calculationContext?.sweeps?.count ??
      getArray(overlayPayload, 'liquidityEvents').length,
    0
  )
  const fvgCount = toNumber(
    mlFeatureContext.fairValueGapCount ??
      calculationContext?.fairValueGaps?.count ??
      calculationContext?.fvgCount,
    0
  )
  const eqhEqlCount = toNumber(
    mlFeatureContext.equalHighLowCount ??
      calculationContext?.equalHighLow?.count,
    0
  )
  const displacementCount = toNumber(
    mlFeatureContext.displacementCount ??
      calculationContext?.displacement?.count,
    0
  )
  const inducementCount = toNumber(
    mlFeatureContext.inducementCount ??
      calculationContext?.inducement?.count,
    0
  )

  const hiddenQuality = Math.min(
    10,
    sweepCount * 1.2 +
      displacementCount * 1 +
      inducementCount * 0.7 +
      fvgCount * 0.6 +
      eqhEqlCount * 0.5
  )

  const ghost = ghostCandles[0] || {}
  const ghostDirection = normalizeDirection(ghost.direction ?? ghost.bias)
  let ghostConfidence = toNumber(ghost.confidence ?? ghost.probability ?? ghost.score, 0)
  if (ghostConfidence > 0 && ghostConfidence <= 1) ghostConfidence *= 100

  const nrtrContext = getObjectFromSources(sources, 'nrtrContext', 'nrtr') || mlFeatures?.nrtrContext || {}
  const nrtrDirection = normalizeDirection((nrtrContext as AnyRecord).direction ?? mlFeatures?.nrtrDirection)

  let bullScore = 0
  let bearScore = 0

  bullScore += smcBull * 1.5 + obBull * 1.2
  bearScore += smcBear * 1.5 + obBear * 1.2

  if (nrtrDirection === 'bullish') bullScore += 2
  if (nrtrDirection === 'bearish') bearScore += 2

  if (ghostDirection === 'bullish') bullScore += Math.min(3, ghostConfidence / 35)
  if (ghostDirection === 'bearish') bearScore += Math.min(3, ghostConfidence / 35)

  const netBias = bullScore - bearScore
  const direction = netBias >= 3 ? 'bullish' : netBias <= -3 ? 'bearish' : 'neutral'
  const contextScore =
    smcQuality * 0.28 +
    obQuality * 0.24 +
    pdQuality * 0.18 +
    profileQuality * 0.15 +
    hiddenQuality * 0.15

  let conflictScore = 0

  if (nrtrDirection !== 'neutral' && direction !== 'neutral' && nrtrDirection !== direction) {
    conflictScore += 30
  }

  if (ghostDirection !== 'neutral' && direction !== 'neutral' && ghostDirection !== direction) {
    conflictScore += 25
  }

  if (smcBull > 0 && smcBear > 0) {
    conflictScore += Math.min(25, Math.abs(smcBull - smcBear) * 4)
  }

  const activeFactors = {
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
  }

  return {
    version: 'frontend-overlay-scorecards-v1',
    asOfTime: sources[0]?.asOfTime ?? sources[0]?.createdAt,
    overall: {
      direction,
      netBias: Number(netBias.toFixed(2)),
      confirmationScore: Math.max(0, Math.min(100, Number((contextScore * 10).toFixed(2)))),
      conflictScore: Math.max(0, Math.min(100, Number(conflictScore.toFixed(2)))),
      bullScore: Number(bullScore.toFixed(2)),
      bearScore: Number(bearScore.toFixed(2)),
      contextScore: Number(contextScore.toFixed(2)),
    },
    smc: {
      qualityScore: Number(smcQuality.toFixed(2)),
      bullishEvents: smcBull,
      bearishEvents: smcBear,
    },
    orderBlocks: {
      qualityScore: Number(obQuality.toFixed(2)),
      bullishZones: obBull,
      bearishZones: obBear,
    },
    pdZones: {
      qualityScore: Number(pdQuality.toFixed(2)),
    },
    liquidityProfile: {
      qualityScore: Number(profileQuality.toFixed(2)),
      profileBinCount: profileBins.length,
      strongBins: profileBins.filter((bin) => toNumber(bin.liquidityScore, 0) >= 3).length,
    },
    nrtr: {
      direction: nrtrDirection,
      agreesWithSmc:
        nrtrDirection === 'neutral'
          ? false
          : (nrtrDirection === 'bullish' && smcBull >= smcBear) ||
            (nrtrDirection === 'bearish' && smcBear >= smcBull),
    },
    ghost: {
      direction: ghostDirection,
      confidence: Number(ghostConfidence.toFixed(2)),
      count: ghostCandles.length,
    },
    hiddenContext: {
      qualityScore: Number(hiddenQuality.toFixed(2)),
      eqhEqlCount,
      fvgCount,
      sweepCount,
      displacementCount,
      inducementCount,
    },
    activeFactors,
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
}: {
  label: string
  value: unknown
  suffix?: string
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
        <div className={`h-full rounded-full ${meterColor(width)}`} style={{ width: `${width}%` }} />
      </div>
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
  const lastUsefulScorecardsRef = useRef<ScorecardBundle | null>(null)
  const lastUsefulMlFeaturesRef = useRef<MlFeatures | null>(null)

  const fallbackScorecards = useMemo(() => {
    return buildFallbackScorecardsFromOverlayPayload(overlayPayload, mlFeatures, overlaySources)
  }, [mlFeatures, overlayPayload, overlaySources])

  const liveScorecards = hasUsefulScorecards(scorecards) ? scorecards : fallbackScorecards
  const liveMlFeatures = buildFallbackMlFeatures(liveScorecards, mlFeatures)

  /**
   * PD zones/profile can arrive in a later partial overlay update.
   * Do not let that partial update wipe out the useful SMC/OB scorecard.
   */
  if (isUsefulScorecardForDisplay(liveScorecards)) {
    const liveStrength = getUsefulScorecardStrength(liveScorecards)
    const previousStrength = getUsefulScorecardStrength(lastUsefulScorecardsRef.current)

    if (!lastUsefulScorecardsRef.current || liveStrength >= previousStrength * 0.35) {
      lastUsefulScorecardsRef.current = liveScorecards
      lastUsefulMlFeaturesRef.current = liveMlFeatures
    }
  }

  const activeScorecards = isUsefulScorecardForDisplay(liveScorecards)
    ? liveScorecards
    : lastUsefulScorecardsRef.current

  const activeMlFeatures = activeScorecards === liveScorecards
    ? liveMlFeatures
    : lastUsefulMlFeaturesRef.current

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

      <div className={`mt-4 grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-2 xl:grid-cols-3'}`}>
        <ScoreRow label="Overall Confirmation" value={overall.confirmationScore} suffix="%" />
        <ScoreRow label="Conflict Risk" value={overall.conflictScore} suffix="%" />
        <ScoreRow label="SMC Quality" value={(activeScorecards.smc?.qualityScore ?? 0) * 10} suffix="%" />
        <ScoreRow label="Order Block Quality" value={(activeScorecards.orderBlocks?.qualityScore ?? 0) * 10} suffix="%" />
        <ScoreRow label="PD Zone Quality" value={(activeScorecards.pdZones?.qualityScore ?? 0) * 10} suffix="%" />
        <ScoreRow label="Liquidity Profile Quality" value={(activeScorecards.liquidityProfile?.qualityScore ?? 0) * 10} suffix="%" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-[11px] text-slate-300 md:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <div className="text-slate-500">NRTR</div>
          <div className={`mt-1 font-semibold ${directionColor(activeScorecards.nrtr?.direction)}`}>
            {activeScorecards.nrtr?.direction ?? 'neutral'}
          </div>
          <div className="mt-1 text-slate-500">
            SMC agree: {activeScorecards.nrtr?.agreesWithSmc ? 'Yes' : 'No'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <div className="text-slate-500">Ghost</div>
          <div className={`mt-1 font-semibold ${directionColor(activeScorecards.ghost?.direction)}`}>
            {activeScorecards.ghost?.direction ?? 'neutral'}
          </div>
          <div className="mt-1 text-slate-500">
            Conf {formatNumber(activeScorecards.ghost?.confidence, 0)}%
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <div className="text-slate-500">Hidden Context</div>
          <div className="mt-1 font-semibold text-slate-100">
            {formatNumber(hidden.qualityScore, 1)}/10
          </div>
          <div className="mt-1 text-slate-500">
            S:{hidden.sweepCount ?? 0} D:{hidden.displacementCount ?? 0} I:{hidden.inducementCount ?? 0}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
          <div className="text-slate-500">ML Features</div>
          <div className="mt-1 font-semibold text-slate-100">
            {activeFeatureCount}
          </div>
          <div className="mt-1 text-slate-500">
            Factors {getActiveFactorTotal(activeScorecards)}
          </div>
        </div>
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
