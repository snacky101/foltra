import { expect, test } from 'vitest';
import { moveNoteHistory, recordNoteVisit, type NoteHistory, type NoteHistoryEntry } from './noteHistory';

const at = (id: string, head: number): NoteHistoryEntry => ({
  id,
  location: { anchor: head, head, scrollTop: head * 10 },
});
const empty = (): NoteHistory => ({ back: [], forward: [] });

test('back and forward restore every departure, including separate visits to the same note', () => {
  const visits = [at('A', 1), at('B', 2), at('A', 3), at('C', 4)];
  let history = visits.slice(0, -1).reduce(recordNoteVisit, empty());
  let current = visits.at(-1)!;
  for (const [direction, expected] of [
    ['back', 2],
    ['back', 1],
    ['back', 0],
    ['forward', 1],
    ['forward', 2],
    ['forward', 3],
  ] as const) {
    const result = moveNoteHistory(history, direction, current, () => true);
    expect(result.target).toEqual(visits[expected]);
    history = result.history;
    current = result.target!;
  }
  expect(history.forward).toEqual([]);
});

test('opening a new destination after going back clears only the old forward branch', () => {
  const a = at('A', 1),
    b = at('B', 2),
    c = at('C', 3),
    d = at('D', 4);
  const back = moveNoteHistory({ back: [a, b], forward: [] }, 'back', c, () => true);
  const branched = recordNoteVisit(back.history, b);
  expect(moveNoteHistory(branched, 'forward', d, () => true).target).toBeNull();
  expect(moveNoteHistory(branched, 'back', d, () => true).target).toEqual(b);
  expect(back.history.forward).toEqual([c]);
});

test.each(['back', 'forward'] as const)(
  '%s skips deleted destinations without recording them again',
  (direction) => {
    const a = at('A', 1),
      deleted = at('deleted', 2),
      current = at('C', 3);
    const history = { ...empty(), [direction]: [a, deleted] };
    const result = moveNoteHistory(history, direction, current, (id) => id !== 'deleted');
    expect(result.target).toEqual(a);
    const reverse = moveNoteHistory(result.history, direction === 'back' ? 'forward' : 'back', a, () => true);
    expect(reverse.target).toEqual(current);
    expect(history[direction]).toEqual([a, deleted]);
  },
);

test('reaching a boundary does not add spurious forward or backward visits', () => {
  const a = at('A', 1);
  expect(moveNoteHistory(empty(), 'forward', a, () => true)).toEqual({ history: empty(), target: null });
  const history = { back: [at('deleted', 2)], forward: [a] };
  expect(moveNoteHistory(history, 'back', a, (id) => id !== 'deleted')).toEqual({
    history: { back: [], forward: [a] },
    target: null,
  });
});

test('history remains bounded and a closed note is not recorded as a return destination', () => {
  let history = empty();
  for (let index = 0; index < 75; index++) history = recordNoteVisit(history, at(String(index), index));
  expect(history.back).toHaveLength(50);
  expect(history.back[0].id).toBe('25');
  const result = moveNoteHistory(history, 'back', null, () => true);
  expect(result.target?.id).toBe('74');
  expect(result.history.forward).toEqual([]);
});
