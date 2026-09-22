// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useMouseNavigation } from './useMouseNavigation';

let host: HTMLDivElement, root: Root;
const dispatch = vi.fn();
function Harness({ blocked = false, run = dispatch }: { blocked?: boolean; run?: (id: string) => void }) {
  useMouseNavigation(run, blocked);
  return <textarea aria-label="Note" />;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
function click(button: number, target: Element = host.querySelector('textarea')!) {
  return ['mousedown', 'mouseup', 'auxclick'].map((type) => {
    const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  });
}

test.each([
  [3, 'note.back'],
  [4, 'note.forward'],
] as const)('mouse button %i uses %s once and consumes native browser navigation', (button, command) => {
  const input = host.querySelector('textarea')!;
  input.value = '한글 draft';
  input.focus();
  expect(click(button).every((event) => event.defaultPrevented)).toBe(true);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(command);
  expect(input.value).toBe('한글 draft');
});
test.each([0, 1, 2])('ordinary mouse button %i keeps its normal behavior', (button) => {
  expect(click(button).every((event) => !event.defaultPrevented)).toBe(true);
  expect(dispatch).not.toHaveBeenCalled();
});
test('dialogs block app and browser navigation, and rerenders use the latest dispatcher', async () => {
  await act(async () => root.render(<Harness blocked />));
  expect(click(3).every((event) => event.defaultPrevented)).toBe(true);
  expect(click(4).every((event) => event.defaultPrevented)).toBe(true);
  expect(dispatch).not.toHaveBeenCalled();
  const latest = vi.fn();
  await act(async () => root.render(<Harness run={latest} />));
  click(4);
  expect(latest).toHaveBeenCalledExactlyOnceWith('note.forward');
});
test.each(['data-inline-rename', 'data-key-recorder', 'dialog', 'menu'])(
  'mouse navigation leaves an active %s control alone',
  (kind) => {
    const input = host.querySelector('textarea')!;
    if (kind.startsWith('data-')) input.setAttribute(kind, '');
    else input.setAttribute('role', kind);
    input.focus();
    expect(click(3, document.body).every((event) => event.defaultPrevented)).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  },
);
test('unmount removes the mouse listeners', async () => {
  await act(async () => root.render(null));
  expect(click(3, document.body).every((event) => !event.defaultPrevented)).toBe(true);
  expect(dispatch).not.toHaveBeenCalled();
});
