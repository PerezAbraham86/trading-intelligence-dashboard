export type NeuralBrainInput = {
  symbol?: string
  timeframe?: string
  candles?: Array<Record<string, unknown>>
  scorecards?: Record<string, unknown>
  mlFeatures?: Record<string, unknown>
  overlayPayload?: Record<string, unknown>
  chartOverlays?: Record<string, unknown>
  unifiedIntelligence?: Record<string, unknown>
  externalData?: Record<string, unknown>
}

export type NeuralBrainScorecard = {
  eventType: 'NEURAL_BRAIN_SCORECARD'
  status: 'Ready'
  engineVersion: string
  symbol: string
  timeframe: string
  buyConfidence: number
  sellConfidence: number
  reversalRisk: number
  targetHitProbability: number
  chopRisk: number
  bestDirection: 'bullish' | 'bearish' | 'neutral'
  decision: string
  noTradeWarning: boolean
  modelType: string
  trainedModelReady: boolean
  inputs: Record<string, number | string | boolean>
  explain: string[]
  createdAt: string
}

export const NEURAL_BRAIN_VERSION = 'neural_brain_scorecards_v1_next'

function nowIso() {
  return new Date().toISOString()
}

function clamp(value: number, low = 0, high = 100) {
  if (!Number.isFinite(value)) return low
  return Math.max(low, Math.min(high, value))
}

function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sigmoidScore(value: number, center = 0, scale = 18) {
  const safeScale = Math.max(Math.abs(scale), 1e-9)
  const z = Math.max(-40, Math.min(40, (value - center) / safeScale))
  return 100 / (1 + Math.exp(-z))
}

function directionToValue(value: unknown) {
  const text = String(value ?? '').toLowerCase()
  if (['bull', 'buy', 'long', 'up', 'call'].some((token) => text.includes(token))) return 1
  if (['bear', 'sell', 'short', 'down', 'put'].some((token) => text.includes(token))) return -1
  return 0
}

function firstNumber(payload: unknown, keys: string[], fallback = 0): number {
  if (!payload || typeof payload !== 'object') return fallback

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = firstNumber(item, keys, Number.NaN)
      if (Number.isFinite(found)) return found
    }
    return fallback
  }

  const raw = payload as Record<string, unknown>
  const lowered = new Map(Object.keys(raw).map((key) => [key.toLowerCase(), key]))
  for (const key of keys) {
    const actual = lowered.get(key.toLowerCase())
    if (actual) return toNumber(raw[actual], fallback)
  }

  for (const value of Object.values(raw)) {
    const found = firstNumber(value, keys, Number.NaN)
    if (Number.isFinite(found)) return found
  }

  return fallback
}

function latestCandleFeatures(candles: Array<Record<string, unknown>> = []) {
  const rows = Array.isArray(candles) ? candles : []
  if (!rows.length) {
    return {
      priceChangePct: 0,
      bodyPct: 0,
      upperWickPct: 0,
      lowerWickPct: 0,
      rangePct: 0,
      trendSlopePct: 0,
      momentum3Pct: 0,
      momentum8Pct: 0,
    }
  }

  const last = rows[rows.length - 1]
  const prev = rows.length > 1 ? rows[rows.length - 2] : last
  const close = toNumber(last.close, 0)
  const open = toNumber(last.open, close)
  const high = toNumber(last.high, Math.max(open, close))
  const low = toNumber(last.low, Math.min(open, close))
  const prevClose = toNumber(prev.close, close)
  const candleRange = Math.max(high - low, 1e-9)
  const pct = (delta: number, base = close) => (base ? (delta / base) * 100 : 0)

  const close3 = rows.length >= 4 ? toNumber(rows[rows.length - 4].close, close) : close
  const close8 = rows.length >= 9 ? toNumber(rows[rows.length - 9].close, close) : close
  const close20 = rows.length >= 21 ? toNumber(rows[rows.length - 21].close, close) : close

  return {
    priceChangePct: pct(close - prevClose, prevClose),
    bodyPct: (Math.abs(close - open) / candleRange) * 100,
    upperWickPct: (Math.max(high - Math.max(open, close), 0) / candleRange) * 100,
    lowerWickPct: (Math.max(Math.min(open, close) - low, 0) / candleRange) * 100,
    rangePct: pct(candleRange),
    trendSlopePct: pct(close - close20, close20),
    momentum3Pct: pct(close - close3, close3),
    momentum8Pct: pct(close - close8, close8),
  }
}

