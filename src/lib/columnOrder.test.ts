import { expect, test } from 'vitest';
import { moveColumn, orderedColumns, readColumnOrder } from './columnOrder';
import type { Property } from './types';

const properties: Property[] = [
  { id: 'title', name: 'Name', type: 'text' },
  { id: 'score', name: 'Score', type: 'number' },
  { id: 'status', name: 'Status', type: 'status' },
];

test('saved column order tolerates invalid storage without accepting duplicate or invalid IDs', () => {
  for (const raw of [null, '', '{', '{}', '42', 'null']) expect(readColumnOrder(raw)).toEqual([]);
  expect(readColumnOrder('["score","title","score",null,7,"",{},"status"]')).toEqual([
    'score',
    'title',
    'status',
  ]);
});

test('display order reconciles removed and newly added columns without mutating schema objects', () => {
  const before = JSON.stringify(properties);
  const renamed: Property = { ...properties[1], name: 'Updated score' };
  const current = [properties[0], renamed, properties[2]];
  const ordered = orderedColumns(current, ['deleted', 'score', 'score', 'title']);
  expect(ordered.map((property) => property.id)).toEqual(['score', 'title', 'status']);
  expect(ordered[0]).toBe(renamed);
  expect(current.map((property) => property.id)).toEqual(['title', 'score', 'status']);
  expect(JSON.stringify(properties)).toBe(before);
});

test('moveColumn inserts on either side in both directions and leaves invalid or unchanged drops alone', () => {
  const order = ['title', 'score', 'status'];
  expect(moveColumn(order, 'title', 'status', 'after')).toEqual(['score', 'status', 'title']);
  expect(moveColumn(order, 'status', 'title', 'before')).toEqual(['status', 'title', 'score']);
  expect(moveColumn(order, 'title', 'status', 'before')).toEqual(['score', 'title', 'status']);
  expect(moveColumn(order, 'status', 'title', 'after')).toEqual(['title', 'status', 'score']);
  expect(moveColumn(order, 'title', 'title', 'after')).toEqual(order);
  expect(moveColumn(order, 'missing', 'title', 'before')).toEqual(order);
  expect(moveColumn(order, 'title', 'missing', 'after')).toEqual(order);
  expect(moveColumn(order, 'score', 'status', 'before')).toEqual(order);
  expect(order).toEqual(['title', 'score', 'status']);
});
