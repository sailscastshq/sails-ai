---
name: configuration
description: Configuring providers, models, and defaults in sails-ai
metadata:
  tags: config, providers, multi-provider, environment, models
---

# Configuration

All AI configuration lives in `config/ai.js`.

## Multiple providers

Configure multiple providers and switch at runtime:

```js
module.exports.ai = {
  provider: 'local',  // default

  providers: {
    local: {
      adapter: '@sails-ai/local',
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    },
    cloudflare: {
      adapter: '@sails-ai/cloudflare',
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN
    }
  }
}
```

Switch providers in code:

```js
await sails.ai.chat('Hello')                       // uses default
await sails.ai.use('cloudflare').chat('Hello')     // uses cloudflare
```

## Environment-based switching

Use Ollama locally and a cloud provider in production:

```js
module.exports.ai = {
  provider: process.env.AI_PROVIDER || 'local',
  // ...
}
```

```sh
# .env (production)
AI_PROVIDER=cloudflare
```

## Application-level config

Add custom keys for your app (sails-ai ignores them):

```js
module.exports.ai = {
  provider: 'local',
  providers: { /* ... */ },

  // Your app's model tier mapping
  models: {
    light: 'qwen2.5:1.5b',
    standard: 'qwen2.5:7b',
    flagship: 'qwen2.5:32b'
  },

  // Your app's system prompt
  systemPrompt: 'You are a helpful assistant.'
}
```

Access via `sails.config.ai.models`, `sails.config.ai.systemPrompt`, etc.

## Provider config reference

### `@sails-ai/local` (Ollama)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `adapter` | string | — | Must be `'@sails-ai/local'` |
| `baseUrl` | string | `'http://localhost:11434'` | Ollama server URL |
| `model` | string | `null` | Default model for this provider |
