import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'

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
  maxResults: number
}

interface TavilySearchResponse {
  results: {
    url: string
    title: string
    content: string
    /** Tavily's estimate of publication or last update time. */
    published_date?: string | null
  }[]
}

interface TavilyErrorResponse {
  detail?: { error?: string }
}

/** Contributes search to ctx.web; does not own provider selection or tool policy. */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = TAVILY_PROVIDER_ID

  constructor(private readonly options: TavilySearchProviderOptions) {}

  available(): boolean {
    return this.options.apiKey.trim().length > 0
      && isValidBaseURL(this.options.baseURL)
      && TAVILY_TOPICS.includes(this.options.topic)
      && TAVILY_SEARCH_DEPTHS.includes(this.options.searchDepth)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const maxResults = request.maxResults ?? this.options.maxResults
    let response: Response
    try {
      response = await fetch(`${this.options.baseURL}/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          query: request.query,
          max_results: maxResults,
          topic: this.options.topic,
          search_depth: this.options.searchDepth,
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          include_published_date: true,
          include_usage: true,
        }),
        ...(signal !== undefined ? { signal } : {}),
      })
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      }
      throw new WebError('Tavily search request failed', 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      let message = `Tavily returned HTTP ${response.status}`
      try {
        const payload = await response.json() as TavilyErrorResponse
        const detail = payload.detail?.error
        if (detail?.trim()) message += `: ${detail}`
      } catch (error: unknown) {
        if (isAbortError(error)) {
          throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
        }
        // Non-JSON or unreadable error bodies must not hide the HTTP status.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as TavilySearchResponse
      return mapResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      }
      throw new WebError('Tavily returned an unprocessable response body', 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

function mapResponse(payload: TavilySearchResponse): WebSearchResult {
  // ctx.web owns the final truncation of returned sources.
  return {
    sources: payload.results.map(item => {
      const date = item.published_date ? new Date(item.published_date) : undefined
      return {
        url: item.url,
        title: item.title,
        snippet: item.content,
        ...(date && !Number.isNaN(date.getTime()) ? { publishedAt: date.toISOString() } : {}),
      }
    }),
    truncated: false,
  }
}

function isValidBaseURL(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
