import type { Workspace } from './types';

export function noteLinks(workspace: Pick<Workspace, 'notes' | 'links'>) {
  // Record-to-body edges describe ownership; only note sources contain wiki links.
  const noteIds = new Set(workspace.notes.map((note) => note.id));
  return workspace.links.filter((link) => noteIds.has(link.source));
}
