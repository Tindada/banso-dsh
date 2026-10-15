import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timelineOf, activitySummary } from '../lib/types/client/activity.js';
const entry = (type, data, seq) => ({ type: 'event', event: { type, data, seq } });
const call = (id, name = 'web_read', args = { target: 'S1', focus: 'facts' }, seq = 1) => entry('tool/call', { turn: 1, step: 1, callId: id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }, seq);
const result = (id, meta, error, isError = false) => entry('tool/result', { turn: 1, step: 1, message: { toolCallId: id, isError, content: [{ type: 'text', text: 'raw error' }] }, meta, error }, 8);
const end = kind => entry('turn/end', { turn: 1, reason: { kind } }, 10);
test('parallel results update original rows; repeated snapshots and retries', () => {
  const input = [call('a', 'web_search', { queries: ['news', 'W&B'] }), call('b', 'web_read', undefined, 2), result('b', { evidence: 'ok' }), result('a', { sources: [{}, {}], truncated: true }), call('retry', 'web_read', undefined, 9)];
  const rows = timelineOf(input);
  assert.deepEqual(rows.map(r => r.status), ['completed', 'completed', 'running']);
  assert.match(activitySummary(rows[0]), /news；W&B — 返回 2 个来源/);
  assert.match(rows[0].detail, /截断/);
  assert.deepEqual(timelineOf(input), rows);
  assert.equal(timelineOf([call('a'), call('a')]).length, 1);
});
test('business errors, empty evidence and transport errors', () => {
  for (const [meta, status, note] of [[{ evidence: 'yes' }, 'completed', '已提取相关证据'], [{ evidence: '' }, 'completed', '未找到相关证据'], [{ error: 'Fetch failed: HTTP 403' }, 'failed', '网页抓取失败'], [{ error: 'Extraction failed: Extraction did not complete: max-tokens' }, 'failed', '内容提取达到输出上限'], [{ error: 'Extraction failed: bad JSON' }, 'failed', '内容提取失败']]) {
  const row = timelineOf([call('a'), result('a', meta)])[0];
  assert.equal(row.status, status); assert.equal(row.note, note);
  }
  assert.equal(timelineOf([call('a'), result('a', { evidence: 'ok' }, undefined, true)])[0].status, 'failed');
});
test('explicit cancellation takes precedence over errors', () => {
  for (const code of ['ABORTED', 'ABORTED_BEFORE_DISPATCH']) assert.equal(timelineOf([call('a'), result('a', { error: 'bad' }, { code }, true)])[0].status, 'cancelled');
});
test('malformed data never invents results or crashes', () => {
  for (const meta of [null, [], 'invalid', {}, { sources: 'no', evidence: 4 }]) {
  const row = timelineOf([call('a', 'web_search', '{broken'), result('a', meta)])[0];
  assert.equal(row.status, 'completed'); assert.equal(row.target, ''); assert.equal(row.note, '');
  }
  assert.equal(timelineOf([result('missing', {})]).length, 0);
});
test('timeline order and plain text', () => {
  const input = [entry('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }, 0), call('a', 'web_search', { queries: ['<script>'] }), entry('assistant/message', { message: { content: [{ type: 'text', text: 'answer' }] } }, 9), result('a', { sources: [] })];
  assert.deepEqual(timelineOf(input).map(r => r.kind), ['message', 'tool', 'message']);
  assert.match(activitySummary(timelineOf(input)[1]), /<script>/);
});
test('all turn endings hide only that turn tools and preserve answers and active turns', () => {
  for (const kind of ['completed', 'aborted', 'error', 'max-tokens', 'interrupted', 'blocked']) {
    const next = call('next'); next.event.data.turn = 2;
    const answer = entry('assistant/message', { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'answer' }] } }, 9);
    const input = [call('running'), call('ok'), result('ok', { evidence: 'yes' }), call('failed'), result('failed', { error: 'failure' }), answer, end(kind), next];
    const rows = timelineOf(input);
    assert.equal(rows.filter(r => r.kind === 'tool').length, 1);
    assert.equal(rows.find(r => r.kind === 'tool').turn, 2);
    assert.equal(rows.find(r => r.kind === 'message').text, 'answer');
  }
});
