import { leaderMatches } from './leaderKey';
import { commandKey } from './commandKey';
import type { Binding, Settings } from './types';
export interface Command {
  id: string;
  title: string;
  group: string;
  bindings?: readonly Binding[];
  run: () => void | Promise<void>;
}

export function bindingsFor(command: Command, settings: Settings): readonly Binding[] {
  return settings.keybindings[command.id] ?? command.bindings ?? [];
}
export function bindingText(binding: Binding): string {
  return `${binding.leader ? '<leader>' : ''}${compactBinding(binding).keys}`;
}
export function parseBindingText(text: string): Binding | null {
  const value = text.trim();
  const leader = /^<leader>/i.test(value);
  const binding = { keys: leader ? value.slice(8).trim() : value, leader };
  return sequenceKeys(binding) || parseShortcut(binding.keys, platformModifier())
    ? compactBinding(binding)
    : null;
}
function compactBinding(binding: Binding): Binding {
  const keys = sequenceKeys(binding);
  if (!keys) return binding;
  const compact = { ...binding, keys };
  // Preserve legacy letter sequences whose compact spelling names a key (e.g. F 2).
  return sequenceKeys(compact) === keys ? compact : binding;
}
export function isRegularShortcut(binding: Binding): boolean {
  return !binding.leader && !!parseShortcut(binding.keys, platformModifier());
}
export function sequenceKeys(binding: Binding): string | null {
  if (parseShortcut(binding.keys, platformModifier())) return null;
  if (
    /^(enter|escape|tab|space|backspace|delete|insert|home|end|pageup|pagedown|arrow(left|right|up|down))$/i.test(
      binding.keys,
    )
  )
    return null;
  const keys = binding.keys.replaceAll(' ', '');
  const pattern = binding.leader ? /^[a-zA-Z0-9]{1,12}$/ : /^[a-zA-Z][a-zA-Z0-9]{0,11}$/;
  return binding.keys.length <= 80 && pattern.test(keys) ? keys : null;
}
export function bindingUsesLeader(binding: Binding, leader: string): boolean {
  if (binding.leader) return false;
  const shortcut = parseShortcut(binding.keys, platformModifier());
  const keys = sequenceKeys(binding);
  return leaderMatches(
    shortcut
      ? {
          key: shortcut.key,
          ctrlKey: shortcut.primary === 'ctrl',
          metaKey: shortcut.primary === 'meta',
          altKey: shortcut.alt,
          shiftKey: shortcut.shift,
        }
      : {
          key: keys?.[0] ?? '',
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: /^[A-Z]/.test(keys ?? ''),
        },
    leader,
  );
}
export function vimNormalBindings(commands: Command[], settings: Settings) {
  return commands.flatMap((command) =>
    bindingsFor(command, settings).flatMap((binding) => {
      const keys = sequenceKeys(binding);
      return !binding.leader && keys && !bindingUsesLeader(binding, settings.leader)
        ? [{ id: command.id, keys }]
        : [];
    }),
  );
}
export function leaderCandidates(commands: Command[], settings: Settings, pending: string) {
  return commands.flatMap((command) =>
    bindingsFor(command, settings)
      .filter((binding) => binding.leader && (sequenceKeys(binding)?.startsWith(pending) ?? pending === ''))
      .map((binding) => ({ command, binding })),
  );
}
export function platformModifier(): 'meta' | 'ctrl' {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? 'meta' : 'ctrl';
}
function parseShortcut(shortcut: string, mod: 'meta' | 'ctrl') {
  const tokens = shortcut.split('+');
  const letter = tokens.pop() ?? '';
  const key = letter.toLowerCase();
  const parts = tokens.map((part) => part.toLowerCase());
  if (!/^(?:[a-z0-9,.;/]|enter|f(?:[1-9]|1[0-2])|arrow(?:left|right|up|down))$/.test(key)) return null;
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
  const key = commandKey(event).toLowerCase();
  return (
    (key === binding.key || (binding.key === ';' && event.shiftKey && key === ':')) &&
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
  bindings: readonly Binding[],
  mod: 'meta' | 'ctrl' = platformModifier(),
): string | null {
  const others = commands
    .filter((command) => command.id !== id)
    .flatMap((command) =>
      bindingsFor(command, settings).map((binding) => ({ binding, title: command.title })),
    );
  for (const binding of bindings) {
    if (
      !binding.keys ||
      binding.keys.length > 80 ||
      (!sequenceKeys(binding) && !parseShortcut(binding.keys, mod))
    )
      return 'gd, Mod+Enter, Ctrl+h 또는 F2 형식으로 입력하세요. 연속 키는 영문·숫자 최대 12개이며 Leader 없이 사용할 때는 영문으로 시작합니다.';
    if (bindingUsesLeader(binding, settings.leader))
      return '현재 Leader 키와 충돌합니다. 다른 키 조합을 지정하세요.';
    for (const other of others) {
      if (binding.leader !== other.binding.leader) continue;
      const a = sequenceKeys(binding),
        b = sequenceKeys(other.binding);
      const shortcut = parseShortcut(binding.keys, mod);
      if (
        (a && b && (a.startsWith(b) || b.startsWith(a))) ||
        (shortcut && JSON.stringify(shortcut) === JSON.stringify(parseShortcut(other.binding.keys, mod)))
      )
        return `키 조합이 “${other.title}”과 충돌합니다.`;
    }
    others.push({ binding, title: '같은 기능의 다른 조합' });
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
  return !composing && (!editable || (inEditor && vim && (mode === 'NORMAL' || mode === 'VISUAL')));
}
