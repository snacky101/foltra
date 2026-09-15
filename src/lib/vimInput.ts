import { Vim, getCM } from '@replit/codemirror-vim';
import type { EditorView } from '@codemirror/view';
import { commandKey } from './commandKey';

export function bindVimInput(view: EditorView) {
  // Capture before CodeMirror's composing guard. Keep Insert mode and literal
  // arguments (e.g. f/r followed by a Korean character) on its normal IME path.
  const keydown = (event: KeyboardEvent) => {
    const cm = getCM(view);
    const state = cm?.state.vim;
    if (!cm || !state || state.insertMode || state.expectLiteralNext || event.metaKey || event.altKey) return;
    const key = commandKey(event);
    if (key === event.key && !event.isComposing && event.keyCode !== 229) return;
    if (key === 'Process' || key === 'Unidentified' || key === 'Dead') return;
    if (event.ctrlKey && key.toLowerCase() === 'c') return;
    const normalized = new KeyboardEvent('keydown', {
      key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
    });
    const command = Vim.vimKeyFromEvent(normalized, state);
    if (!command) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.status = (state.status || '') + command;
    Vim.multiSelectHandleKey(cm, command, 'user');
  };
  view.contentDOM.addEventListener('keydown', keydown, true);
  return () => view.contentDOM.removeEventListener('keydown', keydown, true);
}
