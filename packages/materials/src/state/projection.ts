import { isResearchTool } from '../budget.js'
import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { FetchedContent, Material, MaterialsState, PendingCall, ReadMode } from '../types.js'

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
})

export interface SearchSourceOutcome {
  handle: string
  existing: boolean
  url: string
  title?: string | undefined
  snippet?: string | undefined
  publishedAt?: string | undefined
}

export interface SearchOutcome {
  sources: SearchSourceOutcome[]
  truncated: boolean
  answer?: string | undefined
}

export interface ReadOutcome {
  handle: string
  requestUrl: string
  mode: ReadMode
  fetched?: FetchedContent | undefined
  fetchedNow: boolean
  focus?: string | undefined
  evidence?: string | undefined
  error?: string | undefined
}

function trackCall(event: SessionEvent<'tool/call'>): PendingCall | undefined {
  const { name, callId, turn } = event.data
  if (name !== 'web_search' && name !== 'web_read') return undefined

  return { name, callId, turn }
}

function cloneMutableState(state: MaterialsState): MaterialsState {
  return {
    ...state,
    items: { ...state.items },
    urlIndex: { ...state.urlIndex },
  }
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

/** Shared pure transition for web_search metadata, used by both post-execute rendering and projection fold. */
export function applySearchMeta(
  state: MaterialsState,
  meta: unknown,
): { next: MaterialsState; outcome: SearchOutcome } | undefined {
  const parsed = searchMetaSchema.safeParse(meta)
  if (!parsed.success) return undefined

  const next = cloneMutableState(state)
  const sources: SearchSourceOutcome[] = []
  for (const source of parsed.data.sources) {
    const { handle, previous } = upsert(next, source.url, item => ({ ...item, ...source }))
    sources.push({
      handle,
      existing: previous !== undefined,
      url: source.url,
      ...(source.title !== undefined ? { title: source.title } : {}),
      ...(source.snippet !== undefined ? { snippet: source.snippet } : {}),
      ...(source.publishedAt !== undefined ? { publishedAt: source.publishedAt } : {}),
    })
  }
  return {
    next,
    outcome: {
      sources,
      truncated: parsed.data.truncated,
      ...(parsed.data.answer !== undefined ? { answer: parsed.data.answer } : {}),
    },
  }
}

/** Shared pure transition for web_read metadata, used by both post-execute rendering and projection fold. */
export function applyReadMeta(
  state: MaterialsState,
  meta: unknown,
  time = 0,
): { next: MaterialsState; outcome: ReadOutcome } | undefined {
  const parsed = readMetaSchema.safeParse(meta)
  if (!parsed.success) return undefined

  const { requestUrl, content, finalUrl, truncated, mode, error } = parsed.data
  if (content !== undefined && (finalUrl === undefined || truncated === undefined)) return undefined

  const evidenceGroup = mode === 'extract' ? parsed.data : undefined
  const next = cloneMutableState(state)
  const { handle, previous, item: saved } = upsert(next, requestUrl, item => {
    let updated: Material = item.fetched === undefined && content !== undefined
      ? {
          ...item,
          fetched: { content, finalUrl: finalUrl!, truncated: truncated!, time },
        }
      : item
    if (error !== undefined) return updated
    if (mode === 'extract' && evidenceGroup?.evidence?.trim()) {
      updated = {
        ...updated,
        evidence: [
          ...item.evidence ?? [],
          { focus: evidenceGroup.focus!, text: evidenceGroup.evidence, time },
        ],
      }
    }
    return updated
  })

  return {
    next,
    outcome: {
      handle,
      requestUrl,
      mode,
      ...(saved.fetched !== undefined ? { fetched: saved.fetched } : {}),
      fetchedNow: previous?.fetched === undefined && saved.fetched !== undefined,
      ...(evidenceGroup?.focus !== undefined ? { focus: evidenceGroup.focus } : {}),
      ...(evidenceGroup?.evidence !== undefined ? { evidence: evidenceGroup.evidence } : {}),
      ...(error !== undefined ? { error } : {}),
    },
  }
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
  const base = { ...state, pendingCalls }

  if (event.data.message.isError) return base

  if (call.name === 'web_search') {
    return applySearchMeta(base, event.data.meta)?.next ?? base
  }

  if (call.name === 'web_read') {
    // Ordinary tool errors include invalid input and cancellation; no stage facts were committed.
    return applyReadMeta(base, event.data.meta, event.time)?.next ?? base
  }

  return base
}

// Derived index over existing tool facts, not a new whole-state event domain.
export const materialsProjection: ProjectionDefinition<'bansoMaterials', MaterialsState> = {
  key: 'bansoMaterials',
  stateVersion: 4,
  stateSchema,
  init: () => ({ budget: { used: 0 }, items: {}, urlIndex: {}, nextHandle: 1, pendingCalls: {} }),
  apply: applyMaterials,
}
