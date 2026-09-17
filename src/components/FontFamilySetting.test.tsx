// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FontFamilySetting } from './FontFamilySetting';
import { fontFamilyStack } from '../lib/fontFamily';

let host: HTMLDivElement, root: Root;
const save = vi.fn<(value: string) => Promise<boolean>>();
function App({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <FontFamilySetting
      label="편집기"
      value={value}
      onChange={async (next) => {
        const saved = await save(next);
        if (saved) setValue(next);
        return saved;
      }}
    />
  );
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  save.mockReset().mockResolvedValue(true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<App />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const trigger = () => host.querySelector<HTMLButtonElement>('[aria-label="편집기 글꼴"]')!;
const input = () => host.querySelector<HTMLInputElement>('[aria-label="편집기 글꼴 이름"]')!;
const preview = () => host.querySelector<HTMLElement>('[aria-label="편집기 글꼴 미리보기"]')!;
async function choose(name: string) {
  await act(async () => trigger().click());
  await act(async () =>
    [...host.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((item) => item.textContent === name)!
      .click(),
  );
}
async function edit(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function enter(options: KeyboardEventInit = {}) {
  await act(async () =>
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options }),
    ),
  );
}

test('presets persist immediately and the preview follows the saved family, including default reset', async () => {
  for (const [label, family] of [
    ['시스템', 'system-ui'],
    ['고딕', 'sans-serif'],
    ['명조', 'serif'],
    ['고정폭', 'monospace'],
    ['기본 글꼴', ''],
  ]) {
    await choose(label);
    expect(save).toHaveBeenLastCalledWith(family);
    expect(trigger().textContent).toContain(label);
    expect(preview().style.fontFamily).toBe(fontFamilyStack(family) ?? 'var(--body-font)');
  }
  expect(preview().textContent).toContain('공간 · Foltra · 0123456789');
});

test('custom mode does not save until Apply or Enter, and composition Enter keeps the draft', async () => {
  await choose('직접 입력');
  await edit('  Apple SD Gothic Neo  ');
  expect(save).not.toHaveBeenCalled();
  await enter({ isComposing: true });
  await enter({ keyCode: 229 });
  expect(save).not.toHaveBeenCalled();
  expect(preview().style.fontFamily).toBe('var(--body-font)');
  await enter();
  expect(save).toHaveBeenLastCalledWith('Apple SD Gothic Neo');
  expect(input().value).toBe('Apple SD Gothic Neo');
  expect(preview().style.fontFamily).toBe(fontFamilyStack('Apple SD Gothic Neo'));
  await edit('Pretendard');
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '적용')!
      .click(),
  );
  expect(save).toHaveBeenLastCalledWith('Pretendard');
});

test('failed custom and preset saves keep the custom draft and previous preview for retry', async () => {
  await choose('명조');
  await choose('직접 입력');
  await edit('Missing Family');
  save.mockResolvedValue(false);
  await enter();
  expect(input().value).toBe('Missing Family');
  expect(preview().style.fontFamily).toBe(fontFamilyStack('serif'));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('저장하지 못했습니다');
  await choose('고딕');
  expect(input().value).toBe('Missing Family');
  await choose('직접 입력');
  expect(input().value).toBe('Missing Family');
  save.mockResolvedValue(true);
  await enter();
  expect(preview().style.fontFamily).toBe(fontFamilyStack('Missing Family'));
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

test('pending saves disable controls and cannot issue duplicate writes; blank names are rejected locally', async () => {
  await choose('직접 입력');
  await edit('  ');
  await enter();
  expect(save).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('글꼴 이름');
  await edit('Pretendard');
  let finish!: (saved: boolean) => void;
  save.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  await enter();
  expect(input().disabled).toBe(true);
  expect(trigger().disabled).toBe(true);
  await enter();
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => finish(true));
  expect(input().disabled).toBe(false);
});

test('an existing custom family is editable without changing settings on mount', async () => {
  await act(async () => root.render(<App key="custom" initial="Noto Sans KR" />));
  expect(input().value).toBe('Noto Sans KR');
  expect(preview().style.fontFamily).toBe(fontFamilyStack('Noto Sans KR'));
  expect(save).not.toHaveBeenCalled();
});
