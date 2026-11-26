import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import * as Jina from 'banso-dsh-web-fetch-jina'
import * as Fallback from 'banso-dsh-web-fetch-fallback'
import { test } from 'node:test'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Llm, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as ToolExecutorNative from '@deepseek-ai/dsh-tool-executor-native'
import * as Timeout from '@deepseek-ai/dsh-tool-call-timeout-policy'
import Web from '@deepseek-ai/dsh-web'
import * as WebTools from '@deepseek-ai/dsh-tool-web'
import * as Materials from 'banso-dsh-materials'
import * as BansoPrompt from 'banso-dsh-prompt'

const url = 'https://example.com/article'
class Adapter extends LlmAdapter {
  requests = []
  targets = [url]
  focus = 'facts'
  mode = 'extract'
  extractions = []
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'off', name: 'Off' }] } }
  }
  async *stream(request) {
    if (request.system !== undefined) {
      this.extractions.push(request)
      const input = JSON.parse(textOf(request.messages[0]))
      const text = `Evidence. Focus: ${input.focus}`
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.requests.push(request)
    const count = this.requests.length
    if (count < 3) {
      const name = count === 1 ? 'web_search' : 'web_read'
      const argumentsList = count === 1 ? [{ queries: ['news'] }] : this.targets.map(target => ({ target, mode: this.mode, ...(this.mode === 'extract' ? { focus: this.focus } : {}) }))
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
async function setup(root, enabled = true, fetchProvider, jinaConfig, mode = 'extract') {
  const ctx = new Context()
  const errors = []
  ctx.on('agent/error', ({ error }) => errors.push(error))
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, ToolExecutorNative, Agents]) await ctx.plugin(plugin)
  await ctx.plugin(Jsonl, { root, compression: 'none' })
  await ctx.plugin(Loop, { agents: [] })
  await ctx.plugin(BansoPrompt)
  await ctx.plugin(Web, { searchProvider: 'fixture', fetchProvider: jinaConfig ? 'jina' : 'fixture' })
  ctx.web.registerSearchProvider({ id: 'fixture', available: () => true, async search() {
    return { sources: [{ url, title: 'Article', snippet: 'Preview' }], truncated: false }
  } })
  const fetchCalls = []
  ctx.web.registerFetchProvider({ id: 'fixture', available: () => true, async fetch(request, signal) {
    fetchCalls.push(request)
    if (fetchProvider) return fetchProvider(request, signal)
    return { url: url + '/final', statusCode: 200, body: { kind: 'html', content: '<h1>Article</h1><p>FULL BODY ONLY.</p>' }, truncated: false }
  } })
  if (jinaConfig) await ctx.plugin(Jina, jinaConfig)
  await ctx.plugin(WebTools, { fetch: false })
  await ctx.plugin(Timeout)
  if (enabled) await ctx.plugin(Materials)
  const adapter = new Adapter()
  adapter.mode = mode
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter, errors, fetchCalls }
}
const runtimeContexts = request => request.messages.filter(message => message.source.kind === 'runtime-context')
const textOf = message => message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
const stateOf = (ctx, agent) => ctx.sessionProjections.stateOf(agent.session, 'bansoMaterials')

