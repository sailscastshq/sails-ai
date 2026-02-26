/**
 * Base Adapter
 *
 * Defines the interface contract that all sails-ai adapters must implement.
 * Adapters are responsible for communicating with a specific AI provider
 * (Ollama, Cloudflare, Anthropic, OpenAI, node-llama-cpp, etc.).
 *
 * To create a new adapter:
 * 1. Create a class with initialize(), chat(), and optionally stream() and teardown()
 * 2. Export the class as the package's main export
 *
 * @example
 * class MyAdapter {
 *   async initialize(config) { ... }
 *   async chat({ messages, model }) { ... }
 *   async *stream({ messages, model }) { ... }
 * }
 *
 * module.exports = MyAdapter
 */

/**
 * Validate that an adapter instance implements the required interface.
 * Uses duck typing — no class inheritance required.
 *
 * @param {Object} adapter - The adapter instance to validate
 * @param {string} name - Provider name (for error messages)
 * @throws {Error} If required methods are missing
 */
function validateAdapter(adapter, name) {
  if (typeof adapter.initialize !== 'function') {
    throw new Error(
      `sails-ai: Provider '${name}' must implement initialize(config). ` +
        'See the adapter docs for the required interface.'
    )
  }
  if (typeof adapter.chat !== 'function') {
    throw new Error(
      `sails-ai: Provider '${name}' must implement chat({ messages, model }). ` +
        'See the adapter docs for the required interface.'
    )
  }
  // stream() and teardown() are optional
}

module.exports = { validateAdapter }
