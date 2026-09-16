import { expect, test } from 'vitest';
import { commandKey } from './commandKey';

test('Korean normal-mode commands retain case and resolve punctuation and counts', () => {
  for (const [key, code, result] of [
    ['ㅑ', 'KeyI', 'i'],
    ['ㅐ', 'KeyO', 'o'],
    ['ㅍ', 'KeyV', 'v'],
    ['Process', 'Digit2', '2'],
    ['Unidentified', 'Space', ' '],
  ])
    expect(commandKey({ key, code, shiftKey: false })).toBe(result);
  for (const [code, result] of [
    ['KeyI', 'I'],
    ['KeyO', 'O'],
    ['Semicolon', ':'],
    ['Slash', '?'],
    ['Digit4', '$'],
    ['BracketLeft', '{'],
  ])
    expect(commandKey({ key: 'Process', code, shiftKey: true })).toBe(result);
});
test('Latin layouts, dead keys and unknown physical keys are not remapped', () => {
  expect(commandKey({ key: 'a', code: 'KeyQ', shiftKey: false })).toBe('a');
  expect(commandKey({ key: 'Dead', code: 'Quote', shiftKey: false })).toBe('Dead');
  expect(commandKey({ key: 'Process', code: '', shiftKey: false })).toBe('Process');
});

test('IME composition command events resolve empty, dead and multi-codepoint keys', () => {
  for (const key of ['', 'Dead', '하', '한글']) {
    expect(commandKey({ key, code: 'KeyJ', shiftKey: false, isComposing: true, keyCode: 229 })).toBe('j');
    expect(commandKey({ key, code: 'KeyK', shiftKey: true, isComposing: true })).toBe('K');
  }
  expect(commandKey({ key: 'Dead', code: 'Quote', shiftKey: false })).toBe('Dead');
  expect(commandKey({ key: 'a', code: 'KeyQ', shiftKey: false, isComposing: true })).toBe('a');
});
