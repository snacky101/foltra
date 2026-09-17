import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { decodeString } from 'micromark-util-decode-string';
import { splitWikiLink } from './wikiLinks';

export interface ParsedEditorLink {
  kind: 'wiki' | 'markdown';
  target: string;
  label: string;
  from: number;
  to: number;
}

interface LinkHandlers {
  openWiki: (target: string) => void;
  openMarkdown: (target: string) => void;
}

const excludedNodes = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'Image']);

function excluded(node: SyntaxNode): boolean {
  for (let parent: SyntaxNode | null = node; parent; parent = parent.parent) {
    if (excludedNodes.has(parent.name)) return true;
  }
  return false;
}

/** Read the parser's URL range, so parentheses, angle destinations and titles stay unambiguous. */
export function markdownLink(state: EditorState, node: SyntaxNode): ParsedEditorLink | null {
  if (!['Link', 'Autolink'].includes(node.name) || excluded(node)) return null;
  const url = node.getChild('URL');
  if (!url) return null;
  let target = state.doc.sliceString(url.from, url.to);
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  // CommonMark decodes escapes/entities in destinations, but autolinks keep them literal.
  if (node.name === 'Link') target = decodeString(target);
  const marks = node.getChildren('LinkMark');
  const label =
    node.name === 'Autolink'
      ? target
      : decodeString(state.doc.sliceString(marks[0].to, marks[1].from)).replace(/\s*\n\s*/g, ' ');
  if (node.name === 'Autolink' && !/^[\w+.-]+:/.test(target) && target.includes('@')) {
    target = `mailto:${target}`;
  }
  return { kind: 'markdown', target, label, from: node.from, to: node.to };
}

function wikiLink(state: EditorState, node: SyntaxNode): ParsedEditorLink | null {
  if (node.name !== 'Link' || excluded(node)) return null;
  const wrapped =
    node.from > 0 &&
    state.doc.sliceString(node.from - 1, node.from) === '[' &&
    state.doc.sliceString(node.to, node.to + 1) === ']';
  const from = wrapped ? node.from - 1 : node.from;
  const to = wrapped ? node.to + 1 : node.to;
  const slashes = state.doc.sliceString(state.doc.lineAt(from).from, from).match(/\\+$/)?.[0].length ?? 0;
  if (slashes % 2) return null;
  const match = state.doc.sliceString(from, to).match(/^\[\[([^\]\n]+)\]\]$/);
  if (!match) return null;
  const [target, label] = splitWikiLink(match[1]);
  return { kind: 'wiki', target, label, from, to };
}

export function linkAt(state: EditorState, position: number): ParsedEditorLink | null {
  let link: ParsedEditorLink | null = null;
  syntaxTree(state).iterate({
    from: Math.max(0, position - 1),
    to: Math.min(state.doc.length, position + 1),
    enter(node) {
      if (excludedNodes.has(node.name)) return false;
      if (!['Link', 'Autolink'].includes(node.name)) return;
      const found = wikiLink(state, node.node) ?? markdownLink(state, node.node);
      if (found && position >= found.from && position < found.to) link = found;
      return false;
    },
  });
  return link;
}

export function wikiLinkAt(state: EditorState, position: number): string | null {
  const link = linkAt(state, position);
  return link?.kind === 'wiki' ? link.target : null;
}

function openEditorLink(link: ParsedEditorLink, handlers: LinkHandlers) {
  if (link.kind === 'wiki') handlers.openWiki(link.target);
  else handlers.openMarkdown(link.target);
}

export function followEditorLink(state: EditorState, handlers: LinkHandlers): boolean {
  if (state.selection.ranges.length !== 1) return false;
  const link = linkAt(state, state.selection.main.head);
  if (!link) return false;
  openEditorLink(link, handlers);
  return true;
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

export function editorLinkNavigation(handlers: LinkHandlers) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false;
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const link = position === null ? null : linkAt(view.state, position);
      if (!link) return false;
      event.preventDefault();
      openEditorLink(link, handlers);
      return true;
    },
  });
}
