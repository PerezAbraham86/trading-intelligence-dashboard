'use client'

import type { ConnectionStatus } from '@/lib/marketDataConnection'

type ConnectionStatusBadgeProps = {
  status: ConnectionStatus
  lastUpdateTime?: string | Date | null
}

export default function ConnectionStatusBadge({
  status,
  lastUpdateTime,
}: ConnectionStatusBadgeProps) {
  const dotColor =
    ['Connected', 'IBKR connected', 'Live market data'].includes(status)
      ? 'bg-green-400'
      : ['Waiting', 'Waiting for data', 'Market closed', 'Stale market data'].includes(status)
        ? 'bg-yellow-400'
        : 'bg-red-400'

  const textColor =
    ['Connected', 'IBKR connected', 'Live market data'].includes(status)
      ? 'text-green-400'
      : ['Waiting', 'Waiting for data', 'Market closed', 'Stale market data'].includes(status)
        ? 'text-yellow-400'
        : 'text-red-400'

  const formattedTime =
    lastUpdateTime instanceof Date
      ? lastUpdateTime.toLocaleTimeString()
      : typeof lastUpdateTime === 'string'
        ? lastUpdateTime
        : 'No update yet'

  return (
    <div className="flex items-center gap-2 rounded-full border border-dark-700 bg-dark-800/70 px-3 py-1 text-xs">
      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
      <span className={`font-semibold ${textColor}`}>{status}</span>
      <span className="text-gray-500">•</span>
      <span className="text-gray-400">{formattedTime}</span>
    </div>
  )
}
