import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

export const TAVILY_PROVIDER_ID = 'tavily'
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'
export const TAVILY_DEFAULT_TOPIC = 'general'
export const TAVILY_DEFAULT_SEARCH_DEPTH = 'basic'
export const TAVILY_TOPICS = ['general', 'news', 'finance'] as const
export const TAVILY_SEARCH_DEPTHS = ['basic', 'advanced', 'fast', 'ultra-fast'] as const

export type TavilyTopic = typeof TAVILY_TOPICS[number]
export type TavilySearchDepth = typeof TAVILY_SEARCH_DEPTHS[number]

export interface TavilySearchProviderOptions {
  apiKey: string
  baseURL: string
  topic: TavilyTopic
  searchDepth: TavilySearchDepth
}

const MAX_RESULTS = 20

/** Contributes search to ctx.web; does not own provider selection or tool policy. */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = TAVILY_PROVIDER_ID
  private readonly options: TavilySearchProviderOptions

  constructor(options: TavilySearchProviderOptions) {
    this.options = { ...options, baseURL: options.baseURL.replace(/\/+$/, '') }
  }

  available(): boolean {
    return this.options.apiKey.trim().length > 0
      && isValidBaseURL(this.options.baseURL)
      && TAVILY_TOPICS.includes(this.options.topic)
      && TAVILY_SEARCH_DEPTHS.includes(this.options.searchDepth)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    try {
      signal?.throwIfAborted()
      const maxResults = request.maxResults ?? MAX_RESULTS
      if (!Number.isInteger(maxResults) || maxResults < 0) {
        throw new WebError('Tavily maxResults must be a non-negative integer', 'WEB_PROVIDER_ERROR')
      }

      const response = await fetch(`${this.options.baseURL}/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          query: request.query,
          max_results: Math.min(maxResults, MAX_RESULTS),
          topic: this.options.topic,
          search_depth: this.options.searchDepth,
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          include_usage: true,
        }),
        ...(signal !== undefined ? { signal } : {}),
      })

      if (!response.ok) {
        // Consume the body so cancellation during body reading remains observable.
        // Never copy an arbitrary API error body (which may echo credentials) into diagnostics.
        try {
          await response.text()
        } catch (error: unknown) {
          if (isAborted(error, signal)) throw error
          // A body read failure must not hide the HTTP status already received.
        }
        throw new WebError(`Tavily returned HTTP ${response.status}`, 'WEB_PROVIDER_ERROR')
      }

      const payload: unknown = await response.json()
      signal?.throwIfAborted()
      return mapResponse(payload)
    } catch (error: unknown) {
      if (isAborted(error, signal)) {
        throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      }
      if (error instanceof WebError) throw error
      throw new WebError('Tavily search request or response processing failed', 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

function mapResponse(payload: unknown): WebSearchResult {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new WebError('Tavily response is missing a results array', 'WEB_PROVIDER_ERROR')
  }

  const sources: WebSearchSource[] = []
  for (const item of payload.results) {
    // Match BansoAgain: title and URL are required, while content is optional.
    if (!isRecord(item) || typeof item.title !== 'string' || typeof item.url !== 'string') continue
    sources.push({
      url: item.url,
      title: item.title,
      ...(typeof item.content === 'string' ? { snippet: item.content } : {}),
    })
  }
  // ctx.web owns truncation; Tavily's API limit does not mean we dropped sources.
  return { sources, truncated: false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidBaseURL(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

function isAborted(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}
