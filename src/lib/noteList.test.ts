import { describe, expect, it } from 'vitest';
import type { NoteSummary } from './types';
import { defaultNoteListOptions, filterNoteList } from './noteList';

const notes: NoteSummary[] = [
  {
    id: 'root',
    title: 'Note 10',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    revision: 'r1',
  },
  {
    id: 'folder',
    title: 'Note 2',
    folderId: 'projects',
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    revision: 'r2',
  },
  {
    id: 'nested',
    title: '한글 노트',
    folderId: 'design',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    revision: 'r3',
  },
  {
    id: 'null-root',
    title: '다른 기록',
    folderId: null,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    revision: 'r4',
  },
];
const ids = (value: NoteSummary[]) => value.map((note) => note.id);

describe('all notes listing', () => {
  it('includes every folder and sorts recent updates without mutating the workspace', () => {
    const before = structuredClone(notes);
    expect(ids(filterNoteList(notes, defaultNoteListOptions))).toEqual([
      'folder',
      'root',
      'nested',
      'null-root',
    ]);
    expect(notes).toEqual(before);
  });
  it('combines title search with an exact folder, including root notes with absent or null folderId', () => {
    expect(
      ids(filterNoteList(notes, { ...defaultNoteListOptions, search: '  nOTE ', folder: 'projects' })),
    ).toEqual(['folder']);
    expect(ids(filterNoteList(notes, { ...defaultNoteListOptions, folder: '' }))).toEqual([
      'root',
      'null-root',
    ]);
    expect(filterNoteList(notes, { ...defaultNoteListOptions, search: 'Note', folder: 'design' })).toEqual(
      [],
    );
    expect(
      ids(filterNoteList(notes, { ...defaultNoteListOptions, search: '한글'.normalize('NFD') })),
    ).toEqual(['nested']);
  });
  it('supports creation date and natural title order, with deterministic ties', () => {
    expect(ids(filterNoteList(notes, { ...defaultNoteListOptions, sort: 'createdAt' }))).toEqual([
      'null-root',
      'nested',
      'folder',
      'root',
    ]);
    expect(ids(filterNoteList(notes.slice(0, 2), { ...defaultNoteListOptions, sort: 'title' }))).toEqual([
      'folder',
      'root',
    ]);
    const twins = [
      { ...notes[0], id: 'b' },
      { ...notes[0], id: 'a' },
    ];
    expect(ids(filterNoteList(twins, defaultNoteListOptions))).toEqual(['a', 'b']);
  });
  it('derives the list from each current snapshot after rename, move or deletion', () => {
    const options = { ...defaultNoteListOptions, search: 'Note', folder: 'projects' };
    expect(
      filterNoteList(
        notes.filter((n) => n.id !== 'folder'),
        options,
      ),
    ).toEqual([]);
    expect(
      filterNoteList(
        notes.map((n) => (n.id === 'folder' ? { ...n, title: '설계' } : n)),
        options,
      ),
    ).toEqual([]);
    expect(
      filterNoteList(
        notes.map((n) => (n.id === 'folder' ? { ...n, folderId: null } : n)),
        options,
      ),
    ).toEqual([]);
  });
});
