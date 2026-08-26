export const usd = (n: number, opts: { sign?: boolean; cents?: boolean } = {}) => {
  const { sign = false, cents = true } = opts
  const s = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(Math.abs(n))
  if (sign) return `${n < 0 ? '-' : '+'}${s}`
  return n < 0 ? `-${s}` : s
}

export const pct = (n: number, opts: { sign?: boolean; digits?: number } = {}) => {
  const { sign = false, digits = 2 } = opts
  const v = n.toFixed(digits)
  if (sign) return `${n < 0 ? '' : '+'}${v}%`
  return `${v}%`
}

export const num = (n: number, digits = 4) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n)

export const intfmt = (n: number) => new Intl.NumberFormat('en-US').format(n)

export const shortDate = (iso: string) =>
  new Date(iso + (iso.length <= 10 ? 'T00:00:00' : '')).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

export const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

export const relTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export const posNeg = (n: number) => (n >= 0 ? 'text-[--color-pos]' : 'text-[--color-neg]')
