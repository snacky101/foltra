import { expect, test } from 'vitest';
import { filterFolderNotes } from './folderFilter';
import { graphDocuments } from './graphDocuments';
import type { Workspace, NoteSummary, Folder } from './types';
const folders = [
  { id: 'a', parentId: null },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: null },
] as Folder[];
const notes = [
  { id: 'root', title: 'root' },
  { id: 'a', title: 'a', folderId: 'a' },
  { id: 'b', title: 'b', folderId: 'b' },
  { id: 'c', title: 'c', folderId: 'c' },
] as NoteSummary[];
const ids = (include: string[], exclude: string[]) =>
  filterFolderNotes(notes, folders, { include, exclude }).map((note) => note.id);
test('folder scope includes descendants, excludes first, and distinguishes root from all folders', () => {
  expect(ids([], [])).toEqual(['root', 'a', 'b', 'c']);
  expect(ids(['a'], [])).toEqual(['a', 'b']);
  expect(ids(['a'], ['b'])).toEqual(['a']);
  expect(ids(['b'], ['a'])).toEqual([]);
  expect(ids([''], [])).toEqual(['root']);
  expect(ids([], [''])).toEqual(['a', 'b', 'c']);
  expect(ids(['missing'], [])).toEqual([]);
});
test('graph removes excluded endpoints and only shows unresolved links from included notes', () => {
  const workspace = {
    notes,
    folders,
    settings: { graphFolders: { include: ['a'], exclude: ['b'] }, showUnresolvedLinks: true },
    links: [
      { source: 'a', target: 'c', name: 'c' },
      { source: 'b', target: null, name: 'hidden' },
      { source: 'a', target: null, name: 'visible' },
    ],
  } as unknown as Workspace;
  const graph = graphDocuments(workspace);
  expect(graph.notes.map((note) => note.id)).toEqual(['a', 'unresolved:visible']);
  expect(graph.links).toEqual([{ source: 'a', target: 'unresolved:visible' }]);
});
