// Public backend URL only. Authentication and IBKR credentials stay server-side.
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'https://trading-intelligence-dashboard-1.onrender.com'
).replace(/\/$/, '')

export function backendApiUrl(path: string) {
  return `${API_BASE_URL}/${path.replace(/^\//, '')}`
}
