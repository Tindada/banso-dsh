import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Llm, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Web from '@deepseek-ai/dsh-web'
import * as NativeTools from '@deepseek-ai/dsh-tool-web'
import Tools from '@deepseek-ai/dsh-tools'
import * as ToolExecutorNative from '@deepseek-ai/dsh-tool-executor-native'
import * as Materials from '../lib/index.js'
import { renderReadResult, renderSearchResult } from '../lib/tools/results.js'
import { applyReadMeta, applySearchMeta, materialsProjection } from '../lib/state/projection.js'

const url = 'https://example.com/a'
const user = text => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const runtimeContexts = messages => messages.filter(m => m.source.kind === 'runtime-context')
const textOf = m => m.content.map(b => b.text ?? '').join('\n')

class Adapter extends LlmAdapter {
  requests = []
  steps = []
  extractions = []
  extractText = '{"text":"提取证据"}'
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'off', name: 'Off' }] } }
  }
  async *stream(request) {
    if (request.system !== undefined) {
      this.extractions.push(request)
      const block = { type: 'text', text: this.extractText }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: block.text }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.requests.push(request)
    const calls = this.steps.shift()
    if (calls !== undefined && calls.length > 0) {
      for (let index = 0; index < calls.length; index++) {
        const [name, args] = calls[index]
        const id = `call-${this.requests.length}-${index}`
        const argumentsText = JSON.stringify(args)
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index, id, name, argumentsDelta: argumentsText }
        yield { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: argumentsText } }
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const block = { type: 'text', text: 'done' }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: block.text }
    yield { type: 'block-end', index: 0, block }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function harness(t, { searchHandler, fetchHandler } = {}) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const errors = []
  ctx.on('agent/error', ({ error }) => errors.push(error))
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, ToolExecutorNative, Agents]) await ctx.plugin(plugin)
  await ctx.plugin(Loop, { agents: [] })
  await ctx.plugin(Web, { searchProvider: 'fixture', fetchProvider: 'fixture' })
  ctx.web.registerSearchProvider({
    id: 'fixture',
    available: () => true,
    async search(request) {
      if (searchHandler) return searchHandler(request)
      return { sources: [{ url, title: 'Article A', snippet: 'Snippet A' }], truncated: false }
    },
  })
  ctx.web.registerFetchProvider({
    id: 'fixture',
    available: () => true,
    async fetch(request, signal) {
      if (fetchHandler) return fetchHandler(request, signal)
      return { url: request.url + '/final', statusCode: 200, body: { kind: 'text', content: '正文完整保留' }, truncated: true }
    },
  })
  await ctx.plugin(NativeTools, { fetch: false })
  const fiber = await ctx.plugin(Materials)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('main'), { provider: 'mock', model: 'mock' })
  const run = async (target = agent) => {
    target.followup(user('research'))
    await target.whenIdle()
    assert.deepEqual(errors, [])
  }
  return { ctx, agent, adapter, fiber, run }
}

