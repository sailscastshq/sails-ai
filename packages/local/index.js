/**
 * @sails-ai/local
 *
 * Local AI adapter for sails-ai.
 * Runs models on your machine via Ollama (or any OpenAI-compatible local server).
 *
 * Configuration in config/ai.js:
 *   providers: {
 *     local: {
 *       adapter: '@sails-ai/local',
 *       baseUrl: 'http://localhost:11434',  // Ollama default
 *       model: 'qwen2.5:1.5b'              // Default model (optional)
 *     }
 *   }
 *
 * @docs https://github.com/sailscastshq/sails-ai
 */

class LocalAdapter {
  /**
   * Initialize the adapter.
   * Validates that Ollama is reachable (non-blocking — warns if not).
   */
  async initialize(config) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434'
    this.defaultModel = config.model || null
    this.defaultOptions = config.options || {}
    // Ollama top-level params — placed at request body root, not nested in options.
    // Override with [] if your local server doesn't support these.
    this.topLevelKeys = config.topLevelKeys || ['think', 'format', 'keep_alive', 'tools']
    this.log = config.log || console

    try {
      const res = await fetch(`${this.baseUrl}/api/tags`)
      if (!res.ok) {
        throw new Error(`Ollama returned ${res.status}`)
      }
      const data = await res.json()
      const modelNames = (data.models || []).map((m) => m.name)
      this.log.info(
        `@sails-ai/local: Connected to Ollama (${modelNames.length} model${modelNames.length !== 1 ? 's' : ''} available)`
      )
    } catch {
      this.log.warn(
        `@sails-ai/local: Could not reach Ollama at ${this.baseUrl}. ` +
          'Chat will fail until Ollama is running. Start it with: ollama serve'
      )
    }
  }

  /**
   * Helper: make a request to Ollama and handle common errors.
   */
  async _fetch(modelId, messages, stream, options = {}) {
    const body = { model: modelId, messages, stream }
    const ollamaOptions = {}

    for (const [key, value] of Object.entries(options)) {
      if (this.topLevelKeys.includes(key)) {
        body[key] = value
      } else {
        ollamaOptions[key] = value
      }
    }

    if (Object.keys(ollamaOptions).length > 0) {
      body.options = ollamaOptions
    }

    let res
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    } catch {
      const error = new Error(
        'Could not connect to Ollama. Is it running? Start it with: ollama serve'
      )
      error.code = 'E_PROVIDER_UNAVAILABLE'
      throw error
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 404 || body.includes('not found')) {
        const error = new Error(
          `Model '${modelId}' not found. Pull it with: ollama pull ${modelId}`
        )
        error.code = 'E_MODEL_NOT_FOUND'
        throw error
      }
      const error = new Error(
        `Ollama request failed (${res.status}): ${body.slice(0, 200)}`
      )
      error.code = 'E_PROVIDER_ERROR'
      throw error
    }

    return res
  }

  /**
   * Send a chat completion request (single response, no streaming).
   */
  async chat({ messages, model, ...options }) {
    const modelId = model || this.defaultModel || 'qwen2.5:1.5b'
    const res = await this._fetch(modelId, messages, false, { ...this.defaultOptions, ...options })
    const data = await res.json()

    return {
      role: 'assistant',
      content: data.message?.content || '',
      model: modelId
    }
  }

  /**
   * Stream a chat completion response token by token.
   * Ollama streams newline-delimited JSON objects.
   */
  async *stream({ messages, model, ...options }) {
    const modelId = model || this.defaultModel || 'qwen2.5:1.5b'
    const res = await this._fetch(modelId, messages, true, { ...this.defaultOptions, ...options })

    // Ollama streams newline-delimited JSON
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete lines
      const lines = buffer.split('\n')
      buffer = lines.pop() // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const chunk = JSON.parse(line)
          const text = chunk.message?.content || ''
          if (text) {
            yield { text, done: false }
          }
          if (chunk.done) {
            yield { text: '', done: true, model: modelId }
            return
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer)
        if (chunk.message?.content) {
          yield { text: chunk.message.content, done: false }
        }
      } catch {
        // Skip
      }
    }

    yield { text: '', done: true, model: modelId }
  }
}

module.exports = LocalAdapter
