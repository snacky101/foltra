import type { NoteSummary, Workspace } from './types';

export function splitWikiLink(inside: string): [target: string, label: string] {
  const separator = inside.indexOf('|');
  return separator < 0 ? [inside, inside] : [inside.slice(0, separator), inside.slice(separator + 1)];
}

export function resolveWikiNote(notes: NoteSummary[], target: string | null): NoteSummary | undefined {
  if (!target) return;
  const byId = notes.find((note) => note.id === target);
  if (byId) return byId;
  if (target.startsWith('record:')) return;
  const matches = notes.filter((note) => note.title === target);
  return matches.length === 1 ? matches[0] : undefined;
}

export function canCreateWikiNote(notes: NoteSummary[], target: string) {
  return (
    !!target &&
    target.trim() === target &&
    Array.from(target).length <= 240 &&
    !/[\[\]|#\n\r\\]/.test(target) &&
    !target.startsWith('record:') &&
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(target) &&
    !notes.some((note) => note.title === target || note.id === target)
  );
}

export function wikiNoteReference(notes: NoteSummary[], note: NoteSummary) {
  const readable = !/[\[\]|#\n\r\\]/.test(note.title) && resolveWikiNote(notes, note.title)?.id === note.id;
  return {
    target: readable ? note.title : note.id,
    alias: readable ? undefined : note.title.replace(/[\[\]\n\r\\]/g, ' '),
  };
}

export function unresolvedWikiNames(workspace: Workspace) {
  return [
    ...new Set(
      workspace.links
        .filter((link) => !link.target && canCreateWikiNote(workspace.notes, link.name))
        .map((link) => link.name),
    ),
  ];
}
