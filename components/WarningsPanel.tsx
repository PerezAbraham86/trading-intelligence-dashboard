'use client'

import { motion } from 'framer-motion'
import { AlertTriangle, AlertCircle } from 'lucide-react'

export default function WarningsPanel() {
  const warnings = [
    { type: 'alert', title: 'FOMC Meeting', message: 'Fed decision in 2 hours', severity: 'high' },
    { type: 'alert', title: 'Chop Zone', message: 'Volatility ranging 42%', severity: 'medium' },
    { type: 'caution', title: 'Macro Risk', message: 'Mixed signals from macro', severity: 'low' },
    { type: 'caution', title: 'Gap Risk', message: 'Previous session gap at 4485', severity: 'medium' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="bg-gradient-to-br from-dark-800 to-dark-900 border border-dark-700 rounded-lg p-6 shadow-2xl"
    >
      <h3 className="text-lg font-bold mb-4">Warnings & Alerts</h3>
      <div className="space-y-2">
        {warnings.map((warning, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + idx * 0.1 }}
            className={`p-3 rounded-lg border flex items-start gap-3 ${
              warning.severity === 'high'
                ? 'bg-trading-bear/10 border-trading-bear/30'
                : warning.severity === 'medium'
                ? 'bg-yellow-500/10 border-yellow-500/30'
                : 'bg-blue-500/10 border-blue-500/30'
            }`}
          >
            {warning.severity === 'high' ? (
              <AlertTriangle size={16} className="text-trading-bear mt-1 flex-shrink-0" />
            ) : (
              <AlertCircle size={16} className="text-yellow-500 mt-1 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-gray-200">{warning.title}</p>
              <p className="text-xs text-gray-400 truncate">{warning.message}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}
