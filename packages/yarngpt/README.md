# @sails-ai/yarngpt

Asynchronous speech adapter for hosted YarnGPT.ai. New package version: **0.0.1**. Requires sails-ai **0.0.3** or compatible. Contracts are mock-tested; real-audio quality has not been evaluated. No account, credits or training rights are included.

```sh
npm install sails-ai@0.0.3 @sails-ai/yarngpt@0.0.1
```

```js
// config/ai.js — keep your existing chat provider as the default if needed.
module.exports.ai = {
  provider: 'voice',
  providers: {
    voice: {
      adapter: '@sails-ai/yarngpt',
      apiKey: process.env.YARNGPT_API_KEY
    }
  }
}
```

```js
const voice = await sails.ai.use('voice')
const receipt = await voice.transcribe({
  audio: audioBytes, // Uint8Array or Buffer, validated by your application
  mimeType: 'audio/ogg',
  filename: 'note.ogg',
  idempotencyKey: uploadRequestId // persist before sending; reuse only for identical input
})
await jobs.save(receipt) // application-owned durable storage, not a Sails AI method

// In a scheduled worker: one bounded GET per invocation, no busy polling.
const current = await voice.getJob(await jobs.load(jobId))
await jobs.save(current)
if (current.status === 'completed') {
  console.log(current.result.text) // empty text is valid for silence
}
```

`jobs` above is pseudocode for your own durable persistence. Poll with a bounded caller-owned schedule, initially about one second and backing off to five; set an overall deadline/cancellation policy. Each HTTP request has a configurable 30-second timeout (maximum 120 seconds). `getJob(receipt, { signal })` performs one GET only. Save the complete receipt: provider alias, adapter identity, operation, job id, idempotency key and usage. Using a receipt with a different configured provider is rejected. Provider alias/configuration must remain stable for persisted jobs.

`transcribe` accepts bytes, mimeType, filename, idempotencyKey, optional targetLanguage and signal. targetLanguage translates the result; it does not hint the spoken language. Source-language hints are rejected. Check the provider's current language catalogue and evaluate real samples before promising a language. Applications own duration/content validation, permissions and any stricter limits; the adapter's 64 MiB limit is not permission to accept arbitrary files.

`synthesize({ text, voice?, outputFormat: 'mp3' | 'wav', targetLanguage?, idempotencyKey, signal? })` returns the same receipt contract. Voice IDs are dynamic; omitted voice uses the provider default. Completed synthesis returns result.audioUrl. The adapter never follows or downloads signed output URLs. Treat them as private expiring data; refresh by polling, and validate destinations separately before any server-side fetch.

Receipts have status queued/processing/completed/failed, result (text/translation or audioUrl), error and warnings. usage.creditsReserved is an estimate; usage.creditsCharged is settlement. Missing usage remains null, never inferred as zero. Credits are not a currency or an application billing price. Failed jobs may still require accounting reconciliation.

No POST is automatically retried. E_SUBMISSION_UNKNOWN carries receipt and outcomeUnknown:true: persist it, do not release a spend reservation as if no charge happened, and do not invent a new key. If an id is available, poll it. Otherwise an explicitly authorized retry must use the exact original payload and original key. The caller must store the original input fingerprint and enforce key-to-payload binding. The adapter does not keep cross-process idempotency state. HTTP errors expose normalized code/status and providerCode; 429 also exposes retryAfter. Never log credentials, raw audio or signed URLs.

`capabilities` on a provider API reports supported methods; unsupported operations throw E_CAPABILITY_UNSUPPORTED. This adapter implements transcribe/synthesize/getJob, not LLM chat, chat streaming, live ASR or streaming TTS. Existing chat providers continue to work unchanged.

Provider output and provider access do not imply permission to train a model, redistribute data or run a commercial pilot. Keep input permission and output provenance in application records. A future @sails-ai/tembo adapter can implement the same contract without changing callers; none is fabricated here.

Mock verification only: `npm test` at repository root. Official reference: https://yarngpt.ai/api-docs . Every real hosted request spends credits; this package has no live test or sandbox call.
