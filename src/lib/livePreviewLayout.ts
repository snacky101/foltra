import { RangeSet, type EditorState, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, GutterMarker, WidgetType, type DecorationSet } from '@codemirror/view';
import { frontmatterRange } from './frontmatter';

export class BlockGap extends WidgetType {
  constructor(readonly height: string) {
    super();
  }
  eq(other: BlockGap) {
    return this.height === other.height;
  }
  toDOM() {
    const dom = document.createElement('div');
    dom.className = 'cm-live-gap';
    dom.style.height = this.height;
    dom.setAttribute('aria-hidden', 'true');
    return dom;
  }
}

class PreviewGutterLine extends GutterMarker {
  constructor(readonly elementClass: string) {
    super();
  }
  eq(other: PreviewGutterLine) {
    return this.elementClass === other.elementClass;
  }
}

export function livePreviewGutterMarkers(decorations: DecorationSet) {
  const markers: Range<GutterMarker>[] = [];
  for (let cursor = decorations.iter(); cursor.value; cursor.next()) {
    const classes = cursor.value.spec.class ?? '';
    const heading = classes.match(/\bcm-live-h([1-6])\b/)?.[1];
    const gutterClass = classes.split(' ').includes('cm-live-code-line')
      ? 'cm-live-gutter-code'
      : heading
        ? `cm-live-gutter-h${heading}`
        : classes === 'cm-live-hidden-separator'
          ? 'cm-live-gutter-hidden'
          : classes === 'cm-live-separator'
            ? 'cm-live-gutter-separator'
            : null;
    if (gutterClass) markers.push(new PreviewGutterLine(gutterClass).range(cursor.from));
  }
  return RangeSet.of(markers, true);
}

// Empty source lines retain the same height when selected, typed past or blurred.
// Their height contributes to the block gap instead of being added a second time.
export function livePreviewLayout(state: EditorState, active: (from: number, to: number) => boolean) {
  const result = [];
  let previousEnd = 0;
  let previousAfter = '0px';
  let first = true;
  const tree = syntaxTree(state);
  // yamlFrontmatter mounts the Markdown document beneath the outer document.
  const markdown = tree.topNode.getChild('Document') ?? tree.topNode;
  const bodyFrom = frontmatterRange(state.doc.toString())?.bodyFrom ?? 0;
  previousEnd = state.doc.lineAt(markdown.from).number - 1;
  for (let node = markdown.firstChild; node; node = node.nextSibling) {
    if (node.from < bodyFrom || ['Frontmatter', 'Body', 'Document'].includes(node.name)) continue;
    const heading = node.name.match(/^(?:ATX|Setext)Heading([1-6])$/)?.[1];
    const kind = heading
      ? `h${heading}`
      : node.name === 'Paragraph'
        ? 'paragraph'
        : node.name === 'Blockquote'
          ? 'quote'
          : /^(Bullet|Ordered)List$/.test(node.name)
            ? 'list'
            : 'code';
    const before = `var(--md-${kind}-before)`;
    const after = `var(--md-${kind}-after)`;
    const startLine = state.doc.lineAt(node.from);
    const endLine = state.doc.lineAt(node.to);
    for (let line = previousEnd + 1; line < startLine.number; line++) {
      const separator = state.doc.line(line);
      if (!separator.text.trim())
        result.push(Decoration.line({ class: 'cm-live-separator' }).range(separator.from));
    }
    const separators = startLine.number - previousEnd - 1;
    const margin = first ? `max(0px, calc(${before} - 25px))` : `max(${before}, ${previousAfter})`;
    const gap = `max(0px, calc(${margin} - ${separators} * var(--md-separator-height)))`;
    result.push(
      Decoration.widget({ widget: new BlockGap(gap), block: true, side: -1 }).range(startLine.from),
    );
    // The editor's bottom padding supplies trailing space. A noneditable block
    // at the end caret prevents WebKit from applying macOS Text Replacements.
    if (node.name.startsWith('SetextHeading') && !active(node.from, node.to))
      result.push(Decoration.line({ class: 'cm-live-hidden-separator' }).range(endLine.from));
    previousEnd = endLine.number;
    previousAfter = after;
    first = false;
  }
  return result;
}
