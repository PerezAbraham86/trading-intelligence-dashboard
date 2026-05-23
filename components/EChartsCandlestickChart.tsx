'use client'

import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts'

type Candle = {
  time: string
  open: number
  close: number
  low: number
  high: number
}

type CandleMode = 'Regular' | 'Heikin Ashi'

const sampleCandles: Candle[] = [
  { time: '5/20 09:00', open: 76450, close: 76680, low: 76380, high: 76750 },
  { time: '5/20 10:00', open: 76680, close: 76520, low: 76420, high: 76720 },
  { time: '5/20 11:00', open: 76520, close: 76810, low: 76490, high: 76890 },
  { time: '5/20 12:00', open: 76810, close: 77020, low: 76720, high: 77100 },
  { time: '5/20 13:00', open: 77020, close: 76910, low: 76840, high: 77140 },
  { time: '5/20 14:00', open: 76910, close: 77280, low: 76860, high: 77340 },
  { time: '5/20 15:00', open: 77280, close: 77150, low: 77090, high: 77410 },
  { time: '5/20 16:00', open: 77150, close: 77520, low: 77080, high: 77610 },
  { time: '5/20 17:00', open: 77520, close: 77840, low: 77480, high: 77930 },
  { time: '5/20 18:00', open: 77840, close: 77660, low: 77580, high: 77910 },
  { time: '5/20 19:00', open: 77660, close: 77420, low: 77360, high: 77740 },
  { time: '5/20 20:00', open: 77420, close: 77180, low: 77090, high: 77500 },
  { time: '5/20 21:00', open: 77180, close: 76900, low: 76820, high: 77240 },
  { time: '5/20 22:00', open: 76900, close: 76640, low: 76550, high: 76980 },
  { time: '5/20 23:00', open: 76640, close: 76280, low: 76120, high: 76710 },
  { time: '5/21 00:00', open: 76280, close: 75940, low: 75840, high: 76320 },
  { time: '5/21 01:00', open: 75940, close: 75680, low: 75590, high: 76020 },
  { time: '5/21 02:00', open: 75680, close: 75420, low: 75380, high: 75760 },
  { time: '5/21 03:00', open: 75420, close: 75880, low: 75350, high: 75960 },
  { time: '5/21 04:00', open: 75880, close: 76240, low: 75810, high: 76380 },
  { time: '5/21 05:00', open: 76240, close: 76060, low: 75940, high: 76310 },
  { time: '5/21 06:00', open: 76060, close: 76580, low: 76020, high: 76690 },
]

const timeframeOptions = ['5m', '15m', '1h', '4h', '1D']
const candleModeOptions: CandleMode[] = ['Regular', 'Heikin Ashi']

function convertToHeikinAshi(candles: Candle[]): Candle[] {
  if (candles.length === 0) return []

  const haCandles: Candle[] = []

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]

    const haClose = (c.open + c.high + c.low + c.close) / 4

    const haOpen =
      i === 0
        ? (c.open + c.close) / 2
        : (haCandles[i - 1].open + haCandles[i - 1].close) / 2

    const haHigh = Math.max(c.high, haOpen, haClose)
    const haLow = Math.min(c.low, haOpen, haClose)

    haCandles.push({
      time: c.time,
      open: Number(haOpen.toFixed(2)),
      close: Number(haClose.toFixed(2)),
      low: Number(haLow.toFixed(2)),
      high: Number(haHigh.toFixed(2)),
    })
  }

  return haCandles
}

