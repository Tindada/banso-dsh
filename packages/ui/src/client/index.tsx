import type { Context } from '@deepseek-ai/cordis';
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkLatex from './remark-latex.js';
import { useSessionNavigation } from './use-session-navigation.js';
import { SessionList } from './session-list.js';
import { titleFromQuestion } from './session-navigation.js';

// Replaced by the build with bundled styles and embedded font resources.
declare const __KATEX_CSS__: string;
import { timelineOf, activitySummary } from './activity.js';

// Lifetime label for the one visible conversation; not a persisted session property.
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { bansoChat: unknown }
}
export const inject = ['slots', 'sessions', 'connection'];

function Conversation({ binding }: { binding: SessionBinding }) {
  const events = useSyncExternalStore(listener => binding.eventSource.subscribe(listener), () => binding.eventSource.getSnapshot());
  const state = useSyncExternalStore(listener => binding.session.subscribe(listener), () => binding.session.getSnapshot());
  const container = useRef<HTMLElement>(null);
  const nearBottom = useRef(true);
  const anchor = useRef<{ height: number; top: number }>();
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    if (anchor.current) {
      node.scrollTop = anchor.current.top + node.scrollHeight - anchor.current.height;
      if (!state.loadingOlder) anchor.current = undefined;
    } else if (nearBottom.current) node.scrollTop = node.scrollHeight;
  }, [events, state.loadingOlder]);
  function loadOlder() {
    const node = container.current;
    if (node) anchor.current = { height: node.scrollHeight, top: node.scrollTop };
    void binding.session.loadOlder();
  }
  const messages = timelineOf(events.entries);
  return <section ref={container} className="banso-messages" aria-label="聊天消息" onScroll={() => {
    const node = container.current;
    if (node && !anchor.current) nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }}>
    {state.hasMore && <button disabled={state.loadingOlder} onClick={loadOlder}>{state.loadingOlder ? '加载中…' : '加载更早消息'}</button>}
    {messages.map(message => message.kind === 'tool' ? <details className={`banso-tool ${message.status}`} key={message.id}>
      <summary><span aria-hidden="true">{{ running: '◌', completed: '✓', failed: '✗', cancelled: '○' }[message.status]}</span> {activitySummary(message)}</summary>
      <div>{message.target && <p>{message.name === 'web_search' ? '关键词' : '阅读对象'}：{message.target}</p>}
        {message.detail && <p>{message.detail}</p>}{message.error && <p>错误详情：{message.error}</p>}
        {!message.target && !message.detail && !message.error && <p>没有更多详情</p>}</div>
    </details> : <article className={`banso-message ${message.role}`} key={message.id}>
      <strong>{message.role === 'user' ? '你' : 'Banso'}</strong>
      {message.role === 'assistant' ? <div className="banso-markdown">
        <Markdown remarkPlugins={[remarkGfm, remarkMath, remarkLatex]} rehypePlugins={[rehypeKatex]} skipHtml>{message.text}</Markdown>
      </div> : <div className="banso-plaintext">{message.text}</div>}
    </article>)}
    {state.pendingSubmissions.map(pending => <article className="banso-message user" key={pending.requestId}><strong>你 · 发送中</strong><div className="banso-plaintext">{pending.text}</div></article>)}
  </section>;
}

