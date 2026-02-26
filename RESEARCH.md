# Sails AI - Research & Architecture

## Vision

Give any Sails app the ability to let users **talk to their data** in plain English. Deploy a small language model (SLM) locally on your backend - users chat, the AI understands your app's models, and queries the database. **$0 cost** since it runs on your server.

Example in Hagfish:
```
User: "What is the total invoice I have for this month that is pending?"
AI: Understands `Invoice` model, builds query, returns: "You have 3 pending invoices totaling $4,250.00 this month."
```

---

## Package Structure

```
sails-ai/
├── packages/
│   ├── sails-ai/          # Core Sails hook (@sails-ai/core)
│   └── local/             # Local SLM adapter (@sails-ai/local)
├── package.json           # NPM workspace root
└── RESEARCH.md
```

Future adapters:
- `@sails-ai/anthropic`
- `@sails-ai/openai`

---

## Multi-Provider Architecture

Just like Sails datastores - one default, multiple available.

### config/ai.js

```javascript
module.exports.ai = {
  // Default provider
  provider: 'local',

  // All configured providers
  providers: {
    local: {
      adapter: '@sails-ai/local',

      // Option 1: Model name only (auto-download & cache)
      model: 'phi-3-mini',

      // Option 2: Model name + custom path
      // model: 'phi-3-mini',
      // path: './ai-models/phi-3-mini-q4.gguf',

      // Option 3: Custom model (path only)
      // path: './ai-models/my-fine-tuned.gguf',
    },

    claude: {
      adapter: '@sails-ai/anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-sonnet-4-20250514'
    },

    openai: {
      adapter: '@sails-ai/openai',
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-mini'
    }
  },

  // Which models the AI can query
  models: ['invoice', 'user', 'payment'], // or '*' for all

  // Security
  policies: ['isLoggedIn'],
};
```

### Usage API

```javascript
// Use default provider
await sails.ai.chat({ message: 'Show pending invoices' });

// Use specific provider
await sails.ai.use('claude').chat({ message: 'Explain this code...' });
await sails.ai.use('local').chat({ message: 'How many users today?' });

// Streaming
const stream = await sails.ai.use('local').stream({ message: '...' });
for await (const chunk of stream) {
  process.stdout.write(chunk.text);
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Sails App                            │
├─────────────────────────────────────────────────────────────┤
│  config/ai.js                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ provider: 'local'                                     │  │
│  │ providers: { local: {...}, claude: {...} }            │  │
│  └───────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  sails-ai hook (@sails-ai/core)                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ • Extracts model schemas from ORM                     │  │
│  │ • Loads & manages multiple adapters                   │  │
│  │ • Exposes sails.ai.chat() & sails.ai.use()            │  │
│  │ • WebSocket endpoints for real-time chat              │  │
│  │ • Query validation & execution                        │  │
│  └───────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  Adapters                                                   │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ @sails-ai/local │  │ @sails-ai/anthropic │               │
│  │ (SLM on device) │  │ (Claude API)    │                   │
│  └─────────────────┘  └─────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

---

## The Local Adapter Deep Dive

### How Model Loading Works

```javascript
// @sails-ai/local internals

