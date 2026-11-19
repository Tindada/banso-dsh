import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Llm, { LlmAdapter, LlmError, createUserMessage, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Web from '@deepseek-ai/dsh-web'
import Tools from '@deepseek-ai/dsh-tools'
import * as Materials from '../lib/index.js'
import { renderMaterials } from '../lib/context/context.js'
import { materialsProjection } from '../lib/state/projection.js'
import { materialsSnapshotProjection } from '../lib/state/snapshot.js'

const url = 'https://example.com/a'
const user = text => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const snapshots = messages => messages.filter(m => m.source.kind === 'banso-materials' && m.source.form === 'snapshot')
const runtimeContexts = messages => messages.filter(m => m.source.kind === 'runtime-context')
const textOf = m => m.content.map(b => b.text ?? '').join('\n')
const locator = (ctx, agent) => ctx.sessionProjections.stateOf(agent.session, 'bansoMaterialsSnapshot')

class Adapter extends LlmAdapter {
  requests = []
  action = () => undefined
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(request) {
    this.requests.push(request)
    this.action(request)
    const block = { type: 'text', text: 'done' }
    yield { type: 'block-start', index: 0, blockType: block.type }
    yield { type: 'text-delta', index: 0, text: block.text }
    yield { type: 'block-end', index: 0, block }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function harness(t, mode = 'extract') {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const errors = []
  ctx.on('agent/error', ({ error }) => errors.push(error))
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, Agents]) await ctx.plugin(plugin)
  await ctx.plugin(Loop, { agents: [] })
  await ctx.plugin(Web)
  const fiber = await ctx.plugin(Materials)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('main'), { provider: 'mock', model: 'mock' })
  const run = async (target = agent) => { target.followup(user('research')); await target.whenIdle(); assert.deepEqual(errors, []) }
  let count = 0
  // Supply recorded tool facts directly: context tests do not execute a web tool.
  const recordSearch = sources => {
    const callId = `fixture-${++count}`
    const call = agent.session.append('tool/call', {
      name: 'web_search', arguments: JSON.stringify({ queries: ['q'] }), callId, turn: 0, step: 0,
    })
    agent.session.append('tool/result', {
      turn: 0, step: 0,
      message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'Search receipt' }], isError: false }),
      meta: { sources, truncated: false },
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  }
  const recordRead = (text = '提取证据', requestUrl = url, selectedMode = mode, focus = 'facts') => {
    const callId = `fixture-${++count}`
    const call = agent.session.append('tool/call', {
      name: 'web_read', arguments: JSON.stringify({ target: requestUrl, mode: selectedMode, ...(selectedMode === 'extract' ? { focus } : {}) }), callId, turn: 0, step: 0,
    })
    agent.session.append('tool/result', {
      turn: 0, step: 0,
      message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'Fixture receipt' }], isError: false }),
      meta: { requestUrl, mode: selectedMode, ...(selectedMode === 'extract' ? { focus, evidence: text } : {}), finalUrl: requestUrl + '/final', truncated: true, content: '正文完整保留' },
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  }
  const recordFailedSearch = () => {
    const callId = `fixture-${++count}`
    const call = agent.session.append('tool/call', {
      name: 'web_search', arguments: JSON.stringify({ queries: ['fail'] }), callId, turn: 0, step: 0,
    })
    agent.session.append('tool/result', {
      turn: 0, step: 0,
      message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'Error: failed' }], isError: true }),
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  }
  return { ctx, agent, adapter, fiber, run, recordSearch, recordRead, recordFailedSearch }
}

test('materials_hide tool is not registered', async t => {
  const h = await harness(t)
  assert.equal(h.ctx.tools.get('materials_hide', h.agent), undefined)
})

test('rendering is deterministic, arrival-ordered, append-only and excludes budget header', () => {
  const state = materialsProjection.init()
  const empty = renderMaterials(state)
  assert.doesNotMatch(empty, /Research budget:|no visible materials/i)
  state.items.S1 = {
    handle: 'S1', url: `${url}/S1`, title: '中文标题', snippet: '中文摘要', publishedAt: '2026-10-05',
    fetched: { content: '原文\n'.repeat(1000), finalUrl: url + '/redirect', truncated: true, time: 0 },
    evidence: [{ focus: 'facts', text: '证据内容', time: 1000 }],
  }
  state.items.S2 = { handle: 'S2', url: `${url}/S2` }
  state.entries.push(
    { kind: 'source', handle: 'S1', url: `${url}/S1`, title: '中文标题', snippet: '中文摘要', publishedAt: '2026-10-05' },
    { kind: 'source', handle: 'S2', url: `${url}/S2` },
  )
  const before = structuredClone(state)
  const afterSources = renderMaterials(state)
  assert.ok(afterSources.startsWith(empty))
  assert.ok(afterSources.indexOf('Material: S1\n') < afterSources.indexOf('Material: S2\n'))
  for (const text of ['中文标题', '中文摘要', '2026-10-05']) assert.ok(afterSources.includes(text))
  state.entries.push(
    { kind: 'fetched', handle: 'S1' },
    { kind: 'evidence', handle: 'S1', index: 0 },
  )
  const afterEvidence = renderMaterials(state)
  assert.ok(afterEvidence.startsWith(afterSources))
  for (const text of ['Truncated: true', '1970-01-01T00:00:00.000Z', url + '/redirect', '证据内容']) {
    assert.ok(afterEvidence.includes(text))
  }
  state.pendingCalls.x = { name: 'web_search', callId: 'x', turn: 1 }
  assert.equal(renderMaterials(state), afterEvidence)
  delete state.pendingCalls.x
  state.entries.splice(-2)
  assert.deepEqual(state, before)
})

