import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export type NeuralBrainSnapshot = {
  id: string
  eventType: 'NEURAL_BRAIN_SNAPSHOT'
  symbol: string
  timeframe: string
  buyConfidence: number
  sellConfidence: number
  targetHitProbability: number
  reversalRisk: number
  chopRisk: number
  bestDirection: string
  decision: string
  decisionStrength: number
  riskStatus: string
  scorecardInputs: Record<string, unknown>
  timestamp: string
  createdAt: string
  source: string
  outcome?: NeuralBrainOutcome
}

export type NeuralBrainOutcome = {
  targetHit?: boolean
  reversalHappened?: boolean
  chopHappened?: boolean
  candlesToResult?: number
  maxDrawdownBeforeTarget?: number
  maxFavorableExcursion?: number
  maxAdverseExcursion?: number
  result?: 'target_hit' | 'reversal' | 'chop' | 'expired' | 'manual' | string
  labeledAt: string
  labelSource?: string
}

const MEMORY_FILE =
  process.env.NEURAL_BRAIN_MEMORY_FILE ||
  path.join(process.cwd(), '.data', 'neural_brain_snapshots.jsonl')

function clamp(value: unknown, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, parsed))
}

function asString(value: unknown, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function safeTimestamp(value: unknown) {
  const text = asString(value)
  const date = text ? new Date(text) : new Date()
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString()
}

function ensureMemoryDir() {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true })
}

