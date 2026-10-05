import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyMaterials, materialsProjection } from '../lib/projection.js'
const A = 'https://example.com/a'
const B = 'https://example.com/b'
function fixture() {
  let state = materialsProjection.init()
  let seq = 0
  const events = []
  const emit = event => {
    const full = { seq: seq++, time: seq * 100, ...event }
    const prior = structuredClone(state)
    const previous = state
    state = applyMaterials(state, full)
    assert.deepEqual(previous, prior, 'fold must not mutate prior state')
    materialsProjection.stateSchema.parse(state)
    events.push(full)
    return full
  }
  const call = (name = 'web_search', args = { queries: ['q'] }, turn = 1) => emit({ type: 'tool/call', data: { name, arguments: JSON.stringify(args), callId: `c${seq}`, turn, step: 1 } })
  const result = (call, meta, options = {}) => emit({ type: 'tool/result', surfaceOp: 'append', sourceEventSeqs: [call.seq], data: {
    turn: call.data.turn, step: 1,
    message: { role: 'tool', toolCallId: call.data.callId, content: [{ type: 'text', text: options.text ?? 'Fetch completed.' }], isError: options.isError ?? false },
    ...(meta === undefined ? {} : { meta }),
    ...(options.error ? { error: { name: 'Error', code: 'FETCH_FAILED', reason: options.error } } : {}),
  }, ...options.event })
  return { emit, call, result, events, get state() { return state } }
}
const search = sources => ({ sources, truncated: false })
const fetch = (url = A, statusCode = 200, truncated = false, content = 'Fetched body') => ({ url, statusCode, truncated, content })

test('search deduplicates exact URLs, retains absent fields and fetched content across turns', () => {
  const f = fixture()
  f.result(f.call(), search([{ url: A, title: 'First', snippet: 'Summary', publishedAt: '2026-10-04' }, { url: A }, { url: B }]))
  assert.equal(f.state.nextHandle, 3)
  f.result(f.call('web_fetch', { url: A }), fetch(A, 200, true))
  const content = f.state.items.S1.fetched
  f.emit({ type: 'turn/end', data: { turn: 1 } })
  f.result(f.call('web_search', { queries: ['next'] }, 2), search([{ url: A, title: 'Updated' }]))
  assert.equal(f.state.items.S1.title, 'Updated')
  assert.equal(f.state.items.S1.snippet, 'Summary')
  assert.deepEqual(f.state.items.S1.fetched, content)
  assert.equal(content.truncated, true)
  assert.equal(f.state.items.S2.title, undefined)
  assert.deepEqual(f.events.reduce(applyMaterials, materialsProjection.init()), f.state)
})

test('direct fetch creates material; redirects stay separate; failures retain successful content', () => {
  const f = fixture()
  f.result(f.call('web_fetch', { url: A }), fetch(B, 200, false, 'Header\nBody\nNotice'))
  const saved = f.state.items.S1.fetched
  assert.equal(saved.finalUrl, B)
  assert.equal(saved.content, 'Header\nBody\nNotice')
  f.result(f.call(), search([{ url: B }]))
  assert.equal(f.state.urlIndex[B], 'S2')
  f.result(f.call('web_fetch', { url: A }), fetch(A, 404), { text: 'not found' })
  assert.deepEqual(f.state.items.S1.fetched, saved)
  assert.equal(f.state.items.S1.lastFetch.statusCode, 404)
  f.result(f.call('web_fetch', { url: A }), undefined, { isError: true, error: 'timeout' })
  assert.deepEqual(f.state.items.S1.fetched, saved)
  assert.equal(f.state.items.S1.lastFetch.error, 'timeout')
  f.result(f.call('web_fetch', { url: A }), fetch(A, 200, false, 'New body'))
  assert.equal(f.state.items.S1.fetched.content, 'New body')
  assert.equal(f.state.items.S1.lastFetch.status, 'success')
})

test('correlates out-of-order results by source seq and call id; cleans incomplete calls', () => {
  const f = fixture()
  const a = f.call('web_fetch', { url: A })
  const b = f.call('web_fetch', { url: B })
  const before = f.state
  f.result(a, fetch(), { event: { sourceEventSeqs: [999] } })
  assert.equal(f.state, before)
  f.result(b, fetch(B, 200, false, 'B'))
  f.result(a, fetch(A, 200, false, 'A'))
  assert.equal(f.state.items.S1.url, B)
  assert.equal(f.state.items.S2.url, A)
  const pending = f.call()
  const original = f.state
  f.emit({ type: 'tool/result', surfaceOp: 'append', sourceEventSeqs: [pending.seq], data: { turn: 1, message: { toolCallId: 'wrong' } } })
  assert.equal(f.state, original)
  f.emit({ type: 'turn/end', data: { turn: 1 } })
  assert.deepEqual(f.state.pendingCalls, {})
})

test('ignores unknown, invalid, missing metadata and surface replacements without importing material', () => {
  const f = fixture()
  const empty = f.state
  f.call('another_tool')
  f.call('web_fetch', { url: 'file:///tmp/a' })
  f.emit({ type: 'tool/call', data: { name: 'web_fetch', arguments: '{' } })
  f.emit({ type: 'turn/start', data: { turn: 1 } })
  assert.equal(f.state, empty)
  f.result(f.call(), search([{ url: A, title: 42 }]))
  f.result(f.call(), undefined)
  f.result(f.call('web_fetch', { url: A }), { url: A, statusCode: 200 })
  f.result(f.call(), search([{ url: A }]), { isError: true })
  assert.deepEqual(f.state.items, {})
  f.result(f.call(), search([{ url: A }]))
  const item = f.state.items.S1
  const c = f.call('web_fetch', { url: A })
  f.result(c, fetch(), { event: { surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } } })
  assert.equal(f.state.items.S1, item)
  assert.equal(f.state.items.S1.fetched, undefined)
})

test('separate initial states never share containers or handles', () => {
  const a = fixture(), b = fixture()
  a.result(a.call(), search([{ url: A }]))
  b.result(b.call(), search([{ url: B }]))
  assert.equal(a.state.items.S1.url, A)
  assert.equal(b.state.items.S1.url, B)
})


test('fetch accepts only metadata content, never a receipt as body; state version stays unchanged', () => {
  const f = fixture()
  for (const meta of [
    { url: A, statusCode: 200, truncated: false },
    { url: A, statusCode: 200, truncated: false, content: 42 },
  ]) {
    f.result(f.call('web_fetch', { url: A }), meta, { text: 'Must not become saved content' })
    assert.deepEqual(f.state.items, {})
  }
  f.result(f.call('web_fetch', { url: A }), fetch(A, 200, false, 'Metadata body'), { text: 'Short receipt' })
  assert.equal(f.state.items.S1.fetched.content, 'Metadata body')
  f.result(f.call('web_fetch', { url: A }), { url: A, statusCode: 200, truncated: false, content: null })
  assert.equal(f.state.items.S1.fetched.content, 'Metadata body')
  assert.equal(materialsProjection.stateVersion, 1)
})
