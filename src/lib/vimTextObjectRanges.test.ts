import { describe, expect, it } from 'vitest';
import {
  collectDelimitedCandidates,
  collectVimTextObjectCandidates,
  findVimTextObject,
  selectVimTextObject,
  textObjectSearchWindow,
  type VimTextObjectOptions,
} from './vimTextObjectRanges';

function object(marked: string, identifier: string, options: VimTextObjectOptions = {}) {
  const position = marked.indexOf('│');
  const source = marked.replace('│', '');
  const range = findVimTextObject(source, { from: position, to: position }, identifier, options);
  return range ? source.slice(range.from, range.to) : null;
}

const inside = { inner: true };

describe('mini.ai bracket and quote ranges', () => {
  it.each(['()', '[]', '{}', '<>'])('distinguishes %s whitespace and nesting', ([left, right]) => {
    const marked = `${left}${left} │a ${left}bb${right} ${right}${right}`;
    expect(object(marked, left, inside)).toBe(`a ${left}bb${right}`);
    expect(object(marked, right, inside)).toBe(` a ${left}bb${right} `);
    expect(object(marked, left)).toBe(`${left} a ${left}bb${right} ${right}`);
    expect(object(marked, right, { ...inside, count: 2 })).toBe(`${left} a ${left}bb${right} ${right}`);
  });

  it('aliases nested heterogeneous brackets without confusing angle comparison expressions', () => {
    expect(object('[ ( │a {b} ) ]', 'b', inside)).toBe(' a {b} ');
    expect(object('[ ( │a {b} ) ]', 'b', { count: 2 })).toBe('[ ( a {b} ) ]');
    expect(object('{ │x }', 'B', inside)).toBe(' x ');
    expect(object('f(│a < b, c > d)', 'b', inside)).toBe('a < b, c > d');
  });

  it('ignores brackets and escaped delimiters inside strings', () => {
    expect(object('f(│"a ) b", g(1))', ')', inside)).toBe('"a ) b", g(1)');
    expect(object(String.raw`│escaped \(no\) (yes)`, ')', inside)).toBe('yes');
  });

  it.each(['"', "'", '`'])('pairs %s without selecting intervening prose', (quote) => {
    expect(object(`${quote}│a${quote} gap ${quote} b ${quote}`, quote, { ...inside, count: 2 })).toBe(' b ');
    expect(object(`│${quote}a${quote} gap ${quote}b${quote}`, 'q')).toBe(`${quote}a${quote}`);
  });

  it('handles escaped quotes, backticks, contractions, and unfinished prose', () => {
    expect(object(String.raw`"│a \"b\" c"`, 'q', inside)).toBe(String.raw`a \"b\" c`);
    expect(object('it\'s │a "quote"', 'q', inside)).toBe('quote');
    expect(object("someone's 'unfinished\n│(valid)", 'b', inside)).toBe('valid');
    expect(object('`│line\nnext`', 'q', inside)).toBe('line\nnext');
  });

  it('finds each quote type independently and expands nested mixed quotes', () => {
    expect(object(`'outer "│inner" text'`, 'q', inside)).toBe('inner');
    expect(object(`'outer "│inner" text'`, 'q', { inner: true, count: 2 })).toBe('outer "inner" text');
    expect(object('`f("│argument")`', 'q', inside)).toBe('argument');
  });

  it('returns empty ranges for editing empty pairs, then advances with a count', () => {
    expect(object('(│) (next)', ')', inside)).toBe('');
    expect(object('(│) (next)', ')', { ...inside, count: 2 })).toBe('next');
  });

  it('does not manufacture crossed or unmatched ranges', () => {
    expect(object('│([)]', 'b')).toBeNull();
    expect(object('│(unfinished', ')')).toBeNull();
    expect(object('│"unfinished', 'q')).toBeNull();
  });
});

