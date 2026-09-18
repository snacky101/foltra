// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { afterEach, expect, test, vi } from 'vitest';
import { Editor } from './Editor';
import type { Workspace } from '../lib/types';

afterEach(() => vi.unstubAllGlobals());

test.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
  'system replacement reaches the document and history (vim %s, live %s)',
  async (vimEnabled, livePreview) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const onChange = vi.fn();
    const workspace = {
      vault: { id: 'replacement-test' },
      notes: [],
      records: [],
      settings: { cursorShape: 'bar', cursorBlink: 'steady', lineNumbers: 'none' },
    } as unknown as Workspace;
    try {
      await act(async () =>
        root.render(
          <Editor
            noteId="replacement-note"
            value="한글 -> "
            vimEnabled={vimEnabled}
            livePreview={livePreview}
            workspace={workspace}
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
          />,
        ),
      );
      const view = EditorView.findFromDOM(host.querySelector('.cm-content')!)!;
      expect(view.contentDOM.getAttribute('autocorrect')).toBe('on');
      expect(view.contentDOM.getAttribute('spellcheck')).toBe('true');
      await act(async () => {
        view.focus();
        if (vimEnabled)
          view.contentDOM.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'i',
              code: 'KeyI',
              bubbles: true,
              cancelable: true,
            }),
          );
        view.dispatch({ selection: { anchor: view.state.doc.length } });
      });
      // jsdom has no native text service. Deliver its DOM mutation and input event
      // through CodeMirror's observer; OS shortcut activation is verified in WebKit.
      await act(async () => {
        const before = new InputEvent('beforeinput', {
          inputType: 'insertReplacementText',
          data: '→',
          bubbles: true,
          cancelable: true,
        });
        view.contentDOM.dispatchEvent(before);
        expect(before.defaultPrevented).toBe(false);
        const line = view.contentDOM.querySelector('.cm-line')!;
        line.textContent = '한글 → ';
        document.getSelection()!.collapse(line.firstChild, line.textContent.length);
        view.contentDOM.dispatchEvent(
          new InputEvent('input', {
            inputType: 'insertReplacementText',
            data: '→',
            bubbles: true,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(view.state.doc.toString()).toBe('한글 → ');
      expect(onChange).toHaveBeenLastCalledWith('한글 → ');
      expect(view.state.selection.main.head).toBe('한글 → '.length);
      await act(async () => {
        undo(view);
      });
      expect(view.state.doc.toString()).toBe('한글 -> ');
      await act(async () => {
        redo(view);
      });
      expect(view.state.doc.toString()).toBe('한글 → ');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);
