import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import type {} from 'banso-dsh-materials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ValueSchemaSpec, InferValue } from '@deepseek-ai/dsh-tools'
import { fetchMetaFromValue, formatFetchOutput } from '@deepseek-ai/dsh-tool-web'
import type { WebFetchMeta } from '@deepseek-ai/dsh-tool-web'
import { extractEvidence } from './extract.js'
import type { ExtractionConfig } from './extract.js'

export interface ReadConfig extends ExtractionConfig { timeoutMs: number }

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requestUrl: { type: 'string', required: true },
    focus: { type: 'string', required: true },
    content: { type: 'string' },
    finalUrl: { type: 'string' },
    truncated: { type: 'boolean' },
    evidence: { type: 'string' },
    error: { type: 'string' },
    fetchMs: { type: 'number' },
    extractMs: { type: 'number' },
    usage: { type: 'object', additionalProperties: true },
  },
} as const satisfies ValueSchemaSpec

type ReadResult = InferValue<typeof schema>

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)

export function createReadTool(ctx: Context, config: ReadConfig): ToolDefinition {
  return defineTool({
    name: 'web_read',
    description: 'Read one material handle (S1) or full HTTP(S) URL and extract evidence for a focus. Saved pages are reused. Call again with a new focus for follow-up questions. Evidence and new handles appear in the next materials snapshot.',
    parameters: {
      target: { type: 'string', required: true, description: 'One material handle or full HTTP(S) URL.' },
      focus: { type: 'string', required: true, description: 'The question or facts to extract from this source.' },
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<ReadResult> {
      const { target, focus } = args
      if (focus.trim().length === 0) throw new Error('focus must be a non-empty string')
      exec.signal.throwIfAborted()
      if (exec.agent === undefined) throw new Error('web_read requires an agent')
      const session = exec.agent.session
      const state = ctx.sessionProjections.stateOf(session, 'bansoMaterials')
      if (state === undefined) throw new Error('Materials projection is not registered')
      const handle = /^S[1-9]\d*$/.test(target)
      const item = handle ? state.items[target] : state.items[state.urlIndex[target] ?? '']
      if (handle && item === undefined) throw new Error(`Unknown material handle: ${target}`)
      const requestUrl = item?.url ?? target
      if (!/^https?:\/\//.test(requestUrl) || !URL.canParse(requestUrl)) throw new Error(`Invalid read target: ${target}`)
      const result: ReadResult = { requestUrl, focus }
      let content = item?.fetched?.content
      if (content === undefined) {
        const started = performance.now()
        try {
          const fetched = await ctx.web.fetch({ url: requestUrl }, exec.signal)
          exec.signal.throwIfAborted()
          if (fetched.statusCode < 200 || fetched.statusCode >= 300) {
            result.error = `Fetch failed: HTTP ${fetched.statusCode}`
            return result
          }
          content = formatFetchOutput(fetched, Infinity)
          const meta = fetchMetaFromValue(fetched, Infinity) as unknown as WebFetchMeta
          result.content = content
          result.finalUrl = fetched.url
          result.truncated = meta.truncated
        } catch (error) {
          exec.signal.throwIfAborted()
          result.error = `Fetch failed: ${errorText(error)}`
          return result
        } finally {
          result.fetchMs = Math.round(performance.now() - started)
        }
      }
      const extracted = await extractEvidence(ctx, config, session, { focus, title: item?.title, content }, exec.signal)
      Object.assign(result, extracted)
      exec.signal.throwIfAborted()
      return result
    },
    output: {
      schema,
      render: (args, result) => {
        const lines = [`${args.target} — ${result.requestUrl}:`]
        if (result.content !== undefined) lines.push(`Page fetched. Truncated: ${result.truncated}.`)
        if (result.error !== undefined) lines.push(result.error)
        else if (result.evidence === '') lines.push('No relevant evidence found.')
        else lines.push(result.content === undefined ? 'Evidence extracted from saved page.' : 'Evidence extracted.')
        return [{ type: 'text', text: lines.join(' ') }]
      },
      presentationMeta: (_args, value) => value,
    },
  })
}
