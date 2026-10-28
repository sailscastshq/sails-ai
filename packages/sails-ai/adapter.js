/** Adapter contract uses duck typing; no inheritance or dummy chat method. */
const operations = ['chat', 'stream', 'transcribe', 'synthesize', 'getJob']
function capabilities(adapter) {
  return Object.freeze(Object.fromEntries(operations.map(name => [name, typeof adapter[name] === 'function'])))
}
function validateAdapter(adapter, name) {
  if (typeof adapter.initialize !== 'function') {
    throw new Error(`sails-ai: Provider '${name}' must implement initialize(config).`)
  }
  if (!operations.some(operation => typeof adapter[operation] === 'function')) {
    throw new Error(`sails-ai: Provider '${name}' must implement at least one supported operation.`)
  }
  if ((adapter.transcribe || adapter.synthesize) && typeof adapter.getJob !== 'function') {
    throw new Error(`sails-ai: Speech provider '${name}' must implement getJob(receipt).`)
  }
}
module.exports = { validateAdapter, capabilities }
