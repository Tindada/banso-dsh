import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import { JinaFetchProvider } from './provider.js'

export { JinaFetchProvider, JINA_PROVIDER_ID } from './provider.js'
export type { JinaFetchProviderOptions } from './provider.js'
export const name = 'web-fetch-jina'
export const inject = ['web']
export interface Config {
  apiKey?: string
  baseURL?: string
  timeoutMs?: number
  maxBodyChars?: number
}
export const Config: z<Config> = z.object({
  apiKey: z.string(),
  baseURL: z.string(),
  timeoutMs: z.number().step(1).min(1).max(2_147_483_647),
  maxBodyChars: z.number().step(1).min(1),
})

export function apply(ctx: Context, config: Config): void {
  ctx.web.registerFetchProvider(new JinaFetchProvider({
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('JINA_API_KEY')?.value ?? '',
    baseURL: config.baseURL ?? 'https://r.jina.ai',
    timeoutMs: config.timeoutMs ?? 30_000,
    maxBodyChars: config.maxBodyChars ?? 100_000,
  }))
}
