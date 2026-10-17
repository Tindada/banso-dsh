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

test('hide commits only visibility changes and rejects malformed metadata atomically', () => {
  const f = fixture()
  f.result(f.read(), success())
  f.result(f.read(B), success(B))
  const before = structuredClone(f.state)
  f.result(f.call('materials_hide', { handles: ['S1'] }), {
    hidden: ['S1', 42], alreadyHidden: [], unknown: [],
  })
  assert.deepEqual(f.state, before)
  f.result(f.call('materials_hide', { handles: ['S1', 'S99'] }), {
    hidden: ['S1'], alreadyHidden: [], unknown: ['S99'],
  })
  assert.deepEqual(f.state, {
    ...before,
    items: { ...before.items, S1: { ...before.items.S1, hidden: true } },
  })
})

test('search and normal read outcomes restore hidden materials, but tool errors do not', () => {
  const cases = [
    { label: 'same URL search', name: 'web_search', meta: search([{ url: A, title: 'Updated' }]) },
    { label: 'saved page read', name: 'web_read', meta: reused('new focus') },
    { label: 'fetch failure', name: 'web_read', meta: { requestUrl: A, mode: 'extract', focus: 'facts', error: 'Fetch failed: HTTP 503' } },
    { label: 'extraction failure', name: 'web_read', meta: { requestUrl: A, mode: 'extract', focus: 'facts', error: 'Extraction failed: invalid JSON' } },
    { label: 'tool error', name: 'web_read', meta: undefined, isError: true },
  ]
  for (const { label, name, meta, isError = false } of cases) {
    const f = fixture()
    f.result(f.read(), success())
    f.result(f.call('materials_hide', { handles: ['S1'] }), { hidden: ['S1'], alreadyHidden: [], unknown: [] })
    const saved = structuredClone(f.state)
    f.result(f.call(name, name === 'web_read' ? { target: 'S1', mode: 'extract', focus: 'facts' } : { queries: ['q'] }), meta, { isError })
    assert.equal(f.state.items.S1.hidden, isError, label)
    assert.deepEqual(f.state.urlIndex, saved.urlIndex, label)
    assert.equal(f.state.nextHandle, saved.nextHandle, label)
    assert.equal(f.state.items.S1.handle, 'S1', label)
    assert.deepEqual(f.state.items.S1.fetched, saved.items.S1.fetched, label)
    assert.deepEqual(f.state.items.S1.evidence.slice(0, saved.items.S1.evidence.length), saved.items.S1.evidence, label)
    if (name === 'web_search') assert.equal(f.state.items.S1.title, 'Updated')
    if (label === 'saved page read') assert.equal(f.state.items.S1.evidence.at(-1).focus, 'new focus')
    if (isError) assert.deepEqual(f.state.items, saved.items)
  }
})

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


test('direct read results correlate out of order, save and reuse bodies, restore visibility and replay', () => {
  const f = fixture()
  const a = f.call('web_read', { mode: 'direct', target: A }), b = f.call('web_read', { mode: 'direct', target: B })
  f.result(b, { mode: 'direct', requestUrl: B, ...page })
  f.result(a, { mode: 'direct', requestUrl: A, content: '', finalUrl: A, truncated: false, evidence: 'must not import', focus: 'ignored' })
  assert.equal(f.state.items.S1.url, B)
  assert.equal(f.state.items.S2.fetched.content, '')
  assert.equal(f.state.items.S2.evidence, undefined)
  const saved = structuredClone(f.state.items.S2.fetched)
  f.result(f.call('materials_hide'), { hidden: ['S2'], alreadyHidden: [], unknown: [] })
  f.result(f.call('web_read', { mode: 'direct', target: 'S2' }), { mode: 'direct', requestUrl: A })
  assert.equal(f.state.items.S2.hidden, false)
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


test('per-read modes switch in result order, preserve caches, and failed reads do not switch', () => {
  const f = fixture()
  f.result(f.read(), { ...success(), mode: 'extract' })
  const saved = structuredClone(f.state.items.S1)
  const extract = f.read(), direct = f.read()
  f.result(direct, { requestUrl: A, mode: 'direct' })
  assert.equal(f.state.items.S1.displayMode, 'direct')
  assert.deepEqual(f.state.items.S1.evidence, saved.evidence)
  f.result(f.read(), { requestUrl: A, mode: 'extract', focus: 'facts', error: 'Extraction failed' })
  assert.equal(f.state.items.S1.displayMode, 'direct')
  f.result(f.read(), undefined, { isError: true })
  assert.equal(f.state.items.S1.displayMode, 'direct')
  f.result(extract, { requestUrl: A, mode: 'extract', focus: 'facts', evidence: '' })
  assert.equal(f.state.items.S1.displayMode, 'extract')
  assert.deepEqual(f.state.items.S1.fetched, saved.fetched)
  assert.deepEqual(f.state.items.S1.evidence, saved.evidence)
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
