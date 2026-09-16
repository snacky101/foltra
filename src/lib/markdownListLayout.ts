import { countColumn, Text } from '@codemirror/state';
import { GFM, parser } from '@lezer/markdown';

const previewParser = parser.configure(GFM);

// Both previews follow explicit source indentation, instead of Markdown's lazy
// continuation rule that absorbs a left-aligned paragraph into the last item.
export function markdownListLayout(doc: Text, tree: ReturnType<typeof parser.parse>, tabSize = 4) {
  const lines = new Map<number, { depth: number; indent: number; gap: boolean; first: boolean }>();
  const separators = new Set<number>();
  const plain = new Set<number>();
  tree.iterate({
    enter({ node, name, from, to }) {
      if (/^(Bullet|Ordered)List$/.test(name)) {
        for (let number = doc.lineAt(from).number; number <= doc.lineAt(to).number; number++)
          if (!doc.line(number).text.trim()) separators.add(number);
      }
      if (['FencedCode', 'CodeBlock', 'Table', 'HTMLBlock', 'HorizontalRule'].includes(name)) {
        for (let number = doc.lineAt(from).number; number <= doc.lineAt(to).number; number++) {
          lines.delete(number);
          separators.delete(number);
          plain.delete(number);
        }
        return false;
      }
      // A newline inside explicit inline markup must not split that construct.
      if (['InlineCode', 'Emphasis', 'StrongEmphasis', 'Strikethrough', 'Link', 'Image'].includes(name)) {
        let item = node.parent;
        while (item && item.name !== 'ListItem') item = item.parent;
        const layout = item && lines.get(doc.lineAt(item.from).number);
        if (layout)
          for (let number = doc.lineAt(from).number + 1; number <= doc.lineAt(to).number; number++)
            lines.set(number, { ...layout, gap: false, first: false });
      }
      if (name !== 'ListItem') return;
      let depth = 1;
      for (let parent = node.parent?.parent; parent; parent = parent.parent)
        if (parent.name === 'ListItem') depth++;
      const first = doc.lineAt(from);
      const last = doc.lineAt(to);
      const markerEnd = node.getChild('ListMark')!.to - first.from;
      const space = first.text.slice(markerEnd).match(/^[ \t]+/)?.[0].length ?? 0;
      const contentIndent = countColumn(first.text, tabSize, markerEnd + space);
      const gap = !!node.prevSibling || depth > 1;
      for (let number = first.number; number <= last.number; number++) {
        const text = doc.line(number).text;
        const prefix = text.match(/^[ \t>]*/)?.[0] ?? '';
        if (number !== first.number && countColumn(prefix, tabSize) < contentIndent) {
          if (text.trim()) plain.add(number);
          continue;
        }
        lines.set(number, {
          depth,
          indent: contentIndent,
          gap: number === first.number && gap,
          first: number === first.number,
        });
      }
    },
  });
  for (const number of lines.keys()) plain.delete(number);
  const paragraphBreaks = new Map<number, 'beforeList' | 'afterList'>();
  for (const number of plain) if (lines.has(number - 1)) paragraphBreaks.set(number, 'afterList');
  for (const [number, line] of lines)
    if (line.first && plain.has(number - 1)) paragraphBreaks.set(number, 'beforeList');
  // The final empty editing row is already a paragraph after a list. Reserve
  // its gap before the first letter; explicitly indented continuations stay in the list.
  const last = doc.line(doc.lines);
  const previous = lines.get(last.number - 1);
  if (previous && /^[ \t>]*$/.test(last.text) && countColumn(last.text, tabSize) < previous.indent)
    paragraphBreaks.set(last.number, 'afterList');
  return { lines, separators, paragraphBreaks };
}

// Insert rendering-only separators before parsing reading mode. Stored Markdown
// and editor positions remain untouched; inline syntax uses the same parser path.
export function separateListParagraphs(body: string) {
  const source = body.split('\n');
  const { paragraphBreaks } = markdownListLayout(Text.of(source), previewParser.parse(body));
  for (const number of [...paragraphBreaks.keys()].sort((a, b) => b - a)) {
    const quote = source[number - 1].match(/^(?:[ \t]*>[ \t]*)+/)?.[0] ?? '';
    source.splice(number - 1, 0, quote);
  }
  return source.join('\n');
}
