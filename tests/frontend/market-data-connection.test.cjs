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
