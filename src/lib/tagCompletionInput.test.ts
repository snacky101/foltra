// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { completionStatus, currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { getCM, vim, Vim } from '@replit/codemirror-vim';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from './api';
import { noteCompletionExtension } from './noteCompletion';
import { markdownEditing } from './markdownEditing';
import { livePreviewExtension } from './livePreview';
import type { Workspace } from './types';

vi.mock('./api', () => ({ call: vi.fn() }));
const tags = [
  { name: 'anki', noteCount: 1 },
  { name: '한글', noteCount: 2 },
];
const workspace = { path: '/qa', notes: [], folders: [], links: [], settings: {} } as unknown as Workspace;
let view: EditorView;
const onError = vi.fn();
const rects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
beforeEach(() => {
  vi.mocked(call).mockReset().mockResolvedValue(tags);
  onError.mockReset();
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
});
afterEach(() => {
  view?.destroy();
  document.body.replaceChildren();
  if (rects) Object.defineProperty(Range.prototype, 'getClientRects', rects);
  else delete (Range.prototype as Partial<Range>).getClientRects;
  if (rect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rect);
  else delete (Range.prototype as Partial<Range>).getBoundingClientRect;
});
function editor(doc: string, live = false, vimEnabled = false) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [
        vimEnabled ? vim() : [],
        markdown({ addKeymap: false }),
        markdownEditing,
        noteCompletionExtension(() => workspace, onError),
        live ? livePreviewExtension(() => ({ workspace, openNote() {}, openLink() {} }), true) : [],
        history(),
        keymap.of(defaultKeymap),
      ],
    }),
  });
  view.focus();
}
function press(key: string) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }),
  );
}
test.each([
  [false, false],
  [true, false],
  [true, true],
])('arrow selection and Enter complete once without newline, live %s / Vim %s', async (live, vimEnabled) => {
  editor('- 질문 #', live, vimEnabled);
  if (vimEnabled) Vim.handleKey(getCM(view)!, 'A', 'user');
  startCompletion(view);
  await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'));
  // Wait from the popup opening, not from the asynchronous request starting.
  await settle();
  expect(completionStatus(view.state)).toBe('active');
  press('ArrowDown');
  press('Enter');
  expect(view.state.doc.toString()).toBe('- 질문 #한글');
  expect(completionStatus(view.state)).toBeNull();
  if (live) expect(view.contentDOM.querySelector('.tag-chip')?.textContent).toBe('#한글');
});
test('typing filters an open list without repeatedly querying the vault, and Tab accepts before indenting', async () => {
  editor('- 질문 #', true);
  startCompletion(view);
  await settle();
  view.dispatch({ changes: { from: 6, insert: 'an' }, selection: { anchor: 8 }, userEvent: 'input.type' });
  expect(currentCompletions(view.state).map((x) => x.label)).toEqual(['#anki']);
  await settle();
  press('Tab');
  expect(view.state.doc.toString()).toBe('- 질문 #anki');
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith('/qa', 'tags.list');
  undo(view);
  expect(view.state.doc.toString()).not.toContain('  -');
});
test('marked Korean input and its collapse retain the popup; Enter during composition does not accept', async () => {
  editor('#');
  startCompletion(view);
  await settle();
  view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  view.dispatch({
    changes: { from: 1, insert: 'ㅎ' },
    selection: { anchor: 1, head: 2 },
    userEvent: 'input.type.compose.start',
  });
  view.dispatch({ selection: { anchor: 2 }, userEvent: 'select' });
  expect(completionStatus(view.state)).toBe('active');
  expect(currentCompletions(view.state).map((x) => x.label)).toEqual(['#한글']);
  // jsdom has no native IME DOM mutation. Check the completion binding itself;
  // real composition/key event ordering is verified in the browser separately.
  const enter = view.state
    .facet(keymap)
    .flat()
    .find((binding) => binding.key === 'Enter')!;
  expect(enter.run!(view)).toBe(false);
  expect(view.state.doc.toString()).toBe('#ㅎ');
  view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  await settle();
  press('Escape');
  expect(completionStatus(view.state)).toBeNull();
  expect(view.state.doc.toString()).toBe('#ㅎ');
});
test('normal Vim mode does not fetch tags or open a completion popup', async () => {
  editor('#', true, true);
  startCompletion(view);
  await settle();
  expect(call).not.toHaveBeenCalled();
  expect(completionStatus(view.state)).toBeNull();
});
test('failed lookup reports the error while leaving the draft untouched', async () => {
  const error = new Error('lookup failed');
  vi.mocked(call).mockRejectedValue(error);
  editor('#');
  startCompletion(view);
  await settle();
  expect(onError).toHaveBeenCalledWith(error);
  expect(view.state.doc.toString()).toBe('#');
});
