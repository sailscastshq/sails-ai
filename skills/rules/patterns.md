---
name: patterns
description: Common patterns for sails-ai — credits, conversations, error handling, model tiers
metadata:
  tags: patterns, credits, conversations, error handling, model tiers
---

# Common Patterns

## Model tier mapping

Map application-level model names to provider-specific identifiers:

```js
// config/ai.js
module.exports.ai = {
  provider: 'local',
  providers: { /* ... */ },

  models: {
    light: 'qwen2.5:1.5b',
    standard: 'qwen2.5:7b',
    flagship: 'qwen2.5:32b'
  },

  credit: {
    costs: {
      light: 1,
      standard: 3,
      flagship: 5
    }
  }
}
```

Use in actions:

```js
const modelId = sails.config.ai.models[tier]  // e.g. 'qwen2.5:7b'
const cost = sails.config.ai.credit.costs[tier]  // e.g. 3
```

## Credits system

Check and deduct credits before each AI call:

```js
fn: async function ({ content, model }) {
  const userId = this.req.session.userId
  const creditCost = sails.config.ai.credit.costs[model]
  const user = await User.findOne({ id: userId })

  if (user.credits < creditCost) {
    throw { insufficientCredits: {
      message: `Need ${creditCost} credits, have ${user.credits}`,
      remaining: user.credits,
      required: creditCost
    }}
  }

  // ... call AI ...

  await User.updateOne({ id: userId }).set({
    credits: user.credits - creditCost
  })
}
```

## Conversation persistence

Store messages in the database for context:

```js
// Save user message
await Message.create({ role: 'user', content, conversation: conversationId })

// Load full history
const dbMessages = await Message.find({ conversation: conversationId }).sort('createdAt ASC')
const messages = dbMessages.map(m => ({ role: m.role, content: m.content }))

// Send to AI with history
const reply = await sails.ai.chat({
  messages,
  system: sails.config.ai.systemPrompt,
  model: modelId
})

// Save AI response
await Message.create({
  role: 'assistant',
  content: reply.content,
  model: modelId,
  creditCost,
  conversation: conversationId
})
```

## System prompt pattern

Keep the system prompt in config, pass via the `system` option:

```js
const reply = await sails.ai.chat({
  messages: conversationHistory,
  system: sails.config.ai.systemPrompt,
  model: modelId
})
```

The hook prepends the system message to the messages array automatically.

## Error handling in controllers

```js
try {
  const stream = sails.ai.stream({ messages, system, model: modelId })
  for await (const chunk of stream) {
    // process chunk
  }
} catch (err) {
  if (err.code === 'E_PROVIDER_UNAVAILABLE' || err.code === 'E_MODEL_NOT_FOUND') {
    throw { modelUnavailable: { message: err.message } }
  }
  throw err
}
```

Define the exit in your action:

```js
exits: {
  modelUnavailable: {
    statusCode: 503,
    description: 'AI provider is not reachable.'
  }
}
```
