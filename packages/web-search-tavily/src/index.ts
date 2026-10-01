import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import {
  TavilySearchProvider,
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_TOPIC,
  TAVILY_DEFAULT_SEARCH_DEPTH,
  TAVILY_TOPICS,
  TAVILY_SEARCH_DEPTHS,
} from './provider.js'
import type { TavilyTopic, TavilySearchDepth } from './provider.js'

export { TavilySearchProvider, TAVILY_PROVIDER_ID } from './provider.js'
export type { TavilySearchProviderOptions, TavilyTopic, TavilySearchDepth } from './provider.js'

export const name = 'web-search-tavily'
export const inject = ['web']

export interface Config {
  /** Explicit configuration takes precedence over TAVILY_API_KEY. */
  apiKey?: string
  baseURL?: string
  topic?: TavilyTopic
  searchDepth?: TavilySearchDepth
  /** Default result count when the request omits maxResults. */
  maxResults?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  baseURL: z.string(),
  topic: z.union(TAVILY_TOPICS),
  searchDepth: z.union(TAVILY_SEARCH_DEPTHS),
  maxResults: z.number().step(1).min(0),
})

export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new TavilySearchProvider({
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('TAVILY_API_KEY')?.value ?? '',
    baseURL: config.baseURL ?? TAVILY_DEFAULT_BASE_URL,
    topic: config.topic ?? TAVILY_DEFAULT_TOPIC,
    searchDepth: config.searchDepth ?? TAVILY_DEFAULT_SEARCH_DEPTH,
    maxResults: config.maxResults ?? 20,
  }))
}
