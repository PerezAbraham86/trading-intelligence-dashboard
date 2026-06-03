'use client'

import { useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, XCircle } from 'lucide-react'

type TradingSignal = {
  symbol?: string
  timeframe?: string
  primaryTimeframe?: string
  activeSymbol?: string
  activeTimeframe?: string
  price?: number
  current?: number
  entry?: number
  smc?: string
  alphax?: string
  ghost?: string
  openInterest?: string
  footprint?: string
  session?: string
  fredMacro?: string
  finraShortVolume?: string
  cot?: string
  confidence?: number
  bullScore?: number
  bearScore?: number
  smcStrength?: number
  alphaxStrength?: number
  ghostConfidence?: number
  smcDirection?: string
  alphaxDirection?: string
  ghostDirection?: string
  alphaxBullPressure?: number
  alphaxBearPressure?: number
  fredMacroStrength?: number
  fredMacroDirection?: string
  fredMacroRisk?: number
  optionsFlow?: string
  optionsFlowStrength?: number
  optionsFlowDirection?: string
  optionsBullPressure?: number
  optionsBearPressure?: number
  putCallRatio?: number | null
  unusualOptionsVolume?: number
  gammaRisk?: number
  dealerPinZone?: number | null
  chartOverlayToggles?: {
    smc?: boolean
    ghost?: boolean
    liquidityProfile?: boolean
    orderBlocks?: boolean
  }
}

type TechnicalIndicator = {
  name: string
  value: number
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | string
}

type TechnicalSentiment = {
  eventType?: string
  symbol?: string
  timeframe?: string
  sentiment?: number
  sentimentStatus?: string
  bearCount?: number
  neutralCount?: number
  bullCount?: number
  bearPct?: number
  neutralPct?: number
  bullPct?: number
  activeCount?: number
  indicators?: TechnicalIndicator[]
  technicalIndicators?: TechnicalIndicator[]
  technicalMeter?: TechnicalIndicator[]
  factors?: TechnicalIndicator[]
}

type FactorConfirmationTableProps = {
  signal?: TradingSignal
  technicalSentiment?: TechnicalSentiment | null
  onTechnicalSentimentUpdate?: (sentiment: TechnicalSentiment | null) => void
  activeSymbol?: string
  activeTimeframe?: string
  activePrice?: number
}

type FactorStatus = 'bullish' | 'bearish' | 'active' | 'inactive'

