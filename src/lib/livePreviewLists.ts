import type { EditorState, Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, WidgetType } from '@codemirror/view';
import { BlockGap } from './livePreviewLayout';
import { markdownListLayout } from './markdownListLayout';

class ListMarker extends WidgetType {
  constructor(
    readonly marker: string,
    readonly bullet: boolean,
  ) {
    super();
  }
  eq(other: ListMarker) {
    return this.marker === other.marker;
  }
  toDOM() {
    const dom = document.createElement('span');
    dom.className = `cm-live-list-marker${this.bullet ? ' cm-live-bullet' : ''}`;
    dom.textContent = this.bullet ? '\u00a0' : this.marker;
    return dom;
  }
  coordsAt(dom: HTMLElement, pos: number) {
    const range = document.createRange();
    range.selectNodeContents(dom);
    const text = range.getBoundingClientRect();
    const box = dom.getBoundingClientRect();
    const x = pos === 0 ? box.left : box.right;
    return { left: x, right: x, top: text.top, bottom: text.bottom };
  }
  ignoreEvent() {
    return false;
  }
}

// List prefixes keep their Markdown in the document but occupy the same width as reading mode.
export function livePreviewLists(state: EditorState) {
  const ranges: Range<Decoration>[] = [];
  const { lines, separators, paragraphBreaks } = markdownListLayout(
    state.doc,
    syntaxTree(state),
    state.tabSize,
  );
  syntaxTree(state).iterate({
    enter({ name, from, to }) {
      if (['FencedCode', 'CodeBlock', 'Table', 'HTMLBlock', 'HorizontalRule'].includes(name)) return false;
      if (name === 'ListMark') {
        const marker = state.doc.sliceString(from, to);
        const space = state.doc.sliceString(to, state.doc.lineAt(to).to).match(/^[ \t]+/)?.[0].length ?? 0;
        // Keep native caret/IME text outside the fixed-width marker, including empty items.
        if (space)
          ranges.push(
            Decoration.replace({ widget: new ListMarker(marker, /^[-+*]$/.test(marker)) }).range(
              from,
              to + space,
            ),
          );
        return false;
      }
    },
  });
  for (const [number, boundary] of paragraphBreaks)
    ranges.push(
      Decoration.widget({
        widget: new BlockGap(
          boundary === 'beforeList'
            ? 'max(var(--md-paragraph-after), var(--md-list-before))'
            : 'max(var(--md-list-after), var(--md-paragraph-before))',
        ),
        block: true,
        side: -1,
      }).range(state.doc.line(number).from),
    );
  for (const number of separators)
    ranges.push(Decoration.line({ class: 'cm-live-separator' }).range(state.doc.line(number).from));
  for (const [number, { depth, gap, first }] of lines) {
    const line = state.doc.line(number);
    if (!line.text.trim()) continue;
    if (gap && !paragraphBreaks.has(number))
      ranges.push(
        Decoration.widget({
          widget: new BlockGap('var(--md-list-item-gap)'),
          block: true,
          side: -1,
        }).range(line.from),
      );
    ranges.push(
      Decoration.line({
        class: `cm-live-list-line${first ? ' cm-live-list-start' : ''}`,
        attributes: { style: `--cm-list-depth:${depth}` },
      }).range(line.from),
    );
    const indent = line.text.match(/^[ \t]+/)?.[0].length ?? 0;
    if (indent) ranges.push(Decoration.replace({}).range(line.from, line.from + indent));
  }
  return ranges;
}
