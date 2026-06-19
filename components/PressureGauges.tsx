'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { cachedJsonFetch } from '@/lib/frontendRequestCache'

type TechnicalIndicator = {
  name: string
  value: number
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | string
}

type TechnicalSentiment = {
  sentiment?: number
  sentimentStatus?: string
  bearCount?: number
  neutralCount?: number
  bullCount?: number
  activeCount?: number
  indicators?: TechnicalIndicator[]
  technicalIndicators?: TechnicalIndicator[]
  technicalMeter?: TechnicalIndicator[]
  factors?: TechnicalIndicator[]
  sourceTimeframes?: string[]
  timeframeBreakdown?: Record<string, TechnicalSentiment | null>
}

type TradingSignal = {
  symbol?: string
  timeframe?: string
  primaryTimeframe?: string
  analysisTimeframes?: string[]
  confidence?: number
  bullScore?: number
  bearScore?: number
  netBias?: number
  signal?: string
  chopRisk?: number
  macroRisk?: number
  fredMacro?: string
  session?: string
  openInterest?: string
  footprint?: string
  finraShortVolume?: string
  cot?: string
  technicalSentiment?: TechnicalSentiment
  smcStrength?: number
  alphaxStrength?: number
  ghostConfidence?: number
  smcDirection?: string
  alphaxDirection?: string
  ghostDirection?: string
  alphaxBullPressure?: number
  alphaxBearPressure?: number
  optionsFlow?: string
  optionsFlowStrength?: number
  optionsFlowDirection?: string
  optionsBullPressure?: number
  optionsBearPressure?: number
  putCallRatio?: number | null
  unusualOptionsVolume?: number
  gammaRisk?: number
  dealerPinZone?: number | null
  optionsConflictRisk?: number
  optionsReversalRisk?: number
  indicators?: TechnicalIndicator[]
  technicalIndicators?: TechnicalIndicator[]
  technicalMeter?: TechnicalIndicator[]
  factors?: TechnicalIndicator[]
}

type PressureGaugesProps = {
  signal?: TradingSignal
  unifiedIntelligence?: any | null
}

type GaugeItem = {
  label: string
  value: number
  barClass: string
  note: string
}

type TechnicalSummary = {
  indicators: TechnicalIndicator[]
  activeCount: number
  bullCount: number
  bearCount: number
  neutralCount: number
  sentiment: number
  bullishShare: number
  bearishShare: number
  neutralShare: number
  timeframeCount: number
  timeframeAgreementRisk: number
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://trading-intelligence-dashboard.onrender.com'

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeSymbol(value: unknown) {
  const raw = String(value ?? 'BTCUSD')
    .trim()
    .toUpperCase()
    .split('BINANCE:')
    .join('')
    .split('COINBASE:')
    .join('')
    .split('CRYPTO:')
    .join('')
    .split('CME_MINI:')
    .join('')
    .split('CME:')
    .join('')

  if (raw === 'MES1' || raw === 'MES1!') return 'MES1!'
  if (raw === 'ES1' || raw === 'ES1!') return 'ES1!'
  if (raw.includes('MES')) return 'MES1!'
  if (raw.includes('ES') && !raw.includes('MES')) return 'ES1!'
  if (raw.includes('BTC')) return 'BTCUSD'
  if (raw.includes('ETH')) return 'ETHUSD'
  if (raw.includes('SPY')) return 'SPY'

  return raw || 'BTCUSD'
}

function normalizeTimeframe(value: unknown) {
  const raw = String(value ?? '1m').trim().toLowerCase()
  const tf = raw.includes('/') ? raw.split('/')[0].trim() : raw

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

function asIndicatorArray(value: unknown): TechnicalIndicator[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null

      const raw = item as Record<string, unknown>
      const name = String(raw.name ?? raw.factor ?? raw.label ?? raw.indicator ?? '').trim()

      if (!name) return null

      return {
        name,
        value: clamp(Number(raw.value ?? raw.strength ?? raw.score ?? 0)),
        signal: String(raw.signal ?? raw.status ?? raw.side ?? 'NEUTRAL').toUpperCase(),
      }
    })
    .filter((item): item is TechnicalIndicator => Boolean(item))
}

