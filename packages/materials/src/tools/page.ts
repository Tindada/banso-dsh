import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import type {} from '../types.js'
import { fetchMetaFromValue, formatFetchOutput } from '@deepseek-ai/dsh-tool-web'
import type { WebFetchMeta } from '@deepseek-ai/dsh-tool-web'
import type { ValueSchemaSpec, InferValue } from '@deepseek-ai/dsh-tools'

export const pageProperties = {
  requestUrl: { type: 'string', required: true },
  content: { type: 'string' },
  finalUrl: { type: 'string' },
  truncated: { type: 'boolean' },
  error: { type: 'string' },
  fetchMs: { type: 'number' },
} as const

export const pageSchema = {
  type: 'object', additionalProperties: false, properties: pageProperties,
} as const satisfies ValueSchemaSpec

export type PageMeta = InferValue<typeof pageSchema>
interface PageResult {
  meta: PageMeta
  content?: string | undefined
  title?: string | undefined
}
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Acquire page data without mutating the projection; tool results commit the facts. */
export async function getPage(
  ctx: Context, session: Session, target: string, signal: AbortSignal,
): Promise<PageResult> {
  signal.throwIfAborted()
  const state = ctx.sessionProjections.stateOf(session, 'bansoMaterials')
  if (state === undefined) throw new Error('Materials projection is not registered')
  const handle = /^S[1-9]\d*$/.test(target)
  const item = handle ? state.items[target] : state.items[state.urlIndex[target] ?? '']
  if (handle && item === undefined) throw new Error(`Unknown material handle: ${target}`)
  const requestUrl = item?.url ?? target
  if (!/^https?:\/\//.test(requestUrl) || !URL.canParse(requestUrl)) throw new Error(`Invalid read target: ${target}`)
  const meta: PageMeta = { requestUrl }
  let content = item?.fetched?.content
  if (content === undefined) {
    const started = performance.now()
    try {
      const fetched = await ctx.web.fetch({ url: requestUrl }, signal)
      signal.throwIfAborted()
      if (fetched.statusCode < 200 || fetched.statusCode >= 300) {
        meta.error = `Fetch failed: HTTP ${fetched.statusCode}`
        return { meta }
      }
      content = formatFetchOutput(fetched, Infinity)
      const fetchedMeta = fetchMetaFromValue(fetched, Infinity) as unknown as WebFetchMeta
      meta.content = content
      meta.finalUrl = fetched.url
      meta.truncated = fetchedMeta.truncated
    } catch (error) {
      signal.throwIfAborted()
      meta.error = `Fetch failed: ${errorText(error)}`
      return { meta }
    } finally {
      meta.fetchMs = Math.round(performance.now() - started)
    }
  }
  return { meta, content, title: item?.title }
}
