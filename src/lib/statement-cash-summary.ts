import type { PdfTextPage } from './statement-transactions'
export const statementNumber = (text: string): number | undefined => {
  const cleaned=text.replace(/[$,\s⁺†‡]/g,'')
  if(!/^\(?-?\d+(?:\.\d+)?\)?$/.test(cleaned))return undefined
  const n=Number(cleaned.replace(/[()]/g,''))*(cleaned.startsWith('(')?-1:1)
  return Number.isFinite(n)?n:undefined
}
export function statementCashSummary(pages: PdfTextPage[]) {
  for(const page of pages){
    const items=page.items.filter(t=>t.str.trim()), title=items.find(t=>t.str==='Transactions - Summary')
    if(!title)continue
    const numbers=items.filter(t=>t.y<title.y&&t.y>title.y-95&&statementNumber(t.str)!=null).sort((a,b)=>b.y-a.y||a.x-b.x)
    for(const anchor of numbers){
      const line=numbers.filter(t=>Math.abs(t.y-anchor.y)<1.5).sort((a,b)=>a.x-b.x)
      if(line.length!==8)continue
      const values=line.map(t=>statementNumber(t.str)!)
      if(Math.abs(values.slice(0,7).reduce((s,n)=>s+n,0)-values[7])>.02)continue
      const otherLabel=items.find(t=>t.str==='Other Activity'&&t.y<title.y&&t.y>title.y-120)
      const other=otherLabel?items.find(t=>t.x>otherLabel.x+otherLabel.width&&Math.abs(t.y-otherLabel.y)<1.5&&statementNumber(t.str)!=null):undefined
      return {beginning:values[0],ending:values[7],activity:values.slice(1,7),other:other?statementNumber(other.str):undefined}
    }
  }
}
