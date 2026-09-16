import { expect, test } from 'vitest';
import { cursorTrail, followCursor } from './cursorMotion';

test('cursor movement is independent of frame rate and settles exactly at the target', () => {
  const target = { x: 520, y: 370 };
  const advance = (step: number) => {
    let point = { x: 0, y: 0 };
    for (let elapsed = 0; elapsed < 100; elapsed += step) point = followCursor(point, target, step, 30);
    return point;
  };
  expect(advance(10).x).toBeCloseTo(advance(20).x, 8);
  expect(advance(10).y).toBeCloseTo(advance(20).y, 8);
  let point = advance(10);
  for (let frame = 0; frame < 60; frame++) point = followCursor(point, target, 1000 / 60, 30);
  expect(point).toEqual(target);
  expect(followCursor(target, { x: -200, y: -100 }, 10000, 30)).toEqual({ x: -200, y: -100 });
});

test('rapid direction changes continue from the visible cursor without overshooting', () => {
  const start = followCursor({ x: 0, y: 0 }, { x: 300, y: 200 }, 16, 30);
  const next = followCursor(start, { x: -300, y: -200 }, 16, 30);
  expect(next.x).toBeLessThan(start.x);
  expect(next.x).toBeGreaterThan(-300);
  expect(next.y).toBeLessThan(start.y);
  expect(next.y).toBeGreaterThan(-200);
  expect(followCursor(start, next, 0, 30)).toEqual(start);
});

test('smear tapers in horizontal, vertical and diagonal directions and disappears at rest', () => {
  const head = { x: 80, y: 120, width: 10, height: 20 };
  expect(cursorTrail(head, head)).toBe('');
  for (const tail of [
    { x: 10, y: 120 },
    { x: 80, y: 20 },
    { x: 150, y: 250 },
  ]) {
    const points = cursorTrail(head, tail)
      .split(' ')
      .map((p) => p.split(',').map(Number));
    expect(points).toHaveLength(4);
    expect(points.flat().every(Number.isFinite)).toBe(true);
    expect(Math.hypot(points[1][0] - points[2][0], points[1][1] - points[2][1])).toBeCloseTo(2);
    expect((points[0][0] + points[3][0]) / 2).toBe(head.x + head.width / 2);
  }
});
