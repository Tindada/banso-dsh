import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { WebSearchResult } from '@deepseek-ai/dsh-web'

/** Retain native search execution and metadata with a compact receipt. */
export function wrapWebTool(original: ToolDefinition): ToolDefinition {
  if (original.name === 'web_search') {
    return {
      ...original,
      description: 'Search the web for sources. Source URLs, titles, and available snippets appear in the next materials snapshot with stable handles; matching hidden materials become visible again. Returns a compact receipt and an optional search answer.',
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

const names = ['web_search'] as const

export function registerSearchWrapper(ctx: Context): void {
  const ownerScope = scopeOf(ctx)
  const registrations = new Map<Agent, (() => void)[]>()
  const wrappers = new WeakMap<ToolDefinition, ToolDefinition>()
  let refreshing = false
  let stopped = false

  const clear = (): void => {
    const entries = [...registrations.values()]
    registrations.clear()
    for (const disposers of entries) for (const dispose of disposers) dispose()
  }

  const refresh = (): void => {
    if (stopped || refreshing) return
    refreshing = true
    try {
      // Temporarily remove our own layer to observe inherited visibility and restrictions.
      // Otherwise a local wrapper itself would hide a newly applied restriction.
      clear()
      for (const agent of ctx.agents.list()) {
        // agents.list() is host-wide. Only wrap agents in our registration
        // scope (including descendants); an unscoped host mount covers all.
        if (ownerScope !== undefined && !scopeChainOf(scopeOf(agent.ctx)).includes(ownerScope)) continue
        const disposers: (() => void)[] = []
        registrations.set(agent, disposers)
        for (const name of names) {
          const original = ctx.tools.get(name, agent)
          if (original === undefined) continue
          let wrapped = wrappers.get(original)
          if (wrapped === undefined) {
            wrapped = wrapWebTool(original)
            wrappers.set(original, wrapped)
          }
          disposers.push(agent.ctx.tools.register(wrapped))
        }
      }
    } finally {
      refreshing = false
    }
  }

  ctx.effect(() => () => {
    stopped = true
    clear()
  })
  ctx.on('agent/created', () => { refresh() })
  ctx.on('agent/disposed', refresh)
  ctx.on('tools/change', refresh)
  refresh()
}
