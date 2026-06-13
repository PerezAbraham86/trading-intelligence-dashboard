'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'

type AiBrainContextPanelProps = {
  symbol: string
  timeframe: string
  signal?: any
  scorecards?: any
  mlFeatures?: any
  overlayPayload?: any
  unifiedIntelligence?: any
  aiDecision?: any
  mainSettings?: any
  miniOneSettings?: any
  miniTwoSettings?: any
}

type BrainDirection = 'Bullish' | 'Bearish' | 'Neutral' | 'Mixed'
type BrainStatus = 'Active' | 'Learning' | 'Waiting' | 'Conflict' | 'Unavailable'

type BrainRow = {
  name: string
  group: string
  status: BrainStatus
  direction: BrainDirection
  confidence: number
  usedByGhostMl: boolean
  usedByTargetMl: boolean
  usedByAiTrader: boolean
  reason: string
}

type NeuralBrainScorecard = {
  brainBuyPct: number
  brainSellPct: number
  targetHitPct: number
  reversalRiskPct: number
  chopRiskPct: number
  decisionStrengthPct: number
  bestDirection: BrainDirection
  decision: string
  riskStatus: 'Aligned' | 'Risk Watch' | 'Mixed' | 'Waiting'
}

function toFiniteNumber(value: any, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, low = 0, high = 100) {
  return Math.max(low, Math.min(high, value))
}

function readPath(source: any, paths: string[]) {
  for (const path of paths) {
    const value = path.split('.').reduce((current: any, key) => {
      if (current && typeof current === 'object' && key in current) return current[key]
      return undefined
    }, source)

    if (value !== undefined && value !== null && value !== '') return value
  }

  return undefined
}

function readNumber(source: any, paths: string[], fallback = 0) {
  return toFiniteNumber(readPath(source, paths), fallback)
}

function maxReadableNumber(sources: Array<[any, string[]]>, fallback = 0) {
  return Math.max(fallback, ...sources.map(([source, paths]) => readNumber(source, paths, fallback)))
}

function normalizeDirection(value: any): BrainDirection {
  const raw = String(value ?? '').toLowerCase()

  if (raw.includes('bull') || raw.includes('buy') || raw.includes('long') || raw === '1') return 'Bullish'
  if (raw.includes('bear') || raw.includes('sell') || raw.includes('short') || raw === '-1') return 'Bearish'
  if (raw.includes('mix') || raw.includes('conflict')) return 'Mixed'

  return 'Neutral'
}

function directionFromScores(bull: number, bear: number): BrainDirection {
  if (bull > bear + 5) return 'Bullish'
  if (bear > bull + 5) return 'Bearish'
  if (bull > 0 || bear > 0) return 'Mixed'

  return 'Neutral'
}

function statusFromConfidence(confidence: number, active = false): BrainStatus {
  if (confidence >= 65) return 'Active'
  if (confidence > 0 || active) return 'Learning'
  return 'Waiting'
}

function formatConfidence(value: any) {
  return `${clamp(toFiniteNumber(value, 0)).toFixed(1)}%`
}

function getStatusClass(status: BrainStatus) {
  if (status === 'Active') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
  if (status === 'Learning') return 'border-amber-400/30 bg-amber-400/10 text-amber-200'
  if (status === 'Conflict') return 'border-red-400/30 bg-red-400/10 text-red-200'
  if (status === 'Unavailable') return 'border-gray-500/20 bg-gray-500/10 text-gray-400'
  return 'border-blue-400/30 bg-blue-400/10 text-blue-200'
}

function getDirectionClass(direction: BrainDirection) {
  if (direction === 'Bullish') return 'text-emerald-300'
  if (direction === 'Bearish') return 'text-red-300'
  if (direction === 'Mixed') return 'text-amber-300'
  return 'text-gray-300'
}

function boolBadge(value: boolean) {
  return value ? 'Yes' : 'No'
}

function boolClass(value: boolean) {
  return value
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
    : 'border-dark-600 bg-dark-900 text-gray-500'
}

function getNrtrDirectionFromSettings(settings: any) {
  const mode = String(settings?.nrtrMode ?? 'Off')
  if (mode === 'Off') return 'Neutral'
  return normalizeDirection(settings?.direction ?? settings?.side ?? settings?.bias ?? settings?.trend)
}

