---
name: getting-started
description: Installing and setting up sails-ai with a provider adapter
metadata:
  tags: install, setup, ollama, local, config
---

# Getting Started with Sails AI

## Installation

Install the core hook and a provider adapter:

```bash
npm i sails-ai @sails-ai/local
```

`@sails-ai/local` connects to Ollama for local development (free, runs on your machine).

## Configuration

Create `config/ai.js`:

```js
module.exports.ai = {
  provider: 'local',

  providers: {
    local: {
      adapter: '@sails-ai/local',
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    }
  }
}
```

## First chat

Once Sails lifts, use `sails.ai` in any action or helper:

```js
// Simple string
const reply = await sails.ai.chat('Hello')
console.log(reply.content)

// With options
const reply = await sails.ai.chat({
  prompt: 'Tell me a story',
  system: 'You are a storyteller.',
  model: 'qwen2.5:7b'
})

// Streaming
for await (const chunk of sails.ai.stream('Tell me a story')) {
  process.stdout.write(chunk.text)
}
```

## Ollama setup

If using the local adapter:

```bash
brew install ollama    # macOS
ollama serve           # start server (port 11434)
ollama pull qwen2.5:1.5b  # pull a model
```

## Project structure

```
config/
  ai.js              ← provider config
node_modules/
  sails-ai/          ← the hook (auto-loaded by Sails)
  @sails-ai/local/   ← Ollama adapter
```

The hook auto-loads on `sails.lift()` and exposes `sails.ai.chat()`, `sails.ai.stream()`, and `sails.ai.use()`.
