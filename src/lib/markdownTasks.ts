import type { StateCommand } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { isolateHistory } from '@codemirror/commands';

export const taskMarkers = [
  { marker: ' ', status: 'todo', label: '할 일' },
  { marker: '/', status: 'doing', label: '진행 중' },
  { marker: 'x', status: 'done', label: '완료' },
  { marker: 'b', status: 'bookmark', label: '북마크' },
  { marker: '-', status: 'cancelled', label: '취소' },
  { marker: '>', status: 'deferred', label: '미룸' },
  { marker: '?', status: 'question', label: '질문' },
  { marker: '!', status: 'important', label: '중요' },
  { marker: '*', status: 'star', label: '별표' },
  { marker: 'i', status: 'info', label: '정보' },
  { marker: 'p', status: 'pin', label: '핀' },
] as const;

export type TaskStatus = (typeof taskMarkers)[number]['status'];

export function taskStatus(marker: string): TaskStatus | null {
  return taskMarkers.find((item) => item.marker === marker.toLowerCase())?.status ?? null;
}

// Prefixes are recognized only after a parsed list marker, never in arbitrary text.
export function taskPrefix(text: string) {
  const match = /^\[([^\]\r\n])\](?=[ \t]|$)/.exec(text);
  const status = match && taskStatus(match[1]);
  // Bare markers remain editable commands; rendering also requires a separator.
  return match && status
    ? {
        marker: match[1],
        status,
        length: match[0].length,
        hasSeparator: /^[ \t]/.test(text.slice(match[0].length)),
      }
    : null;
}

export const cycleMarkdownTask: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const lines = new Set(state.selection.ranges.map((range) => state.doc.lineAt(range.head).number));
  const marks = new Map<number, number>();
  const tree = ensureSyntaxTree(state, state.doc.line(Math.max(...lines)).to, 50) ?? syntaxTree(state);
  tree.iterate({
    enter({ node, name, from, to }) {
      if (['Frontmatter', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'Table'].includes(name)) return false;
      const number = state.doc.lineAt(from).number;
      if (
        name === 'ListMark' &&
        lines.has(number) &&
        node.parent?.parent?.name === 'BulletList' &&
        !['CodeBlock', 'FencedCode', 'HTMLBlock', 'Table'].includes(node.nextSibling?.name ?? '')
      )
        marks.set(number, to);
    },
  });
  const changes = [...marks].map(([number, end]) => {
    const rest = state.doc.sliceString(end, state.doc.line(number).to);
    const space = /^[ \t]*/.exec(rest)![0];
    const task = taskPrefix(rest.slice(space.length));
    if (task) {
      const next = task.status === 'todo' ? '/' : task.status === 'doing' ? 'x' : ' ';
      return { from: end + space.length + 1, to: end + space.length + 2, insert: next };
    }
    return { from: end + space.length, insert: `${space ? '' : ' '}[ ] ` };
  });
  if (!changes.length) return false;
  const changeSet = state.changes(changes.sort((a, b) => a.from - b.from));
  dispatch(
    state.update({
      changes: changeSet,
      selection: state.selection.map(changeSet, 1),
      annotations: isolateHistory.of('full'),
      userEvent: 'input.task',
      scrollIntoView: true,
    }),
  );
  return true;
};
