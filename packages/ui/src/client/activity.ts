import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client';
import { messagesOf, type ChatMessage } from './messages.js';

export interface ToolActivity {
  id: string; seq: number; turn: number; kind: 'tool'; name: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  label: string; target: string; detail: string; note: string; error: string;
}
export type TimelineItem = (ChatMessage & { kind: 'message' }) | ToolActivity;
const object = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown): string => typeof value === 'string' ? value : '';
function argumentsOf(value: string): Record<string, unknown> {
  try { return object(JSON.parse(value)); } catch { return {}; }
}
function failureNote(error: string): string {
  if (error.startsWith('Extraction failed:')) {
    return error.includes('Extraction did not complete: max-tokens') ? '内容提取达到输出上限' : '内容提取失败';
  }
  return error.startsWith('Fetch failed:') ? '网页抓取失败' : '执行失败';
}
export function activitySummary(item: ToolActivity): string {
  const status = { running: `正在${item.label}`, completed: `${item.label}完成`, failed: `${item.label}失败`, cancelled: `${item.label}已取消` }[item.status];
  return `${status}${item.target ? `：${item.target}` : ''}${item.note ? ` — ${item.note}` : ''}`;
}

/** Rebuild from the official snapshot so replay and live updates share one path. */
export function timelineOf(entries: readonly SessionEventLikeEntry[]): TimelineItem[] {
  const items: TimelineItem[] = messagesOf(entries).map(message => ({ ...message, kind: 'message' }));
  const calls = new Map<string, ToolActivity>();
  const endedTurns = new Set<number>();
  for (const { event } of entries) {
    if (event.type === 'tool/call') {
      const { turn, step, callId, name } = event.data;
      if (name !== 'web_search' && name !== 'web_read') continue;
      const key = `${turn}:${step}:${callId}`;
      if (calls.has(key)) continue;
      const args = argumentsOf(event.data.arguments);
      const queries = Array.isArray(args.queries) && args.queries.every(q => typeof q === 'string') ? args.queries.join('；') : '';
      const item: ToolActivity = {
        id: `tool-${event.seq}`, seq: event.seq, turn, kind: 'tool', name, status: 'running',
        label: name === 'web_search' ? '搜索' : '阅读', target: name === 'web_search' ? queries : string(args.target),
        detail: string(args.focus), note: '', error: '',
      };
      calls.set(key, item); items.push(item);
    } else if (event.type === 'tool/result') {
      const { turn, step, message, error, meta } = event.data;
      const item = calls.get(`${turn}:${step}:${message.toolCallId}`);
      if (!item) continue;
      const value = object(meta);
      item.note = ''; item.error = '';
      if (error?.code === 'ABORTED' || error?.code === 'ABORTED_BEFORE_DISPATCH') {
        item.status = 'cancelled';
      } else if (message.isError || (item.name === 'web_read' && typeof value.error === 'string')) {
        item.status = 'failed';
        item.error = message.isError ? error?.reason || message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') : string(value.error);
        item.note = failureNote(item.error);
      } else {
        item.status = 'completed';
        if (item.name === 'web_search' && Array.isArray(value.sources)) item.note = `返回 ${value.sources.length} 个来源`;
        if (item.name === 'web_read' && typeof value.evidence === 'string') item.note = value.evidence === '' ? '未找到相关证据' : '已提取相关证据';
      }
      const details = [item.detail];
      if (typeof value.requestUrl === 'string') details.push(`URL：${value.requestUrl}`);
      if (value.truncated === true) details.push('结果已截断');
      item.detail = details.filter(Boolean).join('\n');
    } else if (event.type === 'turn/end') {
      endedTurns.add(event.data.turn);
    }
  }
  return items.filter(item => item.kind !== 'tool' || !endedTurns.has(item.turn)).sort((a, b) => a.seq - b.seq);
}
