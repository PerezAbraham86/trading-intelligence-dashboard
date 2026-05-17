'use client'

import { motion } from 'framer-motion'
import { Wifi, WifiOff, Clock } from 'lucide-react'
import { ConnectionStatus } from '@/hooks/useApiPolling'

interface ConnectionStatusBadgeProps {
  status: ConnectionStatus
  lastUpdateTime: Date
}

export default function ConnectionStatusBadge({ status, lastUpdateTime }: ConnectionStatusBadgeProps) {
  const getStatusColor = () => {
    switch (status) {
      case 'connected':
        return 'bg-trading-bull/20 text-trading-bull border-trading-bull/30'
      case 'error':
        return 'bg-trading-bear/20 text-trading-bear border-trading-bear/30'
      default:
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    }
  }

  const getStatusIcon = () => {
    switch (status) {
      case 'connected':
        return <Wifi size={16} />
      case 'error':
        return <WifiOff size={16} />
      default:
        return <Clock size={16} />
    }
  }

  const getStatusText = () => {
    switch (status) {
      case 'connected':
        return 'Connected'
      case 'error':
        return 'Error'
      default:
        return 'Waiting'
    }
  }

  const timeAgo = () => {
    const now = new Date()
    const diff = Math.floor((now.getTime() - lastUpdateTime.getTime()) / 1000)
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    return lastUpdateTime.toLocaleTimeString()
  }

  return (
    <div className="flex items-center gap-4">
      <motion.div
        animate={{
          scale: status === 'connected' ? [1, 1.05, 1] : 1,
        }}
        transition={{ duration: 2, repeat: Infinity }}
        className={`flex items-center gap-2 px-3 py-2 rounded-full border text-xs font-semibold ${getStatusColor()}`}
      >
        {getStatusIcon()}
        <span>{getStatusText()}</span>
      </motion.div>
      <div className="text-xs text-gray-400">
        Updated: {timeAgo()}
      </div>
    </div>
  )
}
