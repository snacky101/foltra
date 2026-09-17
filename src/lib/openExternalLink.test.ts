// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { externalLinkUrl, openExternalLink } from './openExternalLink';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(openUrl).mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

test('native links use the OS opener, preserving fragments, parentheses and encoding', async () => {
  const url = 'https://example.com/한 글_(test)?q=1#part';
  expect(await openExternalLink(url)).toBe(true);
  expect(openUrl).toHaveBeenCalledExactlyOnceWith(new URL(url).href);
  expect(window.open).not.toHaveBeenCalled();
});

test.each(['http://localhost:1420/a', 'mailto:hello@example.com?subject=Hello'])(
  'supports the permitted destination %s',
  async (url) => {
    expect(await openExternalLink(url)).toBe(true);
    expect(openUrl).toHaveBeenCalledExactlyOnceWith(url);
  },
);

test.each([
  'javascript:alert(1)',
  'data:text/html,test',
  'file:///tmp/test',
  'foltra:custom',
  '//example.com',
  '../note.md',
  'https:\n//example.com',
  ' https://example.com',
  'mailto:',
  '',
])('does not open unsafe or unsupported destination %j', async (url) => {
  expect(externalLinkUrl(url)).toBeNull();
  expect(await openExternalLink(url)).toBe(false);
  expect(openUrl).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
});

test('web development opens a separate tab without an opener reference', async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  expect(await openExternalLink('https://example.com')).toBe(true);
  expect(window.open).toHaveBeenCalledExactlyOnceWith(
    'https://example.com/',
    '_blank',
    'noopener,noreferrer',
  );
  expect(openUrl).not.toHaveBeenCalled();
});

test('native launch failures propagate to the caller instead of trying a webview popup', async () => {
  vi.mocked(openUrl).mockRejectedValueOnce(new Error('Cannot launch browser'));
  await expect(openExternalLink('https://example.com')).rejects.toThrow('Cannot launch browser');
  expect(window.open).not.toHaveBeenCalled();
});