function App({ ctx }: { ctx: Context }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef<object>();
  const composing = useRef(false);
  const connection = ctx.get('connection') as ConnectionHandle;
  const generation = useSyncExternalStore(listener => connection.generation.subscribe(listener), () => connection.generation.getSnapshot());
  const navigation = useSessionNavigation(ctx, generation);
  const { binding } = navigation;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setInput(''); setError(''); setBusy(false); setStopping(false); setRunning(false);
    inFlight.current = undefined;
  }, [navigation.selected, navigation.revision]);
  useEffect(() => { if (!binding) { setRunning(false); setStopping(false); } }, [binding]);
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
    if (!text || inFlight.current !== undefined || running || !generation || navigation.loading || navigation.error) return;
    let ticket = navigation.version.current;
    const isCurrent = () => alive.current && ticket === navigation.version.current;
    const operation = {};
    inFlight.current = operation;
    setBusy(true); setError('');
    // An operation reference survives navigation until its own RPCs settle.
    let held: ReturnType<typeof ctx.sessions.retain> | undefined;
    try {
      const fresh = !binding;
      const id = binding?.sessionId ?? await ctx.sessions.create();
      if (!isCurrent()) return;
      held = ctx.sessions.retain(id, { source: 'bansoChat' });
      const current = await held.ready;
      if (!isCurrent()) return;
      const submission = current.session.beginSubmission({ mode: 'queue', text, attachments: [] });
      const result = await current.session.prompt([{ type: 'text', text }], 'queue', undefined, submission.requestId);
      if (!result.ok) throw new Error(result.error.message);
      if (isCurrent()) {
        setInput('');
        if (fresh) { navigation.select(id); ticket = navigation.version.current; }
      }
      if (fresh) {
        try {
          const renamed = await current.session.rename(titleFromQuestion(text));
          if (!renamed.ok) throw new Error(renamed.error.message);
        } catch (failure) {
          if (isCurrent()) setError(`问题已发送，标题保存失败：${failure instanceof Error ? failure.message : String(failure)}`);
        }
      }
    } catch (error) {
      if (isCurrent()) setError(error instanceof Error ? error.message : String(error));
    } finally {
      held?.release();
      if (inFlight.current === operation) {
        inFlight.current = undefined;
        if (isCurrent()) setBusy(false);
      }
    }
  }
  async function stop() {
    if (!binding || stopping) return;
    const ticket = navigation.version.current;
    let held: ReturnType<typeof ctx.sessions.retain> | undefined;
    setStopping(true); setError('');
    try {
      held = ctx.sessions.retain(binding.sessionId, { source: 'bansoChat' });
      const result = await binding.session.cancel();
      if (!result.ok) throw new Error(result.error.message);
    } catch (error) {
      if (alive.current && ticket === navigation.version.current) { setStopping(false); setError(error instanceof Error ? error.message : String(error)); }
    } finally { held?.release(); }
  }
  return <div className="banso-shell"><SessionList ctx={ctx} selected={navigation.selected} select={navigation.select} connected={Boolean(generation)} /><main className="banso-app">
    <header><h1>Banso</h1><span>{!generation ? '连接中…' : stopping ? '正在停止…' : running ? '正在研究…' : '新闻研究助手'}</span></header>
    {binding ? <Conversation key={binding.sessionId} binding={binding} /> : <section className="banso-messages" aria-label="聊天消息">
      <p className="banso-empty">{navigation.loading ? '正在打开会话…' : navigation.error ? '无法打开会话' : '输入一个问题，开始研究。'}</p>
    </section>}
    {navigation.error && <div role="alert" className="banso-error">{navigation.error} <button onClick={navigation.retry}>重试打开</button></div>}
    {error && <p role="alert" className="banso-error">{error}</p>}
    <form onSubmit={event => { event.preventDefault(); void send(); }}>
      <label htmlFor="banso-input">你的问题</label>
      <textarea id="banso-input" placeholder="想了解什么？" rows={3} value={input} onChange={event => setInput(event.target.value)} disabled={busy || running || !generation || navigation.loading || Boolean(navigation.error)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          // Some IMEs report keyCode 229 when confirming text, even after compositionend.
          if (event.key !== 'Enter' || event.shiftKey || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          event.preventDefault();
          if (!event.repeat) void send();
        }} />
      <div className="banso-actions"><small>Enter 发送，Shift + Enter 换行</small>
        {running && <button type="button" disabled={stopping || !generation} onClick={() => void stop()}>停止</button>}
        <button type="submit" disabled={!input.trim() || busy || running || !generation || navigation.loading || Boolean(navigation.error)}>{busy ? '发送中…' : '发送'}</button>
      </div>
    </form>
  </main></div>;
}

