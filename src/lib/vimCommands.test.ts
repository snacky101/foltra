import { Vim } from '@replit/codemirror-vim';
import { expect, test, vi } from 'vitest';
import { bindVimCommands } from './vimCommands';

// Use the library's real Ex parser, with only the editor surface stubbed.
function editor() {
  return {
    state: { vim: {} },
    operation: (action: () => void) => action(),
    getCursor: () => ({ line: 0, ch: 0 }),
    firstLine: () => 0,
    lastLine: () => 1,
  } as unknown as Parameters<typeof Vim.handleEx>[0];
}
test('argument-free Ex commands reach the invoking editor, including write and quit aliases', async () => {
  for (const [input, command, force] of [
    ['w', 'write', false],
    ['q', 'quit', false],
    ['wq', 'writequit', false],
    ['x', 'writequit', false],
    ['q!', 'quit', true],
    ['wq!', 'writequit', true],
  ] as const) {
    const cm = editor();
    const run = vi.fn(async () => {});
    const error = vi.fn();
    const unbind = bindVimCommands(cm, { run, error });
    Vim.handleEx(cm, input);
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith(command, force);
    expect(error).not.toHaveBeenCalled();
    unbind();
  }
});
test('Ex file arguments and ranges cannot silently save the current note', () => {
  for (const input of ['w filename.md', '%w', '1,2w']) {
    const cm = editor();
    const run = vi.fn(async () => {});
    const error = vi.fn();
    const unbind = bindVimCommands(cm, { run, error });
    Vim.handleEx(cm, input);
    expect(run).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    unbind();
  }
});
