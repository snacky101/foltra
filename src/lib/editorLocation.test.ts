// @vitest-environment jsdom
import { EditorView } from '@codemirror/view';
import { expect, test, vi } from 'vitest';
import { captureEditorLocation, parseEditorLocation, restoreEditorLocation } from './editorLocation';

test('a jump restores its departure selection and scroll even after revisiting that note', () => {
  const scroller = document.createElement('div');
  scroller.className = 'note-scroll';
  scroller.scrollTo = vi.fn();
  document.body.append(scroller);
  const editor = new EditorView({ doc: 'First\nSecond\nThird', parent: scroller });
  try {
    editor.dispatch({ selection: { anchor: 11, head: 6 } });
    scroller.scrollTop = 120;
    const departure = captureEditorLocation(editor);
    editor.dispatch({ selection: { anchor: 0 } });
    scroller.scrollTop = 0;
    restoreEditorLocation(editor, departure);
    expect(editor.state.selection.main).toMatchObject({ anchor: 11, head: 6 });
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: 120, behavior: 'instant' });
    expect(editor.state.doc.toString()).toBe('First\nSecond\nThird');
    editor.dispatch({ changes: { from: 3, to: editor.state.doc.length } });
    restoreEditorLocation(editor, departure);
    expect(editor.state.selection.main).toMatchObject({ anchor: 3, head: 3 });
  } finally {
    editor.destroy();
    scroller.remove();
  }
});

test('restores directional selections and clamps them after the note gets shorter', () => {
  const stored = JSON.stringify({ anchor: 120, head: 34, scrollTop: 420 });
  expect(parseEditorLocation(stored, 300)).toEqual({ anchor: 120, head: 34, scrollTop: 420 });
  expect(parseEditorLocation(stored, 50)).toEqual({ anchor: 50, head: 34, scrollTop: 420 });
  expect(parseEditorLocation(stored, 0)).toEqual({ anchor: 0, head: 0, scrollTop: 420 });
});
test('invalid local navigation state cannot prevent opening a note', () => {
  for (const value of [
    null,
    '',
    '{',
    'null',
    '{}',
    '[]',
    '{"anchor":-1,"head":0,"scrollTop":0}',
    '{"anchor":0,"head":0,"scrollTop":"420"}',
  ])
    expect(parseEditorLocation(value, 100)).toBeNull();
});
