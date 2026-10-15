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
test('groups interleaved live chunks by attempt, and renders the settled event window once', () => {
  assert.deepEqual(messagesOf([live('a', 'A'), live('b', 'B'), live('a', 'C')]).map(m => m.text), ['AC', 'B']);
  const settled = entry('assistant/message', { message: { content: [{ type: 'text', text: 'AC' }] } }, 5);
  assert.deepEqual(messagesOf([settled]).map(m => m.text), ['AC']);
});
