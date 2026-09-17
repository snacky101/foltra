import { EditorSelection, EditorState, StateEffect } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { history, undo, redo } from '@codemirror/commands';
import { GFM } from '@lezer/markdown';
import { expect, test } from 'vitest';
import { cycleMarkdownTask, taskPrefix } from './markdownTasks';

function editor(doc: string, anchor = doc.length) {
  const target = {
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [yamlFrontmatter({ content: markdown({ extensions: [GFM] }) }), history()],
    }),
    dispatch(transaction: { state: EditorState }) {
      target.state = transaction.state;
    },
  };
  return target;
}

test('normal bullet becomes a task then cycles todo, doing, done and todo without moving the text cursor', () => {
  const target = editor('- 한글 항목');
  for (const marker of [' ', '/', 'x', ' ']) {
    expect(cycleMarkdownTask(target)).toBe(true);
    expect(target.state.doc.toString()).toBe(`- [${marker}] 한글 항목`);
    expect(target.state.selection.main.head).toBe(target.state.doc.length);
  }
  expect(undo(target)).toBe(true);
  expect(target.state.doc.toString()).toBe('- [x] 한글 항목');
});

test.each([
  ['- ', '- [ ] '],
  ['-', '- [ ] '],
  ['- [ ]', '- [/]'],
  ['- [/]', '- [x]'],
  ['- [b]', '- [ ]'],
  ['* [X] done', '* [ ] done'],
  ['+ [b] blocked', '+ [ ] blocked'],
  ['- parent\n  - nested', '- parent\n  - [ ] nested'],
  ['> - [/] quote', '> - [x] quote'],
  ['---\ntitle: test\n---\n\n- [ ] after YAML', '---\ntitle: test\n---\n\n- [/] after YAML'],
])('cycles only the task prefix and preserves surrounding Markdown: %s', (before, after) => {
  const target = editor(before);
  expect(cycleMarkdownTask(target)).toBe(true);
  expect(target.state.doc.toString()).toBe(after);
});

test.each([
  ['plain [ ] text', 8],
  ['---\nitems:\n  - value\n---\nbody', 17],
  ['```md\n- [ ] code\n```', 12],
  ['    - indented code', 12],
  ['-     [x] code', 12],
  ['1. numbered', 8],
  ['- item\n  continuation', 15],
])('does not rewrite non-bullet contexts: %s', (doc, anchor) => {
  const target = editor(doc, anchor);
  expect(cycleMarkdownTask(target)).toBe(false);
  expect(target.state.doc.toString()).toBe(doc);
});

test('the current bullet is updated without changing the adjacent items', () => {
  const target = editor('- first\n- [ ] second\n- third', 15);
  expect(cycleMarkdownTask(target)).toBe(true);
  expect(target.state.doc.toString()).toBe('- first\n- [/] second\n- third');
  expect(target.state.selection.main.head).toBe(15);
});

test('an empty parent bullet can become a task without modifying its child', () => {
  const target = editor('- \n  - child', 2);
  expect(cycleMarkdownTask(target)).toBe(true);
  expect(target.state.doc.toString()).toBe('- [ ] \n  - child');
  expect(target.state.selection.main.head).toBe(6);
});

test('task prefix recognition excludes inline and escaped brackets and unknown markers', () => {
  for (const text of ['[ ]tail', '\\[ ] escaped', '`[x]`', '[abc] text', '[a] text'])
    expect(taskPrefix(text)).toBeNull();
  expect(taskPrefix('[/]')).toMatchObject({ status: 'doing', length: 3, hasSeparator: false });
  expect(taskPrefix('[/]\n')).toBeNull();
  expect(taskPrefix('[B] bookmark')).toMatchObject({ status: 'bookmark', hasSeparator: true });
});

test('read-only documents reject task edits', () => {
  const target = editor('- [ ] item');
  target.state = target.state.update({
    effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)),
  }).state;
  expect(cycleMarkdownTask(target)).toBe(false);
  expect(target.state.doc.toString()).toBe('- [ ] item');
});

test('multiple cursors cycle each bullet once and undo/redo all edits together', () => {
  const before = '- [ ] one\n- two\n- [/] three';
  const target = editor(before);
  target.state = target.state.update({
    effects: StateEffect.appendConfig.of(EditorState.allowMultipleSelections.of(true)),
  }).state;
  target.state = target.state.update({
    selection: EditorSelection.create([2, 8, 14, before.length].map((pos) => EditorSelection.cursor(pos))),
  }).state;
  expect(cycleMarkdownTask(target)).toBe(true);
  const after = '- [/] one\n- [ ] two\n- [x] three';
  expect(target.state.doc.toString()).toBe(after);
  expect(target.state.selection.ranges.map((range) => range.head)).toEqual([2, 8, 18, after.length]);
  expect(undo(target)).toBe(true);
  expect(target.state.doc.toString()).toBe(before);
  expect(redo(target)).toBe(true);
  expect(target.state.doc.toString()).toBe(after);
});
