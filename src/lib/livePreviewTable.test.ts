// @vitest-environment jsdom
import { act } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { vim } from '@replit/codemirror-vim';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { livePreviewExtension } from './livePreview';
import { bindVimInput } from './vimInput';
import type { Workspace } from './types';

const body = 'Before\n\n| Name | Value |\n| --- | ---: |\n| **old** | keep |\n| | |\n\nAfter';
const context = {
  workspace: { notes: [], records: [], databases: [] } as unknown as Workspace,
  openNote() {},
  openLink() {},
};
let view: EditorView, unbind: () => void;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(async () => {
  unbind?.();
  await act(async () => view?.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function setup(vimEnabled = false) {
  await act(async () => {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: body,
        extensions: [
          markdown({ extensions: [GFM] }),
          history(),
          vimEnabled ? vim() : [],
          livePreviewExtension(() => context),
        ],
      }),
    });
    unbind = bindVimInput(view);
  });
}
async function select(row: number, column: number) {
  const cell = document.querySelectorAll('tr')[row].children[column];
  await act(async () => cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));
}
async function key(key: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  await act(async () => document.activeElement!.dispatchEvent(event));
  return event;
}
async function type(text: string) {
  const input = document.querySelector<HTMLInputElement>('.cm-table-input')!;
  await act(async () => {
    input.value = text;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  });
}
async function menu(row: number, column: number) {
  const cell = document.querySelectorAll('tr')[row].children[column];
  await act(async () =>
    cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
  );
}
async function menuAction(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (b) => b.textContent === label,
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}

test.each([false, true])(
  'Vim %s: editing a rendered cell preserves Markdown, focus and shared undo',
  async (enabled) => {
    await setup(enabled);
    await select(1, 0);
    await key('Enter');
    const input = document.activeElement as HTMLInputElement;
    expect(input.value).toBe('**old**');
    await type('한글 | 값');
    expect(view.state.doc.toString()).toBe(body.replace('**old**', '한글 \\| 값'));
    expect(document.activeElement).toBe(input);
    expect(document.querySelectorAll('table')).toHaveLength(1);
    await key('z', { metaKey: true });
    expect(view.state.doc.toString()).toBe(body);
    expect(input.value).toBe('**old**');
    await key('z', { metaKey: true, shiftKey: true });
    expect(input.value).toBe('한글 | 값');
    await key('Tab');
    expect(input.getAttribute('aria-label')).toBe('표 2행 2열 편집');
    await key('Escape');
    expect(document.activeElement?.className).toBe('cm-live-table');
    expect(input.hidden).toBe(true);
  },
);

test('editing Tab never grows the table; selected Tab adds a column at the right edge', async () => {
  await setup();
  await select(2, 1);
  await key('Enter');
  await type('last');
  await key('Tab');
  expect(document.querySelectorAll('tr')).toHaveLength(3);
  expect(document.querySelectorAll('th')).toHaveLength(2);
  expect(document.activeElement?.className).toBe('cm-live-table');
  await key('Tab');
  expect(document.querySelectorAll('th')).toHaveLength(3);
  expect(document.querySelectorAll('tr')).toHaveLength(3);
  expect((document.querySelector('.cm-table-selected') as HTMLTableCellElement).cellIndex).toBe(2);
  await key('Tab', { shiftKey: true });
  expect(document.querySelector('.cm-table-selected')?.textContent).toBe('last');
  await key('ArrowDown');
  expect(document.activeElement).toBe(view.contentDOM);
  expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe('');
});

test.each([false, true])('Vim %s: Enter commits to the same cell without adding rows', async (enabled) => {
  await setup(enabled);
  for (const row of [1, 2]) {
    await select(row, 1);
    await key('Enter');
    await type(`row ${row}`);
    const source = view.state.doc.toString();
    await key('Enter');
    expect(document.activeElement?.className).toBe('cm-live-table');
    expect(document.querySelector('.cm-table-input')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('.cm-table-selected')?.textContent).toBe(`row ${row}`);
    expect(view.state.doc.toString()).toBe(source);
    expect(document.querySelectorAll('tr')).toHaveLength(3);
    await key('Enter');
    expect(document.activeElement?.getAttribute('aria-label')).toBe(`표 ${row + 1}행 2열 편집`);
    await key('Escape');
  }
});

