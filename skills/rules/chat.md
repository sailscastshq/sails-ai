---
name: chat
description: Chat completions with sails-ai — string, prompt, and conversation inputs
metadata:
  tags: chat, completion, messages, prompt, system
---

# Chat

`sails.ai.chat()` sends a message and returns the complete response.

## Input formats

### String shorthand

```js
const reply = await sails.ai.chat('What is the capital of Nigeria?')
```

### Prompt with options

```js
const reply = await sails.ai.chat({
  prompt: 'Translate "good morning" to Yoruba',
  system: 'You are a language tutor.',
  model: 'qwen2.5:7b'
})
```

### Full conversation (multi-turn)

```js
const reply = await sails.ai.chat({
  messages: [
    { role: 'user', content: 'What is jollof rice?' },
    { role: 'assistant', content: 'Jollof rice is...' },
    { role: 'user', content: 'How do I make it?' }
  ],
  system: 'You are a cooking expert.',
  model: 'qwen2.5:7b'
})
```

The `system` prompt is automatically prepended to the messages array — don't include it in `messages`.

## Response shape

```js
{
  role: 'assistant',
  content: 'The capital of Nigeria is Abuja...',
  model: 'qwen2.5:1.5b'
}
```

## Common patterns

### Persist conversation history

```js
// Load history from DB
const dbMessages = await Message.find({ conversation: conversationId }).sort('createdAt ASC')
const messages = dbMessages.map(m => ({ role: m.role, content: m.content }))

// Send to AI
const reply = await sails.ai.chat({ messages, system: 'You are helpful.', model: 'qwen2.5:1.5b' })

// Persist response
await Message.create({ role: reply.role, content: reply.content, conversation: conversationId })
```

### Error handling

```js
try {
  const reply = await sails.ai.chat('Hello')
} catch (err) {
  if (err.code === 'E_PROVIDER_UNAVAILABLE') {
    // Ollama not running, cloud provider down, etc.
  }
  if (err.code === 'E_MODEL_NOT_FOUND') {
    // Model not installed — run: ollama pull <model>
  }
}
```
