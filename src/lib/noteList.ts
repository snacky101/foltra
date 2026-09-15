import type { NoteSummary } from './types';

export interface NoteListOptions {
  search: string;
  folder: string;
  sort: 'updatedAt' | 'createdAt' | 'title';
}

export const defaultNoteListOptions: NoteListOptions = {
  search: '',
  folder: 'all',
  sort: 'updatedAt',
};

export function filterNoteList(notes: NoteSummary[], options: NoteListOptions): NoteSummary[] {
  const search = options.search.trim().normalize('NFC').toLocaleLowerCase();
  return notes
    .filter(
      (note) =>
        (options.folder === 'all' || (note.folderId ?? '') === options.folder) &&
        note.title.normalize('NFC').toLocaleLowerCase().includes(search),
    )
    .sort((a, b) => {
      const titleOrder = a.title.localeCompare(b.title, 'ko', { numeric: true });
      return (
        (options.sort === 'title'
          ? titleOrder
          : b[options.sort].localeCompare(a[options.sort]) || titleOrder) || a.id.localeCompare(b.id)
      );
    });
}
