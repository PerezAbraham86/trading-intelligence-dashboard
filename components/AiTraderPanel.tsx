import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'

type AiTraderPanelProps = {
  apiBaseUrl?: string
  symbol: string
  timeframe: string
  activePrice?: number
  signal?: any
  scorecards?: any
  overlayPayload?: any
  unifiedIntelligence?: any
  candles?: any[]
}

type AiTraderDecision = {
  eventType?: string
  status?: string
  dashboardOnly?: boolean
  brokerConnected?: boolean
  allowedToTrade?: boolean
  decision?: 'BUY' | 'SELL' | 'HOLD' | string
  rawDecision?: 'BUY' | 'SELL' | 'HOLD' | string
  confidence?: number
  baseConfidence?: number
  learningAdjustment?: number
  confidenceGrade?: string
  symbol?: string
  timeframe?: string
  entry?: number
  target?: number
  stop?: number
  riskReward?: number
  currentPrice?: number
  currentPnl?: number
  maxPnl?: number
  riskPnl?: number
  reason?: string
  reasons?: string[]
  details?: any
  createdAt?: string
}

type AiTraderSummary = {
  eventType?: string
  status?: string
  dashboardOnly?: boolean
  brokerConnected?: boolean
  openTrades?: any[]
  closedTrades?: any[]
  recentClosedTrades?: any[]
  openCount?: number
  closedCount?: number
  decisionStats?: {
    samples?: number
    buyBias?: number
    sellBias?: number
    holdCount?: number
    tradeReadyCount?: number
    avgConfidence?: number
  }
  memoryStatus?: {
    stage?: string
    message?: string
    bucketDecisionStats?: any
    overallDecisionStats?: any
    bucketClosedStats?: any
    overallClosedStats?: any
  }
  stats?: {
    samples?: number
    wins?: number
    losses?: number
    winRate?: number
    profitFactor?: number
    avgPnl?: number
    avgR?: number
  }
}

function toFiniteNumber(value: any, fallback = 0) {
  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : fallback
}

function formatPrice(value: any) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) return '—'

  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: parsed > 100 ? 2 : 4,
    maximumFractionDigits: parsed > 100 ? 2 : 6,
  })
}

