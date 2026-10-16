import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { getPage, pageSchema } from './page.js'

export function createFetchTool(ctx: Context, config: { timeoutMs: number }): ToolDefinition {
  return defineTool({
    name: 'web_fetch',
    description: 'Fetch one material handle (S1) or full HTTP(S) URL for direct reading. Saved pages are reused, not refreshed. Page text and new handles appear in the next materials snapshot.',
    parameters: {
      target: { type: 'string', required: true, description: 'One material handle or full HTTP(S) URL.' },
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    async execute({ target }, exec) {
      exec.signal.throwIfAborted()
      if (exec.agent === undefined) throw new Error('web_fetch requires an agent')
      const page = await getPage(ctx, exec.agent.session, target, exec.signal)
      exec.signal.throwIfAborted()
      return page.meta
    },
    output: {
      schema: pageSchema,
      render: (args, result) => {
        const status = result.error !== undefined ? result.error
          : result.content !== undefined
            ? `Page fetched. Truncated: ${result.truncated}. Page text is available in the next materials snapshot.`
            : 'Saved page reused. Page text is available in the next materials snapshot.'
        return [{ type: 'text', text: `${args.target} — ${result.requestUrl}: ${status}` }]
      },
      presentationMeta: (_args, value) => value,
    },
  })
}
