import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { expect, test } from 'vitest';
import { wikiCompletions, wikiCompletionEdit } from './wikiCompletion';
import type { Workspace } from './types';

const workspace = {
  notes: [
    { id: 'one', title: '생각' },
    { id: 'two', title: '생각 정리' },
  ],
  folders: [],
  links: [{ source: 'one', name: '미래의 생각', label: '별칭', target: null }],
  settings: { showUnresolvedLinks: true },
} as unknown as Workspace;
function state(doc: string, anchor = doc.length) {
  return EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ extensions: [GFM] })] });
}
function completions(doc: string, data = workspace) {
  const s = state(doc);
  return wikiCompletions(new CompletionContext(s, s.doc.length, false), data);
}

test('opening brackets offer existing notes and missing destinations without creating notes', () => {
  const snapshot = JSON.stringify(workspace);
  expect(completions('[[')?.options.map((item) => item.label)).toEqual(['미래의 생각', '생각', '생각 정리']);
  expect(completions('[[생각')?.options.map((item) => item.label)).toEqual([
    '생각',
    '생각 정리',
    '미래의 생각',
  ]);
  expect(completions('[[처음 쓰는 제목')?.options[0]).toMatchObject({
    label: '처음 쓰는 제목',
    detail: '링크만 추가 · 열 때 생성',
  });
  expect(JSON.stringify(workspace)).toBe(snapshot);
});

test('the visibility setting hides suggested missing links but still permits typing new links', () => {
  const hidden = { ...workspace, settings: { ...workspace.settings, showUnresolvedLinks: false } };
  expect(completions('[[', hidden)?.options.map((item) => item.label)).toEqual(['생각', '생각 정리']);
  expect(completions('[[새 제목', hidden)?.options[0].label).toBe('새 제목');
});

test('an open result filters in place while typing, composing Korean and deleting', () => {
  let result = completions('[[')!;
  for (const input of ['[[생', '[[생각', '[[생각 정', '[[생각', '[[']) {
    const s = state(input);
    result = result.update!(result, 2, s.doc.length, new CompletionContext(s, s.doc.length, false))!;
    expect(result).not.toBeNull();
    const search = input.slice(2);
    expect(result.options.every((option) => option.label.includes(search))).toBe(true);
    if (search) expect(result.options[0].detail).toBe('노트');
  }
  const alias = state('[[생각|');
  expect(
    result.update!(result, 2, alias.doc.length, new CompletionContext(alias, alias.doc.length, false)),
  ).toBeNull();
});

test('Korean jamo and partially composed syllables still find matching note names', () => {
  for (const input of ['[[ㅅ', '[[새', '[[생'])
    expect(
      completions(input)
        ?.options.filter((option) => option.detail === '노트')
        .map((option) => option.label),
    ).toEqual(['생각', '생각 정리']);
});

test('marked IME text remains searchable until composition finishes', () => {
  let composing = true;
  const marked = state('[[생').update({ selection: { anchor: 2, head: 3 } }).state;
  let result = wikiCompletions(new CompletionContext(marked, 3, false), workspace, () => composing)!;
  expect(result.options[0].label).toBe('생각');
  const collapsed = marked.update({ selection: { anchor: 3 } }).state;
  result = result.update!(result, 2, 3, new CompletionContext(collapsed, 3, false))!;
  expect(result.options[0].label).toBe('생각');
  composing = false;
  expect(result.update!(result, 2, 3, new CompletionContext(marked, 3, false))).toBeNull();
});

test('completion does not open in code, escaped brackets, aliases or after closed links', () => {
  for (const doc of [
    '`[[생각`',
    '```md\n[[생각',
    '    [[생각',
    '\\[[생각',
    '[[생각|별칭',
    '[[생각#^block',
    '[[생각]]',
    'ordinary',
  ]) {
    expect(completions(doc), doc).toBeNull();
  }
  expect(completions('\\\\[[생각')).not.toBeNull();
});

test('accepting a completion closes brackets once, preserves aliases and places the caret after the link', () => {
  for (const [doc, cursor, expected] of [
    ['[[생', 3, '[[생각]]'],
    ['[[생]] 이후', 3, '[[생각]] 이후'],
    ['[[생] 이후', 3, '[[생각]] 이후'],
    ['[[생|foo | bar]]', 3, '[[생각|foo | bar]]'],
    ['[[생#^detail|별칭]] 이후', 3, '[[생각#^detail|별칭]] 이후'],
  ] as const) {
    const s = state(doc, cursor);
    const next = s.update(wikiCompletionEdit(s, 2, cursor, '생각')).state;
    expect(next.doc.toString()).toBe(expected);
    expect(next.selection.main.head).toBe(expected.indexOf(']]') + 2);
  }
});

test('duplicate and reserved titles insert unambiguous IDs while preserving user aliases', () => {
  const duplicate = {
    ...workspace,
    notes: [
      { ...workspace.notes[0], title: 'Same' },
      { ...workspace.notes[1], title: 'Same' },
    ],
  };
  const options = completions('[[Same', duplicate)!.options;
  expect(options).toHaveLength(2);
  expect(options[0].detail).not.toBe(options[1].detail);
  const s = state('[[Sa|custom]]', 4);
  expect(s.update(wikiCompletionEdit(s, 2, 4, 'one', 'Same')).state.doc.toString()).toBe('[[one|custom]]');
  const fresh = state('[[Sa');
  expect(fresh.update(wikiCompletionEdit(fresh, 2, 4, 'one', 'Same')).state.doc.toString()).toBe(
    '[[one|Same]]',
  );
});

test('large-vault completion bounds title resolution work to the visible result limit', () => {
  let titleReads = 0;
  const notes = Array.from({ length: 1000 }, (_, index) => ({
    id: `note-${index}`,
    get title() {
      titleReads++;
      return `Note ${String(index).padStart(4, '0')}`;
    },
  }));
  const result = completions('[[', { ...workspace, notes, links: [] } as unknown as Workspace)!;
  expect(result.options).toHaveLength(100);
  // Avoid a flaky wall-clock threshold while catching whole-vault quadratic scans.
  expect(titleReads).toBeLessThan(300_000);
});

test('a duplicate outside the visible result limit still requires an unambiguous ID', () => {
  const notes = [
    ...Array.from({ length: 99 }, (_, index) => ({
      id: `note-${index}`,
      title: `A ${String(index).padStart(2, '0')}`,
    })),
    { id: 'duplicate-first', title: 'Z duplicate' },
    { id: 'duplicate-last', title: 'Z duplicate' },
  ];
  const result = completions('[[', { ...workspace, notes, links: [] } as unknown as Workspace)!;
  expect(result.options).toHaveLength(100);
  const last = result.options[99];
  expect(last.detail).toBe('Vault · duplicat');
  let inserted = '';
  const before = state('[[');
  (last.apply as Function)(
    {
      state: before,
      dispatch: (transaction: any) => {
        inserted = before.update(transaction).state.doc.toString();
      },
    },
    last,
    2,
    2,
  );
  expect(inserted).toBe('[[duplicate-first|Z duplicate]]');
});
