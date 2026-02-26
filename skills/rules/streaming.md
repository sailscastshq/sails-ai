---
name: streaming
description: Streaming AI responses token-by-token with async generators and WebSocket integration
metadata:
  tags: stream, async generator, websocket, realtime, chunks
---

# Streaming

`sails.ai.stream()` returns an async generator that yields chunks as they arrive.

## Basic usage

```js
const stream = sails.ai.stream('Tell me a story')

let fullText = ''
for await (const chunk of stream) {
  if (chunk.text) {
    fullText += chunk.text
  }
  if (chunk.done) {
    console.log('Done. Model:', chunk.model)
  }
}
```

Accepts the same input formats as `chat()` — string, `{ prompt, system, model }`, or `{ messages, system, model }`.

## Chunk shape

```js
{ text: 'Once', done: false }
{ text: ' upon', done: false }
{ text: '', done: true, model: 'qwen2.5:1.5b' }
```

## Streaming over WebSocket (Sails sockets)

The most common pattern — stream AI responses to the browser in real time:

```js
// api/controllers/chat/send-message.js
fn: async function ({ content, conversationId }) {
  const stream = sails.ai.stream({
    messages,
    system: sails.config.ai.systemPrompt,
    model: modelId
  })

  let fullContent = ''
  for await (const chunk of stream) {
    if (chunk.text) {
      fullContent += chunk.text
      if (this.req.isSocket) {
        sails.sockets.broadcast(
          sails.sockets.getId(this.req),
          'ai:chunk',
          { text: chunk.text, conversationId }
        )
      }
    }
  }

  // Persist the full response
  await Message.create({
    role: 'assistant',
    content: fullContent,
    conversation: conversationId
  })

  return { content: fullContent }
}
```

### Client-side (Vue + useSailsSocket)

```js
const { get, post } = useSailsSocket()

// Listen for chunks
io.socket.on('ai:chunk', ({ text, conversationId }) => {
  // Append text to the current message
  currentMessage.value += text
})

// Send message via socket
const response = await post('/chat/send', { content: userInput, conversationId })
```

## Error handling

Wrap the entire loop — errors can throw before or during streaming:

```js
try {
  for await (const chunk of sails.ai.stream('Hello')) {
    // process chunks
  }
} catch (err) {
  if (err.code === 'E_PROVIDER_UNAVAILABLE') {
    // Handle provider down
  }
}
```
