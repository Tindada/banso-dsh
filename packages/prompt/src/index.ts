import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { RESEARCH_PROMPT, referenceTimeText } from './prompts.js'

export const name = 'banso-prompt'
export const inject = ['systemPrompt', 'agents']

export interface Config {
  researchPrompt?: string
  omitSections?: string[]
  omitContexts?: string[]
}

export const Config: z<Config> = z.object({
  researchPrompt: z.string(),
  omitSections: z.array(z.string()).default([]),
  omitContexts: z.array(z.string()).default([]),
})

export function apply(ctx: Context, config: Config): void {
  const referenceTimes = new WeakMap<Agent, { turn: number; referenceTime: string }>()
  const omitSections = new Set(config.omitSections ?? [])
  const omitContexts = new Set(config.omitContexts ?? [])

  // claim runs before prompt assembly; pre-step middleware would be too late.
  ctx.on('agent/inbox/claimed', ({ agent, turn }) => {
    if (referenceTimes.get(agent)?.turn === turn) return
    referenceTimes.set(agent, { turn, referenceTime: new Date().toISOString() })
  })

  ctx.systemPrompt.section({
    name: 'banso:research',
    order: 1000,
    text: config.researchPrompt ?? RESEARCH_PROMPT,
    interpolate: false,
  })

  ctx.systemPrompt.context({
    name: 'banso:reference-time',
    order: 0,
    text: ({ agent }) => {
      const state = agent === undefined ? undefined : referenceTimes.get(agent)
      return state === undefined ? '' : referenceTimeText(state.referenceTime)
    },
  })

  if (omitSections.size > 0 || omitContexts.size > 0) {
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const assembly = await next()
      return {
        ...assembly,
        sections: assembly.sections.filter(section => !omitSections.has(section.name)),
        contexts: assembly.contexts.filter(entry => !omitContexts.has(entry.name)),
      }
    })
  }
}
