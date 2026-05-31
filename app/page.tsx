app/page.tsx — same default timeframe + candle-first dashboard gate

1) Replace this line:

const DASHBOARD_SETTINGS_KEY = 'marketbos:dashboard-settings:v1'

With this:

const DASHBOARD_SETTINGS_KEY = 'marketbos:dashboard-settings:v3:candle-first-same-timeframes'
const MAIN_CANDLES_READY_KEY = 'marketbos:main-candles-ready:v1'


2) Add this helper block directly after saveDashboardSettings(...):

function readMainCandleGate(symbol?: string, timeframe?: string) {
  if (typeof window === 'undefined') {
    return {
      ready: false,
      count: 0,
      symbol: '',
      timeframe: '',
      status: 'server',
    }
  }

  try {
    const raw = window.localStorage.getItem(MAIN_CANDLES_READY_KEY)
    if (!raw) {
      return {
        ready: false,
        count: 0,
        symbol: '',
        timeframe: '',
        status: 'missing',
      }
    }

    const parsed = JSON.parse(raw)
    const storedSymbol = normalizeSymbol(parsed?.symbol ?? '')
    const storedTimeframe = normalizeTimeframe(parsed?.timeframe ?? '')
    const requestedSymbol = normalizeSymbol(symbol ?? storedSymbol)
    const requestedTimeframe = normalizeTimeframe(timeframe ?? storedTimeframe)
    const count = Number(parsed?.count ?? 0)

    return {
      ready:
        Boolean(parsed?.ready) &&
        count > 0 &&
        storedSymbol === requestedSymbol &&
        storedTimeframe === requestedTimeframe,
      count,
      symbol: storedSymbol,
      timeframe: storedTimeframe,
      status: String(parsed?.status ?? ''),
    }
  } catch {
    return {
      ready: false,
      count: 0,
      symbol: '',
      timeframe: '',
      status: 'parse-error',
    }
  }
}


3) Replace the mini chart 1 default block:

  const [miniChartOneSelection, setMiniChartOneSelection] = useState<ChartSelection>(() => {
    const saved = readDashboardSettings()
    return normalizeChartSelection(saved.miniChartOneSelection, {
      symbol: 'BTCUSD',
      timeframe: '5m',
      candleMode: 'Heikin Ashi',
    })
  })

With this:

  const [miniChartOneSelection, setMiniChartOneSelection] = useState<ChartSelection>(() => {
    const saved = readDashboardSettings()
    return normalizeChartSelection(saved.miniChartOneSelection, {
      symbol: 'BTCUSD',
      timeframe: '1m',
      candleMode: 'Heikin Ashi',
    })
  })


4) Replace the mini chart 2 default block:

  const [miniChartTwoSelection, setMiniChartTwoSelection] = useState<ChartSelection>(() => {
    const saved = readDashboardSettings()
    return normalizeChartSelection(saved.miniChartTwoSelection, {
      symbol: 'BTCUSD',
      timeframe: '15m',
      candleMode: 'Heikin Ashi',
    })
  })

With this:

  const [miniChartTwoSelection, setMiniChartTwoSelection] = useState<ChartSelection>(() => {
    const saved = readDashboardSettings()
    return normalizeChartSelection(saved.miniChartTwoSelection, {
      symbol: 'BTCUSD',
      timeframe: '1m',
      candleMode: 'Heikin Ashi',
    })
  })


5) Add this state after factorTechnicalSentiment state:

  const [mainCandleGate, setMainCandleGate] = useState(() =>
    readMainCandleGate('BTCUSD', '1m')
  )


6) Replace these lines:

  const miniOneTimeframe = normalizeTimeframe(miniChartOneSelection.timeframe || '5m')
  const miniTwoTimeframe = normalizeTimeframe(miniChartTwoSelection.timeframe || '15m')

With this:

  const miniOneTimeframe = normalizeTimeframe(miniChartOneSelection.timeframe || selectedTimeframe)
  const miniTwoTimeframe = normalizeTimeframe(miniChartTwoSelection.timeframe || selectedTimeframe)


7) Add this effect after selectedSymbol / selectedTimeframe are defined:

  useEffect(() => {
    const updateGate = () => {
      setMainCandleGate(readMainCandleGate(selectedSymbol, selectedTimeframe))
    }

    updateGate()
    window.addEventListener('marketbos:candle-gate', updateGate)
    window.addEventListener('storage', updateGate)

    return () => {
      window.removeEventListener('marketbos:candle-gate', updateGate)
      window.removeEventListener('storage', updateGate)
    }
  }, [selectedSymbol, selectedTimeframe])


8) Replace the existing symbol-sync effect:

  useEffect(() => {
    setMiniChartOneSelection((current) => ({
      ...current,
      symbol: selectedSymbol,
    }))
    setMiniChartTwoSelection((current) => ({
      ...current,
      symbol: selectedSymbol,
    }))
  }, [selectedSymbol])

With this candle-first same-timeframe version:

  useEffect(() => {
    setMiniChartOneSelection((current) => ({
      ...current,
      symbol: selectedSymbol,
      timeframe: current.timeframe || selectedTimeframe,
    }))
    setMiniChartTwoSelection((current) => ({
      ...current,
      symbol: selectedSymbol,
      timeframe: current.timeframe || selectedTimeframe,
    }))
  }, [selectedSymbol, selectedTimeframe])


9) In the fetchPythonEngineStates effect, replace:

    if (!isClient || !apiBaseUrl) return

With this:

    if (!isClient || !apiBaseUrl || !mainCandleGate.ready) return


10) In that same fetchPythonEngineStates effect dependency array, add mainCandleGate.ready.

Replace:

  }, [apiBaseUrl, isClient, selectedSymbol, selectedTimeframe, dashboardTimeframes])

With this:

  }, [apiBaseUrl, isClient, selectedSymbol, selectedTimeframe, dashboardTimeframes, mainCandleGate.ready])


11) In the fetchSharedTechnicalSentiments effect, replace:

    if (!isClient || !apiBaseUrl) return

With this:

    if (!isClient || !apiBaseUrl || !mainCandleGate.ready) return


12) In that same fetchSharedTechnicalSentiments effect dependency array, add mainCandleGate.ready.

Replace:

  }, [apiBaseUrl, isClient, selectedSymbol, selectedTimeframe, dashboardTimeframes])

With this:

  }, [apiBaseUrl, isClient, selectedSymbol, selectedTimeframe, dashboardTimeframes, mainCandleGate.ready])


13) Result:

- Fresh deployment opens main chart + both mini charts on the same timeframe.
- User can still customize mini chart timeframes after load.
- Main chart candle gate must be ready before engine-state / technical sentiment dashboard fetches start.
- Scorecards, sentiment logic, heatmap, and news stay behind the candle gate.
- Candle loading is the primary pipeline.
