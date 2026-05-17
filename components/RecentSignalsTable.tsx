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
}

export default function RecentSignalsTable({ signals }: RecentSignalsTableProps) {
  const displaySignals =
    Array.isArray(signals) && signals.length > 0
      ? signals
      : [
          {
            symbol: 'WAITING',
            timeframe: '1d',
            signal: 'NEUTRAL',
            confidence: 0,
            entry: 0,
            current: 0,
            pnl: 0,
            percent: 0,
            status: 'Waiting',
            createdAt: new Date().toISOString(),
          },
        ]

  const getSignalType = (signal: RecentSignal) => {
    return signal.signal ?? signal.type ?? 'NEUTRAL'
  }

  const getSignalClass = (type: string) => {
    if (type === 'BUY') return 'bg-emerald-500/20 text-emerald-400'
    if (type === 'SELL') return 'bg-red-500/20 text-red-400'
    return 'bg-yellow-500/20 text-yellow-400'
  }

  const formatTime = (value?: string) => {
    if (!value) return '—'

    const date = new Date(value)

    if (Number.isNaN(date.getTime())) {
      return value
    }

    return date.toLocaleTimeString()
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <h2 className="mb-4 text-xl font-bold text-white">Recent Signals</h2>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-dark-700 text-left text-gray-400">
              <th className="py-3 pr-4">Time</th>
              <th className="py-3 pr-4">Symbol</th>
              <th className="py-3 pr-4">TF</th>
              <th className="py-3 pr-4">Type</th>
              <th className="py-3 pr-4">Entry</th>
              <th className="py-3 pr-4">Current</th>
              <th className="py-3 pr-4">P&L</th>
              <th className="py-3 pr-4">%</th>
              <th className="py-3 pr-4">Status</th>
            </tr>
          </thead>

          <tbody>
            {displaySignals.map((signal, index) => {
              const type = getSignalType(signal)
              const pnl = Number(signal.pnl ?? 0)
              const percent = Number(signal.percent ?? 0)

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
                    {signal.symbol ?? 'WAITING'}
                  </td>

                  <td className="py-3 pr-4">
                    {signal.timeframe ?? '—'}
                  </td>

                  <td className="py-3 pr-4">
                    <span
                      className={`rounded px-2 py-1 text-xs font-bold ${getSignalClass(
                        type,
                      )}`}
                    >
                      {type}
                    </span>
                  </td>

                  <td className="py-3 pr-4">
                    {signal.entry ?? signal.price ?? '—'}
                  </td>

                  <td className="py-3 pr-4">
                    {signal.current ?? signal.price ?? '—'}
                  </td>

                  <td
                    className={`py-3 pr-4 font-semibold ${
                      pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {pnl > 0 ? '+' : ''}
                    {pnl}
                  </td>

                  <td
                    className={`py-3 pr-4 font-semibold ${
                      percent >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {percent > 0 ? '+' : ''}
                    {percent}%
                  </td>

                  <td className="py-3 pr-4">
                    {signal.status ?? 'Waiting'}
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
