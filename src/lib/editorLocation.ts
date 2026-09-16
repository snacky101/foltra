import type { EditorView } from '@codemirror/view';

export interface EditorLocation {
  anchor: number;
  head: number;
  scrollTop: number;
}

export function captureEditorLocation(editor: EditorView): EditorLocation {
  const { anchor, head } = editor.state.selection.main;
  return { anchor, head, scrollTop: editor.dom.closest<HTMLElement>('.note-scroll')?.scrollTop ?? 0 };
}

export function restoreEditorLocation(editor: EditorView, location: EditorLocation) {
  const length = editor.state.doc.length;
  editor.dispatch({
    selection: { anchor: Math.min(length, location.anchor), head: Math.min(length, location.head) },
  });
  editor.dom.closest<HTMLElement>('.note-scroll')?.scrollTo({ top: location.scrollTop, behavior: 'instant' });
}

export function parseEditorLocation(value: string | null, length: number): EditorLocation | null {
  try {
    const item = JSON.parse(value ?? 'null') as EditorLocation | null;
    if (!item || ![item.anchor, item.head, item.scrollTop].every((n) => Number.isFinite(n) && n >= 0))
      return null;
    return {
      anchor: Math.min(length, Math.floor(item.anchor)),
      head: Math.min(length, Math.floor(item.head)),
      scrollTop: item.scrollTop,
    };
  } catch {
    return null;
  }
}

export function readEditorLocation(key: string, length: number) {
  try {
    return parseEditorLocation(localStorage.getItem(key), length);
  } catch {
    return null;
  }
}

export function trackEditorLocation(editor: EditorView, key: string) {
  const scroller = editor.dom.closest<HTMLElement>('.note-scroll');
  const restored = readEditorLocation(key, editor.state.doc.length);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let restoring = true;
  const save = () => {
    clearTimeout(timer);
    if (restoring) return;
    try {
      localStorage.setItem(key, JSON.stringify(captureEditorLocation(editor)));
    } catch {
      /* Device-only navigation state must not interrupt note editing. */
    }
  };
  const changed = () => {
    if (restoring) return;
    clearTimeout(timer);
    timer = setTimeout(save, 200);
  };
  scroller?.addEventListener('scroll', changed, { passive: true });
  window.addEventListener('pagehide', save);
  return {
    changed,
    restoreScroll: () => {
      if (!restoring) return;
      scroller?.scrollTo({ top: restored?.scrollTop ?? 0, behavior: 'instant' });
      restoring = false;
    },
    destroy: () => {
      save();
      scroller?.removeEventListener('scroll', changed);
      window.removeEventListener('pagehide', save);
    },
  };
}
