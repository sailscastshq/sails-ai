# sails-ai

AI integration hook for Sails.js — multi-provider chat completions with streaming support.

Use the same API to chat with OpenAI, Together AI, Groq, Ollama, and any OpenAI-compatible provider. Switch providers without changing your application code.

## Installation

```sh
npm install sails-ai @sails-ai/openai
```

For local development with [Ollama](https://ollama.com):

```sh
npm install sails-ai @sails-ai/local
```

## Quick start

Create `config/ai.js`:

```js
module.exports.ai = {
  provider: 'openai',
  providers: {
    openai: {
      adapter: '@sails-ai/openai',
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4'
    }
  }
}
```

Use it anywhere in your Sails app:

```js
const reply = await sails.ai.chat('What is the capital of France?')
// => { role: 'assistant', content: 'The capital of France is Paris.', model: 'gpt-4' }
```

## Configuration

### Single provider

```js
// config/ai.js
module.exports.ai = {
  provider: 'openai',
  providers: {
    openai: {
      adapter: '@sails-ai/openai',
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4'
    }
  }
}
```

### Multiple providers

```js
// config/ai.js
module.exports.ai = {
  provider: 'openai', // default provider
  providers: {
    openai: {
      adapter: '@sails-ai/openai',
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4'
    },
    together: {
      adapter: '@sails-ai/openai',
      apiKey: process.env.TOGETHER_API_KEY,
      baseURL: 'https://api.together.xyz/v1',
      model: 'meta-llama/Llama-3-70b-chat-hf'
    },
    local: {
      adapter: '@sails-ai/local',
      baseUrl: 'http://localhost:11434',
      model: 'qwen2.5:1.5b'
    }
  }
}
```

### Environment-based switching

```js
// config/ai.js
module.exports.ai = {
  provider: process.env.AI_PROVIDER || 'local',
  providers: {
    local: {
      adapter: '@sails-ai/local',
      baseUrl: process.env.OLLAMA_URL || 'http://localhost:11434'
    },
    openai: {
      adapter: '@sails-ai/openai',
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4'
    }
  }
}
```

## Usage

### Chat

```js
// String shorthand
const reply = await sails.ai.chat('Hello')

// Prompt with system message and model override
const reply = await sails.ai.chat({
  prompt: 'Explain recursion',
  system: 'You are a helpful programming tutor.',
  model: 'gpt-4',
  temperature: 0.7
})

// Full conversation
const reply = await sails.ai.chat({
  messages: [
    { role: 'user', content: 'What is Node.js?' },
    { role: 'assistant', content: 'Node.js is a JavaScript runtime...' },
    { role: 'user', content: 'How does its event loop work?' }
  ],
  system: 'You are a backend engineering expert.',
  model: 'gpt-4'
})
```

The response is always:

```js
{ role: 'assistant', content: '...', model: 'gpt-4' }
```

### Streaming

```js
for await (const chunk of sails.ai.stream('Tell me a story')) {
  if (chunk.text) {
    process.stdout.write(chunk.text)
  }
  if (chunk.done) {
    console.log(`\nModel: ${chunk.model}`)
  }
}
```

Each chunk is either `{ text: '...', done: false }` or `{ text: '', done: true, model: '...' }`.

### Switching providers

```js
// Uses the default provider
const reply = await sails.ai.chat('Hello')

// Use a specific provider
const reply = await sails.ai.use('together').chat('Hello')

// Stream from a specific provider
for await (const chunk of sails.ai.use('local').stream('Hello')) {
  process.stdout.write(chunk.text)
}
```

## Adapters

### @sails-ai/openai

Works with any provider that follows the OpenAI chat completions API.

```sh
npm install @sails-ai/openai
```

| Option | Description |
|--------|-------------|
| `adapter` | Must be `'@sails-ai/openai'` |
| `apiKey` | API key for the provider |
| `baseURL` | API base URL (optional — defaults to OpenAI) |
| `model` | Default model (optional) |

**Compatible providers:**

| Provider | `baseURL` |
|----------|-----------|
| OpenAI | _(default)_ |
| Together AI | `https://api.together.xyz/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Fireworks | `https://api.fireworks.ai/inference/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Mistral | `https://api.mistral.ai/v1` |

### @sails-ai/local

Runs models locally via [Ollama](https://ollama.com).

```sh
npm install @sails-ai/local
```

| Option | Description |
|--------|-------------|
| `adapter` | Must be `'@sails-ai/local'` |
| `baseUrl` | Ollama URL (default: `http://localhost:11434`) |
| `model` | Default model (default: `qwen2.5:1.5b`) |

**Getting started with Ollama:**

```sh
brew install ollama    # macOS
ollama serve           # Start the server
ollama pull qwen2.5:1.5b  # Pull a model
```

## Error handling

All adapters throw errors with standardized codes:

```js
try {
  const reply = await sails.ai.chat('Hello')
} catch (err) {
  switch (err.code) {
    case 'E_PROVIDER_UNAVAILABLE':
      // Can't connect or invalid credentials
      break
    case 'E_MODEL_NOT_FOUND':
      // Model doesn't exist on the provider
      break
    case 'E_PROVIDER_ERROR':
      // General provider error
      break
  }
}
```

## Writing a custom adapter

Create a class that implements `initialize()` and `chat()`. Streaming and teardown are optional.

```js
class MyAdapter {
  async initialize(config) {
    // Setup — called once on Sails lift
  }

  async chat({ messages, model }) {
    // Send messages, return { role: 'assistant', content: '...', model }
  }

  async *stream({ messages, model }) {
    // Yield { text: '...', done: false } chunks
    // Yield { text: '', done: true, model } when done
  }

  async teardown() {
    // Cleanup — called on Sails lower (optional)
  }
}

module.exports = MyAdapter
```

Publish it as an npm package and reference it in `config/ai.js`:

```js
providers: {
  custom: {
    adapter: 'my-sails-ai-adapter',
    // ... your config
  }
}
```

## API reference

### `sails.ai.chat(input)`

Send a message and get a response.

- **input** — `string`, `{ prompt, system?, model?, ...options }`, or `{ messages, system?, model?, ...options }`
- **returns** — `Promise<{ role: 'assistant', content: string, model: string }>`

### `sails.ai.stream(input)`

Stream a response token by token.

- **input** — same as `chat()`
- **returns** — `AsyncGenerator<{ text: string, done: boolean, model?: string }>`

### `sails.ai.use(providerName)`

Get the API for a specific provider.

- **returns** — `{ chat, stream }`

## Packages

| Package | Description |
|---------|-------------|
| `sails-ai` | Core hook — input normalization, adapter lifecycle, `sails.ai` API |
| `@sails-ai/openai` | OpenAI-compatible adapter (OpenAI, Together, Groq, Fireworks, etc.) |
| `@sails-ai/local` | Local adapter for Ollama |

## Requirements

- Node.js >= 18
- Sails.js >= 1.0

## License

MIT - [The Sailscasts Company](https://github.com/sailscastshq)
