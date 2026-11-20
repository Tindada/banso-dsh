import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-tools'

/** Keep page reads on web_read without disabling the underlying web service. */
export function registerFetchRestriction(ctx: Context): void {
  const ownerScope = scopeOf(ctx)
  const restrictions = new Map<Agent, () => void>()
  let refreshing = false
  let stopped = false

  const clear = (): void => {
    const disposers = [...restrictions.values()]
    restrictions.clear()
    for (const dispose of disposers) dispose()
  }

  const refresh = (): void => {
    if (stopped || refreshing) return
    refreshing = true
    try {
      clear()
      for (const agent of ctx.agents.list()) {
        if (ownerScope !== undefined && !scopeChainOf(scopeOf(agent.ctx)).includes(ownerScope)) continue
        if (ctx.tools.get('web_fetch', agent) === undefined) continue
        try {
          restrictions.set(agent, agent.ctx.tools.restrict({ deny: ['web_fetch'] }))
        } catch (error) {
          // Agent-local registrations cannot be masked by restrict(); ctx.tools.guard below denies execution.
          if (!(error instanceof Error) || !error.message.includes('unknown global tool')) throw error
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

  ctx.tools.guard(exec => exec.name === 'web_fetch'
    ? 'web_fetch is disabled by materials; use web_read instead'
    : undefined)
}
