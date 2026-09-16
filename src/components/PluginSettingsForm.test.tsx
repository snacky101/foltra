// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { call } from '../lib/api';
import type { Extension } from '../lib/types';
import { PluginSettingsForm } from './PluginSettingsForm';

vi.mock('../lib/api', () => ({ call: vi.fn() }));
const extension: Extension = {
  id: 'custom',
  kind: 'plugin',
  name: 'Custom',
  version: '1',
  runtime: {
    apiVersion: 1,
    source: 'export default {}',
    permissions: [],
    settings: [
      { id: 'label', label: '제목 접두사', type: 'text', default: '기록' },
      { id: 'count', label: '표시 개수', type: 'number', default: 3 },
      { id: 'enabled', label: '기능 사용', type: 'checkbox', default: false },
    ],
  },
};
let host: HTMLDivElement, root: Root;
const refresh = vi.fn();
const render = () =>
  root.render(<PluginSettingsForm extension={extension} vault="/temporary" refresh={refresh} />);
const input = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
const type = (label: string, value: string) =>
  act(async () => {
    const el = input(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const submit = () =>
  act(async () =>
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(call).mockResolvedValue({ values: { label: '기록', count: 3, enabled: false }, revision: 'r1' });
  await act(async () => render());
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

test('saves typed settings with the loaded revision and restores them when reopened', async () => {
  await type('제목 접두사', '회의');
  await type('표시 개수', '7');
  await act(async () => input('기능 사용').click());
  const values = { label: '회의', count: 7, enabled: true };
  vi.mocked(call).mockResolvedValue({ values, revision: 'r2' });
  await submit();
  expect(call).toHaveBeenLastCalledWith('/temporary', 'extension.settings.update', {
    id: 'custom',
    values,
    expectedRevision: 'r1',
  });
  expect(refresh).toHaveBeenCalledOnce();
  expect(host.textContent).toContain('설정을 저장했습니다.');
  await act(async () => root.render(null));
  await act(async () => render());
  expect(input('제목 접두사').value).toBe('회의');
  expect(input('표시 개수').value).toBe('7');
  expect(input('기능 사용').checked).toBe(true);
});

test('retains the draft after a revision conflict without retrying or claiming success', async () => {
  await type('제목 접두사', '내 변경');
  vi.mocked(call).mockRejectedValueOnce(new Error('설정이 변경되었습니다. 다시 불러오세요.'));
  await submit();
  expect(input('제목 접두사').value).toBe('내 변경');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('다시 불러오세요');
  expect(call).toHaveBeenCalledTimes(2);
  expect(refresh).not.toHaveBeenCalled();
  expect(host.querySelector('[role=status]')?.textContent).toBe('');
});
