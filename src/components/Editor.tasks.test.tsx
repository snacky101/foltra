// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { Editor, type EditorHandle } from './Editor';
import type { Workspace } from '../lib/types';

afterEach(() => vi.unstubAllGlobals());

test('task editing respects editor focus, read mode and the note change callback', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const ref = createRef<EditorHandle>();
  const onChange = vi.fn();
  const workspace = {
    vault: { id: 'tasks-test' },
    notes: [],
    records: [],
    settings: { cursorShape: 'bar', cursorBlink: 'steady', lineNumbers: 'none' },
  } as unknown as Workspace;
  const render = (hidden = false) => (
    <>
      <input aria-label="Property" />
      <Editor
        ref={ref}
        noteId="task-note"
        value="- [ ] item"
        hidden={hidden}
        vimEnabled={false}
        livePreview
        workspace={workspace}
        openNote={() => {}}
        openLink={() => {}}
        vimBindings={[]}
        onCommand={() => {}}
        commandLineHost={{ current: null }}
        slash={false}
        onChange={onChange}
        onMode={() => {}}
        onSlash={() => {}}
        onNoteCommand={async () => {}}
        onError={() => {}}
      />
    </>
  );
  try {
    await act(async () => root.render(render()));
    await act(async () => {
      ref.current?.focus();
      ref.current?.cycleTask();
    });
    expect(onChange).toHaveBeenLastCalledWith('- [/] item');
    onChange.mockClear();
    await act(async () => {
      host.querySelector('input')!.focus();
      ref.current?.cycleTask();
    });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => root.render(render(true)));
    onChange.mockClear();
    await act(async () => {
      ref.current?.focus();
      ref.current?.cycleTask();
    });
    expect(onChange).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
