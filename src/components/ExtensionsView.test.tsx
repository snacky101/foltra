// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from '../lib/api';
import { extensionCatalog } from '../lib/extensionCatalog';
import calendarFixture from '../../tests/fixtures/plugins/calendar.json';
import type { Extension, Workspace } from '../lib/types';
import { ExtensionsView } from './ExtensionsView';

vi.mock('../lib/api', () => ({ call: vi.fn() }));
let host: HTMLDivElement;
let root: Root;
let installed: Extension[];
let kind: Extension['kind'];
const refresh = vi.fn<() => Promise<void>>();
const onError = vi.fn();
const invokeSettings = vi.fn();
const beforeDisable = vi.fn<() => Promise<void>>();
let enabled = false;
const render = () =>
  root.render(
    <ExtensionsView
      key={kind}
      kind={kind}
      workspace={
        {
          path: '/temporary-catalog',
          extensions: [...installed],
          pluginStates: installed.map((e) => ({ id: e.id, enabled, digest: 'test-digest' })),
        } as Workspace
      }
      invokeSettings={invokeSettings}
      beforeDisable={beforeDisable}
      refresh={refresh}
      onError={onError}
    />,
  );
const button = (label: string) =>
  [...host.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label,
  )!;
const click = (label: string) => act(async () => button(label).click());
const installedFilter = () => host.querySelector<HTMLInputElement>('input[role=switch]')!;
const toggleInstalled = () => act(async () => installedFilter().click());
const search = (query: string) =>
  act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type=search]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const upload = (content: string, size?: number) =>
  act(async () => {
    const file = new File([content], 'custom.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => content });
    if (size) Object.defineProperty(file, 'size', { value: size });
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  installed = [];
  enabled = false;
  kind = 'plugin';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  refresh.mockImplementation(async () => render());
  beforeDisable.mockResolvedValue(undefined);
  vi.mocked(call).mockImplementation(async (_path, command, args) => {
    if (command === 'extension.install') {
      const { manifest } = args as { manifest: Extension };
      installed.push(manifest);
      return manifest;
    }
    if (command === 'extension.settings.get') return { values: {}, revision: 'test-revision' };
    if (command === 'extension.update') {
      const { manifest } = args as { manifest: Extension };
      installed = installed.map((extension) => (extension.id === manifest.id ? manifest : extension));
      enabled = false;
      return manifest;
    }
    if (command === 'extension.remove')
      installed = installed.filter((e) => e.id !== (args as { id: string }).id);
  });
  await act(async () => render());
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

test('Anki and the daily calendar are offered in the catalog, while local plugins remain available', async () => {
  expect(extensionCatalog.filter((e) => e.kind === 'plugin').map((e) => e.id)).toEqual([
    'anki',
    'daily-calendar',
  ]);
  expect(extensionCatalog.filter((e) => e.kind === 'theme').map((e) => e.id)).toEqual([
    'catppuccin-mocha',
    'rose-pine',
    'tokyo-night',
    'darcula',
  ]);
  expect([...host.querySelectorAll('.extension-card')].map((e) => e.getAttribute('aria-label'))).toEqual([
    'Anki 연결',
    '일지 캘린더',
  ]);
  const custom = { ...calendarFixture, id: 'local-calendar', name: 'My calendar' };
  await upload(JSON.stringify(custom));
  expect(call).toHaveBeenCalledWith('/temporary-catalog', 'extension.install', { manifest: custom });
  expect(host.querySelector('.extension-card')?.getAttribute('aria-label')).toBe('My calendar');
});

test('catalog installation waits for the core, suppresses duplicate clicks, and removal makes it installable again', async () => {
  const extension = extensionCatalog[0];
  let finish!: () => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => {
          installed.push(extension);
          resolve(extension);
        };
      }),
  );
  await act(async () => {
    button(`${extension.name} 설치`).click();
    button(`${extension.name} 설치`).click();
  });
  expect(call).toHaveBeenCalledExactlyOnceWith('/temporary-catalog', 'extension.install', {
    manifest: extension,
  });
  expect(button('파일로 설치').disabled).toBe(true);
  expect(host.textContent).toContain('설치 중…');
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(host.querySelector('.extension-installed')?.textContent).toBe('설치됨');
  expect(button(`${extension.name} 설치`)).toBeUndefined();
  expect(button(`${extension.name} 제거`).disabled).toBe(false);
  await toggleInstalled();
  expect(host.querySelectorAll('.extension-card')).toHaveLength(1);
  await click(`${extension.name} 제거`);
  expect(host.textContent).toContain('아직 설치된 확장이 없어요');
  await toggleInstalled();
  expect(button(`${extension.name} 설치`).disabled).toBe(false);
});

