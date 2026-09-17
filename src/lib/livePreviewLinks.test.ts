// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { cursorCharLeft } from '@codemirror/commands';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { livePreviewExtension } from './livePreview';
import { editorLinkNavigation } from './wikiLinkNavigation';
import type { Workspace } from './types';

const workspace = { notes: [], records: [], databases: [] } as unknown as Workspace;
let view: EditorView;
const openLink = vi.fn<(target: string) => void>();
const openMarkdownLink = vi.fn<(target: string) => void>();

beforeEach(() => {
  openLink.mockReset();
  openMarkdownLink.mockReset();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => {
  view?.destroy();
  document.body.replaceChildren();
});

function editor(doc: string, anchor = 0) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        markdown(),
        editorLinkNavigation({ openWiki: openLink, openMarkdown: openMarkdownLink }),
        livePreviewExtension(() => ({ workspace, openNote() {}, openLink, openMarkdownLink }), true),
      ],
    }),
  });
  view.focus();
  return view;
}

function click(link: Element, options: MouseEventInit = {}) {
  for (const type of ['mousedown', 'mouseup', 'click'])
    link.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, cancelable: true, ...options }));
}

test.each(['[[Target|노트]]', '[웹](https://example.com/docs)', '[메일](mailto:hello@example.com)'])(
  'same-line text keeps %s clickable and entering the link reveals editable Markdown',
  (link) => {
    const doc = `앞 ${link} 뒤`;
    editor(doc);
    expect(view.contentDOM.querySelector('.cm-live-link')?.textContent).toBe(
      link.startsWith('[[') ? '노트' : link.startsWith('[웹]') ? '웹' : '메일',
    );
    view.dispatch({ selection: { anchor: 3 } });
    expect(view.contentDOM.querySelector('.cm-live-link')).toBeNull();
    expect(view.contentDOM.textContent).toContain(link);
    view.dispatch({ selection: { anchor: 2 + link.length } });
    expect(view.contentDOM.querySelector('.cm-live-link')).not.toBeNull();
    expect(view.state.doc.toString()).toBe(doc);
  },
);

test('a regular wiki click opens or creates the linked note once without changing editor selection', () => {
  const doc = '앞 [[아직 없는 노트|이동]] 뒤';
  editor(doc);
  const link = view.contentDOM.querySelector('.cm-live-link')!;
  expect(link.classList.contains('unresolved')).toBe(true);
  click(link);
  expect(openLink).toHaveBeenCalledExactlyOnceWith('아직 없는 노트');
  expect(openMarkdownLink).not.toHaveBeenCalled();
  expect(view.state.selection.main.head).toBe(0);
  expect(view.hasFocus).toBe(true);
  expect(view.state.doc.toString()).toBe(doc);
});

test('keyboard movement enters a rendered link so its original source can be edited', () => {
  const doc = '앞 [웹](https://example.com) 뒤';
  const end = doc.indexOf(')') + 1;
  editor(doc, end);
  expect(view.contentDOM.querySelector('.cm-live-link')).not.toBeNull();
  expect(cursorCharLeft(view)).toBe(true);
  expect(view.state.selection.main.head).toBe(end - 1);
  expect(view.contentDOM.querySelector('.cm-live-link')).toBeNull();
  view.dispatch(view.state.replaceSelection('/docs'));
  expect(view.state.doc.toString()).toBe('앞 [웹](https://example.com/docs) 뒤');
});

test.each([{}, { metaKey: true }, { ctrlKey: true }])(
  'Markdown click with %j opens a parsed URL once through the shared callback',
  (options) => {
    editor('앞 [문서](https://example.com/a_(b) "문서 설명") 뒤');
    click(view.contentDOM.querySelector('.cm-live-link')!, options);
    expect(openMarkdownLink).toHaveBeenCalledExactlyOnceWith('https://example.com/a_(b)');
    expect(openLink).not.toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(0);
  },
);

test('Shift-click extends selection to the source instead of opening the link', () => {
  const doc = '앞 [[노트]] 뒤';
  editor(doc, doc.length);
  click(view.contentDOM.querySelector('.cm-live-link')!, { shiftKey: true });
  expect(openLink).not.toHaveBeenCalled();
  expect(view.state.selection.main).toEqual(EditorSelection.range(doc.length, 2));
  expect(view.contentDOM.querySelector('.cm-live-link')).toBeNull();
});

test('a selection touching only the link boundary leaves it rendered; overlapping selection reveals it', () => {
  editor('앞 [[노트]] 뒤');
  view.dispatch({ selection: EditorSelection.range(0, 2) });
  expect(view.contentDOM.querySelector('.cm-live-link')).not.toBeNull();
  view.dispatch({ selection: EditorSelection.range(0, 3) });
  expect(view.contentDOM.querySelector('.cm-live-link')).toBeNull();
});

test('right click does not open a link or move the editor selection', () => {
  editor('앞 [[노트]] 뒤');
  click(view.contentDOM.querySelector('.cm-live-link')!, { button: 2 });
  expect(openLink).not.toHaveBeenCalled();
  expect(view.state.selection.main.head).toBe(0);
});

test('code, images, escaped links, relative paths and unsafe schemes remain non-actionable source', () => {
  editor(
    [
      '`[[노트]] [웹](https://example.com)`',
      '```md',
      '[[노트]] [웹](https://example.com)',
      '```',
      '![그림](https://example.com/image.png)',
      '\\[[노트]] \\[웹](https://example.com)',
      '[상대경로](some-note.md)',
      '[위험](javascript:alert%281%29)',
    ].join('\n'),
  );
  expect(view.contentDOM.querySelector('.cm-live-link')).toBeNull();
  expect(openLink).not.toHaveBeenCalled();
  expect(openMarkdownLink).not.toHaveBeenCalled();
});
