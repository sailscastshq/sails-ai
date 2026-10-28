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
 *   // Provider switch (lazy-loaded on first use)
 *   const cloudflare = await sails.ai.use('cloudflare')
 *   const reply = await cloudflare.chat('Hello')
 *
 * Adapters implement the interface (duck typing — no extends required):
 *   - initialize(config)
 *   - chat({ messages, model }) or transcribe/synthesize plus getJob
 *   - stream({ messages, model })  [optional]
 *   - teardown()                   [optional]
 *
 * @docs https://github.com/sailscastshq/sails-ai
 */

const { validateAdapter, capabilities } = require('./adapter')

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
  function buildApi(adapter, providerName) {
    const supported = capabilities(adapter)
    function requireCapability(operation) {
      if (!supported[operation]) {
        const error = new Error(`sails-ai: Provider '${providerName}' does not support ${operation}.`)
        error.code = 'E_CAPABILITY_UNSUPPORTED'
        throw error
      }
    }
    async function speech(operation, input, options) {
      requireCapability(operation)
      try {
        const receipt = await adapter[operation](input, options)
        return { ...receipt, provider: providerName }
      } catch (error) {
        if (error.receipt) error.receipt = { ...error.receipt, provider: providerName }
        throw error
      }
    }
    return {
      capabilities: supported,
      chat: input => { requireCapability('chat'); return adapter.chat(normalizeInput(input)) },
      stream: input => { requireCapability('stream'); return adapter.stream(normalizeInput(input)) },
      transcribe: input => speech('transcribe', input),
      synthesize: input => speech('synthesize', input),
      getJob: (receipt, options) => {
        requireCapability('getJob')
        if (!receipt || receipt.provider !== providerName) {
          const error = new Error('sails-ai: Job receipt belongs to a different provider.')
          error.code = 'E_INVALID_INPUT'
          throw error
        }
        return speech('getJob', receipt, options)
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
          transcribe: notConfigured,
          synthesize: notConfigured,
          getJob: notConfigured,
          use: notConfigured
        }
        return cb()
      }

      sails.after(['hook:orm:loaded'], async () => {
        try {
          const defaultProvider = sails.config.ai.provider

          // Helper to load and initialize a single provider
          async function loadProvider(name) {
            if (adapters[name]) return adapters[name]
            const config = sails.config.ai.providers[name]
            if (!config) {
              throw new Error(
                `sails-ai: Provider '${name}' is not configured in config/ai.js providers`
              )
            }
            const appRequire = require('module').createRequire(
              require('path').join(sails.config.appPath, 'package.json')
            )
            const AdapterImpl = appRequire(config.adapter)
            const adapterConfig = { ...config, log: sails.log }
            const adapter = new AdapterImpl(adapterConfig)
            validateAdapter(adapter, name)
            await adapter.initialize(adapterConfig)
            adapters[name] = adapter
            sails.log.info(`sails-ai: Loaded provider '${name}'`)
            return adapter
          }

          // Eagerly initialize only the default provider
          await loadProvider(defaultProvider)

          // Expose the sails.ai API — other providers are lazy-loaded on first use()
          const defaultApi = buildApi(getAdapter(defaultProvider), defaultProvider)

          sails.ai = {
            ...defaultApi,
            use: async (providerName) => {
              await loadProvider(providerName)
              return buildApi(getAdapter(providerName), providerName)
            }
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
