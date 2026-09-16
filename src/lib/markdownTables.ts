import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

export interface TableCell {
  from: number;
  to: number;
  text: string;
}
export interface TableRow {
  from: number;
  to: number;
  cells: TableCell[];
}
export interface MarkdownTable {
  from: number;
  to: number;
  columns: number;
  rows: TableRow[];
  delimiter: { from: number; to: number };
  prefix: string;
  body: string;
  source: string;
}

function row(state: EditorState, node: SyntaxNode): TableRow {
  const delimiters = node.getChildren('TableDelimiter');
  let start = node.from;
  const ranges: { from: number; to: number }[] = [];
  for (const delimiter of delimiters) {
    if (delimiter.from !== node.from) ranges.push({ from: start, to: delimiter.from });
    start = delimiter.to;
  }
  if (!delimiters.length || state.doc.sliceString(start, node.to).trim())
    ranges.push({ from: start, to: node.to });
  return {
    from: node.from,
    to: node.to,
    cells: ranges.map(({ from, to }) => {
      const raw = state.doc.sliceString(from, to);
      const text = raw.trim();
      from += raw.length - raw.trimStart().length;
      return {
        from,
        to: from + text.length,
        text: text.replace(/(\\+)\|/g, (_, slashes: string) => '\\'.repeat((slashes.length - 1) / 2) + '|'),
      };
    }),
  };
}

export function markdownTable(state: EditorState, node: SyntaxNode): MarkdownTable {
  const header = row(state, node.getChild('TableHeader')!);
  const delimiter = node.getChild('TableDelimiter')!;
  const prefix = state.doc.sliceString(state.doc.lineAt(delimiter.from).from, delimiter.from);
  const source = state.doc.sliceString(node.from, node.to);
  return {
    from: node.from,
    to: node.to,
    columns: header.cells.length,
    rows: [header, ...node.getChildren('TableRow').map((node) => row(state, node))],
    delimiter: { from: delimiter.from, to: delimiter.to },
    prefix,
    source,
    body: source
      .split('\n')
      .map((line, index) => (index && prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line))
      .join('\n'),
  };
}

export function markdownTables(state: EditorState) {
  const tables: MarkdownTable[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'Table') return;
      tables.push(markdownTable(state, node.node));
      return false;
    },
  });
  return tables;
}

// A cell edit cannot introduce a new column or source line accidentally.
export function changeTableCell(
  state: EditorState,
  table: MarkdownTable,
  rowIndex: number,
  column: number,
  text: string,
) {
  const value = text
    .replace(/[\r\n]+/g, ' ')
    .replace(/(\\*)\|/g, (_, slashes: string) => slashes.repeat(2) + '\\|');
  const target = table.rows[rowIndex];
  const cell = target.cells[column];
  if (cell)
    return {
      from: cell.from,
      to: cell.to,
      insert:
        value + (value.endsWith('\\') && state.doc.sliceString(cell.to, cell.to + 1) === '|' ? ' ' : ''),
    };
  // GFM permits short rows. Materialize missing cells only when one is edited.
  const cells = Array.from({ length: table.columns }, (_, index) => {
    const existing = target.cells[index];
    return index === column ? value : existing ? state.doc.sliceString(existing.from, existing.to) : '';
  });
  return { from: target.from, to: target.to, insert: `| ${cells.join(' | ')} |` };
}

export function insertTableRow(state: EditorState, table: MarkdownTable, rowIndex: number) {
  // Insert data rows after the alignment row, never ahead of the required header.
  const previous = rowIndex <= 1 ? table.delimiter : table.rows[rowIndex - 1];
  return {
    from: state.doc.lineAt(previous.to).to,
    insert: `\n${table.prefix}| ${Array(table.columns).fill('').join(' | ')} |`,
  };
}

function alignmentRow(state: EditorState, table: MarkdownTable): TableRow {
  const alignment = state.doc.sliceString(table.delimiter.from, table.delimiter.to);
  return {
    ...table.delimiter,
    cells: [...alignment.matchAll(/:?-+:?/g)].map((match) => ({
      from: table.delimiter.from + match.index,
      to: table.delimiter.from + match.index + match[0].length,
      text: match[0],
    })),
  };
}

export function insertTableColumn(state: EditorState, table: MarkdownTable, column: number) {
  const delimiter = alignmentRow(state, table);
  return [...table.rows, delimiter].map((row) => {
    const value = row === delimiter ? '---' : '';
    // Insert before surplus cells as well, so previously hidden data stays hidden.
    const target = row.cells[column];
    if (target) return { from: target.from, insert: `${value} | ` };
    const last = row.cells.at(-1);
    const closed = last && state.doc.sliceString(last.to, row.to).includes('|');
    return {
      from: row.to,
      insert: (closed ? '' : ' |') + '  |'.repeat(column - row.cells.length) + ` ${value} |`,
    };
  });
}

export function deleteTableRow(state: EditorState, table: MarkdownTable, rowIndex: number) {
  // GFM requires its header and alignment row even when all data rows are gone.
  if (rowIndex === 0) return null;
  const line = state.doc.lineAt(table.rows[rowIndex].from);
  return line.number < state.doc.lines
    ? { from: line.from, to: line.to + 1 }
    : { from: line.from - 1, to: line.to };
}

export function deleteTableColumn(state: EditorState, table: MarkdownTable, column: number) {
  if (table.columns === 1) return [];
  const delimiter = alignmentRow(state, table);
  return [...table.rows, delimiter].flatMap((row) => {
    const cell = row.cells[column];
    if (!cell) return [];
    // A one-column header needs explicit pipes to remain a table, not a heading.
    if (table.columns === 2 && (row === table.rows[0] || row === delimiter)) {
      const remaining = row.cells[column === 0 ? 1 : 0];
      return [
        { from: row.from, to: row.to, insert: `| ${state.doc.sliceString(remaining.from, remaining.to)} |` },
      ];
    }
    // A short row may lose its only explicit cell. Keep an empty table row,
    // since a blank source line would split the table and detach following rows.
    if (row.cells.length === 1) return [{ from: row.from, to: row.to, insert: '| |' }];
    return [
      {
        from: column === 0 ? cell.from : row.cells[column - 1].to,
        to: column === 0 ? row.cells[1].from : cell.to,
        insert:
          column > 0 &&
          row.cells[column - 1].text.endsWith('\\') &&
          state.doc.sliceString(cell.to, cell.to + 1) === '|'
            ? ' '
            : '',
      },
    ];
  });
}
