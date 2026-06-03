'use client'

import { motion } from 'framer-motion'

type RecentSignal = {
  symbol?: string
  timeframe?: string
  primaryTimeframe?: string
  signal?: string
  type?: string
  confidence?: number
  price?: number
  entry?: number
  current?: number
  pnl?: number
  percent?: number
  status?: string
  createdAt?: string
}

type RecentSignalsTableProps = {
  signals: RecentSignal[]
  latestSignal?: RecentSignal
  activeSymbol?: string
  activeTimeframe?: string
  activePrice?: number
}

function normalizeSymbol(value?: string) {
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

function normalizeTimeframe(value?: string) {
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

function isPriceNearActiveScale(signal: RecentSignal, activePrice?: number) {
  const price = Number(signal.current ?? signal.price ?? signal.entry ?? 0)
  if (!Number.isFinite(price) || price <= 0) return false
  if (!activePrice || !Number.isFinite(activePrice) || activePrice <= 0) return true

  return Math.abs(price - activePrice) / activePrice <= 0.2
}

function normalizeSignalType(value?: string) {
  const type = String(value ?? 'NEUTRAL').toUpperCase()

  if (type.includes('BUY') || type.includes('BULL') || type.includes('LONG')) return 'BUY'
  if (type.includes('SELL') || type.includes('BEAR') || type.includes('SHORT')) return 'SELL'

  return 'NEUTRAL'
}

function isPlaceholderSignal(signal?: RecentSignal) {
  if (!signal) return true

  const symbol = String(signal.symbol ?? '').toUpperCase()
  const status = String(signal.status ?? '').toLowerCase()
  const entry = Number(signal.entry ?? signal.price ?? 0)
  const current = Number(signal.current ?? signal.price ?? 0)

  return (
    symbol === 'WAITING' ||
    status === 'waiting' ||
    (!entry && !current && !Number(signal.confidence ?? 0))
  )
}

function formatPrice(value?: number) {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) return '—'
  if (Math.abs(numeric) >= 1000) return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (Math.abs(numeric) >= 100) return numeric.toFixed(2)
  if (Math.abs(numeric) >= 10) return numeric.toFixed(3)

  return numeric.toFixed(4)
}

function formatTime(value?: string) {
  if (!value) return new Date().toLocaleTimeString()

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleTimeString()
}

function getSignalClass(type: string) {
  if (type === 'BUY') return 'bg-emerald-500/20 text-emerald-400'
  if (type === 'SELL') return 'bg-red-500/20 text-red-400'

  return 'bg-yellow-500/20 text-yellow-400'
}

function getStatusClass(status?: string) {
  const lower = String(status ?? '').toLowerCase()

  if (lower.includes('open') || lower.includes('live')) return 'text-emerald-400'
  if (lower.includes('closed')) return 'text-gray-400'
  if (lower.includes('waiting')) return 'text-yellow-400'

  return 'text-gray-300'
}

function isSignalLinkedToActiveChart(signal: RecentSignal, activeSymbol: string, activeTimeframe: string, activePrice?: number) {
  const symbol = normalizeSymbol(signal.symbol)
  const timeframe = signal.primaryTimeframe ?? signal.timeframe

  return (
    symbol === normalizeSymbol(activeSymbol) &&
    timeframeMatches(timeframe, activeTimeframe) &&
    isPriceNearActiveScale(signal, activePrice)
  )
}

function buildLiveSnapshot(latestSignal?: RecentSignal, activeSymbol = 'BTCUSD', activeTimeframe = '1m', activePrice?: number): RecentSignal {
  const price = Number(activePrice ?? latestSignal?.current ?? latestSignal?.price ?? latestSignal?.entry ?? 0)
  const type = normalizeSignalType(latestSignal?.signal ?? latestSignal?.type)

  return {
    symbol: normalizeSymbol(activeSymbol),
    timeframe: normalizeTimeframe(activeTimeframe),
    signal: type,
    confidence: Number(latestSignal?.confidence ?? 0),
    entry: Number(latestSignal?.entry ?? price),
    current: price,
    pnl: 0,
    percent: 0,
    status: 'Live Snapshot',
    createdAt: latestSignal?.createdAt ?? new Date().toISOString(),
  }
}

export default function RecentSignalsTable({
  signals,
  latestSignal,
  activeSymbol,
  activeTimeframe,
  activePrice,
}: RecentSignalsTableProps) {
  const symbol = normalizeSymbol(activeSymbol ?? latestSignal?.symbol)
  const timeframe = normalizeTimeframe(activeTimeframe ?? latestSignal?.primaryTimeframe ?? latestSignal?.timeframe)

  const cleanSignals = Array.isArray(signals)
    ? signals.filter((signal) => !isPlaceholderSignal(signal))
    : []

  const linkedSignals = cleanSignals.filter((signal) =>
    isSignalLinkedToActiveChart(signal, symbol, timeframe, activePrice)
  )

  const displaySignals =
    linkedSignals.length > 0
      ? linkedSignals
      : [buildLiveSnapshot(latestSignal, symbol, timeframe, activePrice)]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Recent Signals</h2>
          <p className="mt-1 text-xs text-gray-500">
            Chart-linked rows only • {symbol} • {timeframe}
          </p>
        </div>

        <div className="rounded-lg border border-dark-600 bg-dark-900/40 px-3 py-2 text-right">
          <p className="text-xs text-gray-500">
            {linkedSignals.length > 0 ? 'Linked Rows' : 'Mode'}
          </p>
          <p className="text-sm font-bold text-white">
            {linkedSignals.length > 0 ? linkedSignals.length : 'Live'}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[840px] text-sm">
          <thead>
            <tr className="border-b border-dark-700 text-left text-gray-400">
              <th className="py-3 pr-4">Time</th>
              <th className="py-3 pr-4">Symbol</th>
              <th className="py-3 pr-4">TF</th>
              <th className="py-3 pr-4">Type</th>
              <th className="py-3 pr-4">Confidence</th>
              <th className="py-3 pr-4">Entry</th>
              <th className="py-3 pr-4">Current</th>
              <th className="py-3 pr-4">P&L</th>
              <th className="py-3 pr-4">%</th>
              <th className="py-3 pr-4">Status</th>
            </tr>
          </thead>

          <tbody>
            {displaySignals.map((signal, index) => {
              const type = normalizeSignalType(signal.signal ?? signal.type)
              const pnl = Number(signal.pnl ?? 0)
              const percent = Number(signal.percent ?? 0)
              const confidence = Number(signal.confidence ?? 0)

              return (
                <motion.tr
                  key={`${signal.symbol ?? 'signal'}-${signal.createdAt ?? index}-${index}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.05 * index }}
                  className="border-b border-dark-700/70 text-gray-300"
                >
                  <td className="py-3 pr-4">{formatTime(signal.createdAt)}</td>

                  <td className="py-3 pr-4 font-semibold text-white">
                    {normalizeSymbol(signal.symbol ?? symbol)}
                  </td>

                  <td className="py-3 pr-4">
                    {normalizeTimeframe(signal.primaryTimeframe ?? signal.timeframe ?? timeframe)}
                  </td>

                  <td className="py-3 pr-4">
                    <span
                      className={`rounded px-2 py-1 text-xs font-bold ${getSignalClass(type)}`}
                    >
                      {type}
                    </span>
                  </td>

                  <td className="py-3 pr-4 font-semibold text-white">
                    {Math.round(Number.isFinite(confidence) ? confidence : 0)}%
                  </td>

                  <td className="py-3 pr-4">
                    {formatPrice(signal.entry ?? signal.price)}
                  </td>

                  <td className="py-3 pr-4">
                    {formatPrice(signal.current ?? signal.price)}
                  </td>

                  <td
                    className={`py-3 pr-4 font-semibold ${
                      pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {pnl > 0 ? '+' : ''}
                    {formatPrice(pnl)}
                  </td>

                  <td
                    className={`py-3 pr-4 font-semibold ${
                      percent >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {percent > 0 ? '+' : ''}
                    {Number.isFinite(percent) ? percent.toFixed(2) : '0.00'}%
                  </td>

                  <td className={`py-3 pr-4 font-semibold ${getStatusClass(signal.status)}`}>
                    {signal.status ?? 'Live Snapshot'}
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
