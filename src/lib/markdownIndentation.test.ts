// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree } from '@codemirror/language';
import { completionStatus, startCompletion } from '@codemirror/autocomplete';
import { getCM, vim, Vim } from '@replit/codemirror-vim';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { markdownEditing } from './markdownEditing';
import { markdownListLayout } from './markdownListLayout';
import { livePreviewExtension } from './livePreview';
import { noteCompletionExtension } from './noteCompletion';
import { bindVimKeybindings } from './vimKeybindings';
import type { Workspace } from './types';

const workspace = {
  notes: [{ id: 'target', title: '아래 노트' }],
  folders: [],
  links: [],
  settings: {},
} as unknown as Workspace;
let view: EditorView;
const rects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
beforeEach(() => {
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
        markdown({ extensions: [GFM], addKeymap: false }),
        markdownEditing,
        noteCompletionExtension(
          () => workspace,
          () => {},
        ),
        live ? livePreviewExtension(() => ({ workspace, openNote() {}, openLink() {} }), true) : [],
        history(),
        keymap.of(defaultKeymap),
      ],
    }),
  });
  view.focus();
  if (vimEnabled) Vim.handleKey(getCM(view)!, 'i', 'user');
}
function tab(shiftKey = false) {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    code: 'Tab',
    keyCode: 9,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}

test.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
  'live %s, Vim Insert %s: Tab nests a bullet and Shift+Tab restores it with the cursor',
  (live, vimEnabled) => {
    const before = '- 부모\n- 한글 항목\n- 다음';
    editor(before, live, vimEnabled);
    const cursor = before.indexOf('항목');
    view.dispatch({ selection: { anchor: cursor } });
    expect(tab().defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe('- 부모\n  - 한글 항목\n- 다음');
    expect(view.state.selection.main.head).toBe(cursor + 2);
    expect(markdownListLayout(view.state.doc, syntaxTree(view.state)).lines.get(2)?.depth).toBe(2);
    expect(view.hasFocus).toBe(true);
    if (live)
      expect(
        view.contentDOM
          .querySelectorAll<HTMLElement>('.cm-live-list-line')[1]
          ?.style.getPropertyValue('--cm-list-depth'),
      ).toBe('2');
    expect(tab(true).defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe(before);
    expect(view.state.selection.main.head).toBe(cursor);
    expect(view.hasFocus).toBe(true);
  },
);

test('Tab and Shift+Tab indent selected rows together without changing unselected text', () => {
  const before = '- 부모\n- 자식 하나\n- 자식 둘\n문단';
  editor(before, true);
  const anchor = before.indexOf('- 자식 하나'),
    head = before.indexOf('\n문단');
  view.dispatch({ selection: { anchor, head } });
  tab();
  expect(view.state.doc.toString()).toBe('- 부모\n  - 자식 하나\n  - 자식 둘\n문단');
  expect(view.state.selection.main.to).toBe(head + 4);
  tab(true);
  expect(view.state.doc.toString()).toBe(before);
  expect(view.state.selection.main.to).toBe(head);
});

test.each(['- ', '- [ ] '])(
  'empty %j indents, accepts Korean text at the cursor, and supports undo',
  (marker) => {
    const before = '- 부모\n' + marker;
    editor(before, true);
    tab();
    expect(view.state.doc.toString()).toBe('- 부모\n  ' + marker);
    expect(view.state.selection.main.head).toBe(before.length + 2);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(before);
    tab();
    view.dispatch(view.state.replaceSelection('한글'));
    expect(view.state.doc.toString()).toBe('- 부모\n  ' + marker + '한글');
    tab(true);
    expect(view.state.doc.toString()).toBe(before + '한글');
    tab(true);
    expect(view.state.doc.toString()).toBe(before + '한글');
  },
);

test.each([false, true])(
  'Tab and Shift+Tab change list depth while staying in Vim Normal, live %s',
  async (live) => {
    const before = '- 부모\n- 한글';
    editor(before, live, true);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
    const cursor = view.state.selection.main.head;
    for (let count = 0; count < 8; count++) expect(tab().defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe('- 부모\n  - 한글');
    expect(view.state.selection.main.head).toBe(cursor + 2);
    expect(getCM(view)?.state.vim?.insertMode).toBe(false);
    tab(true);
    expect(view.state.doc.toString()).toBe(before);
    expect(view.state.selection.main.head).toBe(cursor);
    expect(getCM(view)?.state.vim?.insertMode).toBe(false);
    expect(view.hasFocus).toBe(true);
  },
);

test('Tab indentation does not replace the distinct Ctrl+i Vim command', () => {
  editor('- 부모\n- 항목', false, true);
  const cm = getCM(view)!;
  Vim.handleKey(cm, '<Esc>', 'user');
  const forward = vi.fn();
  const unbind = bindVimKeybindings(cm, [{ id: 'note.forward', keys: '<C-i>' }], forward);
  try {
    tab();
    expect(view.state.doc.toString()).toBe('- 부모\n  - 항목');
    expect(forward).not.toHaveBeenCalled();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'i',
        code: 'KeyI',
        keyCode: 73,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(forward).toHaveBeenCalledExactlyOnceWith('note.forward');
    expect(view.state.doc.toString()).toBe('- 부모\n  - 항목');
  } finally {
    unbind();
  }
});

test('Tab leaves an ongoing IME composition in charge', () => {
  editor('- 부모\n- 한글', false, true);
  view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  tab();
  expect(view.state.doc.toString()).toBe('- 부모\n- 한글');
});

test('Escape then Tab retains the standard focus escape when Vim is disabled', async () => {
  editor('- 부모\n- 항목');
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      bubbles: true,
      cancelable: true,
    }),
  );
  await Promise.resolve();
  expect(tab().defaultPrevented).toBe(false);
  expect(view.state.doc.toString()).toBe('- 부모\n- 항목');
});

