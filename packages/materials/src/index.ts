import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
import { materialsProjection } from './projection.js'

export type { Material, MaterialsState, FetchedContent, FetchAttempt } from './types.js'
export const name = 'banso-materials'
export const inject = ['sessionProjections']

export function apply(ctx: Context): void {
  ctx.sessionProjections.register(materialsProjection)
}
