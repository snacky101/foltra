import { EditorSelection, type EditorState, type SelectionRange } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { isolateHistory } from '@codemirror/commands';
import { type EditorView } from '@codemirror/view';
import { underlineRanges } from './markdownUnderline';

export type MarkdownFormat = 'bold' | 'italic' | 'underline' | 'strike' | 'code';
const formats = {
  bold: { node: 'StrongEmphasis', open: '**', close: '**' },
  italic: { node: 'Emphasis', open: '*', close: '*' },
  underline: { node: '', open: '<u>', close: '</u>' },
  strike: { node: 'Strikethrough', open: '~~', close: '~~' },
  code: { node: 'InlineCode', open: '`', close: '`' },
};
type Span = { from: number; to: number; openEnd: number; closeFrom: number };

function formatSpan(state: EditorState, range: SelectionRange, format: MarkdownFormat): Span | undefined {
  const tree = ensureSyntaxTree(state, range.to, 50) ?? syntaxTree(state);
  const { open, close } = formats[format];
  if (
    range.empty &&
    range.head >= open.length &&
    state.doc.sliceString(range.head - open.length, range.head) === open &&
    state.doc.sliceString(range.head, range.head + close.length) === close &&
    !protectedText(state, range.head, range.head, format)
  )
    return {
      from: range.head - open.length,
      openEnd: range.head,
      closeFrom: range.head,
      to: range.head + close.length,
    };
  if (format === 'underline')
    return underlineRanges(state.doc.toString(), tree)
      .filter((span) => span.from <= range.from && span.to >= range.to)
      .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
  let found: Span | undefined;
  tree.iterate({
    from: range.from,
    to: range.to,
    enter({ node, name, from, to }) {
      if (name !== formats[format].node || from > range.from || to < range.to) return;
      const first = node.firstChild,
        last = node.lastChild;
      if (first && last && first !== last) {
        let openEnd = first.to,
          closeFrom = last.from;
        const content = state.doc.sliceString(openEnd, closeFrom);
        // CommonMark strips one padding space around code containing backticks.
        if (format === 'code' && content.startsWith(' ') && content.endsWith(' ') && content.trim()) {
          openEnd++;
          closeFrom--;
        }
        found = { from, to, openEnd, closeFrom };
      }
    },
  });
  return found;
}

function protectedText(state: EditorState, from: number, to: number, format: MarkdownFormat) {
  let protectedRange = false;
  const tree = ensureSyntaxTree(state, to, 50) ?? syntaxTree(state);
  tree.iterate({
    from,
    to,
    enter(node) {
      // An empty strike pair alone is parsed as a fence until text is typed.
      if (
        format === 'strike' &&
        from === to &&
        from === node.from + 2 &&
        node.name === 'FencedCode' &&
        state.doc.sliceString(node.from, node.to) === '~~~~'
      )
        return false;
      if (
        [
          'Frontmatter',
          'FencedCode',
          'CodeBlock',
          'HTMLBlock',
          'HTMLTag',
          'Link',
          'Image',
          'Autolink',
        ].includes(node.name) ||
        (node.name === 'InlineCode' && format !== 'code')
      ) {
        if (from === to ? node.from <= from && node.to >= to : node.from < to && node.to > from)
          protectedRange = true;
        return false;
      }
    },
  });
  return protectedRange;
}

