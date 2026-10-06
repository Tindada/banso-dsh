import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Llm from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Web from '@deepseek-ai/dsh-web'
import * as NativeTools from '@deepseek-ai/dsh-tool-web'
import * as WrappedTools from '../lib/index.js'

const url = 'https://example.com/article'
async function harness(t, { native = true, wrapper = true, cap = 1000 } = {}) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, Agents]) await ctx.plugin(plugin)
  await ctx.plugin(Loop, { agents: [] })
  await ctx.plugin(Web, { searchProvider: 'fixture', fetchProvider: 'fixture' })
  const results = {
    search: { sources: [{ url, title: 'Title', snippet: 'Snippet' }], truncated: false },
    fetch: { url: url + '/final', statusCode: 200, body: { kind: 'html', content: '<h1>Title</h1><p>Full evidence.</p>' }, truncated: false },
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
  const nativeFiber = native ? await ctx.plugin(NativeTools, { fetchMaxOutputChars: cap }) : undefined
  const wrapperFiber = wrapper ? await ctx.plugin(WrappedTools) : undefined
  let count = 0
  const create = setup => ctx.agents.create({ sessionId: SessionId(`agent-${++count}`), ...(setup ? { setup } : {}) })
  const execute = (agent, name, args = name === 'web_fetch' ? { target: url } : { queries: ['news'] }) =>
    ctx.tools.execute({ agent, name, arguments: args, callId: `call-${++count}`, signal: new AbortController().signal })
  return { ctx, results, calls, nativeFiber, wrapperFiber, create, execute }
}
const textOf = result => result.content.map(block => block.text).join('\n')

test('scoped outputs reuse native execution, schema and settings; global tools remain unchanged', async t => {
  const h = await harness(t)
  const originals = ['web_search', 'web_fetch'].map(name => h.ctx.tools.get(name))
  const { agent } = await h.create()
  for (const original of originals) {
    const wrapped = h.ctx.tools.get(original.name, agent)
    assert.equal(h.ctx.tools.get(original.name), original)
    for (const key of (original.name === 'web_search' ? ['execute', 'parameters', 'timeoutMs', 'isConcurrencySafe', 'presentCall', 'presentResult'] : ['timeoutMs'])) {
      assert.equal(wrapped[key], original[key])
    }
    if (original.name === 'web_search') assert.equal(wrapped.output.schema, original.output.schema)
  }
  const fetchSchema = h.ctx.tools.schemas(agent).find(tool => tool.name === 'web_fetch').parameters
  assert.equal(fetchSchema.type, 'object')
  assert.deepEqual(fetchSchema.required, ['target'])
  assert.equal(fetchSchema.properties.target.type, 'string')
  assert.deepEqual(Object.keys(fetchSchema.properties), ['target'])
  const search = await h.execute(agent, 'web_search')
  assert.equal(search.isError, false)
  assert.equal(textOf(search), 'Search completed. 1 sources returned. Truncated: false.')
  assert.deepEqual(search.meta.sources, h.results.search.sources)
  const fetch = await h.execute(agent, 'web_fetch')
  assert.equal(fetch.isError, false)
  assert.match(textOf(fetch), /Fetch completed. HTTP 200. Truncated: false./)
  assert.equal(fetch.meta.requestUrl, url)
  const original = originals[1]
  assert.equal(fetch.meta.content, original.output.render({ url }, fetch.value).map(block => block.text).join('\n'))
  assert.match(fetch.meta.content, /Full evidence\./)
  assert.equal(fetch.meta.url, url + '/final')
  assert.equal(h.calls.length, 2)
  await h.wrapperFiber.dispose()
  for (const original of originals) assert.equal(h.ctx.tools.get(original.name, agent), original)
  assert.match(textOf(await h.execute(agent, 'web_fetch', { url })), /Full evidence\./)
})

test('search answer, empty sources and truncation are retained without source listings', async t => {
  const h = await harness(t)
  const { agent } = await h.create()
  h.results.search = { sources: [], content: 'Provider answer', truncated: true }
  const result = await h.execute(agent, 'web_search')
  assert.match(textOf(result), /0 sources/)
  assert.match(textOf(result), /Truncated: true/)
  assert.match(textOf(result), /Provider answer/)
  assert.equal(result.meta.answer, 'Provider answer')
  h.results.search = new Error('Search unavailable')
  const failed = await h.execute(agent, 'web_search')
  assert.equal(failed.isError, true)
  assert.match(textOf(failed), /Search unavailable/)
})

