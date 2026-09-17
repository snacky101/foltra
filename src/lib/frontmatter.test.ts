import { expect, test } from 'vitest';
import {
  frontmatterBlock,
  frontmatterEntries,
  frontmatterRange,
  parseFrontmatter,
  updateFrontmatter,
} from './frontmatter';

test.each(['\n', '\r\n'])('frontmatter fences retain exact body boundaries with %j', (newline) => {
  const source = ['---', '# comment', 'tags: [one, 한글]', '---', '', '# Body', 'Keep unchanged'].join(
    newline,
  );
  const range = frontmatterRange(source)!;
  expect(range.yaml).toBe(['# comment', 'tags: [one, 한글]', ''].join(newline));
  expect(source.slice(range.bodyFrom)).toBe(`${newline}# Body${newline}Keep unchanged`);
  expect(source.slice(0, range.to).endsWith('---')).toBe(true);
});

test('mid-document rules, code examples and unclosed rules are ordinary Markdown', () => {
  for (const source of [
    'Before\n---\nkey: value\n---',
    '```yaml\n---\nkey: value\n---\n```',
    '---\nParagraph',
  ])
    expect(frontmatterRange(source)).toBeNull();
  expect(frontmatterRange('\uFEFF---\ntags: []\n---')?.yaml).toBe('tags: []\n');
});

test('scalar types, quoted strings, lists, maps and comments survive a property edit', () => {
  const original =
    '# Keep heading\nstatus: draft # Keep status comment\ncount: 3\nflag: false\ncode: "001"\ntags: [study, 한글]\nextra: {priority: 2}\n';
  const next = updateFrontmatter(original, 'status', 'ready');
  expect(next).toContain('# Keep heading');
  expect(next).toContain('# Keep status comment');
  expect(parseFrontmatter(next).toJSON()).toEqual({
    status: 'ready',
    count: 3,
    flag: false,
    code: '001',
    tags: ['study', '한글'],
    extra: { priority: 2 },
  });
  expect(frontmatterEntries(parseFrontmatter(next)).find((entry) => entry.key === 'code')?.value).toContain(
    '"001"',
  );
});

test('add/delete preserve unrelated properties and reject duplicate names without changing source', () => {
  const original = 'status: draft\ntags: [one]\n';
  expect(() => updateFrontmatter(original, 'status', 'other', true)).toThrow('같은 이름');
  const added = updateFrontmatter(original, 'done', 'true', true);
  expect(parseFrontmatter(added).toJSON()).toEqual({ status: 'draft', tags: ['one'], done: true });
  expect(parseFrontmatter(updateFrontmatter(added, 'status', null)).toJSON()).toEqual({
    tags: ['one'],
    done: true,
  });
  expect(original).toBe('status: draft\ntags: [one]\n');
});

test.each([
  'x: [unfinished',
  'x: 1\nx: 2',
  'x: &a [1]\ny: *a',
  'x: !custom thing',
  'x: ! foo',
  'x: !<tag:yaml.org,2002:timestamp> 2026-09-17',
  '- one\n- two',
  '2: invalid-key',
  'x: .inf',
  'x: 9007199254740993',
  `x: ${'['.repeat(20)}1${']'.repeat(20)}`,
])('invalid or unsupported YAML stays unchanged and raises an error: %s', (source) => {
  expect(() => parseFrontmatter(source)).toThrow();
  expect(() => updateFrontmatter(source, 'other', 'value')).toThrow();
});

test('property updates validate the size and depth of the complete resulting map', () => {
  const source = `large: ${'x'.repeat(40000)}\n`;
  expect(() => updateFrontmatter(source, 'other', 'y'.repeat(40000), true)).toThrow('64 KiB');
  expect(() =>
    updateFrontmatter('ok: true\n', 'nested', '['.repeat(16) + '0' + ']'.repeat(16), true),
  ).toThrow('16단계');
});

test.each(['\r---\nBody', '\u2028---\nBody', '\u2029---\nBody', '\n---\rBody', '\n---\r'])(
  'frontmatter closing fences require LF, CRLF or strict EOF: %j',
  (suffix) => {
    expect(frontmatterRange('---\nx: hi' + suffix)).toBeNull();
  },
);

test('the size limit uses UTF-8 bytes, and empty/comment-only maps remain usable', () => {
  expect(() => parseFrontmatter(`text: ${'가'.repeat(22000)}`)).toThrow('64 KiB');
  expect(frontmatterEntries(parseFrontmatter('# comment\n'))).toEqual([]);
  expect(parseFrontmatter(updateFrontmatter('# comment\n', 'name', '"true"', true)).toJSON()).toEqual({
    name: 'true',
  });
  expect(frontmatterBlock('tags: []\n')).toBe('---\ntags: []\n---');
});

test('prototype-shaped property names stay ordinary data', () => {
  const original = '__proto__: {polluted: true}\nconstructor: example\n';
  const next = updateFrontmatter(original, 'ok', 'true', true);
  expect(frontmatterEntries(parseFrontmatter(next)).map((entry) => entry.key)).toEqual([
    '__proto__',
    'constructor',
    'ok',
  ]);
  expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
});

test('editing or deleting quoted keys preserves their exact whitespace and neighboring keys', () => {
  const source = '"title ": Original\ntitle: Keep this\n';
  expect(parseFrontmatter(updateFrontmatter(source, 'title ', 'Changed')).toJSON()).toEqual({
    'title ': 'Changed',
    title: 'Keep this',
  });
  expect(parseFrontmatter(updateFrontmatter(source, 'title ', null)).toJSON()).toEqual({
    title: 'Keep this',
  });
});

test.each([
  ['count', '2', '3', 3],
  ['tags', '[one]', '[two]', ['two']],
  ['extra', '{key: old}', '{key: new}', { key: 'new' }],
  ['cleared', 'old', '', null],
])('editing %s retains comments before the property value', (key, before, after, expected) => {
  const source = `${key}: # Keep explanation\n  ${before}\nother: unchanged\n`;
  const updated = updateFrontmatter(source, key as string, after as string);
  expect(updated).toContain('# Keep explanation');
  expect(parseFrontmatter(updated).toJSON()).toEqual({ [key as string]: expected, other: 'unchanged' });
});
