import type { Context } from '@deepseek-ai/cordis';
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { relativeSessionTime } from './session-navigation.js';

function SessionRow({ ctx, row, selected, choose, connected, now }: {
  ctx: Context; row: SessionSummary; selected: boolean; choose: (id: string) => void; connected: boolean; now: number;
}) {
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const menuElement = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  function closeMenu(restoreFocus = false) {
    setMenu(undefined);
    if (restoreFocus) moreButton.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!menu || !menuElement.current) return;
    const element = menuElement.current;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8))}px`;
    element.querySelector('button')?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuElement.current?.contains(event.target) && !moreButton.current?.contains(event.target)) closeMenu();
    };
    const dismiss = () => closeMenu();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [menu]);
  useEffect(() => { if (!connected) setMenu(undefined); }, [connected]);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const composing = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function cancel() { composing.current = false; setEditing(false); setError(''); }
  async function save() {
    if (!title.trim() || !connected || inFlight.current || composing.current) return;
    inFlight.current = true; setSaving(true); setError('');
    try {
      const result = await ctx.sessions.using(row.id, { source: 'bansoChat' }, reference => reference.binding.session.rename(title.trim()));
      if (!result.ok) throw new Error(result.error.message);
      if (alive.current) setEditing(false);
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      inFlight.current = false;
      if (alive.current) setSaving(false);
    }
  }
  return <div className="banso-session-row">
    <div className="banso-session-heading" data-menu-open={Boolean(menu)}>
      <button className="banso-session" title={`${row.displayTitle}\n${row.id}`} aria-current={selected ? 'page' : undefined} onClick={() => choose(row.id)}>
        <span>{row.displayTitle}</span><small title={new Date(row.updatedAt).toLocaleString()}>{row.running && <i className="banso-running-dot" aria-label="正在研究" />}{relativeSessionTime(row.updatedAt, now)}</small>
      </button>
      {!editing && <button ref={moreButton} className="banso-session-more" disabled={!connected} aria-label={`会话操作 ${row.displayTitle}`} aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={() => {
        if (menu) { closeMenu(); return; }
        const rect = moreButton.current!.getBoundingClientRect();
        setMenu({ x: rect.right - 160, y: rect.bottom + 4 });
      }}><span aria-hidden="true">…</span></button>}
    </div>
    {menu && <div ref={menuElement} role="menu" aria-label="会话操作" className="banso-session-menu" style={{ left: menu.x, top: menu.y }} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget) && !moreButton.current?.contains(event.relatedTarget)) closeMenu();
    }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
      if (event.key === 'Tab') closeMenu(true);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); menuElement.current?.querySelector('button')?.focus(); }
    }}>
      <button role="menuitem" disabled={!connected} onClick={() => { closeMenu(); setTitle(row.displayTitle); setError(''); setEditing(true); }}>重命名</button>
    </div>}
    {editing && <form className="banso-rename-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <input autoFocus aria-label="会话名称" value={title} disabled={saving} onChange={event => setTitle(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
          if (event.key === 'Escape' && !saving && !composing.current && !event.nativeEvent.isComposing) { event.preventDefault(); cancel(); }
        }} />
      <div><button type="submit" disabled={!connected || saving || !title.trim()}>{saving ? '保存中…' : '保存'}</button> <button type="button" disabled={saving} onClick={cancel}>取消</button></div>
      {error && <p role="alert">{error}</p>}
    </form>}
  </div>;
}

export function SessionList({ ctx, selected, select, connected }: {
  ctx: Context; selected?: string; select: (id?: string) => void; connected: boolean;
}) {
  const list = useSyncExternalStore(listener => ctx.sessions.list.subscribe(listener), () => ctx.sessions.list.getSnapshot());
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  const [error, setError] = useState('');
  async function refresh() {
    setError('');
    try {
      await ctx.sessions.refresh();
      const snapshot = ctx.sessions.list.getSnapshot();
      if (snapshot.phase !== 'ready') throw new Error('会话列表加载失败');
      await Promise.all(snapshot.ids.filter(id => snapshot.projectionsBySession[id]?.state === 'error').map(id => ctx.sessions.refreshProjections(id)));
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }
  useEffect(() => { if (connected) void refresh(); }, [ctx, connected]);
  useEffect(() => {
    if (!connected || list.phase !== 'ready') return;
    for (const id of list.ids) {
      const row = list.byId[id];
      const projection = list.projectionsBySession[id];
      if (row.origin !== 'subagent' && !row.title && (!projection || projection.state === 'idle')) {
        void ctx.sessions.refreshProjections(id).catch(() => { /* A missing title retains displayTitle. */ });
      }
    }
  }, [ctx, connected, list]);
  const rows = list.ids.map(id => list.byId[id]).filter(row => row.origin !== 'subagent' && (!row.blank || row.id === selected));
  function choose(id?: string) { select(id); setExpanded(false); }
  return <aside className={`banso-sidebar ${expanded ? 'expanded' : ''}`} aria-label="会话历史">
    <button className="banso-list-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>会话历史</button>
    <div className="banso-session-list">
      <div className="banso-list-actions"><button className="banso-new-session" onClick={() => choose()}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 18.5 3 21l.6-5A9 9 0 1 1 7 20" /><path d="M12 7v10M7 12h10" /></svg>
        新会话
      </button></div>
      {error && <p role="alert">{error}</p>}
      {!error && (list.phase === 'pending' ? <p>正在加载会话…</p> : rows.length === 0 ? <p>暂无历史会话</p> : null)}
      <nav aria-label="历史会话">{rows.map(row => <SessionRow key={row.id} ctx={ctx} row={row} selected={row.id === selected} choose={choose} connected={connected} now={now} />)}</nav>
    </div>
  </aside>;
}
