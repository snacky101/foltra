// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useAppUpdates, type AppUpdates } from './useAppUpdates';
import { AppUpdateDialogs, AppUpdatesPanel } from '../components/AppUpdatesPanel';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn(), invoke: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));

let host: HTMLDivElement, root: Root, api: AppUpdates, unmounted: boolean;
let prepare = vi.fn<() => Promise<() => void>>();
const release = vi.fn(),
  notify = vi.fn(),
  unlisten = vi.fn();
function Harness() {
  api = useAppUpdates({ prepare, notify });
  return (
    <>
      <AppUpdatesPanel updates={api} />
      <AppUpdateDialogs updates={api} />
    </>
  );
}
async function render() {
  await act(async () => root.render(<Harness />));
}
async function unmount() {
  await act(async () => root.unmount());
  unmounted = true;
}
function fixture() {
  return {
    currentVersion: '0.1.0-preview.2',
    version: '0.1.0-preview.3',
    body: 'New features\n<script>untrusted()</script>',
    close: vi.fn(async () => {}),
    download: vi.fn(async (_?: (event: DownloadEvent) => void) => {}),
    install: vi.fn(async () => {}),
  };
}
async function available(value = fixture()) {
  vi.mocked(check).mockResolvedValue(value as unknown as Update);
  await act(async () => api.check());
  return value;
}
async function downloaded(value = fixture()) {
  await available(value);
  await act(async () => api.download());
  return value;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  localStorage.clear();
  localStorage.setItem('foltra:app-updates:automatic', 'false');
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue(false);
  vi.mocked(getVersion).mockResolvedValue('0.1.0-preview.2');
  vi.mocked(listen).mockResolvedValue(unlisten);
  vi.mocked(check).mockResolvedValue(null);
  vi.mocked(relaunch).mockResolvedValue(undefined);
  prepare = vi.fn(async () => release);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  unmounted = false;
});
afterEach(async () => {
  if (!unmounted) await unmount();
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('browser shows desktop-only state without native or network requests', async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  await render();
  await act(async () => {
    await api.check();
    await api.download();
    await api.install();
    api.open();
  });
  expect(api.phase).toBe('unsupported');
  expect(host.textContent).toContain('데스크톱 앱');
  expect(check).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
  expect(getVersion).not.toHaveBeenCalled();
  expect(listen).not.toHaveBeenCalled();
});

test('manual checks deduplicate and no update displays current version', async () => {
  await render();
  let finish!: (value: null) => void;
  vi.mocked(check).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let request!: Promise<void>;
  await act(async () => {
    request = api.check();
    await api.check();
  });
  expect(api.phase).toBe('checking');
  expect(check).toHaveBeenCalledOnce();
  await act(async () => {
    finish(null);
    await request;
  });
  expect(api.phase).toBe('current');
  expect(api.version).toBe('0.1.0-preview.2');
  expect(host.textContent).toContain('최신 버전');
});

test('available updates render notes as text, never auto-download; progress waits for completed download', async () => {
  await render();
  const value = await available();
  expect(host.textContent).toContain('<script>untrusted()</script>');
  expect(host.querySelector('script')).toBeNull();
  expect(value.download).not.toHaveBeenCalled();
  let progress!: (event: DownloadEvent) => void, finish!: () => void;
  value.download.mockImplementation(
    (event) =>
      new Promise<void>((resolve) => {
        progress = event!;
        finish = resolve;
      }),
  );
  let request!: Promise<void>;
  await act(async () => {
    request = api.download();
    await api.download();
  });
  await act(async () => {
    progress({ event: 'Started', data: { contentLength: 1000 } });
    progress({ event: 'Progress', data: { chunkLength: 250 } });
    progress({ event: 'Progress', data: { chunkLength: 350 } });
  });
  expect(host.querySelector('progress')?.value).toBe(60);
  expect(api.blocking).toBe(false);
  expect(value.download).toHaveBeenCalledOnce();
  await act(async () => progress({ event: 'Finished' }));
  expect(api.phase).toBe('downloading');
  await act(async () => {
    finish();
    await request;
  });
  expect(api.phase).toBe('downloaded');
  expect(prepare).not.toHaveBeenCalled();
  expect(value.install).not.toHaveBeenCalled();
});

test('save failure prevents install and relaunch, unlocks native quit and preserves download for retry', async () => {
  await render();
  const value = await downloaded();
  prepare.mockRejectedValueOnce(new Error('unsaved content'));
  await act(async () => api.install());
  expect(value.install).not.toHaveBeenCalled();
  expect(relaunch).not.toHaveBeenCalled();
  expect(api.phase).toBe('downloaded');
  expect(api.blocking).toBe(false);
  expect(value.close).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith('set_update_in_progress', { inProgress: false });
  await act(async () => api.install());
  expect(value.install).toHaveBeenCalledOnce();
  expect(relaunch).toHaveBeenCalledOnce();
  expect(value.close).toHaveBeenCalledOnce();
});

test('install failure releases save barrier and closes consumed bytes; retry must check and download again', async () => {
  await render();
  const value = await downloaded();
  value.install.mockRejectedValueOnce(new Error('disk full'));
  await act(async () => api.install());
  expect(api.phase).toBe('idle');
  expect(api.error).toContain('disk full');
  expect(release).toHaveBeenCalledOnce();
  expect(value.close).toHaveBeenCalledOnce();
  expect(relaunch).not.toHaveBeenCalled();
  await act(async () => api.install());
  expect(value.install).toHaveBeenCalledOnce();
  const replacement = await downloaded();
  await act(async () => api.install());
  expect(replacement.install).toHaveBeenCalledOnce();
});

test('relaunch failure keeps edits blocked and retries only relaunch, without reinstall or re-save', async () => {
  await render();
  const value = await downloaded();
  vi.mocked(relaunch).mockRejectedValueOnce(new Error('restart denied'));
  await act(async () => api.install());
  expect(api.phase).toBe('restart-required');
  expect(api.blocking).toBe(true);
  expect(host.querySelector('[aria-label="업데이트 설치"]')).not.toBeNull();
  expect(release).not.toHaveBeenCalled();
  await act(async () => {
    await api.install();
    await api.check();
  });
  expect(value.install).toHaveBeenCalledOnce();
  await act(async () => api.retryRestart());
  expect(api.phase).toBe('restarting');
  expect(relaunch).toHaveBeenCalledTimes(2);
  expect(prepare).toHaveBeenCalledOnce();
  expect(value.install).toHaveBeenCalledOnce();
});

test('prepare blocks duplicate install and uses current vault save callback after rerender', async () => {
  await render();
  const value = await downloaded();
  const oldPrepare = prepare;
  let finish!: (release: () => void) => void;
  prepare = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  let request!: Promise<void>;
  await act(async () => {
    request = api.install();
    await api.install();
  });
  expect(api.phase).toBe('preparing');
  expect(api.isBlocking()).toBe(true);
  expect(value.install).not.toHaveBeenCalled();
  expect(oldPrepare).not.toHaveBeenCalled();
  await act(async () => {
    finish(release);
    await request;
  });
  expect(value.install).toHaveBeenCalledOnce();
});

test('late check closes its resource on unmount without adopting or downloading it', async () => {
  await render();
  const value = fixture();
  let finish!: (value: Update) => void;
  vi.mocked(check).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let request!: Promise<void>;
  await act(async () => {
    request = api.check();
  });
  await unmount();
  await act(async () => {
    finish(value as unknown as Update);
    await request;
  });
  expect(value.close).toHaveBeenCalledOnce();
  expect(value.download).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
});

test('download finishing after unmount is disposed once and never installed', async () => {
  await render();
  const value = await available();
  let finish!: () => void;
  value.download.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let request!: Promise<void>;
  await act(async () => {
    request = api.download();
  });
  await unmount();
  expect(value.close).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    await request;
  });
  expect(value.close).toHaveBeenCalledOnce();
  expect(value.install).not.toHaveBeenCalled();
});

