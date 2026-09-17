// @vitest-environment jsdom
import { act } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { syntaxTree } from '@codemirror/language';
import { GFM } from '@lezer/markdown';
import { getCM, vim } from '@replit/codemirror-vim';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { livePreviewDecorations, livePreviewExtension } from './livePreview';
import { frontmatterPanelState } from './livePreviewFrontmatter';
import type { Workspace } from './types';

const context = {
  workspace: { notes: [], records: [], databases: [], links: [], extensions: [] } as unknown as Workspace,
  openNote() {},
  openLink() {},
};
let view: EditorView | undefined;
const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const originalRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(async () => {
  await act(async () => view?.destroy());
  view = undefined;
  document.body.replaceChildren();
  if (originalRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRects);
  else delete (Range.prototype as Partial<Range>).getClientRects;
  if (originalRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRect);
  else delete (Range.prototype as Partial<Range>).getBoundingClientRect;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function state(doc: string, anchor = 0) {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [yamlFrontmatter({ content: markdown({ extensions: [GFM] }) })],
  });
}
function rules(s: EditorState) {
  const result: { from: number; to: number }[] = [];
  syntaxTree(s).iterate({
    enter(node) {
      if (node.name === 'HorizontalRule') result.push({ from: node.from, to: node.to });
    },
  });
  return result;
}
function decorations(s: EditorState) {
  const result: { from: number; to: number; className: string; block: boolean }[] = [];
  livePreviewDecorations(s, context).between(0, s.doc.length, (from, to, decoration) => {
    result.push({ from, to, className: decoration.spec.class ?? '', block: !!decoration.spec.block });
  });
  return result;
}
async function editor(doc: string, vimEnabled = false) {
  await act(async () => {
    view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [
          yamlFrontmatter({ content: markdown({ extensions: [GFM] }) }),
          history(),
          vimEnabled ? vim() : [],
          keymap.of(defaultKeymap),
          frontmatterPanelState,
          livePreviewExtension(() => context, true),
        ],
      }),
    });
    view.focus();
  });
  return view!;
}

