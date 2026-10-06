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
import * as Materials from 'banso-dsh-materials'
import * as BansoPrompt from 'banso-dsh-prompt'
import * as WrappedTools from 'banso-dsh-tool-web'
import Invariants from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as LoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'

const url = 'https://example.com/article'
class Adapter extends LlmAdapter {
  requests = []
  targets = [url]
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(request) {
    this.requests.push(request)
    const count = this.requests.length
    if (count < 3) {
      const name = count === 1 ? 'web_search' : 'web_fetch'
      const argumentsList = count === 1 ? [{ queries: ['news'] }] : this.targets.map(target => ({ target }))
      for (const [index, args] of argumentsList.entries()) {
        const id = `call-${count}-${index}`, argumentsText = JSON.stringify(args)
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index, id, name, argumentsDelta: argumentsText }
        yield { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: argumentsText } }
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'done' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}
async function setup(root, enabled = true, fetchProvider) {
  const ctx = new Context()
  const errors = []
  ctx.on('agent/error', ({ error }) => errors.push(error))
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, Agents]) await ctx.plugin(plugin)
  await ctx.plugin(Jsonl, { root, compression: 'none' })
  await ctx.plugin(Loop, { agents: [] })
  await ctx.plugin(BansoPrompt)
  for (const plugin of [Invariants, SessionInvariant, LoopInvariant]) await ctx.plugin(plugin)
  await ctx.plugin(Web, { searchProvider: 'fixture', fetchProvider: 'fixture' })
  ctx.web.registerSearchProvider({ id: 'fixture', available: () => true, async search() {
    return { sources: [{ url, title: 'Article', snippet: 'Preview' }], truncated: false }
  } })
  ctx.web.registerFetchProvider({ id: 'fixture', available: () => true, async fetch(request, signal) {
    if (fetchProvider) return fetchProvider(request, signal)
    return { url: url + '/final', statusCode: 200, body: { kind: 'html', content: '<h1>Article</h1><p>Evidence.</p>' }, truncated: false }
  } })
  await ctx.plugin(WebTools)
  await ctx.plugin(WrappedTools)
  if (enabled) await ctx.plugin(Materials)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter, errors }
}
const snapshots = request => request.messages.filter(message => message.source.kind === 'banso-materials' && message.source.form === 'snapshot')
const placeholders = request => request.messages.filter(message => message.source.kind === 'banso-materials' && message.source.form === 'placeholder')
const textOf = message => message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
const stateOf = (ctx, agent) => ctx.sessionProjections.stateOf(agent.session, 'bansoMaterials')

test('wrapped native tools feed materials through metadata, survive JSONL and continue after resume', async t => {
  const root = await mkdtemp(join(tmpdir(), 'banso-materials-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = await setup(join(root, 'enabled'))
  let closed = false
  t.after(async () => { if (!closed) await first.ctx.fiber.dispose() })
  const { agent } = await first.ctx.agents.create({ sessionId: SessionId('research'), agentOptions: { provider: 'mock', model: 'mock' } })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'research' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  assert.deepEqual(first.errors, [])
  assert.equal(first.adapter.requests.length, 3)
  const [initial, searched, fetched] = first.adapter.requests
  assert.equal(snapshots(initial).length, 0)
  assert.equal(initial.messages[0].role, 'system')
  assert.equal(textOf(initial.messages.find(message => message.source.kind === 'user')), 'research')
  assert.equal(snapshots(searched).length, 1)
  assert.equal(searched.messages.at(-1), snapshots(searched)[0])
  assert.match(textOf(snapshots(searched)[0]), /Search snippet: Preview/)
  assert.equal(snapshots(fetched).length, 1)
  assert.equal(placeholders(fetched).length, 1)
  assert.equal(fetched.messages.at(-1), snapshots(fetched)[0])
  assert.match(textOf(snapshots(fetched)[0]), /Evidence/)
  assert.doesNotMatch(textOf(placeholders(fetched)[0]), /Preview|Evidence/)
  assert.equal(fetched.messages.filter(message => textOf(message).includes('Evidence.')).length, 1)
  assert.equal(fetched.messages.filter(message => message.role === 'assistant').length, 2)
  for (const request of first.adapter.requests) {
    assert.equal(request.messages.filter(message => message.source.kind === 'runtime-context').length, 1)
  }
  const toolMessages = first.adapter.requests[2].messages.filter(message => message.role === 'tool')
  assert.match(toolMessages[0].content[0].text, /^Search completed/)
  assert.match(toolMessages[1].content[0].text, /Fetch completed/)
  assert.doesNotMatch(toolMessages[1].content[0].text, /Evidence/)
  const events = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
  assert.equal(events.length, 2)
  assert.ok(events.every(event => event.surfaceOp === 'append'))
  assert.match(events[1].data.meta.content, /Evidence/)
  const locatorBefore = structuredClone(first.ctx.sessionProjections.stateOf(agent.session, 'bansoMaterialsSnapshot'))
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
  const restored = (await resumed.ctx.agents.resume({ resumeSessionId: SessionId('research'), agentOptions: { provider: 'mock', model: 'mock' } })).agent
  assert.deepEqual(stateOf(resumed.ctx, restored), before)
  assert.equal(resumed.adapter.requests.length, 0)
  assert.deepEqual(resumed.ctx.sessionProjections.stateOf(restored.session, 'bansoMaterialsSnapshot'), locatorBefore)

  const control = await setup(join(root, 'disabled'), false)
  t.after(() => control.ctx.fiber.dispose())
  const controlAgent = (await control.ctx.agents.create({ sessionId: SessionId('control'), agentOptions: { provider: 'mock', model: 'mock' } })).agent
  controlAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'research' }], source: { kind: 'user' } }))
  await controlAgent.whenIdle()
  assert.ok(control.adapter.requests.every(request => snapshots(request).length === 0))
  // Register after the complete history exists, then unload and rebuild again.
  const fiber = await control.ctx.plugin(Materials)
  assert.equal(stateOf(control.ctx, controlAgent).items.S1.url, url)
  await fiber.dispose()
  assert.equal(stateOf(control.ctx, controlAgent), undefined)
  await control.ctx.plugin(Materials)
  assert.equal(stateOf(control.ctx, controlAgent).nextHandle, 2)
  controlAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
  await controlAgent.whenIdle()
  assert.equal(snapshots(control.adapter.requests.at(-1)).length, 1)
  assert.match(textOf(snapshots(control.adapter.requests.at(-1))[0]), /Evidence/)
  assert.deepEqual(control.errors, [])
  assert.deepEqual(stateOf(resumed.ctx, restored), before)
  restored.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
  await restored.whenIdle()
  assert.deepEqual(resumed.errors, [])
  assert.equal(resumed.adapter.requests.length, 3)
  assert.equal(snapshots(resumed.adapter.requests[0])[0].id, locatorBefore.messageId)
  assert.equal(snapshots(resumed.adapter.requests[1])[0].id, locatorBefore.messageId)
  assert.notEqual(snapshots(resumed.adapter.requests[2])[0].id, locatorBefore.messageId)
  assert.equal(placeholders(resumed.adapter.requests[2]).length, 2)
  const after = stateOf(resumed.ctx, restored)
  assert.deepEqual(after.urlIndex, before.urlIndex)
  assert.equal(after.nextHandle, before.nextHandle)
  assert.equal(after.items.S1.fetched.content, before.items.S1.fetched.content)
  const resumedResults = restored.session.snapshotEvents().filter(event => event.type === 'tool/result')
  assert.match(resumedResults.at(-1).data.message.content[0].text, /Fetch completed/)
  assert.equal(resumedResults.at(-1).data.meta.content, before.items.S1.fetched.content)
})

