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
import * as ToolExecutorNative from '@deepseek-ai/dsh-tool-executor-native'
import Web from '@deepseek-ai/dsh-web'
import * as NativeTools from '@deepseek-ai/dsh-tool-web'
import * as Materials from '../lib/index.js'

const textOf = result => result.content.map(block => block.text ?? '').join('\n')

async function setup(t, limit) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, ToolExecutorNative, Agents]) await ctx.plugin(plugin)
  await ctx.plugin(Loop, { agents: [] })
  await ctx.plugin(Web)
  await ctx.plugin(NativeTools, { fetch: false })
  const fiber = await ctx.plugin(Materials, { researchBudget: limit })
  const agent = await ctx.agentLoop.create(SessionId('budget'))
  const other = await ctx.agentLoop.create(SessionId('other'))
  const state = () => ctx.sessionProjections.stateOf(agent.session, 'bansoMaterials')
  const resolve = target => ctx.tools.resolve({ agent: target, modelSelection: { provider: 'mock', model: 'mock' }, signal: new AbortController().signal })
  const assemble = async target => {
    const toolSet = await resolve(target)
    try {
      return await ctx.systemPrompt.assemble({ agent: target, scope: target, toolSet })
    } finally {
      toolSet.dispose()
    }
  }
  const names = async target => (await assemble(target)).tools.map(tool => tool.name)
  const budgetSection = async target => (await assemble(target))
    .sections.find(entry => entry.name === 'banso:research-budget')
  const budgetContext = async target => (await assemble(target))
    .contexts.find(entry => entry.name === 'banso:research-budget')
  let n = 0
  const call = (target = agent) => {
    const callId = `call-${++n}`
    target.session.append('tool/call', { turn: 1, step: 1, callId, name: 'web_read', arguments: '{}' })
    return callId
  }
  const execute = async (callId, target = agent, admittedSet) => {
    const signal = new AbortController().signal
    const toolSet = admittedSet ?? (target === undefined ? undefined : await resolve(target))
    try {
      const batch = await ctx.tools.execute({
        ...(target === undefined ? {} : { agent: target }),
        ...(toolSet === undefined ? {} : { toolSet }),
        calls: [{ type: 'tool-call', id: callId, name: 'web_read', arguments: JSON.stringify({ target: 'S999', mode: 'direct' }) }],
        signal,
      })
      return batch.results[0].result
    } finally {
      if (admittedSet === undefined) toolSet?.dispose()
    }
  }
  return { ctx, fiber, agent, other, state, resolve, names, budgetSection, budgetContext, call, execute }
}

test('configuration accepts false, zero, and safe integer limits and defaults to 15', () => {
  assert.equal(Materials.Config({}).researchBudget, 15)
  for (const researchBudget of [false, 0, 1, Number.MAX_SAFE_INTEGER]) assert.equal(Materials.Config({ researchBudget }).researchBudget, researchBudget)
  for (const researchBudget of [true, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => Materials.Config({ researchBudget }))
  }
})

test('false budget disables research budget limits, prompt section, and footer', async t => {
  const h = await setup(t, false)
  assert.ok((await h.names(h.agent)).includes('web_search'))
  assert.ok((await h.names(h.agent)).includes('web_read'))
  assert.equal(await h.budgetSection(h.agent), undefined)
  assert.equal(await h.budgetContext(h.agent), undefined)
  for (let i = 0; i < 3; i++) {
    const result = await h.execute(h.call())
    assert.doesNotMatch(textOf(result), /budget exhausted/)
    assert.doesNotMatch(textOf(result), /Research budget:/)
  }
  assert.ok((await h.names(h.agent)).includes('web_search'))
  assert.ok((await h.names(h.agent)).includes('web_read'))
})

test('zero budget hides both tools without adding runtime context', async t => {
  const h = await setup(t, 0)
  assert.ok((await h.names(h.agent)).every(name => !['web_search', 'web_read'].includes(name)))
  assert.equal(await h.budgetContext(h.agent), undefined)
  assert.match((await h.budgetSection(h.agent)).text, /Research budget: up to 0 attempts per turn/)
  const result = await h.execute(h.call())
  assert.equal(result.isError, true)
})

test('budget is session-local, reports usage on failed tool results, and disappears on plugin disposal', async t => {
  const h = await setup(t, 1)
  assert.equal(await h.budgetContext(h.agent), undefined)
  assert.match((await h.budgetSection(h.agent)).text, /Research budget: up to 1 attempts per turn/)
  const admitted = await h.resolve(h.agent)
  t.after(() => admitted.dispose())
  const id = h.call()
  const failed = await h.execute(id, h.agent, admitted)
  assert.equal(failed.isError, true)
  assert.doesNotMatch(textOf(failed), /budget exhausted/)
  assert.match(textOf(failed), /Unknown material handle: S999[\s\S]*Research budget: 1\. Attempts used: 1\. Remaining: 0\./)
  assert.ok(!(await h.names(h.agent)).includes('web_search'))
  assert.ok(!(await h.names(h.agent)).includes('web_read'))
  assert.ok((await h.names(h.other)).includes('web_search'))
  assert.match(textOf(await h.execute(h.call(), h.agent, admitted)), /budget exhausted/)
  await h.fiber.dispose()
  assert.ok((await h.names(h.agent)).includes('web_search'))
  assert.equal(await h.budgetSection(h.agent), undefined)
  const batch = await h.ctx.tools.execute({
    agent: h.agent,
    calls: [{ type: 'tool-call', id: 'disposed', name: 'web_search', arguments: JSON.stringify({ queries: ['test'] }) }],
    signal: new AbortController().signal,
  })
  assert.doesNotMatch(textOf(batch.results[0].result), /budget exhausted/)
  await h.ctx.plugin(Materials, { researchBudget: 1 })
  assert.equal(h.state().budget.used, 2)
  assert.ok(!(await h.names(h.agent)).includes('web_search'))
  assert.equal(await h.budgetContext(h.agent), undefined)
  assert.match((await h.budgetSection(h.agent)).text, /Research budget: up to 1 attempts per turn/)
})
