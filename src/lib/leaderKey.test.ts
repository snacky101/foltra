import { expect, test } from 'vitest';
import { leaderMatches, parseLeaderKey, recordLeaderKey } from './leaderKey';
import { bindingConflict } from './commands';
const key = (value: string, patch: Partial<KeyboardEvent> = {}) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  isComposing: false,
  keyCode: 0,
  repeat: false,
  ...patch,
});

test('recorded keys and chords match exactly, including space, shifted punctuation and function keys', () => {
  for (const event of [
    key(' '),
    key(';'),
    key('\\'),
    key('+', { shiftKey: true }),
    key(' ', { ctrlKey: true }),
    key('K', { metaKey: true, shiftKey: true }),
    key('F9'),
    key('ArrowRight', { altKey: true }),
  ]) {
    const saved = recordLeaderKey(event)!;
    expect(saved).not.toBeNull();
    expect(parseLeaderKey(saved)).not.toBeNull();
    expect(leaderMatches(event, saved)).toBe(true);
    expect(leaderMatches({ ...event, ctrlKey: !event.ctrlKey }, saved)).toBe(false);
  }
  expect(recordLeaderKey(key(' ', { ctrlKey: true }))).toBe('Ctrl+Space');
  expect(recordLeaderKey(key('K', { metaKey: true, shiftKey: true }))).toBe('Meta+Shift+k');
});
test('recording ignores cancellation keys, modifier-only events, repeat, dead keys and IME', () => {
  for (const event of [
    key('Escape'),
    key('Tab'),
    key('Shift'),
    key('Control'),
    key('Dead'),
    key('Process'),
    key('a', { repeat: true }),
    key('a', { isComposing: true }),
    key('한', { keyCode: 229 }),
  ])
    expect(recordLeaderKey(event)).toBeNull();
});
test('malformed settings cannot become leader triggers and legacy literal leaders remain valid', () => {
  for (const value of [
    '',
    '\n',
    '\u200b',
    'Ctrl+Ctrl+a',
    'Alt+Ctrl+a',
    'F01',
    'F+1',
    'F25',
    'Ctrl+Escape',
    'abc',
  ])
    expect(parseLeaderKey(value)).toBeNull();
  for (const value of [' ', ',', '\\']) expect(leaderMatches(key(value), value)).toBe(true);
});
test('a normal shortcut cannot silently replace the recorded leader', () => {
  const settings = {
    vim: false,
    editorMode: 'live' as const,
    slash: false,
    lineNumbers: 'none' as const,
    databaseFontSize: 14,
    editorFontFamily: '',
    databaseFontFamily: '',
    topicFolders: { include: [], exclude: [] },
    cursorShape: 'bar' as const,
    cursorFollowVim: true,
    cursorBlink: 'blink' as const,
    cursorBlinkRate: 600,
    cursorAnimation: 'none' as const,
    showUnresolvedLinks: true,
    leader: 'Meta+k',
    theme: 'paper',
    keybindings: {},
  };
  expect(bindingConflict([], settings, 'test', [{ keys: 'Mod+k', leader: false }], 'meta')).toContain(
    'Leader',
  );
  expect(bindingConflict([], settings, 'test', [{ keys: 'Ctrl+k', leader: false }], 'meta')).toBeNull();
});
