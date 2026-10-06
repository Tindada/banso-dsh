import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Llm, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Web from '@deepseek-ai/dsh-web'
import * as Timeout from '@deepseek-ai/dsh-tool-call-timeout-policy'
import * as NativeTools from '@deepseek-ai/dsh-tool-web'
import * as WrappedTools from '../lib/index.js'
const url = 'https://example.com/article'
const config = { provider: 'mock', model: 'extract' }
class Adapter extends LlmAdapter {
  requests = []
  text = '{"text":"Compact evidence."}'
  finish = { kind: 'stop' }
  action
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(request) {
    this.requests.push(request)
    await this.action?.(request)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: this.text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.text } }
    yield { type: 'finish', reason: this.finish }
  }
}
async function harness(t, { native = true, wrapper = true, projection = true, options = {} } = {}) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, Agents]) await ctx.plugin(plugin)
  await ctx.plugin(Loop, { agents: [] })
  await ctx.plugin(Web, { searchProvider: 'fixture', fetchProvider: 'fixture' })
  await ctx.plugin(Timeout)
  // Data-only fixture: this package never loads the materials plugin.
  const items = {}, urlIndex = {}
  if (projection) ctx.sessionProjections.register({ key: 'bansoMaterials', stateVersion: 1, stateSchema: { parse: value => value }, init: () => ({ items, urlIndex }), apply: state => state })
  const results = {
    search: { sources: [{ url, title: 'Title', snippet: 'Snippet' }], truncated: false },
    fetch: { url: url + '/final', statusCode: 200, body: { kind: 'html', content: '<h1>Title</h1><p>Full body.</p>' }, truncated: false },
  }
  const calls = []
  ctx.web.registerSearchProvider({ id: 'fixture', available: () => true, async search(request) {
    calls.push(request)
    if (results.search instanceof Error) throw results.search
    return results.search
  } })
  ctx.web.registerFetchProvider({ id: 'fixture', available: () => true, async fetch(request, signal) {
    calls.push(request)
    if (typeof results.fetch === 'function') return results.fetch(request, signal)
    if (results.fetch instanceof Error) throw results.fetch
    return results.fetch
  } })
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const nativeFiber = native ? await ctx.plugin(NativeTools, { fetch: false }) : undefined
  const wrapperFiber = wrapper ? await ctx.plugin(WrappedTools, { ...config, ...options }) : undefined
  let count = 0
  const create = setup => ctx.agents.create({ sessionId: SessionId(`agent-${++count}`), ...(setup ? { setup } : {}) })
  const execute = (agent, name = 'web_read', args = name === 'web_read' ? { target: url, focus: 'facts' } : { queries: ['news'] }, signal = new AbortController().signal) =>
    ctx.tools.execute({ agent, name, arguments: args, callId: `call-${++count}`, signal })
  return { ctx, results, calls, adapter, items, urlIndex, nativeFiber, wrapperFiber, create, execute }
}
const textOf = result => result.content.map(block => block.text).join('\n')

test('read has its own schema and timeout; compact receipts, full metadata and isolated extraction input', async t => {
  const h = await harness(t), { agent } = await h.create()
  const definition = h.ctx.tools.get('web_read', agent)
  assert.equal(definition.timeoutMs, 120000)
  assert.equal(definition.isConcurrencySafe({ target: url, focus: 'facts' }), true)
  const schema = h.ctx.tools.schemas(agent).find(tool => tool.name === 'web_read').parameters
  assert.equal(schema.type, 'object')
  assert.deepEqual(schema.required, ['target', 'focus'])
  const result = await h.execute(agent)
  assert.equal(result.isError, false, textOf(result))
  assert.match(textOf(result), /Page fetched.*Evidence extracted/)
  assert.doesNotMatch(textOf(result), /Full body|Compact evidence/)
  assert.equal(result.meta.requestUrl, url)
  assert.equal(result.meta.finalUrl, url + '/final')
  assert.match(result.meta.content, /Full body/)
  assert.doesNotMatch(result.meta.content, /<p>/)
  assert.equal(result.meta.evidence, 'Compact evidence.')
  const request = h.adapter.requests[0]
  assert.equal(request.model, 'extract')
  assert.equal(request.maxTokens, 2048)
  assert.equal(request.tools, undefined)
  assert.equal(request.messages.length, 1)
  const input = JSON.parse(textOf(request.messages[0]))
  assert.equal(input.focus, 'facts')
  assert.equal(input.content, result.meta.content)
})

