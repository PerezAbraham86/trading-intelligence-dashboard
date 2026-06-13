import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { NeuralBrainScorecard } from './neuralBrain'
import type { NeuralBrainSnapshot } from './neuralBrainMemory'

type OnlineTaskName = 'targetHit' | 'reversal' | 'chop' | 'buyWin' | 'sellWin'

type OnlineTaskState = {
  weights: Record<string, number>
  examples: number
  correct: number
  lastPrediction?: number
  lastTarget?: number
  lastUpdatedAt?: string
}

type OnlineBrainState = {
  eventType: 'NEURAL_BRAIN_ONLINE_STATE'
  engineVersion: string
  modelType: 'river_style_online_logistic'
  learningRate: number
  l2: number
  tasks: Record<OnlineTaskName, OnlineTaskState>
  createdAt: string
  updatedAt: string
}

export type OnlineBrainPrediction = {
  eventType: 'NEURAL_BRAIN_ONLINE_PREDICTION'
  status: 'Ready'
  modelType: 'river_style_online_logistic'
  onlineReady: boolean
  trainedExamples: number
  probabilities: Record<OnlineTaskName, number>
  blended: {
    buyConfidence: number
    sellConfidence: number
    targetHitProbability: number
    reversalRisk: number
    chopRisk: number
    decisionStrength: number
    bestDirection: NeuralBrainScorecard['bestDirection']
    decision: string
    noTradeWarning: boolean
  }
  featureCount: number
  createdAt: string
}

const ONLINE_MODEL_FILE =
  process.env.NEURAL_BRAIN_ONLINE_MODEL_FILE ||
  path.join(process.cwd(), '.data', 'neural_brain_online_model.json')

const ENGINE_VERSION = 'neural_brain_phase3_river_style_online_v1'
const DEFAULT_LR = Number(process.env.NEURAL_BRAIN_ONLINE_LEARNING_RATE || 0.035)
const DEFAULT_L2 = Number(process.env.NEURAL_BRAIN_ONLINE_L2 || 0.00025)
const ONLINE_READY_EXAMPLES = Number(process.env.NEURAL_BRAIN_ONLINE_READY_EXAMPLES || 25)

const TASKS: OnlineTaskName[] = ['targetHit', 'reversal', 'chop', 'buyWin', 'sellWin']

function nowIso() {
  return new Date().toISOString()
}

function clamp(value: unknown, low = 0, high = 100) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return low
  return Math.max(low, Math.min(high, parsed))
}

function sigmoid(value: number) {
  const z = Math.max(-40, Math.min(40, value))
  return 1 / (1 + Math.exp(-z))
}

function ensureModelDir() {
  fs.mkdirSync(path.dirname(ONLINE_MODEL_FILE), { recursive: true })
}

function emptyTask(): OnlineTaskState {
  return {
    weights: {
      bias: 0,
    },
    examples: 0,
    correct: 0,
  }
}

function createInitialState(): OnlineBrainState {
  const createdAt = nowIso()

  return {
    eventType: 'NEURAL_BRAIN_ONLINE_STATE',
    engineVersion: ENGINE_VERSION,
    modelType: 'river_style_online_logistic',
    learningRate: Number.isFinite(DEFAULT_LR) && DEFAULT_LR > 0 ? DEFAULT_LR : 0.035,
    l2: Number.isFinite(DEFAULT_L2) && DEFAULT_L2 >= 0 ? DEFAULT_L2 : 0.00025,
    tasks: {
      targetHit: emptyTask(),
      reversal: emptyTask(),
      chop: emptyTask(),
      buyWin: emptyTask(),
      sellWin: emptyTask(),
    },
    createdAt,
    updatedAt: createdAt,
  }
}

function readState(): OnlineBrainState {
  try {
    if (!fs.existsSync(ONLINE_MODEL_FILE)) return createInitialState()
    const parsed = JSON.parse(fs.readFileSync(ONLINE_MODEL_FILE, 'utf8'))
    const initial = createInitialState()

    return {
      ...initial,
      ...parsed,
      tasks: {
        targetHit: { ...emptyTask(), ...(parsed?.tasks?.targetHit || {}) },
        reversal: { ...emptyTask(), ...(parsed?.tasks?.reversal || {}) },
        chop: { ...emptyTask(), ...(parsed?.tasks?.chop || {}) },
        buyWin: { ...emptyTask(), ...(parsed?.tasks?.buyWin || {}) },
        sellWin: { ...emptyTask(), ...(parsed?.tasks?.sellWin || {}) },
      },
    }
  } catch {
    return createInitialState()
  }
}

