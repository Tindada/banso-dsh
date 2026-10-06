import { WebError } from '@deepseek-ai/dsh-web'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'

export const JINA_PROVIDER_ID = 'jina'

export interface JinaFetchProviderOptions {
  apiKey: string
  baseURL: string
  timeoutMs: number
  maxBodyChars: number
}

function isHttpURL(value: string): boolean {
  return /^https?:\/\//i.test(value) && URL.canParse(value)
}

interface JinaResponse {
  code: number
  status: number
  data: {
    content: string
    url?: string | null
    warning?: string | null
  }
}

/** Retrieves extracted Markdown; tool presentation and material storage live above this seam. */
export class JinaFetchProvider implements WebFetchProvider {
  readonly id = JINA_PROVIDER_ID

  constructor(private readonly options: JinaFetchProviderOptions) {}

  available(): boolean {
    return isHttpURL(this.options.baseURL)
      && !new URL(this.options.baseURL).search
      && !new URL(this.options.baseURL).hash
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    if (!isHttpURL(request.url)) throw new WebError('Jina target must be an HTTP(S) URL', 'WEB_PROVIDER_ERROR')
    const timeout = AbortSignal.timeout(this.options.timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      const response = await fetch(`${this.options.baseURL}/${request.url}`, {
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'X-No-Cache': 'true',
          ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        signal: combined,
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new WebError(`Jina Reader returned HTTP ${response.status}`, 'WEB_PROVIDER_ERROR')
      }
      try {
        const payload = await response.json() as JinaResponse
        combined.throwIfAborted()
        return this.mapResponse(payload, request.url)
      } catch (error) {
        if (error instanceof WebError) throw error
        throw new WebError('Jina Reader returned an invalid response', 'WEB_PROVIDER_ERROR')
      }
    } catch (error) {
      if (combined.aborted) throw new WebError('Jina Reader request aborted or timed out', 'WEB_ABORTED')
      if (error instanceof WebError) throw error
      // Do not expose transport diagnostics that may contain credentials.
      throw new WebError('Jina Reader request failed', 'WEB_PROVIDER_ERROR')
    }
  }

  private mapResponse(payload: JinaResponse, requestURL: string): WebFetchResult {
    const data = payload?.data
    const url = data?.url?.trim() || requestURL
    const warning = data?.warning?.trim() ?? ''
    if (payload?.code !== 200 || payload.status !== 20000
      || typeof data?.content !== 'string' || !isHttpURL(url)) {
      throw new WebError('Jina Reader returned an invalid response', 'WEB_PROVIDER_ERROR')
    }
    const match = /Target URL returned error\s+(\d{3})\b/i.exec(warning)
    const targetStatus = match ? Number(match[1]) : 200
    const failed = targetStatus < 200 || targetStatus >= 300
    const content = failed ? warning : data.content.trim()
    if (!content) throw new WebError('Jina Reader returned no extractable text', 'WEB_PROVIDER_ERROR')
    return {
      url,
      statusCode: failed ? targetStatus : 200,
      body: { kind: 'text', content: content.slice(0, this.options.maxBodyChars) },
      truncated: content.length > this.options.maxBodyChars,
    }
  }
}