test('handle and exact URL reuse saved body, omit it from metadata, and use new focus', async t => {
  const h = await harness(t)
  h.items.S1 = { handle: 'S1', url, title: 'Saved title', fetched: { content: 'Saved body', finalUrl: url + '/redirect', truncated: true, time: 123 } }
  h.urlIndex[url] = 'S1'
  const { agent } = await h.create()
  for (const target of ['S1', url]) {
    const result = await h.execute(agent, 'web_read', { target, focus: `Focus ${target}` })
    assert.equal(result.isError, false, textOf(result))
    assert.equal(result.meta.content, undefined)
    assert.equal(result.meta.focus, `Focus ${target}`)
    const input = JSON.parse(textOf(h.adapter.requests.at(-1).messages[0]))
    assert.equal(input.content, 'Saved body')
    assert.equal(input.title, 'Saved title')
  }
  assert.equal(h.calls.length, 0)
  assert.equal(h.adapter.requests.length, 2)
})

test('HTTP and network failures skip extraction; extraction failures retain the fetched body', async t => {
  const h = await harness(t), { agent } = await h.create()
  h.results.fetch = { ...h.results.fetch, statusCode: 503 }
  const http = await h.execute(agent)
  assert.match(http.meta.error, /Fetch failed: HTTP 503/)
  assert.equal(http.meta.evidence, undefined)
  h.results.fetch = new Error('offline')
  assert.equal((await h.execute(agent)).meta.error, 'Fetch failed: offline')
  assert.equal(h.adapter.requests.length, 0)
  h.results.fetch = { url, statusCode: 200, body: { kind: 'text', content: 'RAW BODY' }, truncated: true }
  for (const text of ['not JSON', '{}', '{"text":42}', '[]']) {
    h.adapter.text = text
    const result = await h.execute(agent)
    assert.equal(result.isError, false)
    assert.match(result.meta.error, /Extraction failed:/)
    assert.match(result.meta.content, /RAW BODY/)
    assert.equal(result.meta.truncated, true)
  }
  h.adapter.text = '{"text":""}'
  assert.equal((await h.execute(agent)).meta.evidence, '')
  h.adapter.text = '{"text":"partial"}'
  h.adapter.finish = { kind: 'max-tokens' }
  assert.match((await h.execute(agent)).meta.error, /Extraction failed:/)
  h.adapter.action = () => { throw new Error('LLM failed') }
  assert.match((await h.execute(agent)).meta.error, /LLM failed/)
})

test('input budget includes framing; missing model route fails without losing body', async t => {
  const h = await harness(t, { options: { maxInputBytes: 1 } }), { agent } = await h.create()
  const result = await h.execute(agent)
  assert.match(result.meta.error, /input exceeds/)
  assert.match(result.meta.content, /Full body/)
  assert.equal(h.adapter.requests.length, 0)
  const noRoute = await harness(t, { options: { provider: undefined, model: undefined } })
  const a = await noRoute.create()
  assert.match((await noRoute.execute(a.agent)).meta.error, /No model route/)
})

test('invalid arguments and missing material/agent fail without making requests', async t => {
  const h = await harness(t), { agent } = await h.create()
  for (const args of [{}, { target: url }, { target: url, focus: ' ' }, { target: [], focus: 'x' }, { target: 'file:///bad', focus: 'x' }, { target: 'S99', focus: 'x' }]) {
    assert.equal((await h.execute(agent, 'web_read', args)).isError, true)
  }
  assert.equal((await h.execute(undefined)).isError, true)
  assert.equal(h.calls.length, 0)
  const missing = await harness(t, { projection: false }), a = await missing.create()
  assert.match(textOf(await missing.execute(a.agent)), /Materials projection is not registered/)
  assert.equal(missing.calls.length, 0)
})

