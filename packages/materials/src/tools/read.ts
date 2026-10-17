import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ValueSchemaSpec, InferValue } from '@deepseek-ai/dsh-tools'
import { getPage, pageProperties } from './page.js'
import { extractEvidence } from '../extraction/extract.js'
import type { ExtractionConfig } from '../extraction/extract.js'

export interface ReadConfig extends ExtractionConfig { timeoutMs: number }

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...pageProperties,
    mode: { type: 'string', enum: ['direct', 'extract'], required: true },
    focus: { type: 'string' },
    evidence: { type: 'string' },
    extractMs: { type: 'number' },
    usage: { type: 'object', additionalProperties: true },
  },
} as const satisfies ValueSchemaSpec

type ReadResult = InferValue<typeof schema>

export function createReadTool(ctx: Context, config: ReadConfig): ToolDefinition {
  return defineTool({
    name: 'web_read',
    description: 'Read a page directly or extract evidence for a given focus. Saved pages are reused, not refreshed. Shows page text (direct) or accumulated evidence (extract) in the next materials snapshot and makes the material visible. New sources receive handles. Returns a status receipt.',
    parameters: {
      target: { type: 'string', required: true, description: 'One material handle or full HTTP(S) URL.' },
      mode: { type: 'string', enum: ['direct', 'extract'], required: true, description: 'direct reads page text; extract uses a model to extract evidence for a focus.' },
      focus: { type: 'string', description: 'Required and non-empty for extract; ignored for direct.' },
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<ReadResult> {
      const { target, mode, focus } = args
      if (mode === 'extract' && (focus === undefined || focus.trim().length === 0)) throw new Error('focus must be a non-empty string')
      exec.signal.throwIfAborted()
      if (exec.agent === undefined) throw new Error('web_read requires an agent')
      const session = exec.agent.session
      const page = await getPage(ctx, session, target, exec.signal)
      const result: ReadResult = { ...page.meta, mode, ...(mode === 'extract' ? { focus } : {}) }
      exec.signal.throwIfAborted()
      if (page.content === undefined || mode === 'direct') return result
      const extracted = await extractEvidence(ctx, config, session, { focus: focus!, title: page.title, content: page.content }, exec.signal)
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
        else if (result.mode === 'direct') lines.push(result.content === undefined
          ? 'Saved page reused. Page text is available in the next materials snapshot.'
          : 'Page text is available in the next materials snapshot.')
        else if (result.evidence === '') lines.push('No relevant evidence found.')
        else lines.push(result.content === undefined ? 'Evidence extracted from saved page.' : 'Evidence extracted.')
        return [{ type: 'text', text: lines.join(' ') }]
      },
      presentationMeta: (_args, value) => value,
    },
  })
}
