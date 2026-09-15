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
  const inFlight = useRef<Promise<boolean> | null>(null);
  const epoch = useRef(0);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const load = useCallback(async () => {
    const turn = ++epoch.current;
    if (!id || !vault) {
      base.current = null;
      dirty.current = false;
      current.current = { title: '', body: '' };
      setDraft(current.current);
      setError('');
      setNote(null);
      setStatus('saved');
      return;
    }
    setStatus('loading');
    setError('');
    try {
      const value = await call<Note>(vault, 'note.read', { id });
      if (turn !== epoch.current) return;
      base.current = value;
      current.current = { title: value.title, body: value.body };
      dirty.current = false;
      setNote(value);
      setDraft(current.current);
      setStatus('saved');
    } catch (e) {
      if (turn === epoch.current) {
        setError((e as Error).message);
        setStatus('error');
      }
    }
  }, [vault, id]);

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
      void load();
  }, [externalRevision, id, load]);

  const edit = useCallback((patch: Partial<{ title: string; body: string }>) => {
    current.current = { ...current.current, ...patch };
    dirty.current = true;
    setDraft(current.current);
    setStatus('dirty');
    setError('');
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) {
      const ok = await inFlight.current;
      return ok && (dirty.current ? save() : true);
    }
    const original = base.current;
    if (!original || !dirty.current) return true;
    const sent = { ...current.current };
    const turn = epoch.current;
    setStatus('saving');
    const promise = (async () => {
      try {
        const result = await call<Note>(vault, 'note.update', {
          id: original.id,
          expectedRevision: original.revision,
          ...sent,
        });
        if (turn !== epoch.current) return true;
        base.current = result;
        setNote(result);
        if (current.current.title === sent.title && current.current.body === sent.body) {
          current.current = { title: result.title, body: result.body };
          dirty.current = false;
          setDraft(current.current);
          setStatus('saved');
        } else {
          setStatus('dirty');
        }
        await onSavedRef.current();
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
    const timeout = window.setTimeout(() => void save(), 650);
    return () => window.clearTimeout(timeout);
  }, [draft, status, save]);
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
    const result = await call<Note>(vault, 'note.create', {
      title: `${current.current.title} (사본)`,
      body: current.current.body,
    });
    dirty.current = false;
    setError('');
    setStatus('saved');
    await onSavedRef.current();
    return result;
  }, [vault]);
  const discard = useCallback(async () => {
    // Already-started writes must settle before closing; a force quit only discards unsaved input.
    if (inFlight.current) await inFlight.current;
    dirty.current = false;
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
