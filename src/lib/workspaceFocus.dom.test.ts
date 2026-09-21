// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { moveWorkspaceFocus, rememberWorkspaceFocus, type FocusDirection } from './workspaceFocus';

let host: HTMLDivElement;
let editor: EditorView;
const element = (selector: string) => host.querySelector<HTMLElement>(selector)!;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden], [inert]') ? [] : [{}]) as unknown as DOMRectList;
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  host = document.createElement('div');
  host.innerHTML = `
    <aside data-focus-region="sidebar-tree"><button data-tree-item>Note</button></aside>
    <header data-focus-region="main-toolbar"><button>Save</button></header>
    <main data-focus-region="main" tabindex="-1">
      <div class="note-scroll" tabindex="-1">
        <input class="note-title" value="Note">
        <div class="note-actions"><button>Properties</button></div>
        <div class="editor-host"></div>
      </div>
    </main>
    <aside data-focus-region="backlinks"><button data-backlink-item>Related</button></aside>`;
  host.addEventListener('focusin', (event) => rememberWorkspaceFocus(event.target!));
  document.body.append(host);
  editor = new EditorView({
    state: EditorState.create({ doc: 'first line\nsecond line', selection: { anchor: 14 } }),
    parent: element('.editor-host'),
  });
});

afterEach(() => {
  editor.destroy();
  host.remove();
  vi.restoreAllMocks();
});

test.each([
  ['left', 'right'],
  ['right', 'left'],
] as const)('returning from the %s pane skips note controls and preserves the cursor', (away, back) => {
  editor.focus();
  const selection = editor.state.selection.toJSON();
  for (const control of ['.note-actions button', '.note-title']) {
    element(control).focus();
    moveWorkspaceFocus(away);
    expect(document.activeElement?.closest('[data-focus-region]')?.getAttribute('data-focus-region')).toBe(
      away === 'left' ? 'sidebar-tree' : 'backlinks',
    );
    moveWorkspaceFocus(back);
    expect(document.activeElement).toBe(editor.contentDOM);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(editor.state.doc.toString()).toBe('first line\nsecond line');
  }
});

test('vertical pane movement never selects toolbar buttons but can leave a manually focused toolbar', () => {
  editor.focus();
  for (const direction of ['up', 'down', 'up'] satisfies FocusDirection[]) {
    moveWorkspaceFocus(direction);
    expect(document.activeElement).toBe(editor.contentDOM);
  }
  element('header button').focus();
  moveWorkspaceFocus('down');
  expect(document.activeElement).toBe(editor.contentDOM);
});

test.each(['hidden', 'inert'])(
  'reading mode focuses the note instead of controls or the %s editor',
  (attribute) => {
    editor.focus();
    element('.editor-host').setAttribute(attribute, '');
    element('.note-actions button').focus();
    moveWorkspaceFocus('left');
    moveWorkspaceFocus('right');
    expect(document.activeElement).toBe(element('.note-scroll'));
    element('.editor-host').removeAttribute(attribute);
    moveWorkspaceFocus('left');
    moveWorkspaceFocus('right');
    expect(document.activeElement).toBe(editor.contentDOM);
  },
);

test('entry before the editor is ready stays on the note rather than a title or action', () => {
  editor.destroy();
  element('[data-tree-item]').focus();
  moveWorkspaceFocus('right');
  expect(document.activeElement).toBe(element('.note-scroll'));
});

test('settings controls keep their remembered focus when the note workspace is hidden', () => {
  element('.note-scroll').hidden = true;
  const setting = document.createElement('input');
  element('main').append(setting);
  setting.focus();
  moveWorkspaceFocus('left');
  moveWorkspaceFocus('right');
  expect(document.activeElement).toBe(setting);
});
