import { syntaxTree } from '@codemirror/language';
import type { StateCommand } from '@codemirror/state';

// Only Enter at an opening fence creates a pair. Closing fences, inline code,
// existing pairs and code contents retain the editor's normal Enter behavior.
export const insertFencedCodeBlock: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly || state.selection.ranges.length !== 1) return false;
  const cursor = state.selection.main;
  const line = state.doc.lineAt(cursor.head);
  if (!cursor.empty || cursor.head !== line.to) return false;
  let node = syntaxTree(state).resolveInner(cursor.head, -1);
  while (node.parent && node.name !== 'FencedCode') node = node.parent;
  if (node.name !== 'FencedCode') return false;
  const opening = node.firstChild;
  if (!opening || opening.name !== 'CodeMark' || opening.from < line.from) return false;
  if (node.lastChild?.name === 'CodeMark' && node.lastChild.from !== opening.from) return false;
  const marker = state.doc.sliceString(opening.from, opening.to);
  const prefix = state.doc
    .sliceString(line.from, opening.from)
    .replace(/(?:[-+*]|\d+[.)])(?:[ \t]+\[[ xX]\])?[ \t]+/g, (value) => ' '.repeat(value.length));
  const newline = '\n' + prefix;
  dispatch(
    state.update({
      changes: { from: cursor.head, insert: newline + newline + marker },
      selection: { anchor: cursor.head + newline.length },
      scrollIntoView: true,
      userEvent: 'input',
    }),
  );
  return true;
};