const MODELS = {
  'phi-3-mini': {
    repo: 'microsoft/Phi-3-mini-4k-instruct-gguf',
    file: 'Phi-3-mini-4k-instruct-q4.gguf',
    size: '2.2GB',
    ram: '3GB'
  },
  'llama-3.2-1b': {
    repo: 'huggingface/llama-3.2-1b-instruct-gguf',
    file: 'llama-3.2-1b-instruct-q4.gguf',
    size: '0.7GB',
    ram: '1GB'
  },
  'qwen2.5-0.5b': {
    repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
    file: 'qwen2.5-0.5b-instruct-q4.gguf',
    size: '0.4GB',
    ram: '0.5GB'
  }
};
```

### Model Resolution Strategy

```javascript
async function resolveModel(config) {
  // 1. Custom path provided - use directly
  if (config.path && !config.model) {
    return { path: config.path, type: 'custom' };
  }

  // 2. Model name + custom path - validate & use
  if (config.model && config.path) {
    if (!await fileExists(config.path)) {
      throw new Error(`Model file not found: ${config.path}`);
    }
    return { path: config.path, model: config.model, type: 'custom' };
  }

  // 3. Model name only - check cache or download
  if (config.model) {
    const modelInfo = MODELS[config.model];
    if (!modelInfo) {
      throw new Error(`Unknown model: ${config.model}. Available: ${Object.keys(MODELS).join(', ')}`);
    }

    const cachePath = path.join(getCacheDir(), modelInfo.file);

    if (await fileExists(cachePath)) {
      return { path: cachePath, model: config.model, type: 'cached' };
    }

    // Download required
    return {
      path: cachePath,
      model: config.model,
      type: 'download',
      repo: modelInfo.repo,
      file: modelInfo.file,
      size: modelInfo.size
    };
  }

  throw new Error('Either `model` or `path` must be specified');
}
```

### Cache Directory

```javascript
function getCacheDir() {
  // ~/.sails-ai/models/
  return path.join(os.homedir(), '.sails-ai', 'models');
}
```

### Download Flow

On first `sails lift` with a new model:

```
┌─────────────────────────────────────────────────────────┐
│  sails lift                                              │
├─────────────────────────────────────────────────────────┤
│  Initializing sails-ai hook...                          │
│                                                          │
│  ⚠ Model 'phi-3-mini' not found in cache                │
│                                                          │
│  Downloading phi-3-mini (2.2GB)...                      │
│  ████████████████████░░░░░░░░░░░░░░░░░░░░ 52% 1.1GB     │
│                                                          │
│  ✓ Model cached at ~/.sails-ai/models/phi-3-mini.gguf   │
│  ✓ sails-ai hook loaded (using: local)                  │
└─────────────────────────────────────────────────────────┘
```

### CLI for Model Management

```bash
# Pre-download model
npx sails-ai download phi-3-mini

# List cached models
npx sails-ai models

# Clear cache
npx sails-ai cache clear

# Model info
npx sails-ai info phi-3-mini
```

---

## Runtime: node-llama-cpp

Using [node-llama-cpp](https://github.com/withcatai/node-llama-cpp) for inference.

```javascript
// @sails-ai/local internals

import { getLlama, LlamaChatSession } from 'node-llama-cpp';

class LocalAdapter {
  async initialize(config) {
    const resolved = await resolveModel(config);

    if (resolved.type === 'download') {
      await this.downloadModel(resolved);
    }

    this.llama = await getLlama();
    this.model = await this.llama.loadModel({ modelPath: resolved.path });
    this.context = await this.model.createContext();
  }

  async chat({ message, schemas, history }) {
    const session = new LlamaChatSession({
      contextSequence: this.context.getSequence(),
      systemPrompt: this.buildSystemPrompt(schemas)
    });

    // Replay history
    for (const msg of history || []) {
      if (msg.role === 'user') {
        await session.prompt(msg.content, { maxTokens: 0 }); // Don't generate
      }
    }

    // Generate response
    const response = await session.prompt(message);

    return this.parseResponse(response, schemas);
  }

