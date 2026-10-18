import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messagesOf } from '../lib/types/client/messages.js';
const entry = (type, data, seq = 0) => ({ type: 'event', event: { type, data, seq } });
const live = (attemptId, text) => ({ type: 'transient', event: { type: 'assistant/live-chunk', seq: 1, data: { attemptId, chunk: { type: 'text-delta', text } } } });
test('shows user text and assistant text, excludes reasoning and tool/context events', () => {
  const messages = messagesOf([
    entry('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '<hello>' }] }),
    entry('user/message', { source: { kind: 'context' }, content: [{ type: 'text', text: 'hidden' }] }, 1),
    entry('tool/result', { content: [{ type: 'text', text: 'hidden' }] }, 2),
    entry('assistant/message', { message: { content: [{ type: 'reasoning', text: 'hidden' }, { type: 'text', text: 'answer' }] } }, 3),
  ]);
  assert.deepEqual(messages.map(({ role, text }) => ({ role, text })), [{ role: 'user', text: '<hello>' }, { role: 'assistant', text: 'answer' }]);
});
test('groups interleaved live chunks by attempt', () => {
  assert.deepEqual(messagesOf([live('a', 'A'), live('b', 'B'), live('a', 'C')]).map(m => m.text), ['AC', 'B']);
});

const streaming = (attemptId, text, turn, step, seq) => {
  const row = live(attemptId, text);
  row.event.seq = seq;
  Object.assign(row.event.data, { turn, step });
  return row;
};
const committed = (text, turn, step, seq) => entry('assistant/message', { turn, step, message: { content: [{ type: 'text', text }] } }, seq);
test('tool preamble stays live once during tools and disappears when live rows retire', () => {
  const chunks = [streaming('a', 'Reading', 1, 2, 4.5), streaming('a', ' now', 1, 2, 4.75)];
  assert.deepEqual(messagesOf(chunks).map(m => m.text), ['Reading now']);
  const durable = committed('Reading now', 1, 2, 5);
  durable.event.data.message.content.push({ type: 'tool-call', id: 'read', name: 'web_read', arguments: '{}' });
  const tool = entry('tool/call', { turn: 1, step: 2, callId: 'read', name: 'web_read', arguments: '{}' }, 6);
  const duringTool = messagesOf([...chunks, durable, tool]);
  assert.deepEqual(duringTool.map(m => m.text), ['Reading now']);
  assert.equal(duringTool[0].id, 'live-a');
  assert.deepEqual(messagesOf([durable, tool]), []);
  assert.deepEqual(messagesOf([durable, tool, committed('Final answer', 1, 3, 9)]).map(m => m.text), ['Final answer']);
});
test('same text in separate steps or turns remains; later attempts are not hidden', () => {
  const entries = [committed('same', 1, 1, 3), committed('same', 1, 2, 6), streaming('next', 'same', 2, 1, 8.5)];
  assert.deepEqual(messagesOf(entries).map(m => m.text), ['same', 'same', 'same']);
  assert.deepEqual(messagesOf([committed('before', 1, 1, 3), streaming('later', 'after', 1, 1, 4.5)]).map(m => m.text), ['before', 'after']);
});

test('ordinary final answer replaces live text once and persists after retirement', () => {
  const chunk = streaming('final', 'Answer', 1, 3, 8.5);
  const durable = committed('Answer', 1, 3, 9);
  assert.deepEqual(messagesOf([chunk, durable]).map(m => m.text), ['Answer']);
  assert.deepEqual(messagesOf([chunk, durable]), messagesOf([durable]));
});
