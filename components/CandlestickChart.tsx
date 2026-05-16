'use client'

import { useEffect, useRef } from 'react'
import { createChart } from 'lightweight-charts'
import { motion } from 'framer-motion'

export default function CandlestickChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)

  useEffect(() => {
    if (!chartContainerRef.current) return

    // Create chart instance
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#0a0e27' },
        textColor: '#9ca3af',
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
    })

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    })

    // Mock candlestick data
    const candleData = [
      { time: '2026-05-16 09:00', open: 4500, high: 4520, low: 4490, close: 4515 },
      { time: '2026-05-16 09:05', open: 4515, high: 4540, low: 4510, close: 4535 },
      { time: '2026-05-16 09:10', open: 4535, high: 4550, low: 4520, close: 4545 },
      { time: '2026-05-16 09:15', open: 4545, high: 4560, low: 4535, close: 4555 },
      { time: '2026-05-16 09:20', open: 4555, high: 4575, low: 4540, close: 4570 },
    ]

    candlestickSeries.setData(candleData)

    // Add BUY marker on latest real candle using setMarkers (lightweight-charts v4 compatible)
    candlestickSeries.setMarkers([
      {
        time: '2026-05-16 09:20',
        position: 'belowBar' as const,
        color: '#10b981',
        shape: 'arrowUp' as const,
        text: 'BUY',
      },
    ])

    // Add ghost projected candles
    const ghostCandles = [
      { time: '2026-05-16 09:25', open: 4570, high: 4580, low: 4560, close: 4575 },
      { time: '2026-05-16 09:30', open: 4575, high: 4585, low: 4565, close: 4580 },
      { time: '2026-05-16 09:35', open: 4580, high: 4590, low: 4570, close: 4585 },
    ]

    candlestickSeries.setData([...candleData, ...ghostCandles])

    // Fit content to view
    chart.timeScale().fitContent()

    chartRef.current = chart

    // Handle window resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        })
        chart.timeScale().fitContent()
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="bg-gradient-to-br from-dark-800 to-dark-900 border border-dark-700 rounded-lg p-6 shadow-2xl"
    >
      <h3 className="text-lg font-bold mb-4">ES1! - 5m Chart</h3>
      <div
        ref={chartContainerRef}
        className="w-full rounded-lg overflow-hidden"
        style={{ height: '400px' }}
      />
      <p className="text-xs text-gray-500 mt-2">
        Real candles + 3 ghost projected candles • BUY marker visible on latest candle
      </p>
    </motion.div>
  )
}
