// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { completionStatus, currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { expect, test } from 'vitest';
import { noteCompletionExtension } from './noteCompletion';
import type { Workspace } from './types';

test('WebKit marked-text selection and collapse keep the filtered popup active', async () => {
  // jsdom has no text layout; this test checks completion state, not geometry.
  const rects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
  const rect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
  const workspace = {
    notes: [
      { id: 'one', title: '한글 노트' },
      { id: 'two', title: 'Other' },
    ],
    folders: [],
    links: [],
    settings: {},
  } as unknown as Workspace;
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: '[[',
      selection: { anchor: 2 },
      extensions: [
        noteCompletionExtension(
          () => workspace,
          () => {},
        ),
      ],
    }),
  });
  try {
    view.focus();
    startCompletion(view);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(completionStatus(view.state)).toBe('active');
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    view.dispatch({
      changes: { from: 2, insert: 'ㅎ' },
      selection: { anchor: 2, head: 3 },
      userEvent: 'input.type.compose.start',
    });
    expect(completionStatus(view.state)).toBe('active');
    view.dispatch({ selection: { anchor: 3 }, userEvent: 'select' });
    expect(completionStatus(view.state)).toBe('active');
    expect(currentCompletions(view.state).map((item) => item.label)).toEqual(['한글 노트', 'ㅎ']);
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    view.dispatch({ selection: { anchor: 0 }, userEvent: 'select.pointer' });
    expect(completionStatus(view.state)).toBeNull();
  } finally {
    view.destroy();
    document.body.replaceChildren();
    if (rects) Object.defineProperty(Range.prototype, 'getClientRects', rects);
    else delete (Range.prototype as Partial<Range>).getClientRects;
    if (rect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rect);
    else delete (Range.prototype as Partial<Range>).getBoundingClientRect;
  }
});
