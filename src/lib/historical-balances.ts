import type { HistoricalBalance } from './types'

const number = (value: string) => {
  const clean = value.trim().replace(/[$,]/g, '')
  if (!clean || clean === '-' || clean.toUpperCase() === 'N/A') return 0
  const negative = clean.startsWith('(') && clean.endsWith(')')
  const parsed = Number(clean.replace(/[()]/g, ''))
  return negative ? -parsed : parsed
}

const monthFrom = (value: string) => {
  const match = value.match(/(20\d{2})[-/](\d{2})/)
  return match ? `${match[1]}-${match[2]}` : ''
}

function row(values: Record<string, string>, fileName: string, source: HistoricalBalance['source'], index: number): HistoricalBalance | null {
  const month = monthFrom(values.month || values.period || values.statement_period || '')
  const closingEquity = number(values.closing_equity || values.ending_account_value || values.ending_equity || '')
  if (!month || !Number.isFinite(closingEquity)) return null
  return {
    id: `balance-${month}-${index}`,
    accountMask: values.account_mask || values.mask || '', month,
    openingEquity: values.opening_equity ? number(values.opening_equity) : undefined,
    deposits: number(values.deposits), withdrawals: number(values.withdrawals),
    dividendsInterest: number(values.dividends_interest || values.dividends_and_interest),
    marketChange: number(values.market_change || values.market_appreciation), expenses: number(values.expenses),
    closingEquity, marginLoanBalance: values.net_loan_balance ? Math.abs(number(values.net_loan_balance)) : undefined,
    source, fileName, importedAt: new Date().toISOString(),
  }
}

export function parseHistoricalBalanceCsv(text: string, fileName = 'historical-balances.csv'): HistoricalBalance[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) throw new Error('CSV has no rows')
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'))
  return lines.slice(1).map((line, index) => {
    const cells = line.split(','); const values = Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']))
    return row(values, fileName, 'CSV', index)
  }).filter((value): value is HistoricalBalance => !!value)
}

export async function parseSchwabStatementPdf(data: ArrayBuffer, fileName: string, accountMask = ''): Promise<HistoricalBalance> {
  const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // Vite turns this into the hashed worker asset in production. Keep it lazy so
  // CSV-only consumers and the Node test runner do not load a browser worker.
  // @ts-ignore Vite asset URL module
  const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url') as { default: string }
  pdf.GlobalWorkerOptions.workerSrc = worker.default
  const document = await pdf.getDocument({ data }).promise
  const text: string[] = []
  for (let i = 1; i <= document.numPages; i++) {
    const page = await document.getPage(i); const content = await page.getTextContent()
    text.push(content.items.map((item: any) => item.str).join(' '))
  }
  const combined = text.join('\n')
  const period = combined.match(/Statement Period\s+([A-Za-z]+)\s+\d{1,2}-\d{1,2},\s+(20\d{2})/)
  const monthNumber = period ? String(new Date(`${period[1]} 1, ${period[2]}`).getMonth() + 1).padStart(2, '0') : ''
  const month = period ? `${period[2]}-${monthNumber}` : ''
  const value = (label: string) => combined.match(new RegExp(`${label}\\s+\\(?\\$?([\\d,]+\\.\\d{2})\\)?`))
  const signed = (label: string) => {
    const match = combined.match(new RegExp(`${label}\\s+(\\(?\\$?[\\d,]+\\.\\d{2}\\)?)`)); return match ? number(match[1]) : 0
  }
  const balance = row({ month, account_mask: accountMask, opening_equity: String(signed('Beginning Account Value')), deposits: String(signed('Deposits')), withdrawals: String(signed('Withdrawals')), dividends_interest: String(signed('Dividends and Interest')), market_change: String(signed('Market Appreciation\\/\\(Depreciation\\)')), expenses: String(signed('Expenses')), closing_equity: String(signed('Ending Account Value')), net_loan_balance: String(signed('Net Loan Balance')) }, fileName, 'Schwab statement', 0)
  if (!balance || !value('Ending Account Value')) throw new Error(`Could not find Schwab account summary in ${fileName}`)
  return balance
}

export async function parseHistoricalFiles(files: { name: string; data: string | ArrayBuffer }[], accountMask = '') {
  const rows: HistoricalBalance[] = []
  for (const file of files) {
    if (typeof file.data === 'string') rows.push(...parseHistoricalBalanceCsv(file.data, file.name))
    else rows.push(await parseSchwabStatementPdf(file.data, file.name, accountMask))
  }
  return rows.sort((a, b) => a.month.localeCompare(b.month))
}
