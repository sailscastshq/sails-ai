const {test} = require('node:test')
const assert = require('node:assert/strict')
const Adapter = require('..')
test('existing local initialize/chat/stream options and model errors remain unchanged', async () => {
 const original=globalThis.fetch; const calls=[]
 globalThis.fetch=async(url, options)=>{
   calls.push({url,options})
   if (url.endsWith('/api/tags')) return new Response(JSON.stringify({models:[]}))
   const input=JSON.parse(options.body)
   if (input.model==='missing') return new Response('not found',{status:404})
   if (input.stream) return new Response(JSON.stringify({message:{content:'part'},done:false})+'\n'+JSON.stringify({done:true})+'\n')
   return new Response(JSON.stringify({message:{content:'reply'}}))
 }
 try {
   const adapter=new Adapter();await adapter.initialize({model:'local-model',log:{info(){},warn(){}}})
   const messages=[{role:'user',content:'hello'}]
   assert.equal((await adapter.chat({messages,think:false,temperature:0.1})).content,'reply')
   assert.equal(JSON.parse(calls[1].options.body).think,false)
   assert.deepEqual(JSON.parse(calls[1].options.body).options,{temperature:0.1})
   const parts=[];for await(const part of adapter.stream({messages})) parts.push(part)
   assert.equal(parts[0].text,'part');assert.equal(parts.at(-1).done,true)
   await assert.rejects(adapter.chat({messages,model:'missing'}),{code:'E_MODEL_NOT_FOUND'})
 } finally {globalThis.fetch=original}
})
