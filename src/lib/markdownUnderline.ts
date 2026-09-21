import { parser, GFM } from '@lezer/markdown';
import type { SyntaxNode, Tree } from '@lezer/common';
import { frontmatterRange } from './frontmatter';

const markdown = parser.configure(GFM);

export interface UnderlineRange {
  from: number;
  to: number;
  openEnd: number;
  closeFrom: number;
}

// Both renderers accept only these exact, attribute-free inline tokens. Pairing
// stays inside one Markdown container, so unrelated paragraphs cannot join.
export function underlineTagPairs(tokens: readonly (string | null)[]): [number, number][] {
  const open: number[] = [];
  const pairs: [number, number][] = [];
  tokens.forEach((token, index) => {
    if (token === '<u>') open.push(index);
    else if (token === '</u>' && open.length) pairs.push([open.pop()!, index]);
  });
  return pairs;
}

export function underlineRanges(source: string, tree: Tree = markdown.parse(source)): UnderlineRange[] {
  const ranges: UnderlineRange[] = [];
  const frontmatter = frontmatterRange(source);
  const visit = (node: SyntaxNode) => {
    if (
      (frontmatter && node.from < frontmatter.to && node.name !== 'Document') ||
      [
        'Frontmatter',
        'FencedCode',
        'CodeBlock',
        'InlineCode',
        'HTMLBlock',
        'Link',
        'Autolink',
        'Image',
      ].includes(node.name)
    )
      return;
    const children: SyntaxNode[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
    const tokens = children.map((child) =>
      child.name === 'HTMLTag' ? source.slice(child.from, child.to) : null,
    );
    for (const [opening, closing] of underlineTagPairs(tokens)) {
      ranges.push({
        from: children[opening].from,
        openEnd: children[opening].to,
        closeFrom: children[closing].from,
        to: children[closing].to,
      });
    }
    children.forEach(visit);
  };
  visit(tree.topNode);
  return ranges.sort((a, b) => a.from - b.from || b.to - a.to);
}
