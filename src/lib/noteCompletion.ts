import { Prec, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { autocompletion, completionKeymap, acceptCompletion } from '@codemirror/autocomplete';
import { getCM } from '@replit/codemirror-vim';
import { call } from './api';
import { wikiCompletions } from './wikiCompletion';
import { tagCompletionRange, tagCompletions, type TagSuggestion } from './tagCompletion';
import { pluginCompletions, pluginCompletionProviders } from './pluginCompletion';
import type { PluginCompletionInvoke } from './pluginTypes';
import type { Workspace } from './types';

export function noteCompletionExtension(
  workspace: () => Workspace,
  onError: (error: unknown) => void,
  complete?: () => PluginCompletionInvoke | undefined,
) {
  let composing = false;
  return [
    EditorView.domEventObservers({
      compositionstart: () => {
        composing = true;
      },
      compositionend: () => {
        composing = false;
      },
    }),
    EditorState.transactionFilter.of((transaction) =>
      // WebKit selects the marked syllable, then collapses it in a separate
      // transaction. This is IME input, not a user leaving the completion range.
      composing && transaction.annotation(Transaction.userEvent) === 'select'
        ? [{ userEvent: 'input.type.compose' }, transaction]
        : transaction,
    ),
    autocompletion({
      override: [
        (context) => {
          const vim = context.view && getCM(context.view)?.state.vim;
          if (vim && !vim.insertMode) return null;
          const invoke = complete?.();
          const wiki = wikiCompletions(context, workspace(), () => composing);
          if (wiki && invoke && pluginCompletionProviders(context, workspace(), () => composing).length)
            return pluginCompletions(context, workspace, invoke, () => composing);
          if (wiki)
            return {
              ...wiki,
              // Typing a plugin trigger inside an already open wiki popup must
              // restart the source instead of retaining the note suggestions.
              update: (current, from, to, next) =>
                complete?.() && pluginCompletionProviders(next, workspace(), () => composing).length
                  ? null
                  : wiki.update!(current, from, to, next),
            };
          if (!tagCompletionRange(context, () => composing))
            return pluginCompletions(context, workspace, complete?.(), () => composing);
          return call<TagSuggestion[]>(workspace().path, 'tags.list')
            .then((tags) => (context.aborted ? null : tagCompletions(context, tags, () => composing)))
            .catch((error) => {
              if (!context.aborted) onError(error);
              return null;
            });
        },
      ],
      activateOnTypingDelay: 50,
      defaultKeymap: false,
      icons: false,
      maxRenderedOptions: 12,
    }),
    Prec.highest(
      keymap.of(
        [...completionKeymap, { key: 'Tab', run: acceptCompletion }].map((binding) => ({
          ...binding,
          run:
            binding.run &&
            ((view) => {
              if (composing || view.compositionStarted) return false;
              const vim = getCM(view)?.state.vim;
              return vim && !vim.insertMode ? false : binding.run!(view);
            }),
        })),
      ),
    ),
  ];
}