test('single handle and URL calls overlap in the default loop and restore new handles', async t => {
  const root = await mkdtemp(join(tmpdir(), 'banso-target-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const second = url + '/second'
  const releases = new Map()
  const first = await setup(root, true, request => new Promise(resolve => {
    releases.set(request.url, () => resolve({ url: request.url + '/redirect', statusCode: 200, body: { kind: 'text', content: `Evidence for ${request.url}` }, truncated: false }))
  }))
  let closed = false
  t.after(async () => { if (!closed) await first.ctx.fiber.dispose() })
  t.after(() => { for (const release of releases.values()) release() })
  first.adapter.targets = ['S1', second]
  const { agent } = await first.ctx.agents.create({ sessionId: SessionId('targets'), agentOptions: { provider: 'mock', model: 'mock' } })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'research' }], source: { kind: 'user' } }))
  for (let i = 0; i < 100 && releases.size < 2; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(releases.size, 2, 'both provider requests start before either completes')
  assert.equal(stateOf(first.ctx, agent).nextHandle, 2, 'new URL not allocated during execution')
  releases.get(second)()
  releases.get(url)()
  await agent.whenIdle()
  assert.deepEqual(first.errors, [])
  const before = structuredClone(stateOf(first.ctx, agent))
  assert.equal(before.items.S1.url, url)
  assert.equal(before.items.S2.url, second)
  assert.equal(before.items.S2.fetched.finalUrl, second + '/redirect')
  assert.equal(before.nextHandle, 3)
  const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result' && event.data.meta?.requestUrl)
  assert.deepEqual(results.map(event => event.data.meta.requestUrl), [url, second])
  assert.match(textOf(results[0].data.message), /S1/)
  assert.doesNotMatch(textOf(results[1].data.message), /S2/)
  assert.match(textOf(snapshots(first.adapter.requests.at(-1))[0]), /Material: S2/)
  assert.doesNotMatch(textOf(snapshots(first.adapter.requests.at(-1))[0]), /Search snippet: Preview/)

  const other = (await first.ctx.agents.create({ sessionId: SessionId('other'), agentOptions: { provider: 'mock', model: 'mock' } })).agent
  for (const target of ['S999', 'file:///bad']) {
    const result = await first.ctx.tools.execute({ agent, name: 'web_fetch', arguments: { target }, callId: 'invalid', signal: new AbortController().signal })
    assert.equal(result.isError, true)
  }
  const isolated = await first.ctx.tools.execute({ agent: other, name: 'web_fetch', arguments: { target: 'S1' }, callId: 'isolated', signal: new AbortController().signal })
  assert.equal(isolated.isError, true)
  assert.match(textOf(isolated), /Unknown material handle/)
  await first.ctx.fiber.dispose(); closed = true

  const resumed = await setup(root)
  t.after(() => resumed.ctx.fiber.dispose())
  const restored = (await resumed.ctx.agents.resume({ resumeSessionId: SessionId('targets'), agentOptions: { provider: 'mock', model: 'mock' } })).agent
  assert.deepEqual(stateOf(resumed.ctx, restored), before)
  resumed.adapter.targets = ['S2']
  restored.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
  await restored.whenIdle()
  assert.deepEqual(resumed.errors, [])
  assert.equal(stateOf(resumed.ctx, restored).nextHandle, 3)
  const last = restored.session.snapshotEvents().filter(event => event.type === 'tool/result').at(-1)
  assert.equal(last.data.meta.requestUrl, second)
})
