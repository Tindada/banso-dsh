import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { Material, MaterialsState, PendingCall } from './types.js'

const urlSchema = z.string().refine(value => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
})

const sourceSchema = z.object({
  url: urlSchema,
  title: z.string().optional(),
  snippet: z.string().optional(),
  publishedAt: z.string().optional(),
})

const searchMetaSchema = z.object({
  sources: z.array(sourceSchema),
  truncated: z.boolean(),
  answer: z.string().optional(),
})

const readMetaSchema = z.object({
  requestUrl: urlSchema,
  focus: z.string().refine(value => value.trim().length > 0),
  content: z.string().optional(),
  finalUrl: urlSchema.optional(),
  truncated: z.boolean().optional(),
  evidence: z.string().optional(),
  error: z.string().optional(),
})

const fetchedSchema = z.object({
  content: z.string(),
  finalUrl: urlSchema,
  truncated: z.boolean(),
  time: z.number(),
})

const evidenceSchema = z.object({
  focus: z.string(),
  text: z.string(),
  time: z.number(),
})

const materialSchema = sourceSchema.extend({
  handle: z.string(),
  fetched: fetchedSchema.optional(),
  evidence: z.array(evidenceSchema).optional(),
})

const stateSchema: z.ZodType<MaterialsState> = z.object({
  items: z.record(z.string(), materialSchema),
  urlIndex: z.record(z.string(), z.string()),
  nextHandle: z.number().int().positive(),
  pendingCalls: z.record(
    z.string(),
    z.object({
      name: z.enum(['web_search', 'web_read']),
      callId: z.string(),
      turn: z.number().int(),
    }),
  ),
})

function trackCall(event: SessionEvent<'tool/call'>): PendingCall | undefined {
  const { name, callId, turn } = event.data
  if (name !== 'web_search' && name !== 'web_read') return undefined

  return { name, callId, turn }
}

/** Updates only detached containers; existing records remain immutable. */
function upsert(state: MaterialsState, url: string, update: (item: Material) => Material): void {
  const handle = Object.hasOwn(state.urlIndex, url) ? state.urlIndex[url]! : `S${state.nextHandle++}`

  state.urlIndex[url] = handle
  state.items[handle] = update(state.items[handle] ?? { handle, url })
}

export function applyMaterials(state: MaterialsState, event: SessionEvent): MaterialsState {
  if (event.type === 'tool/call') {
    const call = trackCall(event)
    return call === undefined
      ? state
      : {
          ...state,
          pendingCalls: { ...state.pendingCalls, [event.seq]: call },
        }
  }

  if (event.type === 'turn/end') {
    return { ...state, pendingCalls: {} }
  }

  if (
    event.type !== 'tool/result'
    || event.surfaceOp !== 'append'
    || event.sourceEventSeqs?.length !== 1
  ) return state

  const seq = event.sourceEventSeqs[0]!
  const call = state.pendingCalls[seq]
  if (
    call === undefined
    || call.callId !== event.data.message.toolCallId
    || call.turn !== event.data.turn
  ) return state

  const pendingCalls = { ...state.pendingCalls }
  delete pendingCalls[seq]

  const next = {
    ...state,
    pendingCalls,
    items: { ...state.items },
    urlIndex: { ...state.urlIndex },
  }
  if (call.name === 'web_search') {
    if (event.data.message.isError) return next
    const parsed = searchMetaSchema.safeParse(event.data.meta)
    if (!parsed.success) return next

    for (const source of parsed.data.sources) {
      upsert(next, source.url, item => ({ ...item, ...source }))
    }
    return next
  }

  if (call.name === 'web_read') {
    // Ordinary tool errors include invalid input and cancellation; no stage facts were committed.
    if (event.data.message.isError) return next
    const parsed = readMetaSchema.safeParse(event.data.meta)
    if (!parsed.success) return next
    const { requestUrl, focus, content, finalUrl, truncated, evidence } = parsed.data
    if (content !== undefined && (finalUrl === undefined || truncated === undefined)) return next
    upsert(next, requestUrl, item => {
      const updated = content !== undefined
        ? {
            ...item,
            fetched: { content, finalUrl: finalUrl!, truncated: truncated!, time: event.time },
          }
        : item
      if (!evidence?.trim()) return updated
      return {
        ...updated,
        evidence: [
          ...item.evidence ?? [],
          { focus, text: evidence, time: event.time },
        ],
      }
    })
  }
  return next
}

// Derived index over existing tool facts, not a new whole-state event domain.
export const materialsProjection: ProjectionDefinition<'bansoMaterials'> = {
  key: 'bansoMaterials',
  stateVersion: 1,
  stateSchema,
  init: () => ({ items: {}, urlIndex: {}, nextHandle: 1, pendingCalls: {} }),
  apply: applyMaterials,
}
