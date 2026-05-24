FILE TO EDIT:
components/EChartsCandlestickChart.tsx

FIX:
AlphaX DLM profile bars are currently being plotted on top of the candles because the
frontend is drawing the profile bars inside the candle time range.

This fix does two things:
1. Reserves empty space to the right of the last candle.
2. Draws AlphaX profile bars inside that reserved right-side space.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — FIND YOUR CHART CONSTANTS / OPTION BUILD AREA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add these constants near the top of the ECharts option builder, after you already have
your final candle array / chart candle data available.

NEW BLOCK:
const ALPHAX_PROFILE_RIGHT_SPACE = 72
const ALPHAX_PROFILE_START_OFFSET = 10
const ALPHAX_PROFILE_MAX_WIDTH = 52

const candleCount = chartCandles.length
const lastCandleIndex = Math.max(candleCount - 1, 0)
const alphaProfileStartX = lastCandleIndex + ALPHAX_PROFILE_START_OFFSET
const alphaProfileEndX =
  lastCandleIndex + ALPHAX_PROFILE_START_OFFSET + ALPHAX_PROFILE_MAX_WIDTH

const xAxisMaxWithProfile =
  showAlphaX && alphaProfileBins?.length
    ? lastCandleIndex + ALPHAX_PROFILE_RIGHT_SPACE
    : lastCandleIndex

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — FIND YOUR xAxis CONFIG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CURRENT USUALLY LOOKS LIKE:
xAxis: {
  type: "category",
  data: categoryData,
  ...
}

REPLACE / ADD max:
xAxis: {
  type: "category",
  data: categoryData,
  min: 0,
  max: xAxisMaxWithProfile,
  boundaryGap: false,
  axisLine: { lineStyle: { color: "#26324a" } },
  axisLabel: { color: "#8b95aa", fontSize: 10 },
  splitLine: { show: false },
}

IMPORTANT:
If your chart uses xAxis as an array, apply max to the main candlestick xAxis:
xAxis: [
  {
    ...existingMainXAxis,
    min: 0,
    max: xAxisMaxWithProfile,
  }
]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — FIND YOUR dataZoom CONFIG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The snap-back fix should stay.

Add this helper before the option object:

NEW BLOCK:
const userZoomingRef = useRef(false)
const userZoomHoldUntilRef = useRef(0)

const shouldAutoFollow =
  Date.now() > userZoomHoldUntilRef.current && !userZoomingRef.current

Then make sure your chart event keeps this behavior:

NEW BLOCK:
chart.off("datazoom")
chart.on("datazoom", () => {
  userZoomingRef.current = true
  userZoomHoldUntilRef.current = Date.now() + 8000
  window.setTimeout(() => {
    userZoomingRef.current = false
  }, 250)
})

In your option, the default visible end should include the right profile space only when
the user is not manually zooming:

NEW DATAZOOM IDEA:
dataZoom: [
  {
    type: "inside",
    xAxisIndex: 0,
    filterMode: "none",
    throttle: 50,
    zoomOnMouseWheel: true,
    moveOnMouseMove: true,
    moveOnMouseWheel: false,
  },
  {
    type: "slider",
    xAxisIndex: 0,
    filterMode: "none",
    height: 16,
    bottom: 8,
    borderColor: "rgba(255,255,255,0.08)",
    fillerColor: "rgba(59,130,246,0.18)",
    handleStyle: { color: "#64748b" },
    textStyle: { color: "#94a3b8" },
  },
]

Do NOT reset start/end on every live update if the user has zoomed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4 — ADD THIS FUNCTION INSIDE components/EChartsCandlestickChart.tsx
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Add it above the option object / before you build `series`.