  async *stream({ message, schemas, history }) {
    const session = new LlamaChatSession({
      contextSequence: this.context.getSequence(),
      systemPrompt: this.buildSystemPrompt(schemas)
    });

    for await (const chunk of session.promptWithMeta(message)) {
      yield { text: chunk.text, done: false };
    }
    yield { text: '', done: true };
  }
}
```

---

## System Prompt Generation

The AI needs to understand the app's data model:

```javascript
buildSystemPrompt(schemas) {
  let prompt = `You are an AI assistant for a web application.
You help users query their data using natural language.

Available data models:

`;

  for (const [name, schema] of Object.entries(schemas)) {
    prompt += `MODEL: ${name}\n`;
    prompt += `Primary Key: ${schema.primaryKey}\n`;
    prompt += `Attributes:\n`;

    for (const [attr, def] of Object.entries(schema.attributes)) {
      let type = def.type || 'ref';
      if (def.model) type = `belongs to ${def.model}`;
      if (def.collection) type = `has many ${def.collection}`;
      if (def.isIn) type += ` (${def.isIn.join(', ')})`;

      prompt += `  - ${attr}: ${type}\n`;
    }
    prompt += '\n';
  }

  prompt += `
When the user asks a data question, respond with JSON:
{
  "type": "query",
  "model": "modelName",
  "action": "find|findOne|count|sum|avg",
  "criteria": { "where": {...}, "limit": N, "sort": {...} },
  "aggregate": { "field": "amount", "fn": "sum" }
}

For general questions, respond with:
{
  "type": "response",
  "text": "Your answer here"
}
`;

  return prompt;
}
```

---

## Hook Implementation

### packages/sails-ai/index.js

```javascript
module.exports = function sailsAiHook(sails) {
  let adapters = {};
  let schemas = {};

  return {
    defaults: {
      ai: {
        provider: 'local',
        providers: {},
        models: '*',
        policies: []
      }
    },

    configure() {
      // Validate config
      if (!sails.config.ai.providers[sails.config.ai.provider]) {
        throw new Error(`Default AI provider '${sails.config.ai.provider}' not configured`);
      }
    },

    initialize(cb) {
      // Wait for ORM
      if (!sails.hooks.orm) {
        return cb(new Error('sails-ai requires the ORM hook'));
      }

      sails.after('hook:orm:loaded', async () => {
        try {
          // Extract schemas
          schemas = this.extractSchemas();

          // Load all adapters
          await this.loadAdapters();

          // Expose API
          sails.ai = {
            chat: (opts) => this.chat(sails.config.ai.provider, opts),
            stream: (opts) => this.stream(sails.config.ai.provider, opts),
            use: (provider) => ({
              chat: (opts) => this.chat(provider, opts),
              stream: (opts) => this.stream(provider, opts)
            }),
            schemas
          };

          cb();
        } catch (err) {
          cb(err);
        }
      });
    },

    extractSchemas() {
      const result = {};
      const allowedModels = sails.config.ai.models;

      for (const [identity, Model] of Object.entries(sails.models)) {
        if (allowedModels !== '*' && !allowedModels.includes(identity)) {
          continue;
        }

        result[identity] = {
          identity,
          primaryKey: Model.primaryKey,
          attributes: Model.attributes,
          associations: Model.associations,
          tableName: Model.tableName
        };
      }

      return result;
    },

    async loadAdapters() {
      for (const [name, config] of Object.entries(sails.config.ai.providers)) {
        const AdapterPkg = require(config.adapter);
        const adapter = new AdapterPkg(config);

        await adapter.initialize({ ...config, schemas });
        adapters[name] = adapter;

        sails.log.verbose(`sails-ai: Loaded provider '${name}' (${config.adapter})`);
      }
    },

    async chat(providerName, opts) {
      const adapter = adapters[providerName];
      if (!adapter) {
        throw new Error(`AI provider '${providerName}' not loaded`);
      }

      const response = await adapter.chat({
        ...opts,
        schemas
      });

      // If response contains a query, execute it
      if (response.type === 'query') {
        response.data = await this.executeQuery(response);
      }

      return response;
    },

    async *stream(providerName, opts) {
      const adapter = adapters[providerName];
      if (!adapter) {
        throw new Error(`AI provider '${providerName}' not loaded`);
      }

      yield* adapter.stream({ ...opts, schemas });
    },

    async executeQuery(query) {
      const Model = sails.models[query.model];
      if (!Model) {
        throw new Error(`Model '${query.model}' not found`);
      }

      switch (query.action) {
        case 'find':
          return Model.find(query.criteria);
        case 'findOne':
          return Model.findOne(query.criteria);
        case 'count':
          return Model.count(query.criteria?.where);
        case 'sum':
          return Model.sum(query.aggregate.field, query.criteria);
        case 'avg':
          return Model.avg(query.aggregate.field, query.criteria);
        default:
          throw new Error(`Unknown query action: ${query.action}`);
      }
    },

    routes: {
      before: {
        'POST /ai/chat': async function(req, res) {
          try {
            const { message, provider, stream } = req.body;
            const useProvider = provider || sails.config.ai.provider;

            if (stream && req.isSocket) {
              for await (const chunk of sails.ai.use(useProvider).stream({ message })) {
                sails.sockets.broadcast(req.socket.id, 'ai:chunk', chunk);
              }
              return res.ok({ done: true });
            }

            const result = await sails.ai.use(useProvider).chat({ message });
            return res.json(result);
          } catch (err) {
            return res.serverError(err);
          }
        }
      }
    }
  };
};
```

---

## Adapter Interface

Every adapter must implement:

```javascript
class Adapter {
  constructor(config) {
    this.config = config;
  }

  // Called once on sails lift
  async initialize({ schemas, ...config }) {
    throw new Error('Not implemented');
  }

  // Single response
  async chat({ message, schemas, history, context }) {
    // Returns: { type: 'query'|'response', ... }
    throw new Error('Not implemented');
  }

  // Streaming response
  async *stream({ message, schemas, history, context }) {
    // Yields: { text, done }
    throw new Error('Not implemented');
  }