describe('function and argument ranges', () => {
  it('expands nested calls and includes a qualified name only for around', () => {
    expect(object('outer(a, pkg.inner(│b, c) )', 'f')).toBe('pkg.inner(b, c)');
    expect(object('outer(a, pkg.inner(│b, c) )', 'f', inside)).toBe('b, c');
    expect(object('outer(a, pkg.inner(│b, c) )', 'f', { count: 2 })).toBe('outer(a, pkg.inner(b, c) )');
    expect(object('│math.max (a, b)', 'f')).toBe('math.max (a, b)');
    expect(object('│계산.합(하나, 둘)', 'f', inside)).toBe('하나, 둘');
    expect(object('│$fn()', 'f')).toBe('$fn()');
    expect(object('│123(a)', 'f')).toBeNull();
    expect(object('│(a)', 'f')).toBeNull();
  });

  it.each([
    ['f(│one, two, three)', 'one', 'one,'],
    ['f(one, │two, three)', 'two', ', two'],
    ['f(one, two, │three)', 'three', ', three'],
    ['f( │only )', 'only', ' only '],
    ['[│one, two]', 'one', 'one,'],
    ['{one, │two}', 'two', ', two'],
  ])('selects argument and adjoining comma in %s', (source, inner, around) => {
    expect(object(source, 'a', inside)).toBe(inner);
    expect(object(source, 'a')).toBe(around);
  });

  it('selects argument padding but leaves bracket-adjacent padding outside around edits', () => {
    expect(object('f(│  xx  ,  yy  )', 'a')).toBe('xx  ,');
    expect(object('f(  xx  ,  yy │ )', 'a')).toBe(',  yy');
    expect(object('f(│  xx  )', 'a')).toBe('  xx  ');
    expect(object('f(  xx  ,│  yy  )', 'a', inside)).toBe('yy');
  });

  it('ignores nested bracket, quoted, escaped and backtick commas', () => {
    expect(object('f(│g(a, b), {x: [1, 2]}, "c,d", `e,f`)', 'a', inside)).toBe('g(a, b)');
    expect(object('f(g(a, b), │{x: [1, 2]}, "c,d", `e,f`)', 'a', inside)).toBe('{x: [1, 2]}');
    expect(object('f(g(a, b), {x: [1, 2]}, │"c,d", `e,f`)', 'a', inside)).toBe('"c,d"');
    expect(object('f(g(a, b), {x: [1, 2]}, "c,d", │`e,f`)', 'a', inside)).toBe('`e,f`');
    expect(object(String.raw`f(│"a\",b", c)`, 'a', inside)).toBe(String.raw`"a\",b"`);
  });

  it('works inside inline and fenced code while protecting quoted argument commas', () => {
    expect(object('`f(│"a,b", c)`', 'f', inside)).toBe('"a,b", c');
    expect(object('`f(│"a,b", c)`', 'a', inside)).toBe('"a,b"');
    expect(object('```go\nf(│"a,b", c)\n```', 'f')).toBe('f("a,b", c)');
    expect(object('```go\nf(│"a,b", c)\n```', 'a', inside)).toBe('"a,b"');
  });

  it('supports multiline arguments and trailing commas without a fake empty argument', () => {
    expect(object('f(\n  │first,\n  second,\n)', 'a', inside)).toBe('first');
    expect(object('f(\n  first,\n  │second,\n)', 'a')).toBe(',\n  second');
    expect(object('f(│)', 'a')).toBeNull();
  });

  it('counts across arguments using the same inner and around search', () => {
    expect(object('f(│a, g(b, c) )', 'a', { count: 2 })).toBe(', g(b, c)');
    expect(object('f(│a, g(b, c) )', 'a', { inner: true, count: 2 })).toBe('g(b, c)');
  });
});

describe('tag text objects remain plain source text', () => {
  it('pairs nested identical tags with attributes and quoted angle brackets', () => {
    const source = '<div title="a > b"><div data-x=\'c<d\'>│text</div></div>';
    expect(object(source, 't', inside)).toBe('text');
    expect(object(source, 't', { count: 2 })).toBe(source.replace('│', ''));
  });

  it('handles attributes across lines and excludes self closing/void tags', () => {
    expect(object('<box\n title="hi">│a<br><img src="x"/><child/>b</box>', 't', inside)).toBe(
      'a<br><img src="x"/><child/>b',
    );
    expect(object('│<br><img src="x"/>', 't')).toBeNull();
  });

  it('does not treat comments or malformed crossed tags as editable pairs', () => {
    expect(object('│<!-- <p>hidden</p> --> <p>shown</p>', 't', inside)).toBe('shown');
    expect(object('│<a><b>bad</a></b>', 't')).toBeNull();
    expect(object('│<unfinished attr="', 't')).toBeNull();
  });
});

