// Shared readiness checks prevent every chart from waking the gateway independently.
const attempts = new Map<string, number>()
const checks = new Map<string, { until: number; promise: Promise<any> }>()

export function reconnectDelay(attempt: number, retrySeconds = 0): number {
  return Math.max(Number(retrySeconds || 0) * 1000, Math.min(300000, 60000 * 2 ** Math.min(attempt, 3)))
}

export type ConnectionStatus = 'Connected' | 'Waiting' | 'Error' | 'Alpaca unavailable' | 'Alpaca connected' | 'Live market data' | 'Market closed' | 'Waiting for data' | 'Stale market data' | 'Authentication required' | 'Market-data subscription required' | 'Gateway disconnected' | 'Connector offline'

export function connectionLabel(payload: any): ConnectionStatus {
  const states: ConnectionStatus[] = ['Alpaca connected', 'Live market data', 'Market closed', 'Waiting for data', 'Stale market data', 'Authentication required', 'Market-data subscription required', 'Gateway disconnected', 'Connector offline']
  if (payload?.transport === 'tws_relay' && states.includes(payload.status)) return payload.status
  return payload?.ready ? 'Connected' : 'Alpaca unavailable'
}

export function marketDataMessage(payload: any, fallback = 'Alpaca unavailable'): string {
  if (payload?.transport === 'tws_relay') return `${connectionLabel(payload)}${payload.reason ? ` — ${payload.reason}` : ''}`
  const reason = String(payload?.reason ?? payload?.connection?.reason ?? payload?.detail ?? payload?.message ?? '')
  if (/Failed to fetch|NetworkError|fetch failed/i.test(reason)) return 'Browser/network error: cannot read the backend response. Check connectivity and CORS.'
  if (/timeout|abort/i.test(reason)) return 'Backend unavailable: request timed out.'
  if (/ALPACA_API_KEY|not.configured/i.test(reason)) return `Alpaca unavailable — missing gateway configuration. ${reason}`
  if (/CONID_MAP|contract ID/i.test(reason)) return `Alpaca unavailable — missing exact contract mapping. ${reason}`
  if (/permission|entitlement|subscription/i.test(reason)) return `Alpaca market-data access unavailable. ${reason}`
  if (/gateway|session|authenticate|login|Alpaca unavailable/i.test(reason)) return `Alpaca unavailable — ${reason || 'authenticate the gateway.'}`
  return reason || fallback
}

export async function readableApiResponse(response: Response): Promise<any> {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(marketDataMessage(payload, response.status >= 500 ? `Backend unavailable (HTTP ${response.status}).` : `Backend request rejected (HTTP ${response.status}).`))
  return payload
}

export function providerStatus(base: string, symbol: string): Promise<any> {
  const key = `${base}:${symbol}`
  const cached = checks.get(key)
  if (cached && Date.now() < cached.until) return cached.promise
  const promise = (async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const payload = await readableApiResponse(await fetch(`${base}/api/alpaca/status?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store', signal: controller.signal }))
      const count = attempts.get(key) ?? 0
      attempts.set(key, payload.ready ? 0 : count + 1)
      const entry = checks.get(key)
      if (entry) entry.until = Date.now() + (payload.ready ? 15000 : reconnectDelay(count, payload.retryAfterSeconds))
      return payload
    } catch (error) {
      const count = attempts.get(key) ?? 0
      attempts.set(key, count + 1)
      const entry = checks.get(key)
      if (entry) entry.until = Date.now() + reconnectDelay(count)
      throw error
    } finally { clearTimeout(timeout) }
  })()
  checks.set(key, { until: Date.now() + 15000, promise })
  return promise
}

export function candleTransportMatches(source: unknown, transport: string): boolean {
  const isTws = String(source ?? '').startsWith('ibkr_tws')
  return transport === 'tws_relay' ? isTws : !isTws
}

export function resetIncompatibleCandleCache(
  cache: { get(key: string): { source?: unknown } | undefined; delete(key: string): boolean },
  inFlight: { delete(key: string): boolean },
  key: string,
  transport: string,
  transportChanged = false
): boolean {
  const cached = cache.get(key)
  if (!transportChanged && (!cached || candleTransportMatches(cached.source, transport))) return false
  if (cached && !candleTransportMatches(cached.source, transport)) cache.delete(key)
  inFlight.delete(key)
  return true
}
