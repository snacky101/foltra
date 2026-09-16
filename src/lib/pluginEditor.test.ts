// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { afterEach, expect, test } from 'vitest';
import { applyPluginEditorEdit, pluginEditorSnapshot } from './pluginEditor';
let view: EditorView;
const create = () => {
  view = new EditorView({
    state: EditorState.create({
      doc: 'alpha 한글',
      selection: { anchor: 0, head: 5 },
      extensions: [history()],
    }),
  });
  return pluginEditorSnapshot(view, 'note-a')!;
};
afterEach(() => view?.destroy());
test('a plugin transformation remains one undoable editor transaction', () => {
  const before = create();
  expect(applyPluginEditorEdit(view, 'note-a', before, 'ALPHA')).toBe(true);
  expect(view.state.doc.toString()).toBe('ALPHA 한글');
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe('alpha 한글');
  expect(view.state.selection.main.to).toBe(5);
});
test.each(['note', 'document', 'selection'] as const)(
  'a late plugin response cannot overwrite a changed %s',
  (kind) => {
    const before = create();
    if (kind === 'document') view.dispatch({ changes: { from: 8, insert: '!' } });
    if (kind === 'selection') view.dispatch({ selection: { anchor: 3 } });
    const current = view.state.doc.toString(),
      selection = view.state.selection;
    expect(applyPluginEditorEdit(view, kind === 'note' ? 'note-b' : 'note-a', before, 'LOST')).toBe(false);
    expect(view.state.doc.toString()).toBe(current);
    expect(view.state.selection).toBe(selection);
  },
);
