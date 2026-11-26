import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import {
  DEEPSEEK_WEB_API_BASE_URL,
  DeepSeekFetchApiProvider,
} from '@deepseek-ai/dsh-web-deepseek-api'
import type { DeepSeekFetchApiOptions } from '@deepseek-ai/dsh-web-deepseek-api'
import z from '@deepseek-ai/schemastery'
import { JinaFetchProvider } from 'banso-dsh-web-fetch-jina'
import { FallbackFetchProvider } from './provider.js'

export { FALLBACK_PROVIDER_ID, FallbackFetchProvider } from './provider.js'
export type { FallbackFetchProviderOptions } from './provider.js'

const ACCOUNT_PROVIDER = 'deepseek-account'
const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647

export const name = 'web-fetch-fallback'
export const inject = ['web']

export interface DeepSeekFetchConfig {
  apiKey?: string
  apiKeyEnv?: string
  baseURL?: string
  timeoutMs?: number
}

export interface JinaFetchConfig {
  apiKey?: string
  baseURL?: string
  timeoutMs?: number
  maxBodyChars?: number
}

export interface Config {
  deepseek?: DeepSeekFetchConfig
  jina?: JinaFetchConfig
}

export const Config: z<Config> = z.object({
  deepseek: z.object({
    apiKey: z.string(),
    apiKeyEnv: z.string(),
    baseURL: z.string(),
    timeoutMs: z.number().step(1).min(1).max(MAX_NODE_TIMER_DELAY_MS),
  }),
  jina: z.object({
    apiKey: z.string(),
    baseURL: z.string(),
    timeoutMs: z.number().step(1).min(1).max(MAX_NODE_TIMER_DELAY_MS),
    maxBodyChars: z.number().step(1).min(1),
  }),
})

function resolveDeepSeekOptions(ctx: Context, ds: DeepSeekFetchConfig): DeepSeekFetchApiOptions {
  const baseURL = ds.baseURL ?? DEEPSEEK_WEB_API_BASE_URL
  const apiKeyEnv = credentialRef(ds.apiKeyEnv ?? 'DEEPSEEK_API_KEY')
  const literalApiKey = ds.apiKey !== undefined && ds.apiKey.length > 0 ? ds.apiKey : undefined
  const sources: DeepSeekFetchApiOptions['auth']['sources'][number][] = []

  const account = ctx.get('deepseekAccount')
  const activeRoute = ctx.get('agents')?.currentInitiator()?.session.requestContext()?.provider
  if (literalApiKey === undefined && ds.baseURL === undefined && activeRoute === ACCOUNT_PROVIDER && account !== undefined) {
    sources.push({
      kind: 'account',
      baseURL,
      resolveToken: async (endpoint: string) => await account.resolveToken(endpoint),
      rejectToken: async (token: string) => { await account.rejectToken(token) },
    })
  }

  sources.push({
    kind: 'api-key',
    baseURL,
    key: literalApiKey ?? {
      ref: apiKeyEnv,
      configured: async () => {
        const credentials = ctx.get('credentials')
        if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv)) !== undefined
        const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
        return ambient !== undefined && ambient.value.length > 0
      },
      resolve: async () => {
        const credentials = ctx.get('credentials')
        if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
        const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
        return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
      },
    },
  })

  return {
    auth: { sources },
    guidance: {
      subject: 'Fetch',
      plugin: name,
      custom: ds.baseURL !== undefined || ds.apiKeyEnv !== undefined,
      baseURLField: 'deepseek.baseURL',
      apiKeyEnvField: 'deepseek.apiKeyEnv',
    },
  }
}

export function apply(ctx: Context, config: Config): void {
  const ds = config.deepseek ?? {}
  const jina = config.jina ?? {}

  const primary = new DeepSeekFetchApiProvider(() => resolveDeepSeekOptions(ctx, ds))
  const fallback = new JinaFetchProvider({
    apiKey: jina.apiKey ?? launchEnvironmentOf(ctx).get('JINA_API_KEY')?.value ?? '',
    baseURL: jina.baseURL ?? 'https://r.jina.ai',
    timeoutMs: jina.timeoutMs ?? 30_000,
    maxBodyChars: jina.maxBodyChars ?? 100_000,
  })

  ctx.web.registerFetchProvider(new FallbackFetchProvider({
    primary,
    fallback,
    primaryTimeoutMs: ds.timeoutMs ?? 30_000,
  }))
}
