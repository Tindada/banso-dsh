import { z } from 'zod'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

export type MaterialsSnapshotState = { messageId: string; seq: SessionSeq } | null

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'banso-materials': { kind: 'banso-materials'; form: 'snapshot' | 'placeholder' }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    bansoMaterialsSnapshot: MaterialsSnapshotState
  }
}

/** Only locates our latest committed snapshot; the surface decides whether it survives. */
export const materialsSnapshotProjection: ProjectionDefinition<'bansoMaterialsSnapshot'> = {
  key: 'bansoMaterialsSnapshot',
  stateVersion: 1,
  stateSchema: z.object({ messageId: z.string(), seq: z.number().int().nonnegative().transform(SessionSeq) }).nullable(),
  init: () => null,
  apply: (state, event) => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'banso-materials') return state
    if (event.data.source.form === 'snapshot') return { messageId: event.data.id, seq: event.seq }
    if (
      event.data.source.form === 'placeholder'
      && state !== null
      && event.sourceEventSeqs?.includes(state.seq)
    ) return null
    return state
  },
}
