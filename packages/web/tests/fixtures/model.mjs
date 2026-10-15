import assert from 'node:assert/strict';
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
    const all = JSON.stringify(request.messages);
    assert.match(all, /Banso/);
    assert.ok(request.tools.some(tool => tool.name === 'web_search'));
    assert.ok(request.tools.some(tool => tool.name === 'web_read'));
    const last = request.messages.findLast(message => message.role === 'user' && message.source.kind === 'user');
    const text = last.content.filter(block => block.type === 'text').map(block => block.text).join('');
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
export const inject = ['llm'];
export function apply(ctx) { ctx.llm.registerAdapter(['mock'], new Model()); }