test('snapshot stays fixed at node 1 before user messages and grows strictly append-only', async t => {
  const h = await harness(t)
  await h.run()
  const req0 = h.adapter.requests[0].messages
  assert.equal(req0[0].role, 'system')
  assert.equal(req0[1].source.kind, 'banso-materials')
  assert.equal(req0[2].source.kind, 'user')
  assert.equal(snapshots(req0).length, 1)
  const snap0 = textOf(req0[1])
  assert.doesNotMatch(snap0, /Research budget:/)
  assert.match(textOf(runtimeContexts(req0).at(-1)), /Research budget: 15\. Attempts used: 0\. Remaining: 15/)

  // Budget-only change (failed search) updates runtime-context without touching the materials snapshot.
  const locatorBeforeFail = locator(h.ctx, h.agent)
  h.recordFailedSearch()
  await h.run()
  const reqFail = h.adapter.requests.at(-1).messages
  assert.equal(reqFail[1].id, locatorBeforeFail.messageId)
  assert.equal(textOf(reqFail[1]), snap0)

  // New search sources append after static header.
  h.recordSearch([{ url, title: 'Article A', snippet: 'Snippet A' }, { url: url + '/b', title: 'Article B' }])
  await h.run()
  const req1 = h.adapter.requests.at(-1).messages
  assert.equal(snapshots(req1).length, 1)
  assert.equal(req1[0].role, 'system')
  assert.equal(req1[1].source.kind, 'banso-materials')
  assert.equal(req1[2].source.kind, 'user')
  const snap1 = textOf(req1[1])
  assert.ok(snap1.startsWith(snap0))
  assert.match(snap1, /Article A[\s\S]*Snippet A[\s\S]*Article B/)

  // Duplicate search does not append again.
  const locatorAfterSearch = locator(h.ctx, h.agent)
  h.recordSearch([{ url, title: 'Article A updated', snippet: 'Different snippet' }])
  await h.run()
  const reqDup = h.adapter.requests.at(-1).messages
  assert.equal(reqDup[1].id, locatorAfterSearch.messageId)
  assert.equal(textOf(reqDup[1]), snap1)

  // Reading S1 appends evidence at the tail without modifying S1/S2 source blocks above.
  h.recordRead('第一条证据', url, 'extract', 'focus-1')
  await h.run()
  const req2 = h.adapter.requests.at(-1).messages
  assert.equal(snapshots(req2).length, 1)
  assert.equal(req2[1].source.kind, 'banso-materials')
  const snap2 = textOf(req2[1])
  assert.ok(snap2.startsWith(snap1))
  assert.match(snap2, /第一条证据/)
  assert.match(snap2, /Snippet A/)

  // Switching S1 to direct appends page text at the tail while keeping prior evidence and single Saved page metadata.
  h.recordRead('', url, 'direct')
  await h.run()
  const req3 = h.adapter.requests.at(-1).messages
  const snap3 = textOf(req3[1])
  assert.ok(snap3.startsWith(snap2))
  assert.equal(snap3.split('正文完整保留').length - 1, 1)
  assert.equal(snap3.split('Saved page:').length - 1, 1)
  assert.match(snap3, /第一条证据/)

  // Repeated direct read reuses body without duplicating it.
  const locatorAfterDirect = locator(h.ctx, h.agent)
  h.recordRead('', url, 'direct')
  await h.run()
  const req4 = h.adapter.requests.at(-1).messages
  assert.equal(req4[1].id, locatorAfterDirect.messageId)
  assert.equal(textOf(req4[1]), snap3)
  assert.equal(snap3.split('正文完整保留').length - 1, 1)
})

