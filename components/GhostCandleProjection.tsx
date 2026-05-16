'use client'

import { motion } from 'framer-motion'
import { TrendingUp } from 'lucide-react'

export default function GhostCandleProjection() {
  const ghostCandles = [
    {
      number: 1,
      direction: 'UP',
      open: 4570,
      high: 4580,
      low: 4560,
      close: 4575,
      confidence: 92,
    },
    {
      number: 2,
      direction: 'UP',
      open: 4575,
      high: 4585,
      low: 4565,
      close: 4580,
      confidence: 88,
    },
    {
      number: 3,
      direction: 'UP',
      open: 4580,
      high: 4590,
      low: 4570,
      close: 4585,
      confidence: 85,
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
      className="bg-gradient-to-br from-dark-800 to-dark-900 border border-dark-700 rounded-lg p-6 shadow-2xl"
    >
      <h3 className="text-lg font-bold mb-4">Ghost Candle Projections</h3>
      <div className="space-y-3">
        {ghostCandles.map((candle, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + idx * 0.1 }}
            className="bg-dark-700 rounded-lg p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-400">Ghost #{candle.number}</span>
                <span className="flex items-center gap-1 text-xs font-bold text-trading-bull">
                  <TrendingUp size={14} />
                  {candle.direction}
                </span>
              </div>
              <span className="text-xs bg-trading-bull/20 text-trading-bull px-2 py-1 rounded">
                {candle.confidence}%
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <div>
                <p className="text-gray-500">O</p>
                <p className="font-bold text-gray-200">{candle.open}</p>
              </div>
              <div>
                <p className="text-gray-500">H</p>
                <p className="font-bold text-gray-200">{candle.high}</p>
              </div>
              <div>
                <p className="text-gray-500">L</p>
                <p className="font-bold text-gray-200">{candle.low}</p>
              </div>
              <div>
                <p className="text-gray-500">C</p>
                <p className="font-bold text-gray-200">{candle.close}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}