export function buildNeuralBrainScorecard(input: NeuralBrainInput): NeuralBrainScorecard {
  const symbol = String(input.symbol || 'MES1!')
  const timeframe = String(input.timeframe || '1m')
  const candles = Array.isArray(input.candles) ? input.candles : []
  const scorecards = input.scorecards || {}
  const mlFeatures = input.mlFeatures || {}
  const overlayPayload = input.overlayPayload || input.chartOverlays || {}
  const unifiedIntelligence = input.unifiedIntelligence || {}
  const externalData = input.externalData || {}
  const candleFeatures = latestCandleFeatures(candles)

  const bullScore = firstNumber(scorecards, ['bullScore', 'bull', 'bullishScore'], 50)
  const bearScore = firstNumber(scorecards, ['bearScore', 'bear', 'bearishScore'], 50)
  const netBias = firstNumber(scorecards, ['netBias', 'bias', 'net'], bullScore - bearScore)

  const smcStrength = firstNumber(scorecards, ['smcStrength', 'structureStrength'], firstNumber(mlFeatures, ['smcStrength'], 50))
  const alphaxStrength = firstNumber(scorecards, ['alphaxStrength', 'alphaXStrength', 'dlmStrength'], firstNumber(mlFeatures, ['alphaxStrength'], 50))
  const ghostStrength = firstNumber(scorecards, ['ghostConfidence', 'ghostStrength'], firstNumber(mlFeatures, ['ghostConfidence'], 50))

  const smcDir = directionToValue((scorecards as any).smcDirection ?? (scorecards as any).smc ?? (mlFeatures as any).smcDirection)
  const alphaxDir = directionToValue((scorecards as any).alphaxDirection ?? (scorecards as any).alphax ?? (mlFeatures as any).alphaxDirection)
  const ghostDir = directionToValue((scorecards as any).ghostDirection ?? (scorecards as any).ghost ?? (mlFeatures as any).ghostDirection)

  const bullPressure = firstNumber(scorecards, ['alphaxBullPressure', 'bullPressurePct', 'buyPressurePct'], firstNumber(overlayPayload, ['bullPressurePct', 'buyPressurePct'], 50))
  const bearPressure = firstNumber(scorecards, ['alphaxBearPressure', 'bearPressurePct', 'sellPressurePct'], firstNumber(overlayPayload, ['bearPressurePct', 'sellPressurePct'], 50))

  const macroRisk = firstNumber(externalData, ['macroRisk', 'fredMacroRisk', 'risk'], firstNumber(unifiedIntelligence, ['macroRisk', 'risk'], 35))
  const optionsReversalRisk = firstNumber(externalData, ['optionsReversalRisk', 'gammaRisk', 'optionsConflictRisk'], 0)

  const directionAlignment = (smcDir + alphaxDir + ghostDir) / 3
  const pressureBias = bullPressure - bearPressure
  const momentumBias = candleFeatures.momentum3Pct * 8 + candleFeatures.momentum8Pct * 4 + candleFeatures.trendSlopePct * 2
  const wickReversalBias = candleFeatures.upperWickPct - candleFeatures.lowerWickPct

  const rawBuy =
    0.35 * netBias +
    0.22 * pressureBias +
    18 * directionAlignment +
    0.12 * smcStrength * Math.max(smcDir, 0) +
    0.1 * alphaxStrength * Math.max(alphaxDir, 0) +
    0.1 * ghostStrength * Math.max(ghostDir, 0) +
    momentumBias -
    0.25 * macroRisk

  const rawSell =
    -0.35 * netBias -
    0.22 * pressureBias -
    18 * directionAlignment +
    0.12 * smcStrength * Math.abs(Math.min(smcDir, 0)) +
    0.1 * alphaxStrength * Math.abs(Math.min(alphaxDir, 0)) +
    0.1 * ghostStrength * Math.abs(Math.min(ghostDir, 0)) -
    momentumBias -
    0.25 * macroRisk

  const disagreement = Math.abs(smcDir - alphaxDir) + Math.abs(smcDir - ghostDir) + Math.abs(alphaxDir - ghostDir)
  const chopRisk = clamp(35 + disagreement * 13 - Math.abs(netBias) * 0.18 + macroRisk * 0.22)
  const reversalRisk = clamp(28 + Math.abs(wickReversalBias) * 0.35 + optionsReversalRisk * 0.35 + disagreement * 8 - ghostStrength * 0.12)

  const buyConfidence = clamp(sigmoidScore(rawBuy, 5, 18))
  const sellConfidence = clamp(sigmoidScore(rawSell, 5, 18))

  const bestDirection: NeuralBrainScorecard['bestDirection'] =
    buyConfidence > sellConfidence + 5 ? 'bullish' : sellConfidence > buyConfidence + 5 ? 'bearish' : 'neutral'

  const targetHitProbability = clamp(
    Math.max(buyConfidence, sellConfidence) * 0.72 +
      ghostStrength * 0.18 +
      (100 - chopRisk) * 0.1 -
      reversalRisk * 0.12,
  )

  let decision = 'wait_for_alignment'
  if (bestDirection === 'bullish') {
    decision = targetHitProbability >= 55 && reversalRisk < 55 ? 'bullish_continuation' : 'bullish_watch'
  } else if (bestDirection === 'bearish') {
    decision = targetHitProbability >= 55 && reversalRisk < 55 ? 'bearish_continuation' : 'bearish_watch'
  }

  const noTradeWarning = chopRisk >= 62 || reversalRisk >= 70 || targetHitProbability < 38
  if (noTradeWarning && decision !== 'wait_for_alignment') decision = `${decision}_with_risk`

  return {
    eventType: 'NEURAL_BRAIN_SCORECARD',
    status: 'Ready',
    engineVersion: NEURAL_BRAIN_VERSION,
    symbol,
    timeframe,
    buyConfidence: Number(buyConfidence.toFixed(2)),
    sellConfidence: Number(sellConfidence.toFixed(2)),
    reversalRisk: Number(reversalRisk.toFixed(2)),
    targetHitProbability: Number(targetHitProbability.toFixed(2)),
    chopRisk: Number(chopRisk.toFixed(2)),
    bestDirection,
    decision,
    noTradeWarning,
    modelType: 'phase1_weighted_neural_scorecard',
    trainedModelReady: false,
    inputs: {
      bullScore: Number(bullScore.toFixed(2)),
      bearScore: Number(bearScore.toFixed(2)),
      netBias: Number(netBias.toFixed(2)),
      smcStrength: Number(smcStrength.toFixed(2)),
      alphaxStrength: Number(alphaxStrength.toFixed(2)),
      ghostStrength: Number(ghostStrength.toFixed(2)),
      smcDirectionValue: smcDir,
      alphaxDirectionValue: alphaxDir,
      ghostDirectionValue: ghostDir,
      bullPressure: Number(bullPressure.toFixed(2)),
      bearPressure: Number(bearPressure.toFixed(2)),
      macroRisk: Number(macroRisk.toFixed(2)),
      optionsReversalRisk: Number(optionsReversalRisk.toFixed(2)),
      priceChangePct: Number(candleFeatures.priceChangePct.toFixed(6)),
      bodyPct: Number(candleFeatures.bodyPct.toFixed(6)),
      upperWickPct: Number(candleFeatures.upperWickPct.toFixed(6)),
      lowerWickPct: Number(candleFeatures.lowerWickPct.toFixed(6)),
      rangePct: Number(candleFeatures.rangePct.toFixed(6)),
      trendSlopePct: Number(candleFeatures.trendSlopePct.toFixed(6)),
      momentum3Pct: Number(candleFeatures.momentum3Pct.toFixed(6)),
      momentum8Pct: Number(candleFeatures.momentum8Pct.toFixed(6)),
    },
    explain: [
      'Phase 1 keeps the Neural Brain as an observer/scorer only.',
      'SMC, AlphaX/DLM, Ghost, candle momentum, wick pressure, macro/options risk, and disagreement are blended into probabilities.',
      'Phase 2 can train a real MLP/PyTorch model from stored outcomes once enough snapshots are labeled.',
    ],
    createdAt: nowIso(),
  }
}
