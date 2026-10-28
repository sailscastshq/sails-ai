/** Hosted YarnGPT async speech. No implicit retries, polling loop or audio downloads. */
const BASE = 'https://api.yarngpt.ai'
const STATUS = new Set(['queued', 'processing', 'completed', 'failed'])
function fail(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details })
}
function check(condition, message) {
  if (!condition) throw fail('E_INVALID_INPUT', message)
}
function optionalString(value, name) {
  check(value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 128), `Invalid ${name}.`)
}
class YarnGPTAdapter {
  async initialize(config) {
    check(typeof config.apiKey === 'string' && config.apiKey.length > 0 && !/[\r\n]/.test(config.apiKey), 'YarnGPT apiKey is required.')
    this.apiKey = config.apiKey
    this.fetch = config.fetch || globalThis.fetch
    this.timeoutMs = config.timeoutMs ?? 30000
    check(Number.isInteger(this.timeoutMs) && this.timeoutMs > 0 && this.timeoutMs <= 120000, 'timeoutMs must be 1–120000.')
  }
  intent(operation, key) {
    check(typeof key === 'string' && /^[\x21-\x39\x3b-\x7e]{1,64}$/.test(key), 'idempotencyKey must be 1–64 visible characters without a colon.')
    return { adapter: 'yarngpt', provider: 'yarngpt', operation, id: null, idempotencyKey: key, status: 'unknown', usage: { creditsReserved: null, creditsCharged: null } }
  }
  async transcribe(input = {}) {
    const { audio, mimeType, filename = 'audio.wav', targetLanguage, idempotencyKey, signal } = input
    check(!('language' in input) && !('sourceLanguage' in input), 'YarnGPT has no source-language hint. Validate expected language in your application.')
    const receipt = this.intent('transcribe', idempotencyKey)
    check(audio instanceof Uint8Array && audio.byteLength > 0 && audio.byteLength <= 64 * 1024 * 1024, 'audio must be nonempty bytes up to 64 MiB.')
    check(typeof mimeType === 'string' && /^audio\/[a-zA-Z0-9.+-]+$/.test(mimeType), 'An audio mimeType is required.')
    check(typeof filename === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(filename), 'Invalid filename.')
    optionalString(targetLanguage, 'targetLanguage')
    const body = new FormData()
    body.append('file', new Blob([audio], { type: mimeType }), filename)
    if (targetLanguage !== undefined) body.append('target_language', targetLanguage)
    return this.request('/api/v1/asr', { method: 'POST', body, signal }, receipt)
  }
  async synthesize(input = {}) {
    const { text, voice, outputFormat = 'mp3', targetLanguage, idempotencyKey, signal } = input
    const receipt = this.intent('synthesize', idempotencyKey)
    check(typeof text === 'string' && text.trim().length > 0 && text.length <= 15000, 'text must contain 1–15000 characters.')
    check(['mp3', 'wav'].includes(outputFormat), 'outputFormat must be mp3 or wav.')
    optionalString(voice, 'voice'); optionalString(targetLanguage, 'targetLanguage')
    return this.request('/api/v1/tts', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice, output_format: outputFormat, target_language: targetLanguage }) }, receipt)
  }
  async getJob(receipt = {}, options = {}) {
    check(receipt.adapter === 'yarngpt' && ['transcribe', 'synthesize'].includes(receipt.operation), 'Invalid YarnGPT job operation or adapter.')
    check(typeof receipt.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(receipt.id), 'A persisted job id is required; unknown outcomes cannot be polled.')
    const path = receipt.operation === 'transcribe' ? '/api/v1/asr/' : '/api/v1/status/'
    return this.request(path + encodeURIComponent(receipt.id), { method: 'GET', signal: options.signal }, receipt)
  }
  async request(path, options, receipt) {
    const posting = options.method === 'POST'
    if (options.signal?.aborted) throw fail('E_ABORTED', 'Request cancelled before transmission.', { receipt })
    const controller = new AbortController()
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, this.timeoutMs)
    try {
      const response = await this.fetch(BASE + path, {
        ...options, redirect: 'error', signal: controller.signal,
        headers: { ...options.headers, Authorization: `Bearer ${this.apiKey}`, ...(posting ? { 'Idempotency-Key': receipt.idempotencyKey } : {}) }
      })
      let data
      try { data = await response.json() } catch {
        throw fail(posting ? 'E_SUBMISSION_UNKNOWN' : 'E_PROVIDER_RESPONSE', 'Provider returned invalid JSON.', { receipt, outcomeUnknown: posting })
      }
      if (!response.ok) {
        const code = response.status === 401 ? 'E_AUTH_FAILED' : response.status === 429 ? 'E_RATE_LIMITED' : response.status === 402 ? 'E_QUOTA_EXCEEDED' : response.status === 404 ? 'E_JOB_NOT_FOUND' : 'E_PROVIDER_ERROR'
        const unknown = posting && (response.status >= 500 || (response.status === 409 && data?.error?.code === 'ALREADY_EXISTS'))
        throw fail(unknown ? 'E_SUBMISSION_UNKNOWN' : code, `YarnGPT request failed (${response.status}).`, {
          status: response.status, providerCode: typeof data?.error?.code === 'string' ? data.error.code : undefined,
          retryAfter: response.headers?.get('retry-after') || null, outcomeUnknown: unknown, receipt
        })
      }
      // Preserve an accepted id even when other response fields are malformed.
      if (posting && typeof data?.job_id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(data.job_id)) receipt = { ...receipt, id: data.job_id }
      try { return this.normalize(data, receipt) } catch {
        throw fail(posting ? 'E_SUBMISSION_UNKNOWN' : 'E_PROVIDER_RESPONSE', 'Invalid YarnGPT job response.', { receipt, outcomeUnknown: posting })
      }
    } catch (error) {
      if (error.code?.startsWith('E_')) throw error
      throw fail(posting ? 'E_SUBMISSION_UNKNOWN' : controller.signal.aborted ? 'E_ABORTED' : 'E_PROVIDER_UNAVAILABLE', 'YarnGPT request did not complete. Do not create a new submission key.', { receipt, outcomeUnknown: posting })
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
    }
  }
  normalize(data, previous) {
    check(data && typeof data === 'object' && STATUS.has(data.status), 'Invalid job status.')
    const id = data.job_id ?? previous.id
    check(typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id), 'Invalid job id.')
    check(!previous.id || id === previous.id, 'Mismatched job id.')
    const usage = { ...previous.usage }
    for (const [from, to] of [['credits_reserved', 'creditsReserved'], ['credits_charged', 'creditsCharged']]) {
      if (data[from] !== undefined && data[from] !== null) {
        check(typeof data[from] === 'number' && Number.isFinite(data[from]) && data[from] >= 0, 'Invalid usage.')
        usage[to] = data[from]
      }
    }
    let result = null
    if (data.status === 'completed') {
      if (previous.operation === 'transcribe') {
        check(typeof data.transcript === 'string', 'Missing transcript.')
        result = { text: data.transcript, translation: data.translated_transcript ?? null, translationStatus: data.translation_status ?? null, translationMessage: data.translation_user_message ?? null }
      } else {
        check(typeof data.audio_url === 'string' && new URL(data.audio_url).protocol === 'https:', 'Missing secure audio URL.')
        result = { audioUrl: data.audio_url }
      }
    }
    return {
      adapter: 'yarngpt', provider: previous.provider, operation: previous.operation, id,
      idempotencyKey: previous.idempotencyKey, status: data.status, usage, result,
      error: data.status === 'failed' ? { code: typeof data.error_code === 'string' ? data.error_code : 'E_JOB_FAILED', message: previous.operation === 'transcribe' && typeof data.error_message === 'string' ? data.error_message : typeof data.user_message === 'string' ? data.user_message : 'Speech job failed.' } : null,
      warnings: Array.isArray(data.warnings) ? data.warnings : []
    }
  }
}
module.exports = YarnGPTAdapter
