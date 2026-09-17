// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { afterEach, expect, test, vi } from 'vitest';
import { Editor, type EditorHandle } from './Editor';
import { NotePreview } from './NotePreview';
import type { Workspace } from '../lib/types';

afterEach(() => vi.unstubAllGlobals());

test('changing editor family keeps the document, selection, editor instance and undo history', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const ref = createRef<EditorHandle>();
  const onChange = vi.fn();
  let value = '한글 paragraph\n- bullet';
  const workspace = (editorFontFamily: string, databaseFontFamily = 'monospace') =>
    ({
      vault: { id: 'font-test' },
      notes: [],
      records: [],
      settings: {
        cursorShape: 'bar',
        cursorBlink: 'steady',
        lineNumbers: 'none',
        editorFontFamily,
        databaseFontFamily,
      },
    }) as unknown as Workspace;
  const render = (font: string, livePreview = true) => (
    <>
      <Editor
        ref={ref}
        noteId="font-note"
        value={value}
        vimEnabled={false}
        livePreview={livePreview}
        workspace={workspace(font)}
        openNote={() => {}}
        openLink={() => {}}
        vimBindings={[]}
        onCommand={() => {}}
        commandLineHost={{ current: null }}
        slash={false}
        onChange={onChange}
        onMode={() => {}}
        onSlash={() => {}}
        onNoteCommand={async () => {}}
        onError={() => {}}
      />
      <NotePreview body={value} workspace={workspace(font)} openNote={() => {}} openLink={() => {}} />
    </>
  );
  try {
    await act(async () => root.render(render('')));
    const editor = EditorView.findFromDOM(host.querySelector('.cm-content')!)!;
    await act(async () => {
      editor.dispatch({ selection: { anchor: value.length } });
      ref.current!.insert(' text');
    });
    value = onChange.mock.lastCall![0];
    const selection = editor.state.selection.toJSON();
    onChange.mockClear();
    for (const [font, live] of [
      ['serif', true],
      ['Menlo', false],
      ['', true],
    ] as const) {
      await act(async () => root.render(render(font, live)));
      expect(EditorView.findFromDOM(host.querySelector('.cm-content')!)).toBe(editor);
      expect(editor.state.doc.toString()).toBe(value);
      expect(editor.state.selection.toJSON()).toEqual(selection);
      expect(onChange).not.toHaveBeenCalled();
      const expected =
        font === 'serif' ? 'serif, var(--body-font)' : font === 'Menlo' ? '"Menlo", var(--body-font)' : '';
      for (const selector of ['.editor', '.markdown-preview'])
        expect(
          host.querySelector<HTMLElement>(selector)!.style.getPropertyValue('--editor-font-family'),
        ).toBe(expected);
    }
    await act(async () => {
      undo(editor);
    });
    expect(onChange).toHaveBeenLastCalledWith('한글 paragraph\n- bullet');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