function buildNeuralBrainScorecard({
  signal,
  scorecards,
  mlFeatures,
  overlayPayload,
  unifiedIntelligence,
  aiDecision,
}: Pick<AiBrainContextPanelProps, 'signal' | 'scorecards' | 'mlFeatures' | 'overlayPayload' | 'unifiedIntelligence' | 'aiDecision'>): NeuralBrainScorecard {
  const brainBuyPct = clamp(maxReadableNumber([
    [aiDecision, ['brainBuyPct', 'brainBuy', 'buyProbability', 'buyConfidence', 'details.neuralBrain.brainBuyPct', 'details.neuralBrain.buyPct', 'details.directionalContext.buyConfidence']],
    [signal, ['brainBuyPct', 'brainBuy', 'buyConfidence', 'bullScore', 'bullishScore']],
    [scorecards, ['brainBuyPct', 'brainBuy', 'buyConfidence', 'bullScore', 'overall.bullScore', 'main.bullScore']],
    [mlFeatures, ['brainBuyPct', 'brainBuy', 'buyConfidence']],
    [unifiedIntelligence, ['brainBuyPct', 'brainBuy', 'buyConfidence', 'bullScore', 'scorecards.bullScore', 'neuralBrain.brainBuyPct']],
  ]))

  const brainSellPct = clamp(maxReadableNumber([
    [aiDecision, ['brainSellPct', 'brainSell', 'sellProbability', 'sellConfidence', 'details.neuralBrain.brainSellPct', 'details.neuralBrain.sellPct', 'details.directionalContext.sellConfidence']],
    [signal, ['brainSellPct', 'brainSell', 'sellConfidence', 'bearScore', 'bearishScore']],
    [scorecards, ['brainSellPct', 'brainSell', 'sellConfidence', 'bearScore', 'overall.bearScore', 'main.bearScore']],
    [mlFeatures, ['brainSellPct', 'brainSell', 'sellConfidence']],
    [unifiedIntelligence, ['brainSellPct', 'brainSell', 'sellConfidence', 'bearScore', 'scorecards.bearScore', 'neuralBrain.brainSellPct']],
  ]))

  const targetHitPct = clamp(maxReadableNumber([
    [aiDecision, ['targetHitPct', 'targetHitProbability', 'targetConfidence', 'details.neuralBrain.targetHitPct', 'details.directionalContext.targetConfidence']],
    [signal, ['targetHitPct', 'targetHitProbability', 'targetConfidence', 'targetMlConfidence', 'targetMl.targetConfidence', 'targetPlan.targetConfidence']],
    [scorecards, ['targetHitPct', 'targetHitProbability', 'targetConfidence']],
    [mlFeatures, ['targetHitPct', 'targetHitProbability', 'targetConfidence']],
    [overlayPayload, ['targetHitPct', 'targetHitProbability', 'targetConfidence', 'targetMl.targetConfidence', 'targetPlan.targetConfidence']],
    [unifiedIntelligence, ['targetHitPct', 'targetHitProbability', 'targetConfidence', 'targetMl.targetConfidence', 'neuralBrain.targetHitPct']],
  ]))

  const reversalRiskPct = clamp(maxReadableNumber([
    [aiDecision, ['reversalRiskPct', 'reversalRisk', 'details.neuralBrain.reversalRiskPct', 'details.directionalContext.reversalRisk']],
    [signal, ['reversalRiskPct', 'reversalRisk']],
    [scorecards, ['reversalRiskPct', 'reversalRisk']],
    [mlFeatures, ['reversalRiskPct', 'reversalRisk']],
    [unifiedIntelligence, ['reversalRiskPct', 'reversalRisk', 'neuralBrain.reversalRiskPct']],
  ]))

  const chopRiskPct = clamp(maxReadableNumber([
    [aiDecision, ['chopRiskPct', 'chopRisk', 'details.neuralBrain.chopRiskPct', 'details.directionalContext.chopRisk']],
    [signal, ['chopRiskPct', 'chopRisk', 'chopProbability']],
    [scorecards, ['chopRiskPct', 'chopRisk', 'chopProbability']],
    [mlFeatures, ['chopRiskPct', 'chopRisk', 'chopProbability']],
    [unifiedIntelligence, ['chopRiskPct', 'chopRisk', 'neuralBrain.chopRiskPct']],
  ]))

  const explicitDecisionStrength = clamp(maxReadableNumber([
    [aiDecision, ['decisionStrengthPct', 'decisionStrength', 'confidence', 'details.neuralBrain.decisionStrengthPct']],
    [signal, ['decisionStrengthPct', 'decisionStrength', 'confidence']],
    [scorecards, ['decisionStrengthPct', 'decisionStrength', 'confidence']],
    [unifiedIntelligence, ['decisionStrengthPct', 'decisionStrength', 'confidence', 'neuralBrain.decisionStrengthPct']],
  ]))

  const bestDirection = normalizeDirection(
    readPath(aiDecision, ['bestDirection', 'direction', 'details.neuralBrain.bestDirection']) ??
    readPath(signal, ['bestDirection', 'direction', 'signal']) ??
    readPath(scorecards, ['bestDirection', 'direction']) ??
    directionFromScores(brainBuyPct, brainSellPct)
  )

  const decision = String(
    readPath(aiDecision, ['decision', 'finalDecision', 'action']) ??
    readPath(signal, ['decision', 'signal', 'action']) ??
    'HOLD'
  ).toUpperCase()

  const decisionStrengthPct = explicitDecisionStrength > 0
    ? explicitDecisionStrength
    : clamp(Math.abs(brainBuyPct - brainSellPct))

  const isDecisionAligned =
    decision === 'HOLD' ||
    (decision === 'BUY' && bestDirection === 'Bullish') ||
    (decision === 'SELL' && bestDirection === 'Bearish')

  const riskStatus =
    chopRiskPct >= 60 || reversalRiskPct >= 65
      ? 'Risk Watch'
      : bestDirection === 'Mixed'
        ? 'Mixed'
        : decisionStrengthPct <= 0
          ? 'Waiting'
          : isDecisionAligned
            ? 'Aligned'
            : 'Risk Watch'

  return {
    brainBuyPct,
    brainSellPct,
    targetHitPct,
    reversalRiskPct,
    chopRiskPct,
    decisionStrengthPct,
    bestDirection,
    decision,
    riskStatus,
  }
}

