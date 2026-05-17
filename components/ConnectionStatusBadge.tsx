'use client'

type ConnectionStatusBadgeProps = {
  status: 'Connected' | 'Waiting' | 'Error'
  lastUpdateTime?: string | Date | null
}

export default function ConnectionStatusBadge({
  status,
  lastUpdateTime,
}: ConnectionStatusBadgeProps) {
  const dotColor =
    status === 'Connected'
      ? 'bg-green-400'
      : status === 'Waiting'
        ? 'bg-yellow-400'
        : 'bg-red-400'

  const textColor =
    status === 'Connected'
      ? 'text-green-400'
      : status === 'Waiting'
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
