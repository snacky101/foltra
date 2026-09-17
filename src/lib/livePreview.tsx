import { noteTags } from './noteTags';
import { isQueryLanguage } from './sqlQuery';
import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, gutterLineClass, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { livePreviewLayout, livePreviewGutterMarkers } from './livePreviewLayout';
import { livePreviewLists } from './livePreviewLists';
import { markdownTable } from './markdownTables';
import { TablePreview, tableNavigation } from './livePreviewTable';
import { createRoot, type Root } from 'react-dom/client';
import { NotePreview } from '../components/NotePreview';
import { AttachmentImage } from '../components/AttachmentImage';
import { attachmentPath } from './attachments';
import { canCreateWikiNote, resolveWikiNote, splitWikiLink } from './wikiLinks';
import { markdownLink } from './wikiLinkNavigation';
import { externalLinkUrl } from './openExternalLink';
import type { Workspace } from './types';

interface Context {
  workspace: Workspace;
  openNote: (id: string) => void;
  openTag?: (tag: string) => void;
  openLink: (target: string) => void;
  openMarkdownLink?: (target: string) => void;
}
export const refreshLivePreview = StateEffect.define<null>();
export const focusLivePreview = StateEffect.define<boolean>();

export function selectionTouchesLines(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some((range) => {
    const start = state.doc.lineAt(range.from).from;
    const end = state.doc.lineAt(range.empty ? range.to : range.to - 1).to;
    return start <= to && end >= from;
  });
}

class BlockPreview extends WidgetType {
  private static mounted = new WeakMap<HTMLElement, { root: Root; observer: ResizeObserver }>();
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
    const observer = new ResizeObserver(() => view.requestMeasure());
    observer.observe(dom);
    BlockPreview.mounted.set(dom, { root: createRoot(dom), observer });
    this.updateDOM(dom, view);
    return dom;
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    const mounted = BlockPreview.mounted.get(dom);
    if (!mounted) return false;
    dom.onmousedown = (event) => {
      if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
      view.focus();
    };
    mounted.root.render(
      <NotePreview
        body={this.body}
        workspace={this.context.workspace}
        openNote={this.context.openNote}
        openLink={this.context.openLink}
        openTag={this.context.openTag}
      />,
    );
    return true;
  }
  destroy(dom: HTMLElement) {
    const mounted = BlockPreview.mounted.get(dom);
    if (!mounted) return;
    mounted.observer.disconnect();
    BlockPreview.mounted.delete(dom);
    // CodeMirror can be destroyed inside a React commit; defer this separate root's cleanup.
    queueMicrotask(() => mounted.root.unmount());
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
    const name = this.target.split('#')[0];
    const missing =
      this.wiki && !resolveWikiNote(this.context.workspace.notes, name) && !name.startsWith('record:');
    if (missing) dom.classList.add('unresolved');
    dom.textContent = this.label;
    dom.setAttribute('role', 'link');
    dom.title =
      missing && canCreateWikiNote(this.context.workspace.notes, name)
        ? `“${name}” 노트 만들기`
        : '연결 열기';
    dom.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      // Keep a plain click from moving the caret into the source and replacing
      // this widget before the browser delivers its click event.
      if (event.shiftKey) {
        view.dispatch({ selection: { anchor: view.state.selection.main.anchor, head: this.from } });
        view.focus();
      }
    });
    dom.addEventListener('click', (event) => {
      if (event.button !== 0 || event.shiftKey) return;
      event.preventDefault();
      if (this.wiki) this.context.openLink(name);
      else this.context.openMarkdownLink?.(this.target);
    });
    return dom;
  }
  ignoreEvent() {
    return true;
  }
}

