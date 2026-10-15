import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client';

export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string }
const textOf = (content: readonly ContentBlock[]) => content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');

/** The official event source removes transient rows when their attempt settles. */
export function messagesOf(entries: readonly SessionEventLikeEntry[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const live = new Map<string, ChatMessage>();
  for (const { event } of entries) {
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      messages.push({ id: `user-${event.seq}`, role: 'user', text: textOf(event.data.content) });
    } else if (event.type === 'assistant/message') {
      const text = textOf(event.data.message.content);
      if (text) messages.push({ id: `assistant-${event.seq}`, role: 'assistant', text });
    } else if (event.type === 'assistant/live-chunk' && event.data.chunk.type === 'text-delta') {
      const id = event.data.attemptId;
      let message = live.get(id);
      if (!message) {
        message = { id: `live-${id}`, role: 'assistant', text: '' };
        live.set(id, message);
        messages.push(message);
      }
      message.text += event.data.chunk.text;
    }
  }
  return messages;
}
