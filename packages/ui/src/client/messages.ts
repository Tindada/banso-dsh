import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client';

export interface ChatMessage { id: string; seq: number; role: 'user' | 'assistant'; text: string }
const textOf = (content: readonly ContentBlock[]) => content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');

const hasToolCall = (content: readonly ContentBlock[]) => content.some(block => block.type === 'tool-call');

/** Tool preambles use retained live rows until step/end; ordinary answers persist. */
export function messagesOf(entries: readonly SessionEventLikeEntry[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const live = new Map<string, ChatMessage>();
  const settledSteps = new Map<string, number>();
  for (const { event } of entries) {
    if (event.type === 'assistant/message' && !hasToolCall(event.data.message.content)) {
      const key = `${event.data.turn}:${event.data.step}`;
      settledSteps.set(key, Math.max(settledSteps.get(key) ?? -1, event.seq));
    }
  }
  for (const { event } of entries) {
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      messages.push({ id: `user-${event.seq}`, seq: event.seq, role: 'user', text: textOf(event.data.content) });
    } else if (event.type === 'assistant/message') {
      if (hasToolCall(event.data.message.content)) continue;
      const text = textOf(event.data.message.content);
      if (text) messages.push({ id: `assistant-${event.seq}`, seq: event.seq, role: 'assistant', text });
    } else if (event.type === 'assistant/live-chunk' && event.data.chunk.type === 'text-delta') {
      const settledSeq = settledSteps.get(`${event.data.turn}:${event.data.step}`);
      if (settledSeq !== undefined && event.seq < settledSeq) continue;
      const id = event.data.attemptId;
      let message = live.get(id);
      if (!message) {
        message = { id: `live-${id}`, seq: event.seq, role: 'assistant', text: '' };
        live.set(id, message);
        messages.push(message);
      }
      message.text += event.data.chunk.text;
    }
  }
  return messages;
}