test('selected Tab moves horizontally and appends one undoable column without wrapping rows', async () => {
  await setup(true);
  await select(1, 0);
  await key('Tab');
  expect(document.querySelector('.cm-table-selected')?.textContent).toBe('keep');
  expect(view.state.doc.toString()).toBe(body);
  await key('Tab');
  expect(document.querySelectorAll('th')).toHaveLength(3);
  expect(document.querySelectorAll('tr')).toHaveLength(3);
  await key('u');
  expect(view.state.doc.toString()).toBe(body);
  expect(document.querySelector('.cm-table-selected')?.textContent).toBe('keep');
  await key('r', { ctrlKey: true });
  expect(document.querySelectorAll('th')).toHaveLength(3);
});

test.each(['o', 'O'])('Vim %s inserts a row beside the selection and starts editing it', async (command) => {
  await setup(true);
  await select(1, 1);
  await key(command);
  const row = command === 'o' ? 2 : 1;
  expect(document.querySelectorAll('tr')).toHaveLength(4);
  expect(document.activeElement?.getAttribute('aria-label')).toBe(`표 ${row + 1}행 2열 편집`);
  expect(view.state.doc.toString()).toContain(
    command === 'o' ? '| **old** | keep |\n|  |  |\n| | |' : '| --- | ---: |\n|  |  |\n| **old** | keep |',
  );
  await key('Enter');
  expect(document.activeElement?.className).toBe('cm-live-table');
  expect(document.querySelectorAll('tr')).toHaveLength(4);
  await key('u');
  expect(view.state.doc.toString()).toBe(body);
});

test.each([false, true])('Vim %s: Alt+Enter explicitly adds a row, even while editing', async (enabled) => {
  await setup(enabled);
  await select(2, 1);
  await key('Enter');
  await type('last');
  await key('Enter', { altKey: true });
  expect(document.querySelectorAll('tr')).toHaveLength(4);
  expect(document.activeElement?.getAttribute('aria-label')).toBe('표 4행 2열 편집');
  await key('Enter', { altKey: true, repeat: true });
  expect(document.querySelectorAll('tr')).toHaveLength(4);
  await key('Enter');
  await key('Enter', { repeat: true });
  expect(document.activeElement?.className).toBe('cm-live-table');
  await key('Tab', { repeat: true });
  expect(document.querySelectorAll('th')).toHaveLength(2);
});

