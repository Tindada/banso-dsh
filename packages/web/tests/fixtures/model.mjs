import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
// Reuse the existing integration-test dependency without changing banso's manifest.
const require = createRequire(new URL('../../../banso/package.json', import.meta.url));
const { LlmAdapter } = await import(require.resolve('@deepseek-ai/dsh-llm'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
class Model extends LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'off', name: 'Off' }] } };
  }
  async *stream(request) {
    if (request.system !== undefined) {
      const input = JSON.parse(request.messages[0].content.find(block => block.type === 'text').text);
      if (input.focus === 'cancel') await delay(30000, undefined, { signal: request.signal });
      if (input.focus === 'fail') {
        yield { type: 'finish', reason: { kind: 'max-tokens' } }; return;
      }
      const text = JSON.stringify({ text: 'Fixture evidence' });
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } }; return;
    }
    const all = JSON.stringify(request.messages);
    assert.match(all, /Banso/);
    assert.ok(request.tools.some(tool => tool.name === 'web_search'));
    assert.ok(request.tools.some(tool => tool.name === 'web_read'));
    const last = request.messages.findLast(message => message.role === 'user' && message.source.kind === 'user');
    const text = last.content.filter(block => block.type === 'text').map(block => block.text).join('');
    if (text === 'tools' || text === 'cancel-tools' || text === 'error-tools') {
      const tail = request.messages.slice(request.messages.indexOf(last) + 1);
      const results = tail.filter(message => message.role === 'tool');
      const calls = results.length === 0 ? [{ name: 'web_search', args: { queries: ['W&B recent changes ' + 'long keyword '.repeat(12)] } }] :
        results.length === 1 ? [{ name: 'web_read', args: { target: 'S1', mode: 'extract', focus: text === 'cancel-tools' ? 'cancel' : 'facts' } }, { name: 'web_read', args: { target: 'S2', mode: 'extract', focus: text === 'cancel-tools' ? 'cancel' : 'fail' } }] : [];
      if (calls.length) {
        const preamble = results.length === 0 ? '我来搜索相关来源。' : '我找到了相关来源，现在开始阅读。';
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: preamble };
        await sleep(150);
        yield { type: 'block-end', index: 0, block: { type: 'text', text: preamble } };
        for (const [offset, call] of calls.entries()) {
          const index = offset + 1;
          const id = `${text}-${results.length}-${index}`, args = JSON.stringify(call.args);
          yield { type: 'block-start', index, blockType: 'tool-call' };
          yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: args };
          yield { type: 'block-end', index, block: { type: 'tool-call', id, name: call.name, arguments: args } };
        }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
      }
    }
    if (text === 'error-tools') throw new Error('fixture after tools failure');
    // Leave time to inspect completed tool details before the turn ends.
    if (text === 'tools') await delay(4000, undefined, { signal: request.signal });
    if (text === 'error') throw new Error('fixture model failure');
    const answer = `回答：${text}`;
    yield { type: 'block-start', index: 0, blockType: 'text' };
    for (const char of answer) {
      if (request.signal?.aborted) { yield { type: 'finish', reason: { kind: 'aborted' } }; return; }
      yield { type: 'text-delta', index: 0, text: char };
      await sleep(text === 'slow' ? 700 : 60);
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
export const inject = ['llm', 'web'];
export function apply(ctx) {
  ctx.llm.registerAdapter(['mock'], new Model());
  ctx.web.registerSearchProvider({ id: 'fixture', available: () => true, async search(_, signal) {
    await delay(900, undefined, { signal });
    return { sources: [1, 2].map(i => ({ url: `https://example.com/${'long-path-'.repeat(15)}/${i}`, title: `Source ${i}`, snippet: 'Fixture' })), truncated: true };
  } });
  ctx.web.registerFetchProvider({ id: 'fixture', available: () => true, async fetch(request, signal) {
    await delay(1800, undefined, { signal });
    return { url: request.url, statusCode: 200, body: { kind: 'text', content: 'Fixture page' }, truncated: false };
  } });
}
