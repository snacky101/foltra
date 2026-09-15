import { splitWikiLink } from './wikiLinks';
import type { Root, RootContent, PhrasingContent } from 'mdast';

function splitLinks(value: string): PhrasingContent[] {
  const children: PhrasingContent[] = [];
  let offset = 0;
  for (const match of value.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
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
  return (tree: Root) => {
    const visit = (node: Root | RootContent) => {
      if (!('children' in node) || node.type === 'link' || node.type === 'linkReference') return;
      // Transform parsed text nodes only: code, inline code and existing links stay literal.
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index];
        if (child.type === 'text') node.children.splice(index, 1, ...splitLinks(child.value));
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
