// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { bindVimInput } from './vimInput';

const { cm } = vi.hoisted(() => ({
  cm: { state: { vim: undefined as undefined | { insertMode: boolean; expectLiteralNext: boolean } } },
}));
vi.mock('@replit/codemirror-vim', () => ({ getCM: () => cm, Vim: {} }));

test.each([
  [false, false, 'insertText', true],
  [false, false, 'insertCompositionText', true],
  [true, false, 'insertText', false],
  [true, false, 'insertCompositionText', false],
  [false, true, 'insertText', false],
  [false, false, 'insertFromPaste', false],
] as const)(
  'native input before keydown respects Vim mode: %s %s %s',
  (insertMode, expectLiteralNext, inputType, prevented) => {
    cm.state.vim = { insertMode, expectLiteralNext };
    const contentDOM = document.createElement('div');
    const unbind = bindVimInput({ contentDOM } as unknown as EditorView);
    const event = Object.assign(new Event('beforeinput', { cancelable: true }), { inputType });
    contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(prevented);
    unbind();
    const after = Object.assign(new Event('beforeinput', { cancelable: true }), { inputType });
    contentDOM.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  },
);

test('Vim OFF preserves native text input', () => {
  cm.state.vim = undefined;
  const contentDOM = document.createElement('div');
  const unbind = bindVimInput({ contentDOM } as unknown as EditorView);
  const event = Object.assign(new Event('beforeinput', { cancelable: true }), { inputType: 'insertText' });
  contentDOM.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  unbind();
});

test.each(['cm-live-table', 'cm-frontmatter-panel'])(
  'Vim NORMAL leaves embedded %s fields and Korean composition editable',
  (className) => {
    cm.state.vim = { insertMode: false, expectLiteralNext: false };
    const contentDOM = document.createElement('div');
    const panel = document.createElement('div');
    panel.className = className;
    const input = document.createElement('textarea');
    panel.append(input);
    contentDOM.append(panel);
    const unbind = bindVimInput({ contentDOM } as unknown as EditorView);
    for (const inputType of ['insertText', 'insertCompositionText']) {
      const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    const koreanKey = new KeyboardEvent('keydown', {
      key: 'ㅑ',
      code: 'KeyI',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(koreanKey);
    expect(koreanKey.defaultPrevented).toBe(false);
    unbind();
  },
);
