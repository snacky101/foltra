import { Vim } from '@replit/codemirror-vim';

export interface VimBinding {
  id: string;
  keys: string;
}
const handlers = new WeakMap<object, (id: string) => void>();
Vim.defineAction('foltraCommand', (cm, args) => {
  handlers.get(cm)?.((args as typeof args & { commandId: string }).commandId);
});

// Vim's keymap is global; Foltra mounts one active note editor. Replace only our
// mappings on settings/editor changes so the underlying Vim defaults reappear.
let activeCleanup: (() => void) | undefined;
export function bindVimKeybindings(cm: object, bindings: VimBinding[], run: (id: string) => void) {
  activeCleanup?.();
  handlers.set(cm, run);
  for (const { id, keys } of bindings) {
    Vim.mapCommand(keys, 'action', 'foltraCommand', { commandId: id }, { context: 'normal' });
  }
  const cleanup = () => {
    if (activeCleanup !== cleanup) return;
    for (const { keys } of bindings) Vim.unmap(keys, 'normal');
    handlers.delete(cm);
    activeCleanup = undefined;
  };
  activeCleanup = cleanup;
  return cleanup;
}
