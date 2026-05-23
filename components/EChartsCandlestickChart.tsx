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

type StructureDirection = 'bullish' | 'bearish'
type StructureScope = 'internal' | 'swing'
type StructureTag = 'BOS' | 'CHoCH' | 'HH' | 'HL' | 'LH' | 'LL'

type SmcStructureEvent = {
  time: string
  fromTime?: string
  price: number
  tag: StructureTag
  direction: StructureDirection
  scope: StructureScope
}

type DlmLevel = {
  label: string
  price: number
  direction: 'neutral' | 'bullish' | 'bearish'
}

type EChartsCandlestickChartProps = {
  heightClass?: string
  compact?: boolean
  chartTitle?: string
}

const GREEN = '#089981'
const RED = '#F23645'
const BLUE = '#2157f3'
const GRAY = '#878b94'
const TEAL = '#26a69a'
const LIGHT_RED = '#ff4d5e'

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

const sampleSmcEvents: SmcStructureEvent[] = [
  {
    time: '5/20 13:00',
    fromTime: '5/20 11:00',
    price: 77100,
    tag: 'iBOS' as StructureTag,
    direction: 'bullish',
    scope: 'internal',
  },
  {
    time: '5/20 17:00',
    fromTime: '5/20 14:00',
    price: 77930,
    tag: 'BOS',
    direction: 'bullish',
    scope: 'swing',
  },
  {
    time: '5/20 21:00',
    fromTime: '5/20 18:00',
    price: 77090,
    tag: 'iCHoCH' as StructureTag,
    direction: 'bearish',
    scope: 'internal',
  },
  {
    time: '5/20 23:00',
    fromTime: '5/20 20:00',
    price: 76120,
    tag: 'CHoCH',
    direction: 'bearish',
    scope: 'swing',
  },
  {
    time: '5/21 03:00',
    price: 75350,
    tag: 'LL',
    direction: 'bearish',
    scope: 'swing',
  },
  {
    time: '5/21 06:00',
    price: 76690,
    tag: 'LH',
    direction: 'bearish',
    scope: 'swing',
  },
]

const sampleDlmLevels: DlmLevel[] = [
  { label: 'AlphaX POC', price: 76580, direction: 'neutral' },
  { label: 'DLM Buy Liquidity', price: 75840, direction: 'bullish' },
  { label: 'DLM Sell Liquidity', price: 77840, direction: 'bearish' },
]

const timeframeOptions = ['1m', '5m', '15m', '1h', '4h', '1D']
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

function getStructureColor(direction: StructureDirection) {
  return direction === 'bullish' ? GREEN : RED
}

function getDlmColor(direction: DlmLevel['direction']) {
  if (direction === 'bullish') return GREEN
  if (direction === 'bearish') return RED
  return BLUE
}

function buildSmcMarkLines(events: SmcStructureEvent[]) {
  return events
    .filter((event) => event.fromTime)
    .map((event) => {
      const color = getStructureColor(event.direction)

      return [
        {
          coord: [event.fromTime, event.price],
          lineStyle: {
            color,
            width: event.scope === 'swing' ? 2 : 1,
            type: event.scope === 'swing' ? 'solid' : 'dashed',
          },
          symbol: 'none',
        },
        {
          coord: [event.time, event.price],
          symbol: 'none',
          label: {
            show: true,
            formatter: event.tag,
            color,
            fontSize: event.scope === 'swing' ? 11 : 10,
            fontWeight: 700,
            backgroundColor: 'rgba(15, 17, 21, 0.88)',
            borderColor: color,
            borderWidth: 1,
            borderRadius: 4,
            padding: [3, 6],
          },
        },
      ]
    })
}

