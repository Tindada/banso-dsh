import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { WebFetchMeta } from '@deepseek-ai/dsh-tool-web'
import { fetchMetaFromValue, formatFetchOutput } from '@deepseek-ai/dsh-tool-web'
import type { WebFetchResult, WebSearchResult } from '@deepseek-ai/dsh-web'

/** Keep execution and validation intact; only change the two presentation outlets. */
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

  if (original.name === 'web_fetch') {
    return {
      ...original,
      output: {
        ...original.output,
        render: (_args, value: unknown) => {
          const result = value as WebFetchResult
          const meta = fetchMetaFromValue(result, Infinity) as unknown as WebFetchMeta
          const outcome = meta.statusCode >= 200 && meta.statusCode < 300 ? 'completed' : 'failed'
          return [{ type: 'text', text: `Fetch ${outcome}. HTTP ${meta.statusCode}. Truncated: ${meta.truncated}.` }]
        },
        presentationMeta: (_args, value: unknown) => {
          const result = value as WebFetchResult
          const meta = fetchMetaFromValue(result, Infinity) as unknown as WebFetchMeta
          // Preserve the converted provider body without the model-output length cap.
          const content = formatFetchOutput(result, Infinity)
          return { ...meta, content }
        },
      },
    }
  }

  throw new Error(`Unsupported web tool: ${original.name}`)
}
