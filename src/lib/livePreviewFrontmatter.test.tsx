// @vitest-environment jsdom
import { act } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { focusLivePreview, livePreviewExtension } from './livePreview';
import { addFrontmatterProperty, frontmatterPanelState } from './livePreviewFrontmatter';
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
          frontmatterPanelState,
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

test('property addition opens the name field from YAML source without changing existing values or body', async () => {
  await act(async () => view.dispatch({ selection: { anchor: 4 } }));
  expect(document.querySelector('.frontmatter-panel')).toBeNull();
  await act(async () => addFrontmatterProperty(view));
  const name = document.querySelector<HTMLInputElement>('[aria-label="새 속성 이름"]');
  expect(name).not.toBeNull();
  expect(document.activeElement).toBe(name);
  expect(view.state.doc.toString()).toBe(body);
  expect(view.state.field(frontmatterPanelState).add).toBe(false);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="YAML 원문 편집"]')!.click());
  expect(view.state.selection.main.head).toBe(4);
  expect(document.querySelector('.frontmatter-panel')).toBeNull();
});

test('repeating the property command focuses the existing name input and preserves the unfinished draft', async () => {
  await act(async () => addFrontmatterProperty(view));
  const name = document.querySelector<HTMLInputElement>('[aria-label="새 속성 이름"]')!;
  const value = document.querySelector<HTMLInputElement>('[aria-label="새 속성 값"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, '새 속성');
    name.dispatchEvent(new Event('input', { bubbles: true }));
    value.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      value,
      'unfinished draft',
    );
    value.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => addFrontmatterProperty(view));
  expect(document.activeElement).toBe(name);
  expect(name.value).toBe('새 속성');
  expect(value.value).toBe('unfinished draft');
  expect(document.querySelectorAll('[aria-label="새 속성 이름"]')).toHaveLength(1);
  expect(view.state.doc.toString()).toBe(body);
});

test.each(['Original body\n  Keep whitespace\n', ''])(
  'creates an empty header without replacing the original body: %j',
  async (original) => {
    await act(async () =>
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: original },
        selection: { anchor: original.length },
      }),
    );
    await act(async () => addFrontmatterProperty(view));
    expect(view.state.doc.toString()).toBe('---\n---\n\n' + original);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('새 속성 이름');
    await act(async () => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe(original);
  },
);

test('frontmatter-only notes need no extra newline or placeholder value to open the property form', async () => {
  const original = '---\n# Preserve\nstatus: draft\n---';
  await act(async () =>
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: original },
      selection: { anchor: original.length },
    }),
  );
  await act(async () => addFrontmatterProperty(view));
  expect(document.activeElement?.getAttribute('aria-label')).toBe('새 속성 이름');
  expect(view.state.doc.toString()).toBe(original);
});

test('handled requests do not reopen the add form after leaving and revisiting source', async () => {
  await act(async () => addFrontmatterProperty(view));
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="속성 추가 취소"]')!.click());
  await act(async () => view.dispatch({ selection: { anchor: 4 } }));
  await act(async () => view.dispatch({ selection: { anchor: body.length } }));
  expect(document.querySelector('.frontmatter-panel')).not.toBeNull();
  expect(document.querySelector('[aria-label="새 속성 이름"]')).toBeNull();
});

test('malformed YAML keeps its source and error instead of inserting or resetting properties', async () => {
  const original = '---\nstatus: [unfinished\n---\n\nBody';
  await act(async () =>
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: original },
      selection: { anchor: 4 },
    }),
  );
  await act(async () => addFrontmatterProperty(view));
  expect(view.state.doc.toString()).toBe(original);
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="새 속성 이름"]')).toBeNull();
  expect(document.querySelector('[aria-label="YAML 원문 편집"]')).not.toBeNull();
});