test('search wrapper preserves native execution and visibility; read loads independently and disposes normally', async t => {
  const h = await harness(t, { native: false, wrapper: false }), a = await h.create()
  const wrapper = await h.ctx.plugin(WrappedTools, config)
  assert.ok(h.ctx.tools.get('web_read', a.agent))
  assert.equal(h.ctx.tools.get('web_search', a.agent), undefined)
  const native = await h.ctx.plugin(NativeTools, { fetch: false })
  const original = h.ctx.tools.get('web_search'), wrapped = h.ctx.tools.get('web_search', a.agent)
  for (const key of ['execute', 'parameters', 'timeoutMs', 'isConcurrencySafe', 'presentCall', 'presentResult']) assert.equal(wrapped[key], original[key])
  const search = await h.execute(a.agent, 'web_search')
  assert.equal(textOf(search), 'Search completed. 1 sources returned. Truncated: false.')
  assert.deepEqual(search.meta.sources, h.results.search.sources)
  h.results.search = { sources: [], content: 'Provider answer', truncated: true }
  assert.match(textOf(await h.execute(a.agent, 'web_search')), /Provider answer/)
  const local = { ...original, output: { ...original.output, render: () => [{ type: 'text', text: 'Local' }] } }
  const b = await h.create(c => { c.tools.register(local) })
  assert.equal(h.ctx.tools.get('web_search', b.agent), local)
  const c = await h.create(c => { c.tools.restrict({ deny: ['web_read', 'web_search'] }) })
  assert.equal(h.ctx.tools.get('web_read', c.agent), undefined)
  assert.equal(h.ctx.tools.get('web_search', c.agent), undefined)
  const unrestrict = a.agent.ctx.tools.restrict({ deny: ['web_read', 'web_search'] })
  assert.equal(h.ctx.tools.get('web_read', a.agent), undefined)
  assert.equal(h.ctx.tools.get('web_search', a.agent), undefined)
  unrestrict()
  await native.dispose()
  assert.ok(h.ctx.tools.get('web_read', a.agent))
  const reloaded = await h.ctx.plugin(NativeTools, { fetch: false })
  assert.notEqual(h.ctx.tools.get('web_search', a.agent), h.ctx.tools.get('web_search'))
  await wrapper.dispose()
  assert.equal(h.ctx.tools.get('web_read', a.agent), undefined)
  assert.equal(h.ctx.tools.get('web_search', a.agent), h.ctx.tools.get('web_search'))
  await h.ctx.plugin(WrappedTools, config)
  assert.ok(h.ctx.tools.get('web_read', a.agent))
  await reloaded.dispose()
})

test('fetch and extraction cancellation propagate with no partial metadata', async t => {
  for (const stage of ['fetch', 'extract']) {
    const h = await harness(t), { agent } = await h.create()
    let started
    const ready = new Promise(resolve => { started = resolve })
    const wait = signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      started()
    })
    if (stage === 'fetch') h.results.fetch = (_request, signal) => wait(signal)
    else h.adapter.action = request => wait(request.signal)
    const abort = new AbortController()
    const pending = h.execute(agent, 'web_read', { target: url, focus: 'facts' }, abort.signal)
    await ready
    abort.abort()
    const result = await pending
    assert.equal(result.isError, true)
    assert.equal(result.meta, undefined)
  }
})

test('DSH timeout policy cancels in-flight extraction and publishes no partial body', async t => {
  const h = await harness(t, { options: { timeoutMs: 30 } }), { agent } = await h.create()
  let aborted = false
  h.adapter.action = request => new Promise((_resolve, reject) => {
    request.signal.addEventListener('abort', () => { aborted = true; reject(request.signal.reason) }, { once: true })
  })
  // DSH deadlines are unref timers; keep the mock request alive until settlement.
  const keepAlive = setInterval(() => {}, 1000)
  try {
    const result = await h.execute(agent)
    assert.equal(aborted, true)
    assert.equal(result.isError, true)
    assert.equal(result.error.info.code, 'TOOL_TIMEOUT')
    assert.equal(result.meta, undefined)
  } finally { clearInterval(keepAlive) }
})


test('configuration validates paired routes and positive budgets', () => {
  for (const value of [{ maxInputBytes: 0 }, { maxOutputTokens: -1 }, { timeoutMs: 0 }]) {
    assert.throws(() => WrappedTools.Config(value))
  }
  for (const value of [{ provider: 'mock' }, { model: 'extract' }]) {
    assert.throws(() => WrappedTools.apply({}, value), /configured together/)
  }
})
