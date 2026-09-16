import type { Settings } from './types';

export type CursorSettings = Pick<
  Settings,
  'cursorShape' | 'cursorFollowVim' | 'cursorBlink' | 'cursorBlinkRate' | 'cursorAnimation'
>;

export function cursorShapeForMode(
  settings: Pick<Settings, 'cursorShape' | 'cursorFollowVim'>,
  mode: 'edit' | 'insert' | 'normal' | 'visual' | 'replace',
): Settings['cursorShape'] {
  if (settings.cursorFollowVim) {
    if (mode === 'normal' || mode === 'visual') return 'block';
    if (mode === 'replace') return 'underline';
  }
  return settings.cursorShape;
}
