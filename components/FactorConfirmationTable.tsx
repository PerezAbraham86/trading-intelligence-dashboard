'use client'

import { motion } from 'framer-motion'
import { CheckCircle, AlertCircle } from 'lucide-react'

export default function FactorConfirmationTable() {
  const factors = [
    { name: 'SMC Structure', status: true, strength: 95 },
    { name: 'AlphaX DLM', status: true, strength: 88 },
    { name: 'Ghost Candles', status: true, strength: 92 },
    { name: 'Open Interest', status: false, strength: 45 },
    { name: 'Footprint Delta', status: true, strength: 78 },
    { name: 'Session', status: true, strength: 85 },
    { name: 'FRED Macro', status: false, strength: 52 },
    { name: 'FINRA Short Volume', status: true, strength: 71 },
    { name: 'COT', status: true, strength: 81 },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="bg-gradient-to-br from-dark-800 to-dark-900 border border-dark-700 rounded-lg p-6 shadow-2xl"
    >
      <h3 className="text-lg font-bold mb-4">Factor Confirmation</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-700">
              <th className="text-left py-2 text-gray-400 font-medium">Factor</th>
              <th className="text-center py-2 text-gray-400 font-medium">Status</th>
              <th className="text-right py-2 text-gray-400 font-medium">Strength</th>
            </tr>
          </thead>
          <tbody>
            {factors.map((factor, idx) => (
              <motion.tr
                key={idx}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 + idx * 0.05 }}
                className="border-b border-dark-700/50 hover:bg-dark-700/30 transition-colors"
              >
                <td className="py-3 text-gray-300">{factor.name}</td>
                <td className="py-3 text-center">
                  {factor.status ? (
                    <CheckCircle className="w-4 h-4 text-trading-bull inline" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-trading-bear inline" />
                  )}
                </td>
                <td className="py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-12 bg-dark-700 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-trading-bull"
                        style={{ width: `${factor.strength}%` }}
                      />
                    </div>
                    <span className="w-8 text-right font-bold text-gray-300">{factor.strength}%</span>
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}
