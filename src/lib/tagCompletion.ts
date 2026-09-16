import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { pickedCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { noteTags } from './noteTags';

export interface TagSuggestion {
  name: string;
  noteCount: number;
}
const searchKey = (text: string) => text.normalize('NFKD').toLocaleLowerCase();
// Same token grammar as noteTags, allowing an unfinished name or nested segment.
const prefix =
  /(^|[\s([{"'“‘>*~])#((?:[\p{L}\p{N}_][\p{L}\p{N}\p{M}_-]*(?:\/[\p{L}\p{N}_][\p{L}\p{N}\p{M}_-]*)*\/?)?)$/u;
const token = /^[\p{L}\p{N}_][\p{L}\p{N}\p{M}_-]*(?:\/[\p{L}\p{N}_][\p{L}\p{N}\p{M}_-]*)*\/?/u;

export function tagCompletionRange(
  context: CompletionContext,
  composing = () => context.view?.composing ?? false,
) {
  if (!context.state.selection.main.empty && !composing()) return null;
  const pos = composing() ? context.state.selection.main.to : context.pos;
  for (let node = syntaxTree(context.state).resolveInner(pos, -1); node; node = node.parent!) {
    if (
      [
        'FencedCode',
        'CodeBlock',
        'InlineCode',
        'Link',
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
  const line = context.state.doc.lineAt(pos);
  const before = context.state.doc.sliceString(line.from, pos);
  if (/\[\[[^\]\n]*$/.test(before)) return null;
  const match = prefix.exec(before);
  if (!match || [...match[2]].length > 128) return null;
  return { from: line.from + match.index + match[1].length + 1, to: pos, search: searchKey(match[2]) };
}

export function tagCompletionEdit(state: EditorState, from: number, to: number, name: string) {
  const tail = state.doc.sliceString(from, state.doc.lineAt(to).to);
  const end = Math.max(to, from + (token.exec(tail)?.[0].length ?? 0));
  return {
    changes: { from, to: end, insert: name },
    selection: { anchor: from + name.length },
    userEvent: 'input.complete',
  };
}

export function tagCompletions(
  context: CompletionContext,
  tags: TagSuggestion[],
  composing = () => context.view?.composing ?? false,
): CompletionResult | null {
  const range = tagCompletionRange(context, composing);
  if (!range) return null;
  const candidates = new Map(tags.map((tag) => [tag.name, tag]));
  // Include completed tags in the current draft before autosave has refreshed the vault.
  for (const tag of noteTags(context.state.doc.toString(), syntaxTree(context.state))) {
    if (tag.from !== range.from - 1 && !candidates.has(tag.name))
      candidates.set(tag.name, { name: tag.name, noteCount: 0 });
  }
  return result(context, [...candidates.values()], composing);
}

function result(
  context: CompletionContext,
  tags: TagSuggestion[],
  composing: () => boolean,
): CompletionResult | null {
  const range = tagCompletionRange(context, composing);
  if (!range) return null;
  return {
    from: range.from,
    to: range.to,
    filter: false,
    update: (_current, _from, _to, next) => result(next, tags, composing),
    options: tags
      .filter((tag) => searchKey(tag.name).includes(range.search))
      .sort(
        (a, b) =>
          Number(searchKey(b.name).startsWith(range.search)) -
            Number(searchKey(a.name).startsWith(range.search)) || a.name.localeCompare(b.name),
      )
      .slice(0, 100)
      .map(({ name, noteCount }) => ({
        label: `#${name}`,
        detail: noteCount ? `${noteCount}개 노트` : '현재 노트',
        apply: (view, completion, from, to) =>
          view.dispatch({
            ...tagCompletionEdit(view.state, from, to, name),
            annotations: pickedCompletion.of(completion),
          }),
      })),
  };
}
