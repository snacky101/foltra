// Resolve command keys while a non-Latin input source is active. Text inputs must
// keep the original event; Latin keyboard layouts continue to use event.key.
export function commandKey(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey'> & Partial<Pick<KeyboardEvent, 'code'>>,
): string {
  const { key, code = '', shiftKey } = event;
  if (!(
    (Array.from(key).length === 1 && /[^\x00-\x7f]/.test(key)) ||
    key === 'Process' ||
    key === 'Unidentified'
  ))
    return key;
  if (/^Key[A-Z]$/.test(code)) return shiftKey ? code.slice(3) : code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return shiftKey ? ')!@#$%^&*('[Number(code.at(-1))] : code.slice(5);
  const punctuation: Record<string, string> = {
    Backquote: '`~',
    Minus: '-_',
    Equal: '=+',
    BracketLeft: '[{',
    BracketRight: ']}',
    Backslash: '\\|',
    Semicolon: ';:',
    Quote: '\'"',
    Comma: ',<',
    Period: '.>',
    Slash: '/?',
  };
  if (punctuation[code]) return punctuation[code][shiftKey ? 1 : 0];
  if (code === 'Space') return ' ';
  if (/^(Escape|Enter|Backspace|Delete|Tab|Arrow(Left|Right|Up|Down))$/.test(code)) return code;
  return key;
}