test('material updates, unchanged turns, retries, reload, external replacement and session isolation', async t => {
  const h = await harness(t)
  h.recordRead()
  await h.run()
  const original = locator(h.ctx, h.agent)
  assert.equal(snapshots(h.adapter.requests[0].messages).length, 1)
  assert.equal(snapshots(h.adapter.requests[0].messages)[0].id, original.messageId)
  assert.match(textOf(snapshots(h.adapter.requests[0].messages)[0]), /提取证据/)
  assert.match(textOf(snapshots(h.adapter.requests[0].messages)[0]), /Truncated: true/)
  let retry = true
  const stopRetry = h.ctx.on('agent/request-error', () => ({ kind: 'retry' }))
  h.adapter.action = () => { if (retry) { retry = false; throw new LlmError('retry', 'RATE_LIMIT') } }
  await h.run()
  stopRetry()
  assert.equal(h.adapter.requests.length, 3)
  for (const request of h.adapter.requests.slice(1)) {
    assert.equal(snapshots(request.messages).length, 1)
    assert.equal(snapshots(request.messages)[0].id, original.messageId)
  }
  await h.fiber.dispose()
  await h.ctx.plugin(Materials)
  assert.deepEqual(locator(h.ctx, h.agent), original)
  await h.run()
  assert.deepEqual(locator(h.ctx, h.agent), original)
  const other = await h.ctx.agentLoop.create(SessionId('other'), { provider: 'mock', model: 'mock' })
  await h.run(other)
  assert.equal(snapshots(h.adapter.requests.at(-1).messages).length, 1)
  // Empty assistant nodes are omitted by deriveMessages; sequence lookup must not zip arrays.
  h.agent.session.append('assistant/message', {
    turn: 1, step: 0, message: createAssistantMessage({ content: [], source: { provider: 'mock', model: 'mock' } }),
  }, { surfaceOp: 'append' })
  h.agent.session.append('user/message', user('external replacement'), {
    surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq],
  })
  await h.run()
  const rebuilt = locator(h.ctx, h.agent)
  assert.notEqual(rebuilt.messageId, original.messageId)
  assert.equal(snapshots(h.adapter.requests.at(-1).messages).length, 1)
  const rebuiltText = textOf(snapshots(h.adapter.requests.at(-1).messages)[0])
  h.recordRead('补充证据')
  await h.run()
  const latest = h.adapter.requests.at(-1).messages
  const latestText = textOf(snapshots(latest)[0])
  assert.ok(latestText.startsWith(rebuiltText))
  assert.doesNotMatch(latestText, /正文完整保留/)
  assert.equal(snapshots(latest).length, 1)
  assert.match(latestText, /补充证据/)
  assert.match(latestText, /提取证据/)
  const replayed = h.agent.session.snapshotEvents().reduce(materialsSnapshotProjection.apply, materialsSnapshotProjection.init())
  assert.deepEqual(replayed, locator(h.ctx, h.agent))
})

test('rejected admission does not replace an existing snapshot or commit a candidate', async t => {
  const h = await harness(t)
  h.recordRead()
  await h.run()
  const original = locator(h.ctx, h.agent)
  const snapshotEventCount = () => h.agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'banso-materials').length
  const before = snapshotEventCount()
  const reject = h.ctx.on('agent/pre-step', async () => ({ kind: 'reject' }))
  h.recordRead('补充证据')
  await h.run()
  assert.equal(snapshotEventCount(), before)
  assert.deepEqual(locator(h.ctx, h.agent), original)
  reject()
  await h.run()
  assert.equal(snapshotEventCount(), before + 1)
  assert.match(textOf(snapshots(h.adapter.requests.at(-1).messages)[0]), /补充证据/)
})

test('a failed outer pre-step after in-place replacement still leaves a valid latest snapshot', async t => {
  const h = await harness(t)
  h.recordRead()
  await h.run()
  const reject = h.ctx.on('agent/pre-step', async () => ({ kind: 'reject' }))
  h.recordRead('补充证据')
  await h.run()
  reject()
  await h.fiber.dispose()
  let fail = true
  const stop = h.ctx.on('agent/pre-step', async (_, next) => {
    const decision = await next()
    if (fail) { fail = false; throw new Error('admission interrupted') }
    return decision
  })
  await h.ctx.plugin(Materials)
  h.agent.followup(user('continue'))
  await h.agent.whenIdle()
  stop()
  assert.equal(snapshots(h.agent.session.deriveMessages()).length, 1)
  assert.match(textOf(snapshots(h.agent.session.deriveMessages())[0]), /补充证据/)
  h.agent.followup(user('try again'))
  await h.agent.whenIdle()
  const messages = h.adapter.requests.at(-1).messages
  assert.equal(snapshots(messages).length, 1)
  assert.match(textOf(snapshots(messages)[0]), /补充证据/)
})

test('empty extracted evidence does not expose cached body', () => {
  const state = {
    budget: { used: 0 },
    items: {
      S1: {
        handle: 'S1', url, snippet: 'Preview',
        fetched: { content: 'Private cached body', finalUrl: url, truncated: false, time: 0 },
      },
    },
    urlIndex: { [url]: 'S1' },
    nextHandle: 2,
    pendingCalls: {},
    entries: [{ kind: 'source', handle: 'S1', url, snippet: 'Preview' }],
  }
  assert.match(renderMaterials(state), /Search snippet: Preview/)
  assert.doesNotMatch(renderMaterials(state), /Private cached body|Page text:/)
})
