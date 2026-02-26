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
    this.log = config.log || console

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || undefined
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
      throw this._normalizeError(err, modelId)
    }
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

    let stream
    try {
      stream = await this.client.chat.completions.create({
        model: modelId,
        messages,
        stream: true,
        ...options
      })
    } catch (err) {
      throw this._normalizeError(err, modelId)
    }

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