test('fetch metadata skips the tool cap and preserves provider truncation, text and failures', async t => {
  const h = await harness(t, { cap: 180 })
  const { agent } = await h.create()
  h.results.fetch = { url, statusCode: 200, body: { kind: 'text', content: 'Evidence '.repeat(200) }, truncated: false }
  const result = await h.execute(agent, 'web_fetch')
  assert.equal(result.isError, false)
  assert.equal(result.meta.truncated, false)
  assert.ok(result.meta.content.endsWith(h.results.fetch.body.content))
  assert.match(textOf(result), /Truncated: false/)
  assert.equal(result.meta.content, NativeTools.formatFetchOutput(result.value, Infinity))
  h.results.fetch = { ...h.results.fetch, truncated: true }
  const truncated = await h.execute(agent, 'web_fetch')
  assert.equal(truncated.meta.truncated, true)
  assert.match(textOf(truncated), /Truncated: true/)
  assert.ok(truncated.meta.content.includes(h.results.fetch.body.content))
  h.results.fetch = { ...h.results.fetch, body: { kind: 'html', content: `<h1>Title</h1><p>${'HTML evidence '.repeat(200)}</p>` }, truncated: false }
  const html = await h.execute(agent, 'web_fetch')
  assert.equal(html.meta.truncated, false)
  assert.match(textOf(html), /Truncated: false/)
  assert.match(html.meta.content, /# Title/)
  assert.ok(html.meta.content.includes('HTML evidence '.repeat(200).trim()))
  assert.doesNotMatch(html.meta.content, /<h1>|<p>/)
  h.results.fetch = { url, statusCode: 503, body: { kind: 'text', content: 'Unavailable' }, truncated: false }
  const http = await h.execute(agent, 'web_fetch')
  assert.equal(http.isError, false)
  assert.match(textOf(http), /Fetch failed. HTTP 503/)
  assert.match(http.meta.content, /Unavailable/)
  h.results.fetch = new Error('Network failure')
  const failed = await h.execute(agent, 'web_fetch')
  assert.equal(failed.isError, true)
  assert.match(textOf(failed), /Network failure/)
  const invalid = await h.execute(agent, 'web_fetch', {})
  assert.equal(invalid.isError, true)
})

test('late loading, native reload, wrapper reload and disposal keep one effective definition', async t => {
  const h = await harness(t, { native: false, wrapper: false })
  const handle = await h.create()
  const wrapper = await h.ctx.plugin(WrappedTools)
  assert.equal(h.ctx.tools.get('web_fetch', handle.agent), undefined)
  const native = await h.ctx.plugin(NativeTools)
  const original = h.ctx.tools.get('web_fetch')
  assert.notEqual(h.ctx.tools.get('web_fetch', handle.agent), original)
  await native.dispose()
  assert.equal(h.ctx.tools.get('web_fetch', handle.agent), undefined)
  await h.ctx.plugin(NativeTools)
  assert.notEqual(h.ctx.tools.get('web_fetch'), original)
  const reloaded = h.ctx.tools.get('web_fetch')
  assert.notEqual(h.ctx.tools.get('web_fetch', handle.agent).execute, reloaded.execute)
  await wrapper.dispose()
  assert.equal(h.ctx.tools.get('web_fetch', handle.agent), reloaded)
  await h.ctx.plugin(WrappedTools)
  assert.notEqual(h.ctx.tools.get('web_fetch', handle.agent), reloaded)
  await handle.dispose()
  const another = await h.create()
  assert.match(textOf(await h.execute(another.agent, 'web_fetch')), /Fetch completed/)
})

test('local overrides and restrictions are respected across independent sessions', async t => {
  const h = await harness(t)
  const original = h.ctx.tools.get('web_fetch')
  const local = { ...original, output: { ...original.output, render: () => [{ type: 'text', text: 'Local tool' }] } }
  const a = await h.create(agentCtx => { agentCtx.tools.register(local) })
  const b = await h.create()
  const c = await h.create(agentCtx => { agentCtx.tools.restrict({ deny: ['web_fetch'] }) })
  assert.equal(h.ctx.tools.get('web_fetch', a.agent), local)
  assert.equal(h.ctx.tools.get('web_fetch', c.agent), undefined)
  assert.equal(textOf(await h.execute(a.agent, 'web_fetch', { url })), 'Local tool')
  assert.match(textOf(await h.execute(b.agent, 'web_fetch')), /Fetch completed/)
  const allowAgain = b.agent.ctx.tools.restrict({ deny: ['web_fetch'] })
  assert.equal(h.ctx.tools.get('web_fetch', b.agent), undefined)
  allowAgain()
  assert.match(textOf(await h.execute(b.agent, 'web_fetch')), /Fetch completed/)
  assert.equal(h.ctx.tools.get('web_fetch', a.agent), local)
})

test('target validation rejects old arguments; direct URLs do not require materials', async t => {
  const h = await harness(t)
  const { agent } = await h.create()
  for (const args of [{ url }, {}, { target: '' }, { target: [] }, { target: 'file:///bad' }]) {
    assert.equal((await h.execute(agent, 'web_fetch', args)).isError, true)
  }
  assert.equal(h.calls.length, 0)
  assert.equal(h.ctx.tools.get('web_fetch', agent).isConcurrencySafe({ target: 'S1' }), true)
  assert.equal(h.ctx.tools.get('web_fetch', agent).isConcurrencySafe({ target: url }), true)
  const missing = await h.execute(agent, 'web_fetch', { target: 'S1' })
  assert.equal(missing.isError, true)
  assert.match(textOf(missing), /Unknown material handle: S1/)
  assert.equal((await h.execute(agent, 'web_fetch')).isError, false)
  assert.equal((await h.execute(agent, 'web_fetch', { target: url, url: 'file:///ignored' })).isError, false)
})

test('fetch forwards cancellation and does not publish successful metadata', async t => {
  const h = await harness(t)
  const { agent } = await h.create()
  let started
  const ready = new Promise(resolve => { started = resolve })
  h.results.fetch = (_request, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    started()
  })
  const abort = new AbortController()
  const result = h.ctx.tools.execute({ agent, name: 'web_fetch', arguments: { target: url }, callId: 'cancel', signal: abort.signal })
  await ready
  abort.abort()
  const cancelled = await result
  assert.equal(cancelled.isError, true)
  assert.equal(cancelled.meta, undefined)
})
