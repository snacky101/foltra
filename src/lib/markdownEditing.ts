import { insertFencedCodeBlock } from './codeBlocks';
import { Prec } from '@codemirror/state';
import { EditorView, keymap, runScopeHandlers } from '@codemirror/view';
import { indentMore, indentLess, insertNewlineAndIndent } from '@codemirror/commands';
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown';
import { getCM } from '@replit/codemirror-vim';
import { completionStatus } from '@codemirror/autocomplete';
import { indentMarkdownList } from './markdownIndentation';
import type { ChangeSpec, StateCommand } from '@codemirror/state';

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

// Enter continues one item, even when earlier items have blank separators.
// Keep CodeMirror's nesting, task markers and numbering. Exiting only removes markup.
export const continueMarkdownList: StateCommand = ({ state, dispatch }) =>
  continueMarkup({
    state,
    dispatch(transaction) {
      const adjustments: ChangeSpec[] = [];
      transaction.changes.iterChanges((_oldFrom, _oldTo, from, _end, inserted) => {
        const extra = /^\n[ \t>]*\n(?=[ \t>]*(?:[-+*]|\d+[.)])(?:[ \t]|$))/.exec(inserted.toString());
        if (extra) adjustments.push({ from, to: from + extra[0].length - 1 });
      });
      if (!adjustments.length) return dispatch(transaction);
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

export const deleteMarkdownMarkupBackward: StateCommand = (target) => {
  const emptyItems = target.state.selection.ranges.every((range) => {
    const line = target.state.doc.lineAt(range.head);
    return (
      range.empty &&
      range.head === line.to &&
      /^[\t >]*(?:[-+*]|\d+[.)])(?:[ \t]+\[[ xX]\])?[ \t]+$/.test(line.text)
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