test('download errors can retry and replacing an available result disposes the old resource', async () => {
  await render();
  const value = await available();
  value.download.mockRejectedValueOnce(new Error('offline'));
  await act(async () => api.download());
  expect(api.phase).toBe('available');
  expect(api.error).toContain('offline');
  await act(async () => api.download());
  expect(api.phase).toBe('downloaded');
  expect(value.download).toHaveBeenCalledTimes(2);
  await unmount();
  expect(value.close).toHaveBeenCalledOnce();
});

test('startup auto-check is delayed, once only, never downloads and silent failures do not toast', async () => {
  vi.useFakeTimers();
  localStorage.removeItem('foltra:app-updates:automatic');
  await render();
  expect(api.automatic).toBe(true);
  expect(check).not.toHaveBeenCalled();
  vi.mocked(check).mockRejectedValueOnce(new Error('offline'));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(check).toHaveBeenCalledOnce();
  expect(notify).not.toHaveBeenCalled();
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(check).toHaveBeenCalledOnce();
  await act(async () => api.setAutomatic(false));
  expect(localStorage.getItem('foltra:app-updates:automatic')).toBe('false');
});

test('automatic availability notifies once; a manual check suppresses the scheduled startup check', async () => {
  vi.useFakeTimers();
  localStorage.removeItem('foltra:app-updates:automatic');
  const value = fixture();
  vi.mocked(check).mockResolvedValue(value as unknown as Update);
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(notify).toHaveBeenCalledOnce();
  expect(value.download).not.toHaveBeenCalled();
  vi.mocked(check).mockResolvedValue(fixture() as unknown as Update);
  await act(async () => api.check());
  expect(value.close).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(check).toHaveBeenCalledTimes(2);
});