function writeState(state: OnlineBrainState) {
  ensureModelDir()
  fs.writeFileSync(ONLINE_MODEL_FILE, JSON.stringify(state, null, 2), 'utf8')
}

function normalizeFeatureValue(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0

  if (Math.abs(parsed) > 1.5) return Math.max(-5, Math.min(5, parsed / 100))
  return Math.max(-5, Math.min(5, parsed))
}

function addFeature(features: Record<string, number>, key: string, value: unknown) {
  const safeKey = key.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64)
  const safeValue = normalizeFeatureValue(value)

  if (safeKey && Number.isFinite(safeValue)) {
    features[safeKey] = safeValue
  }
}

function flattenNumericFeatures(prefix: string, value: unknown, features: Record<string, number>, depth = 0) {
  if (depth > 3 || value === null || value === undefined) return

  if (typeof value === 'number' || typeof value === 'boolean') {
    addFeature(features, prefix, typeof value === 'boolean' ? (value ? 1 : 0) : value)
    return
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) addFeature(features, prefix, parsed)
    return
  }

  if (Array.isArray(value)) {
    addFeature(features, `${prefix}_count`, value.length)
    value.slice(0, 20).forEach((item, index) => flattenNumericFeatures(`${prefix}_${index}`, item, features, depth + 1))
    return
  }

  if (typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).slice(0, 80).forEach(([key, item]) => {
      flattenNumericFeatures(`${prefix}_${key}`, item, features, depth + 1)
    })
  }
}

function directionFlag(value: unknown) {
  const text = String(value ?? '').toLowerCase()
  if (text.includes('bull') || text.includes('buy') || text.includes('long')) return 1
  if (text.includes('bear') || text.includes('sell') || text.includes('short')) return -1
  return 0
}

export function buildOnlineFeatureVector(payload: NeuralBrainScorecard | NeuralBrainSnapshot): Record<string, number> {
  const features: Record<string, number> = {
    bias: 1,
  }

  addFeature(features, 'buyConfidence', (payload as any).buyConfidence)
  addFeature(features, 'sellConfidence', (payload as any).sellConfidence)
  addFeature(features, 'targetHitProbability', (payload as any).targetHitProbability)
  addFeature(features, 'reversalRisk', (payload as any).reversalRisk)
  addFeature(features, 'chopRisk', (payload as any).chopRisk)
  addFeature(features, 'decisionStrength', (payload as any).decisionStrength)
  addFeature(features, 'bestDirectionFlag', directionFlag((payload as any).bestDirection))
  addFeature(features, 'decisionFlag', directionFlag((payload as any).decision))
  addFeature(features, 'riskWatch', String((payload as any).riskStatus ?? '').toLowerCase().includes('risk') || (payload as any).noTradeWarning ? 1 : 0)

  const inputs = (payload as any).inputs || (payload as any).scorecardInputs?.inputs || {}
  const explain = (payload as any).scorecardInputs || {}
  flattenNumericFeatures('input', inputs, features)
  flattenNumericFeatures('scorecard', explain, features)

  return features
}

function dot(weights: Record<string, number>, features: Record<string, number>) {
  let total = weights.bias || 0

  for (const [key, value] of Object.entries(features)) {
    if (key === 'bias') continue
    total += (weights[key] || 0) * value
  }

  return total
}

function predictTask(task: OnlineTaskState, features: Record<string, number>) {
  return sigmoid(dot(task.weights, features))
}

function trainTask(
  task: OnlineTaskState,
  features: Record<string, number>,
  target: boolean,
  learningRate: number,
  l2: number,
) {
  const y = target ? 1 : 0
  const prediction = predictTask(task, features)
  const error = y - prediction

  task.weights.bias = (task.weights.bias || 0) + learningRate * error

  for (const [key, value] of Object.entries(features)) {
    if (key === 'bias') continue

    const current = task.weights[key] || 0
    task.weights[key] = current * (1 - learningRate * l2) + learningRate * error * value
  }

  task.examples += 1
  task.correct += (prediction >= 0.5) === target ? 1 : 0
  task.lastPrediction = Number((prediction * 100).toFixed(2))
  task.lastTarget = y
  task.lastUpdatedAt = nowIso()
}

