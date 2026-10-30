import { strict as assert } from 'node:assert'
import { installChunkRecovery, attemptChunkReload, isChunkLoadError } from '../src/lib/chunk-recovery'
const values=new Map<string,string>()
const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}}
const target=new EventTarget()
let reloads=0,now=100000
const environment={storage:()=>storage,now:()=>now,reload:()=>{reloads++}}
const remove=installChunkRecovery(target,environment)
const event=new Event('vite:preloadError',{cancelable:true})
assert.equal(target.dispatchEvent(event),true,'a failed dynamic import must remain rejected, never resolve undefined')
assert.equal(event.defaultPrevented,false)
assert.equal(reloads,1)
const repeated=new Event('vite:preloadError',{cancelable:true})
target.dispatchEvent(repeated)
assert.equal(repeated.defaultPrevented,false,'cooldown must not swallow the error React needs')
assert.equal(reloads,1,'recovery must not loop during the cooldown')
now+=30001
assert.equal(attemptChunkReload(environment),true)
assert.equal(reloads,2)
remove()
now+=30001
target.dispatchEvent(new Event('vite:preloadError',{cancelable:true}))
assert.equal(reloads,2)
assert.equal(attemptChunkReload({...environment,storage:()=>{throw new Error('storage disabled')}}),false)
assert.equal(reloads,2,'unavailable session storage must not trigger unbounded reloads')
assert.equal(isChunkLoadError('Failed to fetch dynamically imported module: /assets/Positions-old.js'),true)
assert.equal(isChunkLoadError("can't access property \"default\", e._result is undefined"),true)
assert.equal(isChunkLoadError('Cannot read properties of undefined (reading \'default\')'),true)
assert.equal(isChunkLoadError('A portfolio calculation failed'),false)
console.log('Chunk recovery preserves import rejection, bounds reloads, tolerates blocked storage and recognizes legacy lazy-import failures')

void (async()=>{
  const target=new EventTarget()
  installChunkRecovery(target,environment)
  const original=new Error('Failed to fetch dynamically imported module: /assets/old-page.js')
  // Vite's generated dynamic-import handler dispatches a cancelable event and
  // only rethrows when it was not canceled. React.lazy requires the rejection.
  const imported=Promise.reject(original).catch(error=>{
    const event=new Event('vite:preloadError',{cancelable:true})
    target.dispatchEvent(event)
    if(!event.defaultPrevented) throw error
  })
  await assert.rejects(imported,error=>error===original,'the original import failure must reach the route error boundary')
})()
