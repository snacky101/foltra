// @vitest-environment jsdom
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { vim, getCM } from '@replit/codemirror-vim';
import { afterEach, expect, test, vi } from 'vitest';
import { imagePasteExtension } from './imagePaste';
import type { Attachment } from './attachments';

const image: Attachment = {
  path: `attachments/${'a'.repeat(64)}.png`,
  mimeType: 'image/png',
  width: 8,
  height: 4,
  size: 80,
};
const link = `![이미지](../${image.path})`;
let view: EditorView;
const error = vi.fn();
function setup(importImage: (vault: string, file: File) => Promise<Attachment>, vimMode = false) {
  error.mockClear();
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: 'before after',
      selection: { anchor: 7 },
      extensions: [
        vimMode ? vim() : [],
        history(),
        imagePasteExtension(() => ({ vault: '/vault', onError: error }), importImage),
      ],
    }),
  });
  view.focus();
}
function paste(type = 'image/png') {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: [{ kind: 'file', type, getAsFile: () => new File(['image'], 'clipboard.png', { type }) }],
      getData: () => '',
    },
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
afterEach(() => {
  view?.destroy();
  document.body.replaceChildren();
});

test.each([false, true])(
  'clipboard image inserts saved relative link with one undo, Vim Normal %s',
  async (mode) => {
    const save = vi.fn().mockResolvedValue(image);
    setup(save, mode);
    expect(paste().defaultPrevented).toBe(true);
    await flush();
    expect(save).toHaveBeenCalledWith('/vault', expect.any(File));
    expect(view.state.doc.toString()).toBe('before ' + link + 'after');
    if (mode) expect(getCM(view)?.state.vim?.insertMode).toBe(false);
    undo(view);
    expect(view.state.doc.toString()).toBe('before after');
  },
);

test('in-flight paste follows edits before its position without stealing moved selection', async () => {
  let resolve!: (value: Attachment) => void;
  setup(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  paste();
  await flush();
  view.dispatch({ changes: { from: 0, insert: 'new ' }, selection: { anchor: 0 } });
  resolve(image);
  await flush();
  expect(view.state.doc.toString()).toBe('new before ' + link + 'after');
  expect(view.state.selection.main.head).toBe(0);
});

test.each(['destroy', 'replace', 'undo'] as const)('late paste cannot write after %s', async (action) => {
  let resolve!: (value: Attachment) => void;
  setup(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  paste();
  await flush();
  if (action === 'destroy') view.destroy();
  else
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'changed' },
      annotations: action === 'replace' ? Transaction.addToHistory.of(false) : undefined,
      userEvent: action === 'undo' ? 'undo' : undefined,
    });
  const body = view.state.doc.toString();
  resolve(image);
  await flush();
  expect(view.state.doc.toString()).toBe(body);
});

test('failed imports preserve selected text and report the error', async () => {
  const failure = new Error('disk full');
  setup(async () => {
    throw failure;
  });
  view.dispatch({ selection: { anchor: 0, head: 6 } });
  paste();
  await flush();
  expect(view.state.doc.toString()).toBe('before after');
  expect(error).toHaveBeenCalledWith(failure);
});

test('consecutive pastes retain clipboard order despite asynchronous imports', async () => {
  let resolve!: (value: Attachment) => void;
  const second = { ...image, path: image.path.replace(/a/g, 'b') };
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce(second);
  setup(save);
  paste();
  paste();
  await flush();
  expect(save).toHaveBeenCalledTimes(1);
  resolve(image);
  await flush();
  expect(view.state.doc.toString()).toBe('before ' + link + `![이미지](../${second.path})` + 'after');
});

test('ordinary text paste is left to the editor', () => {
  const save = vi.fn();
  setup(save);
  paste('text/plain');
  expect(save).not.toHaveBeenCalled();
});

test('an image finishing during Korean composition waits until the committed text is flushed', async () => {
  let resolve!: (value: Attachment) => void;
  setup(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  paste();
  await flush();
  view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  view.dispatch({ changes: { from: 7, insert: '한글' }, selection: { anchor: 9 } });
  resolve(image);
  await flush();
  expect(view.state.doc.toString()).toBe('before 한글after');
  view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '한글' }));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(view.state.doc.toString()).toBe('before 한글' + link + 'after');
});