function trainedExamples(state: OnlineBrainState) {
  return TASKS.reduce((total, task) => total + state.tasks[task].examples, 0)
}

function taskProbability(state: OnlineBrainState, taskName: OnlineTaskName, features: Record<string, number>) {
  const task = state.tasks[taskName] || emptyTask()
  if (task.examples <= 0) return null
  return clamp(predictTask(task, features) * 100)
}

function blend(base: number, online: number | null, onlineReady: boolean) {
  if (online === null || !onlineReady) return clamp(base)
  return clamp(base * 0.72 + online * 0.28)
}

function normalizeDecision(bestDirection: NeuralBrainScorecard['bestDirection'], target: number, reversal: number, chop: number) {
  if (bestDirection === 'neutral') return 'wait_for_alignment'
  const side = bestDirection === 'bullish' ? 'bullish' : 'bearish'
  const base = target >= 55 && reversal < 55 && chop < 62 ? `${side}_continuation` : `${side}_watch`
  return reversal >= 62 || chop >= 68 ? `${base}_with_risk` : base
}

export function applyOnlineBrainPrediction(scorecard: NeuralBrainScorecard): NeuralBrainScorecard & {
  onlineLearning: OnlineBrainPrediction
} {
  const state = readState()
  const examples = trainedExamples(state)
  const onlineReady = examples >= ONLINE_READY_EXAMPLES
  const features = buildOnlineFeatureVector(scorecard)

  const targetOnline = taskProbability(state, 'targetHit', features)
  const reversalOnline = taskProbability(state, 'reversal', features)
  const chopOnline = taskProbability(state, 'chop', features)
  const buyWinOnline = taskProbability(state, 'buyWin', features)
  const sellWinOnline = taskProbability(state, 'sellWin', features)

  const buyConfidence = blend(scorecard.buyConfidence, buyWinOnline, onlineReady)
  const sellConfidence = blend(scorecard.sellConfidence, sellWinOnline, onlineReady)
  const targetHitProbability = blend(scorecard.targetHitProbability, targetOnline, onlineReady)
  const reversalRisk = blend(scorecard.reversalRisk, reversalOnline, onlineReady)
  const chopRisk = blend(scorecard.chopRisk, chopOnline, onlineReady)

  const bestDirection: NeuralBrainScorecard['bestDirection'] =
    buyConfidence > sellConfidence + 5 ? 'bullish' : sellConfidence > buyConfidence + 5 ? 'bearish' : 'neutral'
  const decision = normalizeDecision(bestDirection, targetHitProbability, reversalRisk, chopRisk)
  const noTradeWarning = chopRisk >= 62 || reversalRisk >= 70 || targetHitProbability < 38
  const decisionStrength = clamp(Math.abs(buyConfidence - sellConfidence))

  const onlineLearning: OnlineBrainPrediction = {
    eventType: 'NEURAL_BRAIN_ONLINE_PREDICTION',
    status: 'Ready',
    modelType: 'river_style_online_logistic',
    onlineReady,
    trainedExamples: examples,
    probabilities: {
      targetHit: targetOnline ?? scorecard.targetHitProbability,
      reversal: reversalOnline ?? scorecard.reversalRisk,
      chop: chopOnline ?? scorecard.chopRisk,
      buyWin: buyWinOnline ?? scorecard.buyConfidence,
      sellWin: sellWinOnline ?? scorecard.sellConfidence,
    },
    blended: {
      buyConfidence: Number(buyConfidence.toFixed(2)),
      sellConfidence: Number(sellConfidence.toFixed(2)),
      targetHitProbability: Number(targetHitProbability.toFixed(2)),
      reversalRisk: Number(reversalRisk.toFixed(2)),
      chopRisk: Number(chopRisk.toFixed(2)),
      decisionStrength: Number(decisionStrength.toFixed(2)),
      bestDirection,
      decision,
      noTradeWarning,
    },
    featureCount: Object.keys(features).length,
    createdAt: nowIso(),
  }

  return {
    ...scorecard,
    buyConfidence: onlineLearning.blended.buyConfidence,
    sellConfidence: onlineLearning.blended.sellConfidence,
    targetHitProbability: onlineLearning.blended.targetHitProbability,
    reversalRisk: onlineLearning.blended.reversalRisk,
    chopRisk: onlineLearning.blended.chopRisk,
    bestDirection,
    decision,
    noTradeWarning,
    modelType: onlineReady ? 'phase3_river_style_online_blended_scorecard' : scorecard.modelType,
    trainedModelReady: onlineReady,
    explain: [
      ...scorecard.explain,
      onlineReady
        ? `Phase 3 online learner blended ${examples} river-style updates into the scorecard.`
        : `Phase 3 online learner is collecting labels. ${examples}/${ONLINE_READY_EXAMPLES} updates before blending.`,
    ],
    onlineLearning,
  }
}