test('a failed install does not claim success and permits retry', async () => {
  const error = new Error('Disk full');
  vi.mocked(call).mockRejectedValueOnce(error);
  await click('Anki 연결 설치');
  expect(onError).toHaveBeenCalledWith(error);
  expect(refresh).not.toHaveBeenCalled();
  expect(host.querySelector('[role=status]')?.textContent).toBe('');
  expect(button('Anki 연결 설치').disabled).toBe(false);
  await click('Anki 연결 설치');
  expect(button('Anki 연결 설치')).toBeUndefined();
  expect(button('Anki 연결 제거').disabled).toBe(false);
});

test('file installation retains custom manifests and prevents catalog replacement of the same ID', async () => {
  const custom: Extension = {
    kind: 'plugin',
    id: 'anki',
    name: 'My own Anki',
    version: '2.0.0',
    commands: [],
  };
  await upload(JSON.stringify(custom));
  expect(call).toHaveBeenCalledWith('/temporary-catalog', 'extension.install', { manifest: custom });
  expect(host.querySelector('.extension-card')?.textContent).toContain('My own Anki');
  expect(host.querySelector('.version')?.textContent).toBe('v2.0.0');
  expect(installedFilter().checked).toBe(true);
  await toggleInstalled();
  expect(button('Anki 연결 설치')).toBeUndefined();
  expect(button('My own Anki 설치')).toBeUndefined();
  expect(host.querySelector('[aria-label="My own Anki"] .version')?.textContent).toBe('v2.0.0');
  expect(button('My own Anki 제거').disabled).toBe(false);
  expect(call).toHaveBeenCalledOnce();
});

test.each([
  ['invalid JSON', '{', undefined],
  ['oversized file', '{}', 256001],
] as const)(
  '%s is rejected without writing and does not block subsequent file installation',
  async (_label, content, size) => {
    await upload(content, size);
    expect(onError).toHaveBeenCalledOnce();
    expect(call).not.toHaveBeenCalled();
    expect(button('파일로 설치').disabled).toBe(false);
    await upload(JSON.stringify(extensionCatalog[0]));
    expect(call).toHaveBeenCalledOnce();
    expect(host.querySelectorAll('.extension-card')).toHaveLength(1);
  },
);

test('a pending installation cannot refresh the previous vault after leaving it', async () => {
  let finish!: () => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(extensionCatalog[0]);
      }),
  );
  await click('Anki 연결 설치');
  await act(async () => root.render(null));
  await act(async () => finish());
  expect(refresh).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

test.each(['plugin', 'theme'] as const)(
  '%s management only lists its own catalog and installed packages',
  async (value) => {
    kind = value;
    installed = [...extensionCatalog];
    await act(async () => render());
    const expected = installed.filter((e) => e.kind === kind).map((e) => e.name);
    const names = () =>
      [...host.querySelectorAll('.extension-card')].map((e) => e.getAttribute('aria-label'));
    expect(names()).toEqual(expected);
    expect(installedFilter().checked).toBe(false);
    expect(host.querySelector('.extension-installed-count')?.textContent).toBe(`${expected.length}`);
    await toggleInstalled();
    expect(names()).toEqual(expected);
  },
);

