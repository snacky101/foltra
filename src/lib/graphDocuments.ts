import { filterFolderNotes } from './folderFilter';
import { unresolvedWikiNames } from './wikiLinks';
import type { Workspace } from './types';

export function graphDocuments(workspace: Workspace) {
  const sourceNotes = filterFolderNotes(workspace.notes, workspace.folders ?? [], workspace.settings.graphFolders ?? { include: [], exclude: [] });
  const ids = new Set(sourceNotes.map((note) => note.id));
  const sourceLinks = workspace.links.filter((link) => ids.has(link.source) && (!link.target || ids.has(link.target)));
  const notes = sourceNotes.map(({ id, title }) => ({ id, title, unresolved: false }));
  const missing = new Map<string, string>();
  if (workspace.settings.showUnresolvedLinks) {
    for (const name of unresolvedWikiNames({ ...workspace, notes: sourceNotes, links: sourceLinks })) {
      const id = `unresolved:${name}`;
      missing.set(name, id);
      notes.push({ id, title: name, unresolved: true });
    }
  }
  const links = sourceLinks.map(({ source, target, name }) => ({
    source,
    target: target ?? missing.get(name) ?? null,
  }));
  return { notes, links };
}
