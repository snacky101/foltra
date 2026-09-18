// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NotePane } from './NotePane';
import { useNote } from '../lib/useNote';
import { call } from '../lib/api';
import type { Note, Workspace } from '../lib/types';

vi.mock('../lib/api', async (original) => ({ ...(await original<object>()), call: vi.fn() }));
vi.mock('./Editor', () => ({ Editor: () => null }));
const original: Note = {
  id: 'one',
  title: 'Title',
  body: 'Keep body',
  revision: 'r1',
  createdAt: '',
  updatedAt: '',
};
const workspace = {
  vault: { id: 'vault' },
  notes: [original],
  links: [],
  settings: {},
} as unknown as Workspace;
const props: Omit<ComponentProps<typeof NotePane>, 'note'> = {
  workspace,
  noteId: 'one',
  preview: false,
  backlinks: false,
  editor: { current: null },
  dispatch: () => {},
  commands: [],
  openNote: async () => {},
  openLink: () => {},
  setNoteId: () => {},
  setMode: () => {},
  setDialog: () => {},
  onError: () => {},
  onEditorReady: () => {},
  commandLineHost: { current: null },
  onNoteCommand: async () => {},
};
let root: Root, host: HTMLDivElement, input: HTMLInputElement, stored: Note;
let note: ReturnType<typeof useNote>;
function Harness() {
  note = useNote('/disposable', original.id, original.revision, async () => {});
  return <NotePane {...props} note={note} />;
}
beforeEach(async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  stored = { ...original };
  vi.mocked(call)
    .mockReset()
    .mockImplementation(async (_vault, command, args) => {
      if (command === 'note.read') return stored;
      if (command === 'note.update') {
        const update = args as { title: string; expectedRevision: string };
        expect(update.expectedRevision).toBe(stored.revision);
        stored = { ...stored, ...args, title: update.title.trim(), revision: `${stored.revision}+` };
        return stored;
      }
      throw new Error(command);
    });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  input = host.querySelector<HTMLInputElement>('[aria-label="노트 제목"]')!;
  await act(async () => input.focus());
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const tick = () => act(async () => vi.advanceTimersByTimeAsync(650));
const compose = (type: 'compositionstart' | 'compositionend') =>
  act(async () => input.dispatchEvent(new CompositionEvent(type, { bubbles: true })));
async function enter(options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options });
  await act(async () => input.dispatchEvent(event));
  return event;
}

test('an autosave pause keeps the title space and caret for the next word', async () => {
  await type('한글 ');
  await tick();
  expect(input.value).toBe('한글 ');
  expect(input.selectionStart).toBe(3);
  expect(document.activeElement).toBe(input);
  await type(`${input.value}English`);
  await tick();
  expect(stored.title).toBe('한글 English');
  expect(stored.body).toBe(original.body);
});

test.each(['blur', 'Enter'])(
  'finishing title editing with %s trims only outer whitespace',
  async (finish) => {
    await type(' 한글  English ');
    if (finish === 'blur') await act(async () => input.blur());
    else expect((await enter()).defaultPrevented).toBe(true);
    expect(input.value).toBe('한글  English');
    expect(document.activeElement).not.toBe(input);
    expect(stored.title).toBe('한글  English');
  },
);

test('blur flushes the normalized title after an autosave already in flight', async () => {
  let finish!: (value: Note) => void;
  vi.mocked(call).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  await type(' 한글 English ');
  await tick();
  expect(note.status).toBe('saving');
  await act(async () => input.blur());
  expect(input.value).toBe('한글 English');
  await act(async () => {
    stored = { ...original, title: '한글 English', revision: 'r2' };
    finish(stored);
  });
  expect(
    vi
      .mocked(call)
      .mock.calls.filter(([, command]) => command === 'note.update')
      .at(-1)?.[2],
  ).toMatchObject({
    title: '한글 English',
    expectedRevision: 'r2',
  });
  expect(note.status).toBe('saved');
  expect(note.isDirty()).toBe(false);
  expect(stored.body).toBe(original.body);
});

test('composition Enter does not finish editing and composition end keeps the trailing space', async () => {
  await compose('compositionstart');
  await type('한글 ');
  await enter({ isComposing: true });
  expect(document.activeElement).toBe(input);
  await enter({ keyCode: 229 });
  expect(document.activeElement).toBe(input);
  await compose('compositionend');
  await tick();
  expect(input.value).toBe('한글 ');
  await enter({ keyCode: 229 });
  expect(document.activeElement).toBe(input);
  await enter();
  expect(input.value).toBe('한글');
  expect(document.activeElement).not.toBe(input);
});

test('blur during composition waits for the committed value and trims a late final input', async () => {
  await compose('compositionstart');
  await type('  한ㄱ ');
  await act(async () => input.blur());
  expect(note.draft.title).toBe('  한ㄱ ');
  await type('  한글 ');
  await compose('compositionend');
  expect(input.value).toBe('한글');
  expect(stored.title).toBe('한글');
  await type('  한글 ');
  expect(input.value).toBe('한글');
  expect(stored.title).toBe('한글');
  expect(stored.body).toBe(original.body);
});
