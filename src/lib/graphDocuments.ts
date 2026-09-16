import { unresolvedWikiNames } from './wikiLinks';
import type { Workspace } from './types';

export function graphDocuments(workspace: Workspace) {
  const notes = workspace.notes.map(({ id, title }) => ({ id, title, unresolved: false }));
  const missing = new Map<string, string>();
  if (workspace.settings.showUnresolvedLinks) {
    for (const name of unresolvedWikiNames(workspace)) {
      const id = `unresolved:${name}`;
      missing.set(name, id);
      notes.push({ id, title: name, unresolved: true });
    }
  }
  const links = workspace.links.map(({ source, target, name }) => ({
    source,
    target: target ?? missing.get(name) ?? null,
  }));
  return { notes, links };
}
