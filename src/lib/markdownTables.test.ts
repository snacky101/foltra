import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { expect, test } from 'vitest';
import {
  insertTableColumn,
  insertTableRow,
  changeTableCell,
  deleteTableColumn,
  deleteTableRow,
  markdownTables,
} from './markdownTables';

function state(doc: string) {
  return EditorState.create({ doc, extensions: [markdown({ extensions: [GFM] })] });
}

test.each(['| A | B |\n| --- | :---: |\n| one | two |\n| | |', 'A | B\n---|---\none | two\n| | |'])(
  'reads real and empty cells without changing source: %s',
  (doc) => {
    const s = state(doc),
      table = markdownTables(s)[0];
    expect(table.columns).toBe(2);
    expect(table.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ['A', 'B'],
      ['one', 'two'],
      ['', ''],
    ]);
    expect(s.doc.toString()).toBe(doc);
  },
);

test('editing a cell preserves alignment, surrounding Markdown and extra cells', () => {
  const s = state('Before\n\n| A | B |\n| :-- | --: |\n|  old  | keep | hidden |\n\nAfter');
  const t = markdownTables(s)[0];
  const next = s.update({ changes: changeTableCell(s, t, 1, 0, '새 내용') }).state;
  expect(next.doc.toString()).toBe(s.doc.toString().replace('old', '새 내용'));
});

test.each(['left | right', 'x\\|y', 'x\\\\|y', '**bold** [[Note|alias]]', '한글'])(
  'cell input %j round trips without adding columns',
  (value) => {
    const s = state('| A | B |\n| --- | --- |\n| | |');
    const next = s.update({ changes: changeTableCell(s, markdownTables(s)[0], 1, 0, value) }).state;
    const t = markdownTables(next)[0];
    expect(t.rows[1].cells.map((c) => c.text)).toEqual([value, '']);
    expect(t.columns).toBe(2);
  },
);

test('short rows gain missing cells only on an edit and newlines cannot split the row', () => {
  const s = state('A | B | C\n---|---|---\nonly');
  const t = markdownTables(s)[0];
  expect(t.rows[1].cells).toHaveLength(1);
  const next = s.update({ changes: changeTableCell(s, t, 1, 2, 'a\nb') }).state;
  expect(markdownTables(next)[0].rows[1].cells.map((c) => c.text)).toEqual(['only', '', 'a b']);
  expect(next.doc.lines).toBe(3);
});

test.each(['', '> ', '  '])('appending a row preserves the table continuation prefix %j', (prefix) => {
  const s = state(`${prefix}| A | B |\n${prefix}| --- | --- |\n${prefix}| x | y |\n\nAfter`);
  const next = s.update({
    changes: insertTableRow(s, markdownTables(s)[0], markdownTables(s)[0].rows.length),
  }).state;
  expect(next.doc.toString()).toContain(`| x | y |\n${prefix}|  |  |\n\nAfter`);
  expect(markdownTables(next)[0].rows).toHaveLength(3);
});

test('a trailing backslash in a compact row cannot consume its closing pipe', () => {
  const s = state('|A|B|\n|---|---|\n|x|y|');
  const next = s.update({ changes: changeTableCell(s, markdownTables(s)[0], 1, 0, 'path\\') }).state;
  expect(markdownTables(next)[0].rows[1].cells.map((c) => c.text)).toEqual(['path\\', 'y']);
});

test('quoted table preview strips container markers but edits preserve them', () => {
  const s = state('> | A | B |\n> | --- | --- |\n> | old | keep |');
  const table = markdownTables(s)[0];
  expect(table.body).toBe('| A | B |\n| --- | --- |\n| old | keep |');
  const next = s.update({ changes: changeTableCell(s, table, 1, 0, 'new') }).state;
  expect(next.doc.toString()).toBe(s.doc.toString().replace('old', 'new'));
});

test.each(['', '> ', '  '])('deleting a row preserves adjacent source and container %j', (prefix) => {
  const doc = `Before\n\n${prefix}| A | B |\n${prefix}| :--- | ---: |\n${prefix}| delete | this |\n${prefix}| keep | me |\n\nAfter`;
  const s = state(doc);
  const next = s.update({ changes: deleteTableRow(s, markdownTables(s)[0], 1)! }).state;
  expect(next.doc.toString()).toBe(doc.replace(`${prefix}| delete | this |\n`, ''));
  expect(markdownTables(next)[0].rows).toHaveLength(2);
});

test('deleting the final row at EOF keeps a valid header-only table without an extra line', () => {
  const header = '| A | B |\n| :--- | ---: |';
  const s = state(`${header}\n| last | row |`);
  const next = s.update({ changes: deleteTableRow(s, markdownTables(s)[0], 1)! }).state;
  expect(next.doc.toString()).toBe(header);
  expect(markdownTables(next)[0].rows).toHaveLength(1);
  expect(deleteTableRow(next, markdownTables(next)[0], 0)).toBeNull();
});

test.each(['| A | B |\n| :--- | ---: |\n| left | right |', 'A | B\n:--- | ---:\nleft | right'])(
  'appending a column keeps source cells and alignment: %s',
  (body) => {
    const s = state(`Before\n\n${body}\n\nAfter`);
    const next = s.update({
      changes: insertTableColumn(s, markdownTables(s)[0], markdownTables(s)[0].columns),
    }).state;
    const table = markdownTables(next)[0];
    expect(table.columns).toBe(3);
    expect(table.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['A', 'B', ''],
      ['left', 'right', ''],
    ]);
    expect(next.doc.toString()).toContain(':--- | ---:');
    expect(next.doc.toString().startsWith('Before\n\n')).toBe(true);
    expect(next.doc.toString().endsWith('\n\nAfter')).toBe(true);
  },
);

