const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function load(fetch, clock = Date) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/marketDataConnection.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, fetch, AbortController, setTimeout, clearTimeout, Date: clock })
  return exports
}
test('Disconnected reconnection delays increase and cap at five minutes', () => {
  const api = load()
  assert.equal(api.reconnectDelay(0), 60000)
  assert.equal(api.reconnectDelay(1), 120000)
  assert.equal(api.reconnectDelay(20), 300000)
})
test('Readiness is shared across charts and does not hide disconnection', async () => {
  let calls = 0
  let now = 0
  const api = load(async () => { calls++; return { ok: true, json: async () => ({ ready: false, reason: 'IBKR_BASE_URL is not configured.' }) } }, { now: () => now })
  const statuses = await Promise.all([api.providerStatus('https://backend', 'MES1!'), api.providerStatus('https://backend', 'MES1!')])
  assert.equal(calls, 1)
  assert.equal(statuses[0].ready, false)
  now = 16000
  await api.providerStatus('https://backend', 'MES1!')
  assert.equal(calls, 1, 'quote polling must not probe disconnected provider after 15s')
  now = 61000
  await api.providerStatus('https://backend', 'MES1!')
  assert.equal(calls, 2)
  assert.match(api.marketDataMessage(statuses[0]), /missing gateway configuration/)
})
test('Messages distinguish mapping, entitlement, network and HTTP errors', async () => {
  const api = load()
  assert.match(api.marketDataMessage({ reason: 'Configure IBKR_CONID_MAP with exact contract ID' }), /contract mapping/)
  assert.match(api.marketDataMessage({ reason: 'market-data permission unavailable' }), /entitlement/)
  assert.match(api.marketDataMessage(new TypeError('Failed to fetch')), /Browser\/network/)
  await assert.rejects(api.readableApiResponse({ ok: false, status: 503, json: async () => ({}) }), /Backend unavailable/)
})


test('TWS states remain explicit and never label stale/closed data connected-live', () => {
  const api = load()
  for (const status of ['Live market data', 'Market closed', 'Waiting for data', 'Stale market data', 'Authentication required', 'Market-data subscription required', 'Gateway disconnected', 'Connector offline']) {
    const payload = { transport: 'tws_relay', status, ready: true }
    assert.equal(api.connectionLabel(payload), status)
    assert.ok(api.marketDataMessage(payload).startsWith(status))
  }
  assert.equal(api.connectionLabel({ ready: true }), 'Connected')
})

test('TWS chart keeps provider timestamps and warms the selected symbol', () => {
  const page = fs.readFileSync('app/page.tsx', 'utf8')
  assert.ok(page.includes("if (String(liveCandle?.source ?? '').startsWith('ibkr_tws')) return liveCandle"))
  assert.ok(page.includes('providerStatus(bootApiBaseUrl, selectedSymbol)'))
  assert.ok(page.includes("process.env.NEXT_PUBLIC_DEFAULT_SYMBOL === 'SPY'"))
  assert.ok(fs.readFileSync('api/main.py', 'utf8').includes('if is_tws():\n        return get_historical_ohlcv(normalized_symbol, normalized_timeframe, limit=safe_limit)'))
})

test('Offline TWS selection purges incompatible cached candles and requests before readiness return', () => {
  const api = load()
  const key = 'SPY:1m'
  const cache = new Map([[key, { source: 'ibkr_historical_ohlcv', candles: [{ close: 501 }] }]])
  const inFlight = new Map([[key, Promise.resolve({ source: 'ibkr_historical_ohlcv' })]])
  assert.equal(api.resetIncompatibleCandleCache(cache, inFlight, key, 'tws_relay'), true)
  assert.equal(cache.has(key), false)
  assert.equal(inFlight.has(key), false)
  cache.set(key, { source: 'ibkr_tws', candles: [{ close: 502 }] })
  assert.equal(api.resetIncompatibleCandleCache(cache, inFlight, key, 'tws_relay'), false)
  assert.equal(api.resetIncompatibleCandleCache(cache, inFlight, key, 'client_portal'), true)
  const page = fs.readFileSync('app/page.tsx', 'utf8')
  const scope = page.slice(page.indexOf('const provider = await providerStatus(activeApiBaseUrl, symbol)'))
  assert.ok(scope.indexOf('resetIncompatibleCandleCache(') < scope.indexOf('if (!provider.ready)'))
})

test('TWS empty history and late REST responses never reuse Client Portal candles', async () => {
  const api = load()
  const page = fs.readFileSync('app/page.tsx', 'utf8')
  const source = page.slice(page.indexOf('async function fetchSharedCandlePayload('), page.indexOf('function dashboardCandlesToOverlayCandles('))
  const key = 'SPY:1m'
  let response = { source: 'ibkr_tws', candles: [] }
  const cache = new Map([[key, { source: 'ibkr_historical_ohlcv', candles: [{ close: 501 }], limit: 10 }]])
  const context = {
    run: null, Date,
    SHARED_CANDLE_CACHE: cache, SHARED_CANDLE_IN_FLIGHT: new Map(),
    SHARED_CANDLE_TRANSPORT: new Map([[key, 'tws_relay']]), SHARED_CANDLE_CACHE_MAX_BARS: 5000,
    normalizeSymbol: value => value, normalizeTimeframe: value => value, sharedCandleKey: () => key,
    fetchBackendHistoricalRefreshPayload: async () => response,
    normalizeCandlePayload: value => value.candles,
    candleTransportMatches: api.candleTransportMatches,
    getUnifiedOverlayPayload: () => null, getUnifiedIntelligencePayload: () => null,
    mergeHistoricalCandles: (previous, incoming) => [...(previous || []), ...incoming],
  }
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText
  vm.runInNewContext(js + '\nrun = fetchSharedCandlePayload', context)
  await assert.rejects(context.run('https://backend', 'SPY', '1m', 10), /zero candles/)
  response = { source: 'ibkr_historical_ohlcv', candles: [{ close: 501 }] }
  await assert.rejects(context.run('https://backend', 'SPY', '1m', 10), /different selected IBKR transport/)
  response = { source: 'ibkr_tws', candles: [{ close: 502 }] }
  const result = await context.run('https://backend', 'SPY', '1m', 10)
  assert.equal(result.candles.length, 1)
  assert.equal(result.candles[0].close, 502)
})
