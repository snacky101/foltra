import { EditorState } from '@codemirror/state';
import { history, undoDepth } from '@codemirror/commands';
import { expect, test } from 'vitest';
import { externalDocumentChange } from './editorDocument';

test('save normalization maps the cursor without inserting a whole-document undo event', () => {
  let state = EditorState.create({ doc: '[[id|Name]]\n\nEditing 한글', extensions: [history()] });
  state = state.update({
    selection: { anchor: state.doc.length },
    changes: { from: state.doc.length, insert: '!' },
    userEvent: 'input.type',
  }).state;
  const cursor = state.selection.main.head;
  const depth = undoDepth(state);
  const normalized = state.doc.toString().replace('id|Name', 'Name');
  state = state.update(externalDocumentChange(state, normalized)!).state;
  expect(state.doc.toString()).toBe(normalized);
  expect(state.selection.main.head).toBe(cursor - 3);
  expect(undoDepth(state)).toBe(depth);
  expect(externalDocumentChange(state, normalized)).toBeNull();
});
