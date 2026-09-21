import { Vim } from '@replit/codemirror-vim';
import { bindVimTextObjects } from './vimTextObjects';

export interface VimBinding {
  id: string;
  keys: string;
}
const handlers = new WeakMap<object, (id: string) => void>();
Vim.defineAction('foltraCommand', (cm, args) => {
  const id = (args as typeof args & { commandId: string }).commandId;
  // Finish the Vim operation before external formatting dispatches its selection.
  // The adapter can then synchronize Visual endpoints with the changed document.
  if (id.startsWith('note.format.')) {
    const run = handlers.get(cm);
    queueMicrotask(() => {
      if (handlers.get(cm) === run) run?.(id);
    });
  } else handlers.get(cm)?.(id);
});

// Vim's keymap is global; Foltra mounts one active note editor. Replace only our
// mappings on settings/editor changes so the underlying Vim defaults reappear.
let activeCleanup: (() => void) | undefined;
export function bindVimKeybindings(cm: object, bindings: VimBinding[], run: (id: string) => void) {
  activeCleanup?.();
  handlers.set(cm, run);
  const unbindTextObjects = bindVimTextObjects(cm);
  for (const { id, keys } of bindings) {
    Vim.mapCommand(keys, 'action', 'foltraCommand', { commandId: id }, { context: 'normal' });
    if (id.startsWith('note.format.'))
      Vim.mapCommand(keys, 'action', 'foltraCommand', { commandId: id }, { context: 'visual' });
  }
  const cleanup = () => {
    if (activeCleanup !== cleanup) return;
    for (const { id, keys } of bindings) {
      Vim.unmap(keys, 'normal');
      if (id.startsWith('note.format.')) Vim.unmap(keys, 'visual');
    }
    unbindTextObjects();
    handlers.delete(cm);
    activeCleanup = undefined;
  };
  activeCleanup = cleanup;
  return cleanup;
}
