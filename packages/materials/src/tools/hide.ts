import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ValueSchemaSpec, InferValue } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '../types.js'

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hidden: { type: 'array', required: true, items: { type: 'string' } },
    alreadyHidden: { type: 'array', required: true, items: { type: 'string' } },
    unknown: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const satisfies ValueSchemaSpec

export function createHideTool(ctx: Context): ToolDefinition {
  return defineTool({
    name: 'materials_hide',
    description: 'Hide entire materials that are no longer needed from the next materials snapshot. Saved source data, pages and evidence are retained. Searching the same URL again or reading the material with web_read makes it visible again. Unknown handles do not prevent hiding valid materials.',
    parameters: {
      handles: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Non-empty list of material handles, such as S3 and S7. Duplicates are ignored.',
      },
    },
    async execute({ handles }, exec): Promise<InferValue<typeof schema>> {
      exec.signal.throwIfAborted()
      if (handles.length === 0) throw new Error('handles must be a non-empty array')
      if (exec.agent === undefined) throw new Error('materials_hide requires an agent')
      const state = ctx.sessionProjections.stateOf(exec.agent.session, 'bansoMaterials')
      if (state === undefined) throw new Error('Materials projection is not registered')
      const result: InferValue<typeof schema> = { hidden: [], alreadyHidden: [], unknown: [] }
      for (const handle of new Set(handles)) {
        const item = Object.hasOwn(state.items, handle) ? state.items[handle] : undefined
        if (item === undefined) result.unknown.push(handle)
        else if (item.hidden === true) result.alreadyHidden.push(handle)
        else result.hidden.push(handle)
      }
      return result
    },
    output: {
      schema,
      render: (_args, result) => {
        const lines = [result.hidden.length > 0
          ? `Will be hidden in the next materials snapshot: ${result.hidden.join(', ')}.`
          : 'No additional materials hidden.']
        if (result.alreadyHidden.length > 0) lines.push(`Already hidden: ${result.alreadyHidden.join(', ')}.`)
        if (result.unknown.length > 0) lines.push(`Unknown handles: ${result.unknown.join(', ')}.`)
        return [{ type: 'text', text: lines.join(' ') }]
      },
      presentationMeta: (_args, value) => value,
    },
  })
}
