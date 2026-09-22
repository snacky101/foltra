// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { GraphView } from './GraphView';
import { layoutGraph } from '../lib/graphLayout';
import type { Workspace } from '../lib/types';

test('streamed graph snapshots preserve the camera and worker lifecycle through selection', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const workers: WorkerMock[] = [];
  class WorkerMock {
    onmessage?: (event: { data: ReturnType<typeof layoutGraph> }) => void;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      workers.push(this);
    }
  }
  vi.stubGlobal('Worker', WorkerMock);
  const remove = vi.fn();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: remove,
  }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const workspace = {
    notes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ],
    links: [{ source: 'a', target: 'b' }],
    folders: [],
    settings: {},
  } as unknown as Workspace;
  const openNote = vi.fn(),
    openLink = vi.fn(),
    updateSettings = vi.fn();
  try {
    await act(async () => root.render(<GraphView {...{ workspace, openNote, openLink, updateSettings }} />));
    expect(workers).toHaveLength(1);
    const worker = workers[0];
    expect(worker.postMessage.mock.calls[0][0].type).toBe('start');
    const layout = layoutGraph({ notes: workspace.notes, links: workspace.links });
    await act(async () => worker.onmessage?.({ data: layout }));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="확대"]')!.click());
    const camera = host.querySelector('.graph-scene')!.getAttribute('transform');
    await act(async () =>
      worker.onmessage?.({
        data: { ...layout, nodes: layout.nodes.map((node) => ({ ...node, x: node.x + 10 })) },
      }),
    );
    expect(host.querySelector('.graph-scene')!.getAttribute('transform')).toBe(camera);
    await act(async () =>
      host.querySelector('[data-node-id="a"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(host.querySelector('[data-node-id="a"]')!.classList.contains('selected')).toBe(true);
    expect(workers).toHaveLength(1);
    expect(worker.terminate).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
  } finally {
    host.remove();
    vi.unstubAllGlobals();
  }
});