function formatMoney(value: any) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) return '—'

  const sign = parsed > 0 ? '+' : parsed < 0 ? '-' : ''

  return `${sign}$${Math.abs(parsed).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatPercent(value: any) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) return '—'

  return `${(parsed * 100).toFixed(1)}%`
}

function formatCount(value: any) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) return '0'

  return parsed.toLocaleString()
}

function formatAiStage(value: any) {
  const raw = String(value ?? 'WARMING_UP').replaceAll('_', ' ').toLowerCase()

  return raw.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getBlockerAnalysis(decision: AiTraderDecision | null, summary: AiTraderSummary | null, minConfidence: number, minRiskReward: number) {
  const blockers: Array<{ label: string; detail: string; severity: 'high' | 'medium' | 'low' }> = []

  const confidence = toFiniteNumber(decision?.confidence, 0)
  const riskReward = toFiniteNumber(decision?.riskReward, 0)
  const directional = decision?.details?.directionalContext ?? {}
  const memoryStatus = summary?.memoryStatus ?? decision?.details?.memoryStatus ?? {}
  const targetConfidence = toFiniteNumber(directional?.targetConfidence, 0)
  const ghostConfidence = toFiniteNumber(directional?.ghostConfidence, 0)
  const entryConfidence = toFiniteNumber(directional?.entryConfidence, 0)
  const nrtrConflicts = toFiniteNumber(directional?.nrtrConflictCount, 0)
  const nrtrAgreements = toFiniteNumber(directional?.nrtrAgreementCount, 0)

  if (confidence < minConfidence) {
    blockers.push({
      label: 'Confidence below threshold',
      detail: `${confidence.toFixed(1)}% / required ${minConfidence.toFixed(1)}%`,
      severity: 'high',
    })
  }

  if (riskReward > 0 && riskReward < minRiskReward) {
    blockers.push({
      label: 'Risk/Reward below minimum',
      detail: `${riskReward.toFixed(2)}R / required ${minRiskReward.toFixed(2)}R`,
      severity: 'high',
    })
  }

  if (targetConfidence <= 0) {
    blockers.push({
      label: 'Target ML confidence missing',
      detail: 'Target exists, but confidence is not flowing into the AI context yet.',
      severity: 'medium',
    })
  } else if (targetConfidence < 50) {
    blockers.push({
      label: 'Target ML is weak',
      detail: `${targetConfidence.toFixed(1)} confidence`,
      severity: 'medium',
    })
  }

  if (ghostConfidence > 0 && ghostConfidence < 45) {
    blockers.push({
      label: 'Ghost ML is weak',
      detail: `${ghostConfidence.toFixed(1)} confidence`,
      severity: 'medium',
    })
  }

  if (entryConfidence > 0 && entryConfidence < 55) {
    blockers.push({
      label: 'Entry ML is weak',
      detail: `${entryConfidence.toFixed(1)} confidence`,
      severity: 'medium',
    })
  }

  if (nrtrConflicts > 0) {
    blockers.push({
      label: 'NRTR conflict',
      detail: `${nrtrConflicts} chart(s) conflict, ${nrtrAgreements} agree`,
      severity: 'medium',
    })
  }

  if (toFiniteNumber(summary?.closedCount, 0) < 8) {
    blockers.push({
      label: 'Trade memory not mature',
      detail: String(memoryStatus?.message ?? 'Need more closed dashboard AI trades.'),
      severity: 'low',
    })
  }

  if (blockers.length === 0 && decision?.allowedToTrade) {
    blockers.push({
      label: 'No active blocker',
      detail: 'AI is allowed to open dashboard paper trades.',
      severity: 'low',
    })
  }

  if (blockers.length === 0) {
    blockers.push({
      label: 'Waiting for clean setup',
      detail: 'No major blocker found, but AI has not confirmed trade readiness.',
      severity: 'low',
    })
  }

  return blockers
}

function BlockerBadge({ severity }: { severity: 'high' | 'medium' | 'low' }) {
  const className =
    severity === 'high'
      ? 'border-red-400/30 bg-red-400/10 text-red-200'
      : severity === 'medium'
        ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
        : 'border-blue-400/30 bg-blue-400/10 text-blue-200'

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${className}`}>
      {severity}
    </span>
  )
}

function readNumberPath(source: any, paths: string[]) {
  for (const path of paths) {
    const value = path.split('.').reduce((current: any, key: string) => {
      if (current && typeof current === 'object' && key in current) return current[key]
      return undefined
    }, source)

    const parsed = Number(value)

    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }

  return undefined
}

function normalizeDecision(value: any): 'BUY' | 'SELL' | 'HOLD' {
  const raw = String(value ?? '').toUpperCase()

  if (raw.includes('BUY') || raw.includes('LONG') || raw.includes('BULL')) return 'BUY'
  if (raw.includes('SELL') || raw.includes('SHORT') || raw.includes('BEAR')) return 'SELL'

  return 'HOLD'
}

function sanitizeAiTraderPayload(value: any, depth = 0): any {
  if (depth > 6) return null

  if (value === undefined) return null
  if (value === null) return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeAiTraderPayload(item, depth + 1))
  }

  if (typeof value === 'object') {
    const result: Record<string, any> = {}

    Object.entries(value).forEach(([key, entry]) => {
      if (typeof entry === 'function') return
      if (typeof entry === 'symbol') return
      result[key] = sanitizeAiTraderPayload(entry, depth + 1)
    })

    return result
  }

  return null
}

async function readApiError(response: Response) {
  const text = await response.text().catch(() => '')

  if (!text) return `${response.status}`

  try {
    const json = JSON.parse(text)
    return `${response.status}: ${JSON.stringify(json).slice(0, 500)}`
  } catch {
    return `${response.status}: ${text.slice(0, 500)}`
  }
}

