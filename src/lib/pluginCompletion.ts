import { syntaxTree } from '@codemirror/language';
import {
  CompletionContext,
  pickedCompletion,
  type Completion,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { PluginCompletionInvoke } from './pluginTypes';
import type { Workspace } from './types';

const token = /^[\p{L}\p{N}\p{M}_-]*/u;

export function pluginCompletionRange(context: CompletionContext, trigger: string, composing = () => false) {
  if (!context.state.selection.main.empty && !composing()) return null;
  const pos = composing() ? context.state.selection.main.to : context.pos;
  const line = context.state.doc.lineAt(pos);
  const before = context.state.doc.sliceString(line.from, pos);
  const index = before.lastIndexOf(trigger);
  if (index < 0 || (index > 0 && !/[\s([{"'“‘>*~]/u.test(before[index - 1]))) return null;
  const wiki = /\[\[[^\]\n]*$/.exec(before);
  if (wiki) {
    const slashes = before.slice(0, wiki.index).match(/\\+$/)?.[0].length ?? 0;
    if (index !== wiki.index + 2 || slashes % 2) return null;
  }
  for (let node = syntaxTree(context.state).resolveInner(pos, -1); node; node = node.parent!) {
    // Lezer parses the inner [target] of a closed wiki link as a shortcut Link.
    if (
      node.name === 'Link' &&
      !(
        wiki &&
        node.from === line.from + wiki.index + 1 &&
        node.getChildren('LinkMark').length === 2 &&
        context.state.doc.sliceString(node.to, node.to + 1) === ']'
      )
    )
      return null;
    if (
      [
        'Frontmatter',
        'FencedCode',
        'CodeBlock',
        'InlineCode',
        'Autolink',
        'Image',
        'HTMLBlock',
        'HTMLTag',
        'CommentBlock',
        'Comment',
        'Escape',
      ].includes(node.name)
    )
      return null;
  }
  const query = before.slice(index + trigger.length);
  if (token.exec(query)?.[0] !== query || new TextEncoder().encode(query).length > 256) return null;
  return { from: line.from + index, to: pos, query };
}

export function pluginCompletionProviders(
  context: CompletionContext,
  workspace: Workspace,
  composing = () => false,
) {
  return workspace.extensions.flatMap((extension) => {
    const status = workspace.pluginStates?.find((item) => item.id === extension.id && item.enabled);
    if (!status || !extension.runtime?.permissions.includes('editor.write')) return [];
    return (extension.runtime.completions ?? []).flatMap((provider) => {
      const range = pluginCompletionRange(context, provider.trigger, composing);
      return range ? [{ pluginId: extension.id, digest: status.digest, provider, range }] : [];
    });
  });
}

// Only an explicit completion acceptance edits text; typing, blur and plugin responses do not.
export async function pluginCompletions(
  context: CompletionContext,
  workspace: () => Workspace,
  invoke: PluginCompletionInvoke | undefined,
  composing = () => false,
): Promise<CompletionResult | null> {
  if (!invoke) return null;
  const original = workspace();
  const requests = pluginCompletionProviders(context, original, composing);
  if (!requests.length) return null;
  context.addEventListener('abort', () => {}, { onDocChange: true });
  const from = requests[0].range.from;
  const responses = await Promise.all(
    requests
      .filter((request) => request.range.from === from)
      .map(async (request) => {
        const { pluginId, provider, range } = request;
        const active = () => {
          const current = workspace();
          return (
            current.path === original.path &&
            current.pluginStates?.some(
              (status) => status.id === pluginId && status.enabled && status.digest === request.digest,
            ) &&
            current.extensions.some(
              (extension) =>
                extension.id === pluginId &&
                extension.runtime?.permissions.includes('editor.write') &&
                extension.runtime.completions?.some(
                  (item) => item.id === provider.id && item.trigger === provider.trigger,
                ),
            )
          );
        };
        const items = await invoke(pluginId, provider.id, range.query);
        if (context.aborted || !active()) return [];
        return items.map((item) => ({
          label: item.label,
          detail: item.detail,
          apply: ((view, completion, start, end) => {
            if (composing() || view.compositionStarted || !active()) return;
            const current = pluginCompletionRange(
              new CompletionContext(view.state, view.state.selection.main.head, false),
              provider.trigger,
            );
            if (!current || current.from !== start || current.to !== end || current.query !== range.query)
              return;
            const tail = view.state.doc.sliceString(end, view.state.doc.lineAt(end).to);
            view.dispatch({
              changes: {
                from: start,
                to: end + (token.exec(tail)?.[0].length ?? 0),
                insert: item.insertText,
              },
              selection: { anchor: start + item.insertText.length },
              userEvent: 'input.complete',
              annotations: pickedCompletion.of(completion),
            });
          }) satisfies Exclude<Completion['apply'], string | undefined>,
        }));
      }),
  );
  return context.aborted
    ? null
    : { from, to: requests[0].range.to, filter: false, options: responses.flat().slice(0, 100) };
}
