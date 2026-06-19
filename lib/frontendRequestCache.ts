type CacheEntry<T = unknown> = {
  data?: T
  updatedAt: number
  promise?: Promise<T>
}

const requestCache = new Map<string, CacheEntry>()

export async function cachedJsonFetch<T>(url: string, ttlMs: number): Promise<T> {
  const now = Date.now()
  const existing = requestCache.get(url) as CacheEntry<T> | undefined

  if (existing?.promise) {
    return existing.promise
  }

  if (existing && existing.data !== undefined && now - existing.updatedAt < ttlMs) {
    return existing.data as T
  }

  const promise = fetch(url, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Request failed ${response.status}: ${url}`)
      }

      const data = (await response.json()) as T

      requestCache.set(url, {
        data,
        updatedAt: Date.now(),
      })

      return data
    })
    .finally(() => {
      const current = requestCache.get(url)

      if (current?.promise === promise) {
        requestCache.set(url, {
          data: current.data,
          updatedAt: current.updatedAt,
        })
      }
    })

  requestCache.set(url, {
    data: existing?.data,
    updatedAt: existing?.updatedAt ?? 0,
    promise,
  })

  return promise
}

export function clearFrontendRequestCache(url?: string) {
  if (url) {
    requestCache.delete(url)
    return
  }

  requestCache.clear()
}
