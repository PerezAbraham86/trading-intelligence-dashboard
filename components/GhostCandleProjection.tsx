'use client'

import { motion } from 'framer-motion'

type TradingSignal = {
  price?: number
  signal?: string
  confidence?: number
  netBias?: number
  ghost?: string
}

type GhostCandleProjectionProps = {
  signal?: TradingSignal
}

type GhostCandle = {
  label: string
  direction: string
  confidence: number
  open: number
  high: number
  low: number
  close: number
}

function roundPrice(value: number) {
  return Number(value.toFixed(2))
}

export default function GhostCandleProjection({
  signal,
}: GhostCandleProjectionProps) {
  const price = Number(signal?.price ?? 0)
  const confidence = Number(signal?.confidence ?? 0)
  const netBias = Number(signal?.netBias ?? 0)

  const isBearish = signal?.signal === 'SELL' || netBias < 0
  const direction = isBearish ? 'DOWN' : 'UP'
  const step = price > 0 ? Math.max(price * 0.00035, 0.25) : 5

  const base = price > 0 ? price : 4575

  const candles: GhostCandle[] = [1, 2, 3].map((num) => {
    const biasStep = isBearish ? -step * num : step * num
    const open = base + biasStep - (isBearish ? -step : step) * 0.5
    const close = base + biasStep
    const high = Math.max(open, close) + step
    const low = Math.min(open, close) - step

    return {
      label: `Ghost #${num}`,
      direction,
      confidence: Math.max(0, Math.min(100, confidence - (num - 1) * 4)),
      open: roundPrice(open),
      high: roundPrice(high),
      low: roundPrice(low),
      close: roundPrice(close),
    }
  })

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Ghost Candle Projections</h2>
        <span className="text-xs text-gray-500">
          {signal?.ghost ?? 'Waiting'}
        </span>
      </div>

      <div className="space-y-3">
        {candles.map((candle, index) => (
          <motion.div
            key={candle.label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.05 * index }}
            className="rounded-lg bg-dark-700/70 p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-300">
                  {candle.label}
                </span>
                <span
                  className={`text-xs font-bold ${
                    candle.direction === 'UP'
                      ? 'text-emerald-400'
                      : 'text-red-400'
                  }`}
                >
                  ↗ {candle.direction}
                </span>
              </div>

              <span className="rounded bg-emerald-500/20 px-2 py-1 text-xs font-bold text-emerald-400">
                {candle.confidence}%
              </span>
            </div>

            <div className="grid grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-gray-500">O</p>
                <p className="font-bold text-white">{candle.open}</p>
              </div>

              <div>
                <p className="text-gray-500">H</p>
                <p className="font-bold text-white">{candle.high}</p>
              </div>

              <div>
                <p className="text-gray-500">L</p>
                <p className="font-bold text-white">{candle.low}</p>
              </div>

              <div>
                <p className="text-gray-500">C</p>
                <p className="font-bold text-white">{candle.close}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}
