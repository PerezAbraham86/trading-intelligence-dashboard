'use client'

import { motion } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

type TradingSignal = {
  symbol: string
  timeframe: string
  signal: string
  confidence: number
  bullScore: number
  bearScore: number
  netBias: number
  price?: number
}

type SignalCardProps = {
  signal: TradingSignal
}

export default function SignalCard({ signal }: SignalCardProps) {
  const isBuy = signal.signal === 'BUY'
  const isSell = signal.signal === 'SELL'
  const isNeutral = signal.signal === 'NEUTRAL'

  const signalColor = isBuy
    ? 'text-emerald-400'
    : isSell
      ? 'text-red-400'
      : 'text-yellow-400'

  const signalBg = isBuy
    ? 'bg-emerald-500/20 border-emerald-500/40'
    : isSell
      ? 'bg-red-500/20 border-red-500/40'
      : 'bg-yellow-500/20 border-yellow-500/40'

  const Icon = isBuy ? ArrowUpRight : isSell ? ArrowDownRight : Minus

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">{signal.symbol}</h2>
          <p className="text-sm text-gray-400">{signal.timeframe} Timeframe</p>
          {typeof signal.price === 'number' && signal.price > 0 ? (
            <p className="mt-1 text-xs text-gray-500">Price: {signal.price}</p>
          ) : null}
        </div>

        <div
          className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold ${signalBg} ${signalColor}`}
        >
          <Icon size={16} />
          {signal.signal}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg bg-dark-700/70 p-4">
          <p className="mb-2 text-xs text-gray-400">Confidence</p>
          <p className="text-2xl font-bold text-emerald-400">
            {signal.confidence}%
          </p>
        </div>

        <div className="rounded-lg bg-dark-700/70 p-4">
          <p className="mb-2 text-xs text-gray-400">Bull Score</p>
          <p className="text-2xl font-bold text-emerald-400">
            {signal.bullScore}%
          </p>
        </div>

        <div className="rounded-lg bg-dark-700/70 p-4">
          <p className="mb-2 text-xs text-gray-400">Bear Score</p>
          <p className="text-2xl font-bold text-red-400">
            {signal.bearScore}%
          </p>
        </div>

        <div className="rounded-lg bg-dark-700/70 p-4">
          <p className="mb-2 text-xs text-gray-400">Net Bias</p>
          <p
            className={`text-2xl font-bold ${
              signal.netBias >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {signal.netBias >= 0 ? '+' : ''}
            {signal.netBias}
          </p>
        </div>
      </div>
    </motion.div>
  )
}
