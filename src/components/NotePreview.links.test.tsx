// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openExternalLink } from '../lib/openExternalLink';
import type { Workspace } from '../lib/types';
import { NotePreview } from './NotePreview';

vi.mock('../lib/openExternalLink', async (original) => ({
  ...(await original<typeof import('../lib/openExternalLink')>()),
  openExternalLink: vi.fn(),
}));
const workspace = { notes: [], records: [], settings: { showUnresolvedLinks: true } } as unknown as Workspace;
let host: HTMLDivElement;
let root: Root;
const openLink = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(openExternalLink).mockReset().mockResolvedValue(true);
  openLink.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(body: string) {
  await act(async () => {
    root.render(<NotePreview body={body} workspace={workspace} openNote={() => {}} openLink={openLink} />);
  });
}
async function click(selector: string) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  await act(async () => {
    host.querySelector(selector)!.dispatchEvent(event);
  });
  return event;
}

test('reading links use the shared OS opener once and prevent webview navigation', async () => {
  await render('[Docs](https://example.com/a_(b)?q=1#part "Title")');
  const event = await click('a');
  expect(event.defaultPrevented).toBe(true);
  expect(openExternalLink).toHaveBeenCalledExactlyOnceWith('https://example.com/a_(b)?q=1#part');
  expect(openLink).not.toHaveBeenCalled();
});

test('reading surfaces native launch failures and clears the error on retry', async () => {
  vi.mocked(openExternalLink).mockRejectedValueOnce(new Error('Cannot launch browser'));
  await render('[Docs](https://example.com)');
  await click('a');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Cannot launch browser');
  await click('a');
  expect(host.querySelector('[role=alert]')).toBeNull();
});

test('reading preserves wiki navigation and keeps unsupported destinations inert', async () => {
  await render('[[New note|Alias]] [Unsafe](javascript:alert%281%29) [Local](file:///tmp/a)');
  await click('.wiki-link');
  expect(openLink).toHaveBeenCalledExactlyOnceWith('New note');
  expect(openExternalLink).not.toHaveBeenCalled();
  expect(host.querySelector('a')).toBeNull();
  expect(host.textContent).toContain('Unsafe');
  expect(host.textContent).toContain('Local');
});