  // Cleanup on sails lower
  async teardown() {}
}
```

---

## WebSocket Chat Flow

```
┌──────────┐                    ┌──────────┐                    ┌──────────┐
│  Client  │                    │  Sails   │                    │  Local   │
│  (Chat)  │                    │  Hook    │                    │  SLM     │
└────┬─────┘                    └────┬─────┘                    └────┬─────┘
     │                               │                               │
     │  io.socket.post('/ai/chat')   │                               │
     │  { message, stream: true }    │                               │
     │──────────────────────────────>│                               │
     │                               │                               │
     │                               │  adapter.stream({ message })  │
     │                               │──────────────────────────────>│
     │                               │                               │
     │                               │  yield { text: 'You', done }  │
     │   sails.sockets.broadcast     │<──────────────────────────────│
     │   'ai:chunk' { text: 'You' }  │                               │
     │<──────────────────────────────│                               │
     │                               │                               │
     │                               │  yield { text: ' have', done }│
     │   'ai:chunk' { text: ' have'} │<──────────────────────────────│
     │<──────────────────────────────│                               │
     │                               │                               │
     │              ...              │              ...              │
     │                               │                               │
     │                               │  yield { done: true }         │
     │   'ai:chunk' { done: true }   │<──────────────────────────────│
     │<──────────────────────────────│                               │
     │                               │                               │
```

---

## Local SLM Options

| Model | Size | RAM | Speed | Quality | Best For |
|-------|------|-----|-------|---------|----------|
| Qwen2.5-0.5B | 400MB | 0.5GB | ⚡⚡⚡ | ★★☆ | Low-resource servers |
| Llama-3.2-1B | 700MB | 1GB | ⚡⚡⚡ | ★★★ | Good balance |
| Phi-3-mini | 2.2GB | 3GB | ⚡⚡ | ★★★★ | Best quality |
| Gemma-2-2B | 1.5GB | 2GB | ⚡⚡ | ★★★★ | Good alternative |

Recommendation: Default to **Llama-3.2-1B** for balance, offer **Phi-3-mini** for quality.

---

## Security

### Query Validation

```javascript
async executeQuery(query, req) {
  // 1. Validate model is allowed
  if (!schemas[query.model]) {
    throw new Error('Model not accessible');
  }

  // 2. Sanitize criteria (no $where, etc.)
  const safeCriteria = sanitizeCriteria(query.criteria);

  // 3. Apply row-level security
  if (sails.config.ai.authorize) {
    await sails.config.ai.authorize(req, query);
  }

  // 4. Execute
  return Model[query.action](safeCriteria);
}
```

### Row-Level Security Example

```javascript
// config/ai.js
module.exports.ai = {
  authorize: async (req, query) => {
    // Users can only see their own invoices
    if (query.model === 'invoice') {
      query.criteria.where = query.criteria.where || {};
      query.criteria.where.userId = req.session.userId;
    }
  }
};
```

---

## Implementation Phases

### Phase 1: Core Hook Structure
- [ ] Hook skeleton with lifecycle
- [ ] Multi-provider configuration
- [ ] Model schema extraction
- [ ] `sails.ai.use().chat()` API

### Phase 2: Local Adapter
- [ ] node-llama-cpp integration
- [ ] Model resolution (name/path/download)
- [ ] Model caching in ~/.sails-ai/
- [ ] System prompt generation
- [ ] Structured output parsing

### Phase 3: Query Execution
- [ ] Parse AI response to Waterline query
- [ ] Query validation & sanitization
- [ ] Execute and format results

### Phase 4: WebSocket Chat
- [ ] Socket.io streaming endpoint
- [ ] Conversation history
- [ ] Client-side example

### Phase 5: CLI & DX
- [ ] `npx sails-ai download <model>`
- [ ] `npx sails-ai models`
- [ ] First-run download experience

### Phase 6: Security & Production
- [ ] Query sanitization
- [ ] Row-level security hooks
- [ ] Rate limiting
- [ ] Audit logging

---

## Open Questions

1. **Download UX** - Block sails lift until model downloads, or lazy-load on first chat?
2. **Quantization** - Default Q4 (smaller, faster) or Q8 (better quality)?
3. **Context** - How much conversation history? Token limit?
4. **Concurrency** - One model instance shared, or pool?
5. **GPU** - Support GPU acceleration if available?

---

## References

- [Sails Blueprints Hook](https://github.com/balderdashy/sails/tree/master/lib/hooks/blueprints)
- [node-llama-cpp](https://github.com/withcatai/node-llama-cpp)
- [Phi-3](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf)
- [Llama 3.2](https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct)
- [Qwen 2.5](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF)