function buildBrainRows({
  signal,
  scorecards,
  mlFeatures,
  overlayPayload,
  unifiedIntelligence,
  aiDecision,
  mainSettings,
  miniOneSettings,
  miniTwoSettings,
}: Omit<AiBrainContextPanelProps, 'symbol' | 'timeframe'>): BrainRow[] {
  const neuralBrain = buildNeuralBrainScorecard({
    signal,
    scorecards,
    mlFeatures,
    overlayPayload,
    unifiedIntelligence,
    aiDecision,
  })

  const bullScore = Math.max(
    readNumber(signal, ['bullScore', 'bullishScore']),
    readNumber(scorecards, ['bullScore', 'overall.bullScore', 'main.bullScore']),
    readNumber(unifiedIntelligence, ['bullScore', 'scorecards.bullScore']),
  )

  const bearScore = Math.max(
    readNumber(signal, ['bearScore', 'bearishScore']),
    readNumber(scorecards, ['bearScore', 'overall.bearScore', 'main.bearScore']),
    readNumber(unifiedIntelligence, ['bearScore', 'scorecards.bearScore']),
  )

  const smcDirection = normalizeDirection(
    readPath(scorecards, ['smc.direction', 'smcStructure.direction', 'SMC Structure.direction']) ??
    readPath(mlFeatures, ['smc.direction', 'structure.direction']) ??
    readPath(unifiedIntelligence, ['smc.direction', 'structure.direction']) ??
    directionFromScores(bullScore, bearScore)
  )

  const alphaScore = Math.max(
    readNumber(scorecards, ['alphaScore', 'alphaX.score', 'alphaDlm.score', 'AlphaX DLM / Profile.score']),
    readNumber(mlFeatures, ['alphaScore', 'alphaDlmScore', 'liquidityPressure']),
    readNumber(unifiedIntelligence, ['alphaScore', 'alphaDlm.score']),
  )

  const orderBlockScore = Math.max(
    readNumber(scorecards, ['orderBlocks.score', 'Order Blocks.score']),
    readNumber(mlFeatures, ['orderBlockScore', 'orderBlocks.score']),
    readNumber(unifiedIntelligence, ['orderBlocks.score']),
  )

  const liquidityScore = Math.max(
    readNumber(scorecards, ['liquidity.score', 'Liquidity.score', 'sweeps.score']),
    readNumber(mlFeatures, ['liquidityScore', 'sweepScore', 'liquiditySweepScore']),
    readNumber(unifiedIntelligence, ['liquidity.score', 'sweeps.score']),
  )

  const fvgScore = Math.max(
    readNumber(scorecards, ['fvg.score', 'FVG.score', 'pdZones.score']),
    readNumber(mlFeatures, ['fvgScore', 'pdZoneScore']),
    readNumber(unifiedIntelligence, ['fvg.score', 'pdZones.score']),
  )

  const meterScore = Math.max(
    readNumber(signal, ['confidence']),
    readNumber(scorecards, ['meterScore', 'technicalMeter.score']),
    readNumber(unifiedIntelligence, ['technicalMeter.score']),
    Math.max(bullScore, bearScore),
  )

  const ghostConfidence = Math.max(
    readNumber(signal, ['ghostConfidence', 'confidence', 'mlConfidence']),
    readNumber(overlayPayload, ['ghostConfidence', 'mlConfidence']),
    readNumber(unifiedIntelligence, ['ghostConfidence', 'components.ghost.confidence']),
    readNumber(aiDecision, ['details.directionalContext.ghostConfidence']),
  )

  const targetConfidence = Math.max(
    readNumber(signal, ['targetConfidence', 'targetMlConfidence', 'targetMl.targetConfidence', 'targetPlan.targetConfidence']),
    readNumber(overlayPayload, ['targetConfidence', 'targetMl.targetConfidence', 'targetPlan.targetConfidence']),
    readNumber(unifiedIntelligence, ['targetConfidence', 'targetMl.targetConfidence']),
    readNumber(aiDecision, ['details.directionalContext.targetConfidence']),
  )

  const entryConfidence = Math.max(
    readNumber(signal, ['entryConfidence', 'entryMlConfidence']),
    readNumber(aiDecision, ['details.directionalContext.entryConfidence']),
  )

  const aiConfidence = readNumber(aiDecision, ['confidence'])
  const aiRawDecision = normalizeDirection(readPath(aiDecision, ['rawDecision', 'decision']))
  const aiFinalDecision = normalizeDirection(readPath(aiDecision, ['decision']))

  const nrtrMain = normalizeDirection(
    readPath(scorecards, ['nrtrStrategyFeeds.main.direction', 'nrtrCharts.main.direction', 'nrtrMain.direction']) ??
    getNrtrDirectionFromSettings(mainSettings)
  )
  const nrtrMini1 = normalizeDirection(
    readPath(scorecards, ['nrtrStrategyFeeds.mini1.direction', 'nrtrCharts.mini1.direction', 'nrtrMini1.direction']) ??
    getNrtrDirectionFromSettings(miniOneSettings)
  )
  const nrtrMini2 = normalizeDirection(
    readPath(scorecards, ['nrtrStrategyFeeds.mini2.direction', 'nrtrCharts.mini2.direction', 'nrtrMini2.direction']) ??
    getNrtrDirectionFromSettings(miniTwoSettings)
  )

  const nrtrDirections = [nrtrMain, nrtrMini1, nrtrMini2].filter((direction) => direction !== 'Neutral')
  const nrtrDirection =
    nrtrDirections.length === 0
      ? 'Neutral'
      : nrtrDirections.every((direction) => direction === nrtrDirections[0])
        ? nrtrDirections[0]
        : 'Mixed'

  const rows: BrainRow[] = [
    {
      name: 'Neural Brain Score',
      group: 'Neural Brain',
      status: statusFromConfidence(neuralBrain.decisionStrengthPct, neuralBrain.decisionStrengthPct > 0),
      direction: neuralBrain.bestDirection,
      confidence: clamp(neuralBrain.decisionStrengthPct),
      usedByGhostMl: true,
      usedByTargetMl: true,
      usedByAiTrader: true,
      reason: `Decision ${neuralBrain.decision}; risk status ${neuralBrain.riskStatus}. Buy ${formatConfidence(neuralBrain.brainBuyPct)}, sell ${formatConfidence(neuralBrain.brainSellPct)}, target hit ${formatConfidence(neuralBrain.targetHitPct)}.`,
    },
    {
      name: 'SMC Structure',
      group: 'Market Structure',
      status: statusFromConfidence(Math.max(bullScore, bearScore), bullScore > 0 || bearScore > 0),
      direction: smcDirection,
      confidence: clamp(Math.max(bullScore, bearScore)),
      usedByGhostMl: true,
      usedByTargetMl: true,
      usedByAiTrader: true,
      reason: 'Structure bias from BOS/CHoCH/MSS, scorecards, and main market state.',
    },
    {
      name: 'AlphaX / DLM Pressure',
      group: 'Liquidity Pressure',
      status: statusFromConfidence(alphaScore, alphaScore > 0),
      direction: normalizeDirection(readPath(scorecards, ['alphaDirection', 'alphaDlm.direction']) ?? smcDirection),
      confidence: clamp(alphaScore),
      usedByGhostMl: true,
      usedByTargetMl: true,
      usedByAiTrader: true,
      reason: 'Liquidity pressure and profile context used to confirm directional pressure.',
    },
    {
      name: 'Order Blocks',
      group: 'Zones',
      status: statusFromConfidence(orderBlockScore, orderBlockScore > 0),
      direction: normalizeDirection(readPath(scorecards, ['orderBlocks.direction']) ?? smcDirection),
      confidence: clamp(orderBlockScore),
      usedByGhostMl: true,
      usedByTargetMl: true,
      usedByAiTrader: true,
      reason: 'Nearby bullish/bearish order blocks affect rejection and target context.',
    },
    {
      name: 'Liquidity / Sweeps',
      group: 'Liquidity',
      status: statusFromConfidence(liquidityScore, liquidityScore > 0),
      direction: normalizeDirection(readPath(scorecards, ['liquidity.direction', 'sweeps.direction']) ?? smcDirection),
      confidence: clamp(liquidityScore),
      usedByGhostMl: true,
      usedByTargetMl: true,
      usedByAiTrader: true,
      reason: 'Sweep, inducement, and liquidity pool behavior influences target selection.',
    },
    {
      name: 'FVG / PD Zones',
      group: 'Zones',
      status: statusFromConfidence(fvgScore, fvgScore > 0),
      direction: normalizeDirection(readPath(scorecards, ['fvg.direction', 'pdZones.direction']) ?? smcDirection),
      confidence: clamp(fvgScore),
      usedByGhostMl: true,
      usedByTargetMl: true,
      usedByAiTrader: true,
      reason: 'Fair value gaps and premium/discount areas help decide where price may rebalance.',
    },
    {
      name: 'Meters / Gauges',
      group: 'Confirmation',
      status: statusFromConfidence(meterScore, meterScore > 0),
      direction: directionFromScores(bullScore, bearScore),
      confidence: clamp(meterScore),
      usedByGhostMl: true,
      usedByTargetMl: true,
      usedByAiTrader: true,
      reason: 'Dashboard sentiment, technical meter, pressure gauges, and signal card confirmation.',
    },
    {
      name: 'Ghost ML',
      group: 'ML Layer',
      status: statusFromConfidence(ghostConfidence, ghostConfidence > 0),
      direction: normalizeDirection(readPath(signal, ['ghostDirection', 'direction', 'signal']) ?? aiRawDecision),
      confidence: clamp(ghostConfidence),
      usedByGhostMl: true,
      usedByTargetMl: true,
      usedByAiTrader: true,
      reason: 'Projected candle path and ghost confidence from unified projection logic.',
    },
    {
      name: 'Target Price ML',
      group: 'ML Layer',
      status: statusFromConfidence(targetConfidence, targetConfidence > 0),
      direction: normalizeDirection(readPath(signal, ['targetDirection', 'targetMl.direction']) ?? aiRawDecision),
      confidence: clamp(targetConfidence),
      usedByGhostMl: false,
      usedByTargetMl: true,
      usedByAiTrader: true,
      reason: 'Unified target source. Primary target when available; ghost overlay target can be fallback.',
    },
    {
      name: 'Entry ML',
      group: 'ML Layer',
      status: statusFromConfidence(entryConfidence, entryConfidence > 0),
      direction: aiRawDecision,
      confidence: clamp(entryConfidence),
      usedByGhostMl: false,
      usedByTargetMl: false,
      usedByAiTrader: true,
      reason: 'Walk-forward entry quality and trade-context learning.',
    },
    {
      name: 'NRTR Strategy Context',
      group: 'Strategy Context',
      status: nrtrDirection === 'Neutral' ? 'Waiting' : nrtrDirection === 'Mixed' ? 'Conflict' : 'Active',
      direction: nrtrDirection,
      confidence: nrtrDirection === 'Neutral' ? 0 : nrtrDirection === 'Mixed' ? 50 : 70,
      usedByGhostMl: false,
      usedByTargetMl: false,
      usedByAiTrader: true,
      reason: 'Strategy context only. It does not feed Ghost ML or Target Price ML.',
    },
    {
      name: 'AI Trader Final Context',
      group: 'Decision Engine',
      status: aiConfidence >= 62 ? 'Active' : aiConfidence > 0 ? 'Learning' : 'Waiting',
      direction: aiFinalDecision === 'Neutral' ? aiRawDecision : aiFinalDecision,
      confidence: clamp(aiConfidence),
      usedByGhostMl: false,
      usedByTargetMl: false,
      usedByAiTrader: true,
      reason: String(readPath(aiDecision, ['reason']) ?? 'AI trader combines all approved context into HOLD / BUY / SELL.'),
    },
  ]

  return rows
}

