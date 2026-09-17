// @vitest-environment jsdom
import { act } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { focusLivePreview, livePreviewExtension } from './livePreview';
import type { Workspace } from './types';

const body = '---\nstatus: draft\ncount: 3\n---\n\nPreserve body';
const context = {
  workspace: { notes: [], records: [], databases: [] } as unknown as Workspace,
  openNote() {},
  openLink() {},
};
let view: EditorView;
beforeEach(async () => {
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
  await act(async () => {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: body,
        selection: { anchor: body.length },
        extensions: [
          yamlFrontmatter({ content: markdown() }),
          history(),
          livePreviewExtension(() => context, true),
        ],
      }),
    });
    view.focus();
  });
});
afterEach(async () => {
  await act(async () => view.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('YAML button transfers focus from the property widget to editable source', async () => {
  const button = document.querySelector<HTMLButtonElement>('[aria-label="YAML 원문 편집"]')!;
  expect(button).not.toBeNull();
  await act(async () => {
    button.focus();
    button.click();
  });
  expect(view.state.selection.main.head).toBe(4);
  expect(view.hasFocus).toBe(true);
  expect(document.querySelector('.frontmatter-panel')).toBeNull();
  expect(view.contentDOM.textContent).toContain('status: draft');
  expect(view.state.doc.toString()).toBe(body);
});

test('YAML reveal also works when widget focus state lags behind DOM focus', async () => {
  await act(async () => view.dispatch({ effects: focusLivePreview.of(false) }));
  expect(view.hasFocus).toBe(true);
  const button = document.querySelector<HTMLButtonElement>('[aria-label="YAML 원문 편집"]')!;
  await act(async () => button.click());
  expect(view.hasFocus).toBe(true);
  expect(view.state.selection.main.head).toBe(4);
  expect(document.querySelector('.frontmatter-panel')).toBeNull();
});

test('property commits are one editor transaction and undo preserves the remaining body', async () => {
  const input = document.querySelector<HTMLTextAreaElement>('[aria-label="status 값"]')!;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'ready');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(view.state.doc.toString()).toBe(body);
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })),
  );
  expect(view.state.doc.toString()).toBe(body.replace('status: draft', 'status: ready'));
  await act(async () => {
    undo(view);
  });
  expect(view.state.doc.toString()).toBe(body);
});

test('typing in the body retains the property widget DOM and its field focus state', async () => {
  const panel = document.querySelector('.frontmatter-panel');
  await act(async () => view.dispatch({ changes: { from: body.length, insert: ' extra' } }));
  expect(document.querySelector('.frontmatter-panel')).toBe(panel);
  expect(view.state.doc.toString()).toBe(body + ' extra');
});
