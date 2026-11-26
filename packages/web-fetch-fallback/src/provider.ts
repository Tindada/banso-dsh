import { WebError } from '@deepseek-ai/dsh-web'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'

export const FALLBACK_PROVIDER_ID = 'fallback'

const ENDPOINT_GUIDANCE = '\n\nThe web request used endpoint '
const AUTH_STATUS = /\bHTTP (?:401|403)\b/

export interface FallbackFetchProviderOptions {
  readonly primary: WebFetchProvider
  readonly fallback: WebFetchProvider
  readonly primaryTimeoutMs: number
}

function isHttpURL(value: string): boolean {
  return /^https?:\/\//i.test(value) && URL.canParse(value)
}

function isSuccessStatus(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300
}

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const index = message.indexOf(ENDPOINT_GUIDANCE)
  const summary = (index === -1 ? message : message.slice(0, index)).trim()
  return summary.length > 0 ? summary : 'unknown error'
}

function isNonFallbackError(error: unknown): boolean {
  if (error instanceof WebError && error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING') return true
  const summary = summarizeError(error)
  return summary.includes('DeepSeek rejected the account sign-in') || AUTH_STATUS.test(summary)
}

/**
 * Composite fetch provider that tries `primary` first and falls back to `fallback`
 * on recoverable page-fetch or transient upstream failures.
 */
export class FallbackFetchProvider implements WebFetchProvider {
  readonly id = FALLBACK_PROVIDER_ID

  constructor(private readonly options: FallbackFetchProviderOptions) {}

  available(): boolean {
    return this.options.primary.available() || this.options.fallback.available()
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    if (signal?.aborted) throw new WebError('Web fetch aborted', 'WEB_ABORTED', { cause: signal.reason })
    if (!isHttpURL(request.url)) throw new WebError('Fetch target must be an HTTP(S) URL', 'WEB_PROVIDER_ERROR')

    const { primary, fallback, primaryTimeoutMs } = this.options
    const failures: string[] = []

    if (primary.available()) {
      const timeout = AbortSignal.timeout(primaryTimeoutMs)
      const primarySignal = signal ? AbortSignal.any([signal, timeout]) : timeout
      try {
        const result = await primary.fetch(request, primarySignal)
        if (isSuccessStatus(result.statusCode)) return result
        if (signal?.aborted) throw new WebError('Web fetch aborted', 'WEB_ABORTED', { cause: signal.reason })
        failures.push(`${primary.id}: HTTP ${result.statusCode}`)
      } catch (error) {
        if (signal?.aborted) throw new WebError('Web fetch aborted', 'WEB_ABORTED', { cause: signal.reason })
        if (timeout.aborted) {
          failures.push(`${primary.id}: timed out after ${primaryTimeoutMs}ms`)
        } else {
          if (isNonFallbackError(error)) throw error
          failures.push(`${primary.id}: ${summarizeError(error)}`)
        }
      }
    }

    if (signal?.aborted) throw new WebError('Web fetch aborted', 'WEB_ABORTED', { cause: signal.reason })

    if (fallback.available()) {
      try {
        const result = await fallback.fetch(request, signal)
        if (isSuccessStatus(result.statusCode)) return result
        if (signal?.aborted) throw new WebError('Web fetch aborted', 'WEB_ABORTED', { cause: signal.reason })
        failures.push(`${fallback.id}: HTTP ${result.statusCode}`)
      } catch (error) {
        if (signal?.aborted) throw new WebError('Web fetch aborted', 'WEB_ABORTED', { cause: signal.reason })
        failures.push(`${fallback.id}: ${summarizeError(error)}`)
      }
    }

    if (failures.length === 0) {
      throw new WebError('no usable fetch provider in fallback chain', 'WEB_PROVIDER_UNAVAILABLE')
    }
    throw new WebError(failures.join('; '), 'WEB_PROVIDER_ERROR')
  }
}
