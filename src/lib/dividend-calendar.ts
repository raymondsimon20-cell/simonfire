import type { SymbolDividend } from './calc'

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function estimateDividendDate(dates: string[], month: string, today: string, cadence: SymbolDividend['cadence']) {
  const valid = dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort()
  if (!valid.length) return undefined
  const [year, monthNumber] = month.split('-').map(Number)
  const daysInMonth = new Date(year, monthNumber, 0).getDate()
  if (cadence === 'Weekly') {
    const weekdays = valid.map((date) => new Date(`${date}T00:00:00`).getDay())
    const weekday = [...new Set(weekdays)].sort((a, b) => weekdays.filter((day) => day === b).length - weekdays.filter((day) => day === a).length)[0]
    const startDay = month === today.slice(0, 7) ? Math.min(daysInMonth, Number(today.slice(8, 10)) + 1) : 1
    for (let day = startDay; day <= daysInMonth; day++) {
      const candidate = new Date(year, monthNumber - 1, day)
      if (candidate.getDay() === weekday) return iso(candidate)
    }
    return undefined
  }
  const sameSeason = valid.filter((date) => Number(date.slice(5, 7)) === monthNumber)
  const evidence = sameSeason.length ? sameSeason : valid
  const days = evidence.map((date) => Number(date.slice(8, 10))).sort((a, b) => a - b)
  const typicalDay = Math.min(daysInMonth, days[Math.floor(days.length / 2)])
  return `${month}-${String(typicalDay).padStart(2, '0')}`
}
