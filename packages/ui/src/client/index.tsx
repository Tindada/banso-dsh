import type { Context } from '@deepseek-ai/cordis';
import type { SessionBinding, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { timelineOf, activitySummary } from './activity.js';

// Lifetime label for the one visible conversation; not a persisted session property.
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { bansoChat: unknown }
}
export const inject = ['slots', 'sessions', 'connection'];

function Conversation({ binding }: { binding: SessionBinding }) {
  const events = useSyncExternalStore(listener => binding.eventSource.subscribe(listener), () => binding.eventSource.getSnapshot());
  const state = useSyncExternalStore(listener => binding.session.subscribe(listener), () => binding.session.getSnapshot());
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [events]);
  const messages = timelineOf(events.entries);
  return <>
    {messages.map(message => message.kind === 'tool' ? <details className={`banso-tool ${message.status}`} key={message.id}>
      <summary><span aria-hidden="true">{{ running: '◌', completed: '✓', failed: '✗', cancelled: '○' }[message.status]}</span> {activitySummary(message)}</summary>
      <div>{message.target && <p>{message.name === 'web_search' ? '关键词' : '阅读对象'}：{message.target}</p>}
        {message.detail && <p>{message.detail}</p>}{message.error && <p>错误详情：{message.error}</p>}
        {!message.target && !message.detail && !message.error && <p>没有更多详情</p>}</div>
    </details> : <article className={`banso-message ${message.role}`} key={message.id}>
      <strong>{message.role === 'user' ? '你' : 'Banso'}</strong><div>{message.text}</div>
    </article>)}
    {state.pendingSubmissions.map(pending => <article className="banso-message user" key={pending.requestId}><strong>你 · 发送中</strong><div>{pending.text}</div></article>)}
    <div ref={end} />
  </>;
}

function App({ ctx }: { ctx: Context }) {
  const [binding, setBinding] = useState<SessionBinding>();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const reference = useRef<SessionReference>();
  const alive = useRef(true);
  const inFlight = useRef(false);
  const connection = ctx.get('connection') as ConnectionHandle;
  const generation = useSyncExternalStore(listener => connection.generation.subscribe(listener), () => connection.generation.getSnapshot());
  useEffect(() => () => { alive.current = false; reference.current?.release(); }, []);
  useEffect(() => {
    if (!binding) return;
    const update = () => {
      const state = binding.session.getSnapshot();
      setRunning(state.running || state.pendingSubmissions.length > 0 || state.awaitingFirstTurn);
      if (!state.running) setStopping(false);
      const failure = state.promptError?.error.message ?? state.openError?.message ?? state.lastAgentError;
      if (failure) setError(failure);
    };
    update();
    return binding.session.subscribe(update);
  }, [binding]);
  async function send() {
    const text = input.trim();
    if (!text || inFlight.current || running || !generation) return;
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      let current = binding;
      if (!current) {
        const id = await ctx.sessions.create();
        if (!alive.current) return;
        const held = ctx.sessions.retain(id, { source: 'bansoChat' });
        reference.current = held;
        try { current = await held.ready; }
        catch (error) { held.release(); reference.current = undefined; throw error; }
        if (!alive.current) return;
        setBinding(current);
      }
      const submission = current.session.beginSubmission({ mode: 'queue', text, attachments: [] });
      const result = await current.session.prompt([{ type: 'text', text }], 'queue', undefined, submission.requestId);
      if (!result.ok) throw new Error(result.error.message);
      if (alive.current) setInput('');
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function stop() {
    if (!binding || stopping) return;
    setStopping(true); setError('');
    try {
      const result = await binding.session.cancel();
      if (!result.ok) throw new Error(result.error.message);
    } catch (error) {
      if (alive.current) { setStopping(false); setError(error instanceof Error ? error.message : String(error)); }
    }
  }
  return <main className="banso-app">
    <header><h1>Banso</h1><span>{!generation ? '连接中…' : stopping ? '正在停止…' : running ? '正在研究…' : '新闻研究助手'}</span></header>
    <section className="banso-messages" aria-label="聊天消息">
      {binding ? <Conversation binding={binding} /> : <p className="banso-empty">输入一个问题，开始研究。<small>此版本刷新后会开始新对话。</small></p>}
    </section>
    {error && <p role="alert" className="banso-error">{error}</p>}
    <form onSubmit={event => { event.preventDefault(); void send(); }}>
      <label htmlFor="banso-input">你的问题</label>
      <textarea id="banso-input" placeholder="想了解什么？" rows={3} value={input} onChange={event => setInput(event.target.value)} disabled={busy || running} />
      <div className="banso-actions"><small>纯文本聊天</small>
        {running && <button type="button" disabled={stopping || !generation} onClick={() => void stop()}>停止</button>}
        <button type="submit" disabled={!input.trim() || busy || running || !generation}>{busy ? '发送中…' : '发送'}</button>
      </div>
    </form>
  </main>;
}

const css = `
html,body,#root{height:100%;margin:0}body{background:#f7f8fa;color:#20252c;font:16px/1.65 system-ui,sans-serif}
.banso-app{box-sizing:border-box;max-width:900px;height:100dvh;margin:auto;padding:20px 24px;display:flex;flex-direction:column}
.banso-app header{display:flex;align-items:center;gap:20px;border-bottom:1px solid #dfe3e8;padding-bottom:12px}.banso-app h1{font-size:24px;margin:0}.banso-app header span,.banso-app small{color:#647080;font-size:13px}
.banso-messages{flex:1;overflow:auto;min-height:0;padding:24px 0}.banso-message{padding:14px 18px;margin:0 0 18px;border-radius:12px;background:white;overflow-wrap:anywhere}.banso-message.user{background:#e9f0fa}.banso-message strong{font-size:13px}.banso-message div{white-space:pre-wrap}.banso-empty{color:#647080;text-align:center;margin-top:15vh}.banso-empty small{display:block}
.banso-tool{margin:0 0 12px;padding:8px 14px;border-left:3px solid #bdc7d4;font-size:14px;overflow-wrap:anywhere}.banso-tool summary{cursor:pointer}.banso-tool p{white-space:pre-wrap;margin:8px 0}.banso-tool.failed{border-color:#a52d2d}.banso-tool.running{border-color:#245ba0}.banso-tool.completed{border-color:#38714b}
.banso-app label{display:block;font-size:13px;margin-bottom:6px}.banso-app textarea{box-sizing:border-box;width:100%;resize:vertical;max-height:30vh;border:1px solid #bdc7d4;border-radius:10px;padding:12px;font:inherit}.banso-app textarea:focus{outline:2px solid #5285c5}.banso-actions{display:flex;align-items:center;gap:12px;margin-top:10px}.banso-actions small{flex:1}.banso-app button{border:0;border-radius:8px;background:#245ba0;color:white;padding:9px 20px;font:inherit;cursor:pointer}.banso-app button:disabled{opacity:.5;cursor:default}.banso-error{color:#9f2525;background:#ffeded;padding:10px;overflow-wrap:anywhere;margin:8px 0}@media(max-width:600px){.banso-app{padding:12px}.banso-actions small{font-size:11px}}
`;
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style'); style.textContent = css; document.head.append(style);
    const previousTitle = document.title; document.title = 'Banso';
    const dispose = ctx.slots.register({ name: 'root' }, () => <App ctx={ctx} />);
    return () => { dispose(); style.remove(); document.title = previousTitle; };
  });
}
