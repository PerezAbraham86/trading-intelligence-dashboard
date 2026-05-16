'use client'

import { motion } from 'framer-motion'

export default function PressureGauges() {
  const gauges = [
    { label: 'Bull Pressure', value: 78, color: 'bg-trading-bull' },
    { label: 'Bear Pressure', value: 22, color: 'bg-trading-bear' },
    { label: 'Ghost Confidence', value: 85, color: 'bg-blue-500' },
    { label: 'Chop Risk', value: 42, color: 'bg-yellow-500' },
    { label: 'Macro Risk', value: 15, color: 'bg-orange-500' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="bg-gradient-to-br from-dark-800 to-dark-900 border border-dark-700 rounded-lg p-6 shadow-2xl"
    >
      <h3 className="text-lg font-bold mb-4">Pressure Gauges</h3>
      <div className="space-y-3">
        {gauges.map((gauge, idx) => (
          <div key={idx}>
            <div className="flex justify-between mb-1">
              <label className="text-xs text-gray-400">{gauge.label}</label>
              <span className="text-xs font-bold text-gray-300">{gauge.value}%</span>
            </div>
            <div className="w-full bg-dark-700 rounded-full h-2 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${gauge.value}%` }}
                transition={{ duration: 0.8, delay: 0.3 + idx * 0.1 }}
                className={`h-full ${gauge.color} rounded-full`}
              />
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
