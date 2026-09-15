type KeyStroke = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };
const specialKey =
  /^(?:Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Left|Right|Up|Down)|F(?:[1-9]|1\d|2[0-4]))$/;
const printable = (key: string) => Array.from(key).length === 1 && !/[\p{Cc}\p{Cf}]/u.test(key);
const modifiers = [
  ['Ctrl', 'ctrlKey'],
  ['Meta', 'metaKey'],
  ['Alt', 'altKey'],
  ['Shift', 'shiftKey'],
] as const;

export function parseLeaderKey(value: string): KeyStroke | null {
  let key = value;
  const stroke: KeyStroke = { key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
  if (!printable(value)) {
    for (const [name, flag] of modifiers) {
      if (key.startsWith(`${name}+`)) {
        stroke[flag] = true;
        key = key.slice(name.length + 1);
      }
    }
  }
  if (key === 'Space') key = ' ';
  if (!printable(key) && !specialKey.test(key)) return null;
  return { ...stroke, key };
}

export function recordLeaderKey(
  event: KeyStroke & Pick<KeyboardEvent, 'isComposing' | 'keyCode' | 'repeat'>,
): string | null {
  if (event.isComposing || event.keyCode === 229 || event.repeat) return null;
  if (!printable(event.key) && !specialKey.test(event.key)) return null;
  const parts = modifiers.filter(([, flag]) => event[flag]).map(([name]) => name);
  if (!parts.length) return event.key;
  const key = event.key === ' ' ? 'Space' : printable(event.key) ? event.key.toLowerCase() : event.key;
  return [...parts, key].join('+');
}

export function leaderMatches(event: KeyStroke, value: string): boolean {
  const expected = parseLeaderKey(value);
  if (!expected) return false;
  // Old literal characters include case/punctuation produced with Shift or Caps Lock.
  if (printable(value)) return event.key === value && !event.ctrlKey && !event.metaKey && !event.altKey;
  return (
    event.key.toLowerCase() === expected.key.toLowerCase() &&
    modifiers.every(([, flag]) => event[flag] === expected[flag])
  );
}

export function leaderLabel(value: string): string {
  return value === ' ' ? 'Space' : value;
}
