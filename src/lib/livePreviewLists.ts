import type { EditorState, Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { BlockGap } from './livePreviewLayout';
import { markdownListLayout } from './markdownListLayout';
import { taskPrefix, type TaskStatus } from './markdownTasks';
import { taskIconDOM } from '../components/TaskIcon';

class ListMarker extends WidgetType {
  constructor(
    readonly marker: string,
    readonly bullet: boolean,
    readonly contentFrom: number,
    readonly task: TaskStatus | null = null,
    readonly taskFrom: number | null = null,
  ) {
    super();
  }
  eq(other: ListMarker) {
    return (
      this.marker === other.marker &&
      this.contentFrom === other.contentFrom &&
      this.task === other.task &&
      this.taskFrom === other.taskFrom
    );
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('span');
    dom.className = `cm-live-list-marker${this.task ? ' cm-live-task' : this.bullet ? ' cm-live-bullet' : ''}`;
    dom.textContent = this.bullet || this.task ? '\u00a0' : this.marker;
    if (this.task) {
      dom.append(taskIconDOM(this.task));
      dom.title = '클릭하여 작업 상태 편집';
    }
    dom.onmousedown = (event) => {
      if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      view.dispatch({
        selection: { anchor: this.task ? this.taskFrom! + 1 : this.contentFrom },
        scrollIntoView: true,
      });
      view.focus();
    };
    return dom;
  }
  coordsAt(dom: HTMLElement, pos: number) {
    const range = document.createRange();
    range.selectNodeContents(dom);
    const text = range.getBoundingClientRect();
    const box = dom.getBoundingClientRect();
    const x = pos === 0 ? box.left : box.right;
    return { left: x, right: x, top: text.top, bottom: text.bottom };
  }
  ignoreEvent() {
    return false;
  }
}

// List prefixes keep their Markdown in the document but occupy the same width as reading mode.
export function livePreviewLists(state: EditorState, focused = true) {
  const ranges: Range<Decoration>[] = [];
  const editingRange = (from: number, to: number) =>
    focused &&
    state.selection.ranges.some((range) =>
      range.empty ? range.head >= from && range.head < to : range.from < to && range.to > from,
    );
  const { lines, separators, paragraphBreaks } = markdownListLayout(
    state.doc,
    syntaxTree(state),
    state.tabSize,
  );
  syntaxTree(state).iterate({
    enter({ node, name, from, to }) {
      if (name === 'Frontmatter') return false;
      if (['FencedCode', 'CodeBlock', 'Table', 'HTMLBlock', 'HorizontalRule'].includes(name)) return false;
      if (name === 'ListMark') {
        const marker = state.doc.sliceString(from, to);
        const space = state.doc.sliceString(to, state.doc.lineAt(to).to).match(/^[ \t]+/)?.[0].length ?? 0;
        const rest = state.doc.sliceString(to + space, state.doc.lineAt(to).to);
        const inline = ['Paragraph', 'Task'].includes(node.nextSibling?.name ?? '');
        const task = inline ? taskPrefix(rest) : null;
        const taskFrom = to + space;
        // Keep the whole prefix editable while a state is being deleted or replaced.
        // Unknown/empty states remain literal text; they do not become task icons.
        const editablePrefix = inline ? /^\[[^\]\r\n]?\](?=[ \t]|$)/.exec(rest)?.[0] : null;
        const taskEnd = task ? task.length + (rest.slice(task.length).match(/^[ \t]+/)?.[0].length ?? 0) : 0;
        const contentFrom = to + space + taskEnd;
        // A caret inside replaced syntax must show its actual source position,
        // including separator spaces. The content boundary stays rendered.
        const editing = editingRange(from, Math.max(contentFrom, taskFrom + (editablePrefix?.length ?? 0)));
        // Keep native caret/IME text outside the fixed-width marker, including empty items.
        if (space && !editing && (!task || task.hasSeparator))
          ranges.push(
            Decoration.replace({
              widget: new ListMarker(
                marker,
                /^[-+*]$/.test(marker),
                contentFrom,
                task?.status,
                task ? taskFrom : null,
              ),
            }).range(from, contentFrom),
          );
        return false;
      }
    },
  });
  for (const [number, boundary] of paragraphBreaks)
    ranges.push(
      Decoration.widget({
        widget: new BlockGap(
          boundary === 'beforeList'
            ? 'max(var(--md-paragraph-after), var(--md-list-before))'
            : 'max(var(--md-list-after), var(--md-paragraph-before))',
        ),
        block: true,
        side: -1,
      }).range(state.doc.line(number).from),
    );
  for (const number of separators)
    ranges.push(Decoration.line({ class: 'cm-live-separator' }).range(state.doc.line(number).from));
  for (const [number, { depth, gap, first }] of lines) {
    const line = state.doc.line(number);
    if (!line.text.trim()) continue;
    if (gap && !paragraphBreaks.has(number))
      ranges.push(
        Decoration.widget({
          widget: new BlockGap('var(--md-list-item-gap)'),
          block: true,
          side: -1,
        }).range(line.from),
      );
    ranges.push(
      Decoration.line({
        class: `cm-live-list-line${first ? ' cm-live-list-start' : ''}`,
        attributes: { style: `--cm-list-depth:${depth}` },
      }).range(line.from),
    );
    const indent = line.text.match(/^[ \t]+/)?.[0].length ?? 0;
    if (indent && !editingRange(line.from, line.from + indent))
      ranges.push(Decoration.replace({}).range(line.from, line.from + indent));
  }
  return ranges;
}