test('search and read feed materials through tool results, survive JSONL and continue after resume', async t => {
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
  for (const request of first.adapter.requests) {
    assert.equal(request.messages[0].role, 'system')
  }
  assert.equal(textOf(initial.messages[1]), 'research')
  assert.equal(fetched.messages.filter(message => textOf(message).includes('Evidence.')).length, 1)
  assert.equal(fetched.messages.filter(message => message.role === 'assistant').length, 2)
  assert.match(textOf(initial.messages[0]), /Research budget: up to 15 attempts per turn/)
  assert.equal(runtimeContexts(initial).length, 1)
  assert.equal(runtimeContexts(searched).length, 1)
  assert.equal(runtimeContexts(fetched).length, 1)
  const toolMessages = first.adapter.requests[2].messages.filter(message => message.role === 'tool')
  assert.match(toolMessages[0].content[0].text, /^Search completed/)
  assert.match(toolMessages[0].content[0].text, /Material: S1[\s\S]*Search snippet: Preview[\s\S]*Research budget: 15\. Attempts used: 1\. Remaining: 14\./)
  assert.match(toolMessages[1].content[0].text, /Material: S1[\s\S]*Page fetched\.[\s\S]*Evidence\. Focus:[\s\S]*Research budget: 15\. Attempts used: 2\. Remaining: 13\./)
  assert.doesNotMatch(toolMessages[1].content[0].text, /FULL BODY ONLY/)
  const events = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
  assert.equal(events.length, 2)
  assert.ok(events.every(event => event.surfaceOp === 'append'))
  assert.match(events[1].data.meta.content, /FULL BODY ONLY/)
  const before = structuredClone(stateOf(first.ctx, agent))
  assert.equal(before.items.S1.url, url)
  assert.match(before.items.S1.fetched.content, /FULL BODY ONLY/)
  assert.equal(before.items.S1.fetched.finalUrl, url + '/final')
  assert.equal(before.nextHandle, 2)
  assert.equal(first.adapter.extractions.length, 1)
  assert.equal(first.adapter.extractions[0].provider, 'mock')
  assert.equal(first.adapter.extractions[0].model, 'mock')
  assert.equal(before.items.S1.evidence.length, 1)
  assert.deepEqual(before.pendingCalls, {})
  await first.ctx.fiber.dispose()
  closed = true
  const resumed = await setup(join(root, 'enabled'))
  t.after(() => resumed.ctx.fiber.dispose())
  const restored = (await resumed.ctx.agents.resume({ resumeSessionId: SessionId('research'), agentOptions: { provider: 'mock', model: 'mock' } })).agent
  assert.deepEqual(stateOf(resumed.ctx, restored), before)
  assert.equal(resumed.adapter.requests.length, 0)

  await cp(join(root, 'enabled'), join(root, 'disabled'), { recursive: true })
  const control = await setup(join(root, 'disabled'), false)
  t.after(() => control.ctx.fiber.dispose())
  const controlAgent = (await control.ctx.agents.resume({ resumeSessionId: SessionId('research'), agentOptions: { provider: 'mock', model: 'mock' } })).agent
  assert.equal(stateOf(control.ctx, controlAgent), undefined)
  assert.equal(control.ctx.tools.get('web_read', controlAgent), undefined)
  // Load the unified plugin after replaying history, then unload and rebuild again.
  const fiber = await control.ctx.plugin(Materials)
  assert.deepEqual(stateOf(control.ctx, controlAgent), before)
  assert.ok(control.ctx.tools.get('web_read', controlAgent))
  await fiber.dispose()
  assert.equal(stateOf(control.ctx, controlAgent), undefined)
  assert.equal(control.ctx.tools.get('web_read', controlAgent), undefined)
  await control.ctx.plugin(Materials)
  assert.equal(stateOf(control.ctx, controlAgent).nextHandle, 2)
  control.adapter.requests = []
  controlAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
  await controlAgent.whenIdle()
  assert.match(textOf(control.adapter.requests.at(-1).messages.filter(m => m.role === 'tool').at(-1)), /Evidence/)
  assert.deepEqual(control.errors, [])
  assert.deepEqual(stateOf(resumed.ctx, restored), before)
  resumed.adapter.focus = 'follow-up facts'
  resumed.adapter.targets = ['S1']
  restored.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
  await restored.whenIdle()
  assert.deepEqual(resumed.errors, [])
  assert.equal(resumed.adapter.requests.length, 3)
  const after = stateOf(resumed.ctx, restored)
  assert.deepEqual(after.urlIndex, before.urlIndex)
  assert.equal(after.nextHandle, before.nextHandle)
  assert.equal(after.items.S1.fetched.content, before.items.S1.fetched.content)
  const resumedResults = restored.session.snapshotEvents().filter(event => event.type === 'tool/result')
  assert.match(resumedResults.at(-2).data.message.content[0].text, /Material: S1 \(existing\)[\s\S]*Search snippet: Preview/)
  assert.match(resumedResults.at(-1).data.message.content[0].text, /Saved page reused\.[\s\S]*Evidence focus: follow-up facts[\s\S]*Evidence\. Focus: follow-up facts/)
  assert.equal(resumedResults.at(-1).data.meta.content, undefined)
  assert.equal(resumed.fetchCalls.length, 0)
  assert.equal(after.items.S1.evidence.length, 2)
  assert.equal(after.items.S1.evidence[1].focus, 'follow-up facts')
  assert.equal(after.items.S1.fetched.time, before.items.S1.fetched.time)
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
  t.after(async () => {
    for (const release of releases.values()) release()
    if (!closed) await first.ctx.fiber.dispose()
  })
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
  assert.match(textOf(results[0].data.message), /Material: S1/)
  assert.match(textOf(results[1].data.message), /Material: S2/)
  assert.match(textOf(agent.session.snapshotEvents().filter(e => e.type === 'tool/result')[0].data.message), /Search snippet: Preview/)

  const other = (await first.ctx.agents.create({ sessionId: SessionId('other'), agentOptions: { provider: 'mock', model: 'mock' } })).agent
  const signal = new AbortController().signal
  const toolSet = await first.ctx.tools.resolve({ agent: other, modelSelection: { provider: 'mock', model: 'mock' }, signal })
  try {
    const batch = await first.ctx.tools.execute({
      agent: other,
      toolSet,
      calls: [{ type: 'tool-call', id: 'isolated', name: 'web_read', arguments: JSON.stringify({ target: 'S1', mode: 'extract', focus: 'facts' }) }],
      signal,
    })
    const isolated = batch.results[0].result
    assert.equal(isolated.isError, true)
    assert.match(textOf(isolated), /Unknown material handle/)
  } finally {
    toolSet.dispose()
  }
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


test('Jina Markdown feeds extraction while the tool result exposes only evidence', async t => {
  const requests = []
  const markdown = '# Reader article\n\n**Extracted evidence.**'
  const server = createServer((req, res) => {
    requests.push(req.url)
    res.end(JSON.stringify({ code: 200, status: 20000, data: { url: url + '/final', content: markdown } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const root = await mkdtemp(join(tmpdir(), 'banso-jina-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { ctx, adapter, errors } = await setup(root, true, undefined, {
    baseURL: `http://127.0.0.1:${server.address().port}`, apiKey: '',
  })
  t.after(() => ctx.fiber.dispose())
  adapter.targets = ['S1']
  const { agent } = await ctx.agents.create({ sessionId: SessionId('jina'), agentOptions: { provider: 'mock', model: 'mock' } })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'research' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [`/${url}`])
  const toolEvents = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
  const result = toolEvents.at(-1)
  assert.match(textOf(result.data.message), /Material: S1[\s\S]*Page fetched\.[\s\S]*Evidence\./)
  assert.ok(!textOf(result.data.message).includes(markdown))
  assert.equal(result.data.meta.requestUrl, url)
  assert.equal(result.data.meta.finalUrl, url + '/final')
  assert.ok(result.data.meta.content.includes(markdown))
  assert.equal(stateOf(ctx, agent).items.S1.fetched.content, result.data.meta.content)
  assert.ok(JSON.parse(textOf(adapter.extractions[0].messages[0])).content.includes(markdown))
  assert.match(textOf(toolEvents[0].data.message), /Search snippet: Preview/)
})


test('direct mode exposes bodies through tool results, restores JSONL and reuses pages without extraction', async t => {
  const root = await mkdtemp(join(tmpdir(), 'banso-direct-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = await setup(root, true, undefined, undefined, 'direct')
  let closed = false
  t.after(async () => { if (!closed) await first.ctx.fiber.dispose() })
  first.adapter.targets = ['S1']
  const { agent } = await first.ctx.agents.create({ sessionId: SessionId('direct'), agentOptions: { provider: 'mock', model: 'mock' } })
  const run = async (agent, h) => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'research' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    assert.deepEqual(h.errors, [])
    assert.equal(h.adapter.extractions.length, 0)
    const last = h.adapter.requests.at(-1)
    assert.equal(last.messages.map(textOf).join('\n').split('FULL BODY ONLY').length - 1, 1)
  }
  await run(agent, first)
  assert.equal(first.fetchCalls.length, 1)
  const before = structuredClone(stateOf(first.ctx, agent))
  assert.equal(before.items.S1.evidence, undefined)
  assert.equal(before.items.S1.pageShown, true)
  await first.ctx.fiber.dispose()
  closed = true
  const resumed = await setup(root, true, undefined, undefined, 'direct')
  t.after(() => resumed.ctx.fiber.dispose())
  const restored = (await resumed.ctx.agents.resume({ resumeSessionId: SessionId('direct'), agentOptions: { provider: 'mock', model: 'mock' } })).agent
  assert.deepEqual(stateOf(resumed.ctx, restored), before)
  await run(restored, resumed)
  assert.equal(resumed.fetchCalls.length, 0)
  assert.deepEqual(stateOf(resumed.ctx, restored).items.S1.fetched, before.items.S1.fetched)
  const lastTool = restored.session.snapshotEvents().filter(e => e.type === 'tool/result').at(-1)
  assert.match(textOf(lastTool.data.message), /Page text for S1 was already returned earlier in this session\./)
})


test('one session switches direct and extract both ways without fetching again', async t => {
  const root = await mkdtemp(join(tmpdir(), 'banso-switch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const h = await setup(root)
  t.after(() => h.ctx.fiber.dispose())
  const { agent } = await h.ctx.agents.create({ sessionId: SessionId('switch'), agentOptions: { provider: 'mock', model: 'mock' } })
  for (const mode of ['direct', 'extract', 'direct', 'extract']) {
    h.adapter.mode = mode
    h.adapter.requests = []
    h.adapter.targets = ['S1']
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'read' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    assert.deepEqual(h.errors, [])
    assert.equal(h.fetchCalls.length, 1)
    const last = h.adapter.requests.at(-1)
    assert.equal(last.messages.map(textOf).join('\n').split('FULL BODY ONLY').length - 1, 1)
    if (mode === 'extract') {
      assert.match(textOf(last.messages.filter(m => m.role === 'tool').at(-1)), /Evidence\. Focus:/)
    }
  }
  assert.equal(h.adapter.extractions.length, 2)
  const results = agent.session.snapshotEvents().filter(e => e.type === 'tool/result' && e.data.meta?.mode)
  assert.deepEqual(results.map(e => e.data.meta.mode), ['direct', 'extract', 'direct', 'extract'])
  assert.ok(results.slice(1).every(e => e.data.meta.content === undefined))
  assert.match(textOf(results[2].data.message), /Page text for S1 was already returned earlier in this session\./)
})


test('shared research budget admits only the first call and resets on the next turn', async t => {
  const root = await mkdtemp(join(tmpdir(), 'banso-budget-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const h = await setup(root, false)
  t.after(() => h.ctx.fiber.dispose())
  await h.ctx.plugin(Materials, { researchBudget: 1 })
  const { agent } = await h.ctx.agents.create({ sessionId: SessionId('budget'), agentOptions: { provider: 'mock', model: 'mock' } })
  const calls = []
  h.ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name === 'web_read' || exec.name === 'web_search') {
      calls.push(exec.callId)
      const before = stateOf(h.ctx, agent).budget.used
      await new Promise(resolve => setTimeout(resolve, 10))
      assert.equal(stateOf(h.ctx, agent).budget.used, before, 'later calls cannot advance count during prepare')
    }
    return next()
  })
  h.adapter.stream = async function* (request) {
    this.requests.push(request)
    const n = this.requests.length
    if (n === 1 || n === 2) {
      for (let index = 0; index < (n === 1 ? 3 : 1); index++) {
        const id = `budget-${n}-${index}`
        const name = index === 1 ? 'web_search' : 'web_read'
        const args = JSON.stringify(name === 'web_search'
          ? { queries: ['news'] }
          : { target: `${url}/${n}/${index}`, mode: 'direct' })
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index, id, name, argumentsDelta: args }
        yield { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: args } }
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'done' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'research' }] }))
  await agent.whenIdle()
  assert.deepEqual(h.errors, [])
  assert.equal(h.fetchCalls.length, 1)
  assert.deepEqual(calls, ['budget-1-0', 'budget-1-1', 'budget-1-2', 'budget-2-0'])
  const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
  assert.equal(results.length, 4)
  assert.equal(results[0].data.message.isError, false)
  for (const result of results.slice(1)) {
    assert.equal(result.data.message.isError, true)
    assert.match(textOf(result.data.message), /^Error: Research budget exhausted\n\nResearch budget: 1\. Attempts used: \d+\. Remaining: 0\.$/)
  }
  assert.equal(stateOf(h.ctx, agent).budget.used, 4)
  assert.ok(h.adapter.requests[0].tools.some(tool => tool.name === 'web_read'))
  assert.ok((h.adapter.requests[1].tools ?? []).every(tool => !['web_read', 'web_search'].includes(tool.name)))
  assert.match(textOf(results[0].data.message), /Research budget: 1\. Attempts used: \d+\. Remaining: 0\./)
  assert.match(textOf(results.at(-1).data.message), /Attempts used: 4\. Remaining: 0\./)
  assert.equal(runtimeContexts(h.adapter.requests[2]).length, 1)
  const items = structuredClone(stateOf(h.ctx, agent).items)
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'followup' }] }))
  await agent.whenIdle()
  assert.equal(stateOf(h.ctx, agent).budget.used, 0)
  assert.deepEqual(stateOf(h.ctx, agent).items, items)
  assert.ok(h.adapter.requests.at(-1).tools.some(tool => tool.name === 'web_read'))
})