function inferTargetFromSignal(signal: any) {
  return readNumberPath(signal, [
    'targetPrice',
    'target',
    'targetMl.targetPrice',
    'targetPlan.targetPrice',
    'finalTargetPrice',
    'overallTargetPrice',
    'ghostTargetPrice',
    'projectedTargetPrice',
    'takeProfitPrice',
    'tp1',
  ])
}

function inferEntryFromSignal(signal: any, activePrice?: number) {
  return readNumberPath(signal, [
    'entryPrice',
    'entry',
    'nrtrEntryPrice',
    'strategyEntryPrice',
    'price',
    'close',
  ]) ?? activePrice
}

function readGhostTargetMlContext(source: any) {
  const ghostSources = [
    source?.ghostCandles,
    source?.ghosts,
    source?.projection,
    source?.ghostProjection,
    source?.ghostCandleProjection,
    source?.overlayPayload?.ghostCandles,
    source?.overlayPayload?.ghosts,
  ]

  let bestTarget = readNumberPath(source, [
    'finalTargetPrice',
    'overallTargetPrice',
    'targetPrice',
    'targetMl.targetPrice',
    'targetPlan.targetPrice',
  ])
  let bestConfidence = toFiniteNumber(
    source?.targetConfidence ??
    source?.targetMl?.targetConfidence ??
    source?.targetPlan?.targetConfidence,
    0,
  )
  let aligned = Boolean(source?.targetMlAligned ?? source?.targetMl?.targetMlAligned)
  let ready = Boolean(source?.targetMlReady ?? source?.targetMl?.targetMlReady)

  ghostSources.forEach((ghostList) => {
    if (!Array.isArray(ghostList)) return

    ghostList.forEach((ghost: any) => {
      const ghostTarget = readNumberPath(ghost, [
        'finalTargetPrice',
        'overallTargetPrice',
        'ghostTargetPrice',
        'projectedTargetPrice',
        'targetPrice',
        'close',
      ])

      const ghostConfidence = toFiniteNumber(
        ghost?.targetConfidence ??
        ghost?.targetMlConfidence ??
        ghost?.confidence,
        0,
      )

      if (!bestTarget && ghostTarget && ghostTarget > 0) {
        bestTarget = ghostTarget
      }

      if (ghostConfidence > bestConfidence) {
        bestConfidence = ghostConfidence
      }

      aligned = aligned || Boolean(ghost?.targetMlAligned)
      ready = ready || Boolean(ghost?.targetMlReady) || Boolean(ghost?.targetMlAligned) || ghostConfidence > 0
    })
  })

  return {
    targetPrice: bestTarget,
    targetConfidence: bestConfidence,
    targetMlAligned: aligned,
    targetMlReady: ready || aligned || bestConfidence > 0 || Boolean(bestTarget),
  }
}