class ImagePreview extends WidgetType {
  private static mounted = new WeakMap<HTMLElement, { root: Root; observer: ResizeObserver }>();
  constructor(
    readonly source: string,
    readonly alt: string,
    readonly from: number,
    readonly vault: string,
  ) {
    super();
  }
  eq(other: ImagePreview) {
    return (
      this.source === other.source &&
      this.alt === other.alt &&
      this.from === other.from &&
      this.vault === other.vault
    );
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('span');
    dom.className = 'cm-live-image';
    dom.title = '클릭하여 이미지 링크 편집';
    const root = createRoot(dom);
    const observer = new ResizeObserver(() => view.requestMeasure());
    observer.observe(dom);
    ImagePreview.mounted.set(dom, { root, observer });
    this.updateDOM(dom, view);
    return dom;
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    const mounted = ImagePreview.mounted.get(dom);
    if (!mounted) return false;
    dom.onmousedown = (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    };
    mounted.root.render(<AttachmentImage vault={this.vault} source={this.source} alt={this.alt} />);
    return true;
  }
  destroy(dom: HTMLElement) {
    const mounted = ImagePreview.mounted.get(dom);
    if (!mounted) return;
    mounted.observer.disconnect();
    ImagePreview.mounted.delete(dom);
    queueMicrotask(() => mounted.root.unmount());
  }
  ignoreEvent() {
    return true;
  }
}

export function livePreviewDecorations(state: EditorState, context: Context, focused = true): DecorationSet {
  const ranges: Range<Decoration>[] = livePreviewLayout(
    state,
    (from, to) => focused && selectionTouchesLines(state, from, to),
  );
  const hidden = Decoration.replace({});
  ranges.push(...livePreviewLists(state));
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
      const active = focused && selectionTouchesLines(state, from, to);
      if (name === 'FencedCode') {
        const info = node.node.getChild('CodeInfo');
        const language = info ? state.doc.sliceString(info.from, info.to).trim().split(/\s+/)[0] : '';
        // Code remains real editor lines, so arrows, Vim motions, selection and
        // mouse placement can enter it without jumping over a block widget.
        // Executable queries retain their separate result preview below.
        if (!isQueryLanguage(language)) {
          const first = state.doc.lineAt(from).number;
          const last = state.doc.lineAt(to).number;
          for (let number = first; number <= last; number++) {
            const line = state.doc.line(number);
            styleLine(line.from, 'cm-live-code-line');
            if (number === first) styleLine(line.from, 'cm-live-code-start');
            if (number === last) styleLine(line.from, 'cm-live-code-end');
          }
          if (!active) {
            for (const mark of node.node.getChildren('CodeMark')) {
              // Keep the fence's geometry as the code panel's padding. Revealing
              // it must not shift the code or move the cursor to another row.
              ranges.push(
                Decoration.mark({ class: 'cm-live-code-fence-hidden' }).range(
                  mark.from,
                  state.doc.lineAt(mark.to).to,
                ),
              );
            }
          }
          return false;
        }
      }
      if (name === 'Table') {
        ranges.push(
          Decoration.replace({
            block: true,
            widget: new TablePreview(markdownTable(state, node.node), context),
          }).range(from, to),
        );
        return false;
      }
      if (name === 'FencedCode' || name === 'HorizontalRule') {
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
      if (name === 'Image') {
        const url = node.node.getChild('URL');
        const source = url ? state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, '') : '';
        if (!active && attachmentPath(source)) {
          const alt = state.doc.sliceString(from, to).match(/^!\[([^\]]*)\]/)?.[1] ?? '';
          ranges.push(
            Decoration.replace({ widget: new ImagePreview(source, alt, from, context.workspace.path) }).range(
              from,
              to,
            ),
          );
        }
        return false;
      }
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
      if (name === 'Link') {
        const raw = state.doc.sliceString(from, to);
        // CommonMark parses the inner pair of brackets in [[target]] as a Link.
        const wrapped =
          from > 0 &&
          state.doc.sliceString(from - 1, from) === '[' &&
          state.doc.sliceString(to, to + 1) === ']';
        const wiki = (wrapped ? state.doc.sliceString(from - 1, to + 1) : raw).match(/^\[\[([^\]\n]+)\]\]$/);
        const markdown = wiki ? null : markdownLink(state, node.node);
        const regular = markdown && externalLinkUrl(markdown.target) ? markdown : null;
        if (wiki || regular) {
          const start = wiki && wrapped ? from - 1 : from;
          const end = wiki && wrapped ? to + 1 : to;
          const editing =
            focused &&
            state.selection.ranges.some((range) =>
              range.empty ? range.head >= start && range.head < end : range.from < end && range.to > start,
            );
          if (editing) return false;
          const slashes =
            state.doc.sliceString(state.doc.lineAt(start).from, start).match(/\\+$/)?.[0].length ?? 0;
          if (slashes % 2) return false;
          const [target, label] = wiki ? splitWikiLink(wiki[1]) : [regular!.target, regular!.label];
          ranges.push(
            Decoration.replace({ widget: new LinkPreview(label, target, start, !!wiki, context) }).range(
              start,
              end,
            ),
          );
          return false;
        }
      }
      if (active) return;
      if (['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark', 'QuoteMark'].includes(name)) {
        let end = to;
        if (name === 'HeaderMark' || name === 'QuoteMark') {
          if (state.doc.sliceString(to, to + 1) === ' ') end++;
        }
        // Replacements never include a line break unless they are explicit block widgets above.
        if (!state.doc.sliceString(from, end).includes('\n')) ranges.push(hidden.range(from, end));
      }
    },
  });
  for (const marker of state.doc.toString().matchAll(/ <!-- foltra-anki:[a-f0-9-]{36} -->/g)) {
    const from = marker.index,
      to = from + marker[0].length;
    if (focused && selectionTouchesLines(state, from, to)) continue;
    let node = syntaxTree(state).resolveInner(from, 1);
    let literal = false;
    for (;;) {
      if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) literal = true;
      if (!node.parent) break;
      node = node.parent;
    }
    if (!literal) ranges.push(hidden.range(from, to));
  }
  for (const tag of noteTags(state.doc.toString(), syntaxTree(state))) {
    const editing = focused && state.selection.ranges.some((r) => r.from <= tag.to && r.to >= tag.from);
    ranges.push(
      Decoration.mark({
        class: `tag-chip${editing ? ' tag-chip-editing' : ''}`,
        attributes: { 'data-note-tag': tag.name, title: 'Cmd/Ctrl+클릭: 같은 태그의 노트 찾기' },
      }).range(tag.from, tag.to),
    );
  }
  for (const [from, styles] of lineStyles)
    ranges.push(Decoration.line({ class: [...styles].join(' ') }).range(from));
  return Decoration.set(ranges, true);
}