test('native composition stays in its input while the source and preview update', async () => {
  await setup(true);
  await select(1, 0);
  await key('i');
  const input = document.activeElement as HTMLInputElement;
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  const before = new InputEvent('beforeinput', {
    inputType: 'insertCompositionText',
    data: 'ㅎ',
    isComposing: true,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(before);
  expect(before.defaultPrevented).toBe(false);
  await type('ㅎ');
  await type('하');
  await type('한');
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('한');
  expect((await key('Enter', { isComposing: true })).defaultPrevented).toBe(false);
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  expect(view.state.doc.toString()).toBe(body.replace('**old**', '한'));
});

test('Korean command keys navigate the grid without modifying cell content', async () => {
  await setup(true);
  await select(0, 0);
  await key('ㅓ', { code: 'KeyJ', isComposing: true });
  expect(document.querySelector('.cm-table-selected')?.textContent).toBe('old');
  expect(view.state.doc.toString()).toBe(body);
});

test('typing words incrementally retains the native caret and trailing space', async () => {
  await setup();
  await select(1, 0);
  await key('Enter');
  const input = document.activeElement as HTMLInputElement;
  for (const value of ['a', 'a ', 'a b', 'a b ', 'a b c']) {
    await type(value);
    expect(input.value).toBe(value);
    expect(document.activeElement).toBe(input);
  }
  expect(view.state.doc.toString()).toBe(body.replace('**old**', 'a b c'));
});

test('dd deletes one selected data row and shares isolated undo/redo history', async () => {
  await setup(true);
  await select(1, 1);
  await key('i');
  await type('changed');
  await key('Escape');
  const edited = view.state.doc.toString();
  await key('d');
  expect(view.state.doc.toString()).toBe(edited);
  await key('d', { repeat: true });
  expect(view.state.doc.toString()).toBe(edited);
  await key('d');
  const deleted = edited.replace('| **old** | changed |\n', '');
  expect(view.state.doc.toString()).toBe(deleted);
  expect(document.querySelectorAll('tr')).toHaveLength(2);
  expect(document.activeElement?.className).toBe('cm-live-table');
  expect((document.querySelector('.cm-table-selected') as HTMLTableCellElement).cellIndex).toBe(1);
  await key('u');
  expect(view.state.doc.toString()).toBe(edited);
  await key('r', { ctrlKey: true });
  expect(view.state.doc.toString()).toBe(deleted);
});

test.each([{ metaKey: true }, { altKey: true }, { ctrlKey: true }])(
  'modified Vim u does not undo a table edit: %j',
  async (modifiers) => {
    await setup(true);
    await select(1, 0);
    await key('Enter');
    await type('Keep this edit');
    await key('Enter');
    const changed = view.state.doc.toString();
    expect((await key('u', modifiers)).defaultPrevented).toBe(false);
    expect(view.state.doc.toString()).toBe(changed);
    await key('u');
    expect(view.state.doc.toString()).toBe(body);
  },
);

test('deleting the last data rows retains the header and a usable selection', async () => {
  await setup(true);
  await select(2, 0);
  await key('d');
  await key('d');
  expect(document.querySelector('.cm-table-selected')?.textContent).toBe('old');
  await key('d');
  await key('d');
  expect(document.querySelectorAll('tr')).toHaveLength(1);
  expect(document.querySelector('.cm-table-selected')?.textContent).toBe('Name');
  const headerOnly = 'Before\n\n| Name | Value |\n| --- | ---: |\n\nAfter';
  expect(view.state.doc.toString()).toBe(headerOnly);
  await key('d');
  await key('d');
  expect(view.state.doc.toString()).toBe(headerOnly);
  await key('u');
  expect(document.querySelectorAll('tr')).toHaveLength(2);
});

test('a pending d is cancelled by Escape, navigation, mouse selection or focus loss', async () => {
  await setup(true);
  for (const cancel of [
    () => key('Escape'),
    () => key('j'),
    () => select(2, 0),
    async () => {
      await act(async () => (document.activeElement as HTMLElement).blur());
      await select(1, 0);
    },
  ]) {
    await select(1, 0);
    await key('d');
    await cancel();
    expect(document.activeElement?.className).toBe('cm-live-table');
    await key('d');
    expect(view.state.doc.toString()).toBe(body);
    await key('Escape');
  }
});

test('dd is inactive with Vim off and remains literal text inside a cell input', async () => {
  await setup();
  await select(1, 0);
  expect((await key('d')).defaultPrevented).toBe(false);
  await key('d');
  expect(view.state.doc.toString()).toBe(body);
  await key('Enter');
  expect((await key('d')).defaultPrevented).toBe(false);
  await type('dd');
  expect(view.state.doc.toString()).toBe(body.replace('**old**', 'dd'));
});

test('Korean physical d deletes rows, but modified keys and Vim cell input do not', async () => {
  await setup(true);
  await select(1, 0);
  await key('d', { ctrlKey: true });
  await key('d');
  expect(view.state.doc.toString()).toBe(body);
  await key('i');
  expect((await key('d')).defaultPrevented).toBe(false);
  await type('dd');
  await key('Escape');
  await key('ㅇ', { code: 'KeyD', isComposing: true });
  await key('ㅇ', { code: 'KeyD', isComposing: true });
  expect(view.state.doc.toString()).toBe(body.replace('| **old** | keep |\n', ''));
});

test('dc deletes the selected column as one undoable edit and keeps the last column', async () => {
  await setup(true);
  await select(1, 1);
  await key('d');
  await key('c');
  expect(document.querySelectorAll('th')).toHaveLength(1);
  expect(document.querySelectorAll('tr')).toHaveLength(3);
  expect(document.querySelector('.cm-table-selected')?.textContent).toBe('old');
  expect(view.state.doc.toString()).not.toContain('keep');
  const deleted = view.state.doc.toString();
  await key('d');
  await key('c');
  expect(view.state.doc.toString()).toBe(deleted);
  await key('u');
  expect(view.state.doc.toString()).toBe(body);
  await key('r', { ctrlKey: true });
  expect(view.state.doc.toString()).toBe(deleted);
});

test('dc only acts on a consecutive Vim grid command, including Korean physical keys', async () => {
  await setup(true);
  await select(1, 0);
  await key('d');
  await key('c', { ctrlKey: true });
  await key('c');
  expect(view.state.doc.toString()).toBe(body);
  await key('Enter');
  expect((await key('d')).defaultPrevented).toBe(false);
  expect((await key('c')).defaultPrevented).toBe(false);
  await type('dc');
  await key('Enter');
  await key('ㅇ', { code: 'KeyD', isComposing: true });
  await key('ㅊ', { code: 'KeyC', isComposing: true });
  expect(document.querySelectorAll('th')).toHaveLength(1);
  expect(document.querySelector('.cm-table-selected')?.textContent).toBe('keep');
});

test('mouse context menu inserts columns beside the target and edits the new header without Vim', async () => {
  await setup();
  await menu(1, 1);
  await menuAction('왼쪽에 열 추가');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.querySelectorAll('th')).toHaveLength(3);
  expect(document.activeElement?.getAttribute('aria-label')).toBe('표 1행 2열 편집');
  await type('새 열');
  await key('Enter');
  expect(document.querySelectorAll('th')[1].textContent).toBe('새 열');
  expect(document.querySelectorAll('tr')[1].children[2].textContent).toBe('keep');
});

test('mouse context menu edits and deletes rows or columns with structural protections', async () => {
  await setup();
  await menu(1, 0);
  await menuAction('셀 편집');
  expect(document.activeElement?.className).toBe('cm-table-input');
  await key('Enter');
  await menu(1, 0);
  await menuAction('아래에 행 추가');
  expect(document.querySelectorAll('tr')).toHaveLength(4);
  await key('Enter');
  await menu(2, 0);
  await menuAction('행 삭제');
  expect(view.state.doc.toString()).toBe(body);
  await menu(1, 1);
  await menuAction('열 삭제');
  expect(document.querySelectorAll('th')).toHaveLength(1);
  await menu(0, 0);
  const labels = [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
  expect(labels).not.toContain('행 삭제');
  expect(labels).not.toContain('열 삭제');
});

test('edge plus buttons add a row or column without changing Vim settings', async () => {
  await setup();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="표 아래에 행 추가"]')!.click(),
  );
  expect(document.querySelectorAll('tr')).toHaveLength(4);
  expect(document.activeElement?.getAttribute('aria-label')).toBe('표 4행 1열 편집');
  await key('Enter');
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="표 오른쪽에 열 추가"]')!.click(),
  );
  expect(document.querySelectorAll('th')).toHaveLength(3);
  expect(document.activeElement?.getAttribute('aria-label')).toBe('표 1행 3열 편집');
});

test('closing the table context menu restores the selected cell without modifying source', async () => {
  await setup();
  await menu(1, 1);
  await key('Escape');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement?.className).toBe('cm-live-table');
  expect(document.querySelector('.cm-table-selected')?.textContent).toBe('keep');
  expect(view.state.doc.toString()).toBe(body);
});
