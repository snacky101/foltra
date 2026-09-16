import { expect, test } from 'vitest';
import { cursorShapeForMode } from './cursorAppearance';

test('an explicit shape stays fixed in every mode when Vim overrides are off', () => {
  for (const cursorShape of ['bar', 'block', 'underline'] as const) {
    for (const mode of ['edit', 'normal', 'visual', 'insert', 'replace'] as const) {
      expect(cursorShapeForMode({ cursorShape, cursorFollowVim: false }, mode)).toBe(cursorShape);
    }
  }
});

test('Vim overrides affect command and replace modes while respecting the chosen input shape', () => {
  for (const cursorShape of ['bar', 'block', 'underline'] as const) {
    const settings = { cursorShape, cursorFollowVim: true };
    expect(cursorShapeForMode(settings, 'edit')).toBe(cursorShape);
    expect(cursorShapeForMode(settings, 'insert')).toBe(cursorShape);
    expect(cursorShapeForMode(settings, 'normal')).toBe('block');
    expect(cursorShapeForMode(settings, 'visual')).toBe('block');
    expect(cursorShapeForMode(settings, 'replace')).toBe('underline');
  }
});
