// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { CliSettings } from './CliSettings';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn(), invoke: vi.fn() }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const status = { available: true, installed: false, path: '/usr/local/bin/foltra' };

test('only installs on click and reports the confirmed installed state', async () => {
  vi.mocked(invoke)
    .mockResolvedValueOnce(status)
    .mockResolvedValueOnce({ ...status, installed: true });
  await act(async () => root.render(<CliSettings />));
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith('cli_status');
  await act(async () => host.querySelector('button')!.click());
  expect(invoke).toHaveBeenLastCalledWith('install_cli');
  expect(host.querySelector('button')!.disabled).toBe(true);
  expect(host.textContent).toContain('설치됨');
});

test('cancelled authentication permits retry and does not claim installation', async () => {
  vi.mocked(invoke).mockResolvedValueOnce(status).mockRejectedValueOnce('설치 취소');
  await act(async () => root.render(<CliSettings />));
  await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('설치 취소');
  expect(host.querySelector('button')!.disabled).toBe(false);
  expect(host.textContent).not.toContain('설치됨');
});

test('an existing conflicting command is explained without enabling installation', async () => {
  vi.mocked(invoke).mockResolvedValue({ ...status, available: false, message: '다른 파일이 있습니다.' });
  await act(async () => root.render(<CliSettings />));
  expect(host.querySelector('button')!.disabled).toBe(true);
  expect(host.textContent).toContain('다른 파일이 있습니다.');
});

test('browser mode never invokes native installation', async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  await act(async () => root.render(<CliSettings />));
  expect(invoke).not.toHaveBeenCalled();
  expect(host.querySelector('button')!.disabled).toBe(true);
});
