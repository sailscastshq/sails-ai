---
name: adapters
description: Building custom sails-ai adapters for any AI provider
metadata:
  tags: adapter, custom, provider, extend, interface
---

# Building Adapters

Each adapter is a separate npm package that extends the base `Adapter` class.

## Adapter interface

```js
const { Adapter } = require('sails-ai')

class MyAdapter extends Adapter {
  async initialize(config) { }        // Required — setup, validate credentials
  async chat({ messages, model }) { } // Required — return { role, content, model }
  async *stream({ messages, model }) { } // Optional — yield { text, done }
  async teardown() { }                // Optional — cleanup on sails.lower()
}

module.exports = MyAdapter
```

## Package setup

```json
{
  "name": "@sails-ai/my-provider",
  "version": "0.0.1",
  "main": "index.js",
  "peerDependencies": {
    "sails-ai": ">=0.0.1"
  }
}
```

**Important:** Use `peerDependencies` for `sails-ai` so the adapter resolves the same `Adapter` class as the hook. This ensures `instanceof` checks work.

## Minimal example

```js
const { Adapter } = require('sails-ai')

class MyAdapter extends Adapter {
  async initialize(config) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl || 'https://api.provider.com'
    this.defaultModel = config.model || 'default'
  }

  async chat({ messages, model }) {
    const modelId = model || this.defaultModel
    const res = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ model: modelId, messages })
    })
    const data = await res.json()
    return {
      role: 'assistant',
      content: data.choices[0].message.content,
      model: modelId
    }
  }

  async *stream({ messages, model }) {
    const modelId = model || this.defaultModel
    const res = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ model: modelId, messages, stream: true })
    })

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      yield { text: decoder.decode(value, { stream: true }), done: false }
    }
    yield { text: '', done: true, model: modelId }
  }
}

module.exports = MyAdapter
```

## Error codes

Throw errors with a `code` property:

| Code | When |
|------|------|
| `E_PROVIDER_UNAVAILABLE` | Can't connect (network, server down) |
| `E_MODEL_NOT_FOUND` | Model doesn't exist on the provider |
| `E_PROVIDER_ERROR` | Provider returned an error |
| `E_AUTH_FAILED` | Invalid credentials |

```js
const error = new Error('Could not connect')
error.code = 'E_PROVIDER_UNAVAILABLE'
throw error
```

## Usage in config/ai.js

```js
module.exports.ai = {
  provider: 'my-provider',
  providers: {
    'my-provider': {
      adapter: '@sails-ai/my-provider',
      apiKey: process.env.MY_API_KEY
    }
  }
}
```

The config object is passed to `initialize()` — add any provider-specific options you need.
