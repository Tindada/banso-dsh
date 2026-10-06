import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import Llm, { LlmAdapter, LlmError, createUserMessage, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Prompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as Materials from '../lib/index.js'
import { renderMaterials } from '../lib/context.js'
import { materialsProjection } from '../lib/projection.js'
import { materialsSnapshotProjection } from '../lib/snapshot.js'

const url = 'https://example.com/a'
const user = text => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const snapshots = messages => messages.filter(m => m.source.kind === 'banso-materials' && m.source.form === 'snapshot')
const placeholders = messages => messages.filter(m => m.source.kind === 'banso-materials' && m.source.form === 'placeholder')
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
async function harness(t) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const errors = []
  ctx.on('agent/error', ({ error }) => errors.push(error))
  for (const plugin of [Llm, Sessions, Projections, Prompt, Tools, Agents]) await ctx.plugin(plugin)
  await ctx.plugin(Loop, { agents: [] })
  const fiber = await ctx.plugin(Materials)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('main'), { provider: 'mock', model: 'mock' })
  const run = async (target = agent) => { target.followup(user('research')); await target.whenIdle(); assert.deepEqual(errors, []) }
  let count = 0
  // Supply recorded tool facts directly: context tests do not execute a web tool.
  const recordRead = (text = '提取证据') => {
    const callId = `fixture-${++count}`
    const call = agent.session.append('tool/call', {
      name: 'web_read', arguments: JSON.stringify({ target: url, focus: 'facts' }), callId, turn: 0, step: 0,
    })
    agent.session.append('tool/result', {
      turn: 0, step: 0,
      message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'Fixture receipt' }], isError: false }),
      meta: { requestUrl: url, focus: 'facts', finalUrl: url + '/final', truncated: true, content: '正文完整保留', evidence: text },
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  }
  return { ctx, agent, adapter, fiber, run, recordRead }
}

test('rendering is deterministic, numerically ordered and preserves source information', () => {
  const state = materialsProjection.init()
  assert.equal(renderMaterials(state), undefined)
  for (const handle of ['S10', 'S2', 'S1']) state.items[handle] = { handle, url: `${url}/${handle}` }
  state.items.S1 = {
    ...state.items.S1, title: '中文标题', snippet: '中文摘要', publishedAt: '2026-10-05',
    fetched: { content: '原文\n'.repeat(1000), finalUrl: url + '/redirect', truncated: true, time: 0 },
  }
  const before = structuredClone(state)
  const rendered = renderMaterials(state)
  assert.ok(rendered.indexOf('Material: S1\n') < rendered.indexOf('Material: S2\n'))
  assert.ok(rendered.indexOf('Material: S2\n') < rendered.indexOf('Material: S10\n'))
  for (const text of ['中文标题', '2026-10-05', 'Truncated: true', '1970-01-01T00:00:00.000Z', url + '/redirect']) assert.ok(rendered.includes(text))
  assert.ok(rendered.includes('中文摘要'))
  assert.ok(!rendered.includes(state.items.S1.fetched.content))
  state.pendingCalls.x = { name: 'web_search', callId: 'x', turn: 1 }
  assert.equal(renderMaterials(state), rendered)
  delete state.pendingCalls.x
  assert.deepEqual(state, before)
})

test('material updates, unchanged turns, retries, reload, surface replacement and session isolation', async t => {
  const h = await harness(t)
  h.recordRead()
  await h.run()
  const original = locator(h.ctx, h.agent)
  assert.equal(snapshots(h.adapter.requests[0].messages).length, 1)
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
  assert.equal(snapshots(h.adapter.requests.at(-1).messages).length, 0)
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
  h.recordRead('补充证据')
  await h.run()
  const latest = h.adapter.requests.at(-1).messages
  assert.doesNotMatch(textOf(snapshots(latest)[0]), /正文完整保留/)
  assert.equal(snapshots(latest).length, 1)
  assert.equal(placeholders(latest).length, 1)
  assert.match(textOf(snapshots(latest)[0]), /补充证据/)
  assert.match(textOf(snapshots(latest)[0]), /提取证据/)
  assert.doesNotMatch(textOf(placeholders(latest)[0]), /提取证据/)
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
  assert.equal(snapshotEventCount(), before + 2)
  assert.match(textOf(snapshots(h.adapter.requests.at(-1).messages)[0]), /补充证据/)
})

test('a failed admission after replacement is repaired on the next step', async t => {
  const h = await harness(t)
  h.recordRead()
  await h.run()
  // Make new material state available without admitting its snapshot yet.
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
  assert.equal(locator(h.ctx, h.agent), null)
  assert.equal(snapshots(h.agent.session.deriveMessages()).length, 0)
  assert.equal(placeholders(h.agent.session.deriveMessages()).length, 1)
  h.agent.followup(user('try again'))
  await h.agent.whenIdle()
  const messages = h.adapter.requests.at(-1).messages
  assert.equal(snapshots(messages).length, 1)
  assert.equal(placeholders(messages).length, 1)
  assert.match(textOf(snapshots(messages)[0]), /补充证据/)
})
