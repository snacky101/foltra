// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PluginView } from './PluginView';
import type { PluginNode } from '../lib/pluginTypes';
let host: HTMLDivElement, root: Root;
const tree: PluginNode = {
  type: 'stack',
  children: [
    { type: 'input', label: 'Title', action: 'draft', value: '' },
    { type: 'button', text: 'Add', action: 'add' },
  ],
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
test('an input blur does not swallow the following button action while the input request is pending', async () => {
  let finish!: () => void;
  const action = vi.fn<(id: string, value?: string | boolean) => Promise<void>>();
  const render = (busy: boolean) =>
    root.render(<PluginView title="Test" tree={tree} busy={busy} action={action} refresh={() => {}} />);
  action
    .mockImplementationOnce(() => {
      render(true);
      return new Promise((resolve) => {
        finish = resolve;
      });
    })
    .mockResolvedValue(undefined);
  await act(async () => render(false));
  const input = host.querySelector('input')!;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'New card');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.blur());
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add')!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(action.mock.calls.map((c) => c.slice(0, 2))).toEqual([
    ['draft', 'New card'],
    ['add', undefined],
  ]);
  await act(async () => finish());
});
test('repeated clicks on the same pending action dispatch only once', async () => {
  let finish!: () => void;
  const action = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    root.render(<PluginView title="Test" tree={tree} busy={false} action={action} refresh={() => {}} />),
  );
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add')!;
  await act(async () => {
    button.click();
    button.click();
  });
  expect(action).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(true);
  await act(async () => finish());
  expect(button.disabled).toBe(false);
});
test('background refresh preserves a focused draft and queues its blur even while busy', async () => {
  const action = vi.fn().mockResolvedValue(undefined);
  const render = (value: string, busy: boolean) =>
    root.render(
      <PluginView
        title="Test"
        tree={{ type: 'input', label: 'Title', action: 'draft', value }}
        busy={busy}
        action={action}
        refresh={() => {}}
      />,
    );
  await act(async () => render('old', false));
  const input = host.querySelector('input')!;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '내 설정');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => render('background value', true));
  expect(input.disabled).toBe(false);
  expect(input.value).toBe('내 설정');
  expect(document.activeElement).toBe(input);
  await act(async () => input.blur());
  expect(action).toHaveBeenCalledWith('draft', '내 설정', undefined);
});

test('input blur does not disable the next select or checkbox while its action is queued', async () => {
  const action = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      <PluginView
        title="설정"
        tree={{
          type: 'stack',
          children: [
            {
              type: 'select',
              label: '데이터베이스',
              action: 'database',
              value: '없음',
              options: ['없음', '복습'],
            },
            { type: 'checkbox', label: '자동 동기화', action: 'auto', checked: false },
          ],
        }}
        busy={true}
        action={action}
        refresh={() => {}}
      />,
    ),
  );
  const select = host.querySelector<HTMLButtonElement>('[aria-label="데이터베이스"]')!;
  expect(select.disabled).toBe(false);
  await act(async () => select.click());
  const option = [...host.querySelectorAll<HTMLElement>('[role=option]')].find(
    (el) => el.textContent === '복습',
  )!;
  await act(async () => option.click());
  const toggle = host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  expect(toggle.disabled).toBe(false);
  await act(async () => toggle.click());
  expect(action.mock.calls.map((c) => c.slice(0, 2))).toEqual([
    ['database', '복습'],
    ['auto', true],
  ]);
});
