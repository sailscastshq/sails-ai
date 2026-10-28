const {test} = require('node:test')
const assert = require('node:assert/strict')
const Adapter = require('..')
test('existing OpenAI chat and streaming serialization and error handling remain unchanged', async () => {
 const adapter = new Adapter()
 await adapter.initialize({apiKey:'test-only-not-real',model:'model',maxRetries:0,log:{info(){}}})
 const calls=[]
 adapter.client = {chat:{completions:{create:async input => {
   calls.push(input)
   if (input.stream) return (async function*(){yield {choices:[{delta:{content:'part'}}]};yield {choices:[{delta:{},finish_reason:'stop'}]}})()
   return {choices:[{message:{content:'reply'}}]}
 }}}}
 const messages=[{role:'user',content:'hello'}]
 assert.deepEqual(await adapter.chat({messages,temperature:0.2}),{role:'assistant',content:'reply',model:'model'})
 const parts=[];for await (const part of adapter.stream({messages})) parts.push(part)
 assert.deepEqual(parts,[{text:'part',done:false},{text:'',done:true,model:'model'}])
 assert.deepEqual(calls[0],{model:'model',messages,temperature:0.2})
 assert.equal(calls[1].stream,true)
 adapter.client.chat.completions.create=async()=>{throw {status:404}}
 await assert.rejects(adapter.chat({messages}),{code:'E_MODEL_NOT_FOUND'})
})