test('Tab accepts an active wiki completion before list indentation', async () => {
  editor('- 부모\n- [[아래', true);
  startCompletion(view);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(completionStatus(view.state)).toBe('active');
  tab();
  expect(view.state.doc.toString()).not.toContain('  -');
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (completionStatus(view.state) === 'active') tab();
  expect(view.state.doc.toString()).toBe('- 부모\n- [[아래 노트]]');
});

test.each([false, true])(
  'repeated Tab preserves bullets without an available parent, Vim %s',
  (vimEnabled) => {
    editor('- 부모\n- 자식', true, vimEnabled);
    for (let count = 0; count < 8; count++) {
      expect(tab().defaultPrevented).toBe(true);
      expect(view.state.doc.toString()).toBe('- 부모\n  - 자식');
      expect(view.contentDOM.querySelectorAll('.cm-live-bullet')).toHaveLength(2);
      expect(markdownListLayout(view.state.doc, syntaxTree(view.state)).lines.get(2)?.depth).toBe(2);
    }
    tab(true);
    expect(view.state.doc.toString()).toBe('- 부모\n- 자식');
    tab(true);
    expect(view.state.doc.toString()).toBe('- 부모\n- 자식');
  },
);

test('repeated Tab on the first item keeps it at the root instead of turning it into code', () => {
  editor('- 첫 항목', true);
  for (let count = 0; count < 8; count++) tab();
  expect(view.state.doc.toString()).toBe('- 첫 항목');
  expect(view.contentDOM.querySelectorAll('.cm-live-bullet')).toHaveLength(1);
  expect(view.hasFocus).toBe(true);
});

test('successive Tab enters existing nested parents and Shift+Tab restores each level', () => {
  const before = '- 부모\n  - 자식\n    - 손자\n- 이동';
  editor(before, true);
  for (const depth of [2, 3, 4, 4, 4]) {
    tab();
    expect(markdownListLayout(view.state.doc, syntaxTree(view.state)).lines.get(4)?.depth).toBe(depth);
    expect(view.contentDOM.querySelectorAll('.cm-live-bullet')).toHaveLength(4);
  }
  for (const depth of [3, 2, 1, 1]) {
    tab(true);
    expect(markdownListLayout(view.state.doc, syntaxTree(view.state)).lines.get(4)?.depth).toBe(depth);
  }
  expect(view.state.doc.toString()).toBe(before);
});

test('indent and outdent move descendants and explicit continuation together, leaving the paragraph alone', () => {
  const before = '- 부모\n- 이동\n  이어지는 내용\n  - 자식\n    - 손자\n일반 문단';
  editor(before, true);
  view.dispatch({ selection: { anchor: before.indexOf('이동') } });
  tab();
  expect(view.state.doc.toString()).toBe(
    '- 부모\n  - 이동\n    이어지는 내용\n    - 자식\n      - 손자\n일반 문단',
  );
  expect(view.contentDOM.querySelectorAll('.cm-live-bullet')).toHaveLength(4);
  tab(true);
  expect(view.state.doc.toString()).toBe(before);
});

test.each([
  ['10. 부모\n11. 이동', '10. 부모\n    11. 이동'],
  ['- [ ] 부모\n- [x] 이동', '- [ ] 부모\n  - [x] 이동'],
  ['> - 부모\n> - 이동', '> - 부모\n>   - 이동'],
  ['- 부모\n\n- 이동', '- 부모\n\n  - 이동'],
])('list nesting respects the actual parent prefix: %s', (before, nested) => {
  editor(before, true);
  for (let count = 0; count < 5; count++) tab();
  expect(view.state.doc.toString()).toBe(nested);
  tab(true);
  expect(view.state.doc.toString()).toBe(before);
});

test('selecting a parent and child moves the branch only once', () => {
  const before = '- 부모\n- 이동\n  - 자식';
  editor(before, true);
  view.dispatch({ selection: { anchor: before.indexOf('- 이동'), head: before.length } });
  tab();
  expect(view.state.doc.toString()).toBe('- 부모\n  - 이동\n    - 자식');
  tab(true);
  expect(view.state.doc.toString()).toBe(before);
});

test('a selected run cannot drift into plain text on repeated Tab', () => {
  const before = '- 부모\n- 하나\n- 둘';
  editor(before, true);
  view.dispatch({ selection: { anchor: before.indexOf('- 하나'), head: before.length } });
  for (let count = 0; count < 8; count++) tab();
  expect(view.state.doc.toString()).toBe('- 부모\n  - 하나\n  - 둘');
  expect(view.contentDOM.querySelectorAll('.cm-live-bullet')).toHaveLength(3);
  tab(true);
  expect(view.state.doc.toString()).toBe(before);
});

test('code containing bullet-like text retains ordinary whitespace indentation', () => {
  const before = '```md\n- 예제\n```';
  editor(before);
  view.dispatch({ selection: { anchor: before.indexOf('예제') } });
  tab();
  tab();
  expect(view.state.doc.toString()).toBe('```md\n    - 예제\n```');
  tab(true);
  tab(true);
  expect(view.state.doc.toString()).toBe(before);
});

test.each(['> 인용 내용', '```md\n  - 코드 예제\n  ```'])(
  'a nested block moves with its owning item: %s',
  (block) => {
    const before = '- 부모\n- 이동\n  ' + block;
    editor(before);
    view.dispatch({ selection: { anchor: before.indexOf('이동') } });
    tab();
    expect(view.state.doc.toString()).toBe('- 부모\n  - 이동\n    ' + block.replaceAll('\n', '\n  '));
    tab(true);
    expect(view.state.doc.toString()).toBe(before);
  },
);