type FactorRow = {
  factor: string
  status: FactorStatus
  strength: number
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeSymbol(value: unknown) {
  const raw = String(value ?? 'BTCUSD')
    .trim()
    .toUpperCase()
    .replace('BINANCE:', '')
    .replace('COINBASE:', '')
    .replace('CRYPTO:', '')
    .replace('CME_MINI:', '')
    .replace('CME:', '')

  if (raw === 'MES1' || raw === 'MES1!' || raw.includes('MES')) return 'MES1!'
  if (raw.includes('BTC')) return 'BTCUSD'
  if (raw.includes('ETH')) return 'ETHUSD'
  if (raw.includes('SPY')) return 'SPY'

  return raw || 'BTCUSD'
}

function normalizeTimeframe(value: unknown) {
  const raw = String(value ?? '1m').trim().toLowerCase()
  const tf = raw.includes('/') ? raw.split('/')[0]?.trim() ?? raw : raw

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

function timeframeMatches(value: unknown, activeTimeframe: string) {
  const text = String(value ?? '').trim()

  if (text.includes('/')) {
    return text
      .split('/')
      .map((item) => normalizeTimeframe(item.trim()))
      .includes(normalizeTimeframe(activeTimeframe))
  }

  return normalizeTimeframe(text) === normalizeTimeframe(activeTimeframe)
}

function isPriceNearActiveScale(signal: TradingSignal | undefined, activePrice?: number) {
  const price = Number(signal?.current ?? signal?.price ?? signal?.entry ?? 0)
  if (!Number.isFinite(price) || price <= 0) return true
  if (!activePrice || !Number.isFinite(activePrice) || activePrice <= 0) return true

  return Math.abs(price - activePrice) / activePrice <= 0.2
}

function isSignalLinkedToActiveChart(signal: TradingSignal | undefined, activeSymbol: string, activeTimeframe: string, activePrice?: number) {
  if (!signal) return false

  return (
    normalizeSymbol(signal.activeSymbol ?? signal.symbol) === normalizeSymbol(activeSymbol) &&
    timeframeMatches(signal.activeTimeframe ?? signal.primaryTimeframe ?? signal.timeframe, activeTimeframe) &&
    isPriceNearActiveScale(signal, activePrice)
  )
}

function factorStrength(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) return clamp(parsed)
  return clamp(fallback)
}

function isWaitingOrNeutral(value?: string) {
  const lower = String(value ?? '').toLowerCase()

  return (
    !lower ||
    lower.includes('waiting') ||
    lower.includes('neutral') ||
    lower.includes('none') ||
    lower.includes('no signal')
  )
}

function isBullishText(value?: string) {
  const lower = String(value ?? '').toLowerCase()

  return (
    lower.includes('bull') ||
    lower.includes('buy') ||
    lower.includes('up') ||
    lower.includes('long') ||
    lower.includes('positive')
  )
}

function isBearishText(value?: string) {
  const lower = String(value ?? '').toLowerCase()

  return (
    lower.includes('bear') ||
    lower.includes('sell') ||
    lower.includes('down') ||
    lower.includes('short') ||
    lower.includes('negative')
  )
}

function statusFromText(value?: string): FactorStatus {
  if (isBullishText(value)) return 'bullish'
  if (isBearishText(value)) return 'bearish'
  if (isWaitingOrNeutral(value)) return 'inactive'
  return 'active'
}

function getStatusIcon(status: FactorStatus, size = 15) {
  if (status === 'bullish' || status === 'active') {
    return <CheckCircle2 size={size} className="text-emerald-400" />
  }

  if (status === 'bearish') {
    return <XCircle size={size} className="text-red-400" />
  }

  return <XCircle size={size} className="text-red-400/80" />
}

function getBarColor(status: FactorStatus) {
  if (status === 'bullish' || status === 'active') return 'bg-emerald-400'
  if (status === 'bearish') return 'bg-red-400'
  return 'bg-dark-600'
}

function getStatusText(status: FactorStatus) {
  if (status === 'bullish') return 'Bullish'
  if (status === 'bearish') return 'Bearish'
  if (status === 'active') return 'Active'
  return 'Inactive'
}

function getStatusTextColor(status: FactorStatus) {
  if (status === 'bullish' || status === 'active') return 'text-emerald-400'
  if (status === 'bearish') return 'text-red-400'
  return 'text-gray-500'
}

function buildCoreRows(signal?: TradingSignal, isLinked = true): FactorRow[] {
  const confidence = clamp(Number(signal?.confidence ?? 0))
  const bullScore = clamp(Number(signal?.bullScore ?? 50))
  const bearScore = clamp(Number(signal?.bearScore ?? 50))
  const toggles = signal?.chartOverlayToggles ?? {
    smc: true,
    ghost: true,
    liquidityProfile: true,
    orderBlocks: true,
  }

  const smcEnabled = isLinked && Boolean(toggles.smc)
  const ghostEnabled = isLinked && Boolean(toggles.ghost)
  const profileEnabled = isLinked && Boolean(toggles.liquidityProfile)
  const orderBlocksEnabled = isLinked && Boolean(toggles.orderBlocks)

  const smcStatus = smcEnabled
    ? statusFromText(signal?.smc ?? signal?.smcDirection)
    : 'inactive'

  const alphaxStatus = profileEnabled
    ? statusFromText(signal?.alphax ?? signal?.alphaxDirection)
    : 'inactive'

  const ghostStatus = ghostEnabled
    ? statusFromText(signal?.ghost ?? signal?.ghostDirection)
    : 'inactive'

  const orderBlockStatus = orderBlocksEnabled
    ? statusFromText(signal?.smc ?? signal?.smcDirection)
    : 'inactive'

  const sessionStatus = statusFromText(signal?.session)

  const smcStrength = factorStrength(signal?.smcStrength, Math.max(confidence, bullScore, bearScore))
  const alphaxStrength = factorStrength(signal?.alphaxStrength, Math.max(signal?.alphaxBullPressure ?? 0, signal?.alphaxBearPressure ?? 0, bullScore, bearScore))
  const ghostStrength = factorStrength(signal?.ghostConfidence, confidence)
  const orderBlockStrength = factorStrength(signal?.smcStrength, Math.max(confidence, bullScore, bearScore))

  return [
    {
      factor: smcEnabled ? 'SMC Structure' : 'SMC Structure Off',
      status: smcStatus,
      strength: smcStatus === 'inactive' ? 0 : smcStrength,
    },
    {
      factor: profileEnabled ? 'AlphaX DLM / Profile' : 'AlphaX DLM / Profile Off',
      status: alphaxStatus,
      strength: alphaxStatus === 'inactive' ? 0 : alphaxStrength,
    },
    {
      factor: ghostEnabled ? 'Python Ghost Candles' : 'Python Ghost Candles Off',
      status: ghostStatus,
      strength: ghostStatus === 'inactive' ? 0 : ghostStrength,
    },
    {
      factor: orderBlocksEnabled ? 'Order Blocks' : 'Order Blocks Off',
      status: orderBlockStatus,
      strength: orderBlockStatus === 'inactive' ? 0 : orderBlockStrength,
    },
    {
      factor: 'Session',
      status: sessionStatus,
      strength: sessionStatus === 'inactive' ? 0 : 55,
    },
  ]
}

function buildExternalRows(signal?: TradingSignal): FactorRow[] {
  const bullScore = clamp(Number(signal?.bullScore ?? 50))
  const fredStrength = factorStrength(signal?.fredMacroStrength, Number(signal?.fredMacroRisk ?? 45))

  const optionsStrength = factorStrength(
    signal?.optionsFlowStrength,
    Math.max(Number(signal?.optionsBullPressure ?? 0), Number(signal?.optionsBearPressure ?? 0), Number(signal?.gammaRisk ?? 0))
  )

  const rows: Array<[string, string | undefined, number]> = [
    ['Options Flow', signal?.optionsFlow, optionsStrength],
    ['Open Interest', signal?.openInterest, 65],
    ['Footprint Delta', signal?.footprint, bullScore],
    ['FRED Macro', signal?.fredMacro ?? 'Active FRED Macro', fredStrength],
    ['FINRA Short Volume', signal?.finraShortVolume, 71],
    ['COT', signal?.cot, 81],
  ]

  return rows.map(([factor, value, fallbackStrength]) => {
    const status = statusFromText(value)

    return {
      factor,
      status,
      strength: status === 'inactive' ? 0 : fallbackStrength,
    }
  })
}

function FactorRowItem({ row }: { row: FactorRow }) {
  return (
    <div className="grid grid-cols-[1fr_auto_72px] items-center gap-3 border-b border-dark-700/70 py-2.5 text-sm text-gray-300">
      <div>
        <p className="font-medium">{row.factor}</p>
        <p className={`text-[10px] font-bold uppercase ${getStatusTextColor(row.status)}`}>
          {getStatusText(row.status)}
        </p>
      </div>

      <div className="flex justify-center">{getStatusIcon(row.status)}</div>

      <div className="flex items-center justify-end gap-2">
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-dark-700">
          <div
            className={`h-full rounded-full ${getBarColor(row.status)}`}
            style={{ width: `${row.strength}%` }}
          />
        </div>

        <span className="w-8 text-right font-bold text-white">{row.strength}%</span>
      </div>
    </div>
  )
}

export default function FactorConfirmationTable({
  signal,
  onTechnicalSentimentUpdate,
  activeSymbol,
  activeTimeframe,
  activePrice,
}: FactorConfirmationTableProps) {
  const symbol = normalizeSymbol(activeSymbol ?? signal?.activeSymbol ?? signal?.symbol)
  const timeframe = normalizeTimeframe(activeTimeframe ?? signal?.activeTimeframe ?? signal?.primaryTimeframe ?? signal?.timeframe)
  const linkedToActiveChart = isSignalLinkedToActiveChart(signal, symbol, timeframe, activePrice)
  const linkedSignal = linkedToActiveChart ? signal : undefined

  const bullScore = clamp(Number(linkedSignal?.bullScore ?? signal?.bullScore ?? 50))
  const bearScore = clamp(Number(linkedSignal?.bearScore ?? signal?.bearScore ?? 50))

  const coreRows = useMemo(() => buildCoreRows(linkedSignal, linkedToActiveChart), [linkedSignal, linkedToActiveChart])
  const externalRows = useMemo(() => buildExternalRows(signal), [signal])

  const activeCoreCount = coreRows.filter((row) => row.status !== 'inactive').length
  const bullCoreCount = coreRows.filter((row) => row.status === 'bullish' || row.status === 'active').length
  const bearCoreCount = coreRows.filter((row) => row.status === 'bearish').length

  // The 12-indicator technical meter now belongs ONLY under Market Sentiment.
  // Clear the shared technical state so app/page.tsx does not duplicate it here.
  useEffect(() => {
    onTechnicalSentimentUpdate?.(null)
  }, [onTechnicalSentimentUpdate])

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Factor Confirmation</h2>
          <p className="mt-1 text-xs text-gray-500">
            Chart-linked core factors • {symbol} • {timeframe}
          </p>
        </div>

        <div className="rounded-lg border border-dark-600 bg-dark-900/40 px-3 py-2 text-right">
          <p className="text-xs text-gray-500">Core</p>
          <p className="text-lg font-bold text-white">{activeCoreCount}</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-dark-900/40 p-2">
          <p className="text-gray-500">Active</p>
          <p className="font-bold text-white">{activeCoreCount}</p>
        </div>

        <div className="rounded-lg bg-dark-900/40 p-2">
          <p className="text-red-400">Bear</p>
          <p className="font-bold text-white">{bearCoreCount}</p>
        </div>

        <div className="rounded-lg bg-dark-900/40 p-2">
          <p className="text-emerald-400">Bull</p>
          <p className="font-bold text-white">{bullCoreCount}</p>
        </div>
      </div>

      <div className="space-y-5">
        <section>
          <div className="mb-2 border-b border-dark-700 pb-2">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Core</p>
          </div>

          <div>
            {coreRows.map((row) => (
              <FactorRowItem key={`core-${row.factor}`} row={row} />
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 border-b border-dark-700 pb-2">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
              External Data
            </p>
          </div>

          <div>
            {externalRows.map((row) => (
              <FactorRowItem key={`external-${row.factor}`} row={row} />
            ))}
          </div>
        </section>
      </div>

      <div className="mt-4 border-t border-dark-700 pt-3 text-xs text-gray-500">
        Bull/Bear balance: {bullScore}% / {bearScore}% • Core factors are shown only when linked to the active chart
      </div>
    </motion.div>
  )
}
