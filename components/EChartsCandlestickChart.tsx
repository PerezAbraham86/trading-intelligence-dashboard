FILE: components/EChartsCandlestickChart.tsx
PATCH NAME: v3AQ BTCUSD 1m historical-only candle source fix

PURPOSE:
BTCUSD timeframes above 1m work, but BTCUSD 1m collapses into line candles.
That means the issue is the BTCUSD 1m live/sticky path, not the candlestick renderer.
This patch disables sticky/live candle base for BTCUSD 1m and forces BTCUSD 1m to use historical Alpaca candles first.

DO NOT change:
- yAxis
- dataZoom
- candlestick body style
- barWidth
- SMC / AlphaX logic
- main.py

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — ADD BTCUSD 1M FLAG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Find this area near the main component state/derived values, after symbol/timeframe exist.

ADD this block somewhere AFTER:

const [symbol, setSymbol] = useState(initialSymbol)
const [timeframe, setTimeframe] = useState(initialTimeframe)

ADD:

const isBtcOneMinuteChart =
  normalizeSymbol(symbol) === 'BTCUSD' && normalizeTimeframe(timeframe) === '1m'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — REPLACE STICKY LIVE CANDLE BLOCK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CURRENT BLOCK:

const lastValidLiveCandlesRef = useRef<Candle[]>([])

if (liveCandles.length > 0) {
  lastValidLiveCandlesRef.current = liveCandles
}

const stickyLiveCandles =
  liveCandles.length > 0 ? liveCandles : lastValidLiveCandlesRef.current

const usingLiveCandles = stickyLiveCandles.length >= 1
const symbolSampleCandles = useMemo(() => getSampleCandlesForSymbol(symbol), [symbol])
const baseCandles = usingLiveCandles ? stickyLiveCandles : symbolSampleCandles

REPLACE WITH:

const lastValidLiveCandlesRef = useRef<Candle[]>([])

useEffect(() => {
  lastValidLiveCandlesRef.current = []
}, [symbol, timeframe])

// BTCUSD 1m is the only BTC timeframe collapsing into line candles.
// Higher BTC timeframes work because they rely on clean historical candles.
// Therefore BTCUSD 1m should not use sticky/recent/live candles as its base.
const allowStickyLiveCandles = !isBtcOneMinuteChart

if (allowStickyLiveCandles && liveCandles.length > 0) {
  lastValidLiveCandlesRef.current = liveCandles
}

const stickyLiveCandles =
  allowStickyLiveCandles && liveCandles.length > 0
    ? liveCandles
    : allowStickyLiveCandles
      ? lastValidLiveCandlesRef.current
      : []

const usingLiveCandles = stickyLiveCandles.length >= 1
const usingHistoricalBtcOneMinute =
  isBtcOneMinuteChart && historicalCandlesFromAlpaca.length > 0

const symbolSampleCandles = useMemo(() => getSampleCandlesForSymbol(symbol), [symbol])

const baseCandles = usingHistoricalBtcOneMinute
  ? historicalCandlesFromAlpaca
  : usingLiveCandles
    ? stickyLiveCandles
    : symbolSampleCandles

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — OPTIONAL BADGE UPDATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Find your dataBadge block. Inside the non-futures path, add this before the Live API Candles branch:

usingHistoricalBtcOneMinute
  ? 'BTC 1m Historical'
  :

Example shape:

const dataBadge = isFuturesChart
  ? historicalCandlesFromAlpaca.length > 0 || engineAvailable
    ? 'InsightSentry Futures'
    : historicalStatus === 'loading' || engineStatus === 'loading'
      ? 'Loading InsightSentry'
      : 'InsightSentry Waiting'
  : usingHistoricalBtcOneMinute
    ? 'BTC 1m Historical'
    : engineAvailable
      ? 'Python SMC Engine'
      : usingLiveCandles
        ? historicalCandlesFromAlpaca.length > 0
          ? 'Alpaca + Live Candles'
          : 'Live API Candles'
        : historicalStatus === 'loading'
          ? 'Loading History'
          : 'Sample Candles'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXPECTED RESULT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BTCUSD 1m should stop using stale/live/sticky candles and should behave like the higher BTC timeframes.

On BTCUSD 1m the badge should show:

BTC 1m Historical

or, if your badge block is different and you skip STEP 3, the important result is:

- BTCUSD 1m candles should no longer collapse into lines.
- BTCUSD 3m/5m/etc. should remain unchanged.
- MES1/ES1 should remain unchanged.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NOTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This is intentionally NOT a y-axis fix.
This is intentionally NOT a candle-body patch.
This is a source-routing fix for BTCUSD 1m only.
