import type { HistoricalBalance } from './types'
import { parseCsv } from './import'

const number = (value = '') => {
  const clean = value.trim().replace(/[$,]/g, '')
  if (!clean || clean === '-' || clean.toUpperCase() === 'N/A') return 0
  const negative = clean.startsWith('(') && clean.endsWith(')')
  const parsed = Number(clean.replace(/[()]/g, ''))
  if (!Number.isFinite(parsed)) throw new Error(`Invalid statement amount: ${value}`)
  return negative ? -parsed : parsed
}

const monthFrom = (value: string) => {
  const match = value.match(/(20\d{2})[-/](\d{2})/)
  return match && +match[2] >= 1 && +match[2] <= 12 ? `${match[1]}-${match[2]}` : ''
}

function row(values: Record<string, string>, fileName: string, source: HistoricalBalance['source'], index: number): HistoricalBalance {
  const month = monthFrom(values.month || values.period || values.statement_period || '')
  const closing = values.closing_equity || values.ending_account_value || values.ending_equity
  if (!month || !closing?.trim()) throw new Error(`Missing month or closing equity in ${fileName}, row ${index + 2}`)
  const closingEquity = number(closing)
  const balance: HistoricalBalance = {
    id: `balance-${values.account_mask || values.mask || 'unassigned'}-${month}-${index}`,
    accountMask: values.account_mask || values.mask || '', month,
    openingEquity: values.opening_equity ? number(values.opening_equity) : undefined,
    deposits: number(values.deposits), withdrawals: -Math.abs(number(values.withdrawals)),
    dividendsInterest: number(values.dividends_interest || values.dividends_and_interest),
    marketChange: number(values.market_change || values.market_appreciation), expenses: -Math.abs(number(values.expenses)),
    closingEquity, marginLoanBalance: values.net_loan_balance ? Math.abs(number(values.net_loan_balance)) : undefined,
    source, fileName, importedAt: new Date().toISOString(),
  }
  if (balance.openingEquity != null) {
    const expected = balance.openingEquity + balance.deposits + balance.withdrawals + balance.dividendsInterest + balance.marketChange + balance.expenses
    if (Math.abs(expected - closingEquity) > 0.02) throw new Error(`Statement totals do not reconcile for ${month} in ${fileName}. Check the summary amounts.`)
  }
  return balance
}

export function parseHistoricalBalanceCsv(text: string, fileName = 'historical-balances.csv', accountMask = ''): HistoricalBalance[] {
  const lines = parseCsv(text)
  if (lines.length < 2) throw new Error('CSV has no rows')
  const headers = lines[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'))
  return lines.slice(1).map((cells, index) => {
    const values = Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']))
    values.account_mask ||= values.mask || accountMask
    return row(values, fileName, 'CSV', index)
  })
}

export async function parseSchwabStatementPdf(data: ArrayBuffer, fileName: string, accountMask = ''): Promise<HistoricalBalance> {
  const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // Vite turns this into the hashed worker asset in production. Keep it lazy so
  // CSV-only consumers and the Node test runner do not load a browser worker.
  // @ts-ignore Vite asset URL module
  const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url') as { default: string }
  pdf.GlobalWorkerOptions.workerSrc = worker.default
  // PDF.js transfers the buffer to its worker; retain the selected file for Back/retry.
  const task = pdf.getDocument({ data: data.slice(0) })
  try {
    const document = await task.promise
    const text: string[] = []
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i); const content = await page.getTextContent()
      text.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '))
    }
    return parseSchwabStatementText(text.join('\n'), fileName, accountMask)
  } finally { await task.destroy() }
}

export function parseSchwabStatementText(combined: string, fileName: string, accountMask = ''): HistoricalBalance {
  accountMask = combined.match(/Account Number\s+[\d*-]+[- ](\d{3,4})\b/)?.[1] || accountMask
  const period = combined.match(/Statement Period\s+([A-Za-z]+)\s+\d{1,2}-\d{1,2},\s+(20\d{2})/)
  const monthNumber = period ? String(new Date(`${period[1]} 1, ${period[2]}`).getMonth() + 1).padStart(2, '0') : ''
  const month = period ? `${period[2]}-${monthNumber}` : ''
  const signed = (label: string, optional = false) => {
    const match = combined.match(new RegExp(`${label}\\s+(\\(?-?\\$?[\\d,]+\\.\\d{2}\\)?)`))
    if (!match && !optional) throw new Error(`Could not find Schwab account summary field ${label} in ${fileName}`)
    return match ? String(number(match[1])) : ''
  }
  return row({ month, account_mask: accountMask, opening_equity: signed('Beginning Account Value'), deposits: signed('Deposits'), withdrawals: signed('Withdrawals'), dividends_interest: signed('Dividends and Interest'), market_change: signed('Market Appreciation\\/\\(Depreciation\\)'), expenses: signed('Expenses'), closing_equity: signed('Ending Account Value'), net_loan_balance: signed('Net Loan Balance', true) }, fileName, 'Schwab statement', 0)
}

export async function parseHistoricalFiles(files: { name: string; data: string | ArrayBuffer }[], accountMask = '') {
  const rows: HistoricalBalance[] = []
  for (const file of files) {
    if (typeof file.data === 'string') rows.push(...parseHistoricalBalanceCsv(file.data, file.name, accountMask))
    else rows.push(await parseSchwabStatementPdf(file.data, file.name, accountMask))
  }
  return rows.sort((a, b) => a.month.localeCompare(b.month))
}
