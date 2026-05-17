'use client'

import { useEffect, useRef } from 'react'
import {
  createChart,
  ColorType,
  CandlestickData,
  IChartApi,
  ISeriesApi,
} from 'lightweight-charts'

type Candle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
  symbol?: string
  timeframe?: string
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://trading-intelligence-dashboard.onrender.com'

export default function CandlestickChart() {
  const chartContainerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      height: 360,
      layout: {
        background: {
          type: ColorType.Solid,
          color: '#111827',
        },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: {
          color: '#1f2937',
        },
        horzLines: {
          color: '#1f2937',
        },
      },
      rightPriceScale: {
        borderColor: '#374151',
      },
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries

    const handleResize = () => {
      if (!chartContainerRef.current || !chartRef.current) return

      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
      })
    }

    handleResize()

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [])

  useEffect(() => {
    const fetchCandles = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/recent-candles`, {
          cache: 'no-store',
        })

        if (!response.ok) return

        const candles: Candle[] = await response.json()

        const formattedCandles: CandlestickData[] = candles
          .filter(
            (candle) =>
              candle.time &&
              candle.open !== undefined &&
              candle.high !== undefined &&
              candle.low !== undefined &&
              candle.close !== undefined,
          )
          .map((candle) => ({
            time: candle.time as CandlestickData['time'],
            open: Number(candle.open),
            high: Number(candle.high),
            low: Number(candle.low),
            close: Number(candle.close),
          }))

        if (formattedCandles.length > 0 && candleSeriesRef.current) {
          candleSeriesRef.current.setData(formattedCandles)
          chartRef.current?.timeScale().fitContent()
        }
      } catch (error) {
        console.error('Failed to fetch candles:', error)
      }
    }

    fetchCandles()

    const interval = window.setInterval(fetchCandles, 3000)

    return () => {
      window.clearInterval(interval)
    }
  }, [])

  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800/70 p-6 shadow-lg">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Live Candlestick Chart</h2>
          <p className="text-xs text-gray-400">
            Built from TradingView webhook candle updates
          </p>
        </div>
      </div>

      <div ref={chartContainerRef} className="h-[360px] w-full" />
    </div>
  )
}
