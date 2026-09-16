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
