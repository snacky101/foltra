// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { TopicsView } from './TopicsView';
import { defaultTopicOptions } from '../lib/useTopics';
import { toggleTaskInText } from '../lib/markdownTasks';
import { call } from '../lib/api';
import type { Workspace } from '../lib/types';
vi.mock('../lib/api', () => ({ call: vi.fn() }));
const workspace = {
  path: '/disposable',
  vault: { id: 'vault' },
  notes: [],
  records: [],
  folders: [],
  settings: {},
} as unknown as Workspace;
const openNote = vi.fn(),
  openLink = vi.fn(),
  refresh = vi.fn(async () => {});
let host: HTMLDivElement, root: Root, body: string, revision: string;
const card = () => host.querySelector<HTMLElement>('.topic-card')!;
const checkboxes = () => [...host.querySelectorAll<HTMLButtonElement>('.task-toggle')];
const writes = () => vi.mocked(call).mock.calls.filter(([, command]) => command === 'task.update');
function App() {
  const [options, onChange] = useState(defaultTopicOptions);
  return (
    <TopicsView
      workspace={workspace}
      options={options}
      onChange={onChange}
      toggleSources={() => onChange({ ...options, showSources: !options.showSources })}
      openNote={openNote}
      openLink={openLink}
      refresh={refresh}
      updateSettings={async () => true}
    />
  );
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  body = '---\na: true\n---\n\n- [[Foo]]\n  - [ ] first\n  - [/] second';
  revision = 'r1';
  vi.mocked(call).mockImplementation(async (_path, command, args) => {
    const a = args as Record<string, unknown>;
    if (command === 'topics.list')
      return a.hideCompleted && !/[\[ ][ /]\]/.test(body)
        ? []
        : [{ id: 'name:Foo', title: 'Foo', noteId: null, blockCount: 1, noteCount: 1 }];
    if (command === 'topics.blocks')
      return {
        topic: null,
        blocks: [
          {
            id: 'block',
            noteId: 'note',
            noteTitle: 'Source',
            revision,
            createdAt: '2026-09-22',
            updatedAt: '2026-09-22',
            line: 5,
            endLine: 7,
            body: body.split('\n').slice(4).join('\n'),
          },
        ],
        offset: 0,
        limit: 50,
        total: 1,
        sort: 'newest',
        orderRevision: 'order',
      };
    if (command === 'task.update') {
      expect(a).toMatchObject({ id: 'note', expectedRevision: revision, toggle: true });
      body = toggleTaskInText(body, Number(a.line));
      revision += 'x';
      return { body, revision };
    }
    throw Error(`Unexpected ${command}`);
  });
  await import('./NotePreview');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<App />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.getSelection()?.removeAllRanges();
});

test('topic checkboxes write the nested task at its original note line and refresh both views', async () => {
  await act(async () => checkboxes()[1].click());
  expect(writes()[0][2]).toEqual({ id: 'note', line: 7, toggle: true, expectedRevision: 'r1' });
  expect(body).toContain('- [x] second');
  expect(body).toContain('- [ ] first');
  expect(checkboxes()[1].getAttribute('aria-checked')).toBe('true');
  expect(refresh).toHaveBeenCalledOnce();
  expect(openNote).not.toHaveBeenCalled();
  await act(async () => checkboxes()[1].click());
  expect(writes()[1][2]).toMatchObject({ line: 7, expectedRevision: 'r1x' });
  expect(body).toContain('- [ ] second');
});
test('blank card space opens the source, while links, text selection and controls keep their own behavior', async () => {
  await act(async () => card().click());
  expect(openNote).toHaveBeenCalledExactlyOnceWith('note', 5);
  openNote.mockClear();
  await act(async () => host.querySelector<HTMLButtonElement>('.wiki-link')!.click());
  expect(openLink).toHaveBeenCalledWith('Foo');
  expect(openNote).not.toHaveBeenCalled();
  const paragraph = card().querySelector('li')!;
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  window.getSelection()!.addRange(range);
  await act(async () => card().click());
  expect(openNote).not.toHaveBeenCalled();
  window.getSelection()!.removeAllRanges();
  await act(async () => host.querySelector<HTMLButtonElement>('.topic-origin-action')!.click());
  expect(openNote).toHaveBeenCalledExactlyOnceWith('note', 5);
});
test('pending writes block repeated clicks and conflicting revisions are never retried', async () => {
  let reject!: (error: Error) => void;
  const implementation = vi.mocked(call).getMockImplementation()!;
  vi.mocked(call).mockImplementation((path, command, args) =>
    command === 'task.update'
      ? new Promise((_resolve, rejected) => {
          reject = rejected;
        })
      : implementation(path, command, args),
  );
  await act(async () => checkboxes()[0].click());
  expect(checkboxes().every((button) => button.disabled)).toBe(true);
  await act(async () => checkboxes()[1].click());
  expect(writes()).toHaveLength(1);
  await act(async () => reject(Error('외부에서 변경되었습니다.')));
  expect(host.querySelector('[role=alert]')?.textContent).toContain('외부에서 변경되었습니다.');
  expect(writes()).toHaveLength(1);
  expect(refresh).not.toHaveBeenCalled();
  expect(checkboxes()[0].getAttribute('aria-checked')).toBe('false');
});
test('completing the last remaining checkbox immediately updates the completed-items filter', async () => {
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('완료된 항목 숨기기'))!.click(),
  );
  await act(async () => checkboxes()[0].click());
  expect(card()).not.toBeNull();
  await act(async () => checkboxes()[1].click());
  expect(card()).toBeNull();
  expect(host.textContent).toContain('표시할 항목이 없습니다.');
});
