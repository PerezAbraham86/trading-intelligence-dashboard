'use client'

import { motion } from 'framer-motion'
import { AlertTriangle, Info } from 'lucide-react'

type TradingSignal = {
  signal?: string
  confidence?: number
  bullScore?: number
  bearScore?: number
  netBias?: number
  warnings?: string[]
  session?: string
  fredMacro?: string
}

type WarningsPanelProps = {
  signal?: TradingSignal
}

type WarningItem = {
  title: string
  subtitle: string
  severity: 'danger' | 'warning' | 'info'
}

function getSeverityClass(severity: WarningItem['severity']) {
  if (severity === 'danger') {
    return 'border-red-500/50 bg-red-500/15 text-red-300'
  }

  if (severity === 'warning') {
    return 'border-yellow-500/50 bg-yellow-500/15 text-yellow-300'
  }

  return 'border-blue-500/50 bg-blue-500/15 text-blue-300'
}

export default function WarningsPanel({ signal }: WarningsPanelProps) {
  const confidence = Number(signal?.confidence ?? 0)
  const netBias = Number(signal?.netBias ?? 0)
  const customWarnings = Array.isArray(signal?.warnings) ? signal?.warnings : []

  const warnings: WarningItem[] = []

  if (customWarnings.length > 0) {
    customWarnings.forEach((warning) => {
      warnings.push({
        title: warning,
        subtitle: 'Received from TradingView alert',
        severity: 'warning',
      })
    })
  }

  if (confidence > 0 && confidence < 50) {
    warnings.push({
      title: 'Low Confidence Signal',
      subtitle: `Current confidence is ${confidence}%`,
      severity: 'warning',
    })
  }

  if (Math.abs(netBias) <= 10) {
    warnings.push({
      title: 'Weak Net Bias',
      subtitle: `Net bias is only ${netBias}`,
      severity: 'info',
    })
  }

  if (!signal?.fredMacro || signal.fredMacro.toLowerCase().includes('neutral')) {
    warnings.push({
      title: 'Macro Neutral',
      subtitle: 'No strong macro confirmation received',
      severity: 'info',
    })
  }

  if (warnings.length === 0) {
    warnings.push({
      title: 'No Active Warnings',
      subtitle: 'Latest alert has no warning flags',
      severity: 'info',
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg"
    >
      <h2 className="mb-5 text-xl font-bold text-white">Warnings & Alerts</h2>

      <div className="space-y-3">
        {warnings.map((warning, index) => {
          const Icon = warning.severity === 'danger' ? AlertTriangle : Info

          return (
            <motion.div
              key={`${warning.title}-${index}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.04 * index }}
              className={`rounded-lg border p-4 ${getSeverityClass(
                warning.severity,
              )}`}
            >
              <div className="flex items-start gap-3">
                <Icon size={15} className="mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-bold">{warning.title}</p>
                  <p className="text-xs opacity-80">{warning.subtitle}</p>
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}
