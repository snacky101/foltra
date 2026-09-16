import { splitWikiLink } from './wikiLinks';
import type { Root, RootContent, PhrasingContent } from 'mdast';

function splitLinks(value: string, source: string): PhrasingContent[] {
  const children: PhrasingContent[] = [];
  let offset = 0;
  let sourceOffset = 0;
  for (const match of value.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const original = source.indexOf(match[0], sourceOffset);
    if (original < 0) continue;
    sourceOffset = original + match[0].length;
    // Markdown has already unescaped the text node. Only literal, unescaped [[ opens a link.
    if ((source.slice(0, original).match(/\\+$/)?.[0].length ?? 0) % 2) continue;
    if (match.index > offset) children.push({ type: 'text', value: value.slice(offset, match.index) });
    const [target, label] = splitWikiLink(match[1]);
    children.push({
      type: 'link',
      url: `#foltra-${encodeURIComponent(target)}`,
      children: [{ type: 'text', value: label }],
    });
    offset = match.index + match[0].length;
  }
  if (offset < value.length) children.push({ type: 'text', value: value.slice(offset) });
  return children;
}

export function remarkWikiLinks() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    const visit = (node: Root | RootContent) => {
      if (!('children' in node) || node.type === 'link' || node.type === 'linkReference') return;
      // Transform parsed text nodes only: code, inline code and existing links stay literal.
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index];
        if (child.type === 'text')
          node.children.splice(
            index,
            1,
            ...splitLinks(
              child.value,
              source.slice(child.position?.start.offset, child.position?.end.offset),
            ),
          );
        else visit(child);
      }
    };
    visit(tree);
  };
}

export function wikiTarget(href: string): string | null {
  try {
    return decodeURIComponent(href.slice('#foltra-'.length)).split('#')[0];
  } catch {
    return null;
  }
}
