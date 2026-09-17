import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { expect, test } from 'vitest';
import { sqlQueryMarkdown } from './sqlQuery';
import { codeLanguage } from './codeLanguages';

test.each([
  'SELECT "이름" FROM "Reading room";',
  'SELECT "double""quote" FROM "DB```name";',
  'SELECT * FROM "DB\n```\nname";',
])('SQL insertion preserves identifiers inside one Markdown fence: %s', (sql) => {
  const source = sqlQueryMarkdown(sql);
  const state = EditorState.create({ doc: source, extensions: [markdown()] });
  const tree = syntaxTree(state);
  expect(tree.topNode.firstChild?.name).toBe('FencedCode');
  expect(tree.topNode.firstChild?.nextSibling).toBeNull();
  const code = tree.topNode.firstChild!.getChild('CodeText')!;
  expect(source.slice(code.from, code.to)).toBe(sql);
});

test('executable SQL uses PostgreSQL highlighting while other code languages retain their support', async () => {
  expect(codeLanguage('foltra-sql')).toBe(codeLanguage('PostgreSQL'));
  const support = await codeLanguage('foltra-sql')!.load();
  expect(support.language.parser.parse('SELECT "이름" FROM "독서";').toString()).toContain('Keyword');
  expect(codeLanguage('go')?.name).toBe('Go');
  expect(codeLanguage('missing-language')).toBeNull();
});