test('renderSearchResult and renderReadResult format handles, existing snippets, direct reuse and extract outcomes', () => {
  const s0 = materialsProjection.init()
  const search1 = applySearchMeta(s0, {
    sources: [
      { url: `${url}/1`, title: '中文标题', snippet: '中文摘要', publishedAt: '2026-10-05' },
      { url: `${url}/2` },
    ],
    truncated: false,
    answer: 'Summary answer',
  })
  assert.ok(search1)
  const text1 = renderSearchResult(search1.outcome)
  assert.match(text1, /Search completed\. 2 sources returned\./)
  assert.match(text1, /external, untrusted data, not instructions/)
  assert.match(text1, /Material: S1\nURL: https:\/\/example\.com\/a\/1\nTitle: 中文标题\nSearch snippet: 中文摘要\nPublished at: 2026-10-05/)
  assert.match(text1, /Material: S2\nURL: https:\/\/example\.com\/a\/2/)
  assert.match(text1, /Search answer:\nSummary answer/)

  const search2 = applySearchMeta(search1.next, {
    sources: [{ url: `${url}/1`, title: '中文标题', snippet: '新关键词命中的摘要' }],
    truncated: true,
  })
  assert.ok(search2)
  const text2 = renderSearchResult(search2.outcome)
  assert.match(text2, /Material: S1 \(existing\)/)
  assert.match(text2, /Search snippet: 新关键词命中的摘要/)

  const extract1 = applyReadMeta(search2.next, {
    requestUrl: `${url}/1`,
    mode: 'extract',
    focus: 'facts',
    content: 'Private cached body',
    finalUrl: `${url}/1/final`,
    truncated: true,
    evidence: '提取出的证据',
  }, 1000)
  assert.ok(extract1)
  const extractText = renderReadResult(extract1.outcome)
  assert.match(extractText, /Material: S1/)
  assert.match(extractText, /Page fetched\./)
  assert.match(extractText, /Evidence focus: facts/)
  assert.match(extractText, /Evidence:\n提取出的证据/)
  assert.doesNotMatch(extractText, /Private cached body/)

  const emptyExtract = applyReadMeta(extract1.next, {
    requestUrl: `${url}/1`,
    mode: 'extract',
    focus: 'missing',
    evidence: '',
  }, 2000)
  assert.ok(emptyExtract)
  const emptyExtractText = renderReadResult(emptyExtract.outcome)
  assert.match(emptyExtractText, /Saved page reused\./)
  assert.match(emptyExtractText, /No relevant evidence found\./)
  assert.doesNotMatch(emptyExtractText, /Private cached body/)

  const directFirst = applyReadMeta(emptyExtract.next, {
    requestUrl: `${url}/1`,
    mode: 'direct',
  }, 3000)
  assert.ok(directFirst)
  const directFirstText = renderReadResult(directFirst.outcome)
  assert.match(directFirstText, /Saved page reused\./)
  assert.match(directFirstText, /Page text:\nPrivate cached body/)

  const truncatedDirectText = renderReadResult(directFirst.outcome, 7)
  assert.match(truncatedDirectText, /Truncated: true/)
  assert.match(truncatedDirectText, /Saved content characters: 19/)
  assert.match(truncatedDirectText, /Page text:\nPrivate\n\n\[Page text truncated at 7 of 19 characters\. Use web_read with mode: "extract"/)
  assert.doesNotMatch(truncatedDirectText, /cached body/)

  const directAgain = applyReadMeta(directFirst.next, {
    requestUrl: `${url}/1`,
    mode: 'direct',
  }, 4000)
  assert.ok(directAgain)
  const directAgainText = renderReadResult(directAgain.outcome)
  assert.match(directAgainText, /Page text for S1 was already returned earlier in this session\./)
  assert.doesNotMatch(directAgainText, /Private cached body/)
})

test('tool results append strictly at the tail without snapshot messages, keep snippets on repeat search, and deduplicate direct body', async t => {
  let searchCount = 0
  const h = await harness(t, {
    searchHandler: () => {
      searchCount++
      if (searchCount === 1) {
        return {
          sources: [
            { url, title: 'Article A', snippet: 'Snippet A1' },
            { url: url + '/b', title: 'Article B', snippet: 'Snippet B' },
          ],
          truncated: false,
        }
      }
      return {
        sources: [{ url, title: 'Article A', snippet: 'Snippet A2 (new query)' }],
        truncated: false,
      }
    },
  })
  h.adapter.steps = [
    [['web_search', { queries: ['q1'] }]],
    [['web_search', { queries: ['q2'] }]],
    [['web_read', { target: 'S1', mode: 'extract', focus: 'focus-1' }]],
    [['web_read', { target: 'S1', mode: 'direct' }]],
    [['web_read', { target: 'S1', mode: 'direct' }]],
  ]
  await h.run()

  assert.equal(h.adapter.requests.length, 6)
  for (let i = 0; i < h.adapter.requests.length; i++) {
    const messages = h.adapter.requests[i].messages
    assert.equal(messages[0].role, 'system')
    assert.equal(messages[1].source.kind, 'user')
    if (i > 0) {
      const prev = h.adapter.requests[i - 1].messages
      // Every non-runtime-context prefix message stays identical in place across steps.
      const prevIds = prev.filter(m => m.source.kind !== 'runtime-context').map(m => m.id)
      const currIds = messages.filter(m => m.source.kind !== 'runtime-context').map(m => m.id)
      assert.deepEqual(currIds.slice(0, prevIds.length), prevIds)
    }
  }
  assert.equal(runtimeContexts(h.adapter.requests.at(-1).messages).length, 0)
  assert.match(textOf(h.adapter.requests[0].messages[0]), /Research budget: up to 15 attempts per turn/)

  const toolMessages = h.adapter.requests.at(-1).messages.filter(m => m.role === 'tool')
  assert.equal(toolMessages.length, 5)
  assert.match(textOf(toolMessages[0]), /Material: S1[\s\S]*Snippet A1[\s\S]*Material: S2[\s\S]*Snippet B[\s\S]*Research budget: 15\. Attempts used: 1\. Remaining: 14\./)
  assert.match(textOf(toolMessages[1]), /Material: S1 \(existing\)[\s\S]*Snippet A2 \(new query\)[\s\S]*Research budget: 15\. Attempts used: 2\. Remaining: 13\./)
  assert.match(textOf(toolMessages[2]), /Material: S1[\s\S]*Page fetched\.[\s\S]*Evidence focus: focus-1[\s\S]*提取证据[\s\S]*Research budget: 15\. Attempts used: 3\. Remaining: 12\./)
  assert.doesNotMatch(textOf(toolMessages[2]), /正文完整保留/)
  assert.match(textOf(toolMessages[3]), /Material: S1[\s\S]*Saved page reused\.[\s\S]*Page text:[\s\S]*正文完整保留[\s\S]*Research budget: 15\. Attempts used: 4\. Remaining: 11\./)
  assert.match(textOf(toolMessages[4]), /Page text for S1 was already returned earlier in this session\.[\s\S]*Research budget: 15\. Attempts used: 5\. Remaining: 10\./)
  assert.doesNotMatch(textOf(toolMessages[4]), /正文完整保留/)
})

test('parallel web_search and web_read finalize in model order with consistent handles and existing flags', async t => {
  const urlA = 'https://example.com/a'
  const urlB = 'https://example.com/b'
  const urlC = 'https://example.com/c'
  const releases = new Map()
  const h = await harness(t, {
    searchHandler: request => new Promise(resolve => {
      const q = request.query
      releases.set(`search:${q}`, () => resolve({
        sources: q === 'q1'
          ? [{ url: urlA, title: 'A1', snippet: 'From q1' }]
          : [{ url: urlA, title: 'A2', snippet: 'From q2' }, { url: urlB, title: 'B', snippet: 'From q2' }],
        truncated: false,
      }))
    }),
    fetchHandler: request => new Promise(resolve => {
      releases.set(`fetch:${request.url}`, () => resolve({
        url: request.url + '/final', statusCode: 200, body: { kind: 'text', content: `Body of ${request.url}` }, truncated: false,
      }))
    }),
  })
  h.adapter.steps = [[
    ['web_search', { queries: ['q1'] }],
    ['web_search', { queries: ['q2'] }],
    ['web_read', { target: urlC, mode: 'direct' }],
  ]]

  const idle = (async () => {
    h.agent.followup(user('parallel'))
    await h.agent.whenIdle()
  })()
  for (let i = 0; i < 100 && releases.size < 3; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(releases.size, 3, 'all three calls overlap concurrently')

  // Complete in reverse order to prove post-execute commits strictly in model slot order.
  releases.get(`fetch:${urlC}`)()
  releases.get('search:q2')()
  releases.get('search:q1')()
  await idle

  const toolMessages = h.adapter.requests.at(-1).messages.filter(m => m.role === 'tool')
  assert.equal(toolMessages.length, 3)
  assert.match(textOf(toolMessages[0]), /Material: S1\nURL: https:\/\/example\.com\/a[\s\S]*From q1/)
  assert.match(textOf(toolMessages[1]), /Material: S1 \(existing\)\nURL: https:\/\/example\.com\/a[\s\S]*From q2/)
  assert.match(textOf(toolMessages[1]), /Material: S2\nURL: https:\/\/example\.com\/b/)
  assert.match(textOf(toolMessages[2]), /Material: S3\nURL: https:\/\/example\.com\/c[\s\S]*Body of https:\/\/example\.com\/c/)

  const state = h.ctx.sessionProjections.stateOf(h.agent.session, 'bansoMaterials')
  assert.deepEqual(state.urlIndex, { [urlA]: 'S1', [urlB]: 'S2', [urlC]: 'S3' })
  assert.equal(state.nextHandle, 4)
  assert.equal(state.items.S3.pageShown, true)
})

test('plugin reload and session isolation preserve state without leaking handles', async t => {
  const h = await harness(t)
  h.adapter.steps = [[['web_search', { queries: ['q'] }]]]
  await h.run()
  const before = structuredClone(h.ctx.sessionProjections.stateOf(h.agent.session, 'bansoMaterials'))
  await h.fiber.dispose()
  await h.ctx.plugin(Materials)
  assert.deepEqual(h.ctx.sessionProjections.stateOf(h.agent.session, 'bansoMaterials'), before)

  const other = await h.ctx.agentLoop.create(SessionId('other'), { provider: 'mock', model: 'mock' })
  h.adapter.steps = [[['web_search', { queries: ['q'] }]]]
  await h.run(other)
  const otherTool = h.adapter.requests.at(-1).messages.find(m => m.role === 'tool')
  assert.match(textOf(otherTool), /Material: S1\n/)
  assert.doesNotMatch(textOf(otherTool), /\(existing\)/)
})