test('web_read falls back from DeepSeek Fetch API 404 to Jina Reader seamlessly', async t => {
  const dsRequests = []
  const jinaRequests = []
  const markdown = '# Fallback article\n\nRecovered via Jina.'
  const dsServer = createServer((req, res) => {
    dsRequests.push(req.url)
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'failed to fetch URL' }))
  })
  const jinaServer = createServer((req, res) => {
    jinaRequests.push(req.url)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ code: 200, status: 20000, data: { url: url + '/jina', content: markdown } }))
  })
  dsServer.listen(0, '127.0.0.1')
  jinaServer.listen(0, '127.0.0.1')
  await Promise.all([once(dsServer, 'listening'), once(jinaServer, 'listening')])
  t.after(() => Promise.all([
    new Promise(resolve => { dsServer.closeAllConnections(); dsServer.close(resolve) }),
    new Promise(resolve => { jinaServer.closeAllConnections(); jinaServer.close(resolve) }),
  ]))

  const root = await mkdtemp(join(tmpdir(), 'banso-fallback-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  const errors = []
  ctx.on('agent/error', ({ error }) => errors.push(error))
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, ToolExecutorNative, Agents]) await ctx.plugin(plugin)
  await ctx.plugin(Jsonl, { root, compression: 'none' })
  await ctx.plugin(Loop, { agents: [] })
  await ctx.plugin(BansoPrompt)
  await ctx.plugin(Web, { searchProvider: 'fixture', fetchProvider: 'fallback' })
  ctx.web.registerSearchProvider({ id: 'fixture', available: () => true, async search() {
    return { sources: [{ url, title: 'Article', snippet: 'Preview' }], truncated: false }
  } })
  await ctx.plugin(Fallback, {
    deepseek: { apiKey: 'test-key', baseURL: `http://127.0.0.1:${dsServer.address().port}`, timeoutMs: 5000 },
    jina: { apiKey: '', baseURL: `http://127.0.0.1:${jinaServer.address().port}`, timeoutMs: 5000 },
  })
  await ctx.plugin(WebTools, { fetch: false })
  await ctx.plugin(Timeout)
  await ctx.plugin(Materials)
  const adapter = new Adapter()
  adapter.mode = 'direct'
  adapter.targets = ['S1']
  ctx.llm.registerAdapter(['mock'], adapter)
  t.after(() => ctx.fiber.dispose())

  const { agent } = await ctx.agents.create({ sessionId: SessionId('fallback'), agentOptions: { provider: 'mock', model: 'mock' } })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'research' }], source: { kind: 'user' } }))
  await agent.whenIdle()

  assert.deepEqual(errors, [])
  assert.deepEqual(dsRequests, ['/fetch'])
  assert.deepEqual(jinaRequests, [`/${url}`])
  const lastTool = agent.session.snapshotEvents().filter(e => e.type === 'tool/result').at(-1)
  assert.match(textOf(lastTool.data.message), /Recovered via Jina\./)
  assert.equal(lastTool.data.meta.finalUrl, url + '/jina')
})
