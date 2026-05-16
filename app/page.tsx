'use client'

import { useState } from 'react'
import SignalCard from '@/components/SignalCard'
import CandlestickChart from '@/components/CandlestickChart'
import PressureGauges from '@/components/PressureGauges'
import FactorConfirmationTable from '@/components/FactorConfirmationTable'
import GhostCandleProjection from '@/components/GhostCandleProjection'
import WarningsPanel from '@/components/WarningsPanel'
import RecentSignalsTable from '@/components/RecentSignalsTable'
import { motion } from 'framer-motion'

export default function Dashboard() {
  const [isLoading] = useState(false)

  // Later FastAPI connection:
  // const res = await fetch("https://YOUR-FASTAPI-URL.com/api/latest-signal");
  // const json = await res.json();
  // setData(json);

  return (
    <div className="min-h-screen bg-gradient-to-b from-dark-900 via-dark-800 to-dark-900 p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-8"
      >
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-4xl font-bold gradient-text">
            TRADING DASHBOARD PAGE LOADED
          </h1>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-trading-bull rounded-full animate-pulse-custom"></div>
            <span className="text-sm text-gray-400">Live</span>
          </div>
        </div>
        <p className="text-gray-400 text-sm">Real-time trading signals and analysis • ES1! • 5-minute timeframe</p>
      </motion.div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Signal Card */}
          <SignalCard />

          {/* Chart */}
          <CandlestickChart />
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Pressure Gauges */}
          <PressureGauges />

          {/* Warnings Panel */}
          <WarningsPanel />
        </div>
      </div>

      {/* Second Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Factors Table */}
        <FactorConfirmationTable />

        {/* Ghost Candle Projections */}
        <GhostCandleProjection />
      </div>

      {/* Recent Signals */}
      <RecentSignalsTable />

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.6 }}
        className="mt-8 text-center text-xs text-gray-500 border-t border-dark-700 pt-4"
      >
        <p>Trading Intelligence Dashboard • Mock Data Mode • Ready for FastAPI Backend Integration</p>
      </motion.div>
    </div>
  )
}