export function learnOnlineFromSnapshot(snapshot: NeuralBrainSnapshot) {
  const state = readState()
  const outcome = snapshot.outcome

  if (!outcome) {
    return {
      eventType: 'NEURAL_BRAIN_ONLINE_LEARN',
      status: 'Skipped',
      reason: 'Snapshot has no outcome label.',
      online: getOnlineBrainStatus(),
      createdAt: nowIso(),
    }
  }

  const features = buildOnlineFeatureVector(snapshot)
  const targetHit = Boolean(outcome.targetHit)
  const reversal = Boolean(outcome.reversalHappened)
  const chop = Boolean(outcome.chopHappened)
  const direction = String(snapshot.bestDirection || '').toLowerCase()

  trainTask(state.tasks.targetHit, features, targetHit, state.learningRate, state.l2)
  trainTask(state.tasks.reversal, features, reversal, state.learningRate, state.l2)
  trainTask(state.tasks.chop, features, chop, state.learningRate, state.l2)

  if (direction.includes('bull')) {
    trainTask(state.tasks.buyWin, features, targetHit && !reversal && !chop, state.learningRate, state.l2)
  }

  if (direction.includes('bear')) {
    trainTask(state.tasks.sellWin, features, targetHit && !reversal && !chop, state.learningRate, state.l2)
  }

  state.updatedAt = nowIso()
  writeState(state)

  return {
    eventType: 'NEURAL_BRAIN_ONLINE_LEARN',
    status: 'OK',
    snapshotId: snapshot.id,
    labels: {
      targetHit,
      reversalHappened: reversal,
      chopHappened: chop,
      direction,
    },
    online: getOnlineBrainStatus(),
    createdAt: nowIso(),
  }
}

export function getOnlineBrainStatus() {
  const state = readState()
  const examples = trainedExamples(state)

  return {
    eventType: 'NEURAL_BRAIN_ONLINE_STATUS',
    status: 'Ready',
    engineVersion: state.engineVersion,
    modelType: state.modelType,
    modelFile: ONLINE_MODEL_FILE,
    onlineReady: examples >= ONLINE_READY_EXAMPLES,
    readyAfterExamples: ONLINE_READY_EXAMPLES,
    trainedExamples: examples,
    learningRate: state.learningRate,
    l2: state.l2,
    tasks: Object.fromEntries(
      TASKS.map((taskName) => {
        const task = state.tasks[taskName]
        return [
          taskName,
          {
            examples: task.examples,
            accuracy: task.examples ? Number(((task.correct / task.examples) * 100).toFixed(2)) : 0,
            featureWeights: Object.keys(task.weights).length,
            lastPrediction: task.lastPrediction ?? null,
            lastTarget: task.lastTarget ?? null,
            lastUpdatedAt: task.lastUpdatedAt ?? null,
          },
        ]
      }),
    ),
    updatedAt: state.updatedAt,
    createdAt: nowIso(),
  }
}

export function resetOnlineBrainModel() {
  const state = createInitialState()
  writeState(state)

  return {
    eventType: 'NEURAL_BRAIN_ONLINE_RESET',
    status: 'OK',
    online: getOnlineBrainStatus(),
    createdAt: nowIso(),
  }
}

export function onlineModelHash() {
  const state = readState()
  return crypto.createHash('sha1').update(JSON.stringify(state)).digest('hex').slice(0, 16)
}
