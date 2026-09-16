import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree } from '@codemirror/language';
import { expect, test } from 'vitest';
import { continueMarkdownList, deleteMarkdownMarkupBackward } from './markdownEditing';
import { markdownListLayout, separateListParagraphs } from './markdownListLayout';

function state(doc: string) {
  return EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [markdown({ extensions: [GFM] })],
  });
}

test('regression: the default Markdown command inserts two newlines in a loose list', () => {
  let s = state('- First\n\n- English bullet');
  insertNewlineContinueMarkup({
    state: s,
    dispatch: (tr) => {
      s = tr.state;
    },
  });
  expect(s.doc.toString()).toBe('- First\n\n- English bullet\n\n- ');
});

test.each([
  ['- English bullet', '- English bullet\n- '],
  ['- 한글 항목', '- 한글 항목\n- '],
  ['- First\n\n- English bullet', '- First\n\n- English bullet\n- '],
  ['- First\n- ', '- First\n'],
  ['- Parent\n  - Child', '- Parent\n  - Child\n  - '],
  ['- Parent\n  - First\n\n  - Child', '- Parent\n  - First\n\n  - Child\n  - '],
  ['1. First\n\n2. Second', '1. First\n\n2. Second\n3. '],
  ['- [x] First\n\n- [x] Done', '- [x] First\n\n- [x] Done\n- [ ] '],
  ['> - First\n>\n> - Second', '> - First\n>\n> - Second\n> - '],
])('Enter continues or exits the list once: %s', (before, after) => {
  let s = state(before);
  expect(
    continueMarkdownList({
      state: s,
      dispatch: (tr) => {
        s = tr.state;
      },
    }),
  ).toBe(true);
  expect(s.doc.toString()).toBe(after);
  expect(s.selection.main.head).toBe(after.length);
});

test.each([
  ['- First\n- ', '- First\n'],
  ['1. First\n2. ', '1. First\n'],
  ['- [x] First\n- [ ] ', '- [x] First\n'],
  ['- First\n\n- ', '- First\n\n'],
  ['> - First\n> - ', '> - First\n> '],
])('exiting %j keeps the same line and displays the next text outside the list', (before, after) => {
  let s = state(before);
  continueMarkdownList({
    state: s,
    dispatch: (tr) => {
      s = tr.state;
    },
  });
  expect(s.doc.toString()).toBe(after);
  expect(s.selection.main.head).toBe(after.length);
  expect(s.doc.lines).toBe(state(before).doc.lines);
  s = s.update(s.replaceSelection('일반 문장')).state;
  expect(markdownListLayout(s.doc, syntaxTree(s)).lines.has(s.doc.lines)).toBe(false);
  const reading = state(separateListParagraphs(s.doc.toString()));
  for (let node = syntaxTree(reading).resolveInner(reading.doc.length, -1); node; node = node.parent!)
    expect(node.name).not.toMatch(/^(?:Bullet|Ordered)List$/);
});

test('exiting a nested empty item still returns to the parent list first', () => {
  let s = state('- Parent\n  - Child\n  - ');
  continueMarkdownList({
    state: s,
    dispatch: (tr) => {
      s = tr.state;
    },
  });
  expect(s.doc.toString()).toBe('- Parent\n  - Child\n- ');
  continueMarkdownList({
    state: s,
    dispatch: (tr) => {
      s = tr.state;
    },
  });
  expect(s.doc.toString()).toBe('- Parent\n  - Child\n');
});

test.each([
  ['- ', ''],
  ['- First\n- ', '- First\n'],
  ['1. First\n2. ', '1. First\n'],
  ['- [x] First\n- [ ] ', '- [x] First\n'],
  ['- First\n\n- ', '- First\n\n'],
  ['> - First\n> - ', '> - First\n> '],
  ['- Parent\n  - Child\n  - ', '- Parent\n  - Child\n- '],
])('Backspace on an empty item exits one list level: %j', (before, after) => {
  let s = state(before);
  expect(
    deleteMarkdownMarkupBackward({
      state: s,
      dispatch: (tr) => {
        s = tr.state;
      },
    }),
  ).toBe(true);
  expect(s.doc.toString()).toBe(after);
  expect(s.selection.main.head).toBe(after.length);
});

test('Backspace preserves text in a nonempty item and leaves code and selections to normal deletion', () => {
  let s = state('- First\n- Second');
  s = s.update({ selection: { anchor: s.doc.line(2).from + 2 } }).state;
  deleteMarkdownMarkupBackward({
    state: s,
    dispatch: (tr) => {
      s = tr.state;
    },
  });
  expect(s.doc.toString()).toBe('- First\n  Second');
  for (const s of [
    state('```\n- '),
    state('Plain text'),
    state('- ').update({ selection: EditorSelection.range(0, 2) }).state,
  ]) {
    expect(
      deleteMarkdownMarkupBackward({
        state: s,
        dispatch: () => {
          throw new Error('Unexpected edit');
        },
      }),
    ).toBe(false);
  }
});

test.each(['Plain paragraph', '```\n- code'])('non-list content falls through to normal Enter: %s', (doc) => {
  const s = state(doc);
  expect(
    continueMarkdownList({
      state: s,
      dispatch: () => {
        throw new Error('Unexpected edit');
      },
    }),
  ).toBe(false);
});

test('splitting a loose item preserves its trailing text and positions the cursor before it', () => {
  let s = state('- First\n\n- English bullet');
  const cursor = s.doc.toString().indexOf('bullet');
  s = s.update({ selection: EditorSelection.cursor(cursor) }).state;
  continueMarkdownList({
    state: s,
    dispatch: (tr) => {
      s = tr.state;
    },
  });
  expect(s.doc.toString()).toBe('- First\n\n- English\n- bullet');
  expect(s.selection.main.head).toBe(s.doc.toString().indexOf('bullet'));
});