NEW BLOCK:
function buildAlphaProfileSeries({
  alphaProfileBins,
  showAlphaX,
  alphaProfileStartX,
  alphaProfileMaxWidth,
}: {
  alphaProfileBins: any[]
  showAlphaX: boolean
  alphaProfileStartX: number
  alphaProfileMaxWidth: number
}) {
  if (!showAlphaX || !Array.isArray(alphaProfileBins) || alphaProfileBins.length === 0) {
    return []
  }

  const profileBars: any[] = []
  const profileLabels: any[] = []

  for (const bin of alphaProfileBins) {
    const widthPct = Number(bin.widthPct ?? 0)
    const buyWidthPct = Number(bin.buyWidthPct ?? 0)
    const sellWidthPct = Number(bin.sellWidthPct ?? 0)

    const barWidth = Math.max(1, Math.round((widthPct / 100) * alphaProfileMaxWidth))
    const buyWidth = Math.max(0, Math.round((buyWidthPct / 100) * alphaProfileMaxWidth))
    const sellWidth = Math.max(0, Math.round((sellWidthPct / 100) * alphaProfileMaxWidth))

    const top = Number(bin.top)
    const bottom = Number(bin.bottom)
    const mid = Number(bin.mid)

    if (!Number.isFinite(top) || !Number.isFinite(bottom) || !Number.isFinite(mid)) {
      continue
    }

    const direction = bin.direction === "bullish" ? "bullish" : "bearish"
    const isPoc = Boolean(bin.isPoc)

    const fillColor =
      isPoc
        ? "rgba(255, 152, 0, 0.38)"
        : direction === "bullish"
          ? "rgba(8, 153, 129, 0.30)"
          : "rgba(242, 54, 69, 0.30)"

    const borderColor =
      isPoc
        ? "rgba(255, 152, 0, 0.80)"
        : direction === "bullish"
          ? "rgba(8, 153, 129, 0.65)"
          : "rgba(242, 54, 69, 0.65)"

    // Main profile bar — drawn only in future x-space.
    profileBars.push({
      value: [
        alphaProfileStartX,
        bottom,
        alphaProfileStartX + barWidth,
        top,
        mid,
        widthPct,
        bin.label ?? `${Math.round(widthPct)}%`,
      ],
      itemStyle: {
        color: fillColor,
        borderColor,
        borderWidth: isPoc ? 1.5 : 0,
      },
      bin,
    })

    // Optional split-side bar overlay.
    // Buy side starts at same future x, sell side starts after buy width.
    if (buyWidth > 0 || sellWidth > 0) {
      if (buyWidth > 0) {
        profileBars.push({
          value: [
            alphaProfileStartX,
            bottom,
            alphaProfileStartX + buyWidth,
            top,
            mid,
            buyWidthPct,
            "",
          ],
          itemStyle: {
            color: "rgba(8, 153, 129, 0.20)",
            borderColor: "rgba(8, 153, 129, 0.30)",
            borderWidth: 0,
          },
          bin,
        })
      }

      if (sellWidth > 0) {
        profileBars.push({
          value: [
            alphaProfileStartX + buyWidth,
            bottom,
            alphaProfileStartX + buyWidth + sellWidth,
            top,
            mid,
            sellWidthPct,
            "",
          ],
          itemStyle: {
            color: "rgba(242, 54, 69, 0.20)",
            borderColor: "rgba(242, 54, 69, 0.30)",
            borderWidth: 0,
          },
          bin,
        })
      }
    }

    if (widthPct >= 8 || isPoc) {
      profileLabels.push({
        value: [
          alphaProfileStartX + barWidth + 2,
          mid,
          `${Math.round(widthPct)}%`,
          bin.volume ?? 0,
        ],
        itemStyle: {
          color: "transparent",
        },
        label: {
          show: true,
          formatter: `${Math.round(widthPct)}%`,
          color: isPoc
            ? "#ff9800"
            : direction === "bullish"
              ? "#22c7a9"
              : "#ff4d5e",
          fontSize: 10,
          fontWeight: 600,
          position: "right",
        },
      })
    }
  }

  return [
    {
      name: "AlphaX DLM Profile",
      type: "custom",
      coordinateSystem: "cartesian2d",
      silent: true,
      z: 6,
      data: profileBars,
      renderItem: (params: any, api: any) => {
        const x1 = api.value(0)
        const yBottom = api.value(1)
        const x2 = api.value(2)
        const yTop = api.value(3)

        const p1 = api.coord([x1, yBottom])
        const p2 = api.coord([x2, yTop])

        const x = p1[0]
        const y = p2[1]
        const width = Math.max(1, p2[0] - p1[0])
        const height = Math.max(1, p1[1] - p2[1])

        return {
          type: "rect",
          shape: { x, y, width, height },
          style: api.style(),
        }
      },
      encode: { x: [0, 2], y: [1, 3] },
    },
    {
      name: "AlphaX DLM Profile Labels",
      type: "scatter",
      silent: true,
      z: 8,
      symbolSize: 1,
      data: profileLabels,
      encode: { x: 0, y: 1 },
    },
  ]
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 5 — ADD PROFILE SERIES INTO YOUR series ARRAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Find where your `series` array is created.

ADD THIS AFTER CANDLE SERIES, AFTER SMC/ZONES IS OK TOO:
...buildAlphaProfileSeries({
  alphaProfileBins,
  showAlphaX,
  alphaProfileStartX,
  alphaProfileMaxWidth: ALPHAX_PROFILE_MAX_WIDTH,
}),

Example:
const series = [
  candleSeries,
  ...smcSeries,
  ...zoneSeries,
  ...liquiditySeries,
  ...dlmLevelSeries,
  ...buildAlphaProfileSeries({
    alphaProfileBins,
    showAlphaX,
    alphaProfileStartX,
    alphaProfileMaxWidth: ALPHAX_PROFILE_MAX_WIDTH,
  }),
]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 6 — MAKE SURE alphaProfileBins IS READ FROM ENGINE STATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Where you parse engine-state response, add:

NEW BLOCK:
const alphaProfileBins = Array.isArray(engineState?.alphaProfileBins)
  ? engineState.alphaProfileBins
  : []

const alphaProfileMeta = engineState?.alphaProfileMeta ?? null

Also make sure the AlphaX button controls it:
showAlphaX && alphaProfileBins.length > 0

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXPECTED RESULT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before:
AlphaX DLM profile bars overlay the candles and create chaos.

After:
Candles remain on the left.
Empty future chart space appears on the right.
AlphaX DLM profile bars render only in that right-side space.
Turning AlphaX DLM off hides the profile bars.

Badge can remain:
Chart Engine v3P

After this fix works, next phase is making the right profile visually closer to Pine:
- POC label
- profile value numbers
- dotted midlines
- stronger split buy/sell mode
