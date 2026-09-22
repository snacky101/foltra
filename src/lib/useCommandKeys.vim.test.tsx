// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { history } from '@codemirror/commands';
import { vim, getCM } from '@replit/codemirror-vim';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { useCommandKeys } from './useCommandKeys';
import { bindVimInput } from './vimInput';
import type { Settings } from './types';

let root: Root, host: HTMLDivElement, view: EditorView, unbind: () => void;
const run = vi.fn();
const rects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
function Harness({ leader = ' ' }: { leader?: string }) {
  const pending = useCommandKeys(
    [{ id: 'test', title: 'Test', group: 'Test', bindings: [{ keys: 'e', leader: true }], run }],
    { vim: true, leader, keybindings: { test: [{ keys: 'e', leader: true }] } } as unknown as Settings,
    'NORMAL',
    false,
    () => {},
  );
  return (
    <>
      <div id="editor-host" />
      <output>{pending === null ? 'idle' : 'leader'}</output>
    </>
  );
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  run.mockClear();
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  view = new EditorView({
    parent: host.querySelector('#editor-host')!,
    state: EditorState.create({ doc: 'abc def ghi', extensions: [vim(), history()] }),
  });
  view.focus();
  unbind = bindVimInput(view);
});
afterEach(async () => {
  unbind();
  view.destroy();
  await act(async () => root.unmount());
  host.remove();
  if (rects) Object.defineProperty(Range.prototype, 'getClientRects', rects);
  else delete (Range.prototype as Partial<Range>).getClientRects;
  if (rect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rect);
  else delete (Range.prototype as Partial<Range>).getBoundingClientRect;
});
async function key(key: string, extra: KeyboardEventInit = {}) {
  await act(async () =>
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        code: key === ' ' ? 'Space' : /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : key,
        bubbles: true,
        cancelable: true,
        ...extra,
      }),
    ),
  );
}

test.each([
  ['t', ' def ghi'],
  ['f', 'def ghi'],
])(
  'd%s Space deletes to its literal target without starting Leader and supports undo',
  async (motion, after) => {
    await key('d');
    await key(motion);
    expect(getCM(view)?.state.vim?.expectLiteralNext).toBe(true);
    await key(' ');
    expect(host.querySelector('output')?.textContent).toBe('idle');
    expect(view.state.doc.toString()).toBe(after);
    expect(run).not.toHaveBeenCalled();
    await key('u');
    expect(view.state.doc.toString()).toBe('abc def ghi');
    await key(' ');
    expect(host.querySelector('output')?.textContent).toBe('leader');
    await key('e');
    expect(run).toHaveBeenCalledOnce();
  },
);

test.each(['t', 'f', 'r'])('%s Space remains a Vim literal argument', async (motion) => {
  await key(motion);
  await key(' ');
  expect(host.querySelector('output')?.textContent).toBe('idle');
  expect(view.state.doc.toString()).toBe(motion === 'r' ? ' bc def ghi' : 'abc def ghi');
  if (motion !== 'r') expect(view.state.selection.main.head).toBe(motion === 't' ? 2 : 3);
});

test('Korean-layout dt followed by Space reaches Vim; Escape resets the pending operator', async () => {
  await key('ㅇ', { code: 'KeyD' });
  await key('ㅅ', { code: 'KeyT' });
  await key(' ');
  expect(view.state.doc.toString()).toBe(' def ghi');
  expect(host.querySelector('output')?.textContent).toBe('idle');
  await key('d');
  await key('t');
  await key('Escape');
  await key(' ');
  expect(host.querySelector('output')?.textContent).toBe('leader');
});

test('custom Leader characters, counted motions and operator-pending Space keep Vim precedence', async () => {
  await act(async () => root.render(<Harness leader="," />));
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: 'one,two,three' },
    selection: { anchor: 0 },
  });
  await key('2');
  await key('d');
  await key('t');
  await key(',');
  expect(view.state.doc.toString()).toBe(',three');
  expect(host.querySelector('output')?.textContent).toBe('idle');
  await act(async () => root.render(<Harness />));
  await key('d');
  await key(' ');
  expect(view.state.doc.toString()).toBe('three');
  expect(host.querySelector('output')?.textContent).toBe('idle');
});