function readLines() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return []
    return fs.readFileSync(MEMORY_FILE, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function parseSnapshot(line: string): NeuralBrainSnapshot | null {
  try {
    const parsed = JSON.parse(line)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as NeuralBrainSnapshot
  } catch {
    return null
  }
}

export function normalizeNeuralBrainSnapshot(payload: any): NeuralBrainSnapshot {
  const symbol = asString(payload?.symbol, 'MES1!')
  const timeframe = asString(payload?.timeframe, '1m')
  const timestamp = safeTimestamp(payload?.timestamp)
  const createdAt = new Date().toISOString()

  const identity = JSON.stringify({
    symbol,
    timeframe,
    timestamp,
    buy: clamp(payload?.buyConfidence ?? payload?.brainBuyPct),
    sell: clamp(payload?.sellConfidence ?? payload?.brainSellPct),
    target: clamp(payload?.targetHitProbability ?? payload?.targetHitPct),
    reversal: clamp(payload?.reversalRisk ?? payload?.reversalRiskPct),
    chop: clamp(payload?.chopRisk ?? payload?.chopRiskPct),
    decision: asString(payload?.decision, 'HOLD').toUpperCase(),
    direction: asString(payload?.bestDirection, 'Neutral'),
  })

  return {
    id: crypto.createHash('sha1').update(identity).digest('hex').slice(0, 16),
    eventType: 'NEURAL_BRAIN_SNAPSHOT',
    symbol,
    timeframe,
    buyConfidence: clamp(payload?.buyConfidence ?? payload?.brainBuyPct),
    sellConfidence: clamp(payload?.sellConfidence ?? payload?.brainSellPct),
    targetHitProbability: clamp(payload?.targetHitProbability ?? payload?.targetHitPct),
    reversalRisk: clamp(payload?.reversalRisk ?? payload?.reversalRiskPct),
    chopRisk: clamp(payload?.chopRisk ?? payload?.chopRiskPct),
    bestDirection: asString(payload?.bestDirection, 'Neutral'),
    decision: asString(payload?.decision, 'HOLD').toUpperCase(),
    decisionStrength: clamp(payload?.decisionStrength ?? payload?.decisionStrengthPct),
    riskStatus: asString(payload?.riskStatus, 'Waiting'),
    scorecardInputs:
      payload?.scorecardInputs && typeof payload.scorecardInputs === 'object'
        ? payload.scorecardInputs
        : {},
    timestamp,
    createdAt,
    source: asString(payload?.source, 'neural_brain'),
  }
}

export function saveNeuralBrainSnapshot(payload: any) {
  const snapshot = normalizeNeuralBrainSnapshot(payload)
  ensureMemoryDir()

  const existing = getRecentNeuralBrainSnapshots({ limit: 5000 })
  const alreadyExists = existing.snapshots.some((item) => item.id === snapshot.id)

  if (!alreadyExists) {
    fs.appendFileSync(MEMORY_FILE, `${JSON.stringify(snapshot)}\n`, 'utf8')
  }

  return {
    eventType: 'NEURAL_BRAIN_MEMORY_SAVE',
    status: 'OK',
    saved: !alreadyExists,
    duplicate: alreadyExists,
    snapshot,
    memory: getNeuralBrainMemoryStatus(),
  }
}

export function getRecentNeuralBrainSnapshots({
  limit = 100,
  symbol,
  timeframe,
}: {
  limit?: number
  symbol?: string
  timeframe?: string
} = {}) {
  const normalizedSymbol = symbol ? symbol.toUpperCase() : ''
  const normalizedTimeframe = timeframe ? timeframe.toLowerCase() : ''
  const rows = readLines()
    .map(parseSnapshot)
    .filter(Boolean) as NeuralBrainSnapshot[]

  const filtered = rows.filter((item) => {
    if (normalizedSymbol && item.symbol.toUpperCase() !== normalizedSymbol) return false
    if (normalizedTimeframe && item.timeframe.toLowerCase() !== normalizedTimeframe) return false
    return true
  })

  return {
    eventType: 'NEURAL_BRAIN_MEMORY_RECENT',
    status: 'OK',
    count: filtered.length,
    snapshots: filtered.slice(-Math.max(1, Math.min(1000, limit))).reverse(),
    memoryFile: MEMORY_FILE,
    createdAt: new Date().toISOString(),
  }
}

export function getNeuralBrainMemoryStatus() {
  const rows = readLines()
    .map(parseSnapshot)
    .filter(Boolean) as NeuralBrainSnapshot[]

  const labeled = rows.filter((item) => item.outcome).length
  const symbols = Array.from(new Set(rows.map((item) => item.symbol))).sort()
  const timeframes = Array.from(new Set(rows.map((item) => item.timeframe))).sort()

  return {
    eventType: 'NEURAL_BRAIN_MEMORY_STATUS',
    status: 'OK',
    memoryFile: MEMORY_FILE,
    snapshots: rows.length,
    labeled,
    unlabeled: Math.max(0, rows.length - labeled),
    symbols,
    timeframes,
    latestSnapshotAt: rows.length ? rows[rows.length - 1].timestamp : null,
    readyForTraining: labeled >= 300,
    requiredLabelsForFirstModel: 300,
    createdAt: new Date().toISOString(),
  }
}

export function labelNeuralBrainSnapshot(id: string, outcome: Partial<NeuralBrainOutcome>) {
  ensureMemoryDir()

  const rows = readLines()
    .map(parseSnapshot)
    .filter(Boolean) as NeuralBrainSnapshot[]

  let updated = false
  const nextRows = rows.map((item) => {
    if (item.id !== id) return item
    updated = true
    return {
      ...item,
      outcome: {
        targetHit: Boolean(outcome.targetHit),
        reversalHappened: Boolean(outcome.reversalHappened),
        chopHappened: Boolean(outcome.chopHappened),
        candlesToResult: Number.isFinite(Number(outcome.candlesToResult)) ? Number(outcome.candlesToResult) : undefined,
        maxDrawdownBeforeTarget: Number.isFinite(Number(outcome.maxDrawdownBeforeTarget)) ? Number(outcome.maxDrawdownBeforeTarget) : undefined,
        maxFavorableExcursion: Number.isFinite(Number(outcome.maxFavorableExcursion)) ? Number(outcome.maxFavorableExcursion) : undefined,
        maxAdverseExcursion: Number.isFinite(Number(outcome.maxAdverseExcursion)) ? Number(outcome.maxAdverseExcursion) : undefined,
        result: outcome.result,
        labelSource: outcome.labelSource || 'manual',
        labeledAt: new Date().toISOString(),
      },
    }
  })

  if (updated) {
    fs.writeFileSync(MEMORY_FILE, `${nextRows.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8')
  }

  return {
    eventType: 'NEURAL_BRAIN_MEMORY_OUTCOME',
    status: updated ? 'OK' : 'NotFound',
    updated,
    id,
    memory: getNeuralBrainMemoryStatus(),
  }
}
