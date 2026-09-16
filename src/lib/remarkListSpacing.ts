import type { Root, RootContent } from 'mdast';

// Markdown's loose flag applies to the whole list; visual gaps follow source blanks instead.
export function remarkListSpacing() {
  return (tree: Root) => {
    const visit = (node: Root | RootContent) => {
      if (node.type === 'list') {
        node.children.forEach((item, index) => {
          const start = item.position?.start.line;
          const previousEnd = node.children[index - 1]?.position?.end.line;
          if (start === undefined || previousEnd === undefined || start <= previousEnd + 1) return;
          item.data = {
            ...item.data,
            hProperties: {
              ...item.data?.hProperties,
              style: `--md-list-blank-lines: ${start - previousEnd - 1}`,
            },
          };
        });
      }
      if ('children' in node) node.children.forEach(visit);
    };
    visit(tree);
  };
}
