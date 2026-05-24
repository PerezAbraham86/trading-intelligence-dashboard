'use client'

import { useState, useEffect } from 'react'
import SignalCard from '@/components/SignalCard'
import EChartsCandlestickChart from '@/components/EChartsCandlestickChart'
import PressureGauges from '@/components/PressureGauges'
import FactorConfirmationTable from '@/components/FactorConfirmationTable'
import GhostCandleProjection from '@/components/GhostCandleProjection'
import WarningsPanel from '@/components/WarningsPanel'
import RecentSignalsTable from '@/components/RecentSignalsTable'
import ConnectionStatusBadge from '@/components/ConnectionStatusBadge'
import MarketSentimentGauge from '@/components/MarketSentimentGauge'
import { motion } from 'framer-motion'
import { useApiPolling } from '@/hooks/useApiPolling'

export default function Dashboard() {
  const [isClient, setIsClient] = useState(false)

  const {
    latestSignal,
    recentSignals,
    recentCandles,
    connectionStatus,
    lastUpdateTime,
    apiBaseUrl,
  } = useApiPolling()

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) {
    return null
  }

  const maxSignalsToShow = 25
  const visibleRecentSignals = recentSignals.slice(0, maxSignalsToShow)

  return (
    <div className="min-h-screen bg-gradient-to-b from-dark-900 via-dark-800 to-dark-900 p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-8"
      >
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-4xl font-bold gradient-text">
            TRADING DASHBOARD TEST 3K
          </h1>

          <ConnectionStatusBadge
            status={connectionStatus}
            lastUpdateTime={lastUpdateTime}
          />
        </div>

        <p className="text-sm text-gray-400">
          Real-time trading signals and analysis • {latestSignal.symbol} •{' '}
          {latestSignal.timeframe} timeframe
        </p>
      </motion.div>

      {/* Main Grid */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column */}
        <div className="space-y-6 lg:col-span-2">
          <SignalCard signal={latestSignal} />

          <EChartsCandlestickChart
            enableAdvancedOverlays
            latestSignal={latestSignal}
            recentSignals={recentSignals}
            recentCandles={recentCandles}
          />

          {/* Two Smaller Charts */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <EChartsCandlestickChart
              heightClass="h-[230px]"
              compact
              chartTitle="Mini Chart 1"
              enableAdvancedOverlays={false}
              latestSignal={latestSignal}
              recentSignals={recentSignals}
              recentCandles={recentCandles}
            />

            <EChartsCandlestickChart
              heightClass="h-[230px]"
              compact
              chartTitle="Mini Chart 2"
              enableAdvancedOverlays={false}
              latestSignal={latestSignal}
              recentSignals={recentSignals}
              recentCandles={recentCandles}
            />
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          <MarketSentimentGauge />

          <PressureGauges signal={latestSignal} />

          <WarningsPanel signal={latestSignal} />
        </div>
      </div>

      {/* Second Row */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FactorConfirmationTable signal={latestSignal} />

        <GhostCandleProjection signal={latestSignal} />
      </div>

      <RecentSignalsTable signals={visibleRecentSignals} />

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.6 }}
        className="mt-8 border-t border-dark-700 pt-4 text-center text-xs text-gray-500"
      >
        <p>
          Trading Intelligence Dashboard • Live API Polling Mode • Connected to{' '}
          {apiBaseUrl}
        </p>
      </motion.div>
    </div>
  )
}
