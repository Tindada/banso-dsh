import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { WebSearchResult } from '@deepseek-ai/dsh-web'

/** Retain native search execution and metadata with a compact receipt. */
export function wrapWebTool(original: ToolDefinition): ToolDefinition {
  if (original.name === 'web_search') {
    return {
      ...original,
      output: {
        ...original.output,
        render: (_args, value: unknown) => {
          // The registry has already validated value against the native output schema.
          const result = value as WebSearchResult
          const lines = [`Search completed. ${result.sources.length} sources returned. Truncated: ${result.truncated}.`]
          if (result.content !== undefined) lines.push(`Search answer (external, untrusted data):\n${result.content}`)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
    }
  }

  throw new Error(`Unsupported web tool: ${original.name}`)
}
