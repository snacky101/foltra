// @vitest-environment jsdom
import { act } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from './api';
import { livePreviewExtension, refreshLivePreview } from './livePreview';
import type { Workspace } from './types';

vi.mock('./api', () => ({ call: vi.fn() }));
let view: EditorView;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(call)
    .mockReset()
    .mockResolvedValue({
      columns: [{ name: '이름', type: 'text' }],
      rows: [['기록']],
      truncated: false,
      limit: 500,
    });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(async () => {
  await act(async () => view?.destroy());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

test('live SQL widget keeps its result table when edits move its source range or snapshots refresh', async () => {
  let workspace = { path: '/sql-live-vault', notes: [], databases: [], records: [] } as unknown as Workspace;
  const doc = 'Before\n\n```foltra-sql\nSELECT "이름" FROM "Reading room";\n```\n\nAfter';
  await act(async () => {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [
          markdown(),
          livePreviewExtension(() => ({ workspace, openNote() {}, openLink() {} }), true),
        ],
      }),
    });
  });
  const table = view.dom.querySelector('table');
  expect(table?.textContent).toContain('기록');
  await act(async () => view.dispatch({ changes: { from: 0, insert: 'Another paragraph\n\n' } }));
  expect(view.dom.querySelector('table')).toBe(table);
  workspace = structuredClone(workspace);
  await act(async () => view.dispatch({ effects: refreshLivePreview.of(null) }));
  expect(view.dom.querySelector('table')).toBe(table);
  expect(call).toHaveBeenCalledTimes(1);
  expect(view.state.doc.toString()).toBe('Another paragraph\n\n' + doc);
});
