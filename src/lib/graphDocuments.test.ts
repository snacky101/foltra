import { expect, test } from 'vitest';
import { graphDocuments } from './graphDocuments';
import type { Workspace } from './types';

test('graph groups unresolved aliases by destination and hides them without altering links', () => {
  const workspace = {
    notes: [{ id: 'source', title: 'Journal' }],
    links: [
      { source: 'source', target: null, name: 'Foo', label: '첫 별칭' },
      { source: 'source', target: null, name: 'Foo', label: '다른 별칭' },
    ],
    settings: { showUnresolvedLinks: true },
  } as unknown as Workspace;
  const before = JSON.stringify(workspace);
  const visible = graphDocuments(workspace);
  expect(visible.notes).toEqual([
    { id: 'source', title: 'Journal', unresolved: false },
    { id: 'unresolved:Foo', title: 'Foo', unresolved: true },
  ]);
  expect(visible.links.map((link) => link.target)).toEqual(['unresolved:Foo', 'unresolved:Foo']);
  const hidden = graphDocuments({
    ...workspace,
    settings: { ...workspace.settings, showUnresolvedLinks: false },
  });
  expect(hidden.notes).toHaveLength(1);
  expect(hidden.links.map((link) => link.target)).toEqual([null, null]);
  expect(JSON.stringify(workspace)).toBe(before);
  const resolved = graphDocuments({
    ...workspace,
    notes: [...workspace.notes, { ...workspace.notes[0], id: 'foo', title: 'Foo' }],
    links: workspace.links.map((link) => ({ ...link, target: 'foo' })),
  });
  expect(resolved.notes.some((note) => note.unresolved)).toBe(false);
  expect(resolved.links.map((link) => link.target)).toEqual(['foo', 'foo']);
});
