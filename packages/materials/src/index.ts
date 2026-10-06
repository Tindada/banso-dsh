import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
import { materialsProjection } from './projection.js'
import { materialsSnapshotProjection } from './snapshot.js'
import { registerMaterialsContext } from './context.js'

export type { Material, MaterialsState, FetchedContent, Evidence } from './types.js'
export type { MaterialsSnapshotState } from './snapshot.js'
export const name = 'banso-materials'
export const inject = ['sessionProjections', 'agents']

export function apply(ctx: Context): void {
  ctx.sessionProjections.register(materialsProjection)
  ctx.sessionProjections.register(materialsSnapshotProjection)
  registerMaterialsContext(ctx)
}
