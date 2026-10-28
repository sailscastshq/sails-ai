const { test } = require('node:test')
const assert = require('node:assert/strict')
const Adapter = require('..')
const queued = { job_id: 'job_123', status: 'queued', credits_reserved: 2 }
async function setup(responses = [queued]) {
  const calls = []
  const adapter = new Adapter()
  await adapter.initialize({ apiKey: 'test-only-not-a-real-key', timeoutMs: 30, fetch: async (url, options) => {
    calls.push({ url, ...options })
    const next = responses.shift()
    if (next instanceof Error) throw next
    if (typeof next === 'function') return next(options)
    return new Response(JSON.stringify(next), { status: next?.httpStatus || 200 })
  } })
  return { adapter, calls }
}
const upload = { audio: new Uint8Array([1,2,3]), mimeType: 'audio/ogg', filename: 'note.ogg', idempotencyKey: 'request-1' }
test('ASR multipart returns durable receipt, one GET per explicit poll and settled usage', async () => {
  const { adapter, calls } = await setup([queued, { job_id: 'job_123', status: 'processing' }, { job_id: 'job_123', status: 'completed', transcript: '', credits_charged: 1 }])
  const receipt = await adapter.transcribe({ ...upload, targetLanguage: 'en' })
  assert.equal(calls[0].url, 'https://api.yarngpt.ai/api/v1/asr')
  assert.equal(calls[0].headers['Idempotency-Key'], 'request-1')
  assert.equal(calls[0].redirect, 'error')
  assert.equal(calls[0].body.get('target_language'), 'en')
  assert.equal(calls[0].body.get('file').name, 'note.ogg')
  assert.equal(calls[0].headers['Content-Type'], undefined)
  assert.deepEqual(receipt.usage, { creditsReserved: 2, creditsCharged: null })
  assert.equal(receipt.operation, 'transcribe')
  assert.equal(receipt.provider, 'yarngpt')
  const processing = await adapter.getJob(JSON.parse(JSON.stringify(receipt)))
  assert.equal(processing.status, 'processing')
  assert.equal(calls.length, 2)
  const completed = await adapter.getJob(processing)
  assert.equal(completed.result.text, '')
  assert.equal(completed.usage.creditsCharged, 1)
  assert.equal(completed.usage.creditsReserved, 2)
  assert.equal(calls[1].url, 'https://api.yarngpt.ai/api/v1/asr/job_123')
})
test('TTS uses distinct status endpoint and never downloads signed output', async () => {
  const { adapter, calls } = await setup([queued, { status: 'completed', audio_url: 'https://example.invalid/signed-audio', credits_charged: 3 }])
  const receipt = await adapter.synthesize({ text: 'Hello', outputFormat: 'wav', targetLanguage: 'yo', idempotencyKey: 'tts-1' })
  assert.deepEqual(JSON.parse(calls[0].body), { text: 'Hello', output_format: 'wav', target_language: 'yo' })
  const complete = await adapter.getJob(receipt)
  assert.equal(calls[1].url, 'https://api.yarngpt.ai/api/v1/status/job_123')
  assert.equal(complete.result.audioUrl, 'https://example.invalid/signed-audio')
  assert.equal(calls.length, 2)
})
test('failed job is a terminal normalized result, translation failure preserves transcript', async () => {
  const { adapter } = await setup([queued, { status: 'failed', error_code: 'ASR_FAILED', error_message: 'Try clearer audio.' }, { status: 'completed', transcript: 'text', translation_status: 'failed' }])
  const receipt = await adapter.transcribe(upload)
  const failed = await adapter.getJob(receipt)
  assert.equal(failed.error.code, 'ASR_FAILED')
  assert.equal(failed.error.message, 'Try clearer audio.')
  assert.equal((await adapter.getJob(receipt)).result.text, 'text')
})
test('rejects source language hints and invalid inputs before transport', async () => {
  const { adapter, calls } = await setup()
  for (const input of [{...upload, language:'ha'}, {...upload, sourceLanguage:'ha'}, {...upload, idempotencyKey:'a:b'}, {...upload, audio:new Uint8Array()}, {...upload, filename:'../secret'}, {...upload, mimeType:'text/plain'}]) {
    await assert.rejects(adapter.transcribe(input), { code: 'E_INVALID_INPUT' })
  }
  await assert.rejects(adapter.synthesize({text:'x', outputFormat:'opus', idempotencyKey:'k'}), {code:'E_INVALID_INPUT'})
  await assert.rejects(adapter.getJob({id:'../../secret', operation:'transcribe', adapter:'yarngpt'}), {code:'E_INVALID_INPUT'})
  await assert.rejects(adapter.getJob({id:'job', operation:'chat', adapter:'yarngpt'}), {code:'E_INVALID_INPUT'})
  assert.equal(calls.length, 0)
})
test('network timeout has unknown outcome and stable receipt, never implicitly resubmits', async () => {
  const { adapter, calls } = await setup([new Error('private network details')])
  await assert.rejects(adapter.transcribe(upload), error => {
    assert.equal(error.code, 'E_SUBMISSION_UNKNOWN')
    assert.equal(error.outcomeUnknown, true)
    assert.equal(error.receipt.idempotencyKey, 'request-1')
    assert.equal(error.message.includes('private'), false)
    return true
  })
  assert.equal(calls.length, 1)
})
test('abort before transmission is safe; abort during POST is uncertain', async () => {
  const { adapter, calls } = await setup([options => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('abort'))))])
  const controller = new AbortController(); controller.abort()
  await assert.rejects(adapter.transcribe({...upload, signal:controller.signal}), {code:'E_ABORTED'})
  assert.equal(calls.length, 0)
  await assert.rejects(adapter.transcribe(upload), {code:'E_SUBMISSION_UNKNOWN', outcomeUnknown:true})
  assert.equal(calls.length, 1)
})
test('HTTP auth/quota/rate-limit errors normalize without leaking body or automatic retries', async () => {
  for (const [httpStatus, code] of [[401,'E_AUTH_FAILED'],[402,'E_QUOTA_EXCEEDED'],[429,'E_RATE_LIMITED'],[500,'E_SUBMISSION_UNKNOWN']]) {
    const { adapter, calls } = await setup([{httpStatus, error:{code:'EXAMPLE', message:'secret upstream body'}}])
    await assert.rejects(adapter.transcribe(upload), error => error.code === code && !error.message.includes('secret'))
    assert.equal(calls.length, 1)
  }
})
test('malformed accepted response preserves valid job ID for recovery; poll mismatch rejected', async () => {
  const {adapter} = await setup([{job_id:'known_job', status:'unexpected'}, {job_id:'other_job', status:'processing'}])
  await assert.rejects(adapter.transcribe(upload), error => error.code === 'E_SUBMISSION_UNKNOWN' && error.receipt.id === 'known_job')
  await assert.rejects(adapter.getJob({...queued, id:'known_job', provider:'yarngpt', adapter:'yarngpt', operation:'transcribe'}), {code:'E_PROVIDER_RESPONSE'})
})
test('invalid JSON and unknown/id-conflict responses never cause a second POST', async () => {
  for (const response of [() => new Response('not-json'), {httpStatus:409,error:{code:'ALREADY_EXISTS'}}]) {
    const {adapter,calls} = await setup([response])
    await assert.rejects(adapter.transcribe(upload), {code:'E_SUBMISSION_UNKNOWN'})
    assert.equal(calls.length,1)
  }
})

test('translated transcript field, zero settlement, warnings and malformed usage are handled', async () => {
 const {adapter} = await setup([queued, {status:'completed',transcript:'original',translated_transcript:'',translation_status:'completed',credits_charged:0,warnings:[{code:'ADVICE'}]}, {status:'completed',transcript:'text',credits_charged:-1}])
 const receipt=await adapter.transcribe(upload)
 const complete=await adapter.getJob(receipt)
 assert.equal(complete.result.translation,'')
 assert.equal(complete.usage.creditsCharged,0)
 assert.equal(complete.warnings[0].code,'ADVICE')
 await assert.rejects(adapter.getJob(receipt),{code:'E_PROVIDER_RESPONSE'})
})
