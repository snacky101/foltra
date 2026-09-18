import { expect, test } from 'vitest';
import manifest from '../../examples/plugins/daily-calendar.json';
import { extensionCatalog } from './extensionCatalog';
import { bindingConflict } from './commands';
import { createBuiltinCommands, type BuiltinCommandId } from './builtinCommands';
import type { Settings } from './types';

test('daily note creation is part of the calendar with configurable, nonconflicting defaults', () => {
  expect(extensionCatalog.find((item) => item.id === 'daily-calendar')).toBe(manifest);
  expect(extensionCatalog.some((item) => item.id === 'daily-notes')).toBe(false);
  const contribution = manifest.commands.find((command) => command.id === 'open-today')!;
  expect(contribution.bindings).toEqual([
    { keys: 'Mod+Shift+d', leader: false },
    { keys: 'nd', leader: true },
  ]);
  const command = {
    id: 'plugin.daily-calendar.open-today',
    title: contribution.title,
    group: manifest.name,
    bindings: contribution.bindings,
    run() {},
  };
  const settings = { leader: ' ', keybindings: {} } as Settings;
  const commands = [...createBuiltinCommands({} as Record<BuiltinCommandId, () => void>), command];
  expect(bindingConflict(commands, settings, command.id, contribution.bindings!, 'meta')).toBeNull();
  expect(bindingConflict(commands, settings, command.id, contribution.bindings!, 'ctrl')).toBeNull();
});
