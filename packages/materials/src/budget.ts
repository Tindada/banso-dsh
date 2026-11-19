import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

export function isResearchTool(name: string): boolean {
  return name === 'web_search' || name === 'web_read'
}

/** Direct default-loop calls are logged before their ordered guard stage. */
export function registerResearchBudget(ctx: Context, limit: number): void {
  const used = (agent: Agent): number => {
    const state = ctx.sessionProjections.stateOf(agent.session, 'bansoMaterials')
    if (state === undefined) throw new Error('Materials projection is not registered')
    return state.budget.used
  }
  ctx.systemPrompt.context({
    name: 'banso:research-budget',
    order: 300,
    required: true,
    interpolate: false,
    text: ({ agent }) => {
      if (agent === undefined) return ''
      const attempts = used(agent)
      return `Research budget: ${limit}. Attempts used: ${attempts}. Remaining: ${Math.max(0, limit - attempts)}.\nEach web_search or web_read call attempt counts once, including failed or rejected attempts.`
    },
  })
  ctx.on('system-prompt/assemble', async (_assembly, { agent }, next) => {
    const assembly = await next()
    if (agent === undefined || used(agent) < limit) return assembly
    return { ...assembly, tools: assembly.tools.filter(tool => !isResearchTool(tool.name)) }
  })
  ctx.tools.guard(exec => {
    if (!isResearchTool(exec.name)) return undefined
    if (exec.agent === undefined) return 'Research tools require an agent'
    return used(exec.agent) <= limit ? undefined : 'Research budget exhausted'
  })
}
