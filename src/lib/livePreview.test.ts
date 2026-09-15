import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { expect, test } from 'vitest';
import { livePreviewDecorations } from './livePreview';
import type { Workspace } from './types';

const workspace = {
  notes: [],
  records: [],
  databases: [],
  links: [],
  extensions: [],
} as unknown as Workspace;
function state(doc: string, anchor = doc.length) {
  return EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ extensions: [GFM] })] });
}
function replacements(s: EditorState) {
  const ranges: { from: number; to: number; block: boolean }[] = [];
  livePreviewDecorations(s, { workspace, openNote: () => {} }).between(0, s.doc.length, (from, to, value) => {
    if (from < to && value.spec.class === undefined) ranges.push({ from, to, block: !!value.spec.block });
  });
  return ranges;
}
test('live preview hides inactive Markdown syntax without modifying the document', () => {
  const doc = '# Header\n\n**bold** and `code`\n\nEditing';
  const s = state(doc);
  expect(replacements(s).length).toBeGreaterThanOrEqual(5);
  expect(s.doc.toString()).toBe(doc);
  const active = s.update({ selection: { anchor: 3 } }).state;
  expect(replacements(active).some((r) => r.from === 0)).toBe(false);
});
test('block previews reveal their original source when selected', () => {
  const doc = 'Before\n\n```foltra-query\n{"databaseId":"test"}\n```\n\nAfter';
  const s = state(doc);
  const block = replacements(s).find((r) => r.block)!;
  expect(block).toBeDefined();
  expect(replacements(s.update({ selection: { anchor: block.from + 4 } }).state).some((r) => r.block)).toBe(
    false,
  );
  expect(s.doc.toString()).toBe(doc);
});
test('multiline selections expose syntax rather than concealing selected text', () => {
  const s = state('# Header\n\n**bold**\n\nEnd');
  const selected = s.update({ selection: EditorSelection.range(0, s.doc.length) }).state;
  expect(replacements(selected)).toEqual([]);
});

test('wiki labels replace both bracket pairs and UUIDs outside the active line', () => {
  const text = '[[4fb36615-31ce-43ef-b775-30c5295f190b|연결된 노트]]에서 이어갑니다.\n\nEdit';
  const s = state(text);
  expect(replacements(s)).toContainEqual({ from: 0, to: text.indexOf(']]') + 2, block: false });
  expect(replacements(s.update({ selection: { anchor: 5 } }).state)).toEqual([]);
});

test('title-based live links show the custom alias while retaining the actual target', () => {
  const text = '[[노트이름|foo | bar]]\n\nEdit';
  const s = state(text);
  const links: { target: string; label: string }[] = [];
  livePreviewDecorations(s, { workspace, openNote: () => {} }).between(
    0,
    s.doc.length,
    (_from, _to, value) => {
      if (value.spec.widget?.wiki) links.push(value.spec.widget);
    },
  );
  expect(links).toHaveLength(1);
  expect(links[0].target).toBe('노트이름');
  expect(links[0].label).toBe('foo | bar');
  expect(s.doc.toString()).toBe(text);
});
