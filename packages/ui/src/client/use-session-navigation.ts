import type { Context } from '@deepseek-ai/cordis';
import type { SessionBinding, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionFromUrl, urlForSession } from './session-navigation.js';

type SessionId = SessionBinding['sessionId'];
export function useSessionNavigation(ctx: Context, generation: unknown) {
  const [selected, setSelected] = useState(sessionFromUrl(window.location.href));
  const [binding, setBinding] = useState<SessionBinding>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const reference = useRef<SessionReference>();
  const epoch = useRef(0);
  const version = useRef(0);
  const [revision, setRevision] = useState(0);
  const select = useCallback((id?: string, replace = false) => {
    version.current++; epoch.current++;
    reference.current?.release(); reference.current = undefined;
    setBinding(undefined); setError(''); setLoading(Boolean(id));
    window.history[replace ? 'replaceState' : 'pushState'](null, '', urlForSession(window.location.href, id));
    setSelected(id); setRevision(value => value + 1);
  }, []);
  useEffect(() => {
    const pop = () => {
      version.current++; epoch.current++;
      reference.current?.release(); reference.current = undefined;
      setBinding(undefined); setError('');
      const id = sessionFromUrl(window.location.href);
      setSelected(id); setLoading(Boolean(id)); setRevision(value => value + 1);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    if (!generation || !selected) { setLoading(Boolean(selected)); return; }
    const ticket = ++epoch.current;
    setLoading(true); setError(''); setBinding(undefined);
    let held: SessionReference | undefined;
    void (async () => {
      try {
        // retain requires a catalogued identity; initial connection alone is insufficient.
        if (ctx.sessions.list.getSnapshot().phase !== 'ready') {
          await ctx.sessions.refresh();
          if (ctx.sessions.list.getSnapshot().phase !== 'ready') throw new Error('会话列表加载失败，请重试');
        }
        if (ticket !== epoch.current) return;
        held = ctx.sessions.retain(selected as SessionId, { source: 'bansoChat' });
        reference.current = held;
        const current = await held.ready;
        if (ticket !== epoch.current) return;
        const state = current.session.getSnapshot();
        if (state.openState === 'error' || state.openError) throw new Error(state.openError?.message ?? '无法打开会话');
        setBinding(current); setLoading(false);
      } catch (failure) {
        if (ticket !== epoch.current) return;
        held?.release(); reference.current = undefined;
        setError(failure instanceof Error ? failure.message : String(failure)); setLoading(false);
      }
    })();
    return () => {
      epoch.current++;
      held?.release();
      if (reference.current === held) reference.current = undefined;
    };
  }, [ctx, selected, revision, generation]);
  return { selected, binding, loading, error, select, version, revision, retry: () => setRevision(value => value + 1) };
}
