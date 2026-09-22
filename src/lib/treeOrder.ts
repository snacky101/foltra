import type { Folder, NoteSummary, Workspace } from './types';
export type TreeEntry = { kind: 'note'; item: NoteSummary } | { kind: 'folder'; item: Folder };
export function treeChildren(workspace: Workspace, parentId: string | null): TreeEntry[] {
  const folders: TreeEntry[] = workspace.folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => ({ kind: 'folder', item }));
  const notes: TreeEntry[] = workspace.notes
    .filter(
      (note) =>
        (note.folderId ?? null) === parentId ||
        (parentId === null &&
          note.folderId &&
          !workspace.folders.some((folder) => folder.id === note.folderId)),
    )
    .map((item) => ({ kind: 'note', item }));
  const entries = [...folders, ...notes];
  if (!workspace.settings?.treeCustomSort) return entries;
  const rank = new Map((workspace.settings.treeOrder ?? []).map((id, index) => [id, index]));
  return entries.sort((a, b) => (rank.get(a.item.id) ?? Infinity) - (rank.get(b.item.id) ?? Infinity));
}
export function savedTreeOrder(workspace: Workspace): string[] {
  const ids = new Set([...workspace.folders, ...workspace.notes].map((item) => item.id));
  const walk = (parent: string | null): string[] =>
    treeChildren(workspace, parent).flatMap((entry) => [
      entry.item.id,
      ...(entry.kind === 'folder' ? walk(entry.item.id) : []),
    ]);
  return [...new Set([...(workspace.settings?.treeOrder ?? []).filter((id) => ids.has(id)), ...walk(null)])];
}
export function reorderTree(workspace: Workspace, source: string, target: string, after: boolean): string[] {
  const order = savedTreeOrder(workspace).filter((id) => id !== source);
  const at = order.indexOf(target);
  if (at < 0 || source === target) return order;
  order.splice(at + Number(after), 0, source);
  return order;
}
