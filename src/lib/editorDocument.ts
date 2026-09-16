import { Transaction, type EditorState, type TransactionSpec } from '@codemirror/state';

// A save may normalize a link. Replacing the entire document moves the cursor
// to its end, interrupts IME and adds the whole note to undo history.
export function externalDocumentChange(state: EditorState, value: string): TransactionSpec | null {
  const before = state.doc.toString();
  if (before === value) return null;
  let from = 0;
  let oldEnd = before.length;
  let newEnd = value.length;
  while (from < oldEnd && from < newEnd && before[from] === value[from]) from++;
  while (oldEnd > from && newEnd > from && before[oldEnd - 1] === value[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return {
    changes: { from, to: oldEnd, insert: value.slice(from, newEnd) },
    annotations: Transaction.addToHistory.of(false),
  };
}
