import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Llm from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Web from '@deepseek-ai/dsh-web'
import * as NativeTools from '@deepseek-ai/dsh-tool-web'
import * as Materials from '../lib/index.js'

async function setup(t, limit) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, Agents]) await ctx.plugin(plugin)
  await ctx.plugin(Loop, { agents: [] })
  await ctx.plugin(Web)
  await ctx.plugin(NativeTools, { fetch: false })
  const fiber = await ctx.plugin(Materials, { researchBudget: limit })
  const agent = await ctx.agentLoop.create(SessionId('budget'))
  const other = await ctx.agentLoop.create(SessionId('other'))
  const state = () => ctx.sessionProjections.stateOf(agent.session, 'bansoMaterials')
  const names = async target => (await ctx.systemPrompt.assemble({ agent: target, scope: target })).tools.map(tool => tool.name)
  let n = 0
  const call = (target = agent) => {
    const callId = `call-${++n}`
    target.session.append('tool/call', { turn: 1, step: 1, callId, name: 'web_read', arguments: '{}' })
    return callId
  }
  const execute = (callId, target = agent) => ctx.tools.execute({ agent: target, callId, name: 'web_read', arguments: { target: 'S999', mode: 'direct' }, signal: new AbortController().signal })
  return { ctx, fiber, agent, other, state, names, call, execute }
}

test('configuration accepts zero and safe integer limits and defaults to 15', () => {
  assert.equal(Materials.Config({}).researchBudget, 15)
  for (const researchBudget of [0, 1, Number.MAX_SAFE_INTEGER]) assert.equal(Materials.Config({ researchBudget }).researchBudget, researchBudget)
  for (const researchBudget of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => Materials.Config({ researchBudget }))
  }
})

test('zero budget hides both tools and guards calls', async t => {
  const h = await setup(t, 0)
  assert.ok((await h.names(h.agent)).every(name => !['web_search', 'web_read'].includes(name)))
  const result = await h.execute(h.call())
  assert.match(result.error.message, /Research budget exhausted/)
  assert.equal(h.state().budget.used, 1)
  const noAgent = await h.ctx.tools.execute({ callId: 'no-agent', name: 'web_read', arguments: { target: 'S1', mode: 'direct' }, signal: new AbortController().signal })
  assert.match(noAgent.error.message, /require an agent/)
})

test('budget is session-local and filters and guards disappear on plugin disposal', async t => {
  const h = await setup(t, 1)
  const id = h.call()
  assert.doesNotMatch((await h.execute(id)).error.message, /budget exhausted/)
  assert.ok(!(await h.names(h.agent)).includes('web_search'))
  assert.ok((await h.names(h.other)).includes('web_search'))
  assert.ok((await h.names(h.agent)).includes('materials_hide'))
  assert.match((await h.execute(h.call())).error.message, /budget exhausted/)
  await h.fiber.dispose()
  assert.ok((await h.names(h.agent)).includes('web_search'))
  const result = await h.ctx.tools.execute({ agent: h.agent, name: 'web_search', arguments: { queries: ['test'] }, callId: 'disposed', signal: new AbortController().signal })
  assert.doesNotMatch(result.error?.message ?? '', /budget exhausted/)
  await h.ctx.plugin(Materials, { researchBudget: 1 })
  assert.equal(h.state().budget.used, 2)
  assert.ok(!(await h.names(h.agent)).includes('web_search'))
})
