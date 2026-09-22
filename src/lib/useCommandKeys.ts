import { useEffect, useRef, useState } from 'react';
import {
  bindingsFor,
  canStartLeader,
  leaderCandidates,
  sequenceKeys,
  shortcutMatches,
  type Command,
} from './commands';
import type { Settings } from './types';
import { leaderMatches } from './leaderKey';
import { moveSidebarFocus } from './workspaceFocus';
import { commandKey } from './commandKey';
import { EditorView } from '@codemirror/view';
import { getCM } from '@replit/codemirror-vim';

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
      // A composition may still target the old editor after focus has moved.
      // Route commands by the focused control, and never reinterpret text fields.
      const target =
        document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : (event.target as HTMLElement | null);
      if (target?.closest('[data-key-recorder], [data-inline-rename]')) {
        reset();
        return;
      }
      if (!settings) return;
      if (event.key === 'Escape') {
        reset();
        return;
      }
      if (modalOpen || target?.closest('[role="menu"], [role="dialog"]')) return;
      const editable = !!target?.closest(
        'input, textarea, select, [role="combobox"], [data-keyboard-input], [contenteditable="true"]',
      );
      const inEditor =
        !!target?.closest('.cm-editor') && !target?.closest('input, textarea, select, [data-keyboard-input]');
      const composing = event.isComposing || event.keyCode === 229;
      const commandMode =
        settings.vim && (!editable || (inEditor && (mode === 'NORMAL' || mode === 'VISUAL')));
      const shortcut =
        sequence === null
          ? commands.find((command) =>
              bindingsFor(command, settings).some(
                (binding) => !binding.leader && shortcutMatches(event, binding.keys),
              ),
            )
          : undefined;
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
      const editor = inEditor && target ? EditorView.findFromDOM(target) : null;
      const vim = editor && getCM(editor)?.state.vim;
      const vimPending =
        vim &&
        !vim.insertMode &&
        (vim.expectLiteralNext ||
          vim.inputState.operator ||
          vim.inputState.keyBuffer.length ||
          vim.inputState.prefixRepeat.length ||
          vim.inputState.motionRepeat.length ||
          vim.inputState.registerName);
      const allowLeader = !vimPending && canStartLeader(false, editable, inEditor, settings.vim, mode);
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
      if (sequence === null) return;
      const candidates = leaderCandidates(commands, settings, sequence);
      const modified =
        sequence === '' && candidates.find(({ binding }) => shortcutMatches(event, binding.keys));
      if (modified) {
        event.preventDefault();
        event.stopImmediatePropagation();
        invoke(modified.command);
        return;
      }
      if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
        reset();
        return;
      }
      sequence += key;
      const next = leaderCandidates(commands, settings, sequence);
      const exact = next.find(({ binding }) => sequenceKeys(binding) === sequence);
      if (exact) invoke(exact.command);
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