function buildTargetMlSnapshot(signal: any, overlayPayload: any) {
  const signalContext = readGhostTargetMlContext(signal)
  const overlayContext = readGhostTargetMlContext(overlayPayload)

  const targetConfidence = Math.max(
    toFiniteNumber(
      signal?.targetConfidence ??
      signal?.targetMl?.targetConfidence ??
      overlayPayload?.targetConfidence ??
      overlayPayload?.targetMl?.targetConfidence,
      0,
    ),
    toFiniteNumber(signalContext.targetConfidence, 0),
    toFiniteNumber(overlayContext.targetConfidence, 0),
  )

  const targetPrice =
    inferTargetFromSignal(signal) ??
    signalContext.targetPrice ??
    overlayContext.targetPrice ??
    readNumberPath(overlayPayload, [
      'finalTargetPrice',
      'overallTargetPrice',
      'targetPrice',
      'targetMl.targetPrice',
      'targetPlan.targetPrice',
    ])

  const targetMlAligned = Boolean(
    signal?.targetMlAligned ??
    signal?.targetMl?.targetMlAligned ??
    overlayPayload?.targetMlAligned ??
    overlayPayload?.targetMl?.targetMlAligned ??
    signalContext.targetMlAligned ??
    overlayContext.targetMlAligned,
  )

  const targetMlReady = Boolean(
    signal?.targetMlReady ||
    signal?.targetMl?.targetMlReady ||
    overlayPayload?.targetMlReady ||
    overlayPayload?.targetMl?.targetMlReady ||
    signalContext.targetMlReady ||
    overlayContext.targetMlReady ||
    targetMlAligned ||
    targetConfidence > 0 ||
    Boolean(targetPrice)
  )

  return {
    targetConfidence,
    targetMlReady,
    targetMlAligned,
    targetPrice,
    source:
      signal?.targetSource ??
      signal?.targetMl?.source ??
      overlayPayload?.targetSource ??
      overlayPayload?.targetMl?.source ??
      'ghost_target_ml_context',
  }
}

function buildGhostMlSnapshot(signal: any, overlayPayload: any) {
  return {
    confidence: toFiniteNumber(
      signal?.ghostConfidence ??
      signal?.confidence ??
      signal?.mlConfidence ??
      overlayPayload?.ghostConfidence,
      0,
    ),
    mlReady: Boolean(signal?.mlReady ?? signal?.ghostMlReady ?? overlayPayload?.mlReady),
    ghostConfidenceBoost: toFiniteNumber(signal?.ghostConfidenceBoost ?? overlayPayload?.ghostConfidenceBoost, 0),
  }
}

function buildEntryMlSnapshot(signal: any) {
  return {
    entryConfidence: toFiniteNumber(signal?.entryConfidence ?? signal?.entryMlConfidence, 0),
    confidence: toFiniteNumber(signal?.entryConfidence ?? signal?.entryMlConfidence, 0),
  }
}

function StatBox({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'bull' | 'bear' | 'warn'
}) {
  const toneClass =
    tone === 'bull'
      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
      : tone === 'bear'
        ? 'border-red-400/30 bg-red-400/10 text-red-200'
        : tone === 'warn'
          ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
          : 'border-dark-600 bg-dark-800/80 text-gray-200'

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-sm font-black">{value}</div>
    </div>
  )
}

