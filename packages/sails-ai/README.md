# Sails AI 0.0.3

Multi-provider Sails hook for chat, streaming and asynchronous speech. Configure providers in config/ai.js; select one with `await sails.ai.use(name)`.

```sh
npm install sails-ai@0.0.3 @sails-ai/yarngpt@0.0.1
```

```js
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
  audio: audioBytes,
  mimeType: 'audio/ogg',
  filename: 'note.ogg',
  idempotencyKey: uploadRequestId
})
await saveJob(receipt) // your application-owned durable storage
// Later, one bounded poll from your scheduled worker:
const current = await voice.getJob(savedReceipt)
await saveJob(current)
if (current.status === 'completed') useTranscript(current.result.text)
```

The persistence and transcript helpers above belong to your application. Receipts identify provider and operation; save them before scheduling a poll. Unknown POST outcomes must retain their original input/idempotency key for recovery. No automatic POST retry or polling loop is performed. Inspect provider.capabilities before selecting an operation. A speech adapter does not implement LLM chat unless it explicitly supplies that capability.

Existing OpenAI/local chat and stream adapters continue unchanged. The default provider is also accessible through sails.ai.chat/stream/transcribe/synthesize/getJob, according to its capabilities. New adapters use duck typing: initialize plus supported operations, no inheritance or dummy chat implementation. Speech submission adapters must implement getJob.

See https://github.com/sailscastshq/sails-ai for chat configuration and full adapter documentation. Hosted provider calls may incur charges. Language quality, input permission, output provenance and training rights require application-specific validation; package installation does not establish them.
