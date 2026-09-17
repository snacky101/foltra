import { describe, it, expect } from 'vitest';
import { createBuiltinCommands, type BuiltinCommandId } from './builtinCommands';
import {
  bindingConflict,
  bindingsFor,
  bindingText,
  parseBindingText,
  isRegularShortcut,
  canStartLeader,
  sequenceKeys,
  shortcutMatches,
  vimNormalBindings,
  bindingUsesLeader,
} from './commands';

it('gd and Mod+Enter have separate commands and can be rebound independently', () => {
  const commands = createBuiltinCommands({} as Record<BuiltinCommandId, () => void>);
  const existing = commands.find((command) => command.id === 'note.follow-existing-link')!;
  const create = commands.find((command) => command.id === 'note.follow-link')!;
  expect(bindingsFor(existing, settings)).toEqual([{ keys: 'gd', leader: false }]);
  expect(bindingsFor(create, settings)).toEqual([{ keys: 'Mod+Enter', leader: false }]);
  expect(vimNormalBindings(commands, settings)).toContainEqual({ id: existing.id, keys: 'gd' });
  expect(vimNormalBindings(commands, settings).some((binding) => binding.id === create.id)).toBe(false);
  const custom = { ...settings, keybindings: { [existing.id]: [{ keys: 'go', leader: true }] } };
  expect(bindingsFor(existing, custom)).toEqual([{ keys: 'go', leader: true }]);
  expect(bindingsFor(create, custom)).toEqual(create.bindings);
});
const settings = {
  vim: true,
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
  leader: ' ',
  theme: 'paper',
  keybindings: {},
};
describe('keyboard routing contract', () => {
  it('property addition has its own configurable shortcut and preserves the YAML edit command', () => {
    const commands = createBuiltinCommands({} as Record<BuiltinCommandId, () => void>);
    const add = commands.find((command) => command.id === 'note.frontmatter.add')!;
    const edit = commands.find((command) => command.id === 'note.frontmatter.edit')!;
    expect(bindingsFor(add, settings)).toEqual([{ keys: 'Mod+;', leader: false }]);
    expect(parseBindingText('Mod+;')).toEqual({ keys: 'Mod+;', leader: false });
    expect(
      shortcutMatches(
        { key: 'Process', code: 'Semicolon', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        'Mod+;',
        'meta',
      ),
    ).toBe(true);
    expect(bindingsFor(edit, settings)).toEqual([]);
    expect(
      bindingsFor(add, { ...settings, keybindings: { [add.id]: [{ keys: 'pa', leader: true }] } }),
    ).toEqual([{ keys: 'pa', leader: true }]);
    expect(bindingsFor(add, { ...settings, keybindings: { [add.id]: [] } })).toEqual([]);
  });
  it.each([':', 'Process'])('matches Shift+; without treating it as the unshifted shortcut (%s)', (key) => {
    const event = {
      key,
      code: 'Semicolon',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    };
    expect(parseBindingText('Mod+Shift+;')).toEqual({ keys: 'Mod+Shift+;', leader: false });
    expect(shortcutMatches(event, 'Mod+Shift+;', 'meta')).toBe(true);
    expect(shortcutMatches(event, 'Mod+;', 'meta')).toBe(false);
    expect(shortcutMatches({ ...event, key: ';', shiftKey: false }, 'Mod+Shift+;', 'meta')).toBe(false);
  });
  it.each([
    ['note.back', 'Ctrl+o', 'KeyO', 'ㅐ'],
    ['note.forward', 'Ctrl+i', 'KeyI', 'ㅑ'],
  ])('exposes %s as a configurable shortcut, including Korean physical keys', (id, keys, code, key) => {
    const commands = createBuiltinCommands({} as Record<BuiltinCommandId, () => void>);
    const command = commands.find((command) => command.id === id)!;
    expect(bindingsFor(command, settings)).toEqual([{ keys, leader: false }]);
    expect(
      shortcutMatches({ key, code, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, keys),
    ).toBe(true);
    const custom = { ...settings, keybindings: { [id]: [{ keys: 'bb', leader: true }] } };
    expect(bindingsFor(command, custom)).toEqual([{ keys: 'bb', leader: true }]);
    expect(bindingsFor(command, { ...settings, keybindings: { [id]: [] } })).toEqual([]);
    expect(
      shortcutMatches(
        { key: 'Tab', code: 'Tab', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false },
        keys,
      ),
    ).toBe(false);
  });
  it('normalizes old separator spaces without changing key order, modifiers or case', () => {
    for (const binding of [
      { keys: 'Mod+Enter', leader: false },
      { keys: 'g d', leader: false },
      { keys: 'f', leader: true },
      { keys: 'r N', leader: true },
      { keys: 'Mod+Enter', leader: true },
    ]) {
      expect(parseBindingText(bindingText(binding))).toEqual({
        ...binding,
        keys: binding.keys.replaceAll(' ', ''),
      });
    }
    expect(bindingText({ keys: 'f', leader: true })).toBe('<leader>f');
    expect(bindingText({ keys: 'f g', leader: true })).toBe('<leader>fg');
    expect(bindingText({ keys: 'g d', leader: false })).toBe('gd');
    expect(parseBindingText('<leader> f g')).toEqual({ keys: 'fg', leader: true });
    expect(parseBindingText('<leader>fg')).toEqual({ keys: 'fg', leader: true });
    expect(parseBindingText('g D')).toEqual({ keys: 'gD', leader: false });
    expect(parseBindingText('  <Leader> gD  ')).toEqual({ keys: 'gD', leader: true });
    expect(isRegularShortcut(parseBindingText('Mod+Enter')!)).toBe(true);
    expect(isRegularShortcut(parseBindingText('<leader>Mod+Enter')!)).toBe(false);
    expect(isRegularShortcut(parseBindingText('g d')!)).toBe(false);
  });
  it('does not turn a legacy letter sequence into a different named key while formatting', () => {
    for (const binding of [
      { keys: 'F 2', leader: true },
      { keys: 'E n t e r', leader: false },
    ]) {
      expect(parseBindingText(bindingText(binding))).toEqual(binding);
    }
    expect(parseBindingText('F2')).toEqual({ keys: 'F2', leader: false });
    expect(isRegularShortcut(parseBindingText('F2')!)).toBe(true);
  });
  it('rejects incomplete or misplaced leader tokens and resolves the typed prefix into routing', () => {
    for (const value of ['', '<leader>', '<leader><leader>f', 'g <leader>d', '<lead>f', '<leader>g\\nd']) {
      expect(parseBindingText(value)).toBeNull();
    }
    const command = { id: 'test', title: 'test', group: 'test', run: () => {} };
    const binding = parseBindingText('<leader>f')!;
    const current = { ...settings, keybindings: { test: [binding] } };
    expect(vimNormalBindings([command], current)).toEqual([]);
    expect(bindingConflict([command], current, 'other', [parseBindingText('<leader>f f')!])).toContain(
      '충돌',
    );
    const unprefixed = { ...settings, keybindings: { test: [parseBindingText('g d')!] } };
    expect(vimNormalBindings([command], unprefixed)).toEqual([{ id: 'test', keys: 'gd' }]);
  });
  const followLink = {
    id: 'note.follow-link',
    title: '링크 열기',
    group: '노트',
    bindings: [
      { keys: 'g d', leader: false },
      { keys: 'Mod+Enter', leader: false },
    ],
    run: () => {},
  };
  it('switches the same sequence between Leader and Normal without changing its keys', () => {
    const binding = { keys: 'g d', leader: false };
    const current = { ...settings, keybindings: { [followLink.id]: [binding] } };
    expect(vimNormalBindings([followLink], current)).toEqual([{ id: followLink.id, keys: 'gd' }]);
    const prefixed = { ...current, keybindings: { [followLink.id]: [{ ...binding, leader: true }] } };
    expect(vimNormalBindings([followLink], prefixed)).toEqual([]);
    expect(bindingsFor(followLink, prefixed)).toEqual([{ keys: 'g d', leader: true }]);
    expect(vimNormalBindings([followLink], { ...settings, keybindings: { [followLink.id]: [] } })).toEqual(
      [],
    );
    expect(bindingsFor(followLink, settings)).toEqual(followLink.bindings);
  });
  it('compares prefixes within each Leader mode and rejects duplicates on the same command', () => {
    for (const keys of ['gd', 'g d x', 'g']) {
      expect(bindingConflict([followLink], settings, 'plugin.test.run', [{ keys, leader: false }])).toContain(
        '충돌',
      );
      expect(bindingConflict([followLink], settings, 'plugin.test.run', [{ keys, leader: true }])).toBeNull();
    }
    expect(
      bindingConflict([followLink], settings, 'plugin.test.run', [{ keys: 'g D', leader: false }]),
    ).toBeNull();
    expect(
      bindingConflict([], settings, followLink.id, [
        { keys: 'g d', leader: true },
        { keys: 'gd', leader: true },
      ]),
    ).toContain('같은 기능');
    const plugin = { id: 'plugin.test.run', title: '확장 실행', group: '확장', run: () => {} };
    const custom = { ...settings, keybindings: { [plugin.id]: [{ keys: 'g o', leader: false }] } };
    expect(vimNormalBindings([followLink, plugin], custom)).toContainEqual({ id: plugin.id, keys: 'go' });
    expect(
      bindingConflict([followLink, plugin], custom, followLink.id, [{ keys: 'go', leader: false }]),
    ).toContain('확장 실행');
  });
  it('validates sequence syntax and excludes prefixed shortcuts from Leader-key conflicts', () => {
    for (const keys of ['2gd', '<Esc>', '가', 'g\nd', 'abcdefghijklm', ' '.repeat(81)]) {
      expect(sequenceKeys({ keys, leader: false })).toBeNull();
      expect(bindingConflict([], settings, followLink.id, [{ keys, leader: false }])).not.toBeNull();
    }
    expect(sequenceKeys({ keys: ' g D ', leader: false })).toBe('gD');
    expect(sequenceKeys({ keys: '1 a', leader: true })).toBe('1a');
    for (const [keys, leader, conflict] of [
      ['gd', 'g', true],
      ['Gd', 'g', false],
      ['Gd', 'Shift+g', true],
      ['gd', 'Ctrl+g', false],
    ] as const) {
      expect(bindingUsesLeader({ keys, leader: false }, leader)).toBe(conflict);
      expect(bindingUsesLeader({ keys, leader: true }, leader)).toBe(false);
      expect(!!bindingConflict([], { ...settings, leader }, followLink.id, [{ keys, leader: false }])).toBe(
        conflict,
      );
    }
    expect(bindingConflict([], settings, followLink.id, [{ keys: 'Mod+Enter', leader: true }])).toBeNull();
  });
  it('matches modified Enter and allows saving it while keeping bare Enter reserved for typing', () => {
    const event = {
      key: 'Enter',
      code: 'Enter',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    };
    expect(shortcutMatches(event, 'Mod+Enter', 'meta')).toBe(true);
    expect(shortcutMatches({ ...event, code: 'NumpadEnter' }, 'Mod+Enter', 'meta')).toBe(true);
    expect(shortcutMatches({ ...event, shiftKey: true }, 'Mod+Enter', 'meta')).toBe(false);
    expect(shortcutMatches({ ...event, metaKey: false }, 'Mod+Enter', 'meta')).toBe(false);
    expect(shortcutMatches({ ...event, metaKey: false, ctrlKey: true }, 'Mod+Enter', 'ctrl')).toBe(true);
    expect(
      bindingConflict([], settings, 'note.follow-link', [{ keys: 'Mod+Enter', leader: false }], 'meta'),
    ).toBeNull();
    expect(
      bindingConflict([], settings, 'note.follow-link', [{ keys: 'Enter', leader: false }], 'meta'),
    ).not.toBeNull();
    const commands = [
      {
        id: 'note.follow-link',
        title: '링크 열기',
        group: '노트',
        bindings: [{ keys: 'Mod+Enter', leader: false }],
        run: () => {},
      },
    ];
    expect(
      bindingConflict(commands, settings, 'other', [{ keys: 'Meta+Enter', leader: false }], 'meta'),
    ).toContain('충돌');
  });
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
      {
        id: 'palette',
        title: '팔레트',
        group: '탐색',
        bindings: [{ keys: 'Mod+Shift+k', leader: false }],
        run: () => {},
      },
    ];
    expect(
      bindingConflict(commands, settings, 'focus.up', [{ keys: 'Shift+Meta+k', leader: false }], 'meta'),
    ).toContain('충돌');
    expect(
      bindingConflict(commands, settings, 'focus.up', [{ keys: 'Ctrl+k', leader: false }], 'meta'),
    ).toBeNull();
    expect(
      bindingConflict(commands, settings, 'focus.up', [{ keys: 'Mod+Ctrl+k', leader: false }], 'ctrl'),
    ).not.toBeNull();
    expect(
      bindingConflict(commands, settings, 'focus.up', [{ keys: 'H', leader: false }], 'ctrl'),
    ).toBeNull();
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
        bindings: [
          { keys: 'n n', leader: true },
          { keys: 'Mod+n', leader: false },
        ],
        group: 'Notes',
        run: () => {},
      },
    ];
    expect(bindingConflict(commands, settings, 'plugin.test', [{ keys: 'n', leader: true }])).toContain(
      '충돌',
    );
    expect(bindingConflict(commands, settings, 'plugin.test', [{ keys: 'Mod+n', leader: false }])).toContain(
      '충돌',
    );
    expect(
      bindingConflict(commands, settings, 'plugin.test', [
        { keys: 'v t', leader: true },
        { keys: 'Mod+Shift+t', leader: false },
      ]),
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
        bindings: [
          { keys: 'Ctrl+H', leader: false },
          { keys: 'r n', leader: true },
        ],
        run: () => {},
      },
    ];
    expect(bindingConflict(commands, settings, 'other', [{ keys: 'Ctrl+h', leader: false }])).toBeNull();
    expect(bindingConflict(commands, settings, 'other', [{ keys: 'Ctrl+Shift+h', leader: false }])).toContain(
      '충돌',
    );
    expect(bindingConflict(commands, settings, 'other', [{ keys: 'R n', leader: true }])).toBeNull();
  });
});