async function press(editorView: EditorView, key: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  await act(async () => editorView.contentDOM.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
}

test('all thematic break spellings preserve a real editor line rather than a block replacement', () => {
  for (const marker of ['---', '***', '___', '- - -', '* * *', '_ _ _']) {
    const s = state(`# Before\n${marker}\nAfter`);
    const rule = rules(s)[0];
    expect(rule, marker).toBeDefined();
    const decos = decorations(s);
    expect(
      decos.some((d) => d.block && d.from <= rule.from && d.to >= rule.to),
      marker,
    ).toBe(false);
    expect(
      decos.some(
        (d) => d.from === s.doc.lineAt(rule.from).from && d.className.includes('cm-live-rule-preview'),
      ),
      marker,
    ).toBe(true);
    expect(s.doc.toString()).toBe(`# Before\n${marker}\nAfter`);
  }
});

test('a rule exposes every source position while active and renders again after the caret leaves', () => {
  const original = state('# Before\n---\nAfter');
  const rule = rules(original)[0];
  for (const anchor of [rule.from, rule.from + 1, rule.to]) {
    const active = original.update({ selection: { anchor } }).state;
    expect(decorations(active).some((d) => d.className.includes('cm-live-rule-preview'))).toBe(false);
    expect(decorations(active).some((d) => d.className === 'cm-live-rule-source')).toBe(false);
  }
  const inactive = original.update({ selection: { anchor: original.doc.length } }).state;
  expect(decorations(inactive).some((d) => d.className === 'cm-live-rule-source')).toBe(true);
  expect(inactive.doc.toString()).toBe(original.doc.toString());
});

test('blockquote and list rules retain their container prefixes without hiding the whole line', () => {
  for (const body of ['# Before\n\n> ---\n\nAfter', '# Before\n\n- item\n\n  ---\n\nAfter']) {
    const s = state(body);
    const rule = rules(s)[0];
    expect(rule).toBeDefined();
    const decos = decorations(s);
    expect(decos.some((d) => d.block && d.from <= rule.from && d.to >= rule.to)).toBe(false);
    expect(decos).toContainEqual({
      from: rule.from,
      to: rule.to,
      className: 'cm-live-rule-source',
      block: false,
    });
    expect(
      decos.some(
        (d) => d.from === s.doc.lineAt(rule.from).from && d.className.includes('cm-live-rule-preview'),
      ),
    ).toBe(true);
  }
});

test('editing the revealed separator and undoing use the shared document history', async () => {
  const doc = '# Before\n---\nAfter';
  const editorView = await editor(doc);
  const line = editorView.state.doc.line(2);
  await act(async () => editorView.dispatch({ selection: { anchor: line.from + 1 } }));
  expect(editorView.contentDOM.textContent).toContain('---');
  await act(async () =>
    editorView.dispatch({
      changes: { from: line.from, to: line.to, insert: 'edited' },
      userEvent: 'input.type',
    }),
  );
  expect(editorView.state.doc.toString()).toBe('# Before\nedited\nAfter');
  expect(editorView.contentDOM.querySelector('.cm-live-rule-line')).toBeNull();
  await act(async () => {
    undo(editorView);
  });
  expect(editorView.state.doc.toString()).toBe(doc);
  await act(async () => editorView.dispatch({ selection: { anchor: doc.length } }));
  expect(editorView.contentDOM.querySelector('.cm-live-rule-preview')).not.toBeNull();
});

test('YAML fences remain frontmatter while a later separator is an editable rule', async () => {
  const doc = '---\nstatus: draft\n---\n\n# Before\n---\nAfter';
  const editorView = await editor(doc);
  await act(async () => editorView.dispatch({ selection: { anchor: doc.length } }));
  expect(document.querySelectorAll('.frontmatter-panel')).toHaveLength(1);
  expect(editorView.contentDOM.querySelectorAll('.cm-live-rule-preview')).toHaveLength(1);
  const rule = rules(editorView.state)[0];
  expect(rule.from).toBe(doc.lastIndexOf('---'));
  await act(async () => editorView.dispatch({ selection: { anchor: rule.from + 1 } }));
  expect(document.querySelectorAll('.frontmatter-panel')).toHaveLength(1);
  expect(editorView.contentDOM.querySelector('.cm-live-rule-preview')).toBeNull();
  expect(editorView.state.doc.toString()).toBe(doc);
});

// Vertical distances require browser layout. These real keyboard cases exercise
// boundary entry and Vim editing without fabricating jsdom line geometry.
test('arrow keys enter the separator from either adjacent line boundary', async () => {
  const editorView = await editor('# Before\n---\nAfter');
  await act(async () => editorView.dispatch({ selection: { anchor: editorView.state.doc.line(1).to } }));
  await press(editorView, 'ArrowRight');
  expect(editorView.state.selection.main.head).toBe(editorView.state.doc.line(2).from);
  expect(editorView.contentDOM.querySelector('.cm-live-rule-preview')).toBeNull();
  await act(async () => editorView.dispatch({ selection: { anchor: editorView.state.doc.line(3).from } }));
  await press(editorView, 'ArrowLeft');
  expect(editorView.state.selection.main.head).toBe(editorView.state.doc.line(2).to);
  expect(editorView.contentDOM.querySelector('.cm-live-rule-preview')).toBeNull();
});

test('real Vim line jumps reveal rule source for normal-mode editing and undo', async () => {
  const doc = '# Before\n---\nAfter';
  const editorView = await editor(doc, true);
  await press(editorView, '2');
  await press(editorView, 'G', { shiftKey: true });
  expect(editorView.state.doc.lineAt(editorView.state.selection.main.head).number).toBe(2);
  expect(editorView.contentDOM.querySelector('.cm-live-rule-preview')).toBeNull();
  await press(editorView, 'x');
  expect(editorView.state.doc.line(2).text).toBe('--');
  await press(editorView, 'u');
  expect(editorView.state.doc.toString()).toBe(doc);
  await press(editorView, 'G', { shiftKey: true });
  expect(editorView.state.doc.lineAt(editorView.state.selection.main.head).number).toBe(3);
  expect(editorView.contentDOM.querySelector('.cm-live-rule-preview')).not.toBeNull();
  expect(getCM(editorView)?.state.vim?.insertMode).toBe(false);
});
