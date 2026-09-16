import { EditorState, EditorSelection } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { expect, test } from 'vitest';
import { insertFencedCodeBlock } from './codeBlocks';

const create = (doc: string, head = doc.length) =>
  EditorState.create({ doc, selection: { anchor: head }, extensions: [markdown({ addKeymap: false })] });
test.each([
  ['```', '```\n\n```', 4],
  ['```go', '```go\n\n```', 6],
  ['```typescript', '```typescript\n\n```', 14],
  ['````md', '````md\n\n````', 7],
  ['~~~python', '~~~python\n\n~~~', 10],
  ['  ```go', '  ```go\n  \n  ```', 10],
  ['> ```go', '> ```go\n> \n> ```', 10],
  ['- ```go', '- ```go\n  \n  ```', 10],
])('Enter on %j closes the fence and places the cursor inside', (before, after, cursor) => {
  let state = create(before);
  expect(
    insertFencedCodeBlock({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    }),
  ).toBe(true);
  expect(state.doc.toString()).toBe(after);
  expect(state.selection.main.head).toBe(cursor);
});

test.each([
  ['`inline`'],
  ['Some ```go'],
  ['    ```go'],
  ['```go\nhello'],
  ['```go\n\n```'],
  ['```go\n\n```', 5],
  ['```go', 3],
  ['```go\n```python'],
] as [string, number?][])(
  'does not add a second closing fence or treat ordinary text as an opener: %j',
  (doc, head) => {
    expect(
      insertFencedCodeBlock({
        state: create(doc, head),
        dispatch: () => {
          throw new Error('Unexpected edit');
        },
      }),
    ).toBe(false);
  },
);

test('does not overwrite a selection or edit a read-only document', () => {
  for (const state of [
    create('```go').update({ selection: EditorSelection.range(0, 5) }).state,
    EditorState.create({
      doc: '```go',
      selection: { anchor: 5 },
      extensions: [markdown(), EditorState.readOnly.of(true)],
    }),
  ]) {
    expect(
      insertFencedCodeBlock({
        state,
        dispatch: () => {
          throw new Error('Unexpected edit');
        },
      }),
    ).toBe(false);
  }
});
