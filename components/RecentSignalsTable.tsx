'use client'

import { motion } from 'framer-motion'

type RecentSignal = {
  symbol?: string
  timeframe?: string
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

function buildLiveSnapshot(latestSignal?: RecentSignal): RecentSignal {
  const price = Number(latestSignal?.current ?? latestSignal?.price ?? latestSignal?.entry ?? 0)
  const type = normalizeSignalType(latestSignal?.signal ?? latestSignal?.type)

  return {
    symbol: latestSignal?.symbol ?? 'BTCUSD',
    timeframe: latestSignal?.timeframe ?? '1m',
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
}: RecentSignalsTableProps) {
  const cleanSignals = Array.isArray(signals)
    ? signals.filter((signal) => !isPlaceholderSignal(signal))
    : []

  // The dashboard now runs mostly from Python live state instead of Pine trade alerts.
  // If no true TRADE_SIGNAL rows exist yet, show the current Python/live snapshot
  // instead of the old WAITING / 1d placeholder row.
  const displaySignals =
    cleanSignals.length > 0
      ? cleanSignals
      : [buildLiveSnapshot(latestSignal)]

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
            True trade alerts first. Live Python snapshot shown while no trade is open.
          </p>
        </div>

        <div className="rounded-lg border border-dark-600 bg-dark-900/40 px-3 py-2 text-right">
          <p className="text-xs text-gray-500">
            {cleanSignals.length > 0 ? 'Trade Rows' : 'Mode'}
          </p>
          <p className="text-sm font-bold text-white">
            {cleanSignals.length > 0 ? cleanSignals.length : 'Live'}
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
                    {signal.symbol ?? latestSignal?.symbol ?? 'BTCUSD'}
                  </td>

                  <td className="py-3 pr-4">
                    {signal.timeframe ?? latestSignal?.timeframe ?? '1m'}
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
