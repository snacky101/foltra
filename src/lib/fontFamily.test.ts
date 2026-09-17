import { expect, test } from 'vitest';
import { fontFamilyStack } from './fontFamily';

test('default removes the override and generic choices remain generic', () => {
  expect(fontFamilyStack()).toBeUndefined();
  expect(fontFamilyStack('')).toBeUndefined();
  for (const value of ['system-ui', 'sans-serif', 'serif', 'monospace'])
    expect(fontFamilyStack(value)).toBe(`${value}, var(--body-font)`);
});

test('installed font names are one literal family with a local fallback', () => {
  expect(fontFamilyStack('Apple SD Gothic Neo')).toBe('"Apple SD Gothic Neo", var(--body-font)');
  expect(fontFamilyStack('본고딕')).toBe('"본고딕", var(--body-font)');
  expect(fontFamilyStack('inherit')).toBe('"inherit", var(--body-font)');
  expect(fontFamilyStack('Menlo, serif')).toBe('"Menlo, serif", var(--body-font)');
  expect(fontFamilyStack('A"B\\C')).toBe('"A\\"B\\\\C", var(--body-font)');
});
