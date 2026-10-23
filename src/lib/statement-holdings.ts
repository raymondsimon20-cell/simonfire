import type { Account, HistoricalBalance, Position, CsvPositionAuthority, StatementHolding, StatementSnapshot } from './types'
import type { PdfTextItem, PdfTextPage } from './statement-transactions'
import { statementAccount } from './statement-history'
const numeric = (text: string): number | undefined => {
  const cleaned = text.replace(/[$,\s⁺†‡]/g, '')
  if (!/^\(?-?\d+(?:\.\d+)?\)?$/.test(cleaned)) return undefined
  const n = Number(cleaned.replace(/[()]/g,'')) * (cleaned.startsWith('(') ? -1 : 1)
  return Number.isFinite(n) ? n : undefined
}
const linesOf = (items: PdfTextItem[]) => {
  const lines: PdfTextItem[][] = []
  for (const t of items.filter(t => t.str.trim()).sort((a,b) => b.y-a.y || a.x-b.x)) {
    const line = lines.at(-1)
    if (line && Math.abs(line[0].y-t.y)<1.5) line.push(t); else lines.push([t])
  }
  return lines.map(line => line.sort((a,b) => a.x-b.x))
}
export function parseStatementHoldings(pages: PdfTextPage[], month: string, closingEquity?: number): StatementSnapshot {
  const result: StatementSnapshot = {holdings:[],complete:false,issues:[],categoryTotals:[]}
  const categories = new Map<string, StatementHolding[]>()
  for (const page of pages) {
    const items = page.items.filter(t => t.str.trim())
    const headers = items.filter(t => t.str === 'Symbol')
    for (const header of headers) {
      const title = items.filter(t => /^Positions - (?!Summary)/.test(t.str) && t.y>header.y).sort((a,b) => a.y-b.y)[0]
      if (!title || title.y-header.y>45) continue
      const category = title.str.replace(/^Positions - /,'').replace(/\s*\(continued\)/,'').trim()
      const find = (s: string) => items.find(t => t.str === s && Math.abs(t.y-header.y)<4)
      const desc=find('Description'), qty=find('Quantity'), price=find('Price($)'), value=find('Market Value($)'), cost=find('Cost Basis($)'), gain=find('Gain/(Loss)($)'), yieldCol=find('Yield'), annual=find('Income($)')
      if (!desc || !qty || !price || !value || !cost || !gain) {result.issues.push(`Page ${page.page}: holding columns were not recognized.`);continue}
      const ends=[qty,price,value,cost,gain,yieldCol,annual].map(t => t ? t.x+t.width+3 : Infinity)
      const columns = (line: PdfTextItem[]) => {
        const cells=['','','','','','','','','']
        for (const t of line) {
          if (/^\(M\),?$|^[⁺†‡,]+$/.test(t.str)) continue
          let col: number
          if(t.x<desc.x-3) col=0
          else if(t.x+ t.width < qty.x-8) col=1
          else { const index=ends.findIndex(end=>t.x+t.width<=end); col=index<0?-1:index+2 }
          if(col>=0&&col<cells.length) cells[col]+=' '+t.str
        }
        return cells.map(c=>c.trim())
      }
      let current: string[] | undefined
      const flush=()=>{
        if(!current)return
        const [symbolText,name,q,p,v,c,g,y,e]=current;current=undefined
        let symbol=symbolText.replace(/(\d{2}\/\d{2}\/\d{2})\s+(\d{2})/g,'$1$2').replace(/\s+/g,' ').trim()
        const option = symbol.match(/^([A-Z.]+)\s+(\d{2})\/(\d{2})\/(\d{4})\s+([\d.]+)\s+([CP])$/)
        const quantity=numeric(q), unitPrice=numeric(p), marketValue=numeric(v), costBasis=numeric(c), unrealized=numeric(g)
        if (quantity==null || !quantity || unitPrice==null || marketValue==null || (!option && !/^[A-Z][A-Z0-9./^-]{0,15}$/.test(symbol)) || (category==='Options' && !option)) {result.issues.push(`Page ${page.page}: an incomplete holding was held for review.`);return}
        if (Math.abs(quantity*unitPrice*(option?100:1)-marketValue)>.03) {result.issues.push(`Page ${page.page}: ${symbol} quantity, price and value do not reconcile.`);return}
        if(costBasis!=null && unrealized!=null && Math.abs(marketValue-costBasis-unrealized)>.03) {result.issues.push(`Page ${page.page}: ${symbol} cost basis and gain do not reconcile.`);return}
        if (option) symbol=`${option[1].padEnd(6)}${option[4].slice(-2)}${option[2]}${option[3]}${option[6]}${Math.round(Number(option[5])*1000).toString().padStart(8,'0')}`
        const holding: StatementHolding={symbol,name,quantity,price:unitPrice,marketValue,costBasis,unrealized,yieldPct:numeric(y.replace('%','')),annualIncome:numeric(e),page:page.page,category,...(option?{option:{underlying:option[1],expiration:`${option[4]}-${option[2]}-${option[3]}`,strike:Number(option[5]),type:option[6]==='P'?'Put' as const:'Call' as const}}:{})}
        result.holdings.push(holding);categories.set(category,[...(categories.get(category)??[]),holding])
      }
      const nextTitle=items.filter(t=>/^Positions - /.test(t.str)&&t.y<header.y).sort((a,b)=>b.y-a.y)[0]
      const content=items.filter(t=>t.y<header.y-5 && t.y>Math.max(30,nextTitle?.y??0))
      for(const line of linesOf(content)){
        if(line.some(t=>/^Total /.test(t.str)&&t.x<desc.x)){
          flush();const cells=columns(line), total=numeric(cells[4]), basis=numeric(cells[5])
          if(total==null)result.issues.push(`Page ${page.page}: ${category} total was not recognized.`)
          else result.categoryTotals.push({category,marketValue:total,costBasis:basis})
          break
        }
        const cells=columns(line)
        if(numeric(cells[2])!=null){flush();current=cells}
        else if(current && line.every(t=>t.x+ t.width < qty.x-8)) { current[0]+=' '+cells[0];current[1]+=' '+cells[1] }
        else if(line.some(t=>/^Option Customers:|^Estimated Annual Income/.test(t.str))) {flush();break}
      }
      flush()
    }
  }
  for(const [category,holdings] of categories){
    const total=result.categoryTotals.find(t=>t.category===category)
    if(!total||Math.abs(holdings.reduce((s,h)=>s+Math.round(h.marketValue*100),0)-Math.round(total.marketValue*100))>2)result.issues.push(`${category}: holding values do not reconcile to the printed category total.`)
    if(total?.costBasis!=null&&holdings.every(h=>h.costBasis!=null)&&Math.abs(holdings.reduce((s,h)=>s+Math.round(h.costBasis!*100),0)-Math.round(total.costBasis*100))>2)result.issues.push(`${category}: cost basis does not reconcile to the printed category total.`)
  }
  if(!result.holdings.length)result.issues.push('No supported holding table found.')
  if(new Set(result.holdings.map(h=>h.symbol)).size!==result.holdings.length)result.issues.push('Repeated holding symbols need review.')
  const combined=pages.flatMap(p=>p.items.map(i=>i.str)).join(' ')
  const pending=combined.match(/Total Pending Transactions\s+(\(?\$?[\d,]+\.\d{2}\)?)/)
  if(pending)result.pendingActivity=numeric(pending[1])
  // Positional summaries are independent of the transaction ledger, never additional cash events.
  for(const page of pages){
    const items=page.items.filter(t=>t.str.trim())
    const summary=items.find(t=>t.str==='Positions - Summary')
    if(summary){const values=linesOf(items.filter(t=>t.y<summary.y&&t.y>summary.y-65)).find(l=>l.filter(t=>numeric(t.str)!=null).length>=8)?.filter(t=>numeric(t.str)!=null);if(values){result.summaryCostBasis=numeric(values[6].str);result.summaryUnrealized=numeric(values[7].str)}}
    const gains=items.find(t=>t.str==='Gain or (Loss) Summary')
    if(gains){const values=linesOf(items.filter(t=>t.x<gains.x+380&&t.y<gains.y&&t.y>gains.y-75)).find(l=>l.filter(t=>numeric(t.str)!=null).length===6)?.filter(t=>numeric(t.str)!=null);if(values?.length===6){result.realizedShortTerm=numeric(values[2].str);result.realizedLongTerm=numeric(values[5].str)}}
    const cash=items.find(t=>t.str==='Transactions - Summary')
    if(cash){const lines=linesOf(items.filter(t=>t.y<cash.y&&t.y>cash.y-95));const values=lines.find(l=>l.filter(t=>numeric(t.str)!=null).length>=8)?.filter(t=>numeric(t.str)!=null);if(values){result.cashBeginning=numeric(values[0].str);result.cashEnding=numeric(values[7].str)}}
    const margin=items.find(t=>t.str==='Margin Loan Information')
    if(margin){const lines=linesOf(items.filter(t=>t.y<margin.y&&t.y>margin.y-150));const rate=lines.find(l=>l.some(t=>/^\d+\.\d+%$/.test(t.str)));if(rate){const values=rate.filter(t=>numeric(t.str.replace('%',''))!=null);result.marginRate=numeric(values[0]?.str.replace('%','')??'');result.marginInterest=numeric(values[1]?.str??'')}const loans=lines.find(l=>l.filter(t=>numeric(t.str)!=null).length>=4);if(loans){result.marginLoanClosing=numeric(loans.filter(t=>numeric(t.str)!=null)[1].str)}}
  }
  if(closingEquity!=null && (result.cashEnding==null || Math.abs(result.holdings.reduce((sum,h)=>sum+h.marketValue,0)+(result.cashEnding??0)-closingEquity)>.05))result.issues.push('Holdings plus ending cash/debt do not reconcile to account equity. Snapshot held for review.')
  if(result.summaryCostBasis!=null && result.holdings.every(h=>h.costBasis!=null) && Math.abs(result.holdings.reduce((sum,h)=>sum+h.costBasis!,0)-result.summaryCostBasis)>.05)result.issues.push('Holding cost basis does not reconcile to the positions summary.')
  result.complete=result.holdings.length>0&&result.issues.length===0&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)
  return result
}
const symbolKey=(s:string)=>s.replace(/\s+/g,'').toUpperCase()
export function restoreStatementBasis(positions: Position[]): Position[] {
  return positions.map(p=>p.dataSource==='statement'&&p.basisBeforeStatement?{...p,avgCost:p.basisBeforeStatement.avgCost,dataSource:p.basisBeforeStatement.source,costBasisUnavailable:p.basisBeforeStatement.unavailable,costBasisStatement:undefined,basisBeforeStatement:undefined}:p)
}
export function applyStatementCostBasis(accounts: Account[], positions: Position[], history: HistoricalBalance[], csvAuthority: CsvPositionAuthority[] = []): Position[] {
  return restoreStatementBasis(positions).map(p=>{
    if(p.dataSource==='manual')return p
    const snapshots=history.filter(b=>b.statementSnapshot?.complete&&b.statementSnapshot.costBasisEnabled!==false&&statementAccount(b,accounts)?.id===p.accountId).sort((a,b)=>b.month.localeCompare(a.month))
    const latest=snapshots[0], h=latest?.statementSnapshot?.holdings.find(h=>symbolKey(h.symbol)===symbolKey(p.symbol))
    const mask=accounts.find(a=>a.id===p.accountId)?.mask
    if(latest && csvAuthority.some(c=>c.accountMask===mask&&symbolKey(c.position.symbol)===symbolKey(p.symbol)&&c.importedAt>(latest.statementSnapshot?.importedAt??latest.importedAt)))return p
    if(!h||h.costBasis==null||Math.abs(p.shares-h.quantity)>.000001)return p
    return {...p,basisBeforeStatement:{avgCost:p.avgCost,source:p.dataSource==='statement'?undefined:p.dataSource,unavailable:p.costBasisUnavailable},avgCost:h.costBasis/h.quantity,costBasisUnavailable:false,dataSource:'statement',costBasisStatement:{month:latest.month,fileName:latest.statementSnapshot?.sourceFile??latest.fileName,page:h.page,shares:h.quantity}}
  })
}

