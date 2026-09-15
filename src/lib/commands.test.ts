import { describe, it, expect } from 'vitest';
import { bindingConflict, canStartLeader, shortcutMatches } from './commands';
const settings = {
  vim: true,
  editorMode: 'live' as const,
  slash: false,
  leader: ' ',
  theme: 'paper',
  keybindings: {},
};
describe('keyboard routing contract', () => {
  it('preserves Korean composition and spaces in inputs', () => {
    expect(canStartLeader(true, true, true, true, 'NORMAL')).toBe(false);
    expect(canStartLeader(false, true, true, true, 'INSERT')).toBe(false);
    expect(canStartLeader(false, true, false, true, 'NORMAL')).toBe(false);
    expect(canStartLeader(false, false, false, false, 'NORMAL')).toBe(true);
    expect(canStartLeader(false, true, true, true, 'NORMAL')).toBe(true);
  });
  it('does not swallow extra modifiers', () => {
    expect(
      shortcutMatches(
        { key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false },
        'Mod+k',
        'meta',
      ),
    ).toBe(true);
    expect(
      shortcutMatches(
        { key: 'K', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false },
        'Mod+k',
        'meta',
      ),
    ).toBe(false);
  });
  it('distinguishes literal Ctrl from platform Mod and validates modifier aliases', () => {
    const ctrl = { key: 'k', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
    expect(shortcutMatches(ctrl, 'Ctrl+k', 'meta')).toBe(true);
    expect(shortcutMatches(ctrl, 'Mod+k', 'meta')).toBe(false);
    expect(shortcutMatches(ctrl, 'Mod+k', 'ctrl')).toBe(true);
    expect(shortcutMatches({ ...ctrl, metaKey: true }, 'Ctrl+k', 'meta')).toBe(false);
    const commands = [
      { id: 'palette', title: '팔레트', group: '탐색', binding: { shortcut: 'Mod+Shift+k' }, run: () => {} },
    ];
    expect(bindingConflict(commands, settings, 'focus.up', { shortcut: 'Shift+Meta+k' }, 'meta')).toContain(
      '충돌',
    );
    expect(bindingConflict(commands, settings, 'focus.up', { shortcut: 'Ctrl+k' }, 'meta')).toBeNull();
    expect(
      bindingConflict(commands, settings, 'focus.up', { shortcut: 'Mod+Ctrl+k' }, 'ctrl'),
    ).not.toBeNull();
    expect(bindingConflict(commands, settings, 'focus.up', { shortcut: 'H' }, 'ctrl')).not.toBeNull();
  });
  it('matches Korean and IME key values to the physical modified letter key', () => {
    for (const [letter, korean] of [
      ['h', 'ㅗ'],
      ['j', 'ㅓ'],
      ['k', 'ㅏ'],
      ['l', 'ㅣ'],
    ]) {
      for (const key of [korean, 'Process', 'Unidentified']) {
        const event = {
          key,
          code: `Key${letter.toUpperCase()}`,
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        };
        expect(shortcutMatches(event, `Ctrl+${letter}`, 'meta')).toBe(true);
        expect(shortcutMatches({ ...event, shiftKey: true }, `Ctrl+${letter}`, 'meta')).toBe(false);
        expect(shortcutMatches({ ...event, metaKey: true }, `Ctrl+${letter}`, 'meta')).toBe(false);
        expect(shortcutMatches({ ...event, ctrlKey: false }, `Ctrl+${letter}`, 'meta')).toBe(false);
      }
    }
  });
  it('preserves Latin keyboard layouts and does not guess unidentified physical keys', () => {
    const event = { key: 'j', code: 'KeyH', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
    expect(shortcutMatches(event, 'Ctrl+j', 'meta')).toBe(true);
    expect(shortcutMatches(event, 'Ctrl+h', 'meta')).toBe(false);
    expect(shortcutMatches({ ...event, key: 'Process', code: '' }, 'Ctrl+h', 'meta')).toBe(false);
    expect(shortcutMatches({ ...event, key: 'Dead' }, 'Ctrl+h', 'meta')).toBe(false);
    expect(shortcutMatches({ ...event, key: 'ㅗ', altKey: true }, 'Ctrl+h', 'meta')).toBe(false);
    expect(shortcutMatches({ ...event, key: 'ㅗ', shiftKey: true }, 'Ctrl+Shift+h', 'meta')).toBe(true);
  });
  it('rejects exact and ambiguous prefix mappings for extensions', () => {
    const commands = [
      {
        id: 'note.new',
        title: 'New note',
        binding: { leader: 'n n', shortcut: 'Mod+n' },
        group: 'Notes',
        run: () => {},
      },
    ];
    expect(bindingConflict(commands, settings, 'plugin.test', { leader: 'n' })).toContain('충돌');
    expect(bindingConflict(commands, settings, 'plugin.test', { shortcut: 'Mod+n' })).toContain('충돌');
    expect(
      bindingConflict(commands, settings, 'plugin.test', { leader: 'v t', shortcut: 'Mod+Shift+t' }),
    ).toBeNull();
  });
  it('distinguishes lowercase from uppercase and canonicalizes explicit Shift for conflicts', () => {
    const event = { key: 'h', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
    expect(shortcutMatches(event, 'Ctrl+h')).toBe(true);
    expect(shortcutMatches(event, 'Ctrl+H')).toBe(false);
    expect(shortcutMatches({ ...event, key: 'H', shiftKey: true }, 'Ctrl+h')).toBe(false);
    expect(shortcutMatches({ ...event, key: 'H', shiftKey: true }, 'Ctrl+H')).toBe(true);
    const commands = [
      {
        id: 'test',
        title: 'test',
        group: 'test',
        binding: { shortcut: 'Ctrl+H', leader: 'r n' },
        run: () => {},
      },
    ];
    expect(bindingConflict(commands, settings, 'other', { shortcut: 'Ctrl+h' })).toBeNull();
    expect(bindingConflict(commands, settings, 'other', { shortcut: 'Ctrl+Shift+h' })).toContain('충돌');
    expect(bindingConflict(commands, settings, 'other', { leader: 'R n' })).toBeNull();
  });
});
