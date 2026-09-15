import { useEffect, useRef, useState } from 'react';
import { bindingsFor, canStartLeader, shortcutMatches, type Command } from './commands';
import type { Settings } from './types';
import { leaderMatches } from './leaderKey';
import { moveSidebarFocus } from './workspaceFocus';
import { commandKey } from './commandKey';

export function useCommandKeys(
  commands: Command[],
  settings: Settings | undefined,
  mode: string,
  modalOpen: boolean,
  onError: (e: unknown) => void,
) {
  const [pending, setPending] = useState<string | null>(null);
  const state = useRef({ commands, settings, mode, modalOpen, onError });
  state.current = { commands, settings, mode, modalOpen, onError };
  useEffect(() => {
    let sequence: string | null = null;
    const reset = () => {
      sequence = null;
      setPending(null);
    };
    const invoke = (command: Command) => {
      reset();
      Promise.resolve().then(command.run).catch(state.current.onError);
    };
    const keydown = (event: KeyboardEvent) => {
      const { commands, settings, mode, modalOpen } = state.current;
      if ((event.target as HTMLElement | null)?.closest('[data-key-recorder], [data-inline-rename]')) {
        reset();
        return;
      }
      if (!settings) return;
      if (event.key === 'Escape') {
        reset();
        return;
      }
      if (modalOpen || (event.target as HTMLElement | null)?.closest('[role="menu"], [role="dialog"]'))
        return;
      const target = event.target as HTMLElement | null;
      const editable = !!target?.closest(
        'input, textarea, select, [role="combobox"], [data-keyboard-input], [contenteditable="true"]',
      );
      const inEditor = !!target?.closest('.cm-editor');
      const composing = event.isComposing || event.keyCode === 229;
      const commandMode =
        settings.vim && (!editable || (inEditor && (mode === 'NORMAL' || mode === 'VISUAL')));
      const shortcut = commands.find((command) => {
        const key = bindingsFor(command, settings).shortcut;
        return key && shortcutMatches(event, key);
      });
      // Only explicit pane navigation may interrupt text composition. Normal-mode
      // Vim keys are commands, so they can still reach the editor or sidebar.
      if (composing) {
        if (
          shortcut &&
          (event.ctrlKey || event.metaKey) &&
          /^focus\.(left|down|up|right)$/.test(shortcut.id)
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          invoke(shortcut);
          return;
        }
        if (!commandMode) {
          reset();
          return;
        }
      }
      const key = commandMode ? commandKey(event) : event.key;
      const allowLeader = canStartLeader(false, editable, inEditor, settings.vim, mode);
      if (
        sequence === null &&
        allowLeader &&
        leaderMatches(
          {
            key,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
          },
          settings.leader,
        ) &&
        !event.repeat
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        sequence = '';
        setPending('');
        return;
      }
      if (shortcut && !composing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        invoke(shortcut);
        return;
      }
      if (!allowLeader) {
        reset();
        return;
      }
      if (
        sequence === null &&
        settings.vim &&
        target &&
        /^[hjkl]$/.test(key) &&
        !editable &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        moveSidebarFocus(target, key)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (sequence === null || key.length !== 1) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      sequence += key;
      const next = commands.filter((command) =>
        bindingsFor(command, settings).leader?.replaceAll(' ', '').startsWith(sequence!),
      );
      const exact = next.find(
        (command) => bindingsFor(command, settings).leader?.replaceAll(' ', '') === sequence,
      );
      if (exact) invoke(exact);
      else if (next.length) {
        setPending(sequence);
      } else reset();
    };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('blur', reset);
    return () => {
      reset();
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('blur', reset);
    };
  }, []);
  return pending;
}
