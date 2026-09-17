import { useCallback, useEffect, useRef, useState } from 'react';
import { call, CoreError } from './api';
import type { Note } from './types';

export function useNote(
  vault: string,
  id: string | null,
  externalRevision: string | undefined,
  onSaved: () => Promise<void>,
) {
  const [note, setNote] = useState<Note | null>(null);
  const [draft, setDraft] = useState({ title: '', body: '' });
  const [status, setStatus] = useState<'loading' | 'saved' | 'dirty' | 'saving' | 'error'>('loading');
  const [error, setError] = useState('');
  const base = useRef<Note | null>(null);
  const current = useRef(draft);
  const dirty = useRef(false);
  const pendingSince = useRef<number | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const epoch = useRef(0);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const load = useCallback(
    async (background = false) => {
      const turn = ++epoch.current;
      const startedDraft = current.current;
      const startedNote = base.current;
      if (!id || !vault) {
        base.current = null;
        dirty.current = false;
        pendingSince.current = null;
        current.current = { title: '', body: '' };
        setDraft(current.current);
        setError('');
        setNote(null);
        setStatus('saved');
        return;
      }
      if (!background) setStatus('loading');
      setError('');
      try {
        const value = await call<Note>(vault, 'note.read', { id });
        if (turn !== epoch.current) return;
        // A background read must never replace input or a write that happened after it started.
        if (background && (current.current !== startedDraft || base.current !== startedNote)) return;
        base.current = value;
        current.current = { title: value.title, body: value.body };
        dirty.current = false;
        pendingSince.current = null;
        setNote(value);
        setDraft(current.current);
        setStatus('saved');
      } catch (e) {
        if (turn === epoch.current && (!background || current.current === startedDraft)) {
          setError((e as Error).message);
          setStatus('error');
        }
      }
    },
    [vault, id],
  );

  useEffect(() => {
    void load();
    return () => {
      epoch.current++;
    };
  }, [load]);
  useEffect(() => {
    if (
      externalRevision &&
      base.current?.id === id &&
      externalRevision !== base.current.revision &&
      !dirty.current &&
      !inFlight.current
    )
      void load(true);
  }, [externalRevision, id, load]);

  const edit = useCallback((patch: Partial<{ title: string; body: string }>) => {
    current.current = { ...current.current, ...patch };
    dirty.current = true;
    pendingSince.current ??= Date.now();
    setDraft(current.current);
    setStatus('dirty');
    setError('');
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    if (!base.current || !dirty.current) return true;
    const turn = epoch.current;
    setStatus('saving');
    const promise = (async () => {
      try {
        // All callers (autosave, navigation and close) wait until the newest draft is durable.
        while (dirty.current && base.current) {
          const original = base.current;
          const sent = { ...current.current };
          pendingSince.current = null;
          const result = await call<Note>(vault, 'note.update', {
            id: original.id,
            expectedRevision: original.revision,
            ...sent,
          });
          if (turn !== epoch.current) return false;
          base.current = result;
          setNote(result);
          if (current.current.title === sent.title && current.current.body === sent.body) {
            current.current = { title: result.title, body: result.body };
            dirty.current = false;
            pendingSince.current = null;
            setDraft(current.current);
            setStatus('saved');
          }
          await onSavedRef.current();
        }
        return true;
      } catch (e) {
        if (turn === epoch.current) {
          setError(
            e instanceof CoreError && e.code === 'conflict'
              ? '외부에서 변경되었습니다. 현재 작성한 내용은 이 화면에 보존되어 있습니다. 사본으로 저장하거나 다시 불러오세요.'
              : (e as Error).message,
          );
          setStatus('error');
        }
        return false;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = promise;
    return promise;
  }, [vault]);

  useEffect(() => {
    if (status !== 'dirty') return;
    const remaining = 2000 - (Date.now() - (pendingSince.current ?? Date.now()));
    const timeout = window.setTimeout(() => void save(), Math.max(0, Math.min(650, remaining)));
    return () => window.clearTimeout(timeout);
  }, [draft, status, save]);
  useEffect(() => {
    const flush = () => {
      if (dirty.current) void save();
    };
    const visibility = () => {
      if (document.hidden) flush();
    };
    window.addEventListener('blur', flush);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', flush);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [save]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const saveCopy = useCallback(async () => {
    const sent = current.current;
    const turn = epoch.current;
    const result = await call<Note>(vault, 'note.create', {
      title: `${sent.title} (사본)`,
      body: sent.body,
    });
    if (turn === epoch.current) await onSavedRef.current();
    if (turn !== epoch.current || current.current !== sent)
      throw new Error(
        '사본은 저장했지만 저장 중 내용이나 열린 노트가 바뀌어 이동하지 않았습니다. 현재 초안을 확인해 주세요.',
      );
    dirty.current = false;
    pendingSince.current = null;
    setError('');
    setStatus('saved');
    return result;
  }, [vault]);
  const discard = useCallback(async () => {
    // Already-started writes must settle before closing; a force quit only discards unsaved input.
    if (inFlight.current) await inFlight.current;
    dirty.current = false;
    pendingSince.current = null;
    setStatus('saved');
    setError('');
  }, []);
  return {
    note,
    draft,
    status,
    error,
    edit,
    save,
    reload: load,
    saveCopy,
    discard,
    isDirty: () => dirty.current,
    currentNote: () => base.current,
  };
}