test('manual startup check suppresses automatic duplicate even when the preference is toggled again', async () => {
  vi.useFakeTimers();
  localStorage.removeItem('foltra:app-updates:automatic');
  await render();
  await act(async () => api.check());
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(check).toHaveBeenCalledOnce();
  expect(notify).not.toHaveBeenCalled();
  await act(async () => api.setAutomatic(false));
  await act(async () => api.setAutomatic(true));
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(check).toHaveBeenCalledOnce();
});

test('StrictMode replay installs one active listener and consumes pending native menu request once', async () => {
  let pending = true;
  const cleanups: ReturnType<typeof vi.fn>[] = [];
  vi.mocked(listen).mockImplementation(async () => {
    const cleanup = vi.fn();
    cleanups.push(cleanup);
    return cleanup;
  });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command !== 'take_update_check_request') return false;
    const result = pending;
    pending = false;
    return result;
  });
  await act(async () =>
    root.render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    ),
  );
  expect(cleanups).toHaveLength(2);
  expect(cleanups[0]).toHaveBeenCalledOnce();
  expect(cleanups[1]).not.toHaveBeenCalled();
  expect(api.opened).toBe(true);
  expect(check).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalledWith('set_update_in_progress', { inProgress: false });
  await unmount();
  expect(cleanups[1]).toHaveBeenCalledOnce();
});

test('unmount during save preparation releases acquired barrier without installing', async () => {
  await render();
  const value = await downloaded();
  let finish!: (resume: () => void) => void;
  prepare.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let request!: Promise<void>;
  await act(async () => {
    request = api.install();
  });
  await unmount();
  await act(async () => {
    finish(release);
    await request;
  });
  expect(release).toHaveBeenCalledOnce();
  expect(value.install).not.toHaveBeenCalled();
  expect(value.close).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledWith('set_update_in_progress', { inProgress: false });
});

test('native menu requests are consumed at listener registration and on events, including welcome', async () => {
  vi.mocked(invoke).mockImplementation(async (command) => command === 'take_update_check_request');
  await render();
  expect(api.opened).toBe(true);
  expect(check).toHaveBeenCalledOnce();
  const handler = vi.mocked(listen).mock.calls[0][1];
  await act(async () => {
    api.close();
  });
  vi.mocked(invoke).mockResolvedValue(false);
  await act(async () => handler({ event: 'foltra:check-for-updates', id: 1, payload: null }));
  expect(api.opened).toBe(false);
  expect(check).toHaveBeenCalledOnce();
});

test('native exit protection must succeed before save or installation starts', async () => {
  await render();
  const value = await downloaded();
  vi.mocked(invoke).mockRejectedValueOnce(new Error('IPC unavailable'));
  await act(async () => api.install());
  expect(api.phase).toBe('downloaded');
  expect(prepare).not.toHaveBeenCalled();
  expect(value.install).not.toHaveBeenCalled();
});
