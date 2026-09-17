// @vitest-environment jsdom
import { act, useEffect, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { parseFrontmatter } from '../lib/frontmatter';
import { FrontmatterPanel } from './FrontmatterPanel';

type Props = ComponentProps<typeof FrontmatterPanel>;
let host: HTMLDivElement;
let root: Root;
let props: Props;
function Harness({ settings }: { settings: Props }) {
  const [source, setSource] = useState(settings.source);
  useEffect(() => setSource(settings.source), [settings.source]);
  return (
    <FrontmatterPanel
      {...settings}
      source={source}
      onChange={
        settings.onChange
          ? (value) => {
              settings.onChange!(value);
              setSource(value);
            }
          : undefined
      }
    />
  );
}
async function render(next = props) {
  props = next;
  await act(async () => root.render(<Harness settings={props} />));
}
function field(label: string) {
  return host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
}
function button(label: string) {
  return [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.getAttribute('aria-label') === label || item.textContent?.trim() === label,
  )!;
}
async function input(label: string, value: string) {
  await act(async () => {
    const target = field(label);
    target.focus();
    const prototype =
      target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(label: string, value: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra });
  await act(async () => field(label).dispatchEvent(event));
  return event;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function add(name: string, value: string) {
  await click('속성 추가');
  await input('새 속성 이름', name);
  await input('새 속성 값', value);
  await click('속성 추가 확인');
}
function latest() {
  return vi.mocked(props.onChange!).mock.calls.at(-1)![0];
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  props = {
    source: 'title: Hello\ncount: 2\npublished: false\ntags: [alpha, beta]\n',
    onChange: vi.fn(),
    onEditSource: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

test('renders scalar and list values without changing their YAML types or original source', async () => {
  await render({ ...props, source: 'text: "false"\ncount: 2\nready: false\ntags: [alpha, beta]\n' });
  expect(field('text 값').value).toBe('"false"');
  expect(field('count 값').value).toBe('2');
  expect(field('ready 값').value).toBe('false');
  expect(field('tags 값').value).toContain('alpha');
  expect(props.onChange).not.toHaveBeenCalled();
});

test('typing keeps local field state and blur commits once without replacing the input', async () => {
  await render();
  const original = field('count 값');
  await input('count 값', '7');
  expect(props.onChange).not.toHaveBeenCalled();
  expect(field('count 값')).toBe(original);
  await act(async () => original.blur());
  expect(props.onChange).toHaveBeenCalledTimes(1);
  expect(parseFrontmatter(latest()).toJS()).toEqual({
    title: 'Hello',
    count: 7,
    published: false,
    tags: ['alpha', 'beta'],
  });
  expect(field('count 값')).toBe(original);
});

test('Enter commits typed values once and preserves comments and other fields', async () => {
  await render({ ...props, source: '# note comment\ncount: 2 # count comment\nlabel: "001"\n' });
  await input('count 값', '9');
  expect((await key('count 값', 'Enter')).defaultPrevented).toBe(true);
  expect(props.onChange).toHaveBeenCalledTimes(1);
  expect(latest()).toContain('# note comment');
  expect(latest()).toContain('# count comment');
  expect(parseFrontmatter(latest()).toJS()).toEqual({ count: 9, label: '001' });
});

test('Escape cancels an edited value and its pending blur never commits the discarded draft', async () => {
  await render();
  await input('title 값', 'Discard me');
  await key('title 값', 'Escape');
  expect(field('title 값').value).toBe('Hello');
  expect(props.onChange).not.toHaveBeenCalled();
});

test('IME Enter and Shift+Enter do not commit a property', async () => {
  await render();
  await input('title 값', '한글');
  expect((await key('title 값', 'Enter', { isComposing: true })).defaultPrevented).toBe(false);
  expect((await key('title 값', 'Enter', { keyCode: 229 })).defaultPrevented).toBe(false);
  expect((await key('title 값', 'Enter', { shiftKey: true })).defaultPrevented).toBe(false);
  expect(props.onChange).not.toHaveBeenCalled();
  await key('title 값', 'Enter');
  expect(parseFrontmatter(latest()).get('title')).toBe('한글');
});

test('invalid value stays editable with an error and does not overwrite source', async () => {
  await render();
  await input('tags 값', '[unfinished');
  await key('tags 값', 'Enter');
  expect(props.onChange).not.toHaveBeenCalled();
  expect(field('tags 값').value).toBe('[unfinished');
  expect(field('tags 값').getAttribute('aria-invalid')).toBe('true');
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await key('tags 값', 'Escape');
  expect(field('tags 값').value).toContain('beta');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

test('external source changes synchronize existing fields and remove outdated errors', async () => {
  await render();
  await input('count 값', '[bad');
  await key('count 값', 'Enter');
  await render({ ...props, source: 'count: 42\ncreated: true\n' });
  expect(field('count 값').value).toBe('42');
  expect(field('created 값').value).toBe('true');
  expect(field('title 값')).toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(props.onChange).not.toHaveBeenCalled();
});

test('adds typed values and deletes only the selected property', async () => {
  await render();
  await add('rating', '4.5');
  expect(parseFrontmatter(latest()).get('rating')).toBe(4.5);
  expect(field('rating 값').value).toBe('4.5');
  expect(field('새 속성 이름')).toBeNull();
  await click('published 속성 삭제');
  expect(parseFrontmatter(latest()).has('published')).toBe(false);
  expect(parseFrontmatter(latest()).get('count')).toBe(2);
});

test('duplicate names and invalid added values preserve the draft and source', async () => {
  await render();
  await add('count', '3');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('같은 이름');
  expect(field('새 속성 이름').value).toBe('count');
  expect(field('새 속성 값').value).toBe('3');
  expect(props.onChange).not.toHaveBeenCalled();
  await input('새 속성 이름', 'fresh');
  await input('새 속성 값', '[bad');
  await click('속성 추가 확인');
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(field('새 속성 값').value).toBe('[bad');
  expect(props.onChange).not.toHaveBeenCalled();
  await key('새 속성 값', 'Escape');
  expect(field('새 속성 이름')).toBeNull();
});

test('property add ignores submit during IME composition', async () => {
  await render();
  await click('속성 추가');
  await input('새 속성 이름', 'language');
  await input('새 속성 값', '한글');
  await act(async () => {
    field('새 속성 값').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(props.onChange).not.toHaveBeenCalled();
  await act(async () =>
    field('새 속성 값').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })),
  );
  await click('속성 추가 확인');
  expect(parseFrontmatter(latest()).get('language')).toBe('한글');
});

test('invalid source remains visible verbatim and can be opened as YAML without resetting it', async () => {
  const source = 'count: [broken\n<img src=x onerror=alert(1)>\n';
  await render({ ...props, source });
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('.frontmatter-raw')?.textContent).toBe(source);
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('textarea')).toBeNull();
  expect(button('속성 추가')).toBeUndefined();
  await click('YAML 원문 편집');
  expect(props.onEditSource).toHaveBeenCalledOnce();
  expect(props.onChange).not.toHaveBeenCalled();
});

test('read-only properties stay selectable text without editing controls or unsafe HTML', async () => {
  await render({ source: 'title: "<img src=x onerror=alert(1)>"\ncount: 2\n' });
  expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('textarea, input, button')).toBeNull();
  const details = host.querySelector('details')!;
  expect(details.open).toBe(true);
  await act(async () => {
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
  });
  expect(details.open).toBe(false);
});
