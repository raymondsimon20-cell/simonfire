// Recover an oversized/failed history request in bounded date windows. A failed
// window is an error, never a successful empty ledger.
export async function fetchTransactionHistory(
  fetchRange: (from: string, to: string) => Promise<unknown>, start: Date, end: Date,
) {
  const iso = (date: Date) => date.toISOString().slice(0, 19) + 'Z'
  const read = async (from: Date, to: Date) => {
    const result = await fetchRange(iso(from), iso(to))
    if (!Array.isArray(result)) throw new Error('INVALID_TRANSACTION_RESPONSE')
    return result
  }
  try { return { rows: await read(start, end), method: 'single request' as const } }
  catch { /* Retry the requested range in smaller pieces. */ }
  const windows: { from: Date; to: Date }[] = []
  for (let cursor = start.getTime(); cursor <= end.getTime();) {
    const to = Math.min(cursor + 30 * 86400_000 - 1000, end.getTime())
    windows.push({ from: new Date(cursor), to: new Date(to) })
    cursor = to + 1000
  }
  const results: any[][] = []
  for (let i = 0; i < windows.length; i += 3) {
    results.push(...await Promise.all(windows.slice(i, i + 3).map(({ from, to }) => read(from, to))))
  }
  const seen = new Set<string>()
  const rows = results.flat().filter((row) => {
    const id = row.activityId ?? row.transactionId
    if (id == null) return true
    const key = String(id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { rows, method: 'smaller date windows' as const }
}
