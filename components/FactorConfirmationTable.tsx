'use client'

import { motion } from 'framer-motion'
import { CheckCircle2, XCircle } from 'lucide-react'

type TradingSignal = {
  smc?: string
  alphax?: string
  ghost?: string
  openInterest?: string
  footprint?: string
  session?: string
  fredMacro?: string
  finraShortVolume?: string
  cot?: string
  confidence?: number
  bullScore?: number
  bearScore?: number
}

type FactorConfirmationTableProps = {
  signal?: TradingSignal
}

type FactorRow = {
  factor: string
  status: boolean
  strength: number
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value))
}

function isPositive(value?: string) {
  if (!value) return false

  const lower = value.toLowerCase()

  if (
    lower.includes('waiting') ||
    lower.includes('neutral') ||
    lower.includes('none') ||
    lower.includes('no signal')
  ) {
    return false
  }

  return true
}

export default function FactorConfirmationTable({
  signal,
}: FactorConfirmationTableProps) {
  const confidence = clamp(Number(signal?.confidence ?? 0))
  const bullScore = clamp(Number(signal?.bullScore ?? 50))
  const bearScore = clamp(Number(signal?.bearScore ?? 50))

  const rows: FactorRow[] = [
    {
      factor: 'SMC Structure',
      status: isPositive(signal?.smc),
      strength: isPositive(signal?.smc) ? Math.max(confidence, bullScore) : 0,
    },
    {
      factor: 'AlphaX DLM',
      status: isPositive(signal?.alphax),
      strength: isPositive(signal?.alphax) ? bullScore : 0,
    },
    {
      factor: 'Ghost Candles',
      status: isPositive(signal?.ghost),
      strength: isPositive(signal?.ghost) ? confidence : 0,
    },
    {
      factor: 'Open Interest',
      status: isPositive(signal?.openInterest),
      strength: isPositive(signal?.openInterest) ? 65 : 0,
    },
    {
      factor: 'Footprint Delta',
      status: isPositive(signal?.footprint),
      strength: isPositive(signal?.footprint) ? bullScore : 0,
    },
    {
      factor: 'Session',
      status: isPositive(signal?.session),
      strength: isPositive(signal?.session) ? 85 : 0,
    },
    {
      factor: 'FRED Macro',
      status: isPositive(signal?.fredMacro),
      strength: isPositive(signal?.fredMacro) ? 52 : 0,
    },
    {
      factor: 'FINRA Short Volume',
      status: isPositive(signal?.finraShortVolume),
      strength: isPositive(signal?.finraShortVolume) ? 71 : 0,
    },
    {
      factor: 'COT',
      status: isPositive(signal?.cot),
      strength: isPositive(signal?.cot) ? 81 : 0,
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <h2 className="mb-4 text-xl font-bold text-white">Factor Confirmation</h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-700 text-left text-gray-400">
              <th className="py-3 pr-4">Factor</th>
              <th className="py-3 pr-4 text-center">Status</th>
              <th className="py-3 pr-4 text-right">Strength</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, index) => (
              <motion.tr
                key={row.factor}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.04 * index }}
                className="border-b border-dark-700/70 text-gray-300"
              >
                <td className="py-3 pr-4">{row.factor}</td>

                <td className="py-3 pr-4">
                  <div className="flex justify-center">
                    {row.status ? (
                      <CheckCircle2 size={16} className="text-emerald-400" />
                    ) : (
                      <XCircle size={16} className="text-red-400" />
                    )}
                  </div>
                </td>

                <td className="py-3 pr-4">
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-dark-700">
                      <div
                        className={`h-full rounded-full ${
                          row.status ? 'bg-emerald-400' : 'bg-red-400'
                        }`}
                        style={{ width: `${row.strength}%` }}
                      />
                    </div>
                    <span className="w-10 text-right font-bold text-white">
                      {row.strength}%
                    </span>
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-gray-500">
        Bull/Bear balance: {bullScore}% / {bearScore}%
      </div>
    </motion.div>
  )
}
