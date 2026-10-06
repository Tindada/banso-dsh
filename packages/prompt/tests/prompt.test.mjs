import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, { LlmAdapter, LlmError, createUserMessage } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt, { renderPrompt, renderContextSnapshot } from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as BansoPrompt from '../lib/index.js'

const T1 = '2026-10-04T08:00:00.000Z'
const T2 = '2026-10-05T09:00:00.000Z'
const message = text => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const textOf = msg => msg.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
const snapshots = request => request.messages.filter(msg => textOf(msg).includes('Research reference time (UTC)'))

class Adapter extends LlmAdapter {
  requests = []
  onRequest = () => {}
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(request) {
    this.requests.push(request)
    const chunks = this.onRequest(request, this.requests.length)
    if (chunks) { yield* chunks; return }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'done' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function harness(t) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const plugin of [Llm, Sessions, Projections]) await ctx.plugin(plugin)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: true, personaPrefix: 'Banso' })
  for (const plugin of [Tools, Agents]) await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  const fiber = await ctx.plugin(BansoPrompt)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const create = id => ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
  return { ctx, fiber, adapter, create }
}

test('first request gets time; steering and later steps retain it; next turn refreshes it', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(T1) })
  const { ctx, adapter, create } = await harness(t)
  const agent = await create('time-turns')
  assert.equal(renderContextSnapshot(await ctx.systemPrompt.assemble()), '')
  assert.equal(renderContextSnapshot(await ctx.systemPrompt.assemble({ agent, scope: agent })), '')
  adapter.onRequest = (_, count) => {
    if (count === 1) {
      t.mock.timers.setTime(new Date(T2).getTime())
      agent.steer(message('补充要求'))
    }
  }
  agent.followup(message('最近一天的新闻'))
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 2)
  for (const request of adapter.requests) {
    assert.equal(snapshots(request).length, 1)
    assert.match(textOf(snapshots(request)[0]), new RegExp(T1, 'u'))
    const system = textOf(request.messages.find(msg => msg.role === 'system'))
    assert.match(system, /web_search/u)
    assert.match(system, /web_read with a specific focus/u)
    assert.match(system, /Saved pages are reused/u)
  }
  agent.followup(message('再研究一次'))
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 3)
  assert.equal(snapshots(adapter.requests[2]).length, 2)
  assert.match(textOf(snapshots(adapter.requests[2]).at(-1)), new RegExp(T2, 'u'))
  assert.equal(textOf(adapter.requests[0].messages[0]), textOf(adapter.requests[2].messages[0]))
})

test('retry reuses reference time without duplicating runtime context', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(T1) })
  const { ctx, adapter, create } = await harness(t)
  const agent = await create('time-retry')
  ctx.on('agent/request-error', () => ({ kind: 'retry' }))
  adapter.onRequest = (_, count) => {
    if (count === 1) {
      t.mock.timers.setTime(new Date(T2).getTime())
      throw new LlmError('temporary failure', 'RATE_LIMIT')
    }
  }
  agent.followup(message('研究'))
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 2)
  for (const request of adapter.requests) {
    assert.equal(snapshots(request).length, 1)
    assert.match(textOf(snapshots(request)[0]), new RegExp(T1, 'u'))
  }
})

test('tool execution and the following model step keep the original reference time', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(T1) })
  const { ctx, adapter, create } = await harness(t)
  let executions = 0
  ctx.tools.register(defineContentToolFixture({
    name: 'read_fixture', description: 'Read a fixture', parameters: {},
    async execute() {
      executions++
      t.mock.timers.setTime(new Date(T2).getTime())
      return [{ type: 'text', text: 'fixture evidence' }]
    },
  }))
  adapter.onRequest = (_, count) => count === 1 ? [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'read_fixture', argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-1', name: 'read_fixture', arguments: '{}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ] : undefined
  const agent = await create('time-tools')
  agent.followup(message('读取资料'))
  await agent.whenIdle()
  assert.equal(executions, 1)
  assert.equal(adapter.requests.length, 2)
  assert.ok(adapter.requests[1].messages.some(msg => msg.role === 'tool'))
  for (const request of adapter.requests) {
    assert.equal(snapshots(request).length, 1)
    assert.match(textOf(snapshots(request)[0]), new RegExp(T1, 'u'))
  }
})

test('agents are isolated and plugin disposal removes registrations and listener', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(T1) })
  const { ctx, fiber, adapter, create } = await harness(t)
  const first = await create('time-first')
  const second = await create('time-second')
  first.followup(message('第一项研究'))
  await first.whenIdle()
  t.mock.timers.setTime(new Date(T2).getTime())
  second.followup(message('第二项研究'))
  await second.whenIdle()
  const assemble = agent => ctx.systemPrompt.assemble({ agent, scope: agent })
  assert.match(renderContextSnapshot(await assemble(first)), new RegExp(T1, 'u'))
  assert.match(renderContextSnapshot(await assemble(second)), new RegExp(T2, 'u'))
  await fiber.dispose()
  assert.equal(renderContextSnapshot(await assemble(first)), '')
  assert.doesNotMatch(renderPrompt(await assemble(first)), /web_search/u)
  // Reloading must not resurrect state retained by the disposed plugin.
  await ctx.plugin(BansoPrompt)
  assert.equal(renderContextSnapshot(await assemble(first)), '')
  first.followup(message('新的研究'))
  await first.whenIdle()
  assert.match(textOf(snapshots(adapter.requests.at(-1)).at(-1)), new RegExp(T2, 'u'))
})
