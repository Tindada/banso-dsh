import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { createReadTool } from './read.js'
import type { ReadConfig } from './read.js'
import { wrapWebTool } from './output.js'
import { registerWebGuidance } from './prompts.js'

export const name = 'banso-tool-web'
export const inject = ['tools', 'agents', 'sessionProjections', 'web', 'llm', 'systemPrompt']
const names = ['web_search'] as const

export interface Config extends ReadConfig {}
export const Config: z<Config> = z.object({
  provider: z.string(),
  model: z.string(),
  maxInputBytes: z.number().step(1).min(1).default(200_000),
  maxOutputTokens: z.number().step(1).min(1).default(4_096),
  timeoutMs: z.number().step(1).min(1).max(2_147_483_647).default(120_000),
})

export function apply(ctx: Context, config: Config): void {
  if ((config.provider === undefined) !== (config.model === undefined)) {
    throw new Error('Extraction provider and model must be configured together')
  }
  ctx.tools.register(createReadTool(ctx, config))
  registerWebGuidance(ctx)
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
