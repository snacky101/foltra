import type { Root, RootContent } from 'mdast';
import { taskPrefix } from './markdownTasks';

// Extend GFM's two task states only at a real list item's source prefix.
export function remarkTasks() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    const visit = (node: Root | RootContent) => {
      if (node.type === 'listItem') {
        const start = node.position?.start.offset;
        const raw = start === undefined ? '' : source.slice(start).split('\n', 1)[0].replace(/\r$/, '');
        const list = raw.match(/^(?:[-+*]|\d+[.)])[ \t]+/);
        const task = list && taskPrefix(raw.slice(list[0].length));
        if (list && task && start !== undefined && node.children[0]?.type === 'paragraph') {
          if (!task.hasSeparator) {
            // GFM consumes a bare [ ]/[x] followed by a continuation line, including
            // one line-ending character. Restore exactly that source, keeping rich children.
            if (typeof node.checked === 'boolean') {
              node.checked = null;
              const taskStart = start + list[0].length;
              const restored = source.slice(taskStart, taskStart + task.length + 1);
              const first = node.children[0].children[0];
              if (first?.type === 'text') {
                // Keep CRLF together so remark-breaks produces one line break.
                first.value = restored + first.value;
                if (first.position)
                  first.position.start = {
                    ...node.position!.start,
                    offset: taskStart,
                    column: node.position!.start.column + list[0].length,
                  };
              } else node.children[0].children.unshift({ type: 'text', value: restored });
            }
          } else {
            const taskEnd = list[0].length + task.length;
            const space = raw.slice(taskEnd).match(/^[ \t]+/)?.[0].length ?? 0;
            const contentFrom = start + taskEnd + space;
            const first = node.children[0];
            if (first?.type === 'paragraph') {
              // GFM may have consumed [ ]/[x] already. Source positions also keep
              // escaped text, tags and links after a custom marker intact.
              first.children = first.children.filter(
                (child) => (child.position?.end.offset ?? Infinity) > contentFrom,
              );
              const text = first.children[0];
              if (
                text?.type === 'text' &&
                text.position?.start.offset !== undefined &&
                text.position.start.offset < contentFrom
              ) {
                const count = contentFrom - text.position.start.offset;
                text.value = text.value.slice(count);
                text.position.start = {
                  ...text.position.start,
                  offset: contentFrom,
                  column: text.position.start.column + count,
                };
              }
            }
            node.checked = null;
            node.data = {
              ...node.data,
              hProperties: {
                ...node.data?.hProperties,
                'data-task-marker': task.marker,
                'data-task-line': node.position!.start.line,
              },
            };
          }
        }
      }
      if ('children' in node) node.children.forEach(visit);
    };
    visit(tree);
  };
}