// Work through CodeMirror transactions so undo and autosave see a single edit.
export function toggleMarkdownFormat(view: EditorView, format: MarkdownFormat): boolean {
  const { state } = view;
  if (state.readOnly || view.compositionStarted) return false;
  const changes: { from: number; to: number; insert: string }[] = [];
  const plans: { range: SelectionRange; from: number; to: number; left: number; right: number }[] = [];
  for (const range of state.selection.ranges) {
    const existing = formatSpan(state, range, format);
    if (existing) {
      changes.push(
        { from: existing.from, to: existing.openEnd, insert: '' },
        { from: existing.closeFrom, to: existing.to, insert: '' },
      );
      plans.push({ range, from: range.from, to: range.to, left: 0, right: 0 });
      continue;
    }
    const word = range.empty ? state.wordAt(range.head) : null;
    const from = word?.from ?? range.from,
      to = word?.to ?? range.to;
    let first: number | undefined,
      last = to,
      left = 0,
      right = 0;
    const firstLine = state.doc.lineAt(from).number;
    const lastLine = state.doc.lineAt(Math.max(from, to - 1)).number;
    for (let number = firstLine; number <= lastLine; number++) {
      const line = state.doc.line(number);
      let start = Math.max(from, line.from),
        end = Math.min(to, line.to);
      if (start === line.from) {
        // Keep block syntax outside inline formatting when selecting whole lines.
        const prefix =
          /^(?:[ \t]*>[ \t]*)*(?:[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[^\]\r\n]\][ \t]+)?|[ \t]*#{1,6}[ \t]+)?/.exec(
            line.text,
          )![0];
        start = Math.min(end, line.from + prefix.length);
      }
      const text = state.doc.sliceString(start, end);
      if (text.length) {
        start += /^\s*/.exec(text)![0].length;
        end -= /\s*$/.exec(text)![0].length;
        if (start >= end) continue;
      } else if (!range.empty || from !== to) continue;
      const wrapped = formatSpan(state, EditorSelection.range(start, end), format);
      if (wrapped) {
        changes.push(
          { from: wrapped.from, to: wrapped.openEnd, insert: '' },
          { from: wrapped.closeFrom, to: wrapped.to, insert: '' },
        );
        if (first === undefined) {
          first = start;
          left = 0;
        }
        last = end;
        right = 0;
        continue;
      }
      if (protectedText(state, start, end, format)) continue;
      // A trailing escape would consume the closing marker instead of styling text.
      if (format !== 'code' && (state.doc.sliceString(start, end).match(/\\+$/)?.[0].length ?? 0) % 2)
        continue;
      let { open, close } = formats[format];
      if (format === 'code') {
        const value = state.doc.sliceString(start, end);
        const runs = value.match(/`+/g) ?? [];
        open = close = '`'.repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
        if (value.startsWith('`') || value.endsWith('`')) {
          open += ' ';
          close = ' ' + close;
        }
      }
      if (start === end) changes.push({ from: start, to: end, insert: open + close });
      else changes.push({ from: start, to: start, insert: open }, { from: end, to: end, insert: close });
      if (first === undefined) {
        first = start;
        left = open.length;
      }
      last = end;
      right = close.length;
    }
    if (first !== undefined) plans.push({ range, from: first, to: last, left, right });
    else plans.push({ range, from: range.from, to: range.to, left: 0, right: 0 });
  }
  if (!changes.length) return false;
  // Multiple cursors in the same marked span must not remove a delimiter twice.
  const unique = changes.filter(
    (change, index) =>
      changes.findIndex(
        (item) => item.from === change.from && item.to === change.to && item.insert === change.insert,
      ) === index,
  );
  const changeSet = state.changes(unique.sort((a, b) => a.from - b.from));
  const ranges = plans.map(({ range, from, to, left, right }) => {
    if (range.empty && from !== to) return EditorSelection.cursor(changeSet.mapPos(range.head, 1));
    const start = changeSet.mapPos(from, -1) + left;
    const end = from === to ? start : changeSet.mapPos(to, 1) - right;
    return range.empty
      ? EditorSelection.cursor(start)
      : EditorSelection.range(
          range.anchor > range.head ? end : start,
          range.anchor > range.head ? start : end,
        );
  });
  view.dispatch({
    changes: changeSet,
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
    annotations: isolateHistory.of('full'),
    userEvent: 'input.format',
    scrollIntoView: true,
  });
  return true;
}
