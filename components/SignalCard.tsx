'use client'

import { motion } from 'framer-motion'
import { ArrowUpRight, ArrowDownLeft, TrendingUp } from 'lucide-react'

export default function SignalCard() {
  const signal = {
    symbol: 'ES1!',
    timeframe: '5m',
    type: 'BUY',
    confidence: 82,
    bullScore: 78,
    bearScore: 22,
    netBias: '+56',
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="bg-gradient-to-br from-dark-800 to-dark-900 border border-dark-700 rounded-lg p-6 shadow-2xl"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold">{signal.symbol}</h2>
          <p className="text-sm text-gray-400">{signal.timeframe} Timeframe</p>
        </div>
        <motion.div
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className={`px-4 py-2 rounded-full font-bold flex items-center gap-2 ${
            signal.type === 'BUY'
              ? 'bg-trading-bull text-white'
              : signal.type === 'SELL'
              ? 'bg-trading-bear text-white'
              : 'bg-trading-neutral text-white'
          }`}
        >
          {signal.type === 'BUY' ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}
          {signal.type}
        </motion.div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-dark-700 rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Confidence</p>
          <p className="text-2xl font-bold text-trading-bull">{signal.confidence}%</p>
        </div>
        <div className="bg-dark-700 rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Bull Score</p>
          <p className="text-2xl font-bold text-trading-bull">{signal.bullScore}%</p>
        </div>
        <div className="bg-dark-700 rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Bear Score</p>
          <p className="text-2xl font-bold text-trading-bear">{signal.bearScore}%</p>
        </div>
        <div className="bg-dark-700 rounded-lg p-4">
          <p className="text-xs text-gray-400 mb-1">Net Bias</p>
          <p className="text-2xl font-bold text-trading-bull flex items-center gap-1">
            <TrendingUp size={18} />
            {signal.netBias}
          </p>
        </div>
      </div>
    </motion.div>
  )
}