export default function EChartsCandlestickChart() {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)

  const [symbol, setSymbol] = useState('SPY')
  const [timeframe, setTimeframe] = useState('5m')
  const [candleMode, setCandleMode] = useState<CandleMode>('Regular')

  useEffect(() => {
    if (!chartRef.current) return

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, 'dark', {
        renderer: 'canvas',
      })
    }

    const activeCandles =
      candleMode === 'Heikin Ashi'
        ? convertToHeikinAshi(sampleCandles)
        : sampleCandles

    const times = activeCandles.map((c) => c.time)

    // ECharts candlestick format: [open, close, low, high]
    const candleData = activeCandles.map((c) => [
      c.open,
      c.close,
      c.low,
      c.high,
    ])

    const option: echarts.EChartsOption = {
      backgroundColor: '#0f1115',
      animation: false,

      grid: {
        left: 10,
        right: 70,
        top: 30,
        bottom: 35,
        containLabel: true,
      },

      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          crossStyle: {
            color: 'rgba(148, 163, 184, 0.55)',
            type: 'dashed',
          },
        },
        backgroundColor: 'rgba(15, 17, 21, 0.95)',
        borderColor: 'rgba(71, 85, 105, 0.8)',
        textStyle: {
          color: '#e5e7eb',
          fontSize: 12,
        },
        formatter: (params: any) => {
          const item = Array.isArray(params) ? params[0] : params

          if (!item || !item.data) return ''

          const data = item.data as number[]
          const open = data[1]
          const close = data[2]
          const low = data[3]
          const high = data[4]

          return `
            <div style="font-size:12px;">
              <div style="margin-bottom:4px;color:#e5e7eb;font-weight:700;">
                ${item.axisValue}
              </div>
              <div style="color:#94a3b8;">${symbol} • ${timeframe} • ${candleMode}</div>
              <div style="margin-top:6px;color:#e5e7eb;">O&nbsp;&nbsp;${open}</div>
              <div style="color:#e5e7eb;">H&nbsp;&nbsp;${high}</div>
              <div style="color:#e5e7eb;">L&nbsp;&nbsp;${low}</div>
              <div style="color:#e5e7eb;">C&nbsp;&nbsp;${close}</div>
            </div>
          `
        },
      },

      xAxis: {
        type: 'category',
        data: times,
        boundaryGap: true,
        axisLine: {
          lineStyle: {
            color: 'rgba(148, 163, 184, 0.25)',
          },
        },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 11,
        },
        splitLine: {
          show: false,
        },
      },

      yAxis: {
        scale: true,
        position: 'right',
        axisLine: {
          show: false,
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 11,
        },
        splitLine: {
          lineStyle: {
            color: 'rgba(148, 163, 184, 0.08)',
          },
        },
      },

      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          start: 0,
          end: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
        },
      ],

      series: [
        {
          name: `${symbol} ${candleMode}`,
          type: 'candlestick',
          data: candleData,
          itemStyle: {
            color: '#26a69a',
            color0: '#ff4d5e',
            borderColor: '#26a69a',
            borderColor0: '#ff4d5e',
          },
          barWidth: '58%',
        },
      ],
    }

    chartInstance.current.setOption(option, true)

    const resize = () => {
      chartInstance.current?.resize()
    }

    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
    }
  }, [symbol, timeframe, candleMode])

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose()
      chartInstance.current = null
    }
  }, [])

  return (
    <div className="flex h-[650px] w-full flex-col overflow-hidden rounded-2xl border border-dark-700 bg-[#0f1115]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dark-700 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-full bg-orange-500 px-2 py-1 text-xs font-bold text-white">
            ₿
          </div>

          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="rounded-md border border-dark-700 bg-[#151922] px-3 py-1.5 text-sm text-gray-100 outline-none"
          >
            <option value="BTCUSD">BTCUSD</option>
            <option value="ETHUSD">ETHUSD</option>
            <option value="SPY">SPY</option>
            <option value="ES1!">ES1!</option>
          </select>

          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="rounded-md border border-dark-700 bg-[#151922] px-3 py-1.5 text-sm text-gray-100 outline-none"
          >
            {timeframeOptions.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>

          <select
            value={candleMode}
            onChange={(e) => setCandleMode(e.target.value as CandleMode)}
            className="rounded-md border border-dark-700 bg-[#151922] px-3 py-1.5 text-sm text-gray-100 outline-none"
          >
            {candleModeOptions.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-full border border-emerald-500/50 px-3 py-1 text-sm text-emerald-400">
          Chart Engine v2
        </div>
      </div>

      <div ref={chartRef} className="h-full w-full flex-1" />
    </div>
  )
}
