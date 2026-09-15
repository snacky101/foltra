import { leaderMatches } from './leaderKey';
import { commandKey } from './commandKey';
import type { Binding, Settings } from './types';
export interface Command {
  id: string;
  title: string;
  group: string;
  binding?: Binding;
  run: () => void | Promise<void>;
}

export function bindingsFor(command: Command, settings: Settings): Binding {
  return settings.keybindings[command.id] ?? command.binding ?? {};
}
export function platformModifier(): 'meta' | 'ctrl' {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? 'meta' : 'ctrl';
}
function parseShortcut(shortcut: string, mod: 'meta' | 'ctrl') {
  const tokens = shortcut.split('+');
  const letter = tokens.pop() ?? '';
  const key = letter.toLowerCase();
  const parts = tokens.map((part) => part.toLowerCase());
  if (!/^(?:[a-z0-9,./]|f(?:[1-9]|1[0-2])|arrow(?:left|right|up|down))$/.test(key)) return null;
  if (
    parts.some((part) => !['mod', 'ctrl', 'meta', 'shift', 'alt'].includes(part)) ||
    new Set(parts).size !== parts.length
  )
    return null;
  const primary = parts.filter((part) => ['mod', 'ctrl', 'meta'].includes(part));
  if (primary.length > 1 || (!primary.length && !/^f\d+$/.test(key))) return null;
  return {
    key,
    primary: primary[0] === 'mod' ? mod : primary[0],
    shift: parts.includes('shift') || /^[A-Z]$/.test(letter),
    alt: parts.includes('alt'),
  };
}
export function shortcutMatches(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'> &
    Partial<Pick<KeyboardEvent, 'code'>>,
  shortcut: string,
  mod: 'meta' | 'ctrl' = platformModifier(),
): boolean {
  const binding = parseShortcut(shortcut, mod);
  if (!binding) return false;
  return (
    commandKey(event).toLowerCase() === binding.key &&
    event.metaKey === (binding.primary === 'meta') &&
    event.ctrlKey === (binding.primary === 'ctrl') &&
    event.shiftKey === binding.shift &&
    event.altKey === binding.alt
  );
}
export function bindingConflict(
  commands: Command[],
  settings: Settings,
  id: string,
  binding: Binding,
  mod: 'meta' | 'ctrl' = platformModifier(),
): string | null {
  if (binding.leader && !/^[a-zA-Z0-9 ]{1,12}$/.test(binding.leader))
    return 'Leader 조합은 영문·숫자·공백으로 입력하세요. 대소문자를 구분합니다.';
  if (binding.shortcut && !parseShortcut(binding.shortcut, mod))
    return 'Mod+k, Ctrl+h, Meta+Shift+k 또는 F2 형식으로 입력하세요.';
  const shortcut = binding.shortcut ? parseShortcut(binding.shortcut, mod) : null;
  if (
    shortcut &&
    leaderMatches(
      {
        key: shortcut.key,
        ctrlKey: shortcut.primary === 'ctrl',
        metaKey: shortcut.primary === 'meta',
        shiftKey: shortcut.shift,
        altKey: shortcut.alt,
      },
      settings.leader,
    )
  )
    return '현재 Leader 키와 충돌합니다. 다른 단축키를 지정하세요.';
  for (const command of commands) {
    if (command.id === id) continue;
    const other = bindingsFor(command, settings);
    const a = binding.leader?.replaceAll(' ', '');
    const b = other.leader?.replaceAll(' ', '');
    if (a && b && (a.startsWith(b) || b.startsWith(a)))
      return `Leader 조합이 “${command.title}”과 충돌합니다.`;
    if (
      binding.shortcut &&
      other.shortcut &&
      JSON.stringify(parseShortcut(other.shortcut, mod)) ===
        JSON.stringify(parseShortcut(binding.shortcut, mod))
    )
      return `일반 단축키가 “${command.title}”과 충돌합니다.`;
  }
  return null;
}
export function canStartLeader(
  composing: boolean,
  editable: boolean,
  inEditor: boolean,
  vim: boolean,
  mode: string,
): boolean {
  return !composing && (!editable || (inEditor && vim && mode === 'NORMAL'));
}
