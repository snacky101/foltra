import { countColumn, type EditorState, type StateCommand } from '@codemirror/state';
import { getIndentUnit, syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

// A list indent is a change of parent, not an arbitrary increase in whitespace.
// Otherwise repeated Tab eventually turns a marker into paragraph/code text.
export function indentMarkdownList(backwards: boolean): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const selected = new Set<number>();
    for (const range of state.selection.ranges) {
      const end = state.doc.lineAt(range.empty ? range.to : range.to - 1).number;
      for (let line = state.doc.lineAt(range.from).number; line <= end; line++) selected.add(line);
    }
    const items: SyntaxNode[] = [];
    syntaxTree(state).iterate({
      enter({ node, name, from }) {
        if (name === 'ListItem' && selected.has(state.doc.lineAt(from).number)) {
          items.push(node);
          return false; // Move selected parents and their descendants together, once.
        }
      },
    });
    if (!items.length) return false;

    const shifts = new Map<number, { delta: number; quotes: number }>();
    const itemShifts = new Map<number, number>();
    for (const item of items) {
      const first = state.doc.lineAt(item.from);
      const quotes = first.text.slice(0, item.from - first.from).match(/>/g)?.length ?? 0;
      const column = markerColumn(state, item);
      let delta = 0;
      if (backwards) {
        const parent = item.parent?.parent;
        if (parent?.name === 'ListItem') delta = markerColumn(state, parent) - column;
      } else {
        let previous = item.prevSibling;
        while (previous && previous.name !== 'ListItem') previous = previous.prevSibling;
        if (previous) {
          // A selected run stays together under the same preceding item.
          delta = itemShifts.get(previous.from) ?? contentColumn(state, previous) - column;
        }
      }
      itemShifts.set(item.from, delta);
      for (let number = first.number; number <= state.doc.lineAt(item.to).number; number++) {
        const line = state.doc.line(number);
        const prefix = line.text.match(/^[ \t>]*/)?.[0] ?? '';
        // Foltra treats left-aligned text after a list as a separate paragraph.
        if (number === first.number || countColumn(prefix, state.tabSize) >= contentColumn(state, item))
          shifts.set(number, { delta, quotes });
      }
    }

    const changes: { from: number; to: number; insert: string }[] = [];
    for (const number of new Set([...selected, ...shifts.keys()])) {
      const line = state.doc.line(number);
      const { delta, quotes } = shifts.get(number) ?? {
        delta: backwards ? -getIndentUnit(state) : getIndentUnit(state),
        quotes: 0,
      };
      if (!delta) continue;
      // Preserve enclosing quotes, but move quotes contained in the item with it.
      const quote = quotes ? (line.text.match(new RegExp(`^(?:[ \\t]*>[ \\t]?){${quotes}}`))?.[0] ?? '') : '';
      const space = line.text.slice(quote.length).match(/^[ \t]*/)?.[0] ?? '';
      const from = line.from + quote.length;
      const base = countColumn(quote, state.tabSize);
      const width = countColumn(quote + space, state.tabSize) - base;
      changes.push({ from, to: from + space.length, insert: ' '.repeat(Math.max(0, width + delta)) });
    }
    if (changes.length) {
      const changeSet = state.changes(changes.sort((a, b) => a.from - b.from));
      dispatch(
        state.update({
          changes: changeSet,
          selection: state.selection.map(changeSet, 1),
          scrollIntoView: true,
          userEvent: backwards ? 'delete.dedent' : 'input.indent',
        }),
      );
    }
    return true;
  };
}

function markerColumn(state: EditorState, item: SyntaxNode) {
  const mark = item.getChild('ListMark')!;
  const line = state.doc.lineAt(mark.from);
  return countColumn(line.text, state.tabSize, mark.from - line.from);
}

function contentColumn(state: EditorState, item: SyntaxNode) {
  const mark = item.getChild('ListMark')!;
  const line = state.doc.lineAt(mark.to);
  const space = line.text.slice(mark.to - line.from).match(/^[ \t]+/)?.[0].length ?? 0;
  return countColumn(line.text, state.tabSize, mark.to - line.from + Math.max(1, space));
}
