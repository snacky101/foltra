// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { deleteCharBackward, history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { afterEach, expect, test } from 'vitest';
import { livePreviewExtension } from './livePreview';
import type { Workspace } from './types';

const context = { workspace: { notes: [] } as unknown as Workspace, openNote() {}, openLink() {} };
let view: EditorView;
afterEach(() => view?.destroy());

test.each(['- ', '* ', '+ ', '12. ', '- Parent\n  - '])(
  'the typing position after %j is outside the marker, including while empty',
  (doc) => {
    view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [markdown(), livePreviewExtension(() => context, true), history()],
      }),
    });
    const position = view.domAtPos(doc.length);
    const element =
      position.node.nodeType === Node.TEXT_NODE ? position.node.parentElement! : (position.node as Element);
    expect(element.closest('.cm-live-list-marker')).toBeNull();
    expect(view.contentDOM.querySelector<HTMLElement>('.cm-live-list-marker')?.contentEditable).toBe('false');
    view.dispatch(view.state.replaceSelection('ㅎ'));
    const typed = view.domAtPos(doc.length + 1);
    const typedElement =
      typed.node.nodeType === Node.TEXT_NODE ? typed.node.parentElement! : (typed.node as Element);
    expect(typedElement.closest('.cm-live-list-marker')).toBeNull();
    expect(view.state.doc.toString()).toBe(doc + 'ㅎ');
    expect(view.state.selection.main.head).toBe(doc.length + 1);
  },
);

test('Backspace and undo still edit the original Markdown prefix', () => {
  view = new EditorView({
    state: EditorState.create({
      doc: '- ',
      selection: { anchor: 2 },
      extensions: [markdown(), livePreviewExtension(() => context, true), history()],
    }),
  });
  deleteCharBackward(view);
  expect(view.state.doc.toString()).toBe('-');
  expect(view.contentDOM.querySelector('.cm-live-list-marker')).toBeNull();
  undo(view);
  expect(view.state.doc.toString()).toBe('- ');
  expect(view.state.selection.main.head).toBe(2);
  expect(view.contentDOM.querySelector('.cm-live-list-marker')).not.toBeNull();
});

test('inactive code text maps to native editable positions and stays in place when activated', () => {
  const doc = 'Before\n\n```go\npackage main\n\nfunc main() {}\n```\n\nAfter';
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [markdown(), livePreviewExtension(() => context, true), history()],
    }),
  });
  const codeLine = view.contentDOM.querySelectorAll('.cm-live-code-line')[1];
  const pos = doc.indexOf('package') + 4;
  const dom = view.domAtPos(pos);
  expect(dom.node.nodeType).toBe(Node.TEXT_NODE);
  expect(dom.node.textContent).toContain('package main');
  expect(dom.node.parentElement?.closest('[contenteditable=false]')).toBeNull();
  expect(view.posAtDOM(dom.node, dom.offset)).toBe(pos);
  expect(view.contentDOM.querySelectorAll('.cm-live-code-fence-hidden')).toHaveLength(2);
  view.dispatch({ selection: { anchor: pos } });
  expect(view.contentDOM.querySelectorAll('.cm-live-code-line')[1]).toBe(codeLine);
  expect(view.contentDOM.querySelector('.cm-live-code-fence-hidden')).toBeNull();
  view.dispatch(view.state.replaceSelection('X'));
  expect(view.state.doc.toString()).toBe(doc.slice(0, pos) + 'X' + doc.slice(pos));
  undo(view);
  expect(view.state.doc.toString()).toBe(doc);
  view.dispatch({ selection: { anchor: doc.length } });
  expect(view.contentDOM.querySelectorAll('.cm-live-code-fence-hidden')).toHaveLength(2);
});
