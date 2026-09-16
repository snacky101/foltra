import { expect, test } from 'vitest';
import { separateListParagraphs } from './markdownListLayout';

test.each([
  '- Item\n  continuation\n- Next',
  '- Item\n\tcontinuation\n- Next',
  '> - Item\n>   continuation\n> - Next',
  '- Parent\n  - Child\n    continuation\n- Next',
  '- **bold\ncontinued**',
  '- `code\ncontinued`',
  '- [link\nlabel](https://example.com)',
  '- Item\n\nParagraph\n\n- Next',
  '- Item\n  ```md\n  - example\n  text\n  ```',
  '- Item\n\n      - example\n      text',
  '```md\n- example\ntext\n```',
  '    - example\n    text',
  '- Item\n\n  | Key | Value |\n  | --- | --- |\n  | a | b |',
])('intentional continuation, existing separators and literal blocks retain their source: %s', (body) => {
  expect(separateListParagraphs(body)).toBe(body);
});

test('render-only boundaries separate both sides of a paragraph without splitting its lines', () => {
  const body = '- First\nPlain **text**\n[[Target|Alias]]\n- Second';
  const separated = separateListParagraphs(body);
  expect(separated).toBe('- First\n\nPlain **text**\n[[Target|Alias]]\n\n- Second');
  expect(separateListParagraphs(separated)).toBe(separated);
});
