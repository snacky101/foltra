import type { EditorLocation } from './editorLocation';

export interface NoteHistoryEntry {
  id: string;
  location: EditorLocation | null;
}

export interface NoteHistory {
  back: NoteHistoryEntry[];
  forward: NoteHistoryEntry[];
}

export function recordNoteVisit(history: NoteHistory, departure: NoteHistoryEntry): NoteHistory {
  return { back: [...history.back.slice(-49), departure], forward: [] };
}

export function moveNoteHistory(
  history: NoteHistory,
  direction: 'back' | 'forward',
  departure: NoteHistoryEntry | null,
  exists: (id: string) => boolean,
): { history: NoteHistory; target: NoteHistoryEntry | null } {
  const remaining = [...history[direction]];
  let target = remaining.pop();
  while (target && !exists(target.id)) target = remaining.pop();
  const opposite = direction === 'back' ? 'forward' : 'back';
  return {
    target: target ?? null,
    history: {
      ...history,
      [direction]: remaining,
      [opposite]:
        target && departure && exists(departure.id)
          ? [...history[opposite].slice(-49), departure]
          : history[opposite],
    },
  };
}
