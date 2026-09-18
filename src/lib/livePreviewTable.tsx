import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { EditorView, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view';
import { isolateHistory, redo, undo } from '@codemirror/commands';
import { getCM } from '@replit/codemirror-vim';
import { NotePreview } from '../components/NotePreview';
import { commandKey } from './commandKey';
import { showTableContextMenu } from './tableContextMenu';
import {
  insertTableColumn,
  insertTableRow,
  changeTableCell,
  deleteTableColumn,
  deleteTableRow,
  markdownTables,
  type MarkdownTable,
} from './markdownTables';

type Context = Omit<ComponentProps<typeof NotePreview>, 'body' | 'executeQueries'>;
const mounted = new WeakMap<HTMLElement, TableEditor>();

// The Markdown preview owns its DOM. A sibling input overlays the selected cell,
// so React updates never replace the native input during composition.
class TableEditor {
  readonly dom = document.createElement('div');
  private preview = document.createElement('div');
  private input = document.createElement('input');
  private root: Root;
  private observer: ResizeObserver;
  private mutations: MutationObserver;
  private selected = { row: 0, column: 0 };
  private editing = false;
  private composing = false;
  private isolate = true;
  private writing = false;
  private scrollPending = false;
  private pendingDelete = false;
  private closeMenu?: () => void;

  constructor(
    private view: EditorView,
    private table: MarkdownTable,
    context: Context,
  ) {
    this.dom.className = 'cm-live-table';
    this.dom.tabIndex = 0;
    this.dom.setAttribute('role', 'group');
    this.dom.setAttribute('aria-label', 'Markdown 표. 방향키로 셀 이동, Enter로 편집, Escape로 나가기');
    this.dom.title =
      'Enter: 편집/확정 · Tab: 오른쪽 셀/끝에서 열 추가 · Shift+Tab: 이전 셀 · Alt+Enter: 아래 행 추가 · Vim o/O: 아래/위 행 추가 · dd/dc: 행/열 삭제';
    this.input.className = 'cm-table-input';
    this.input.hidden = true;
    this.input.spellcheck = true;
    this.input.setAttribute('autocorrect', 'on');
    this.preview.className = 'cm-table-preview';
    this.dom.append(this.preview, this.input);
    for (const [kind, label, run] of [
      [
        'row',
        '표 아래에 행 추가',
        () => {
          this.focus(this.table.rows.length - 1, 0);
          this.insertRow();
        },
      ],
      ['column', '표 오른쪽에 열 추가', () => this.insertColumn(this.table.columns, true)],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `cm-table-add cm-table-add-${kind}`;
      button.textContent = '+';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', run);
      this.dom.append(button);
    }
    this.root = createRoot(this.preview);
    this.observer = new ResizeObserver(() => {
      this.layout();
      this.view.requestMeasure();
    });
    this.observer.observe(this.preview);
    this.mutations = new MutationObserver(() => this.layout());
    this.mutations.observe(this.preview, { childList: true, subtree: true, characterData: true });
    this.dom.addEventListener('keydown', this.keydown);
    this.dom.addEventListener('mousedown', this.mousedown);
    this.dom.addEventListener('contextmenu', (event) => {
      if (event.target === this.input) return;
      const cell = (event.target as HTMLElement).closest<HTMLTableCellElement>('td, th');
      if (!cell) return;
      event.preventDefault();
      this.closeMenu?.();
      this.focus(this.cells().indexOf(cell.parentElement as HTMLTableRowElement), cell.cellIndex);
      this.closeMenu = showTableContextMenu(
        { x: event.clientX, y: event.clientY },
        this.selected.row,
        this.selected.column,
        this.table.columns,
        {
          edit: () => this.edit(),
          insertRow: (above) => this.insertRow(above),
          insertColumn: (column) => this.insertColumn(column, true),
          deleteRow: () => this.deleteRow(),
          deleteColumn: () => this.deleteColumn(),
        },
      );
    });
    this.preview.addEventListener('scroll', () => this.layout());
    this.dom.addEventListener(
      'click',
      (event) => {
        if (!event.metaKey && !event.ctrlKey && !(event.target as HTMLElement).closest('.cm-table-add'))
          event.stopPropagation();
      },
      true,
    );
    this.dom.addEventListener('dblclick', (event) => {
      if ((event.target as HTMLElement).closest('td, th')) this.edit();
    });
    this.dom.addEventListener('focus', () => this.layout());
    this.dom.addEventListener('focusout', () => {
      this.pendingDelete = false;
      queueMicrotask(() => {
        if (!this.dom.contains(document.activeElement)) {
          this.editing = false;
          this.layout();
        }
      });
    });
    this.input.addEventListener('compositionstart', () => {
      this.composing = true;
    });
    this.input.addEventListener('compositionend', () => {
      this.composing = false;
      this.write();
    });
    this.input.addEventListener('input', () => this.write());
    this.update(table, context);
  }

  update(table: MarkdownTable, context: Context) {
    if (this.table.source !== table.source) {
      this.pendingDelete = false;
      this.closeMenu?.();
    }
    const previousValue = this.value();
    this.table = table;
    this.dom.dataset.tableFrom = String(table.from);
    this.selected.row = Math.min(this.selected.row, table.rows.length - 1);
    this.selected.column = Math.min(this.selected.column, table.columns - 1);
    if (!this.composing && !this.writing && previousValue !== this.value()) this.input.value = this.value();
    this.root.render(<NotePreview {...context} body={table.body} executeQueries={false} />);
    this.layout();
  }

  private cells() {
    return [...this.preview.querySelectorAll<HTMLTableRowElement>('table > thead > tr, table > tbody > tr')];
  }
  private cell() {
    return this.cells()[this.selected.row]?.cells[this.selected.column];
  }
  private value() {
    return this.table.rows[this.selected.row].cells[this.selected.column]?.text ?? '';
  }

  private layout() {
    const focused = this.dom.contains(document.activeElement);
    for (const row of this.cells()) for (const cell of row.cells) cell.classList.remove('cm-table-selected');
    const cell = this.cell();
    if (cell && this.scrollPending) {
      this.scrollPending = false;
      cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (focused) cell?.classList.add('cm-table-selected');
    this.input.hidden = !this.editing || !focused;
    if (!cell || this.input.hidden) return;
    const parent = this.dom.getBoundingClientRect(),
      rect = cell.getBoundingClientRect();
    Object.assign(this.input.style, {
      left: `${rect.left - parent.left + this.dom.scrollLeft}px`,
      top: `${rect.top - parent.top + this.dom.scrollTop}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      textAlign: getComputedStyle(cell).textAlign,
    });
    this.input.setAttribute('aria-label', `표 ${this.selected.row + 1}행 ${this.selected.column + 1}열 편집`);
  }

  focus(row: number, column = 0, edit = false) {
    this.pendingDelete = false;
    this.editing = false;
    this.selected = { row, column };
    this.scrollPending = true;
    const sourceRow = this.table.rows[row];
    this.view.dispatch({ selection: { anchor: sourceRow.cells[column]?.from ?? sourceRow.to } });
    this.dom.focus();
    this.layout();
    if (edit) this.edit();
  }

  private edit() {
    this.editing = true;
    this.isolate = true;
    this.input.value = this.value();
    this.dom.focus();
    this.layout();
    this.input.focus();
    this.input.select();
  }

  private write() {
    if (!this.editing) return;
    const { row, column } = this.selected;
    if (this.input.value === this.value()) return;
    const changes = changeTableCell(this.view.state, this.table, row, column, this.input.value.trim());
    if (this.view.state.doc.sliceString(changes.from, changes.to) === changes.insert) return;
    this.writing = true;
    try {
      this.view.dispatch({
        changes,
        userEvent: 'input.type',
        annotations: this.isolate ? isolateHistory.of('before') : undefined,
      });
    } finally {
      this.writing = false;
    }
    this.isolate = false;
  }

  private exit(direction: -1 | 1) {
    this.editing = false;
    const doc = this.view.state.doc;
    const boundary = doc.lineAt(direction < 0 ? this.table.from : this.table.to);
    const number = boundary.number + direction;
    // A table at the document edge needs a real place for the caret to leave to.
    if (number < 1 || number > doc.lines) {
      const from = direction < 0 ? 0 : doc.length;
      this.view.dispatch({
        changes: { from, insert: '\n' },
        selection: { anchor: direction < 0 ? 0 : from + 1 },
        userEvent: 'input',
        annotations: isolateHistory.of('full'),
      });
    } else this.view.dispatch({ selection: { anchor: doc.line(number).from } });
    this.view.focus();
    this.layout();
  }

  private move(row: number, column: number, edit: boolean) {
    if (row < 0) return this.exit(-1);
    if (row >= this.table.rows.length) return this.exit(1);
    this.focus(row, column, edit);
  }

  private insertRow(above = false) {
    const row = Math.max(1, this.selected.row + (above ? 0 : 1));
    this.view.dispatch({
      changes: insertTableRow(this.view.state, this.table, row),
      userEvent: 'input',
      annotations: isolateHistory.of('full'),
    });
    this.focus(row, this.selected.column, true);
  }

  private insertColumn(column: number, edit = false) {
    this.view.dispatch({
      changes: insertTableColumn(this.view.state, this.table, column),
      userEvent: 'input',
      annotations: isolateHistory.of('full'),
    });
    this.focus(edit ? 0 : this.selected.row, column, edit);
  }

  private deleteRow() {
    const changes = deleteTableRow(this.view.state, this.table, this.selected.row);
    if (!changes) return;
    this.view.dispatch({ changes, userEvent: 'delete', annotations: isolateHistory.of('full') });
    this.focus(this.selected.row, this.selected.column);
  }

  private deleteColumn() {
    const changes = deleteTableColumn(this.view.state, this.table, this.selected.column);
    if (!changes.length) return;
    this.view.dispatch({ changes, userEvent: 'delete', annotations: isolateHistory.of('full') });
    this.focus(this.selected.row, this.selected.column);
  }

  private keydown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('.cm-table-add')) return;
    if (this.composing || (this.editing && (event.isComposing || event.keyCode === 229))) return;
    const vim = !!getCM(this.view)?.state.vim;
    const key = this.editing ? event.key : commandKey(event);
    const pendingDelete = this.pendingDelete;
    const deleteKey =
      vim && !this.editing && key === 'd' && !event.metaKey && !event.ctrlKey && !event.altKey;
    if (event.repeat && (deleteKey || key === 'Enter' || key === 'Tab')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.pendingDelete = false;
    let handled = true;
    if (deleteKey) {
      if (pendingDelete) this.deleteRow();
      else this.pendingDelete = true;
    } else if (
      pendingDelete &&
      vim &&
      !this.editing &&
      key === 'c' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      this.deleteColumn();
    } else if (pendingDelete && key === 'Escape') {
      // Cancel the pending operator without leaving the selected cell.
    } else if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'z')
      (event.shiftKey ? redo : undo)(this.view);
    else if (
      vim &&
      !this.editing &&
      !event.metaKey &&
      !event.altKey &&
      ((key === 'u' && !event.ctrlKey) || (event.ctrlKey && key === 'r'))
    )
      (key === 'u' ? undo : redo)(this.view);
    else if (key === 'Enter' && event.altKey && !event.metaKey && !event.ctrlKey) this.insertRow();
    else if (event.metaKey || event.ctrlKey || event.altKey) return;
    else if (key === 'Escape') {
      if (this.editing) {
        this.editing = false;
        this.dom.focus();
        this.layout();
      } else this.exit(1);
    } else if (key === 'Tab') {
      if (this.editing) {
        const index =
          this.selected.row * this.table.columns + this.selected.column + (event.shiftKey ? -1 : 1);
        if (index >= this.table.rows.length * this.table.columns)
          this.focus(this.selected.row, this.selected.column);
        else
          this.move(
            Math.floor(index / this.table.columns),
            (index + this.table.columns) % this.table.columns,
            true,
          );
      } else {
        const column = Math.max(0, this.selected.column + (event.shiftKey ? -1 : 1));
        if (column === this.table.columns) this.insertColumn(column);
        else this.focus(this.selected.row, column);
      }
    } else if (key === 'Enter') {
      if (this.editing) this.focus(this.selected.row, this.selected.column);
      else this.edit();
    } else if (!this.editing) {
      if (key === 'ArrowDown' || (vim && key === 'j'))
        this.move(this.selected.row + 1, this.selected.column, false);
      else if (key === 'ArrowUp' || (vim && key === 'k'))
        this.move(this.selected.row - 1, this.selected.column, false);
      else if (key === 'ArrowLeft' || (vim && key === 'h'))
        this.focus(this.selected.row, Math.max(0, this.selected.column - 1));
      else if (key === 'ArrowRight' || (vim && key === 'l'))
        this.focus(this.selected.row, Math.min(this.table.columns - 1, this.selected.column + 1));
      else if (vim && (key === 'i' || key === 'a')) this.edit();
      else if (vim && (key === 'o' || key === 'O')) this.insertRow(key === 'O');
      else handled = false;
    } else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private mousedown = (event: MouseEvent) => {
    if (event.target === this.input || event.metaKey || event.ctrlKey || event.button !== 0) return;
    const cell = (event.target as HTMLElement).closest<HTMLTableCellElement>('td, th');
    if (!cell) return;
    const row = this.cells().indexOf(cell.parentElement as HTMLTableRowElement);
    if (row < 0) return;
    event.preventDefault();
    this.focus(row, cell.cellIndex);
  };

  destroy() {
    this.closeMenu?.();
    this.observer.disconnect();
    this.mutations.disconnect();
    queueMicrotask(() => this.root.unmount());
  }
}

export class TablePreview extends WidgetType {
  constructor(
    readonly table: MarkdownTable,
    readonly context: Context,
  ) {
    super();
  }
  eq(other: TablePreview) {
    return (
      this.table.source === other.table.source &&
      this.table.from === other.table.from &&
      this.context.workspace === other.context.workspace
    );
  }
  toDOM(view: EditorView) {
    const editor = new TableEditor(view, this.table, this.context);
    mounted.set(editor.dom, editor);
    return editor.dom;
  }
  updateDOM(dom: HTMLElement) {
    mounted.get(dom)!.update(this.table, this.context);
    return true;
  }
  destroy(dom: HTMLElement) {
    mounted.get(dom)?.destroy();
    mounted.delete(dom);
  }
  ignoreEvent() {
    return true;
  }
}

function focusTable(view: EditorView, table: MarkdownTable, row: number, column = 0) {
  const dom = view.contentDOM.querySelector<HTMLElement>(`.cm-live-table[data-table-from="${table.from}"]`);
  if (!dom) return false;
  mounted.get(dom)!.focus(row, column);
  return true;
}

export const tableNavigation = ViewPlugin.fromClass(
  class {
    constructor(private view: EditorView) {
      view.contentDOM.addEventListener('keydown', this.keydown, true);
    }
    keydown = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest('.cm-live-table') ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !this.view.state.selection.main.empty
      )
        return;
      const vim = getCM(this.view)?.state.vim;
      const normal =
        vim &&
        !vim.insertMode &&
        !vim.visualMode &&
        !vim.inputState?.operator &&
        !vim.inputState?.keyBuffer.length;
      const key = normal ? commandKey(event) : event.key;
      if ((event.isComposing || this.view.composing) && !normal) return;
      const direction =
        key === 'ArrowDown' || (normal && key === 'j')
          ? 1
          : key === 'ArrowUp' || (normal && key === 'k')
            ? -1
            : 0;
      if (!direction) return;
      const { state } = this.view;
      const line = state.doc.lineAt(state.selection.main.head).number + direction;
      const table = markdownTables(state).find(
        (t) => state.doc.lineAt(t.from).number <= line && state.doc.lineAt(t.to).number >= line,
      );
      if (!table) return;
      const next = this.view.moveVertically(state.selection.main, direction > 0);
      if (state.doc.lineAt(next.head).number === state.doc.lineAt(state.selection.main.head).number) return;
      if (focusTable(this.view, table, direction > 0 ? 0 : table.rows.length - 1)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    update(update: ViewUpdate) {
      if (
        !(update.selectionSet || update.focusChanged) ||
        update.docChanged ||
        !this.view.hasFocus ||
        !update.state.selection.main.empty
      )
        return;
      const head = update.state.selection.main.head;
      const table = markdownTables(update.state).find((t) => head >= t.from && head <= t.to);
      if (!table) return;
      const row = Math.max(0, table.rows.filter((r) => r.from <= head).length - 1);
      const column = Math.max(
        0,
        Math.min(table.columns - 1, table.rows[row].cells.filter((c) => c.from <= head).length - 1),
      );
      queueMicrotask(() => {
        if (this.view.dom.isConnected && this.view.hasFocus && this.view.state.selection.main.head === head)
          focusTable(this.view, table, row, column);
      });
    }
    destroy() {
      this.view.contentDOM.removeEventListener('keydown', this.keydown, true);
    }
  },
);
