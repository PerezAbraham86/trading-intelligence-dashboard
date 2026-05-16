'use client'

import { motion } from 'framer-motion'
import { ArrowUpRight, ArrowDownLeft, CheckCircle, XCircle } from 'lucide-react'

export default function RecentSignalsTable() {
  const signals = [
    { id: 1, symbol: 'ES1!', type: 'BUY', entry: 4570, current: 4585, pnl: 15, pnlPct: 0.33, status: 'open' },
    { id: 2, symbol: 'ES1!', type: 'SELL', entry: 4555, current: 4570, pnl: -15, pnlPct: -0.33, status: 'open' },
    { id: 3, symbol: 'ES1!', type: 'BUY', entry: 4540, current: 4550, pnl: 10, pnlPct: 0.22, status: 'closed' },
    { id: 4, symbol: 'ES1!', type: 'BUY', entry: 4520, current: 4535, pnl: 15, pnlPct: 0.36, status: 'closed' },
    { id: 5, symbol: 'ES1!', type: 'SELL', entry: 4510, current: 4500, pnl: 10, pnlPct: 0.22, status: 'closed' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5 }}
      className="bg-gradient-to-br from-dark-800 to-dark-900 border border-dark-700 rounded-lg p-6 shadow-2xl"
    >
      <h3 className="text-lg font-bold mb-4">Recent Signals</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-700">
              <th className="text-left py-2 text-gray-400 font-medium">Symbol</th>
              <th className="text-center py-2 text-gray-400 font-medium">Type</th>
              <th className="text-right py-2 text-gray-400 font-medium">Entry</th>
              <th className="text-right py-2 text-gray-400 font-medium">Current</th>
              <th className="text-right py-2 text-gray-400 font-medium">P&L</th>
              <th className="text-right py-2 text-gray-400 font-medium">%</th>
              <th className="text-center py-2 text-gray-400 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((signal, idx) => (
              <motion.tr
                key={signal.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 + idx * 0.05 }}
                className="border-b border-dark-700/50 hover:bg-dark-700/30 transition-colors"
              >
                <td className="py-3 text-gray-300 font-medium">{signal.symbol}</td>
                <td className="py-3 text-center">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${
                    signal.type === 'BUY'
                      ? 'bg-trading-bull/20 text-trading-bull'
                      : 'bg-trading-bear/20 text-trading-bear'
                  }`}>
                    {signal.type === 'BUY' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                    {signal.type}
                  </span>
                </td>
                <td className="py-3 text-right text-gray-300">{signal.entry}</td>
                <td className="py-3 text-right text-gray-300">{signal.current}</td>
                <td className={`py-3 text-right font-bold ${
                  signal.pnl >= 0 ? 'text-trading-bull' : 'text-trading-bear'
                }`}>
                  {signal.pnl >= 0 ? '+' : ''}{signal.pnl}
                </td>
                <td className={`py-3 text-right font-bold ${
                  signal.pnlPct >= 0 ? 'text-trading-bull' : 'text-trading-bear'
                }`}>
                  {signal.pnlPct >= 0 ? '+' : ''}{signal.pnlPct.toFixed(2)}%
                </td>
                <td className="py-3 text-center">
                  {signal.status === 'open' ? (
                    <motion.div
                      animate={{ opacity: [1, 0.5, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="inline-flex items-center gap-1 text-trading-bull"
                    >
                      <div className="w-2 h-2 bg-trading-bull rounded-full" />
                      <span className="text-xs font-bold">Open</span>
                    </motion.div>
                  ) : (
                    <div className="inline-flex items-center gap-1 text-gray-400">
                      <CheckCircle size={14} />
                      <span className="text-xs font-bold">Closed</span>
                    </div>
                  )}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
