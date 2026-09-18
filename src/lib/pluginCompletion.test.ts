// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import {
  CompletionContext,
  acceptCompletion,
  closeCompletion,
  completionStatus,
  currentCompletions,
  startCompletion,
} from '@codemirror/autocomplete';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pluginCompletions } from './pluginCompletion';
import { noteCompletionExtension } from './noteCompletion';
import type { Workspace } from './types';
import type { PluginCompletionItem } from './pluginTypes';

let workspace: Workspace;
let view: EditorView | undefined;
const items = [
  { label: 'Today', insertText: '2026-09-18' },
  { label: 'Tomorrow', insertText: '2026-09-19' },
  { label: 'Yesterday', insertText: '2026-09-17' },
];
const invoke = vi.fn(async (_plugin: string, _id: string, query: string) =>
  items.filter((item) => item.label.toLowerCase().startsWith(query.toLowerCase())),
);
const rects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
beforeEach(() => {
  workspace = {
    path: '/disposable/completion',
    notes: [],
    extensions: [
      {
        id: 'dates',
        runtime: { permissions: ['editor.write'], completions: [{ id: 'dates', trigger: '@' }] },
      },
    ],
    pluginStates: [{ id: 'dates', enabled: true, digest: 'v1' }],
  } as unknown as Workspace;
  invoke.mockClear();
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
});
afterEach(() => {
  view?.destroy();
  view = undefined;
  document.body.replaceChildren();
  if (rects) Object.defineProperty(Range.prototype, 'getClientRects', rects);
  else delete (Range.prototype as Partial<Range>).getClientRects;
  if (rect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rect);
  else delete (Range.prototype as Partial<Range>).getBoundingClientRect;
});
function context(doc: string, pos = doc.length) {
  return new CompletionContext(
    EditorState.create({ doc, selection: { anchor: pos }, extensions: [markdown()] }),
    pos,
    false,
  );
}
function editor(doc: string) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [
        markdown(),
        history(),
        noteCompletionExtension(
          () => workspace,
          () => {},
          () => invoke,
        ),
        keymap.of(defaultKeymap),
      ],
    }),
  });
  view.focus();
  return view;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 160));

test('typing @ opens providers and subsequent text refilters without modifying the draft', async () => {
  const editorView = editor('계획 @');
  startCompletion(editorView);
  await vi.waitFor(() => expect(currentCompletions(editorView.state)).toHaveLength(3));
  editorView.dispatch({
    changes: { from: 4, insert: 'ToD' },
    selection: { anchor: 7 },
    userEvent: 'input.type',
  });
  await vi.waitFor(() =>
    expect(currentCompletions(editorView.state).map((item) => item.label)).toEqual(['Today']),
  );
  expect(editorView.state.doc.toString()).toBe('계획 @ToD');
  await settle();
  expect(acceptCompletion(editorView)).toBe(true);
  expect(editorView.state.doc.toString()).toBe('계획 2026-09-18');
  expect(editorView.state.selection.main.head).toBe(13);
  undo(editorView);
  expect(editorView.state.doc.toString()).toBe('계획 @ToD');
});

test('a delayed old query cannot replace candidates returned for the current query', async () => {
  let finishOld!: (items: PluginCompletionItem[]) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  const editorView = editor('@To');
  startCompletion(editorView);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('dates', 'dates', 'To'));
  editorView.dispatch({
    changes: { from: 3, insert: 'm' },
    selection: { anchor: 4 },
    userEvent: 'input.type',
  });
  await vi.waitFor(() =>
    expect(currentCompletions(editorView.state).map((item) => item.label)).toEqual(['Tomorrow']),
  );
  finishOld([items[0]]);
  await settle();
  expect(currentCompletions(editorView.state).map((item) => item.label)).toEqual(['Tomorrow']);
  expect(editorView.state.doc.toString()).toBe('@Tom');
  expect(acceptCompletion(editorView)).toBe(true);
  expect(editorView.state.doc.toString()).toBe('2026-09-19');
});

