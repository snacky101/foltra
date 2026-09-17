// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Palette } from './Palette';
import { Modal } from './Modal';
import { SearchDialog } from './SearchDialog';
import { call } from '../lib/api';
import type { Command } from '../lib/commands';
import type { Settings } from '../lib/types';

vi.mock('../lib/api', () => ({ call: vi.fn() }));

let host: HTMLDivElement, root: Root;
const close = vi.fn();
const run = vi.fn();
const commands = Array.from({ length: 30 }, (_, index) => ({
  id: `command-${index}`,
  title: `명령 ${index}`,
  group: '검증',
  run: vi.fn(),
})) as Command[];
const settings = { leader: ' ', keybindings: {} } as Settings;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  close.mockReset();
  run.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
async function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  await act(async () => host.querySelector('input')!.dispatchEvent(event));
  return event;
}
async function palette() {
  await act(async () =>
    root.render(
      <Palette
        commands={commands}
        notes={[]}
        settings={settings}
        close={close}
        run={run}
        openNote={() => {}}
      />,
    ),
  );
}

test.each([{ isComposing: true }, { keyCode: 229 }])(
  'palette keeps IME confirmation separate from commands (%j)',
  async (init) => {
    await palette();
    expect((await press('ArrowDown', init)).defaultPrevented).toBe(false);
    expect((await press('Enter', init)).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
    await press('Enter');
    expect(run).toHaveBeenCalledWith(commands[0]);
  },
);

test('a parent rerender keeps modal focus and uses the current close callback', async () => {
  const before = document.createElement('button');
  document.body.append(before);
  before.focus();
  const firstClose = vi.fn();
  const nextClose = vi.fn();
  const render = (onClose: () => void) =>
    root.render(
      <Modal title="초안" close={onClose}>
        <input aria-label="제목" />
        <textarea aria-label="본문" />
      </Modal>,
    );
  await act(async () => render(firstClose));
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const body = host.querySelector('textarea')!;
  body.focus();
  await act(async () => render(nextClose));
  expect(document.activeElement).toBe(body);
  await act(async () => body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(firstClose).not.toHaveBeenCalled();
  expect(nextClose).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(document.activeElement).toBe(before);
  before.remove();
});

test('palette keeps a keyboard-selected command visible as selection moves beyond the first page', async () => {
  await palette();
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
  for (let i = 0; i < 20; i++) await press('ArrowDown');
  const selected = host.querySelector('.palette-results .selected');
  expect(selected?.textContent).toContain('명령 20');
  expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
  expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts.at(-1)).toBe(selected);
  await press('Enter');
  expect(run).toHaveBeenCalledWith(commands[20]);
});

test('scrolling results under a stationary pointer cannot reset keyboard selection', async () => {
  await palette();
  await press('ArrowDown');
  await press('ArrowDown');
  const first = host.querySelector('.palette-results button')!;
  // Browsers deliver mouseover/enter when scrolling changes the element under the pointer.
  await act(async () => first.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await press('Enter');
  expect(run).toHaveBeenLastCalledWith(commands[2]);
  await act(async () =>
    first.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 40, clientY: 80 })),
  );
  await press('Enter');
  expect(run).toHaveBeenLastCalledWith(commands[0]);
});

test('empty results cannot leave selection negative when commands arrive', async () => {
  await act(async () =>
    root.render(
      <Palette commands={[]} notes={[]} settings={settings} close={close} run={run} openNote={() => {}} />,
    ),
  );
  await press('ArrowDown');
  await palette();
  await press('Enter');
  expect(run).toHaveBeenCalledWith(commands[0]);
});

test('content search also preserves keyboard selection when scrolling under the pointer', async () => {
  vi.useFakeTimers();
  vi.mocked(call).mockResolvedValue(
    commands.map((command) => ({ id: command.id, title: command.title, excerpt: '내용' })),
  );
  const openNote = vi.fn();
  await act(async () => root.render(<SearchDialog vault="/disposable" close={close} openNote={openNote} />));
  await act(async () => vi.advanceTimersByTimeAsync(180));
  await press('ArrowDown');
  await press('ArrowDown');
  const first = host.querySelector('.search-results button')!;
  await act(async () => first.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await press('Enter');
  expect(openNote).toHaveBeenLastCalledWith(commands[2].id);
  await act(async () =>
    first.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 40, clientY: 80 })),
  );
  await press('Enter');
  expect(openNote).toHaveBeenLastCalledWith(commands[0].id);
});

test.each([{ isComposing: true }, { keyCode: 229 }])(
  'IME Escape does not dismiss an unsaved modal draft (%j)',
  async (init) => {
    await act(async () =>
      root.render(
        <Modal title="초안" close={close}>
          <input defaultValue="한글 초안" />
        </Modal>,
      ),
    );
    await press('Escape', init);
    expect(close).not.toHaveBeenCalled();
    await press('Escape');
    expect(close).toHaveBeenCalledOnce();
  },
);
