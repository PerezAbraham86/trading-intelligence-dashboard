'use client'

import { motion } from 'framer-motion'

type TradingSignal = {
  confidence?: number
  bullScore?: number
  bearScore?: number
  netBias?: number
  signal?: string
  chopRisk?: number
  macroRisk?: number
}

type PressureGaugesProps = {
  signal?: TradingSignal
}

type GaugeItem = {
  label: string
  value: number
  barClass: string
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value))
}

export default function PressureGauges({ signal }: PressureGaugesProps) {
  const bullPressure = clamp(Number(signal?.bullScore ?? 50))
  const bearPressure = clamp(Number(signal?.bearScore ?? 50))
  const ghostConfidence = clamp(Number(signal?.confidence ?? 0))

  const netBias = Number(signal?.netBias ?? 0)
  const chopRisk = clamp(Number(signal?.chopRisk ?? Math.max(0, 50 - Math.abs(netBias))))
  const macroRisk = clamp(Number(signal?.macroRisk ?? 15))

  const gauges: GaugeItem[] = [
    {
      label: 'Bull Pressure',
      value: bullPressure,
      barClass: 'bg-emerald-400',
    },
    {
      label: 'Bear Pressure',
      value: bearPressure,
      barClass: 'bg-red-400',
    },
    {
      label: 'Ghost Confidence',
      value: ghostConfidence,
      barClass: 'bg-blue-400',
    },
    {
      label: 'Chop Risk',
      value: chopRisk,
      barClass: 'bg-yellow-400',
    },
    {
      label: 'Macro Risk',
      value: macroRisk,
      barClass: 'bg-orange-400',
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <h2 className="mb-5 text-xl font-bold text-white">Pressure Gauges</h2>

      <div className="space-y-4">
        {gauges.map((gauge) => (
          <div key={gauge.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-gray-300">{gauge.label}</span>
              <span className="font-bold text-white">{gauge.value}%</span>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-dark-700">
              <div
                className={`h-full rounded-full ${gauge.barClass}`}
                style={{ width: `${gauge.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
