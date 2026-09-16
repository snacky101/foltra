import { Vim } from '@replit/codemirror-vim';
import { expect, test, vi } from 'vitest';
import { bindVimKeybindings } from './vimKeybindings';

// Real Vim sequence parsing with only the editor surface stubbed.
function editor() {
  return {
    state: {},
    curOp: {},
    operation: (action: () => void) => action(),
    getCursor: () => ({ line: 0, ch: 0 }),
  } as unknown as Parameters<typeof Vim.handleKey>[0];
}
function press(cm: ReturnType<typeof editor>, keys: string) {
  for (const key of keys) Vim.handleKey(cm, key, 'user');
}
test('rebinds commands without leaving stale mappings or handlers, restoring the underlying Vim mapping', () => {
  const baseline = vi.fn();
  Vim.defineAction('testBaseline', baseline);
  Vim.mapCommand('gZ', 'action', 'testBaseline', {}, { context: 'normal' });
  const cm = editor();
  const first = vi.fn();
  const second = vi.fn();
  const unbindFirst = bindVimKeybindings(cm, [{ id: 'note.follow-link', keys: 'gZ' }], first);
  press(cm, 'g');
  expect(first).not.toHaveBeenCalled();
  press(cm, 'Z');
  expect(first).toHaveBeenCalledExactlyOnceWith('note.follow-link');
  expect(baseline).not.toHaveBeenCalled();
  const next = editor();
  const unbindNext = bindVimKeybindings(next, [{ id: 'plugin.test.run', keys: 'gX' }], second);
  unbindFirst(); // An old editor's delayed cleanup cannot remove the new mapping.
  try {
    press(next, 'gZ');
    expect(baseline).toHaveBeenCalledOnce();
    press(cm, 'gX');
    expect(second).not.toHaveBeenCalled();
    press(next, 'gX');
    expect(second).toHaveBeenCalledExactlyOnceWith('plugin.test.run');
    unbindNext();
    press(next, 'gX');
    expect(second).toHaveBeenCalledOnce();
  } finally {
    unbindNext();
    Vim.unmap('gZ', 'normal');
  }
});