test('a previously displayed candidate cannot apply after its query changes, even with mapped bounds', async () => {
  const editorView = editor('@To');
  const result = await pluginCompletions(context('@To'), () => workspace, invoke);
  const option = result!.options.find((item) => item.label === 'Today')!;
  editorView.dispatch({
    changes: { from: 3, insert: 'm' },
    selection: { anchor: 4 },
    userEvent: 'input.type',
  });
  if (typeof option.apply !== 'function') throw new Error('Expected an explicit apply function');
  option.apply(editorView, option, 0, 4);
  expect(editorView.state.doc.toString()).toBe('@Tom');
});

test.each(['escape', 'blur', 'space'] as const)(
  'leaving a completion by %s preserves literal @text',
  async (action) => {
    const editorView = editor('@Today');
    startCompletion(editorView);
    await vi.waitFor(() => expect(completionStatus(editorView.state)).toBe('active'));
    await settle();
    if (action === 'escape')
      editorView.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    else if (action === 'blur') editorView.contentDOM.blur();
    else
      editorView.dispatch({
        changes: { from: 6, insert: ' ' },
        selection: { anchor: 7 },
        userEvent: 'input.type',
      });
    await settle();
    expect(editorView.state.doc.toString()).toBe(`@Today${action === 'space' ? ' ' : ''}`);
  },
);

test('explicit selection consumes a token suffix and preserves surrounding punctuation', async () => {
  const editorView = editor('(@Tomorrow), 이후');
  editorView.dispatch({ selection: { anchor: 4 } });
  const result = await pluginCompletions(
    new CompletionContext(editorView.state, 4, false),
    () => workspace,
    invoke,
  );
  const option = result!.options.find((item) => item.label === 'Tomorrow')!;
  if (typeof option.apply !== 'function') throw new Error('Expected an explicit apply function');
  option.apply(editorView, option, result!.from, 4);
  expect(editorView.state.doc.toString()).toBe('(2026-09-19), 이후');
});

test('emails, code, links, escapes and unselected text do not trigger replacement', async () => {
  for (const doc of [
    'name@Today',
    '\\@Today',
    '`@Today`',
    '```md\n@Today',
    '    @Today',
    '[[@Today',
    '[[@Today|alias',
    '[text](https://x/@Today)',
    '<!-- @Today',
  ]) {
    const pos = doc.includes('`@') ? doc.length - 1 : doc.length;
    expect(await pluginCompletions(context(doc, pos), () => workspace, invoke), doc).toBeNull();
  }
  expect(invoke).not.toHaveBeenCalled();
  expect((await pluginCompletions(context('@unknown'), () => workspace, invoke))?.options).toEqual([]);
});

test.each(['disable', 'vault', 'digest'] as const)(
  'late candidates and previously displayed options cannot edit after %s',
  async (change) => {
    const editorView = editor('@To');
    const result = await pluginCompletions(context('@To'), () => workspace, invoke);
    let finish!: (items: PluginCompletionItem[]) => void;
    const pending = pluginCompletions(
      context('@To'),
      () => workspace,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    if (change === 'disable') workspace.pluginStates![0].enabled = false;
    if (change === 'vault') workspace = { ...workspace, path: '/another' };
    if (change === 'digest') workspace.pluginStates![0].digest = 'v2';
    finish(items);
    expect((await pending)?.options).toEqual([]);
    const option = result!.options[0];
    if (typeof option.apply !== 'function') throw new Error('Expected an explicit apply function');
    option.apply(editorView, option, 0, 3);
    expect(editorView.state.doc.toString()).toBe('@To');
  },
);

test('Enter during composition does not accept an option', async () => {
  const editorView = editor('@To');
  startCompletion(editorView);
  await vi.waitFor(() => expect(completionStatus(editorView.state)).toBe('active'));
  editorView.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  const enter = editorView.state
    .facet(keymap)
    .flat()
    .find((binding) => binding.key === 'Enter')!;
  expect(enter.run!(editorView)).toBe(false);
  expect(editorView.state.doc.toString()).toBe('@To');
  editorView.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  closeCompletion(editorView);
});
