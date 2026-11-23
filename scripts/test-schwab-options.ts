import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

async function main() {
  const held = 'QQQ270115P00400000'
  let reference: Record<string,unknown> = {}
  let quoteTime: number | null = 1790000001000
  let returnedSymbol = held
  const output = { exports: {} as any }
  const source = ts.transpileModule(readFileSync('netlify/functions/schwab-options.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  runInNewContext(source, {exports:output.exports, require:()=>({accessToken:async()=> 'test',MARKET_BASE:'https://example.test',json:(body:unknown,status=200)=>new Response(JSON.stringify(body),{status})}),Response,URL,URLSearchParams,Date,
    fetch:async(url:string)=>new Response(JSON.stringify(url.includes('/chains?') ? {putExpDateMap:{'2027-01-15:53':{'400':[{symbol:'CHAIN',bid:null,ask:'',mark:false,last:0,gamma:0.02,vega:0.4,multiplier:100,quoteTimeInLong:1790000000000}]}}} : {[held]:{symbol:returnedSymbol,quote:{bidPrice:null,askPrice:2,gamma:0.03,vega:0.5,quoteTime},reference}}))})
  const get = async()=> (await (await output.exports.default(new Request(`https://local.test?symbol=QQQ&includeSymbol=${held}`))).json()).contracts
  let contracts = await get()
  const chain = contracts.find((q:any)=>q.symbol==='CHAIN')
  assert.equal(chain.bid,null,'null is unknown, not zero')
  assert.equal(chain.ask,null)
  assert.equal(chain.mark,null)
  assert.equal(chain.last,0)
  assert.equal(chain.gamma,0.02)
  assert.equal(chain.vega,0.4)
  assert.equal(chain.quoteTime,1790000000000)
  let exact = contracts.find((q:any)=>q.symbol===held)
  assert.equal(exact.multiplier,null,'no fabricated standard multiplier')
  assert.equal(exact.gamma,0.03)
  assert.equal(exact.vega,0.5)
  assert.equal(exact.quoteTime,1790000001000)
  reference={multiplier:10}
  contracts=await get()
  exact=contracts.find((q:any)=>q.symbol===held)
  assert.equal(exact.multiplier,10,'explicit adjusted multiplier retained')
  reference={multiplier:0}
  assert.equal((await get()).find((q:any)=>q.symbol===held).multiplier,null)
  quoteTime=null
  assert.equal((await get()).find((q:any)=>q.symbol===held).quoteTime,null,'missing quote time must not become zero or fetch time')
  returnedSymbol='WRONG'
  const mismatch=await output.exports.default(new Request(`https://local.test?symbol=QQQ&includeSymbol=${held}`))
  assert.equal(mismatch.status,500,'mismatched broker quote must not supply contract evidence')
  console.log('Schwab options: unknown numbers, Greeks, broker multipliers and quote timestamps passed')
}
main().catch(error=>{console.error(error);process.exitCode=1})
