import type { Parent, PhrasingContent, Root, RootContent } from 'mdast';
import { underlineTagPairs } from './markdownUnderline';

interface Underline extends Parent {
  type: 'underline';
  children: PhrasingContent[];
}

declare module 'mdast' {
  interface PhrasingContentMap {
    underline: Underline;
  }
  interface RootContentMap {
    underline: Underline;
  }
}

export function remarkUnderline() {
  return (tree: Root) => {
    const visit = (node: Root | RootContent) => {
      if (!('children' in node) || node.type === 'link' || node.type === 'linkReference') return;
      node.children.forEach(visit);
      if (
        node.type !== 'paragraph' &&
        node.type !== 'heading' &&
        node.type !== 'tableCell' &&
        node.type !== 'strong' &&
        node.type !== 'emphasis' &&
        node.type !== 'delete'
      )
        return;
      const children = node.children;
      const pairs = new Map(
        underlineTagPairs(children.map((child) => (child.type === 'html' ? child.value : null))),
      );
      const wrap = (from: number, to: number): PhrasingContent[] => {
        const output: PhrasingContent[] = [];
        for (let index = from; index < to; index++) {
          const closing = pairs.get(index);
          if (closing === undefined || closing >= to) {
            output.push(children[index]);
            continue;
          }
          const start = children[index].position?.start;
          const end = children[closing].position?.end;
          output.push({
            type: 'underline',
            children: wrap(index + 1, closing),
            // Only a fixed element name is emitted; raw HTML is never enabled.
            data: { hName: 'u' },
            ...(start && end ? { position: { start, end } } : {}),
          });
          index = closing;
        }
        return output;
      };
      if (pairs.size) node.children = wrap(0, children.length);
    };
    visit(tree);
  };
}