test.each(['plugin'] as const)(
  '%s installed filter includes local packages, retains search, and updates immediately on removal',
  async (value) => {
    kind = value;
    const catalog = extensionCatalog.filter((e) => e.kind === kind);
    const custom: Extension = { ...catalog[0], id: 'local-only', name: 'Local package' };
    installed = [catalog[0], custom, extensionCatalog.find((e) => e.kind !== kind)!];
    await act(async () => render());
    const names = () =>
      [...host.querySelectorAll('.extension-card')].map((e) => e.getAttribute('aria-label'));
    expect(names()).toEqual([...catalog.map((e) => e.name), custom.name]);
    await toggleInstalled();
    expect(names()).toEqual([catalog[0].name, custom.name]);
    await search('Local package');
    expect(names()).toEqual([custom.name]);
    await toggleInstalled();
    expect(names()).toEqual([custom.name]);
    expect(host.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('Local package');
    await click('Local package 제거');
    expect(names()).toEqual([]);
    expect(host.textContent).toContain('검색 결과가 없어요');
    expect(host.querySelector('.extension-installed-count')?.textContent).toBe('1');
    await search('');
    expect(names()).toEqual(catalog.map((e) => e.name));
    await toggleInstalled();
    expect(names()).toEqual([catalog[0].name]);
  },
);

test.each(['plugin', 'theme'] as const)(
  '%s file picker rejects the other kind without installing it',
  async (value) => {
    kind = value;
    await act(async () => render());
    const opposite = extensionCatalog.find((e) => e.kind !== kind)!;
    await upload(JSON.stringify(opposite));
    expect(call).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          kind === 'theme'
            ? '플러그인 파일은 설정 → 확장에서 설치하세요.'
            : '테마 파일은 설정 → 테마에서 설치하세요.',
      }),
    );
    const matching = extensionCatalog.find((e) => e.kind === kind)!;
    await upload(JSON.stringify(matching));
    expect(call).toHaveBeenCalledWith('/temporary-catalog', 'extension.install', { manifest: matching });
    expect(host.querySelectorAll('.extension-card')).toHaveLength(1);
  },
);