test.each(['', '> ', '  '])('new columns preserve the container prefix %j and empty rows', (prefix) => {
  const s = state(`${prefix}| A | B |\n${prefix}| :--- | ---: |\n${prefix}| | |`);
  const next = s.update({
    changes: insertTableColumn(s, markdownTables(s)[0], markdownTables(s)[0].columns),
  }).state;
  expect(next.doc.toString()).toBe(
    `${prefix}| A | B |  |\n${prefix}| :--- | ---: | --- |\n${prefix}| | |  |`,
  );
  expect(markdownTables(next)[0].rows[1].cells.map((c) => c.text)).toEqual(['', '', '']);
});

test('new columns fill short rows and preserve escaped pipes and surplus hidden cells', () => {
  const s = state('| A | B |\n| --- | --- |\nonly\\\n| a\\|b | **keep** | hidden | extra |');
  const next = s.update({
    changes: insertTableColumn(s, markdownTables(s)[0], markdownTables(s)[0].columns),
  }).state;
  const table = markdownTables(next)[0];
  expect(table.rows[1].cells.map((c) => c.text)).toEqual(['only\\', '', '']);
  expect(table.rows[2].cells.map((c) => c.text)).toEqual(['a|b', '**keep**', '', 'hidden', 'extra']);
  expect(next.doc.toString()).toContain('a\\|b | **keep**');
});

test('new columns also work in a header-only table', () => {
  const s = state('| A |\n| --- |');
  const next = s.update({
    changes: insertTableColumn(s, markdownTables(s)[0], markdownTables(s)[0].columns),
  }).state;
  expect(markdownTables(next)[0].columns).toBe(2);
  expect(markdownTables(next)[0].rows).toHaveLength(1);
});

test.each([0, 1])('inserting above the header or first data row preserves the table header: %s', (row) => {
  const s = state('> | A | B |\n> | :--- | ---: |\n> | keep | me |');
  const next = s.update({ changes: insertTableRow(s, markdownTables(s)[0], row) }).state;
  expect(next.doc.toString()).toBe('> | A | B |\n> | :--- | ---: |\n> |  |  |\n> | keep | me |');
  expect(markdownTables(next)[0].rows).toHaveLength(3);
});

test.each([0, 1, 2])('deleting column %s preserves other cells, alignment and surrounding text', (column) => {
  const s = state(
    'Before\n\n> | A | B | C |\n> | :--- | :---: | ---: |\n> | a\\|b | **bold** | 한글 |\n\nAfter',
  );
  const next = s.update({ changes: deleteTableColumn(s, markdownTables(s)[0], column) }).state;
  const table = markdownTables(next)[0];
  expect(table.columns).toBe(2);
  expect(table.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
    ['A', 'B', 'C'].filter((_, i) => i !== column),
    ['a|b', '**bold**', '한글'].filter((_, i) => i !== column),
  ]);
  expect(next.doc.sliceString(table.delimiter.from, table.delimiter.to).match(/:?-+:?/g)).toEqual(
    [':---', ':---:', '---:'].filter((_, i) => i !== column),
  );
  expect(next.doc.toString().startsWith('Before\n\n> ')).toBe(true);
  expect(next.doc.toString().endsWith('\n\nAfter')).toBe(true);
});

test.each([0, 1])('two bare columns can become one valid column: delete %s', (column) => {
  const s = state('A | B\n:--- | ---:\none | two');
  const next = s.update({ changes: deleteTableColumn(s, markdownTables(s)[0], column) }).state;
  const table = markdownTables(next)[0];
  expect(table.columns).toBe(1);
  expect(table.rows.map((r) => r.cells.map((c) => c.text))).toEqual(
    column === 0 ? [['B'], ['two']] : [['A'], ['one']],
  );
  expect(deleteTableColumn(next, table, 0)).toEqual([]);
});

test('column deletion cannot turn an adjacent backslash into an escaped delimiter', () => {
  const s = state('| A | B | C |\n| --- | --- | --- |\n|path\\ |delete|keep|');
  const next = s.update({ changes: deleteTableColumn(s, markdownTables(s)[0], 1) }).state;
  expect(markdownTables(next)[0].rows[1].cells.map((c) => c.text)).toEqual(['path\\', 'keep']);
});

test('deleting from short rows keeps the table continuous and surplus cells hidden', () => {
  const s = state('| A | B |\n| --- | --- |\nonly\n| a | b | hidden |\n| | |');
  const next = s.update({ changes: deleteTableColumn(s, markdownTables(s)[0], 0) }).state;
  const table = markdownTables(next)[0];
  expect(table.columns).toBe(1);
  expect(table.rows).toHaveLength(4);
  expect(table.rows[1].cells[0].text).toBe('');
  expect(table.rows[2].cells.map((c) => c.text)).toEqual(['b', 'hidden']);
});

test.each([0, 1])(
  'inserting column %s shifts cells and alignment together without altering their contents',
  (column) => {
    const s = state('| A | B |\n| :--- | ---: |\n| a\\|b | **keep** |');
    const next = s.update({ changes: insertTableColumn(s, markdownTables(s)[0], column) }).state;
    const table = markdownTables(next)[0];
    const cells = ['a|b', '**keep**'];
    cells.splice(column, 0, '');
    expect(table.rows[1].cells.map((c) => c.text)).toEqual(cells);
    const alignment = [':---', '---:'];
    alignment.splice(column, 0, '---');
    expect(next.doc.sliceString(table.delimiter.from, table.delimiter.to).match(/:?-+:?/g)).toEqual(
      alignment,
    );
  },
);
