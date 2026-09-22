import type { Folder, FolderFilter, NoteSummary } from './types';

// Root selects only unfiled notes; a folder includes all its descendants. Exclusions win.
export function filterFolderNotes<T extends NoteSummary>(
  notes: T[],
  folders: Folder[],
  filter: FolderFilter,
): T[] {
  const parents = new Map(folders.map((folder) => [folder.id, folder.parentId]));
  return notes.filter((note) => {
    const path = new Set<string>();
    let id: string | null = note.folderId ?? '';
    while (id !== null && !path.has(id)) {
      path.add(id);
      id = id ? (parents.get(id) ?? null) : null;
    }
    return (
      (!filter.include.length || filter.include.some((id) => path.has(id))) &&
      !filter.exclude.some((id) => path.has(id))
    );
  });
}
