// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LeaderKeyRecorder } from '../components/LeaderKeyRecorder';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import { useSettingsNavigation } from './settingsNavigation';
import type { Settings } from './types';

const settings: Settings = {
  leader: ' ',
  keybindings: {},
  vim: false,
  slash: false,
  showUnresolvedLinks: false,
  theme: 'paper',
  editorMode: 'live',
  lineNumbers: 'none',
  editorFontFamily: '',
  databaseFontFamily: '',
  databaseFontSize: 14,
  topicFolders: { include: [], exclude: [] },
  cursorShape: 'bar',
  cursorFollowVim: true,
  cursorBlink: 'steady',
  cursorBlinkRate: 600,
  cursorAnimation: 'none',
};

function Harness({ view = 'notes', sourcePresent = true }: { view?: string; sourcePresent?: boolean }) {
  const navigation = useSettingsNavigation('/vault');
  const [dialog, setDialog] = useState(false);
  return (
    <div onKeyDown={navigation.onKeyDown}>
      <output>{navigation.opened ? 'settings' : view}</output>
      <main
        hidden={navigation.opened}
        data-focus-region={navigation.opened ? undefined : 'main'}
        tabIndex={-1}
      >
        {sourcePresent && (
          <button data-origin onClick={() => navigation.open()}>
            Open settings
          </button>
        )}
      </main>
      {navigation.opened && (
        <section>
          <button className="active" data-settings-group="editor">
            Editor settings
          </button>
          <Select value="one" onValueChange={() => {}} aria-label="Setting choice">
            <option value="one">One</option>
            <option value="two">Two</option>
          </Select>
          <LeaderKeyRecorder settings={settings} commands={[]} update={async () => true} />
          <button data-open-dialog onClick={() => setDialog(true)}>
            Open dialog
          </button>
          <input data-setting-field aria-label="Setting field" />
          <input
            data-consumed-field
            aria-label="Inner Escape handler"
            onKeyDown={(event) => {
              if (event.key === 'Escape') event.preventDefault();
            }}
          />
          {dialog && (
            <Modal title="Inner dialog" close={() => setDialog(false)}>
              <input aria-label="Dialog field" />
            </Modal>
          )}
        </section>
      )}
    </div>
  );
}

let host: HTMLDivElement;
let root: Root;
const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  if (originalScroll) Object.defineProperty(Element.prototype, 'scrollIntoView', originalScroll);
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

async function openSettings(view = 'notes') {
  await act(async () => root.render(<Harness view={view} />));
  const origin = host.querySelector<HTMLButtonElement>('[data-origin]')!;
  await act(async () => {
    origin.focus();
    origin.click();
  });
  await act(async () => vi.advanceTimersByTime(20));
  expect(host.querySelector('output')?.textContent).toBe('settings');
  expect(document.activeElement).toBe(host.querySelector('[data-settings-group]'));
  return origin;
}

async function escape(target: Element = document.activeElement!, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...options });
  await act(async () => void target.dispatchEvent(event));
  await act(async () => vi.advanceTimersByTime(20));
  return event;
}

test.each(['notes', 'database', 'plugin'])(
  'Escape returns to the previous %s view and focused control',
  async (view) => {
    const origin = await openSettings(view);
    expect((await escape()).defaultPrevented).toBe(true);
    expect(host.querySelector('output')?.textContent).toBe(view);
    expect(document.activeElement).toBe(origin);
  },
);

test('the first Escape closes an inner dropdown and the next leaves settings', async () => {
  await openSettings();
  const select = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  await act(async () => {
    select.focus();
    select.click();
  });
  expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  await escape(select);
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  expect(host.querySelector('output')?.textContent).toBe('settings');
  await escape(select);
  expect(host.querySelector('output')?.textContent).toBe('notes');
});

test('the first Escape closes an inner modal and preserves settings until the next Escape', async () => {
  await openSettings();
  const button = host.querySelector<HTMLButtonElement>('[data-open-dialog]')!;
  await act(async () => {
    button.focus();
    button.click();
  });
  await act(async () => vi.advanceTimersByTime(20));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  await escape();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector('output')?.textContent).toBe('settings');
  expect(document.activeElement).toBe(button);
  await escape();
  expect(host.querySelector('output')?.textContent).toBe('notes');
});

test('Escape cancels key recording before it closes settings', async () => {
  await openSettings();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-key-recorder] button')!.click());
  const recording = host.querySelector<HTMLInputElement>('input[aria-label="Leader 키 기록"]')!;
  expect(recording).not.toBeNull();
  await escape(recording);
  expect(host.querySelector('input[aria-label="Leader 키 기록"]')).toBeNull();
  expect(host.querySelector('output')?.textContent).toBe('settings');
  await escape();
  expect(host.querySelector('output')?.textContent).toBe('notes');
});

test('composition and an inner handler that prevented Escape keep settings open', async () => {
  await openSettings();
  const field = host.querySelector<HTMLInputElement>('[data-setting-field]')!;
  field.focus();
  expect((await escape(field, { isComposing: true })).defaultPrevented).toBe(false);
  expect(host.querySelector('output')?.textContent).toBe('settings');
  expect((await escape(field, { keyCode: 229 })).defaultPrevented).toBe(false);
  expect(host.querySelector('output')?.textContent).toBe('settings');
  await escape(host.querySelector('[data-consumed-field]')!);
  expect(host.querySelector('output')?.textContent).toBe('settings');
  await escape(field);
  expect(host.querySelector('output')?.textContent).toBe('notes');
});

test('Escape restores focus to the work region when the original control was removed', async () => {
  await openSettings('database');
  await act(async () => root.render(<Harness view="database" sourcePresent={false} />));
  await escape();
  expect(host.querySelector('output')?.textContent).toBe('database');
  expect(document.activeElement).toBe(host.querySelector('[data-focus-region="main"]'));
});
