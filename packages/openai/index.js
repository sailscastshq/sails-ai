/**
 * @sails-ai/openai
 *
 * OpenAI-compatible adapter for sails-ai.
 * Works with any provider that follows the OpenAI chat completions API:
 * OpenAI, Together AI, Groq, Fireworks, OpenRouter, Mistral, etc.
 *
 * Configuration in config/ai.js:
 *   providers: {
 *     together: {
 *       adapter: '@sails-ai/openai',
 *       apiKey: process.env.TOGETHER_API_KEY,
 *       baseURL: 'https://api.together.xyz/v1'
 *     }
 *   }
 *
 * @docs https://github.com/sailscastshq/sails-ai
 */

const OpenAI = require('openai')

class OpenAIAdapter {
  /**
   * Initialize the adapter.
   * Creates the OpenAI client with the configured baseURL and API key.
   */
  async initialize(config) {
    this.defaultModel = config.model || null
    this.maxRetries = config.maxRetries ?? 3
    this.log = config.log || console

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || undefined,
      maxRetries: 0 // We handle retries ourselves for better control
    })

    // Identify the provider for logging
    const provider = config.baseURL
      ? new URL(config.baseURL).hostname.replace('api.', '').replace('.com', '').replace('.xyz', '')
      : 'openai'

    if (!config.apiKey) {
      this.log.warn(
        `@sails-ai/openai: No API key configured for ${provider}. Chat will fail until one is set.`
      )
      return
    }

    this.log.info(`@sails-ai/openai: Connected to ${provider}`)
  }

  /**
   * Check if an error is transient and worth retrying.
   */
  _isRetryable(err) {
    if (err.status === 503 || err.status === 502 || err.status === 429) return true
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return true
    return false
  }

  /**
   * Sleep for ms milliseconds.
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Send a chat completion request (single response, no streaming).
   */
  async chat({ messages, model, ...options }) {
    const modelId = model || this.defaultModel
    if (!modelId) {
      const error = new Error(
        'No model specified. Pass a model in the request or set a default in config.'
      )
      error.code = 'E_PROVIDER_ERROR'
      throw error
    }

    let lastErr
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: modelId,
          messages,
          ...options
        })

        return {
          role: 'assistant',
          content: response.choices[0].message.content || '',
          model: modelId
        }
      } catch (err) {
        lastErr = err
        if (attempt < this.maxRetries && this._isRetryable(err)) {
          const wait = Math.min(1000 * 2 ** attempt, 8000)
          this.log.warn(`@sails-ai/openai: ${err.status || err.code} — retrying in ${wait}ms (${attempt + 1}/${this.maxRetries})`)
          await this._sleep(wait)
          continue
        }
        throw this._normalizeError(err, modelId)
      }
    }
    throw this._normalizeError(lastErr, modelId)
  }

  /**
   * Stream a chat completion response token by token.
   * Uses the OpenAI SDK's built-in streaming support.
   */
  async *stream({ messages, model, ...options }) {
    const modelId = model || this.defaultModel
    if (!modelId) {
      const error = new Error(
        'No model specified. Pass a model in the request or set a default in config.'
      )
      error.code = 'E_PROVIDER_ERROR'
      throw error
    }

    let lastErr
    let stream
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        stream = await this.client.chat.completions.create({
          model: modelId,
          messages,
          stream: true,
          ...options
        })
        break
      } catch (err) {
        lastErr = err
        if (attempt < this.maxRetries && this._isRetryable(err)) {
          const wait = Math.min(1000 * 2 ** attempt, 8000)
          this.log.warn(`@sails-ai/openai: ${err.status || err.code} — retrying in ${wait}ms (${attempt + 1}/${this.maxRetries})`)
          await this._sleep(wait)
          continue
        }
        throw this._normalizeError(err, modelId)
      }
    }

    if (!stream) throw this._normalizeError(lastErr, modelId)

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || ''
      const finishReason = chunk.choices[0]?.finish_reason

      if (text) {
        yield { text, done: false }
      }

      if (finishReason) {
        yield { text: '', done: true, model: modelId }
        return
      }
    }

    yield { text: '', done: true, model: modelId }
  }

  /**
   * Normalize OpenAI SDK errors into sails-ai error codes.
   */
  _normalizeError(err, modelId) {
    if (err.status === 401 || err.code === 'invalid_api_key') {
      const error = new Error('Invalid API key. Check your provider credentials.')
      error.code = 'E_PROVIDER_UNAVAILABLE'
      return error
    }

    if (err.status === 404) {
      const error = new Error(`Model '${modelId}' not found on this provider.`)
      error.code = 'E_MODEL_NOT_FOUND'
      return error
    }

    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      const error = new Error(`Could not connect to AI provider: ${err.message}`)
      error.code = 'E_PROVIDER_UNAVAILABLE'
      return error
    }

    const error = new Error(`AI provider error (${err.status || 'unknown'}): ${err.message}`)
    error.code = 'E_PROVIDER_ERROR'
    return error
  }
}

module.exports = OpenAIAdapter
