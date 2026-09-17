import type { EditorState, Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { createRoot, type Root } from 'react-dom/client';
import { FrontmatterPanel } from '../components/FrontmatterPanel';
import { frontmatterBlock, frontmatterRange } from './frontmatter';

class FrontmatterPreview extends WidgetType {
  private static mounted = new WeakMap<HTMLElement, { root: Root; observer: ResizeObserver }>();
  constructor(
    readonly source: string,
    readonly to: number,
  ) {
    super();
  }
  eq(other: FrontmatterPreview) {
    return this.source === other.source && this.to === other.to;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = 'cm-frontmatter-panel';
    const observer = new ResizeObserver(() => view.requestMeasure());
    observer.observe(dom);
    FrontmatterPreview.mounted.set(dom, { root: createRoot(dom), observer });
    this.updateDOM(dom, view);
    return dom;
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    const mounted = FrontmatterPreview.mounted.get(dom);
    if (!mounted) return false;
    mounted.root.render(
      <FrontmatterPanel
        source={this.source}
        onEditSource={() => {
          view.dispatch({
            selection: { anchor: view.state.doc.line(2).from },
            scrollIntoView: true,
          });
          view.focus();
        }}
        onChange={(yaml) => {
          // Read the current range: an unrelated edit may have moved the end since rendering.
          const current = frontmatterRange(view.state.doc.toString());
          if (!current || current.yaml !== this.source)
            throw new Error('속성이 변경되었습니다. 최신 내용을 확인해 주세요.');
          view.dispatch({
            changes: { from: 0, to: current.to, insert: frontmatterBlock(yaml) },
            userEvent: 'input',
          });
        }}
      />,
    );
    return true;
  }
  destroy(dom: HTMLElement) {
    const mounted = FrontmatterPreview.mounted.get(dom);
    if (!mounted) return;
    mounted.observer.disconnect();
    FrontmatterPreview.mounted.delete(dom);
    queueMicrotask(() => mounted.root.unmount());
  }
  ignoreEvent() {
    return true;
  }
}

export function frontmatterDecorations(state: EditorState): Range<Decoration>[] {
  const frontmatter = frontmatterRange(state.doc.toString());
  if (!frontmatter) return [];
  // Source visibility follows the document selection. Moving focus from a widget
  // button to the editor must not collapse the source again during blur events.
  const editing = state.selection.ranges.some((range) => range.from <= frontmatter.to);
  if (!editing)
    return [
      Decoration.replace({
        block: true,
        widget: new FrontmatterPreview(frontmatter.yaml, frontmatter.to),
      }).range(0, frontmatter.to),
    ];
  const result: Range<Decoration>[] = [];
  for (let number = 1; number <= state.doc.lineAt(frontmatter.to).number; number++)
    result.push(Decoration.line({ class: 'cm-frontmatter-source' }).range(state.doc.line(number).from));
  return result;
}
