// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from '../lib/api';
import { ThemeSettings } from './ThemeSettings';
import type { Extension, Workspace } from '../lib/types';

vi.mock('../lib/api', () => ({ call: vi.fn() }));
let host: HTMLDivElement, root: Root, selected: string, installed: Extension[];
const refresh = vi.fn<() => Promise<void>>(),
  update = vi.fn(),
  onError = vi.fn();
const custom: Extension = {
  id: 'custom',
  name: 'Custom',
  kind: 'theme',
  version: '1.0.0',
  tokens: { paper: '#202020' },
};
const render = () =>
  root.render(
    <ThemeSettings
      workspace={{ path: '/theme-qa', extensions: installed, settings: { theme: selected } } as Workspace}
      update={update}
      refresh={refresh}
      onError={onError}
    />,
  );
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = (label: string) => act(async () => button(label).click());
const upload = (content: string, size?: number) =>
  act(async () => {
    const file = new File([content], 'theme.json');
    Object.defineProperty(file, 'text', { value: async () => content });
    if (size) Object.defineProperty(file, 'size', { value: size });
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  selected = 'paper';
  installed = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  refresh.mockImplementation(async () => render());
  update.mockImplementation(async (patch) => {
    selected = patch.theme;
    render();
    return true;
  });
  vi.mocked(call).mockImplementation(async (_path, command, args) => {
    if (command === 'extension.install') {
      const manifest = (args as { manifest: Extension }).manifest;
      installed.push(manifest);
      return manifest;
    }
    if (command === 'extension.remove') {
      const id = (args as { id: string }).id;
      installed = installed.filter((t) => t.id !== id);
      if (selected === id) selected = 'paper';
    }
  });
  await act(async () => render());
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

test('two built-in themes can be selected immediately with no installation or delete action', async () => {
  expect(host.querySelectorAll('.theme-choice')).toHaveLength(2);
  expect(host.querySelectorAll('.theme-remove')).toHaveLength(0);
  await click('Midnight 사용');
  expect(update).toHaveBeenCalledExactlyOnceWith({ theme: 'night' });
  expect(call).not.toHaveBeenCalled();
  expect(button('Midnight 사용').getAttribute('aria-pressed')).toBe('true');
});

test('file themes are selectable and deleting the active theme updates the choice and Paper fallback', async () => {
  await upload(JSON.stringify(custom));
  expect(call).toHaveBeenCalledWith('/theme-qa', 'extension.install', { manifest: custom });
  expect(host.querySelectorAll('.theme-choice')).toHaveLength(3);
  await click('Custom 사용');
  update.mockClear();
  await click('Custom 삭제');
  expect(call).toHaveBeenLastCalledWith('/theme-qa', 'extension.remove', { id: 'custom' });
  expect(update).not.toHaveBeenCalled();
  expect(button('Custom 사용')).toBeNull();
  expect(button('Paper & Pine 사용').getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelector('[role=status]')?.textContent).toBe('Custom 삭제 완료');
});

test('an imported built-in ID shows one choice and deleting its file restores the built-in choice', async () => {
  await upload(JSON.stringify({ ...custom, id: 'paper', name: 'My Paper' }));
  expect(host.querySelectorAll('.theme-choice')).toHaveLength(2);
  await click('My Paper 삭제');
  expect(button('Paper & Pine 사용')).not.toBeNull();
  expect(button('Paper & Pine 삭제')).toBeNull();
});

test('failed deletion keeps the active theme and can be retried', async () => {
  installed = [custom];
  selected = 'custom';
  await act(async () => render());
  const error = new Error('Permission denied');
  vi.mocked(call).mockRejectedValueOnce(error);
  await click('Custom 삭제');
  expect(onError).toHaveBeenCalledWith(error);
  expect(refresh).not.toHaveBeenCalled();
  expect(button('Custom 사용').getAttribute('aria-pressed')).toBe('true');
  expect(button('Custom 삭제').disabled).toBe(false);
  await click('Custom 삭제');
  expect(button('Custom 사용')).toBeNull();
});

test.each([
  ['invalid JSON', '{', undefined],
  ['oversize', '{}', 256001],
  ['plugin', JSON.stringify({ kind: 'plugin' }), undefined],
] as const)('%s does not install or prevent the next valid upload', async (_label, content, size) => {
  await upload(content, size);
  expect(onError).toHaveBeenCalledOnce();
  expect(call).not.toHaveBeenCalled();
  await upload(JSON.stringify(custom));
  expect(call).toHaveBeenCalledOnce();
});

test('duplicate removal is suppressed and a late response cannot refresh a previous vault', async () => {
  installed = [custom];
  await act(async () => render());
  let finish!: () => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ removed: 'custom' });
      }),
  );
  await act(async () => {
    button('Custom 삭제').click();
    button('Custom 삭제').click();
  });
  expect(call).toHaveBeenCalledOnce();
  expect(button('Custom 삭제').disabled).toBe(true);
  await act(async () => root.render(null));
  await act(async () => finish());
  expect(refresh).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

test('catalog themes require installation, can be deleted and become installable again', async () => {
  expect(host.querySelectorAll('.theme-catalog-card')).toHaveLength(4);
  expect(button('Catppuccin Mocha 사용')).toBeNull();
  await click('Catppuccin Mocha 설치');
  expect(button('Catppuccin Mocha 설치').disabled).toBe(true);
  expect(button('Catppuccin Mocha 사용')).not.toBeNull();
  await click('Catppuccin Mocha 사용');
  expect(button('Catppuccin Mocha 사용').getAttribute('aria-pressed')).toBe('true');
  await click('Catppuccin Mocha 삭제');
  expect(button('Catppuccin Mocha 사용')).toBeNull();
  expect(button('Catppuccin Mocha 설치').disabled).toBe(false);
  expect(button('Paper & Pine 사용').getAttribute('aria-pressed')).toBe('true');
});
