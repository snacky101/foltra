import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { splitWikiLink } from './wikiLinks';

export function wikiLinkAt(state: EditorState, position: number): string | null {
  let target: string | null = null;
  syntaxTree(state).iterate({
    from: Math.max(0, position - 1),
    to: Math.min(state.doc.length, position + 1),
    enter(node) {
      if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock'].includes(node.name)) return false;
      if (node.name !== 'Link') return;
      const wrapped =
        node.from > 0 &&
        state.doc.sliceString(node.from - 1, node.from) === '[' &&
        state.doc.sliceString(node.to, node.to + 1) === ']';
      const from = wrapped ? node.from - 1 : node.from;
      const to = wrapped ? node.to + 1 : node.to;
      const slashes = state.doc.sliceString(state.doc.lineAt(from).from, from).match(/\\+$/)?.[0].length ?? 0;
      if (slashes % 2) return false;
      const match = state.doc.sliceString(from, to).match(/^\[\[([^\]\n]+)\]\]$/);
      if (match && position >= from && position < to) target = splitWikiLink(match[1])[0];
      return false;
    },
  });
  return target;
}

export function followWikiLink(state: EditorState, openLink: (target: string) => void): boolean {
  if (state.selection.ranges.length !== 1) return false;
  const target = wikiLinkAt(state, state.selection.main.head);
  if (!target) return false;
  openLink(target);
  return true;
}

export function wikiLinkNavigation(openLink: (target: string) => void) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false;
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const target = position === null ? null : wikiLinkAt(view.state, position);
      if (!target) return false;
      event.preventDefault();
      openLink(target);
      return true;
    },
  });
}
