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

const fetchMetaSchema = z.object({
  content: z.string(),
  url: urlSchema,
  statusCode: z.number().int(),
  truncated: z.boolean(),
})

const materialSchema = sourceSchema.extend({
  handle: z.string(),
  fetched: z.object({
    content: z.string(),
    finalUrl: urlSchema,
    statusCode: z.number().int(),
    truncated: z.boolean(),
    time: z.number(),
  }).optional(),
  lastFetch: z.object({
    status: z.enum(['success', 'error']),
    time: z.number(),
    statusCode: z.number().int().optional(),
    error: z.string().optional(),
  }).optional(),
})

const stateSchema: z.ZodType<MaterialsState> = z.object({
  items: z.record(z.string(), materialSchema),
  urlIndex: z.record(z.string(), z.string()),
  nextHandle: z.number().int().positive(),
  pendingCalls: z.record(
    z.string(),
    z.object({
      name: z.enum(['web_search', 'web_fetch']),
      callId: z.string(),
      turn: z.number().int(),
      url: urlSchema.optional(),
    }),
  ),
})

function parseCall(event: SessionEvent<'tool/call'>): PendingCall | undefined {
  const { name, callId, turn } = event.data
  if (name !== 'web_search' && name !== 'web_fetch') return undefined

  let args: unknown
  try {
    args = JSON.parse(event.data.arguments)
  } catch {
    return undefined
  }

  if (name === 'web_fetch') {
    const parsed = z.object({ url: urlSchema }).safeParse(args)
    return parsed.success ? { name, callId, turn, url: parsed.data.url } : undefined
  }

  if (name === 'web_search') {
    const parsed = z.object({queries: z.array(z.string().trim().min(1)).min(1),}).safeParse(args)

    return parsed.success ? { name, callId, turn } : undefined
  }

  return undefined
}

/** Updates only detached containers; existing records remain immutable. */
function upsert(state: MaterialsState, url: string, update: (item: Material) => Material): void {
  const handle = Object.hasOwn(state.urlIndex, url) ? state.urlIndex[url]! : `S${state.nextHandle++}`

  state.urlIndex[url] = handle
  state.items[handle] = update(state.items[handle] ?? { handle, url })
}

export function applyMaterials(state: MaterialsState, event: SessionEvent): MaterialsState {
  if (event.type === 'tool/call') {
    const call = parseCall(event)
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
  const text = event.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')

  if (call.name === 'web_search') {
    if (event.data.message.isError) return next
    const parsed = searchMetaSchema.safeParse(event.data.meta)
    if (!parsed.success) return next

    for (const source of parsed.data.sources) {
      upsert(next, source.url, item => ({ ...item, ...source }))
    }
    return next
  }

  if (call.name === 'web_fetch') {
    const url = call.url!
    if (event.data.message.isError) {
      upsert(next, url, item => ({
        ...item,
        lastFetch: {
          status: 'error',
          time: event.time,
          error: event.data.error?.reason ?? text,
        },
      }))
      return next
    }

    const parsed = fetchMetaSchema.safeParse(event.data.meta)
    if (!parsed.success) return next
    const { statusCode, truncated } = parsed.data

    if (statusCode < 200 || statusCode >= 300) {
      upsert(next, url, item => ({
        ...item,
        lastFetch: {
          status: 'error',
          time: event.time,
          statusCode,
          error: `HTTP ${statusCode}`,
        },
      }))
    } else {
      upsert(next, url, item => ({
        ...item,
        fetched: {
          content: parsed.data.content,
          finalUrl: parsed.data.url,
          statusCode,
          truncated,
          time: event.time,
        },
        lastFetch: { status: 'success', time: event.time, statusCode },
      }))
    }
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
