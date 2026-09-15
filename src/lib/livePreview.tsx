import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { createRoot, type Root } from 'react-dom/client';
import { NotePreview } from '../components/NotePreview';
import { resolveWikiNote, splitWikiLink } from './wikiLinks';
import type { Workspace } from './types';

interface Context {
  workspace: Workspace;
  openNote: (id: string) => void;
}
export const refreshLivePreview = StateEffect.define<null>();

export function selectionTouchesLines(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some((range) => {
    const start = state.doc.lineAt(range.from).from;
    const end = state.doc.lineAt(range.to).to;
    return start <= to && end >= from;
  });
}

class BlockPreview extends WidgetType {
  private root?: Root;
  constructor(
    readonly body: string,
    readonly from: number,
    readonly context: Context,
  ) {
    super();
  }
  eq(other: BlockPreview) {
    return (
      this.body === other.body &&
      this.from === other.from &&
      this.context.workspace === other.context.workspace
    );
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = 'cm-live-block';
    dom.title = '클릭하여 Markdown 원문 편집';
    dom.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
      view.focus();
    });
    this.root = createRoot(dom);
    this.root.render(
      <NotePreview body={this.body} workspace={this.context.workspace} openNote={this.context.openNote} />,
    );
    return dom;
  }
  destroy() {
    const root = this.root;
    // CodeMirror can be destroyed inside a React commit; defer this separate root's cleanup.
    queueMicrotask(() => root?.unmount());
  }
  ignoreEvent() {
    return true;
  }
}

class LinkPreview extends WidgetType {
  constructor(
    readonly label: string,
    readonly target: string,
    readonly from: number,
    readonly wiki: boolean,
    readonly context: Context,
  ) {
    super();
  }
  eq(other: LinkPreview) {
    return (
      this.label === other.label &&
      this.target === other.target &&
      this.from === other.from &&
      this.wiki === other.wiki &&
      this.context.workspace === other.context.workspace
    );
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('span');
    dom.className = 'cm-live-link';
    dom.textContent = this.label;
    dom.title = '클릭: 편집 · Cmd/Ctrl+클릭: 연결 열기';
    dom.addEventListener('mousedown', (event) => {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        if (this.wiki) {
          const target = this.target.split('#')[0];
          const note = resolveWikiNote(this.context.workspace.notes, target);
          const record = target.startsWith('record:')
            ? this.context.workspace.records.find((row) => row.id === target.slice(7))
            : undefined;
          const id = note?.id ?? record?.bodyNoteId;
          if (id) this.context.openNote(id);
        } else if (/^https?:\/\//i.test(this.target)) {
          window.open(this.target, '_blank', 'noopener,noreferrer');
        }
        return;
      }
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return dom;
  }
  ignoreEvent() {
    return true;
  }
}

export function livePreviewDecorations(state: EditorState, context: Context): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const hidden = Decoration.replace({});
  const lineStyles = new Map<number, Set<string>>();
  const styleLine = (at: number, name: string) => {
    const from = state.doc.lineAt(at).from;
    const styles = lineStyles.get(from) ?? new Set<string>();
    styles.add(name);
    lineStyles.set(from, styles);
  };
  syntaxTree(state).iterate({
    enter(node) {
      const { from, to, name } = node;
      const active = selectionTouchesLines(state, from, to);
      if (name === 'FencedCode' || name === 'Table' || name === 'HorizontalRule') {
        if (!active)
          ranges.push(
            Decoration.replace({
              block: true,
              widget: new BlockPreview(state.doc.sliceString(from, to), from, context),
            }).range(from, to),
          );
        return false;
      }
      if (name === 'CodeBlock' || name === 'HTMLBlock') return false;
      if (/^(ATX|Setext)Heading[1-6]$/.test(name)) styleLine(from, `cm-live-heading cm-live-h${name.at(-1)}`);
      if (name === 'Blockquote') {
        for (let line = state.doc.lineAt(from).number; line <= state.doc.lineAt(to).number; line++)
          styleLine(state.doc.line(line).from, 'cm-live-quote');
      }
      const className = (
        {
          StrongEmphasis: 'cm-live-strong',
          Emphasis: 'cm-live-emphasis',
          Strikethrough: 'cm-live-strike',
          InlineCode: 'cm-live-code',
        } as Record<string, string>
      )[name];
      if (className) ranges.push(Decoration.mark({ class: className }).range(from, to));
      if (active) return;
      if (name === 'Link') {
        const raw = state.doc.sliceString(from, to);
        // CommonMark parses the inner pair of brackets in [[target]] as a Link.
        const wrapped =
          from > 0 &&
          state.doc.sliceString(from - 1, from) === '[' &&
          state.doc.sliceString(to, to + 1) === ']';
        const wiki = (wrapped ? state.doc.sliceString(from - 1, to + 1) : raw).match(/^\[\[([^\]\n]+)\]\]$/);
        const regular = raw.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
        if (wiki || regular) {
          const start = wiki && wrapped ? from - 1 : from;
          const end = wiki && wrapped ? to + 1 : to;
          const [target, label] = wiki ? splitWikiLink(wiki[1]) : [regular![2], regular![1]];
          ranges.push(
            Decoration.replace({ widget: new LinkPreview(label, target, start, !!wiki, context) }).range(
              start,
              end,
            ),
          );
          return false;
        }
      }
      if (['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark', 'QuoteMark'].includes(name)) {
        let end = to;
        if (name === 'HeaderMark' || name === 'QuoteMark') {
          if (state.doc.sliceString(to, to + 1) === ' ') end++;
        }
        // Replacements never include a line break unless they are explicit block widgets above.
        if (!state.doc.sliceString(from, end).includes('\n')) ranges.push(hidden.range(from, end));
      }
      if (name === 'ListMark') ranges.push(Decoration.mark({ class: 'cm-live-list-marker' }).range(from, to));
    },
  });
  for (const [from, styles] of lineStyles)
    ranges.push(Decoration.line({ class: [...styles].join(' ') }).range(from));
  return Decoration.set(ranges, true);
}

export function livePreviewExtension(context: () => Context) {
  return StateField.define<DecorationSet>({
    create: (state) => livePreviewDecorations(state, context()),
    update: (decorations, transaction) =>
      transaction.docChanged ||
      transaction.selection ||
      transaction.effects.some((effect) => effect.is(refreshLivePreview)) ||
      syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
        ? livePreviewDecorations(transaction.state, context())
        : decorations,
    provide: (field) => EditorView.decorations.from(field),
  });
}
