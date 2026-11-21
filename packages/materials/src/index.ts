import { registerResearchBudget } from './budget.js'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
import z from '@deepseek-ai/schemastery'
import { createReadTool } from './tools/read.js'
import type { ReadConfig } from './tools/read.js'
import { registerSearchWrapper } from './tools/search.js'
import { registerFetchRestriction } from './tools/fetch-policy.js'
import { registerWebGuidance } from './context/guidance.js'
import { materialsProjection } from './state/projection.js'
import { registerResultRenderer } from './tools/results.js'

export type {
  Material,
  MaterialsState,
  FetchedContent,
  Evidence,
  ReadMode,
} from './types.js'
export const name = 'banso-materials'
export const inject = ['sessionProjections', 'agents', 'tools', 'web', 'llm', 'systemPrompt']

export interface Config extends ReadConfig {
  researchBudget: number
  maxDirectChars: number
}
export const Config: z<Config> = z.object({
  researchBudget: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(15),
  provider: z.string(),
  model: z.string(),
  maxInputBytes: z.number().step(1).min(1).default(200_000).description('Maximum UTF-8 bytes sent to the extraction model in web_read extract mode.'),
  maxOutputTokens: z.number().step(1).min(1).default(4_096).description('Maximum output tokens for the extraction model in web_read extract mode.'),
  maxDirectChars: z.number().step(1).min(1).default(100_000).description('Maximum characters of page text returned to the main model in web_read direct mode.'),
  timeoutMs: z.number().step(1).min(1).max(2_147_483_647).default(120_000),
})

export async function apply(ctx: Context, config: Config): Promise<void> {
  if ((config.provider === undefined) !== (config.model === undefined)) {
    throw new Error('Extraction provider and model must be configured together')
  }
  const projection = await ctx.sessionProjections.register(materialsProjection)
  ctx.tools.register(createReadTool(ctx, config, projection), {
    when: context => config.researchBudget > 0 && projection.stateOf(context.agent.session).budget.used < config.researchBudget,
  })
  registerWebGuidance(ctx)
  registerSearchWrapper(ctx, config.researchBudget, projection)
  registerFetchRestriction(ctx)
  registerResearchBudget(ctx, config.researchBudget, projection)
  registerResultRenderer(ctx, projection, config.maxDirectChars)
}
