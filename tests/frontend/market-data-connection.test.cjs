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
