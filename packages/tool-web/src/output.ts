import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { WebFetchMeta } from '@deepseek-ai/dsh-tool-web'
import { fetchMetaFromValue, formatFetchOutput } from '@deepseek-ai/dsh-tool-web'
import type { WebFetchResult, WebSearchResult } from '@deepseek-ai/dsh-web'

function parseTarget(args: unknown): string {
  const target = (args as { target?: unknown } | null | undefined)?.target
  if (typeof target !== 'string') throw new Error('target must be a string')
  return target
}

function isHttpUrl(value: string): boolean {
  try { return /^https?:\/\//.test(value) && ['http:', 'https:'].includes(new URL(value).protocol) }
  catch { return false }
}

type FetchResult = WebFetchResult & { requestUrl: string }

/** Retain native search; resolve a single fetch target before native execution. */
export function wrapWebTool(
  original: ToolDefinition,
  lookupHandle: (exec: ToolRunContext, handle: string) => string | undefined,
): ToolDefinition {
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
    // Native presenters read args.url; use the default presentation for target calls.
    const { presentCall: _call, presentResult: _result, ...base } = original
    return {
      ...base,
      description: 'Fetch one material handle (such as S1) or a full HTTP(S) URL. Call separately for multiple pages. New URLs receive handles in the next materials snapshot.',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string', description: 'A material handle (S1) or full HTTP(S) URL.' } },
        required: ['target'],
      },
      // The native classifier validates args.url; target calls need their own classifier.
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const target = parseTarget(args)
        exec.signal.throwIfAborted()
        const requestUrl = /^S[1-9]\d*$/.test(target) ? lookupHandle(exec, target) : target
        if (requestUrl === undefined) throw new Error(`Unknown material handle: ${target}`)
        if (!isHttpUrl(requestUrl)) throw new Error(`Invalid fetch target: ${target}`)
        const result = await original.execute({ url: requestUrl }, exec) as WebFetchResult
        exec.signal.throwIfAborted()
        return { ...result, requestUrl }
      },
      output: {
        ...original.output,
        schema: {
          ...original.output.schema,
          properties: { ...original.output.schema.properties, requestUrl: { type: 'string' } },
          required: [...(original.output.schema.required ?? []), 'requestUrl'],
        },
        render: (args, value: unknown) => {
          const result = value as FetchResult
          const meta = fetchMetaFromValue(result, Infinity) as unknown as WebFetchMeta
          const outcome = meta.statusCode >= 200 && meta.statusCode < 300 ? 'completed' : 'failed'
          return [{ type: 'text', text: `${(args as { target: string }).target} — ${result.requestUrl}: Fetch ${outcome}. HTTP ${meta.statusCode}. Truncated: ${meta.truncated}.` }]
        },
        presentationMeta: (_args, value: unknown) => {
          const result = value as FetchResult
          const meta = fetchMetaFromValue(result, Infinity) as unknown as WebFetchMeta
          // Preserve the converted provider body without the model-output length cap.
          const content = formatFetchOutput(result, Infinity)
          return { ...meta, content, requestUrl: result.requestUrl }
        },
      },
    }
  }

  throw new Error(`Unsupported web tool: ${original.name}`)
}