function buildSmcMarkPoints(events: SmcStructureEvent[], compact: boolean) {
  return events.map((event) => {
    const color = getStructureColor(event.direction)
    const isTopLabel =
      event.direction === 'bearish' ||
      event.tag === 'HH' ||
      event.tag === 'LH' ||
      event.tag === 'CHoCH'

    return {
      name: event.tag,
      coord: [event.time, event.price],
      value: event.tag,
      symbol: isTopLabel ? 'pin' : 'pin',
      symbolSize: compact ? 28 : 38,
      symbolRotate: isTopLabel ? 0 : 180,
      itemStyle: {
        color: 'rgba(15, 17, 21, 0.95)',
        borderColor: color,
        borderWidth: 1,
      },
      label: {
        show: true,
        formatter: event.tag,
        color,
        fontSize: compact ? 8 : 10,
        fontWeight: 700,
      },
    }
  })
}

function buildDlmMarkLines(levels: DlmLevel[], compact: boolean) {
  return levels.map((level) => {
    const color = getDlmColor(level.direction)

    return {
      yAxis: level.price,
      name: level.label,
      symbol: 'none',
      lineStyle: {
        color,
        width: level.direction === 'neutral' ? 2 : 1,
        type: level.direction === 'neutral' ? 'solid' : 'dashed',
        opacity: level.direction === 'neutral' ? 0.8 : 0.55,
      },
      label: {
        show: !compact,
        formatter: level.label,
        color,
        fontSize: 10,
        fontWeight: 700,
        position: 'end',
        backgroundColor: 'rgba(15, 17, 21, 0.88)',
        borderColor: color,
        borderWidth: 1,
        borderRadius: 4,
        padding: [3, 6],
      },
    }
  })
}

export default function EChartsCandlestickChart({
  heightClass = 'h-[650px]',
  compact = false,
  chartTitle,
}: EChartsCandlestickChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)

  const [symbol, setSymbol] = useState('SPY')
  const [timeframe, setTimeframe] = useState('1m')
  const [candleMode, setCandleMode] = useState<CandleMode>('Heikin Ashi')
  const [showSmc, setShowSmc] = useState(true)
  const [showDlm, setShowDlm] = useState(true)

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
        left: compact ? 4 : 10,
        right: compact ? 48 : 86,
        top: compact ? 12 : 30,
        bottom: compact ? 20 : 35,
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
          fontSize: compact ? 8 : 11,
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
          fontSize: compact ? 8 : 11,
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
            color: TEAL,
            color0: LIGHT_RED,
            borderColor: TEAL,
            borderColor0: LIGHT_RED,
          },
          barWidth: compact ? '48%' : '58%',
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              ...(showSmc ? buildSmcMarkLines(sampleSmcEvents) : []),
              ...(showDlm ? buildDlmMarkLines(sampleDlmLevels, compact) : []),
            ],
          },
          markPoint: {
            silent: true,
            data: showSmc ? buildSmcMarkPoints(sampleSmcEvents, compact) : [],
          },
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
  }, [symbol, timeframe, candleMode, compact, showSmc, showDlm])

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose()
      chartInstance.current = null
    }
  }, [])

  return (
    <div
      className={`flex ${heightClass} w-full flex-col overflow-hidden rounded-2xl border border-dark-700 bg-[#0f1115]`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dark-700 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-full bg-orange-500 px-2 py-1 text-xs font-bold text-white">
            ₿
          </div>

          {chartTitle && (
            <span className="text-xs font-semibold text-gray-300">
              {chartTitle}
            </span>
          )}

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

          {!compact && (
            <>
              <button
                type="button"
                onClick={() => setShowSmc((value) => !value)}
                className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                  showSmc
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                    : 'border-dark-700 bg-[#151922] text-gray-400'
                }`}
              >
                SMC
              </button>

              <button
                type="button"
                onClick={() => setShowDlm((value) => !value)}
                className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                  showDlm
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-300'
                    : 'border-dark-700 bg-[#151922] text-gray-400'
                }`}
              >
                AlphaX DLM
              </button>
            </>
          )}
        </div>

        {!compact && (
          <div className="rounded-full border border-emerald-500/50 px-3 py-1 text-sm text-emerald-400">
            Chart Engine v3A
          </div>
        )}
      </div>

      <div ref={chartRef} className="h-full w-full flex-1" />
    </div>
  )
}
