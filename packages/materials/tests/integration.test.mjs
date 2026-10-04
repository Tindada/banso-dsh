import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Llm, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Web from '@deepseek-ai/dsh-web'
import * as WebTools from '@deepseek-ai/dsh-tool-web'
import * as Materials from '../lib/index.js'

const url = 'https://example.com/article'
class Adapter extends LlmAdapter {
  requests = []
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(request) {
    this.requests.push(request)
    const count = this.requests.length
    if (count < 3) {
      const name = count === 1 ? 'web_search' : 'web_fetch'
      const args = JSON.stringify(count === 1 ? { queries: ['news'] } : { url })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: `call-${count}`, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: `call-${count}`, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'done' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}
async function setup(root, enabled = true) {
  const ctx = new Context()
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, Agents]) await ctx.plugin(plugin)
  await ctx.plugin(Jsonl, { root, compression: 'none' })
  await ctx.plugin(Loop, { agents: [] })
  await ctx.plugin(Web, { searchProvider: 'fixture', fetchProvider: 'fixture' })
  ctx.web.registerSearchProvider({ id: 'fixture', available: () => true, async search() {
    return { sources: [{ url, title: 'Article', snippet: 'Preview' }], truncated: false }
  } })
  ctx.web.registerFetchProvider({ id: 'fixture', available: () => true, async fetch() {
    return { url: url + '/final', statusCode: 200, body: { kind: 'html', content: '<h1>Article</h1><p>Evidence.</p>' }, truncated: false }
  } })
  await ctx.plugin(WebTools)
  if (enabled) await ctx.plugin(Materials)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter }
}
const stateOf = (ctx, agent) => ctx.sessionProjections.stateOf(agent.session, 'bansoMaterials')

test('real web tools feed projection, survive JSONL resume, and leave model content unchanged', async t => {
  const root = await mkdtemp(join(tmpdir(), 'banso-materials-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = await setup(join(root, 'enabled'))
  let closed = false
  t.after(async () => { if (!closed) await first.ctx.fiber.dispose() })
  const { agent } = await first.ctx.agents.create({ sessionId: SessionId('research'), agentOptions: { provider: 'mock', model: 'mock' } })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'research' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  assert.equal(first.adapter.requests.length, 3)
  const before = structuredClone(stateOf(first.ctx, agent))
  assert.equal(before.items.S1.url, url)
  assert.match(before.items.S1.fetched.content, /Evidence\./)
  assert.equal(before.items.S1.fetched.finalUrl, url + '/final')
  assert.equal(before.nextHandle, 2)
  assert.deepEqual(before.pendingCalls, {})
  await first.ctx.fiber.dispose()
  closed = true
  const resumed = await setup(join(root, 'enabled'))
  t.after(() => resumed.ctx.fiber.dispose())
  const restored = (await resumed.ctx.agents.resume({ resumeSessionId: SessionId('research') })).agent
  assert.deepEqual(stateOf(resumed.ctx, restored), before)
  assert.equal(resumed.adapter.requests.length, 0)

  const control = await setup(join(root, 'disabled'), false)
  t.after(() => control.ctx.fiber.dispose())
  const controlAgent = (await control.ctx.agents.create({ sessionId: SessionId('control'), agentOptions: { provider: 'mock', model: 'mock' } })).agent
  controlAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'research' }], source: { kind: 'user' } }))
  await controlAgent.whenIdle()
  const visible = adapter => adapter.requests.map(request => request.messages.map(message => ({ role: message.role, content: message.content })))
  assert.deepEqual(visible(first.adapter), visible(control.adapter))
  // Register after the complete history exists, then unload and rebuild again.
  const fiber = await control.ctx.plugin(Materials)
  assert.equal(stateOf(control.ctx, controlAgent).items.S1.url, url)
  await fiber.dispose()
  assert.equal(stateOf(control.ctx, controlAgent), undefined)
  await control.ctx.plugin(Materials)
  assert.equal(stateOf(control.ctx, controlAgent).nextHandle, 2)
  assert.deepEqual(stateOf(resumed.ctx, restored), before)
})
