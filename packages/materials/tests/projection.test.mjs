import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyMaterials, materialsProjection } from '../lib/state/projection.js'
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
  const read = (target = A, focus = 'facts') => call('web_read', { target, mode: 'extract', focus })
  const result = (call, meta, options = {}) => emit({ type: 'tool/result', surfaceOp: 'append', sourceEventSeqs: [call.seq], data: {
    turn: call.data.turn, step: 1,
    message: { role: 'tool', toolCallId: call.data.callId, content: [{ type: 'text', text: 'Short receipt, never evidence' }], isError: options.isError ?? false },
    ...(meta === undefined ? {} : { meta }),
  }, ...options.event })
  return { emit, call, read, result, events, get state() { return state } }
}
const search = sources => ({ sources, truncated: false })
const page = { finalUrl: B, truncated: true, content: 'Full body' }
const success = (requestUrl = A, focus = 'facts') => ({ requestUrl, mode: 'extract', focus, ...page, evidence: 'Evidence' })
const reused = (focus = 'facts') => ({ requestUrl: A, mode: 'extract', focus, evidence: 'Evidence' })

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
  f.result(f.read(), { requestUrl: A, mode: 'extract', focus: 'facts', ...page, error: 'Extraction failed: invalid JSON' })
  assert.equal(f.state.items.S1.fetched.content, 'Full body')
  assert.equal(f.state.items.S1.evidence, undefined)
  f.result(f.read('S1'), reused())
  const saved = structuredClone(f.state.items.S1)
  for (const outcome of [{ evidence: '' }, { error: 'Extraction failed: no route' }]) {
    f.result(f.read(), { requestUrl: A, mode: 'extract', focus: 'facts', ...outcome })
    assert.deepEqual(f.state.items.S1.evidence, saved.evidence)
    assert.deepEqual(f.state.items.S1.fetched, saved.fetched)
  }
})

test('fetch failures create URL entries and retain existing successful body; ordinary errors do not import', () => {
  const f = fixture()
  const failed = { requestUrl: A, mode: 'extract', focus: 'facts', error: 'Fetch failed: HTTP 503' }
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
  for (const meta of [undefined, { ...success(), content: 42 }, { requestUrl: A, mode: 'extract', focus: 'facts', content: 'Incomplete page' }]) {
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


test('direct read results correlate out of order, save and reuse bodies, and replay', () => {
  const f = fixture()
  const a = f.call('web_read', { mode: 'direct', target: A }), b = f.call('web_read', { mode: 'direct', target: B })
  f.result(b, { mode: 'direct', requestUrl: B, ...page })
  f.result(a, { mode: 'direct', requestUrl: A, content: '', finalUrl: A, truncated: false, evidence: 'must not import', focus: 'ignored' })
  assert.equal(f.state.items.S1.url, B)
  assert.equal(f.state.items.S2.fetched.content, '')
  assert.equal(f.state.items.S2.evidence, undefined)
  const saved = structuredClone(f.state.items.S2.fetched)
  f.result(f.call('web_read', { mode: 'direct', target: 'S2' }), { mode: 'direct', requestUrl: A })
  assert.deepEqual(f.state.items.S2.fetched, saved)
  assert.equal(f.state.nextHandle, 3)
  f.result(f.call('web_read', { target: A, mode: 'direct' }), { mode: 'direct', requestUrl: A, error: 'Fetch failed' })
  assert.deepEqual(f.state.items.S2.fetched, saved)
  const before = structuredClone(f.state.items)
  f.result(f.call('web_read', { target: A, mode: 'direct' }), { mode: 'direct', requestUrl: A, content: 'missing finalUrl' })
  f.result(f.call('web_read', { target: A, mode: 'direct' }), undefined, { isError: true })
  assert.deepEqual(f.state.items, before)
  assert.deepEqual(f.state.pendingCalls, {})
  const replayed = f.events.reduce(applyMaterials, materialsProjection.init())
  assert.deepEqual(replayed, f.state)
})


test('mixed read modes preserve caches, mark pageShown once, and ignore failures', () => {
  const f = fixture()
  f.result(f.read(), { ...success(), mode: 'extract' })
  assert.equal(f.state.items.S1.pageShown, undefined)
  const saved = structuredClone(f.state.items.S1)
  const extract = f.read(), direct = f.read()
  f.result(direct, { requestUrl: A, mode: 'direct' })
  assert.equal(f.state.items.S1.pageShown, true)
  assert.deepEqual(f.state.items.S1.evidence, saved.evidence)
  const afterDirect = structuredClone(f.state.items.S1)
  f.result(f.read(), { requestUrl: A, mode: 'extract', focus: 'facts', error: 'Extraction failed' })
  assert.deepEqual(f.state.items.S1, afterDirect)
  f.result(f.read(), undefined, { isError: true })
  assert.deepEqual(f.state.items.S1, afterDirect)
  f.result(extract, { requestUrl: A, mode: 'extract', focus: 'facts', evidence: '' })
  assert.deepEqual(f.state.items.S1.fetched, saved.fetched)
  assert.deepEqual(f.state.items.S1.evidence, saved.evidence)
  assert.equal(f.state.items.S1.pageShown, true)
  f.result(f.read(), { requestUrl: A, mode: 'invalid', focus: 'facts', evidence: 'Invalid' })
  assert.deepEqual(f.state.items.S1.evidence, saved.evidence)
  assert.deepEqual(f.events.reduce(applyMaterials, materialsProjection.init()), f.state)
})

test('obsolete fetch and read results without mode are ignored', () => {
  const f = fixture()
  f.result(f.call('web_fetch'), { requestUrl: A, ...page })
  const { mode, ...oldRead } = success()
  f.result(f.read(), oldRead)
  assert.deepEqual(f.state.items, {})
  assert.deepEqual(f.state.pendingCalls, {})
})


test('research attempts count independently of results and reset without removing materials', () => {
  const f = fixture()
  f.emit({ type: 'turn/start', data: { turn: 1 } })
  f.result(f.read(), success())
  f.result(f.call(), undefined, { isError: true })
  f.read() // Cancelled or unfinished attempts still count.
  f.call('unrelated_tool', { handles: ['S1'] })
  assert.equal(f.state.budget.used, 3)
  assert.deepEqual(f.events.reduce(applyMaterials, materialsProjection.init()), f.state)
  const items = structuredClone(f.state.items)
  f.emit({ type: 'turn/start', data: { turn: 2 } })
  assert.equal(f.state.budget.used, 0)
  assert.deepEqual(f.state.items, items)
})

test('direct read sets pageShown only when fetched content exists and preserves replay', () => {
  const f = fixture()
  f.result(f.call('web_read', { target: A, mode: 'direct' }), { requestUrl: A, mode: 'direct', error: 'Fetch failed: HTTP 500' })
  assert.equal(f.state.items.S1.pageShown, undefined)
  f.result(f.call('web_read', { target: 'S1', mode: 'direct' }), { requestUrl: A, mode: 'direct', ...page })
  assert.equal(f.state.items.S1.pageShown, true)
  f.result(f.call('web_read', { target: 'S1', mode: 'direct' }), { requestUrl: A, mode: 'direct' })
  assert.equal(f.state.items.S1.pageShown, true)
  assert.deepEqual(f.events.reduce(applyMaterials, materialsProjection.init()), f.state)
})