const css = `
.banso-sidebar{box-sizing:border-box;width:290px;flex-shrink:0;padding:18px 10px;overflow:auto;background:#e9e9ec;border-right:1px solid #dedee2;color:#202124}
.banso-sidebar button{font:inherit;color:inherit;cursor:pointer;border:0;background:transparent;border-radius:9px}.banso-sidebar button:disabled{opacity:.45;cursor:default}.banso-sidebar button:focus-visible,.banso-rename-form input:focus-visible{outline:2px solid #5285c5;outline-offset:2px}
.banso-list-actions{padding:0 3px 16px}.banso-sidebar .banso-new-session{display:flex;width:100%;align-items:center;justify-content:center;gap:9px;padding:10px 14px;border:1px solid #d5d5da;border-radius:13px;background:#f7f7f9;font-weight:600}.banso-new-session:hover{background:white}.banso-new-session svg{flex-shrink:0}
.banso-list-toggle{display:none}.banso-session-list nav{margin-top:4px}.banso-session-row{margin-bottom:3px}.banso-session-heading{display:flex;align-items:center;position:relative;border-radius:11px;min-width:0}.banso-session-heading:has([aria-current]){background:#dcdcdf}.banso-session-heading:hover{background:#e0e0e4}
.banso-sidebar .banso-session{display:flex;flex:1;min-width:0;align-items:center;gap:12px;padding:9px 12px;text-align:left;line-height:1.5}.banso-session>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.banso-session small{display:flex;align-items:center;gap:5px;flex-shrink:0;font-size:11px;color:#858892;white-space:nowrap}.banso-running-dot{display:inline-block;width:6px;height:6px;background:#5285c5;border-radius:50%}
.banso-sidebar .banso-session-more{display:flex;position:absolute;right:6px;align-items:center;justify-content:center;width:28px;height:28px;padding:0;background:#e0e0e4;font-size:20px;line-height:1;opacity:0;pointer-events:none}.banso-session-heading:has([aria-current]) .banso-session-more{background:#dcdcdf}.banso-session-heading:hover .banso-session-more,.banso-session-heading:focus-within .banso-session-more,.banso-session-heading[data-menu-open="true"] .banso-session-more{opacity:1;pointer-events:auto}.banso-session-heading:hover .banso-session small,.banso-session-heading:focus-within .banso-session small,.banso-session-heading[data-menu-open="true"] .banso-session small{visibility:hidden}.banso-sidebar .banso-session-more:hover{background:#cdced4}
.banso-session-menu{position:fixed;z-index:1000;box-sizing:border-box;width:160px;padding:5px;border:1px solid #d9d9df;border-radius:10px;background:#fafafc;box-shadow:0 6px 24px #20212424}.banso-sidebar .banso-session-menu button{display:block;width:100%;padding:8px 12px;font-size:14px;text-align:left;border-radius:6px}.banso-session-menu button:hover,.banso-session-menu button:focus-visible{background:#e8e8ed}
.banso-rename-form{padding:8px 6px}.banso-rename-form input{box-sizing:border-box;width:100%;min-width:0;font:inherit;border:1px solid #bdc7d4;border-radius:6px;padding:6px;margin-bottom:6px}.banso-rename-form button{padding:5px 10px;background:#f7f7f9;border:1px solid #d5d5da}.banso-rename-form p{color:#9f2525;font-size:13px;overflow-wrap:anywhere}
@media(hover:none),(pointer:coarse){.banso-sidebar .banso-session-more{position:static;opacity:1;pointer-events:auto;margin-right:6px;flex-shrink:0}.banso-session-heading:hover .banso-session small,.banso-session-heading:focus-within .banso-session small,.banso-session-heading[data-menu-open="true"] .banso-session small{visibility:visible}}
@media(max-width:700px){.banso-shell{flex-direction:column}.banso-sidebar{width:100%;padding:8px 12px;overflow:visible;border-right:0;border-bottom:1px solid #dedee2}.banso-list-toggle{display:block;padding:6px}.banso-session-list{display:none;max-height:35dvh;overflow:auto}.banso-sidebar.expanded .banso-session-list{display:block}.banso-shell .banso-app{height:auto;min-height:0;width:100%}}

html,body,#root{height:100%;margin:0}body{background:#f7f8fa;color:#20252c;font:16px/1.65 system-ui,sans-serif}
.banso-shell{display:flex;height:100dvh}.banso-app{min-width:0;flex:1;box-sizing:border-box;max-width:900px;height:100dvh;margin:auto;padding:20px 24px;display:flex;flex-direction:column}
.banso-app header{display:flex;align-items:center;gap:20px;border-bottom:1px solid #dfe3e8;padding-bottom:12px}.banso-app h1{font-size:24px;margin:0}.banso-app header span,.banso-app small{color:#647080;font-size:13px}
.banso-messages{flex:1;overflow:auto;min-height:0;padding:24px 0}.banso-message{padding:14px 18px;margin:0 0 18px;border-radius:12px;background:white;overflow-wrap:anywhere}.banso-message.user{background:#e9f0fa}.banso-message>strong{font-size:13px}.banso-plaintext{white-space:pre-wrap}.banso-empty{color:#647080;text-align:center;margin-top:15vh}.banso-empty small{display:block}
.banso-markdown{white-space:normal}.banso-markdown>:first-child{margin-top:8px}.banso-markdown>:last-child{margin-bottom:0}
.banso-markdown p,.banso-markdown ul,.banso-markdown ol,.banso-markdown blockquote,.banso-markdown pre{margin:12px 0}.banso-markdown h1,.banso-markdown h2,.banso-markdown h3,.banso-markdown h4,.banso-markdown h5,.banso-markdown h6{line-height:1.35;margin:20px 0 10px}.banso-markdown h1{font-size:1.5em}.banso-markdown h2{font-size:1.3em}.banso-markdown h3{font-size:1.15em}
.banso-markdown ul,.banso-markdown ol{padding-left:24px}.banso-markdown blockquote{margin-left:0;padding-left:14px;border-left:3px solid #bdc7d4;color:#647080}.banso-markdown a{color:#245ba0;text-decoration:underline}.banso-markdown code{font-family:ui-monospace,monospace;font-size:.9em;background:#eef1f5;border-radius:4px;padding:2px 4px}.banso-markdown pre{overflow-x:auto;white-space:pre;background:#eef1f5;border-radius:8px;padding:12px}.banso-markdown pre code{padding:0;background:none}
.banso-markdown table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse;margin:12px 0}.banso-markdown th,.banso-markdown td{border:1px solid #dfe3e8;padding:8px 12px;min-width:100px}.banso-markdown th{background:#f7f8fa}.banso-markdown img{max-width:100%;height:auto}.banso-markdown hr{border:0;border-top:1px solid #dfe3e8;margin:20px 0}
.banso-markdown .katex-display{overflow-x:auto;overflow-y:hidden;margin:18px 0;padding:8px 0}.banso-markdown .katex-display>.katex{text-align:left}.banso-markdown .katex{overflow-wrap:normal}
.banso-tool{margin:0 0 12px;padding:8px 14px;border-left:3px solid #bdc7d4;font-size:14px;overflow-wrap:anywhere}.banso-tool summary{cursor:pointer}.banso-tool p{white-space:pre-wrap;margin:8px 0}.banso-tool.failed{border-color:#a52d2d}.banso-tool.running{border-color:#245ba0}.banso-tool.completed{border-color:#38714b}
.banso-app label{display:block;font-size:13px;margin-bottom:6px}.banso-app textarea{box-sizing:border-box;width:100%;resize:vertical;max-height:30vh;border:1px solid #bdc7d4;border-radius:10px;padding:12px;font:inherit}.banso-app textarea:focus{outline:2px solid #5285c5}.banso-actions{display:flex;align-items:center;gap:12px;margin-top:10px}.banso-actions small{flex:1}.banso-app button{border:0;border-radius:8px;background:#245ba0;color:white;padding:9px 20px;font:inherit;cursor:pointer}.banso-app button:disabled{opacity:.5;cursor:default}.banso-error{color:#9f2525;background:#ffeded;padding:10px;overflow-wrap:anywhere;margin:8px 0}@media(max-width:600px){.banso-app{padding:12px}.banso-actions small{font-size:11px}}
`;
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style'); style.textContent = __KATEX_CSS__ + css; document.head.append(style);
    const previousTitle = document.title; document.title = 'Banso';
    const dispose = ctx.slots.register({ name: 'root' }, () => <App ctx={ctx} />);
    return () => { dispose(); style.remove(); document.title = previousTitle; };
  });
}