function extractTechnicalIndicators(data: TechnicalSentiment | null | undefined): TechnicalIndicator[] {
  if (!data) return []

  const merged = [
    ...asIndicatorArray(data.indicators),
    ...asIndicatorArray(data.technicalIndicators),
    ...asIndicatorArray(data.technicalMeter),
    ...asIndicatorArray(data.factors),
  ]

  const byName = new Map<string, TechnicalIndicator>()

  for (const indicator of merged) {
    const key = indicator.name.trim().toLowerCase()
    if (!byName.has(key)) {
      byName.set(key, indicator)
    }
  }

  return Array.from(byName.values())
}

function normalizeIndicatorSignal(signal: unknown, value: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const text = String(signal ?? '').toUpperCase()

  if (text.includes('BULL')) return 'BULLISH'
  if (text.includes('BEAR')) return 'BEARISH'
  if (text.includes('NEUTRAL')) return 'NEUTRAL'

  if (value >= 60) return 'BULLISH'
  if (value <= 40) return 'BEARISH'
  return 'NEUTRAL'
}

function hasPositiveNumber(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0
}

function riskFromOptionalNumber(value: unknown): number | null {
  const numeric = Number(value)

  // A 0 from the webhook usually means "not provided / inactive" in this dashboard.
  // Positive values are treated as intentionally supplied risk scores.
  if (!Number.isFinite(numeric) || numeric <= 0) return null

  return clamp(numeric)
}

function isNeutralText(value?: string) {
  const lower = String(value ?? '').toLowerCase()

  return (
    !lower ||
    lower.includes('neutral') ||
    lower.includes('waiting') ||
    lower.includes('none') ||
    lower.includes('no signal') ||
    lower.includes('missing') ||
    lower.includes('inactive')
  )
}

function isBearishOrRiskText(value?: string) {
  const lower = String(value ?? '').toLowerCase()

  return (
    lower.includes('bear') ||
    lower.includes('risk') ||
    lower.includes('negative') ||
    lower.includes('hot') ||
    lower.includes('recession') ||
    lower.includes('conflict') ||
    lower.includes('hawkish')
  )
}

function buildSignalTechnicalSentiment(signal?: TradingSignal): TechnicalSentiment | null {
  if (!signal) return null

  if (signal.technicalSentiment && typeof signal.technicalSentiment === 'object') {
    return signal.technicalSentiment
  }

  const indicators = [
    ...asIndicatorArray(signal.indicators),
    ...asIndicatorArray(signal.technicalIndicators),
    ...asIndicatorArray(signal.technicalMeter),
    ...asIndicatorArray(signal.factors),
  ]

  if (indicators.length === 0) return null

  const bullCount = indicators.filter((indicator) => normalizeIndicatorSignal(indicator.signal, indicator.value) === 'BULLISH').length
  const bearCount = indicators.filter((indicator) => normalizeIndicatorSignal(indicator.signal, indicator.value) === 'BEARISH').length
  const neutralCount = Math.max(0, indicators.length - bullCount - bearCount)
  const sentiment = clamp(((bullCount + neutralCount * 0.5) / Math.max(indicators.length, 1)) * 100)

  return {
    sentiment,
    sentimentStatus:
      sentiment >= 60
        ? 'Mostly Bullish'
        : sentiment <= 40
          ? 'Mostly Bearish'
          : 'Mixed',
    bullCount,
    bearCount,
    neutralCount,
    activeCount: indicators.length,
    indicators,
    technicalIndicators: indicators,
    technicalMeter: indicators,
    factors: indicators,
  }
}

function calculateTimeframeAgreementRisk(data: TechnicalSentiment | null | undefined) {
  const breakdown = data?.timeframeBreakdown

  if (!breakdown || typeof breakdown !== 'object') return 0

  const sentiments = Object.values(breakdown)
    .map((item) => {
      if (!item) return null
      const indicators = extractTechnicalIndicators(item)
      const activeCount = item.activeCount ?? indicators.length
      const bullCount =
        item.bullCount ??
        indicators.filter((indicator) => normalizeIndicatorSignal(indicator.signal, indicator.value) === 'BULLISH').length
      const bearCount =
        item.bearCount ??
        indicators.filter((indicator) => normalizeIndicatorSignal(indicator.signal, indicator.value) === 'BEARISH').length

      if (activeCount <= 0) return null
      if (bullCount > bearCount) return 'BULLISH'
      if (bearCount > bullCount) return 'BEARISH'
      return 'NEUTRAL'
    })
    .filter((item): item is 'BULLISH' | 'BEARISH' | 'NEUTRAL' => Boolean(item))

  if (sentiments.length < 2) return 0

  const unique = new Set(sentiments)

  if (unique.size >= 3) return 70
  if (unique.has('BULLISH') && unique.has('BEARISH')) return 60
  if (unique.has('NEUTRAL') && unique.size > 1) return 35

  return 0
}

