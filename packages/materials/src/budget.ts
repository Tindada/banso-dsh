import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

export function isResearchTool(name: string): boolean {
  return name === 'web_search' || name === 'web_read'
}

export function formatResearchBudget(limit: number, attempts: number): string {
  return `Research budget: ${limit}. Attempts used: ${attempts}. Remaining: ${Math.max(0, limit - attempts)}.`
}

function appendBudgetBlock(content: readonly ContentBlock[], budgetLine: string): ContentBlock[] {
  const blocks = [...content]
  const last = blocks.at(-1)
  if (last?.type === 'text') {
    blocks[blocks.length - 1] = { ...last, text: `${last.text}\n\n${budgetLine}` }
    return blocks
  }
  blocks.push({ type: 'text', text: budgetLine })
  return blocks
}

/** Direct default-loop calls are logged before their ordered guard stage. */
export function registerResearchBudget(ctx: Context, limit: number): void {
  const used = (agent: Agent): number => {
    const state = ctx.sessionProjections.stateOf(agent.session, 'bansoMaterials')
    if (state === undefined) throw new Error('Materials projection is not registered')
    return state.budget.used
  }
  ctx.systemPrompt.section({
    name: 'banso:research-budget',
    order: ctx.systemPrompt.getSectionOrder('TOOL_WEB_SEARCH') - 1,
    interpolate: false,
    text: `Research budget: up to ${limit} attempts per turn across web_search and web_read. Each call attempt counts once, including failed or rejected attempts. Remaining budget is reported in each research tool result.`,
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
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    if (decision.kind !== 'accept' || decision.value !== undefined) return decision
    if (!isResearchTool(exec.name) || exec.agent === undefined) return decision
    const baseContent = decision.content ?? result.content
    const budgetLine = formatResearchBudget(limit, used(exec.agent))
    return {
      kind: 'accept',
      content: appendBudgetBlock(baseContent, budgetLine),
      ...(decision.additionalContexts !== undefined ? { additionalContexts: decision.additionalContexts } : {}),
    }
  })
}