export default function AiTraderPanel({
  apiBaseUrl,
  symbol,
  timeframe,
  activePrice,
  signal,
  scorecards,
  overlayPayload,
  unifiedIntelligence,
  candles,
}: AiTraderPanelProps) {
  const [decision, setDecision] = useState<AiTraderDecision | null>(null)
  const [summary, setSummary] = useState<AiTraderSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [actionStatus, setActionStatus] = useState('')
  const [errorText, setErrorText] = useState('')
  const [autoPaperMode, setAutoPaperMode] = useState(false)
  const [minConfidence, setMinConfidence] = useState(62)
  const [minRiskReward, setMinRiskReward] = useState(1.25)
  const [lastAutoOpenKey, setLastAutoOpenKey] = useState('')

  const payload = useMemo(() => {
    const targetSnapshot = buildTargetMlSnapshot(signal, overlayPayload)
    const target = inferTargetFromSignal(signal) ?? targetSnapshot.targetPrice
    const entry = inferEntryFromSignal(signal, activePrice)
    const side = normalizeDecision(signal?.signal ?? signal?.type ?? signal?.direction)

    return {
      symbol,
      timeframe,
      currentPrice: activePrice,
      entryPrice: entry,
      targetPrice: target,
      side,
      signal,
      scorecards,
      ghostMl: buildGhostMlSnapshot(signal, overlayPayload),
      targetMl: targetSnapshot,
      entryMl: buildEntryMlSnapshot(signal),
      nrtrContext: scorecards?.nrtrStrategyFeeds ?? scorecards?.nrtrCharts ?? {},
      unifiedIntelligence,
      context: {
        mode: 'dashboard_only_ai_paper_trader',
        dashboardOnly: true,
        noBroker: true,
      },
      minConfidence,
      minRiskReward,
    }
  }, [activePrice, signal, scorecards, overlayPayload, unifiedIntelligence, symbol, timeframe, minConfidence, minRiskReward])

  const safePayload = useMemo(() => sanitizeAiTraderPayload(payload), [payload])

  const fetchDecision = useCallback(async () => {
    if (!apiBaseUrl || !activePrice || activePrice <= 0) return

    try {
      setIsLoading(true)
      setErrorText('')

      const response = await fetch(`${apiBaseUrl}/api/ai-trader/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(safePayload),
      })

      if (!response.ok) {
        throw new Error(`AI trader decision failed: ${await readApiError(response)}`)
      }

      const json = await response.json()
      setDecision(json)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'AI trader decision failed')
    } finally {
      setIsLoading(false)
    }
  }, [apiBaseUrl, activePrice, safePayload])

  const fetchSummary = useCallback(async () => {
    if (!apiBaseUrl) return

    try {
      const params = new URLSearchParams({
        symbol,
        timeframe,
      })

      const response = await fetch(`${apiBaseUrl}/api/ai-trader/summary?${params.toString()}`, {
        cache: 'no-store',
      })

      if (!response.ok) return

      const json = await response.json()
      setSummary(json)
    } catch {
      // Keep the panel usable even if summary temporarily fails.
    }
  }, [apiBaseUrl, symbol, timeframe])

  const evaluateOpenTrades = useCallback(async () => {
    if (!apiBaseUrl) return

    try {
      setActionStatus('Evaluating open AI trades...')

      const response = await fetch(`${apiBaseUrl}/api/ai-trader/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sanitizeAiTraderPayload({
          symbol,
          timeframe,
          currentPrice: activePrice,
          candles: Array.isArray(candles) ? candles.slice(-25) : [],
        })),
      })

      if (!response.ok) {
        throw new Error(`AI trader evaluate failed: ${await readApiError(response)}`)
      }

      const json = await response.json()
      setSummary(json?.summary ?? null)
      setActionStatus(`Evaluated • Closed ${json?.closedCount ?? 0} trade(s)`)
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Evaluate failed')
    }
  }, [apiBaseUrl, activePrice, candles, symbol, timeframe])

  const openDashboardTrade = useCallback(async () => {
    if (!apiBaseUrl) return

    try {
      setActionStatus('Opening dashboard-only AI trade...')

      const response = await fetch(`${apiBaseUrl}/api/ai-trader/open`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(safePayload),
      })

      if (!response.ok) {
        throw new Error(`AI trader open failed: ${await readApiError(response)}`)
      }

      const json = await response.json()
      setDecision(json?.decision ?? decision)
      setSummary(json?.summary ?? summary)
      setActionStatus(json?.opened ? 'Dashboard AI trade opened' : json?.message ?? 'AI trade not opened')
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Open failed')
    }
  }, [apiBaseUrl, safePayload, decision, summary])

  useEffect(() => {
    fetchDecision()
  }, [fetchDecision])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  useEffect(() => {
    if (!autoPaperMode) return
    if (!decision?.allowedToTrade) return

    const side = normalizeDecision(decision.rawDecision ?? decision.decision)
    if (side === 'HOLD') return

    const key = [
      symbol,
      timeframe,
      side,
      Number(decision.entry ?? 0).toFixed(4),
      Number(decision.target ?? 0).toFixed(4),
      Number(decision.stop ?? 0).toFixed(4),
    ].join('|')

    if (key === lastAutoOpenKey) return

    setLastAutoOpenKey(key)
    openDashboardTrade()
  }, [autoPaperMode, decision, lastAutoOpenKey, openDashboardTrade, symbol, timeframe])

  useEffect(() => {
    const id = window.setInterval(() => {
      fetchDecision()
      fetchSummary()
      evaluateOpenTrades()
    }, 15000)

    return () => window.clearInterval(id)
  }, [fetchDecision, fetchSummary, evaluateOpenTrades])

  const aiDecision = normalizeDecision(decision?.decision)
  const rawDecision = normalizeDecision(decision?.rawDecision)
  const decisionTone =
    aiDecision === 'BUY'
      ? 'bull'
      : aiDecision === 'SELL'
        ? 'bear'
        : rawDecision === 'BUY' || rawDecision === 'SELL'
          ? 'warn'
          : 'neutral'

  const stats = summary?.stats ?? {}
  const decisionStats = summary?.decisionStats ?? summary?.memoryStatus?.overallDecisionStats ?? {}
  const memoryStatus = summary?.memoryStatus ?? decision?.details?.memoryStatus ?? {}
  const blockers = getBlockerAnalysis(decision, summary, minConfidence, minRiskReward)

  const openTrades = Array.isArray(summary?.openTrades) ? summary?.openTrades ?? [] : []
  const closedTrades =
    Array.isArray(summary?.recentClosedTrades)
      ? summary?.recentClosedTrades ?? []
      : Array.isArray(summary?.closedTrades)
        ? summary?.closedTrades ?? []
        : []

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mb-6 rounded-2xl border border-purple-400/20 bg-dark-800/90 p-5 shadow-xl"
    >
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black text-white">Dashboard AI Self-Learning Trader</h2>
            <span className="rounded-full border border-purple-400/30 bg-purple-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-purple-200">
              Dashboard Only
            </span>
            <span className="rounded-full border border-red-400/30 bg-red-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-red-200">
              No Broker
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Simulated AI trades only. Learns from dashboard entries, targets, stops, P&amp;L, and closed outcomes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-black ${
            autoPaperMode
              ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
              : 'border-dark-600 bg-dark-900 text-gray-400'
          }`}>
            <input
              type="checkbox"
              checked={autoPaperMode}
              onChange={(event) => setAutoPaperMode(event.target.checked)}
              className="h-3 w-3"
            />
            Auto Paper
          </label>

          <label className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            Min Conf
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={minConfidence}
              onChange={(event) => setMinConfidence(Math.max(1, Math.min(100, Number(event.target.value) || 62)))}
              className="ml-2 w-14 rounded border border-dark-600 bg-dark-800 px-2 py-1 text-xs text-white"
            />
          </label>

          <label className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            Min RR
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.05}
              value={minRiskReward}
              onChange={(event) => setMinRiskReward(Math.max(0.1, Math.min(10, Number(event.target.value) || 1.25)))}
              className="ml-2 w-16 rounded border border-dark-600 bg-dark-800 px-2 py-1 text-xs text-white"
            />
          </label>

          <button
            type="button"
            onClick={fetchDecision}
            className="rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-xs font-bold text-gray-200 hover:border-purple-300"
          >
            Refresh AI
          </button>
          <button
            type="button"
            onClick={evaluateOpenTrades}
            className="rounded-lg border border-blue-400/30 bg-blue-400/10 px-3 py-2 text-xs font-bold text-blue-200 hover:bg-blue-400/20"
          >
            Evaluate Open
          </button>
          <button
            type="button"
            onClick={openDashboardTrade}
            disabled={!decision?.allowedToTrade}
            className={`rounded-lg px-3 py-2 text-xs font-black ${
              decision?.allowedToTrade
                ? 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20'
                : 'cursor-not-allowed border border-dark-600 bg-dark-900 text-gray-600'
            }`}
          >
            {autoPaperMode ? 'Auto Paper Armed' : 'Open AI Paper Trade'}
          </button>
        </div>
      </div>

      {errorText ? (
        <div className="mb-4 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
          {errorText}
        </div>
      ) : null}

      {actionStatus ? (
        <div className="mb-4 rounded-lg border border-purple-400/20 bg-purple-400/10 px-3 py-2 text-xs text-purple-200">
          {actionStatus}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatBox
          label="AI Decision"
          value={isLoading ? 'Loading...' : (decision?.decision ?? 'WAITING')}
          tone={decisionTone as any}
        />
        <StatBox
          label="Raw Bias"
          value={decision?.rawDecision ?? '—'}
          tone={rawDecision === 'BUY' ? 'bull' : rawDecision === 'SELL' ? 'bear' : 'neutral'}
        />
        <StatBox label="Confidence" value={`${toFiniteNumber(decision?.confidence, 0).toFixed(1)}% ${decision?.confidenceGrade ?? ''}`} tone="neutral" />
        <StatBox label="Auto Paper" value={autoPaperMode ? 'ARMED' : 'OFF'} tone={autoPaperMode ? 'bull' : 'neutral'} />
        <StatBox label="Entry" value={formatPrice(decision?.entry)} />
        <StatBox label="Target" value={formatPrice(decision?.target)} />
        <StatBox label="Stop" value={formatPrice(decision?.stop)} tone="warn" />
        <StatBox label="Current P&L" value={formatMoney(decision?.currentPnl)} tone={toFiniteNumber(decision?.currentPnl, 0) >= 0 ? 'bull' : 'bear'} />
        <StatBox label="Max P&L" value={formatMoney(decision?.maxPnl)} tone={toFiniteNumber(decision?.maxPnl, 0) >= 0 ? 'bull' : 'bear'} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-dark-700 bg-dark-900/70 p-4 xl:col-span-2">
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-gray-400">AI Reason</div>
          <p className="text-sm leading-6 text-gray-200">
            {decision?.reason ?? 'Waiting for enough dashboard data to create a decision.'}
          </p>

          {Array.isArray(decision?.reasons) && decision.reasons.length > 0 ? (
            <div className="mt-3 space-y-1">
              {decision.reasons.slice(0, 6).map((reason, index) => (
                <div key={`${reason}-${index}`} className="text-xs text-gray-400">
                  • {reason}
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-dark-700 bg-dark-800/70 p-3">
            <div className="mb-2 text-xs font-black uppercase tracking-wide text-gray-400">Blocker Analysis</div>
            <div className="space-y-2">
              {blockers.slice(0, 6).map((blocker) => (
                <div key={`${blocker.label}-${blocker.detail}`} className="flex flex-col gap-1 rounded-lg border border-dark-700 bg-dark-900/70 px-3 py-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-xs font-black text-white">{blocker.label}</div>
                    <div className="text-xs text-gray-500">{blocker.detail}</div>
                  </div>
                  <BlockerBadge severity={blocker.severity} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-dark-700 bg-dark-900/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs font-black uppercase tracking-wide text-gray-400">Learning Memory</div>
            <span className="rounded-full border border-purple-400/30 bg-purple-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-purple-200">
              {formatAiStage(memoryStatus.stage)}
            </span>
          </div>

          <div className="mb-3 rounded-lg border border-dark-700 bg-dark-800/70 px-3 py-2 text-xs text-gray-300">
            {String(memoryStatus.message ?? 'AI memory is collecting live decision observations.')}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <StatBox label="Decisions" value={formatCount(decisionStats.samples)} />
            <StatBox label="Trade Ready" value={formatCount(decisionStats.tradeReadyCount)} tone="bull" />
            <StatBox label="HOLD Count" value={formatCount(decisionStats.holdCount)} tone="warn" />
            <StatBox label="Avg AI Conf" value={`${toFiniteNumber(decisionStats.avgConfidence, 0).toFixed(1)}%`} />
            <StatBox label="BUY Bias" value={formatCount(decisionStats.buyBias)} tone="bull" />
            <StatBox label="SELL Bias" value={formatCount(decisionStats.sellBias)} tone="bear" />
            <StatBox label="Open" value={String(summary?.openCount ?? 0)} />
            <StatBox label="Closed" value={String(summary?.closedCount ?? 0)} />
            <StatBox label="Win Rate" value={formatPercent(stats.winRate)} tone="bull" />
            <StatBox label="Profit Factor" value={toFiniteNumber(stats.profitFactor, 0).toFixed(2)} />
            <StatBox label="Avg P&L" value={formatMoney(stats.avgPnl)} />
            <StatBox label="Avg R" value={toFiniteNumber(stats.avgR, 0).toFixed(2)} />
          </div>
        </div>
      </div>

      {openTrades.length > 0 ? (
        <div className="mt-4 rounded-xl border border-dark-700 bg-dark-900/70 p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-wide text-gray-400">Open Dashboard AI Trades</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="text-gray-500">
                <tr>
                  <th className="pb-2">Side</th>
                  <th className="pb-2">Entry</th>
                  <th className="pb-2">Target</th>
                  <th className="pb-2">Stop</th>
                  <th className="pb-2">Current</th>
                  <th className="pb-2">P&L</th>
                  <th className="pb-2">Confidence</th>
                  <th className="pb-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {openTrades.slice(-5).map((trade: any) => (
                  <tr key={trade.id ?? `${trade.side}-${trade.entryTime}`} className="border-t border-dark-700 text-gray-300">
                    <td className={`py-2 font-black ${normalizeDecision(trade.side) === 'BUY' ? 'text-emerald-300' : 'text-red-300'}`}>
                      {trade.side}
                    </td>
                    <td className="py-2">{formatPrice(trade.entry)}</td>
                    <td className="py-2">{formatPrice(trade.target)}</td>
                    <td className="py-2">{formatPrice(trade.stop)}</td>
                    <td className="py-2">{formatPrice(trade.currentPrice)}</td>
                    <td className={`py-2 font-bold ${toFiniteNumber(trade.currentPnl, 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {formatMoney(trade.currentPnl)}
                    </td>
                    <td className="py-2">{toFiniteNumber(trade.confidence, 0).toFixed(1)}%</td>
                    <td className="max-w-[280px] truncate py-2 text-gray-500">{trade.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {closedTrades.length > 0 ? (
        <div className="mt-4 rounded-xl border border-dark-700 bg-dark-900/70 p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-wide text-gray-400">Recent Closed AI Trades</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="text-gray-500">
                <tr>
                  <th className="pb-2">Result</th>
                  <th className="pb-2">Side</th>
                  <th className="pb-2">Entry</th>
                  <th className="pb-2">Exit</th>
                  <th className="pb-2">Target</th>
                  <th className="pb-2">Stop</th>
                  <th className="pb-2">P&L</th>
                  <th className="pb-2">R</th>
                  <th className="pb-2">Exit Reason</th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.slice(-5).reverse().map((trade: any) => (
                  <tr key={trade.id ?? `${trade.side}-${trade.exitTime}`} className="border-t border-dark-700 text-gray-300">
                    <td className={`py-2 font-black ${String(trade.result).toUpperCase() === 'WIN' ? 'text-emerald-300' : 'text-red-300'}`}>
                      {trade.result ?? 'CLOSED'}
                    </td>
                    <td className={`py-2 font-black ${normalizeDecision(trade.side) === 'BUY' ? 'text-emerald-300' : 'text-red-300'}`}>
                      {trade.side}
                    </td>
                    <td className="py-2">{formatPrice(trade.entry)}</td>
                    <td className="py-2">{formatPrice(trade.exit ?? trade.exitPrice)}</td>
                    <td className="py-2">{formatPrice(trade.target)}</td>
                    <td className="py-2">{formatPrice(trade.stop)}</td>
                    <td className={`py-2 font-bold ${toFiniteNumber(trade.pnl, 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {formatMoney(trade.pnl)}
                    </td>
                    <td className="py-2">{toFiniteNumber(trade.rMultiple, 0).toFixed(2)}</td>
                    <td className="py-2 text-gray-500">{trade.exitReason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

    </motion.div>
  )
}
