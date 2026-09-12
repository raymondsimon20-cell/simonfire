import type { GlobalDateRange } from './store'

export const localISODate = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

export function dateRangeStart(range: GlobalDateRange, today = localISODate()) {
  if (range === 'all') return ''
  const date = new Date(`${today}T00:00:00`)
  date.setDate(date.getDate() - Number(range) + 1)
  return date.toISOString().slice(0, 10)
}
