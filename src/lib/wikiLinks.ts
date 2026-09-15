import type { NoteSummary } from './types';

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