function SummaryPill({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'bull' | 'bear' | 'warn' | 'neutral'
}) {
  const className =
    tone === 'bull'
      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
      : tone === 'bear'
        ? 'border-red-400/30 bg-red-400/10 text-red-200'
        : tone === 'warn'
          ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
          : 'border-dark-600 bg-dark-900 text-gray-300'

  return (
    <div className={`rounded-xl border px-3 py-2 ${className}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-sm font-black">{value}</div>
    </div>
  )
}

function NeuralMetricCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'bull' | 'bear' | 'warn' | 'neutral'
}) {
  const className =
    tone === 'bull'
      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
      : tone === 'bear'
        ? 'border-red-400/30 bg-red-400/10 text-red-200'
        : tone === 'warn'
          ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
          : 'border-cyan-400/20 bg-cyan-400/5 text-cyan-100'

  return (
    <div className={`rounded-xl border px-4 py-3 ${className}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.18em] opacity-70">{label}</div>
      <div className="mt-1 text-xl font-black">{value}</div>
    </div>
  )
}

export default function AiBrainContextPanel({
  symbol,
  timeframe,
  signal,
  scorecards,
  mlFeatures,
  overlayPayload,
  unifiedIntelligence,
  aiDecision,
  mainSettings,
  miniOneSettings,
  miniTwoSettings,
}: AiBrainContextPanelProps) {
  const [showDetails, setShowDetails] = useState(false)
  const lastSnapshotKeyRef = useRef('')

  const neuralBrain = useMemo(() => buildNeuralBrainScorecard({
    signal,
    scorecards,
    mlFeatures,
    overlayPayload,
    unifiedIntelligence,
    aiDecision,
  }), [signal, scorecards, mlFeatures, overlayPayload, unifiedIntelligence, aiDecision])

  const rows = useMemo(() => buildBrainRows({
    signal,
    scorecards,
    mlFeatures,
    overlayPayload,
    unifiedIntelligence,
    aiDecision,
    mainSettings,
    miniOneSettings,
    miniTwoSettings,
  }), [signal, scorecards, mlFeatures, overlayPayload, unifiedIntelligence, aiDecision, mainSettings, miniOneSettings, miniTwoSettings])

  const activeRows = rows.filter((row) => row.status === 'Active').length
  const learningRows = rows.filter((row) => row.status === 'Learning').length
  const conflicts = rows.filter((row) => row.status === 'Conflict' || row.direction === 'Mixed').length
  const ghostUsed = rows.filter((row) => row.usedByGhostMl).length
  const targetUsed = rows.filter((row) => row.usedByTargetMl).length
  const traderUsed = rows.filter((row) => row.usedByAiTrader).length

  const aiDecisionLabel = neuralBrain.decision
  const aiTone = aiDecisionLabel === 'BUY' ? 'bull' : aiDecisionLabel === 'SELL' ? 'bear' : 'warn'
  const riskTone = neuralBrain.riskStatus === 'Aligned' ? 'bull' : neuralBrain.riskStatus === 'Risk Watch' ? 'bear' : neuralBrain.riskStatus === 'Mixed' ? 'warn' : 'neutral'
  const targetSourceLabel = String(readPath(signal, ['targetSource']) ?? readPath(unifiedIntelligence, ['targetSource']) ?? 'target_unavailable')
  const targetPriceLabel = (() => {
    const value = readPath(signal, ['targetPrice']) ?? readPath(unifiedIntelligence, ['targetPrice'])
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric > 0 ? numeric.toFixed(5) : '—'
  })()

  useEffect(() => {
    if (typeof window === 'undefined') return

    const payload = {
      symbol,
      timeframe,
      buyConfidence: Number(neuralBrain.brainBuyPct.toFixed(2)),
      sellConfidence: Number(neuralBrain.brainSellPct.toFixed(2)),
      targetHitProbability: Number(neuralBrain.targetHitPct.toFixed(2)),
      reversalRisk: Number(neuralBrain.reversalRiskPct.toFixed(2)),
      chopRisk: Number(neuralBrain.chopRiskPct.toFixed(2)),
      bestDirection: neuralBrain.bestDirection,
      decision: neuralBrain.decision,
      decisionStrength: Number(neuralBrain.decisionStrengthPct.toFixed(2)),
      riskStatus: neuralBrain.riskStatus,
      scorecardInputs: {
        rows,
        scorecards,
        mlFeatures,
        overlayPayload,
        unifiedIntelligence,
        aiDecision,
        signal,
        targetSource: targetSourceLabel,
        targetPrice: targetPriceLabel,
      },
      timestamp: new Date().toISOString(),
      source: 'AiBrainContextPanel',
    }

    const snapshotKey = JSON.stringify({
      symbol,
      timeframe,
      buy: payload.buyConfidence,
      sell: payload.sellConfidence,
      target: payload.targetHitProbability,
      reversal: payload.reversalRisk,
      chop: payload.chopRisk,
      decision: payload.decision,
      direction: payload.bestDirection,
      targetSource: targetSourceLabel,
      targetPrice: targetPriceLabel,
      minute: payload.timestamp.slice(0, 16),
    })

    if (snapshotKey === lastSnapshotKeyRef.current) return
    lastSnapshotKeyRef.current = snapshotKey

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      fetch('/api/neural-brain/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }).catch(() => {
        // Snapshot memory is non-blocking. Never break chart rendering.
      })
    }, 800)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [
    symbol,
    timeframe,
    neuralBrain,
    rows,
    scorecards,
    mlFeatures,
    overlayPayload,
    unifiedIntelligence,
    aiDecision,
    signal,
    targetSourceLabel,
    targetPriceLabel,
  ])

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-cyan-400/30 bg-dark-900/80 p-4 shadow-xl"
    >
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black text-white">Neural Brain Table</h2>
            <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-cyan-200">
              Unified AI Brain Context
            </span>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-200">
              Neural Brain Visible
            </span>
            <span className="rounded-full border border-purple-400/30 bg-purple-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-purple-200">
              {symbol} • {timeframe}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Shows neural brain scoring plus the market-structure, liquidity, zone, ghost, target, entry, and strategy-context inputs visible to the AI.
          </p>
        </div>

        <div className="grid min-w-[260px] grid-cols-2 gap-2 sm:min-w-[360px] sm:grid-cols-3">
          <SummaryPill label="AI Decision" value={aiDecisionLabel} tone={aiTone as any} />
          <SummaryPill label="Active Brain Rows" value={String(activeRows)} tone="bull" />
          <SummaryPill label="Learning" value={String(learningRows)} tone="warn" />
          <SummaryPill label="Conflicts" value={String(conflicts)} tone={conflicts > 0 ? 'bear' : 'neutral'} />
          <SummaryPill label="Ghost ML Inputs" value={String(ghostUsed)} />
          <SummaryPill label="Target ML Inputs" value={String(targetUsed)} />
        </div>
      </div>

      <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/5 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">Neural Brain</div>
            <div className="text-sm font-black text-white">Brain Buy / Sell / Risk / Decision Scorecard</div>
          </div>
          <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase ${getDirectionClass(neuralBrain.bestDirection)}`}>
            {neuralBrain.bestDirection}
          </span>
        </div>

        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
          <NeuralMetricCard label="Brain Buy %" value={formatConfidence(neuralBrain.brainBuyPct)} tone="bull" />
          <NeuralMetricCard label="Brain Sell %" value={formatConfidence(neuralBrain.brainSellPct)} tone="bear" />
          <NeuralMetricCard label="Target Hit %" value={formatConfidence(neuralBrain.targetHitPct)} tone="bull" />
          <NeuralMetricCard label="Reversal Risk %" value={formatConfidence(neuralBrain.reversalRiskPct)} />
          <NeuralMetricCard label="Chop Risk %" value={formatConfidence(neuralBrain.chopRiskPct)} />
          <NeuralMetricCard label="Decision Strength %" value={formatConfidence(neuralBrain.decisionStrengthPct)} tone={neuralBrain.decisionStrengthPct >= 62 ? 'bull' : neuralBrain.decisionStrengthPct > 0 ? 'warn' : 'neutral'} />
          <NeuralMetricCard label="Best Direction" value={neuralBrain.bestDirection} />
          <NeuralMetricCard label="Decision" value={neuralBrain.decision} tone={aiTone as any} />
          <NeuralMetricCard label="Risk Watch / Aligned" value={neuralBrain.riskStatus} tone={riskTone as any} />
          <NeuralMetricCard label="Neural Source" value="Dashboard" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-400">
          Phase 2 memory is recording one Neural Brain snapshot per changed minute/score state.
        </div>
        <button
          type="button"
          onClick={() => setShowDetails((previous) => !previous)}
          className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-cyan-200 transition hover:bg-cyan-400/20"
        >
          {showDetails ? 'Collapse context details' : `Expand context details (${rows.length})`}
        </button>
      </div>

      {showDetails && (
        <>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_1fr_1fr]">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-200/70">
                Used by AI Trader
              </div>
              <div className="mt-1 text-2xl font-black text-emerald-100">
                {traderUsed} context rows
              </div>
            </div>

            <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                Target Source
              </div>
              <div className="mt-1 text-2xl font-black text-white">{targetSourceLabel}</div>
            </div>

            <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                Target Price
              </div>
              <div className="mt-1 text-2xl font-black text-white">{targetPriceLabel}</div>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full min-w-[1000px] text-left text-xs">
              <thead className="bg-slate-950/70 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Brain Source</th>
                  <th className="px-4 py-3">Group</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3">Confidence</th>
                  <th className="px-4 py-3">Ghost ML</th>
                  <th className="px-4 py-3">Target ML</th>
                  <th className="px-4 py-3">AI Trader</th>
                  <th className="px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((row) => (
                  <tr key={`${row.group}-${row.name}`} className="bg-slate-950/20">
                    <td className="px-4 py-3 font-black text-white">{row.name}</td>
                    <td className="px-4 py-3 text-slate-400">{row.group}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase ${getStatusClass(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className={`px-4 py-3 font-black ${getDirectionClass(row.direction)}`}>{row.direction}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full rounded-full bg-slate-200" style={{ width: `${clamp(row.confidence)}%` }} />
                        </div>
                        <span className="font-black text-white">{formatConfidence(row.confidence)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase ${boolClass(row.usedByGhostMl)}`}>{boolBadge(row.usedByGhostMl)}</span></td>
                    <td className="px-4 py-3"><span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase ${boolClass(row.usedByTargetMl)}`}>{boolBadge(row.usedByTargetMl)}</span></td>
                    <td className="px-4 py-3"><span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase ${boolClass(row.usedByAiTrader)}`}>{boolBadge(row.usedByAiTrader)}</span></td>
                    <td className="px-4 py-3 text-slate-400">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-400">
            <span className="font-black text-cyan-300">Rule:</span>{' '}
            SMC, AlphaX/DLM, order blocks, liquidity, FVG, meters, and ghost context can feed Ghost ML and Target Price ML.
            NRTR remains strategy context only. The AI Trader reads all approved ML/context layers but does not send orders outside the dashboard.
          </div>
        </>
      )}
    </motion.div>
  )
}
