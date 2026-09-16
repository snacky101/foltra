import type { EditorView } from '@codemirror/view';
import type { PluginEditorSnapshot } from './pluginTypes';
export function pluginEditorSnapshot(editor: EditorView | null, noteId: string): PluginEditorSnapshot | null {
  if (!editor || editor.composing) return null;
  const { from, to } = editor.state.selection.main;
  return { noteId, body: editor.state.doc.toString(), from, to, selection: editor.state.sliceDoc(from, to) };
}
export function applyPluginEditorEdit(
  editor: EditorView | null,
  noteId: string,
  snapshot: PluginEditorSnapshot,
  text: string,
): boolean {
  if (
    !editor ||
    editor.composing ||
    noteId !== snapshot.noteId ||
    editor.state.doc.toString() !== snapshot.body ||
    editor.state.selection.main.from !== snapshot.from ||
    editor.state.selection.main.to !== snapshot.to
  )
    return false;
  editor.dispatch({
    changes: { from: snapshot.from, to: snapshot.to, insert: text },
    selection: { anchor: snapshot.from + text.length },
    userEvent: 'input.plugin',
  });
  editor.focus();
  return true;
}
