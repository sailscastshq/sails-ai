/**
 * sails-ai hook
 *
 * Multi-provider AI integration for Sails.js.
 * Exposes `sails.ai.chat()`, `sails.ai.stream()`, and `sails.ai.use(provider)`.
 *
 * Usage:
 *   // Simple string prompt
 *   const reply = await sails.ai.chat('Hello')
 *
 *   // With options
 *   const reply = await sails.ai.chat({ prompt: 'Hello', system: '...', model: 'gpt-4' })
 *
 *   // Full conversation
 *   const reply = await sails.ai.chat({ messages: [...], model: 'gpt-4' })
 *
 *   // Streaming
 *   for await (const chunk of sails.ai.stream('Tell me a story')) { ... }
 *
 *   // Provider switch
 *   const reply = await sails.ai.use('cloudflare').chat('Hello')
 *
 * Adapters implement the interface (duck typing — no extends required):
 *   - initialize(config)
 *   - chat({ messages, model })
 *   - stream({ messages, model })  [optional]
 *   - teardown()                   [optional]
 *
 * @docs https://github.com/sailscastshq/sails-ai
 */

const { validateAdapter } = require('./adapter')

/**
 * Normalize flexible input into { messages, model } for adapters.
 *
 * Accepts:
 *   - String: 'Hello' → [{ role: 'user', content: 'Hello' }]
 *   - Object with prompt: { prompt, system?, model? }
 *   - Object with messages: { messages, model? }
 */
function normalizeInput(input) {
  // String shorthand: sails.ai.chat('Hello')
  if (typeof input === 'string') {
    return { messages: [{ role: 'user', content: input }], model: undefined }
  }

  const { prompt, system, messages, model, ...options } = input

  // Build messages array
  let normalizedMessages

  if (messages) {
    // Full conversation — use as-is
    normalizedMessages = [...messages]
  } else if (prompt) {
    // Single prompt
    normalizedMessages = [{ role: 'user', content: prompt }]
  } else {
    throw new Error(
      'sails.ai: Provide a string, { prompt }, or { messages } to chat/stream.'
    )
  }

  // Prepend system prompt if provided
  if (system) {
    normalizedMessages.unshift({ role: 'system', content: system })
  }

  return { messages: normalizedMessages, model, ...options }
}

function sailsAiHook(sails) {
  const adapters = {}

  function getAdapter(providerName) {
    const adapter = adapters[providerName]
    if (!adapter) {
      throw new Error(
        `sails-ai: Provider '${providerName}' not loaded. ` +
          `Available: ${Object.keys(adapters).join(', ')}`
      )
    }
    return adapter
  }

  /**
   * Build the public API for a given adapter.
   * Handles input normalization so adapters always receive { messages, model }.
   */
  function buildApi(adapter) {
    return {
      chat: (input) => adapter.chat(normalizeInput(input)),
      stream: (input) => {
        if (typeof adapter.stream !== 'function') {
          throw new Error(
            'sails-ai: This provider does not support streaming. Use chat() instead.'
          )
        }
        return adapter.stream(normalizeInput(input))
      }
    }
  }

  return {
    defaults: {
      ai: {
        provider: 'local',
        providers: {}
      }
    },

    configure() {
      const config = sails.config.ai
      if (
        Object.keys(config.providers).length > 0 &&
        !config.providers[config.provider]
      ) {
        throw new Error(
          `sails-ai: Default provider '${config.provider}' is not configured in config/ai.js providers`
        )
      }
    },

    initialize(cb) {
      // If no providers configured, skip initialization
      if (Object.keys(sails.config.ai.providers).length === 0) {
        sails.log.verbose('sails-ai: No providers configured, skipping')
        const notConfigured = () => {
          throw new Error('sails-ai: No providers configured')
        }
        sails.ai = {
          chat: notConfigured,
          stream: notConfigured,
          use: notConfigured
        }
        return cb()
      }

      sails.after(['hook:orm:loaded'], async () => {
        try {
          // Load and initialize all configured adapters
          for (const [name, config] of Object.entries(
            sails.config.ai.providers
          )) {
            // Resolve from the app's node_modules (not the hook's)
            const appRequire = require('module').createRequire(
              require('path').join(sails.config.appPath, 'package.json')
            )
            const AdapterImpl = appRequire(config.adapter)
            const adapterConfig = { ...config, log: sails.log }
            const adapter = new AdapterImpl(adapterConfig)

            // Validate the adapter implements the required interface (duck typing)
            validateAdapter(adapter, name)

            await adapter.initialize(adapterConfig)
            adapters[name] = adapter
            sails.log.info(`sails-ai: Loaded provider '${name}'`)
          }

          // Expose the sails.ai API
          const defaultProvider = sails.config.ai.provider
          const defaultApi = buildApi(getAdapter(defaultProvider))

          sails.ai = {
            chat: defaultApi.chat,
            stream: defaultApi.stream,
            use: (providerName) => buildApi(getAdapter(providerName))
          }

          cb()
        } catch (err) {
          cb(err)
        }
      })
    },

    teardown(cb) {
      const teardowns = Object.values(adapters).map((a) =>
        typeof a.teardown === 'function' ? a.teardown() : Promise.resolve()
      )
      Promise.all(teardowns)
        .then(() => cb())
        .catch(cb)
    }
  }
}

// Export the hook function as the main export (Sails convention)
module.exports = sailsAiHook
