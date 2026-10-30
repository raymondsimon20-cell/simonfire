import { strict as assert } from 'node:assert'
import handler from '../netlify/functions/schwab-order'
void (async () => {
  process.env.APP_URL='https://example.test'
  const response=await handler(new Request('https://example.test/.netlify/functions/schwab-order',{method:'POST',headers:{origin:'https://example.test','x-simonfire-order-request':'1','content-type':'application/json'},body:JSON.stringify({action:'place',accountId:'synthetic',order:{orderLegCollection:[{instrument:{assetType:'OPTION'}}]}})}))
  assert.equal(response.status,403)
  assert.equal((await response.json()).error,'hedge_advisory_only')
  console.log('Option placement blocked before token access, preview lookup or broker submission')
})()
