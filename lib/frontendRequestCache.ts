'use client'

type CacheEntry = {
  data: unknown
  updatedAt: number
}

const responseCache = new Map<string, CacheEntry>()
const inFlightCache = new Map<string, Promise<unknown>>()

export async function cachedJsonFetch<T>(url: string, ttlMs: number): Promise<T> {
  const now = Date.now()
  const cached = responseCache.get(url)

  if (cached && now - cached.updatedAt < ttlMs) {
    return cached.data as T
  }

  const inFlight = inFlightCache.get(url)
  if (inFlight) {
    return inFlight as Promise<T>
  }

  const requestPromise = (async () => {
    try {
      const response = await fetch(url, { cache: 'no-store' })

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`)
      }

      const json = (await response.json()) as T
      responseCache.set(url, {
        data: json,
        updatedAt: Date.now(),
      })

      return json
    } finally {
      inFlightCache.delete(url)
    }
  })()

  inFlightCache.set(url, requestPromise as Promise<unknown>)
  return requestPromise
}
