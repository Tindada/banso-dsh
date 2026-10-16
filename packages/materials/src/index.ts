import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
import z from '@deepseek-ai/schemastery'
import { createFetchTool } from './tools/fetch.js'
import type { ReadMode } from './types.js'
import { createReadTool } from './tools/read.js'
import type { ReadConfig } from './tools/read.js'
import { registerSearchWrapper } from './tools/search.js'
import { registerWebGuidance } from './context/guidance.js'
import { materialsProjection } from './state/projection.js'
import { materialsSnapshotProjection } from './state/snapshot.js'
import { registerMaterialsContext } from './context/context.js'
import { createHideTool } from './tools/hide.js'

export type { Material, MaterialsState, FetchedContent, Evidence, ReadMode } from './types.js'
export type { MaterialsSnapshotState } from './state/snapshot.js'
export const name = 'banso-materials'
export const inject = ['sessionProjections', 'agents', 'tools', 'web', 'llm', 'systemPrompt']

export interface Config extends ReadConfig { readMode: ReadMode }
export const Config: z<Config> = z.object({
  readMode: z.union(['extract', 'direct'] as const).default('extract'),
  provider: z.string(),
  model: z.string(),
  maxInputBytes: z.number().step(1).min(1).default(200_000),
  maxOutputTokens: z.number().step(1).min(1).default(4_096),
  timeoutMs: z.number().step(1).min(1).max(2_147_483_647).default(120_000),
})

export function apply(ctx: Context, config: Config): void {
  if ((config.provider === undefined) !== (config.model === undefined)) {
    throw new Error('Extraction provider and model must be configured together')
  }
  ctx.sessionProjections.register(materialsProjection)
  ctx.sessionProjections.register(materialsSnapshotProjection)
  ctx.tools.register(createHideTool(ctx))
  ctx.tools.register(config.readMode === 'direct' ? createFetchTool(ctx, config) : createReadTool(ctx, config))
  registerWebGuidance(ctx)
  registerSearchWrapper(ctx)
  registerMaterialsContext(ctx, config.readMode)
}