test('extension settings have a dedicated page and preserve list search and filters on return', async () => {
  installed = [calendarFixture as Extension];
  await act(async () => render());
  await toggleInstalled();
  await search('캘린더');
  await click('노트 캘린더 설정');
  expect(host.querySelector('.extension-grid')).toBeNull();
  expect(host.querySelector('[aria-label="노트 날짜 기준"]')).not.toBeNull();
  expect(call).toHaveBeenCalledWith('/temporary-catalog', 'extension.settings.get', { id: 'calendar' });
  await click('확장 목록으로');
  expect(host.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('캘린더');
  expect(installedFilter().checked).toBe(true);
  expect(host.querySelectorAll('.extension-card')).toHaveLength(1);
});

test('custom settings execute only for an enabled plugin and stay inside extensions', async () => {
  installed = [extensionCatalog.find((e) => e.id === 'anki')!];
  await act(async () => render());
  await click('Anki 연결 설정');
  expect(host.textContent).toContain('확장을 활성화하면 설정을 불러옵니다.');
  expect(invokeSettings).not.toHaveBeenCalled();
  invokeSettings.mockResolvedValue({ view: { type: 'text', text: 'Anki 설정 내용' } });
  enabled = true;
  await act(async () => render());
  expect(invokeSettings).toHaveBeenCalledWith('anki', { type: 'render', id: 'settings' });
  expect(host.textContent).toContain('Anki 설정 내용');
  expect(host.querySelector('.extension-settings-page')).not.toBeNull();
  enabled = false;
  await act(async () => render());
  expect(host.textContent).not.toContain('Anki 설정 내용');
});

test('already installed Anki 1.0.0 exposes settings without replacing the package', async () => {
  const legacy = structuredClone(extensionCatalog.find((e) => e.id === 'anki')!);
  legacy.version = '1.0.0';
  delete legacy.runtime!.settingsView;
  legacy.runtime!.views = legacy.runtime!.views!.filter((view) => view.id === 'sync');
  installed = [legacy];
  enabled = true;
  invokeSettings.mockResolvedValue({
    view: { type: 'input', label: 'Anki 덱 이름', action: 'deck', value: '기존 덱' },
  });
  await act(async () => render());
  await click('Anki 연결 설정');
  expect(invokeSettings).toHaveBeenCalledWith('anki', { type: 'render', id: 'sync' });
  expect(host.querySelector<HTMLInputElement>('[aria-label="Anki 덱 이름"]')?.value).toBe('기존 덱');
  expect(call).not.toHaveBeenCalled();
  expect(installed[0]).toEqual(legacy);
  expect(host.querySelector('.version')?.textContent).toBe('v1.0.0');
});

test('an installed older package can update in place and requires activation again', async () => {
  const latest = extensionCatalog.find((e) => e.id === 'anki')!;
  installed = [{ ...latest, version: '1.1.0' }];
  enabled = true;
  await act(async () => render());
  await toggleInstalled();
  await search('Anki');
  expect(button('Anki 연결 업데이트').textContent).toContain(`v${latest.version} 업데이트`);
  await click('Anki 연결 업데이트');
  expect(call).toHaveBeenCalledExactlyOnceWith('/temporary-catalog', 'extension.update', {
    manifest: latest,
    expectedDigest: 'test-digest',
  });
  expect(beforeDisable).toHaveBeenCalledExactlyOnceWith('anki');
  expect(vi.mocked(call).mock.invocationCallOrder[0]).toBeLessThan(beforeDisable.mock.invocationCallOrder[0]);
  expect(beforeDisable.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
  expect(installed[0]).toEqual(latest);
  expect(button('Anki 연결 업데이트')).toBeUndefined();
  expect(host.querySelector<HTMLInputElement>('[aria-label="Anki 연결 활성화"]')?.checked).toBe(false);
  expect(host.querySelector('[role=status]')?.textContent).toBe('업데이트 완료 · 권한 확인 후 활성화하세요');
  expect(installedFilter().checked).toBe(true);
  expect(host.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('Anki');
});

test.each([extensionCatalog.find((e) => e.id === 'anki')!.version, '1.10.0', '2.0.0', 'custom-version'])(
  '%s is not replaced by a lower, equal or uncomparable catalog version',
  async (version) => {
    installed = [{ ...extensionCatalog.find((e) => e.id === 'anki')!, version }];
    await act(async () => render());
    expect(button('Anki 연결 업데이트')).toBeUndefined();
    expect(call).not.toHaveBeenCalled();
  },
);

test('a failed stale update preserves the existing package and active session', async () => {
  const current = { ...extensionCatalog.find((e) => e.id === 'anki')!, version: '1.1.0' };
  installed = [current];
  enabled = true;
  await act(async () => render());
  const error = new Error('Installed extension changed');
  vi.mocked(call).mockRejectedValueOnce(error);
  await click('Anki 연결 업데이트');
  expect(onError).toHaveBeenCalledWith(error);
  expect(beforeDisable).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  expect(installed[0]).toBe(current);
  expect(host.querySelector<HTMLInputElement>('[aria-label="Anki 연결 활성화"]')?.checked).toBe(true);
  expect(button('Anki 연결 업데이트').disabled).toBe(false);
  expect(host.querySelector('[role=status]')?.textContent).toBe('');
});

test('pending updates suppress duplicate clicks and cannot stop a different vault after unmount', async () => {
  installed = [{ ...extensionCatalog.find((e) => e.id === 'anki')!, version: '1.1.0' }];
  await act(async () => render());
  let finish!: () => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(installed[0]);
      }),
  );
  await act(async () => {
    button('Anki 연결 업데이트').click();
    button('Anki 연결 업데이트').click();
  });
  expect(call).toHaveBeenCalledOnce();
  expect(button('Anki 연결 업데이트').disabled).toBe(true);
  expect(button('Anki 연결 제거').textContent).toBe('제거');
  expect(button('Anki 연결 제거').disabled).toBe(true);
  await act(async () => root.render(null));
  await act(async () => finish());
  expect(beforeDisable).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
