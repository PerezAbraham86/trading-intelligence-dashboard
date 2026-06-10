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
  openCount?: number
  closedCount?: number
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

function buildTargetMlSnapshot(signal: any, overlayPayload: any) {
  return {
    targetConfidence: toFiniteNumber(
      signal?.targetConfidence ??
      signal?.targetMl?.targetConfidence ??
      overlayPayload?.targetConfidence,
      0,
    ),
    targetMlReady: Boolean(
      signal?.targetMlReady ??
      signal?.targetMl?.targetMlReady ??
      overlayPayload?.targetMlReady,
    ),
    targetPrice: inferTargetFromSignal(signal),
    source: signal?.targetSource ?? signal?.targetMl?.source ?? overlayPayload?.targetSource,
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

  const payload = useMemo(() => {
    const target = inferTargetFromSignal(signal)
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
      targetMl: buildTargetMlSnapshot(signal, overlayPayload),
      entryMl: buildEntryMlSnapshot(signal),
      nrtrContext: scorecards?.nrtrStrategyFeeds ?? scorecards?.nrtrCharts ?? {},
      unifiedIntelligence,
      context: {
        mode: 'dashboard_only_ai_paper_trader',
        dashboardOnly: true,
        noBroker: true,
      },
      minConfidence: 62,
      minRiskReward: 1.25,
    }
  }, [activePrice, signal, scorecards, overlayPayload, unifiedIntelligence, symbol, timeframe])

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
  const openTrades = Array.isArray(summary?.openTrades) ? summary?.openTrades ?? [] : []

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

        <div className="flex flex-wrap gap-2">
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
            Open AI Paper Trade
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
        </div>

        <div className="rounded-xl border border-dark-700 bg-dark-900/70 p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-wide text-gray-400">Learning Memory</div>
          <div className="grid grid-cols-2 gap-2">
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
    </motion.div>
  )
}
