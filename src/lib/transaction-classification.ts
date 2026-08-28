import type { TxnType } from './types'

export interface ClassificationInput {
  rawType?: string
  description?: string
  amount: number
  units?: number
}

// Stable enough to survive Schwab changing account masks/reference numbers on
// otherwise identical transactions, while retaining the meaningful wording.
export function normalizeTransactionPattern(description: string) {
  return description
    .toUpperCase()
    .replace(/\b[\dX*#]{2,}\b/g, '')
    .replace(/[#*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Schwab's API types are intentionally broad. JOURNAL, for example, can mean an
// internal transfer, withholding, an adjustment, or a corporate action. Prefer
// distinctive description text before falling back to the API/CSV action.
export function classifySchwabTransaction({
  rawType = '',
  description = '',
  amount,
  units = 0,
}: ClassificationInput): TxnType {
  const raw = rawType.toUpperCase()
  const desc = description.toUpperCase()
  const text = `${raw} ${desc}`

  if (/\b(?:FOREIGN|FEDERAL|STATE|NRA|BACKUP|NONRESIDENT|PTP|IRS)?\s*TAX(?:ES)?\s+(?:WITHHELD|WITHHOLDING|PAID)\b|\bWITHHOLDING TAX\b|\bTAX WITHHOLD(?:ING)?\b|\bFOREIGN TAX\b|\bFED TAX WH\b|\bNRA WITHHOLDING\b|\b1042[- ]?S WITHHOLDING\b/.test(text))
    return 'Tax Withholding'

  if (/MARGIN INTEREST|INTEREST CHARGED|MARGIN INT\b|INT CHARGE|MARGININT/.test(text))
    return 'Interest'

  // Fractional shares liquidated during a split are real sale proceeds. Match
  // this before the broader split/corporate-action rule.
  if (/\bCASH IN LIEU(?: OF FRACTIONAL SHARES?)?\b|\bCIL FRACTIONAL SHARES?\b/.test(text))
    return 'Sell'

  if (/\bREVERSE (?:STOCK )?SPLIT\b|\bFORWARD (?:STOCK )?SPLIT\b|\bSTOCK SPLIT\b|\bMANDATORY REORG(?:ANIZATION)?\b|\bSHARE ADJUSTMENT\b|\bSPLIT ADJUSTMENT\b/.test(text))
    return 'Corporate Action'

  const internalTransfer =
    /\bTRF FUNDS\b|\bTRANSFER OF FUNDS\b|\bJOURNAL/.test(desc) && /\bTYPE ?[12]\b/.test(desc)
  if (internalTransfer) return 'Transfer'

  if (raw === 'TRADE' || /\b(?:BOUGHT|BUY|PURCHASED|REINVEST SHARES)\b/.test(raw))
    return units < 0 || /\bSELL|SOLD\b/.test(raw) ? 'Sell' : 'Buy'
  if (/\bSELL|SOLD\b/.test(raw)) return 'Sell'

  if (raw.includes('DIVIDEND') || raw.includes('INTEREST')) {
    const looksInterest =
      /CREDIT INTEREST|BANK INTEREST|SCHWAB.*\bINT\b/.test(desc) ||
      (amount < 0 && !/DIVIDEND|DISTRIBUTION/.test(desc))
    return looksInterest ? 'Interest' : 'Dividend'
  }

  if (/\bDIVIDEND|QUALIFIED DIV|NON[- ]?QUALIFIED DIV|CAPITAL GAIN DISTRIBUTION|CASH DISTRIBUTION|REINVEST DIVIDEND\b/.test(text))
    return 'Dividend'
  if (/\bINTEREST\b/.test(text)) return 'Interest'

  if (/FEE|COMMISSION|ADR (?:FEE|PASS[- ]?THRU)|SERVICE CHARGE/.test(text)) return 'Fee'

  const looksBill = /\b(PAYMENT|PMT|BILLPAY|BILL PAY|CARD|CREDIT CARD|LOAN|MORTGAGE|AUTOPAY|BEST EGG|ACH DEBIT|OVERDRAFT|INVESTOR CHECKING)\b/.test(desc)
  if (amount < 0 && looksBill) return 'Bill Payment'

  const incoming = /ACH_RECEIPT|WIRE_IN|CASH_RECEIPT|MONEYLINK.*(?:DEP|CREDIT)|FUNDS RECEIVED|DIRECT DEPOSIT|CONTRIBUTION|DEPOSIT/.test(text)
  const outgoing = /ACH_DISBURSEMENT|WIRE_OUT|CASH_DISBURSEMENT|MONEYLINK.*(?:WITHDRAW|DEBIT)|WITHDRAWAL/.test(text)
  if (incoming) return amount < 0 ? 'Withdrawal' : 'Contribution'
  if (outgoing) return amount > 0 ? 'Contribution' : 'Withdrawal'

  if (/TRANSFER/.test(text)) return 'Transfer'
  return 'Other'
}
