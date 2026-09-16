import type { Root, RootContent, PhrasingContent } from 'mdast';
import { tagTokens, noteTags } from './noteTags';
export function remarkTags() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    const valid = noteTags(source);
    const point = (offset: number) => ({
      offset,
      line: source.slice(0, offset).split('\n').length,
      column: offset - source.lastIndexOf('\n', offset - 1),
    });
    const position = (from: number, to: number) => ({ start: point(from), end: point(to) });
    const visit = (node: Root | RootContent) => {
      if (!('children' in node) || ['link', 'linkReference', 'image', 'imageReference'].includes(node.type))
        return;
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        if (child.type !== 'text') {
          visit(child);
          continue;
        }
        const raw = source.slice(child.position?.start.offset, child.position?.end.offset);
        const start = child.position?.start.offset ?? 0;
        const result: PhrasingContent[] = [];
        let offset = 0,
          rawOffset = 0,
          cursor = 0;
        for (const tag of tagTokens(child.value)) {
          const text = child.value.slice(tag.from, tag.to);
          const original = raw.indexOf(text, cursor);
          if (original < 0) continue;
          cursor = original + text.length;
          if (!valid.some((t) => t.from === original + start)) continue;
          result.push({
            type: 'text',
            value: child.value.slice(offset, tag.from),
            position: position(start + rawOffset, start + original),
          });
          result.push({
            type: 'link',
            url: `#foltra-tag:${encodeURIComponent(tag.name)}`,
            children: [{ type: 'text', value: text }],
          });
          offset = tag.to;
          rawOffset = cursor;
        }
        if (offset) {
          result.push({
            type: 'text',
            value: child.value.slice(offset),
            position: position(start + rawOffset, start + raw.length),
          });
          node.children.splice(i, 1, ...result);
        }
      }
    };
    visit(tree);
  };
}
