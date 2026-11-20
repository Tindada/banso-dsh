import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { ToolDefinition, ToolRegistrationOptions } from '@deepseek-ai/dsh-tools'
import type { MaterialsState } from '../types.js'

/** Retain native search execution, output and metadata while updating tool description for material handles. */
export function wrapWebTool(original: ToolDefinition): ToolDefinition {
  if (original.name === 'web_search') {
    return {
      ...original,
      description: 'Search the web for sources. Returns discovered source URLs, titles, available snippets, stable session-local material handles, and an optional search answer.',
    }
  }

  throw new Error(`Unsupported web tool: ${original.name}`)
}

const names = ['web_search'] as const

export function registerSearchWrapper(
  ctx: Context, limit?: number, projection?: ProjectionHandle<MaterialsState>,
): void {
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
          const options: ToolRegistrationOptions = limit !== undefined && projection !== undefined
            ? { when: context => limit > 0 && projection.stateOf(context.agent.session).budget.used < limit }
            : {}
          disposers.push(agent.ctx.tools.register(wrapped, options))
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
