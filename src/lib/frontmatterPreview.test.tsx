import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { GFM } from '@lezer/markdown';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { livePreviewDecorations } from './livePreview';
import { frontmatterRange } from './frontmatter';
import { noteTags } from './noteTags';
import { markdownListLayout } from './markdownListLayout';
import { NotePreview } from '../components/NotePreview';
import type { Workspace } from './types';

const workspace = { notes: [], records: [], databases: [], links: [] } as unknown as Workspace;
const context = { workspace, openNote() {}, openLink() {} };
function state(doc: string, anchor = doc.length) {
  const state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [yamlFrontmatter({ content: markdown({ extensions: [GFM] }) })],
  });
  expect(ensureSyntaxTree(state, doc.length, 100)).not.toBeNull();
  // Publish completed parsing to the immutable state before reading syntaxTree().
  return state.update({}).state;
}
const header = '---\ntags: [study, 한글]\nstatus: draft\nitems:\n  - "#fake [[Missing]]"\n---';

test('live preview replaces only frontmatter while retaining normal Markdown body layout', () => {
  const s = state(`${header}\n\n# Heading\n\n- item\n\nEditing #real`);
  const ranges: { from: number; to: number; name: string; block: boolean }[] = [];
  livePreviewDecorations(s, context).between(0, s.doc.length, (from, to, decoration) => {
    ranges.push({ from, to, name: decoration.spec.class ?? '', block: !!decoration.spec.block });
  });
  expect(ranges.filter((range) => range.from < header.length)).toEqual([
    { from: 0, to: header.length, name: '', block: true },
  ]);
  expect(ranges.some((range) => range.name.includes('cm-live-h1'))).toBe(true);
  expect(ranges.some((range) => range.name.includes('cm-live-list-line'))).toBe(true);
  expect(noteTags(s.doc.toString(), syntaxTree(s)).map((tag) => tag.name)).toEqual(['real']);
  expect([...markdownListLayout(s.doc, syntaxTree(s)).lines.keys()]).toEqual([10]);
  expect(s.doc.toString()).toBe(`${header}\n\n# Heading\n\n- item\n\nEditing #real`);
});

test('cursor entry and multiline selection reveal editable YAML without changing text', () => {
  const s = state(`${header}\n\nBody`, 10);
  for (const current of [s, s.update({ selection: EditorSelection.range(0, s.doc.length) }).state]) {
    const replacements: number[] = [];
    livePreviewDecorations(current, context).between(0, header.length, (from, to, value) => {
      if (from < to && value.spec.block) replacements.push(from);
    });
    expect(replacements).toEqual([]);
    expect(current.doc.toString()).toBe(s.doc.toString());
  }
});

test('reading shows properties as data, not headings, lists, tags, links or executable HTML', () => {
  const body = `${header}\n\n# Heading\n\nPlain body`;
  const html = renderToStaticMarkup(<NotePreview body={body} {...context} />);
  expect(html).toContain('frontmatter-panel');
  expect(html).toContain('status');
  expect(html).toContain('draft');
  expect(html).toContain('<h1>Heading</h1>');
  expect(html).toContain('<p>Plain body</p>');
  expect(html).not.toContain('<ul>');
  expect(html).not.toContain('wiki-link');
  expect(html).not.toContain('tag-chip');
  expect(html).not.toContain('<hr');
  const untrusted = renderToStaticMarkup(
    <NotePreview body={'---\nx: "<script>alert(1)</script>"\n---\nText'} {...context} />,
  );
  expect(untrusted).not.toContain('<script>');
});

test('invalid YAML is visible as an error and leaves the remaining body readable', () => {
  const body = '---\nx: [unfinished\n---\n\n# Still here';
  const html = renderToStaticMarkup(<NotePreview body={body} {...context} />);
  expect(html).toContain('role="alert"');
  expect(html).toContain('x: [unfinished');
  expect(html).toContain('<h1>Still here</h1>');
  expect(frontmatterRange(body)?.yaml).toBe('x: [unfinished\n');
});

test('notes without frontmatter still render headers and lists with the language wrapper', () => {
  const s = state('# Heading\n\n- item\n\nText');
  const classes: string[] = [];
  livePreviewDecorations(s, context).between(0, s.doc.length, (_from, _to, value) => {
    classes.push(value.spec.class ?? '');
  });
  expect(classes.some((value) => value.includes('cm-live-h1'))).toBe(true);
  expect(classes.some((value) => value.includes('cm-live-list-line'))).toBe(true);
});
