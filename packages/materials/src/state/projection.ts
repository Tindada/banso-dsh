import { isResearchTool } from '../budget.js'
import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { Material, MaterialEntry, MaterialsState, PendingCall } from '../types.js'

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

const fetchMetaSchema = z.object({
  requestUrl: urlSchema,
  content: z.string().optional(),
  finalUrl: urlSchema.optional(),
  truncated: z.boolean().optional(),
  error: z.string().optional(),
})

const readMetaSchema = fetchMetaSchema.extend({
  mode: z.enum(['direct', 'extract']),
  focus: z.string().optional(),
  evidence: z.string().optional(),
}).refine(value => value.mode === 'direct' || (value.focus !== undefined && value.focus.trim().length > 0))

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

const sourceEntrySchema = sourceSchema.extend({
  kind: z.literal('source'),
  handle: z.string(),
})

const fetchedEntrySchema = z.object({
  kind: z.literal('fetched'),
  handle: z.string(),
})

const pageEntrySchema = z.object({
  kind: z.literal('page'),
  handle: z.string(),
})

const evidenceEntrySchema = z.object({
  kind: z.literal('evidence'),
  handle: z.string(),
  index: z.number().int().nonnegative(),
})

const entrySchema: z.ZodType<MaterialEntry> = z.discriminatedUnion('kind', [
  sourceEntrySchema,
  fetchedEntrySchema,
  pageEntrySchema,
  evidenceEntrySchema,
])

const stateSchema: z.ZodType<MaterialsState> = z.object({
  budget: z.object({ used: z.number().int().nonnegative() }),
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
  entries: z.array(entrySchema),
})

function trackCall(event: SessionEvent<'tool/call'>): PendingCall | undefined {
  const { name, callId, turn } = event.data
  if (name !== 'web_search' && name !== 'web_read') return undefined

  return { name, callId, turn }
}

/** Updates only detached containers; existing records remain immutable. */
function upsert(
  state: MaterialsState,
  url: string,
  update: (item: Material) => Material,
): { handle: string; previous: Material | undefined; item: Material } {
  const existing = Object.hasOwn(state.urlIndex, url) ? state.urlIndex[url]! : undefined
  const handle = existing ?? `S${state.nextHandle++}`
  const previous = existing === undefined ? undefined : state.items[handle]

  state.urlIndex[url] = handle
  const item = update(previous ?? { handle, url })
  state.items[handle] = item
  return { handle, previous, item }
}

export function applyMaterials(state: MaterialsState, event: SessionEvent): MaterialsState {
  if (event.type === 'turn/start') return { ...state, budget: { used: 0 } }
  if (event.type === 'tool/call') {
    const call = trackCall(event)
    return call === undefined
      ? state
      : {
          ...state,
          pendingCalls: { ...state.pendingCalls, [event.seq]: call },
          budget: { used: state.budget.used + (isResearchTool(call.name) ? 1 : 0) },
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
    entries: [...state.entries],
  }
  if (call.name === 'web_search') {
    if (event.data.message.isError) return next
    const parsed = searchMetaSchema.safeParse(event.data.meta)
    if (!parsed.success) return next

    for (const source of parsed.data.sources) {
      const { handle, previous } = upsert(next, source.url, item => ({ ...item, ...source }))
      if (previous === undefined) {
        next.entries.push({
          kind: 'source',
          handle,
          url: source.url,
          ...(source.title !== undefined ? { title: source.title } : {}),
          ...(source.snippet !== undefined ? { snippet: source.snippet } : {}),
          ...(source.publishedAt !== undefined ? { publishedAt: source.publishedAt } : {}),
        })
      }
    }
    return next
  }

  if (call.name === 'web_read') {
    // Ordinary tool errors include invalid input and cancellation; no stage facts were committed.
    if (event.data.message.isError) return next
    const parsed = readMetaSchema.safeParse(event.data.meta)
    if (!parsed.success) return next
    const { requestUrl, content, finalUrl, truncated, mode } = parsed.data
    const evidenceGroup = mode === 'extract' ? parsed.data : undefined
    if (content !== undefined && (finalUrl === undefined || truncated === undefined)) return next
    const { handle, previous, item: saved } = upsert(next, requestUrl, item => {
      const updated = item.fetched === undefined && content !== undefined
        ? {
            ...item,
            fetched: { content, finalUrl: finalUrl!, truncated: truncated!, time: event.time },
          }
        : item
      if (parsed.data.error !== undefined) return updated
      if (!evidenceGroup?.evidence?.trim()) return updated
      return {
        ...updated,
        evidence: [
          ...item.evidence ?? [],
          { focus: evidenceGroup.focus!, text: evidenceGroup.evidence, time: event.time },
        ],
      }
    })
    if (previous === undefined) {
      next.entries.push({ kind: 'source', handle, url: requestUrl })
    }
    if (previous?.fetched === undefined && saved.fetched !== undefined) {
      next.entries.push({ kind: 'fetched', handle })
    }
    if (parsed.data.error === undefined) {
      if (
        mode === 'direct'
        && saved.fetched !== undefined
        && !next.entries.some(entry => entry.kind === 'page' && entry.handle === handle)
      ) {
        next.entries.push({ kind: 'page', handle })
      }
      if (mode === 'extract' && evidenceGroup?.evidence?.trim()) {
        next.entries.push({
          kind: 'evidence',
          handle,
          index: saved.evidence!.length - 1,
        })
      }
    }
  }
  return next
}

// Derived index over existing tool facts, not a new whole-state event domain.
export const materialsProjection: ProjectionDefinition<'bansoMaterials'> = {
  key: 'bansoMaterials',
  stateVersion: 3,
  stateSchema,
  init: () => ({ budget: { used: 0 }, items: {}, urlIndex: {}, nextHandle: 1, pendingCalls: {}, entries: [] }),
  apply: applyMaterials,
}
