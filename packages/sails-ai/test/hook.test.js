const { test } = require('node:test')
const assert = require('node:assert/strict')
const hook = require('..')
const { validateAdapter } = require('../adapter')
const path = require('node:path')
async function load(providers, provider) {
  const sails = {config:{appPath:path.resolve(__dirname,'..'), ai:{providers,provider}}, log:{info(){}, verbose(){}}, after(events, run){run()} }
  const instance = hook(sails)
  instance.configure()
  await new Promise((resolve,reject) => instance.initialize(error => error ? reject(error) : resolve()))
  return {sails,instance}
}
const adapterPath = path.resolve(__dirname,'../../yarngpt')
const receipt = {job_id:'id_1',status:'queued'}
test('speech-only provider loads lazily; aliases bind serialized receipts; wrong provider rejected', async () => {
  let calls=0
  const config = {adapter:adapterPath,apiKey:'test-only',fetch:async () => {calls++;return new Response(JSON.stringify(receipt))}}
  const {sails,instance} = await load({first:config,second:config},'first')
  assert.equal(calls,0)
  assert.equal(sails.ai.capabilities.chat,false)
  assert.throws(()=>sails.ai.chat('hello'),{code:'E_CAPABILITY_UNSUPPORTED'})
  assert.throws(()=>sails.ai.stream('hello'),{code:'E_CAPABILITY_UNSUPPORTED'})
  const job = await sails.ai.transcribe({audio:new Uint8Array([1]),mimeType:'audio/wav',idempotencyKey:'test'})
  assert.equal(job.provider,'first')
  const second = await sails.ai.use('second')
  assert.throws(()=>second.getJob(job),{code:'E_INVALID_INPUT'})
  const polled = await sails.ai.getJob(JSON.parse(JSON.stringify(job)))
  assert.equal(polled.provider,'first')
  assert.equal(calls,2)
  await new Promise(resolve=>instance.teardown(resolve))
})
test('adapter validation keeps existing chat contract and rejects empty or incomplete adapters', () => {
  assert.doesNotThrow(()=>validateAdapter({initialize(){},chat(){}},'chat'))
  assert.doesNotThrow(()=>validateAdapter({initialize(){},transcribe(){},getJob(){}},'speech'))
  assert.throws(()=>validateAdapter({initialize(){}},'empty'))
  assert.throws(()=>validateAdapter({initialize(){},transcribe(){}},'incomplete'))
})
test('unconfigured methods fail closed for speech as well as chat', async () => {
  const {sails} = await load({},'none')
  assert.throws(()=>sails.ai.transcribe({}),/No providers/)
})

test('existing hook normalizes chat/stream, lazy loads providers and tears down', async () => {
  const fixture=path.resolve(__dirname,'fixture.cjs')
  const Fixture=require(fixture);Fixture.closed=0
  const {sails,instance}=await load({one:{adapter:fixture},two:{adapter:fixture}},'one')
  assert.equal(sails.ai.capabilities.chat,true)
  assert.deepEqual(await sails.ai.chat({prompt:'hi',system:'be brief',model:'m',temperature:0.1}),{messages:[{role:'system',content:'be brief'},{role:'user',content:'hi'}],model:'m',temperature:0.1})
  const api=await sails.ai.use('two')
  const parts=[];for await(const part of api.stream('hello')) parts.push(part)
  assert.equal(parts[0].text,'hello')
  await assert.rejects(api.transcribe({}),{code:'E_CAPABILITY_UNSUPPORTED'})
  await new Promise((resolve,reject)=>instance.teardown(error=>error?reject(error):resolve()))
  assert.equal(Fixture.closed,2)
})
