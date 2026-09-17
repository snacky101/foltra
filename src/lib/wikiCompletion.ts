import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { pickedCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { canCreateWikiNote, unresolvedWikiNames, wikiNoteReference } from './wikiLinks';
import type { Workspace } from './types';

const searchKey = (text: string) => text.normalize('NFKD').toLocaleLowerCase();

export function wikiCompletionEdit(
  state: EditorState,
  from: number,
  to: number,
  target: string,
  alias?: string,
) {
  const tail = state.doc.sliceString(to, state.doc.lineAt(to).to);
  const ending = tail.match(/^([^\[\]\n]*)(\]\]?)/);
  const end = ending ? to + ending[0].length : to;
  const inside = state.doc.sliceString(from, ending ? to + ending[1].length : to);
  const suffix = inside.slice(inside.search(/[#|]/) < 0 ? inside.length : inside.search(/[#|]/));
  const insert = target + suffix + (alias && !suffix.includes('|') ? `|${alias}` : '') + ']]';
  return {
    changes: { from, to: end, insert },
    selection: { anchor: from + insert.length },
    userEvent: 'input.complete',
  };
}

export function wikiCompletions(
  context: CompletionContext,
  workspace: Workspace,
  composing = () => context.view?.composing ?? false,
): CompletionResult | null {
  if (!context.state.selection.main.empty && !composing()) return null;
  const pos = composing() ? context.state.selection.main.to : context.pos;
  for (let node = syntaxTree(context.state).resolveInner(pos, -1); node; node = node.parent!) {
    if (
      ['Frontmatter', 'FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'CommentBlock'].includes(
        node.name,
      )
    )
      return null;
  }
  const line = context.state.doc.lineAt(pos);
  const before = context.state.doc.sliceString(line.from, pos);
  const match = /\[\[([^\[\]|#\n]*)$/.exec(before);
  if (!match) return null;
  const slashes = before.slice(0, match.index).match(/\\+$/)?.[0].length ?? 0;
  if (slashes % 2) return null;
  const from = line.from + match.index + 2;
  const search = searchKey(match[1]);
  const candidates: {
    label: string;
    detail: string;
    target?: string;
    alias?: string;
    note?: Workspace['notes'][number];
  }[] = workspace.notes.map((note) => ({
    label: note.title,
    detail: '노트',
    note,
  }));
  if (workspace.settings.showUnresolvedLinks) {
    candidates.push(
      ...unresolvedWikiNames(workspace).map((name) => ({
        label: name,
        target: name,
        alias: undefined,
        detail: '미생성 링크',
      })),
    );
  }
  if (
    canCreateWikiNote(workspace.notes, match[1]) &&
    !candidates.some((candidate) => candidate.target === match[1])
  ) {
    candidates.push({
      label: match[1],
      target: match[1],
      alias: undefined,
      detail: '링크만 추가 · 열 때 생성',
    });
  }
  return {
    from,
    to: pos,
    filter: false,
    // Recompute synchronously so typing/composition filters the open popup in place.
    update: (_current, _from, _to, next) => wikiCompletions(next, workspace, composing),
    options: candidates
      .filter((candidate) => searchKey(candidate.label).includes(search))
      .sort(
        (a, b) =>
          Number(a.detail === '링크만 추가 · 열 때 생성') - Number(b.detail === '링크만 추가 · 열 때 생성') ||
          Number(searchKey(b.label).startsWith(search)) - Number(searchKey(a.label).startsWith(search)) ||
          a.label.localeCompare(b.label),
      )
      .slice(0, 100)
      .map(({ label, note, target, alias, detail }) => {
        // Only displayed candidates need whole-vault ambiguity checks. Keep the
        // complete note list so duplicates outside the result limit remain safe.
        const reference = note ? wikiNoteReference(workspace.notes, note) : { target: target!, alias };
        return {
          label,
          detail:
            note && workspace.notes.filter((n) => n.title === label).length > 1
              ? `${workspace.folders.find((folder) => folder.id === note.folderId)?.name ?? 'Vault'} · ${note.id.slice(0, 8)}`
              : detail,
          apply: (view, completion, start, end) =>
            view.dispatch({
              ...wikiCompletionEdit(view.state, start, end, reference.target, reference.alias),
              annotations: pickedCompletion.of(completion),
            }),
        };
      }),
  };
}
