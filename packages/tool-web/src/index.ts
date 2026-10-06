import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from 'banso-dsh-materials'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { wrapWebTool } from './output.js'

export const name = 'banso-tool-web'
export const inject = ['tools', 'agents', 'sessionProjections']
const names = ['web_search', 'web_fetch'] as const

export function apply(ctx: Context): void {
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
        const disposers: (() => void)[] = []
        registrations.set(agent, disposers)
        for (const name of names) {
          const original = ctx.tools.get(name)
          if (original === undefined || ctx.tools.get(name, agent) !== original) continue
          let wrapped = wrappers.get(original)
          if (wrapped === undefined) {
            wrapped = wrapWebTool(original, (exec, handle) => {
              if (exec.agent === undefined) return undefined
              return ctx.sessionProjections.stateOf(exec.agent.session, 'bansoMaterials')?.items[handle]?.url
            })
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
