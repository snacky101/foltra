import { insertFencedCodeBlock } from './codeBlocks';
import { Prec } from '@codemirror/state';
import { EditorView, keymap, runScopeHandlers } from '@codemirror/view';
import { indentMore, indentLess, insertNewlineAndIndent } from '@codemirror/commands';
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown';
import { getCM } from '@replit/codemirror-vim';
import { completionStatus } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { indentMarkdownList } from './markdownIndentation';
import { taskPrefix } from './markdownTasks';
import type { ChangeSpec, StateCommand } from '@codemirror/state';

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

// Enter continues one item, even when earlier items have blank separators.
// Keep CodeMirror's nesting, task markers and numbering. Exiting only removes markup.
export const continueMarkdownList: StateCommand = ({ state, dispatch }) => {
  // The upstream command only knows [ ]/[x]. Normalize current task ancestors
  // in a temporary, same-length document and apply only its result to the original.
  const tasks = new Map<number, { from: number; to: number; insert: string }>();
  for (const range of state.selection.ranges) {
    if (!range.empty) continue;
    for (let node = syntaxTree(state).resolveInner(range.head, -1); node; node = node.parent!) {
      if (['Frontmatter', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'Table'].includes(node.name)) break;
      if (node.name !== 'ListItem' || node.parent?.name !== 'BulletList') continue;
      const mark = node.getChild('ListMark');
      if (!mark) continue;
      const line = state.doc.lineAt(mark.to);
      const rest = state.doc.sliceString(mark.to, line.to);
      const space = rest.match(/^[ \t]+/)?.[0].length ?? 0;
      const task = space && taskPrefix(rest.slice(space));
      if (!task) continue;
      const from = mark.to + space;
      if (range.head < from + task.length) continue;
      const empty =
        range.head >= from + task.length &&
        range.head <= line.to &&
        !state.doc.sliceString(from + task.length, line.to).trim();
      if (empty) tasks.set(from, { from, to: from + task.length, insert: '   ' });
      else if (!tasks.has(from) && ![' ', 'x', 'X'].includes(task.marker))
        tasks.set(from, { from: from + 1, to: from + 2, insert: ' ' });
    }
  }
  const prepared = tasks.size
    ? state.update({ changes: [...tasks.values()].sort((a, b) => a.from - b.from) }).state
    : state;
  return continueMarkup({
    state: prepared,
    dispatch(transaction) {
      const adjustments: ChangeSpec[] = [];
      transaction.changes.iterChanges((_oldFrom, _oldTo, from, _end, inserted) => {
        const extra = /^\n[ \t>]*\n(?=[ \t>]*(?:[-+*]|\d+[.)])(?:[ \t]|$))/.exec(inserted.toString());
        if (extra) adjustments.push({ from, to: from + extra[0].length - 1 });
      });
      if (!adjustments.length && prepared === state) return dispatch(transaction);
      const cleanup = transaction.state.changes(adjustments);
      dispatch(
        state.update({
          changes: transaction.changes.compose(cleanup),
          selection: transaction.newSelection.map(cleanup, 1),
          scrollIntoView: true,
          userEvent: 'input',
        }),
      );
    },
  });
};

export const deleteMarkdownMarkupBackward: StateCommand = (target) => {
  const emptyItems = target.state.selection.ranges.every((range) => {
    for (let node = syntaxTree(target.state).resolveInner(range.head, -1); node; node = node.parent!)
      if (['Frontmatter', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'Table'].includes(node.name)) return false;
    const line = target.state.doc.lineAt(range.head);
    const task = /^[\t >]*[-+*][ \t]+(\[[^\]\r\n]\])[ \t]*$/.exec(line.text);
    return (
      range.empty &&
      range.head === line.to &&
      (/^[\t >]*(?:[-+*]|\d+[.)])(?:[ \t]+\[[ xX]\])?[ \t]+$/.test(line.text) ||
        (task !== null && taskPrefix(task[1]) !== null))
    );
  });
  // CodeMirror replaces a later item's marker with spaces. On an empty item,
  // Backspace should exit one list level just like Enter, without a hidden indent.
  if (emptyItems && continueMarkdownList(target)) return true;
  return deleteMarkupBackward(target);
};

function indentMarkdown(view: EditorView, backwards = false) {
  if (view.compositionStarted) return false;
  // Completion owns Tab even during its brief delay before accepting a choice.
  if (!backwards && completionStatus(view.state) === 'active') return true;
  return indentMarkdownList(backwards)(view) || (backwards ? indentLess(view) : indentMore(view));
}

export const markdownEditing = [
  EditorView.domEventObservers({
    keydown(event, view) {
      // Vim uses Escape to leave Insert, not to arm CodeMirror's temporary
      // Escape-then-Tab focus escape. Clear it after key handlers have run.
      if (event.key === 'Escape' && getCM(view)?.state.vim) queueMicrotask(() => view.setTabFocusMode(false));
    },
  }),
  Prec.high(
    keymap.of([
      { key: 'Tab', run: (view) => indentMarkdown(view), shift: (view) => indentMarkdown(view, true) },
      {
        key: 'Enter',
        run: (view) => {
          const vim = getCM(view)?.state.vim;
          return !view.compositionStarted && (!vim || vim.insertMode) && insertFencedCodeBlock(view);
        },
      },
      { key: 'Enter', run: continueMarkdownList },
      { key: 'Backspace', run: deleteMarkdownMarkupBackward },
    ]),
  ),
  EditorView.domEventHandlers({
    beforeinput(event, view) {
      if (
        !event.cancelable ||
        event.isComposing ||
        !['insertLineBreak', 'insertParagraph'].includes(event.inputType)
      )
        return false;
      // WebKit may suppress keydown just after compositionend. Handle the actual
      // newline intent, after CodeMirror has flushed the committed IME text.
      queueMicrotask(() => {
        if (!view.dom.isConnected || !view.hasFocus || view.composing) return;
        if (!runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' }), 'editor'))
          insertNewlineAndIndent(view);
      });
      return true;
    },
  }),
];