// Shared preferences must keep the snapshot, but never accept arbitrary extra PDF fields.
export function cleanStatementSnapshot(raw: unknown): StatementSnapshot | undefined {
  const s=raw as StatementSnapshot
  if(!s || !Array.isArray(s.holdings) || s.holdings.length>2000 || !Array.isArray(s.categoryTotals) || s.categoryTotals.length>30 || !Array.isArray(s.issues) || s.issues.length>1000)return undefined
  if(s.holdings.some(h=>!h || typeof h.symbol!=='string' || h.symbol.length>80 || typeof h.name!=='string' || h.name.length>500 || typeof h.category!=='string' || h.category.length>100 || ![h.quantity,h.price,h.marketValue,h.page].every(Number.isFinite) || h.quantity===0 || !Number.isInteger(h.page) || h.page<1 || [h.costBasis,h.unrealized,h.yieldPct,h.annualIncome].some(n=>n!=null&&!Number.isFinite(n))))return undefined
  if(s.categoryTotals.some(t=>!t||typeof t.category!=='string'||t.category.length>100||!Number.isFinite(t.marketValue)||(t.costBasis!=null&&!Number.isFinite(t.costBasis))))return undefined
  const holdings=s.holdings.map(h=>({symbol:h.symbol,name:h.name,category:h.category,quantity:h.quantity,price:h.price,marketValue:h.marketValue,page:h.page,...(h.costBasis!=null?{costBasis:h.costBasis}:{}),...(h.unrealized!=null?{unrealized:h.unrealized}:{}),...(h.yieldPct!=null?{yieldPct:h.yieldPct}:{}),...(h.annualIncome!=null?{annualIncome:h.annualIncome}:{}),...(h.option&&typeof h.option.underlying==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(h.option.expiration)&&Number.isFinite(h.option.strike)&&['Put','Call'].includes(h.option.type)?{option:{underlying:h.option.underlying.slice(0,30),expiration:h.option.expiration,strike:h.option.strike,type:h.option.type}}:{})}))
  const result: StatementSnapshot={...(typeof s.sourceFile==='string'?{sourceFile:s.sourceFile.slice(0,240)}:{}),...(typeof s.importedAt==='string'&&Number.isFinite(Date.parse(s.importedAt))?{importedAt:s.importedAt}:{}),holdings,categoryTotals:s.categoryTotals.map(t=>({category:t.category,marketValue:t.marketValue,...(t.costBasis!=null?{costBasis:t.costBasis}:{})})),complete:s.complete===true,costBasisEnabled:s.costBasisEnabled!==false,issues:s.issues.filter(i=>typeof i==='string').map(i=>i.slice(0,500))}
  const totalsValid=result.categoryTotals.length>0 && new Set(holdings.map(h=>h.symbol)).size===holdings.length && holdings.every(h=>result.categoryTotals.some(t=>t.category===h.category)) && result.categoryTotals.every(t=>Math.abs(holdings.filter(h=>h.category===t.category).reduce((sum,h)=>sum+h.marketValue,0)-t.marketValue)<.03)
  result.complete=result.complete&&holdings.length>0&&!result.issues.length&&totalsValid
  for(const k of ['summaryCostBasis','summaryUnrealized','cashBeginning','cashEnding','marginRate','marginInterest','marginLoanClosing','realizedShortTerm','realizedLongTerm','pendingActivity'] as const)if(Number.isFinite(s[k]))result[k]=s[k]
  return result
}