describe('separator and literal pair objects', () => {
  it.each([
    ['aa_│b__cc___', '_', 'b', 'b__'],
    ['aa,│b,,cc,,,', ',', 'b', 'b,,'],
    ['a │word  after ', ' ', 'word', 'word  '],
    ['0│data00tail0', '0', 'data', 'data00'],
  ])('implements nonletter separator %s', (source, id, inner, around) => {
    expect(object(source, id, inside)).toBe(inner);
    expect(object(source, id)).toBe(around);
  });

  it('does not steal built-in word/sentence/paragraph objects', () => {
    expect(object('│word', 'w')).toBeNull();
    expect(object('│Sentence.', 's')).toBeNull();
    expect(object('│Paragraph', 'p')).toBeNull();
  });

  it('matches nested literal pairs without evaluating regex syntax', () => {
    const source = '[[a [[b]] c]]';
    const candidates = collectDelimitedCandidates(source, '[[', ']]');
    expect(selectVimTextObject(source, { from: 6, to: 6 }, candidates, inside)).toEqual({ from: 6, to: 7 });
    expect(selectVimTextObject(source, { from: 6, to: 6 }, candidates, { count: 2 })).toEqual({
      from: 0,
      to: source.length,
    });
    expect(collectDelimitedCandidates('.*a+$', '.*', '+$')).toEqual([
      { around: { from: 0, to: 5 }, inner: { from: 2, to: 3 } },
    ]);
    expect(collectDelimitedCandidates('~~a~~ ~~b~~', '~~', '~~')).toHaveLength(2);
    expect(collectDelimitedCandidates('text', '', 'x')).toEqual([]);
  });
});

describe('shared cover, directional and consecutive search', () => {
  it('uses current-line next before a covering multiline range', () => {
    expect(object('(\n  │text (local)\n)', ')', inside)).toBe('local');
    expect(object('(\n  │text\n)', ')', inside)).toBe('\n  text\n');
  });

  it('finds next and previous siblings without reselecting the enclosing object', () => {
    expect(object('(one) (│two) (three)', ')', { inner: true, search: 'next' })).toBe('three');
    expect(object('(one) (│two) (three)', ')', { inner: true, search: 'previous' })).toBe('one');
    expect(object('(one) (two) │end', ')', { inner: true, search: 'prev', count: 2 })).toBe('one');
    expect(object('(│one)', ')', { search: 'next' })).toBeNull();
  });

  it('expands a Visual selection then moves to the next candidate', () => {
    const source = '((a)) (b)';
    const selected = findVimTextObject(source, { from: 2, to: 3 }, ')', inside);
    expect(selected).toEqual({ from: 1, to: 4 });
    expect(findVimTextObject(source, selected!, ')', inside)).toEqual({ from: 7, to: 8 });
  });

  it('returns null rather than a partial result when a count is unavailable', () => {
    expect(object('(│a) (b)', ')', { count: 3 })).toBeNull();
    expect(object('(│a)', ')', { count: 1_000_000 })).toBeNull();
  });

  it('expands deep nesting with a large count without changing selection semantics', () => {
    const source = '('.repeat(10_000) + 'x' + ')'.repeat(10_000);
    expect(
      findVimTextObject(source, { from: 10_000, to: 10_000 }, ')', { inner: true, count: 1000 }),
    ).toEqual({ from: 9_001, to: 11_000 });
  });

  it('stops after 50 neighboring lines and can disable neighborhood search', () => {
    expect(object(`│text${'\n'.repeat(50)}(near)`, ')', inside)).toBe('near');
    expect(object(`│text${'\n'.repeat(51)}(far)`, ')', inside)).toBeNull();
    expect(object('│text\n(next)', ')', { ...inside, nLines: 0 })).toBeNull();
  });

  it('bounds enormous lines and malformed input without scanning an entire document', () => {
    const source = `(${''.padEnd(200_000, 'a')})`;
    const window = textObjectSearchWindow(source, { from: 100_000, to: 100_000 });
    expect(window!.to - window!.from).toBeLessThanOrEqual(100_000);
    expect(findVimTextObject(source, { from: 100_000, to: 100_000 }, ')')).toBeNull();
    expect(collectVimTextObjectCandidates(`<x${' '.repeat(100_000)}`, 't')).toEqual([]);
    expect(findVimTextObject('text', { from: -1, to: 2 }, ')')).toBeNull();
  });

  it('never mutates candidates or the selected reference', () => {
    const source = '(one) (two)';
    const reference = Object.freeze({ from: 2, to: 2 });
    const candidates = collectVimTextObjectCandidates(source, ')');
    const before = JSON.stringify(candidates);
    expect(selectVimTextObject(source, reference, candidates, { count: 2, inner: true })).toEqual({
      from: 7,
      to: 10,
    });
    expect(JSON.stringify(candidates)).toBe(before);
    expect(reference).toEqual({ from: 2, to: 2 });
  });
});