export function livePreviewExtension(context: () => Context, initiallyFocused = false) {
  const field = StateField.define<{ focused: boolean; decorations: DecorationSet }>({
    create: (state) => ({
      focused: initiallyFocused,
      decorations: livePreviewDecorations(state, context(), initiallyFocused),
    }),
    update(value, transaction) {
      let focused = value.focused;
      for (const effect of transaction.effects) if (effect.is(focusLivePreview)) focused = effect.value;
      return transaction.docChanged ||
        transaction.selection ||
        focused !== value.focused ||
        transaction.effects.some((effect) => effect.is(refreshLivePreview)) ||
        syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
        ? { focused, decorations: livePreviewDecorations(transaction.state, context(), focused) }
        : value;
    },
    provide: (field) => [
      EditorView.decorations.from(field, (value) => value.decorations),
      gutterLineClass.from(field, (value) => livePreviewGutterMarkers(value.decorations)),
    ],
  });
  return [
    field,
    tableNavigation,
    EditorView.domEventHandlers({
      mousedown(event) {
        const tag = (event.target as HTMLElement).closest<HTMLElement>('[data-note-tag]')?.dataset.noteTag;
        if (tag && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          context().openTag?.(tag);
          return true;
        }
        return false;
      },
    }),
    EditorView.editorAttributes.of({ class: 'cm-live-preview' }),
    EditorView.focusChangeEffect.of((_state, focused) => focusLivePreview.of(focused)),
  ];
}
