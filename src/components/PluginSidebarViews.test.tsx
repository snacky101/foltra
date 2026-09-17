// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NotePane } from './NotePane';
import type { Workspace } from '../lib/types';
import type { useNote } from '../lib/useNote';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const workspace = {
  vault: { id: 'temporary' },
  settings: { showUnresolvedLinks: true },
  notes: [{ id: 'source', title: 'Source' }],
  links: [
    { source: 'source', target: 'target', name: 'target', label: 'Target', context: 'A connection', line: 1 },
  ],
} as unknown as Workspace;
function pane(noteId: string | null, sidebar = true, backlinks = true, current = workspace) {
  return (
    <NotePane
      workspace={current}
      noteId={noteId}
      note={{ draft: { title: '', body: '' }, note: null, status: 'loading' } as ReturnType<typeof useNote>}
      preview={false}
      backlinks={backlinks}
      sidebar={sidebar ? <button data-plugin-calendar>Calendar day</button> : undefined}
      editor={createRef()}
      dispatch={() => {}}
      commands={[]}
      openNote={async () => {}}
      openLink={() => {}}
      setNoteId={() => {}}
      setMode={() => {}}
      setDialog={() => {}}
      onError={() => {}}
      onEditorReady={() => {}}
      commandLineHost={createRef()}
      onNoteCommand={async () => {}}
    />
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

test('note sidebar can host extensions without an open note and follows panel visibility', async () => {
  await act(async () => root.render(pane(null)));
  expect(host.querySelector('.empty-notes')).not.toBeNull();
  expect(host.querySelector('.backlinks-extensions')?.textContent).toBe('Calendar day');
  expect(host.querySelector('.backlinks-heading')).toBeNull();
  await act(async () => root.render(pane(null, true, false)));
  expect(host.querySelector('.resizable-sidebar-right')).toBeNull();
  await act(async () => root.render(pane(null, false)));
  expect(host.querySelector('.resizable-sidebar-right')).toBeNull();
});

test('link refresh and note changes preserve calendar focus and its mounted footer below the scroll region', async () => {
  await act(async () => root.render(pane('target')));
  const footer = host.querySelector('.backlinks-extensions')!;
  const calendar = footer.querySelector('button')!;
  expect(footer.previousElementSibling?.className).toBe('backlinks-scroll');
  await act(async () => host.querySelector<HTMLButtonElement>('[data-backlink-item]')!.focus());
  await act(async () => calendar.focus());
  await act(async () =>
    root.render(pane('target', true, true, { ...workspace, links: [...workspace.links] })),
  );
  expect(document.activeElement).toBe(calendar);
  await act(async () => root.render(pane('other')));
  expect(host.querySelector('.backlinks-extensions')).toBe(footer);
  expect(document.activeElement).toBe(calendar);
});
