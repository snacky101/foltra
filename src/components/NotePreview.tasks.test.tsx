// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NotePreview } from './NotePreview';
import { toggleTaskInText } from '../lib/markdownTasks';
import type { Workspace } from '../lib/types';
const workspace = { notes: [], records: [], settings: {} } as unknown as Workspace;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const source =
  '---\ntags: [sample]\n---\n\n- ordinary\nParagraph outside list\n- [ ] first\n  - [/] nested 한글\n\n> - [X] quoted\n\n1. [ ] ordered\n\n- [b] bookmark\n\n```md\n- [ ] code\n```';
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('[role=checkbox]')];
test('checkboxes use original body lines after frontmatter and display-only separators', async () => {
  const toggle = vi.fn();
  await act(async () =>
    root.render(
      <NotePreview
        body={source}
        workspace={workspace}
        openNote={() => {}}
        openLink={() => {}}
        onToggleTask={toggle}
      />,
    ),
  );
  expect(buttons()).toHaveLength(4);
  expect(buttons().map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'mixed', 'true', 'false']);
  for (const button of buttons()) await act(async () => button.click());
  expect(toggle.mock.calls).toEqual([[7], [8], [10], [12]]);
  expect(host.querySelector('[data-task-status=bookmark]')).not.toBeNull();
});
test('reading-mode clicks update just the requested marker and allow repeated check/uncheck', async () => {
  let result = source;
  function Preview() {
    const [body, setBody] = useState(source);
    result = body;
    return (
      <NotePreview
        body={body}
        workspace={workspace}
        openNote={() => {}}
        openLink={() => {}}
        onToggleTask={(line) => setBody((current) => toggleTaskInText(current, line))}
      />
    );
  }
  await act(async () => root.render(<Preview />));
  await act(async () => buttons()[1].click());
  expect(result).toBe(source.replace('[/] nested', '[x] nested'));
  await act(async () => buttons()[1].click());
  expect(result).toBe(source.replace('[/] nested', '[ ] nested'));
  expect(result).toContain('- [ ] code');
});
test('a pending task write disables all checkbox buttons and does not open the parent card', async () => {
  const toggle = vi.fn(),
    open = vi.fn();
  await act(async () =>
    root.render(
      <article onClick={open}>
        <NotePreview
          body={source}
          workspace={workspace}
          openNote={() => {}}
          openLink={() => {}}
          taskDisabled
          onToggleTask={toggle}
        />
      </article>,
    ),
  );
  await act(async () => buttons()[0].click());
  expect(toggle).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  await act(async () =>
    root.render(
      <article onClick={open}>
        <NotePreview
          body={source}
          workspace={workspace}
          openNote={() => {}}
          openLink={() => {}}
          onToggleTask={toggle}
        />
      </article>,
    ),
  );
  await act(async () => buttons()[0].click());
  expect(toggle).toHaveBeenCalledWith(7);
  expect(open).not.toHaveBeenCalled();
});
