import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyMaterials, materialsProjection } from '../lib/projection.js'
const A = 'https://example.com/a', B = 'https://example.com/b'
function fixture() {
  let state = materialsProjection.init(), seq = 0
  const events = []
  const emit = event => {
    const full = { seq: seq++, time: seq * 100, ...event }
    const prior = structuredClone(state), previous = state
    state = applyMaterials(state, full)
    assert.deepEqual(previous, prior, 'fold must not mutate prior state')
    materialsProjection.stateSchema.parse(state)
    events.push(full)
    return full
  }
  const call = (name = 'web_search', args = { queries: ['q'] }, turn = 1) => emit({ type: 'tool/call', data: { name, arguments: JSON.stringify(args), callId: `c${seq}`, turn, step: 1 } })
  const read = (target = A, focus = 'facts') => call('web_read', { target, focus })
  const result = (call, meta, options = {}) => emit({ type: 'tool/result', surfaceOp: 'append', sourceEventSeqs: [call.seq], data: {
    turn: call.data.turn, step: 1,
    message: { role: 'tool', toolCallId: call.data.callId, content: [{ type: 'text', text: 'Short receipt, never evidence' }], isError: options.isError ?? false },
    ...(meta === undefined ? {} : { meta }),
  }, ...options.event })
  return { emit, call, read, result, events, get state() { return state } }
}
const search = sources => ({ sources, truncated: false })
const page = { finalUrl: B, truncated: true, content: 'Full body' }
const success = (requestUrl = A, focus = 'facts') => ({ requestUrl, focus, ...page, evidence: 'Evidence' })
const reused = (focus = 'facts') => ({ requestUrl: A, focus, evidence: 'Evidence' })

test('search deduplicates exact URLs and retains body and evidence across turns', () => {
  const f = fixture()
  f.result(f.call(), search([{ url: A, title: 'First', snippet: 'Summary' }, { url: A }, { url: B }]))
  assert.equal(f.state.nextHandle, 3)
  f.result(f.read('S1'), success())
  const saved = structuredClone(f.state.items.S1)
  f.emit({ type: 'turn/end', data: { turn: 1 } })
  f.result(f.call('web_search', { queries: ['next'] }, 2), search([{ url: A, title: 'Updated' }]))
  assert.equal(f.state.items.S1.title, 'Updated')
  assert.equal(f.state.items.S1.snippet, 'Summary')
  assert.deepEqual(f.state.items.S1.fetched, saved.fetched)
  assert.deepEqual(f.state.items.S1.evidence, saved.evidence)
  assert.equal(saved.fetched.truncated, true)
  assert.deepEqual(f.events.reduce(applyMaterials, materialsProjection.init()), f.state)
})

test('new URL saves redirected body; reuse appends focus groups without changing fetch time', () => {
  const f = fixture()
  f.result(f.read(), success())
  const saved = structuredClone(f.state.items.S1.fetched)
  assert.equal(saved.finalUrl, B)
  assert.equal(f.state.urlIndex[B], undefined)
  f.result(f.read('S1', '  新焦点  '), reused('  新焦点  '))
  assert.deepEqual(f.state.items.S1.fetched, saved)
  assert.equal(f.state.items.S1.evidence.length, 2)
  assert.deepEqual(f.state.items.S1.evidence.map(e => e.focus), ['facts', '  新焦点  '])
  f.result(f.call(), search([{ url: B }]))
  assert.equal(f.state.urlIndex[B], 'S2')
})

test('extraction failure and empty results preserve body and previous evidence', () => {
  const f = fixture()
  f.result(f.read(), { requestUrl: A, focus: 'facts', ...page, error: 'Extraction failed: invalid JSON' })
  assert.equal(f.state.items.S1.fetched.content, 'Full body')
  assert.equal(f.state.items.S1.evidence, undefined)
  f.result(f.read('S1'), reused())
  const saved = structuredClone(f.state.items.S1)
  for (const outcome of [{ evidence: '' }, { error: 'Extraction failed: no route' }]) {
    f.result(f.read(), { requestUrl: A, focus: 'facts', ...outcome })
    assert.deepEqual(f.state.items.S1.evidence, saved.evidence)
    assert.deepEqual(f.state.items.S1.fetched, saved.fetched)
  }
})

test('fetch failures create URL entries and retain existing successful body; ordinary errors do not import', () => {
  const f = fixture()
  const failed = { requestUrl: A, focus: 'facts', error: 'Fetch failed: HTTP 503' }
  f.result(f.read(), failed)
  assert.equal(f.state.items.S1.fetched, undefined)
  f.result(f.read(), success())
  const saved = structuredClone(f.state.items.S1.fetched)
  f.result(f.read('S1'), failed)
  assert.deepEqual(f.state.items.S1.fetched, saved)
  f.result(f.read(B), undefined, { isError: true })
  assert.equal(f.state.nextHandle, 2)
  f.result(f.read(B), { ...failed, requestUrl: B, error: 'Fetch failed: offline' })
  assert.equal(f.state.items.S2.url, B)
  assert.equal(f.state.urlIndex[B], 'S2')
})

test('correlates out-of-order results, deterministic numbering and replay, clears pending calls', () => {
  const f = fixture(), a = f.read(A), b = f.read(B)
  const before = f.state
  f.result(a, success(), { event: { sourceEventSeqs: [999] } })
  assert.equal(f.state, before)
  f.result(b, success(B))
  f.result(a, success(A))
  assert.equal(f.state.items.S1.url, B)
  assert.equal(f.state.items.S2.url, A)
  const pending = f.call(), original = f.state
  f.emit({ type: 'tool/result', surfaceOp: 'append', sourceEventSeqs: [pending.seq], data: { turn: 1, message: { toolCallId: 'wrong' } } })
  assert.equal(f.state, original)
  f.emit({ type: 'turn/end', data: { turn: 1 } })
  assert.deepEqual(f.state.pendingCalls, {})
  assert.deepEqual(f.events.reduce(applyMaterials, materialsProjection.init()), f.state)
})

test('ignores malformed metadata, surface replacement and unrelated tools', () => {
  const f = fixture(), empty = f.state
  f.call('another_tool')
  assert.equal(f.state, empty)
  for (const meta of [undefined, { ...success(), content: 42 }, { requestUrl: A, focus: 'facts', content: 'Incomplete page' }]) {
    f.result(f.read(), meta)
    assert.deepEqual(f.state.items, {})
  }
  f.result(f.call(), search([{ url: A, title: 42 }]))
  f.result(f.call(), search([{ url: A }]), { isError: true })
  assert.deepEqual(f.state.items, {})
  f.result(f.read(), success(), { event: { surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } } })
  assert.deepEqual(f.state.items, {})
})

test('separate initial states do not share handles or evidence', () => {
  const a = fixture(), b = fixture()
  a.result(a.read(), success())
  b.result(b.read(B), success(B))
  assert.equal(a.state.items.S1.url, A)
  assert.equal(b.state.items.S1.url, B)
  assert.notEqual(a.state.items.S1.evidence, b.state.items.S1.evidence)
})