function technicalSummary(data: TechnicalSentiment | null | undefined): TechnicalSummary {
  const indicators = extractTechnicalIndicators(data)
  const activeCount = data?.activeCount ?? indicators.length
  const bullCount =
    data?.bullCount ??
    indicators.filter((indicator) => normalizeIndicatorSignal(indicator.signal, indicator.value) === 'BULLISH')
      .length
  const bearCount =
    data?.bearCount ??
    indicators.filter((indicator) => normalizeIndicatorSignal(indicator.signal, indicator.value) === 'BEARISH')
      .length
  const neutralCount =
    data?.neutralCount ??
    indicators.filter((indicator) => normalizeIndicatorSignal(indicator.signal, indicator.value) === 'NEUTRAL')
      .length

  const sentiment = clamp(Number(data?.sentiment ?? 50))
  const bullishShare = activeCount > 0 ? (bullCount / activeCount) * 100 : 0
  const bearishShare = activeCount > 0 ? (bearCount / activeCount) * 100 : 0
  const neutralShare = activeCount > 0 ? (neutralCount / activeCount) * 100 : 0
  const timeframeCount = Array.isArray(data?.sourceTimeframes) ? data.sourceTimeframes.length : 1
  const timeframeAgreementRisk = calculateTimeframeAgreementRisk(data)

  return {
    indicators,
    activeCount,
    bullCount,
    bearCount,
    neutralCount,
    sentiment,
    bullishShare,
    bearishShare,
    neutralShare,
    timeframeCount,
    timeframeAgreementRisk,
  }
}

function calculateChopRisk(
  suppliedChopRisk: unknown,
  summary: TechnicalSummary,
  netBias: number,
  bullPressure: number,
  bearPressure: number,
  conflictRisk: number
) {
  const explicitRisk = riskFromOptionalNumber(suppliedChopRisk)
  if (explicitRisk !== null) return explicitRisk

  const weakNetBiasRisk = clamp(55 - Math.abs(netBias) * 1.1)
  const pressureBalanceRisk = clamp(60 - Math.abs(bullPressure - bearPressure))
  const neutralRisk = clamp(summary.neutralShare)
  const sentimentMiddleRisk = clamp(100 - Math.abs(summary.sentiment - 50) * 2)
  const timeframeConflictRisk = summary.timeframeAgreementRisk

  return clamp(
    Math.max(
      neutralRisk,
      weakNetBiasRisk,
      pressureBalanceRisk,
      sentimentMiddleRisk,
      timeframeConflictRisk,
      conflictRisk >= 45 ? conflictRisk - 15 : 0
    )
  )
}


function asObject(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null
}

function unifiedNumber(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function unifiedPercent(value: unknown, fallback = 0) {
  const numeric = unifiedNumber(value, fallback)

  if (!Number.isFinite(numeric)) return clamp(fallback)

  const scaled = Math.abs(numeric) <= 1 && Math.abs(numeric) > 0
    ? Math.abs(numeric) * 100
    : Math.abs(numeric)

  return clamp(scaled)
}

function unifiedDirection(value: unknown): 'bullish' | 'bearish' | 'neutral' {
  const raw = asObject(value)
  const text = String(
    raw?.direction ??
      raw?.signal ??
      raw?.bias ??
      raw?.side ??
      raw?.status ??
      value ??
      ''
  ).toLowerCase()

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

  const directionValue = unifiedNumber(raw?.directionValue ?? raw?.signedScore ?? raw?.signed ?? raw?.value, 0)

  if (directionValue > 0) return 'bullish'
  if (directionValue < 0) return 'bearish'

  return 'neutral'
}

function unifiedComponentScore(value: unknown) {
  const raw = asObject(value)

  return unifiedPercent(
    raw?.strength ??
      raw?.score ??
      raw?.confidence ??
      raw?.qualityScore ??
      raw?.netScore ??
      raw?.value,
    0
  )
}

function unifiedDirectionalScore(value: unknown, side: 'bullish' | 'bearish') {
  const direction = unifiedDirection(value)
  if (direction !== side) return 0
  return unifiedComponentScore(value)
}

function getUnifiedComponents(unifiedIntelligence: any | null | undefined) {
  const root = asObject(unifiedIntelligence)
  const components = asObject(root?.components) ?? {}

  return {
    root,
    components,
    smc: asObject(components.smc),
    liquidity: asObject(components.liquidity ?? components.alphaX ?? components.alphax),
    smma: asObject(components.smma),
    nrtr: asObject(components.nrtr),
    ghost: asObject(components.ghost),
    external: asObject(components.external),
    ml: asObject(components.ml),
    marketSentiment: asObject(root?.marketSentiment),
    aiTrader: asObject(root?.aiTrader),
    ghostProjection: asObject(root?.ghostProjection),
  }
}

function getUnifiedGhostContext(unifiedIntelligence: any | null | undefined) {
  const { ghost, ghostProjection } = getUnifiedComponents(unifiedIntelligence)
  const candles = Array.isArray(ghostProjection?.candles)
    ? ghostProjection?.candles
    : Array.isArray(ghostProjection?.ghostCandles)
      ? ghostProjection?.ghostCandles
      : Array.isArray(ghost?.candles)
        ? ghost?.candles
        : Array.isArray(ghost?.ghostCandles)
          ? ghost?.ghostCandles
          : []

  const first = candles[0] && typeof candles[0] === 'object' ? candles[0] : null
  const confidence = unifiedPercent(
    first?.confidence ??
      ghostProjection?.confidence ??
      ghostProjection?.strength ??
      ghost?.confidence ??
      ghost?.strength ??
      ghost?.score,
    0
  )

  const direction = unifiedDirection(
    first?.direction ??
      ghostProjection?.direction ??
      ghostProjection?.bias ??
      ghost?.direction ??
      ghost?.bias
  )

  return {
    confidence,
    direction,
    source: first?.source ?? ghostProjection?.source ?? ghost?.source ?? '',
  }
}

function hasUnifiedIntelligence(value: unknown) {
  const root = asObject(value)
  return Boolean(root && Object.keys(root).length > 0)
}

function calculateMacroRisk(signal?: TradingSignal) {
  const explicitRisk = riskFromOptionalNumber(signal?.macroRisk)
  if (explicitRisk !== null) return explicitRisk

  const macroTexts = [
    signal?.fredMacro,
    signal?.session,
    signal?.openInterest,
    signal?.footprint,
    signal?.finraShortVolume,
    signal?.cot,
  ]

  const hasAnyExternalConfirmation = macroTexts.some((value) => !isNeutralText(value))
  const hasMacroWarning = macroTexts.some((value) => isBearishOrRiskText(value))

  if (hasMacroWarning) return 65

  // If macro is missing/inactive, it should not be 0. It is an unknown-risk condition.
  if (!hasAnyExternalConfirmation) return 35

  return 15
}

export default function PressureGauges({ signal, unifiedIntelligence }: PressureGaugesProps) {
  const [fetchedTechnicalSentiment, setFetchedTechnicalSentiment] =
    useState<TechnicalSentiment | null>(null)

  const symbol = normalizeSymbol(signal?.symbol)
  const timeframe = normalizeTimeframe(signal?.primaryTimeframe ?? signal?.timeframe)
  const signalTechnicalSentiment = useMemo(
    () => buildSignalTechnicalSentiment(signal),
    [signal]
  )

  useEffect(() => {
    if (signalTechnicalSentiment) {
      setFetchedTechnicalSentiment(null)
      return
    }

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    async function fetchTechnicalSentiment() {
      try {
        const params = new URLSearchParams({
          symbol,
          timeframe,
          limit: '500',
        })

        const json = await cachedJsonFetch<TechnicalSentiment | null>(
          `${API_BASE_URL}/api/latest-sentiment?${params.toString()}`,
          30000
        )

        if (!cancelled) {
          setFetchedTechnicalSentiment(json && typeof json === 'object' ? json : null)
        }
      } catch (error) {
        console.error('Pressure gauges technical sentiment fetch error:', error)
      }
    }

    fetchTechnicalSentiment()
    intervalId = setInterval(fetchTechnicalSentiment, 10000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [signalTechnicalSentiment, symbol, timeframe])

  const technicalSentiment = signalTechnicalSentiment ?? fetchedTechnicalSentiment

  const summary = useMemo(
    () => technicalSummary(technicalSentiment),
    [technicalSentiment]
  )

  const unified = getUnifiedComponents(unifiedIntelligence)
  const unifiedActive = hasUnifiedIntelligence(unifiedIntelligence)
  const unifiedGhostContext = getUnifiedGhostContext(unifiedIntelligence)

  const smcStrength = unifiedActive
    ? unifiedComponentScore(unified.smc)
    : clamp(Number(signal?.smcStrength ?? 0))
  const alphaxStrength = unifiedActive
    ? unifiedComponentScore(unified.liquidity)
    : clamp(Number(signal?.alphaxStrength ?? 0))
  const linkedGhostConfidence = unifiedActive && unifiedGhostContext.confidence > 0
    ? unifiedGhostContext.confidence
    : clamp(Number(signal?.ghostConfidence ?? signal?.confidence ?? 0))
  const ghostDirection = unifiedActive && unifiedGhostContext.direction !== 'neutral'
    ? unifiedGhostContext.direction
    : String(signal?.ghostDirection ?? '').toLowerCase()
  const alphaxBullPressure = clamp(Number(signal?.alphaxBullPressure ?? 0))
  const alphaxBearPressure = clamp(Number(signal?.alphaxBearPressure ?? 0))
  const optionsBullPressure = clamp(Number(signal?.optionsBullPressure ?? 0))
  const optionsBearPressure = clamp(Number(signal?.optionsBearPressure ?? 0))
  const optionsStrength = clamp(Number(signal?.optionsFlowStrength ?? 0))
  const optionsConflictRisk = clamp(Number(signal?.optionsConflictRisk ?? 0))
  const optionsReversalRisk = clamp(Number(signal?.optionsReversalRisk ?? 0))
  const gammaRisk = clamp(Number(signal?.gammaRisk ?? 0))
  const unusualOptionsVolume = clamp(Number(signal?.unusualOptionsVolume ?? 0))

  const unifiedBullPressure = clamp(
    Math.max(
      unifiedDirectionalScore(unified.smc, 'bullish'),
      unifiedDirectionalScore(unified.liquidity, 'bullish'),
      unifiedDirectionalScore(unified.smma, 'bullish'),
      unifiedDirectionalScore(unified.nrtr, 'bullish'),
      unifiedDirectionalScore(unified.ghost, 'bullish'),
      unifiedDirectionalScore(unified.external, 'bullish'),
      unifiedDirectionalScore(unified.ml, 'bullish'),
      unifiedGhostContext.direction === 'bullish' ? unifiedGhostContext.confidence : 0,
      unifiedPercent(unified.aiTrader?.bullScore ?? unified.marketSentiment?.bullScore, 0)
    )
  )

  const unifiedBearPressure = clamp(
    Math.max(
      unifiedDirectionalScore(unified.smc, 'bearish'),
      unifiedDirectionalScore(unified.liquidity, 'bearish'),
      unifiedDirectionalScore(unified.smma, 'bearish'),
      unifiedDirectionalScore(unified.nrtr, 'bearish'),
      unifiedDirectionalScore(unified.ghost, 'bearish'),
      unifiedDirectionalScore(unified.external, 'bearish'),
      unifiedDirectionalScore(unified.ml, 'bearish'),
      unifiedGhostContext.direction === 'bearish' ? unifiedGhostContext.confidence : 0,
      unifiedPercent(unified.aiTrader?.bearScore ?? unified.marketSentiment?.bearScore, 0)
    )
  )

  const legacyBullPressure = clamp(
    Math.max(
      summary.activeCount > 0 ? summary.bullishShare : 0,
      Number(signal?.bullScore ?? 50),
      String(signal?.smcDirection ?? '').toLowerCase().includes('bull') ? smcStrength : 0,
      String(signal?.alphaxDirection ?? '').toLowerCase().includes('bull') ? Math.max(alphaxStrength, alphaxBullPressure) : 0,
      String(ghostDirection ?? '').toLowerCase().includes('bull') ? linkedGhostConfidence : 0,
      String(signal?.optionsFlowDirection ?? '').toLowerCase().includes('bull') ? Math.max(optionsStrength, optionsBullPressure) : 0
    )
  )

  const legacyBearPressure = clamp(
    Math.max(
      summary.activeCount > 0 ? summary.bearishShare : 0,
      Number(signal?.bearScore ?? 50),
      String(signal?.smcDirection ?? '').toLowerCase().includes('bear') ? smcStrength : 0,
      String(signal?.alphaxDirection ?? '').toLowerCase().includes('bear') ? Math.max(alphaxStrength, alphaxBearPressure) : 0,
      String(ghostDirection ?? '').toLowerCase().includes('bear') ? linkedGhostConfidence : 0,
      String(signal?.optionsFlowDirection ?? '').toLowerCase().includes('bear') ? Math.max(optionsStrength, optionsBearPressure) : 0
    )
  )

  const bullPressure = unifiedActive
    ? clamp(Math.max(summary.activeCount > 0 ? summary.bullishShare : 0, unifiedBullPressure))
    : legacyBullPressure

  const bearPressure = unifiedActive
    ? clamp(Math.max(summary.activeCount > 0 ? summary.bearishShare : 0, unifiedBearPressure))
    : legacyBearPressure

  const ghostConfidence = linkedGhostConfidence
  const unifiedNetBias = unifiedNumber(
    unified.aiTrader?.netScore ??
      unified.aiTrader?.netBias ??
      unified.marketSentiment?.netScore ??
      unified.marketSentiment?.netBias ??
      unified.root?.unifiedNetScore,
    NaN
  )
  const netBias = unifiedActive && Number.isFinite(unifiedNetBias)
    ? unifiedNetBias
    : Number.isFinite(Number(signal?.netBias))
      ? Number(signal?.netBias)
      : bullPressure - bearPressure

  const directionalOptionsConflict =
    (String(signal?.optionsFlowDirection ?? '').toLowerCase().includes('bear') &&
      String(signal?.smcDirection ?? '').toLowerCase().includes('bull')) ||
    (String(signal?.optionsFlowDirection ?? '').toLowerCase().includes('bull') &&
      String(signal?.smcDirection ?? '').toLowerCase().includes('bear')) ||
    (String(signal?.optionsFlowDirection ?? '').toLowerCase().includes('bear') &&
      String(ghostDirection ?? '').toLowerCase().includes('bull')) ||
    (String(signal?.optionsFlowDirection ?? '').toLowerCase().includes('bull') &&
      String(ghostDirection ?? '').toLowerCase().includes('bear'))

  const unifiedConflictRisk = unifiedPercent(
    unified.aiTrader?.conflictRisk ??
      unified.marketSentiment?.conflictRisk ??
      unified.root?.conflictRisk,
    0
  )
  const conflictRisk = clamp(
    Math.max(
      optionsConflictRisk,
      unifiedActive ? unifiedConflictRisk : 0,
      directionalOptionsConflict ? 80 : 0,
      summary.activeCount > 0
        ? Math.abs(Number(signal?.bearScore ?? 50) - summary.bullishShare) >= 25 ||
          Math.abs(Number(signal?.bullScore ?? 50) - summary.bearishShare) >= 25
          ? 75
          : Math.abs(bullPressure - bearPressure) < 12 || summary.timeframeAgreementRisk >= 60
            ? 45
            : 15
        : 0
    )
  )

  const unifiedChopRisk = unifiedPercent(
    unified.aiTrader?.chopRisk ??
      unified.marketSentiment?.chopRisk ??
      unified.root?.chopRisk,
    0
  )
  const chopRisk = unifiedActive && unifiedChopRisk > 0
    ? unifiedChopRisk
    : calculateChopRisk(
        signal?.chopRisk,
        summary,
        netBias,
        bullPressure,
        bearPressure,
        conflictRisk
      )

  const unifiedMacroRisk = unifiedDirection(unified.external) === 'bearish'
    ? unifiedComponentScore(unified.external)
    : 0
  const macroRisk = clamp(Math.max(calculateMacroRisk(signal), unifiedMacroRisk))

  const gauges: GaugeItem[] = [
    {
      label: 'Bull Pressure',
      value: bullPressure,
      barClass: 'bg-emerald-400',
      note: unifiedActive ? 'Unified SMC + Liquidity + SMMA + NRTR + Ghost + External + ML bullish pressure' : `${summary.bullCount} technicals + SMC/AlphaX/Ghost/Options bullish pressure`,
    },
    {
      label: 'Bear Pressure',
      value: bearPressure,
      barClass: 'bg-red-400',
      note: unifiedActive ? 'Unified SMC + Liquidity + SMMA + NRTR + Ghost + External + ML bearish pressure' : `${summary.bearCount} technicals + SMC/AlphaX/Ghost/Options bearish pressure`,
    },
    {
      label: 'Ghost Confidence',
      value: ghostConfidence,
      barClass: 'bg-blue-400',
      note: unifiedActive ? 'Linked from unified ghostProjection first candle confidence' : 'Linked from Python HA Ghost projection engine',
    },
    {
      label: 'Technical Conflict Risk',
      value: conflictRisk,
      barClass: conflictRisk >= 60 ? 'bg-red-400' : conflictRisk >= 35 ? 'bg-yellow-400' : 'bg-emerald-400',
      note:
        summary.timeframeCount > 1
          ? 'Mismatch between pressure, technical meter, and mini-chart timeframes'
          : 'Mismatch between dashboard pressure and technical meter',
    },
    {
      label: 'Options Reversal Risk',
      value: optionsReversalRisk,
      barClass: optionsReversalRisk >= 60 ? 'bg-red-400' : optionsReversalRisk >= 35 ? 'bg-yellow-400' : 'bg-emerald-400',
      note: 'Put/call, unusual volume, and gamma pressure reversal risk',
    },
    {
      label: 'Gamma Risk',
      value: gammaRisk,
      barClass: gammaRisk >= 60 ? 'bg-red-400' : gammaRisk >= 35 ? 'bg-yellow-400' : 'bg-emerald-400',
      note: signal?.dealerPinZone ? `Dealer pin zone near ${signal.dealerPinZone}` : 'Dealer pin zone unavailable',
    },
    {
      label: 'Chop Risk',
      value: chopRisk,
      barClass: chopRisk >= 60 ? 'bg-yellow-400' : chopRisk >= 35 ? 'bg-blue-400' : 'bg-emerald-400',
      note:
        summary.timeframeCount > 1
          ? `${summary.neutralCount} neutral technicals + multi-timeframe conflict check`
          : `${summary.neutralCount} neutral technicals + weak net bias check`,
    },
    {
      label: 'Macro Risk',
      value: macroRisk,
      barClass: macroRisk >= 60 ? 'bg-orange-500' : macroRisk >= 35 ? 'bg-yellow-400' : 'bg-orange-400',
      note: calculateMacroRisk(signal) >= 60
        ? 'External or macro warning detected'
        : isNeutralText(signal?.fredMacro)
          ? 'Macro is neutral or missing'
          : 'Macro confirmation available',
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Pressure Gauges</h2>
          <p className="mt-1 text-xs text-gray-500">
            {unifiedActive ? 'Unified intelligence pressure + technical meter' : 'Python technical meter + live dashboard pressure'}
          </p>
        </div>

        <div className="rounded-lg border border-dark-600 bg-dark-900/40 px-3 py-2 text-right">
          <p className="text-xs text-gray-500">Net</p>
          <p className={`text-sm font-bold ${netBias >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {netBias > 0 ? '+' : ''}
            {Math.round(netBias)}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {gauges.map((gauge) => (
          <div key={gauge.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-semibold text-gray-300">{gauge.label}</span>
              <span className="font-bold text-white">{gauge.value}%</span>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-dark-700">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${gauge.value}%` }}
                transition={{ duration: 0.35 }}
                className={`h-full rounded-full ${gauge.barClass}`}
              />
            </div>

            <p className="mt-1 text-[10px] text-gray-500">{gauge.note}</p>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
