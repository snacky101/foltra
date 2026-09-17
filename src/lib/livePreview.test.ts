import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { gutterLineClass } from '@codemirror/view';
import { expect, test } from 'vitest';
import { livePreviewDecorations, livePreviewExtension, selectionTouchesLines } from './livePreview';
import type { Workspace } from './types';

const workspace = {
  notes: [],
  records: [],
  databases: [],
  links: [],
  extensions: [],
} as unknown as Workspace;
function state(doc: string, anchor = doc.length) {
  return EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ extensions: [GFM] })] });
}
function replacements(s: EditorState, focused = true) {
  const ranges: { from: number; to: number; block: boolean }[] = [];
  livePreviewDecorations(s, { workspace, openNote: () => {}, openLink: () => {} }, focused).between(
    0,
    s.doc.length,
    (from, to, value) => {
      if (from < to && value.spec.class === undefined) ranges.push({ from, to, block: !!value.spec.block });
    },
  );
  return ranges;
}
test('local images preview outside the edited line while code and unsafe image paths remain text', () => {
  const image = `![그림](../attachments/${'a'.repeat(64)}.png)`;
  const s = state(`${image}\n\nEditing`);
  expect(replacements(s)).toContainEqual({ from: 0, to: image.length, block: false });
  expect(replacements(s.update({ selection: { anchor: 5 } }).state)).toEqual([]);
  expect(replacements(state('![remote](https://example.com/image.png)\n\nEditing'))).toEqual([]);
  expect(
    replacements(state('`' + image + '`\n\nEditing')).some((r) => r.from === 1 && r.to === 1 + image.length),
  ).toBe(false);
});
test('leaving the editor restores the selected line to preview without changing selection', () => {
  const s = state('**First**\n\n**Second**', 3);
  expect(replacements(s, true).some((r) => r.from === 0)).toBe(false);
  expect(replacements(s, false).some((r) => r.from === 0)).toBe(true);
  expect(s.selection.main.head).toBe(3);
});
test('a selection ending at the next line start does not expose the unselected line', () => {
  const s = state('**First**\n**Second**');
  const selected = s.update({ selection: EditorSelection.range(0, s.doc.line(2).from) }).state;
  expect(selectionTouchesLines(selected, s.doc.line(1).from, s.doc.line(1).to)).toBe(true);
  expect(selectionTouchesLines(selected, s.doc.line(2).from, s.doc.line(2).to)).toBe(false);
});
test('live preview hides inactive Markdown syntax without modifying the document', () => {
  const doc = '# Header\n\n**bold** and `code`\n\nEditing';
  const s = state(doc);
  expect(replacements(s).length).toBeGreaterThanOrEqual(5);
  expect(s.doc.toString()).toBe(doc);
  const active = s.update({ selection: { anchor: 3 } }).state;
  expect(replacements(active).some((r) => r.from === 0)).toBe(false);
});
test.each(['foltra-query', 'foltra-sql'])(
  '%s block previews reveal their original source when selected',
  (language) => {
    const doc = `Before\n\n\`\`\`${language}\nSELECT * FROM "Projects";\n\`\`\`\n\nAfter`;
    const s = state(doc);
    const block = replacements(s).find((r) => r.block)!;
    expect(block).toBeDefined();
    expect(replacements(s.update({ selection: { anchor: block.from + 4 } }).state).some((r) => r.block)).toBe(
      false,
    );
    expect(s.doc.toString()).toBe(doc);
  },
);
test('multiline selections expose syntax rather than concealing selected text', () => {
  const s = state('# Header\n\n**bold**\n\nEnd');
  const selected = s.update({ selection: EditorSelection.range(0, s.doc.length) }).state;
  expect(replacements(selected)).toEqual([]);
});

test('wiki labels replace both bracket pairs and UUIDs outside the active line', () => {
  const text = '[[4fb36615-31ce-43ef-b775-30c5295f190b|연결된 노트]]에서 이어갑니다.\n\nEdit';
  const s = state(text);
  expect(replacements(s)).toContainEqual({ from: 0, to: text.indexOf(']]') + 2, block: false });
  expect(replacements(s.update({ selection: { anchor: 5 } }).state)).toEqual([]);
});

test('title-based live links show the custom alias while retaining the actual target', () => {
  const text = '[[노트이름|foo | bar]]\n\nEdit';
  const s = state(text);
  const links: { target: string; label: string }[] = [];
  livePreviewDecorations(s, { workspace, openNote: () => {}, openLink: () => {} }).between(
    0,
    s.doc.length,
    (_from, _to, value) => {
      if (value.spec.widget?.wiki) links.push(value.spec.widget);
    },
  );
  expect(links).toHaveLength(1);
  expect(links[0].target).toBe('노트이름');
  expect(links[0].label).toBe('foo | bar');
  expect(s.doc.toString()).toBe(text);
});

test('escaped wiki examples stay editable text instead of actionable previews', () => {
  expect(replacements(state('\\[[Foo]]\n\nEdit'))).toEqual([]);
});

function collapsedLines(s: EditorState, focused = true) {
  const lines: number[] = [];
  livePreviewDecorations(s, { workspace, openNote: () => {}, openLink: () => {} }, focused).between(
    0,
    s.doc.length,
    (from, _to, value) => {
      if (value.spec.class === 'cm-live-hidden-separator') lines.push(s.doc.lineAt(from).number);
    },
  );
  return lines;
}

test('blank block separators keep the same layout across cursor and focus changes', () => {
  const s = state('# Heading\n\nParagraph\n\nEnd');
  const gaps = (s: EditorState, focused = true) => {
    const result: unknown[] = [];
    livePreviewDecorations(s, { workspace, openNote: () => {}, openLink: () => {} }, focused).between(
      0,
      s.doc.length,
      (from, to, value) => {
        if (value.spec.class === 'cm-live-separator' || value.spec.widget?.height)
          result.push({ from, to, className: value.spec.class, height: value.spec.widget?.height });
      },
    );
    return result;
  };
  expect(collapsedLines(s)).toEqual([]);
  const editing = s.update({ selection: { anchor: s.doc.line(2).from } }).state;
  expect(gaps(editing)).toEqual(gaps(s));
  expect(gaps(editing, false)).toEqual(gaps(s));
  const typed = editing.update({
    changes: { from: editing.selection.main.head, insert: 'New paragraph' },
  }).state;
  expect(typed.doc.line(2).text).toBe('New paragraph');
  expect(typed.doc.lines).toBe(s.doc.lines);
});

test('the trailing block margin stays after the final editable line', () => {
  for (const doc of ['Paragraph\n', 'Paragraph\n\n', '- Item\n\n', 'Paragraph\n\na']) {
    const s = state(doc);
    const ends: number[] = [];
    livePreviewDecorations(s, { workspace, openNote() {}, openLink() {} }).between(
      0,
      s.doc.length,
      (from, _to, value) => {
        if (value.spec.block && value.spec.side === 1 && value.spec.widget?.height) ends.push(from);
      },
    );
    expect(ends).toEqual([doc.length]);
  }
});

test('setext underline remains editable with the heading and collapses when inactive', () => {
  const s = state('Heading\n=======\n\nEnd');
  expect(collapsedLines(s)).toEqual([2]);
  const editing = s.update({ selection: { anchor: 2 } }).state;
  expect(collapsedLines(editing)).toEqual([]);
  expect(editing.doc.toString()).toBe(s.doc.toString());
});

test('selected blank lines are exposed across multiline selections', () => {
  const s = state('# Heading\n\nParagraph\n\nEnd');
  const selected = s.update({ selection: EditorSelection.range(0, s.doc.length) }).state;
  expect(collapsedLines(selected)).toEqual([]);
});

function bulletMarkers(s: EditorState, focused = true) {
  const markers: string[] = [];
  livePreviewDecorations(s, { workspace, openNote: () => {}, openLink: () => {} }, focused).between(
    0,
    s.doc.length,
    (from, to, value) => {
      if (value.spec.widget?.bullet) markers.push(s.doc.sliceString(from, to).trim());
    },
  );
  return markers;
}

test('inactive unordered markers render as bullets without changing source or nesting', () => {
  const doc = '- Parent\n  - Child\n\n* Star\n\n+ Plus\n\n1. Numbered\n\nEnd';
  const s = state(doc);
  expect(bulletMarkers(s)).toEqual(['-', '-', '*', '+']);
  expect(s.doc.toString()).toBe(doc);
});

test('bullets remain dots while editing, including an empty new item and nested items', () => {
  const s = state('- Parent\n  - Child\n- Sibling', 3);
  expect(bulletMarkers(s)).toEqual(['-', '-', '-']);
  expect(bulletMarkers(s, false)).toEqual(['-', '-', '-']);
  const selected = s.update({ selection: EditorSelection.range(0, s.doc.length) }).state;
  expect(bulletMarkers(selected)).toEqual(['-', '-', '-']);
  expect(bulletMarkers(state('- '))).toEqual(['-']);
});

test('hyphens in code, rules and ordinary text are not rendered as bullets', () => {
  const s = state('Text - text\n\n---\n\n```md\n- Code\n```\n\n    - Indented code\n\nEnd');
  expect(bulletMarkers(s)).toEqual([]);
});

test.each([
  ['- aa\n- dddd\n- adkjadksljsdlkf\nads', [1, 2, 3]],
  ['- Parent\n  continuation\nplain', [1, 2]],
  ['12. Item\n    continuation\nplain', [1, 2]],
  ['> - Quoted\n>   continuation\n> plain', [1, 2]],
])('plain source lines after a list do not acquire preview indentation: %s', (doc, expected) => {
  const s = state(doc as string);
  const indented: number[] = [];
  livePreviewDecorations(s, { workspace, openNote() {}, openLink() {} }).between(
    0,
    s.doc.length,
    (from, _to, value) => {
      if (value.spec.class?.split(' ').includes('cm-live-list-line'))
        indented.push(s.doc.lineAt(from).number);
    },
  );
  expect(indented).toEqual(expected);
  expect(s.doc.toString()).toBe(doc);
});

test('continuation indentation follows explicit source depth after a nested list', () => {
  const doc = '- Parent\n  - Child\n    child continuation\n  parent continuation\nplain';
  const s = state(doc);
  const depths: Record<number, string> = {};
  livePreviewDecorations(s, { workspace, openNote() {}, openLink() {} }).between(
    0,
    s.doc.length,
    (from, _to, value) => {
      if (value.spec.class?.split(' ').includes('cm-live-list-line'))
        depths[s.doc.lineAt(from).number] = value.spec.attributes.style;
    },
  );
  expect(depths).toEqual({
    1: '--cm-list-depth:1',
    2: '--cm-list-depth:2',
    3: '--cm-list-depth:2',
    4: '--cm-list-depth:1',
  });
});

test.each([
  '- 가나다\n- 라마마\n',
  '1. 가나다\n2. 라마마\n',
  '> - 가나다\n> - 라마마\n> ',
  '- Parent\n  - Child\n',
])('empty paragraph after a list already has the same gap as its first letter: %j', (doc) => {
  const before = state(doc);
  const after = before.update(before.replaceSelection('ㅎ')).state;
  const gaps = (s: EditorState) => {
    const result: string[] = [];
    livePreviewDecorations(s, { workspace, openNote() {}, openLink() {} }).between(
      0,
      s.doc.length,
      (from, _to, value) => {
        if (from === s.doc.line(s.doc.lines).from && value.spec.block && value.spec.side === -1)
          result.push(value.spec.widget.height);
      },
    );
    return result;
  };
  expect(gaps(before)).toEqual(['max(var(--md-list-after), var(--md-paragraph-before))']);
  expect(gaps(after)).toEqual(gaps(before));
});

test.each(['Before\n- Item\nAfter', 'Before\n1. Item\nAfter', 'Before\n- Parent\n  - Child\nAfter'])(
  'list exits keep a paragraph gap without enlarging the editable row: %s',
  (doc) => {
    const s = state(doc);
    const gaps: string[] = [];
    livePreviewDecorations(s, { workspace, openNote() {}, openLink() {} }).between(
      s.doc.line(s.doc.lines).from,
      s.doc.length,
      (from, _to, value) => {
        if (from === s.doc.line(s.doc.lines).from && value.spec.block && value.spec.side === -1)
          gaps.push(value.spec.widget.height);
      },
    );
    expect(gaps).toEqual(['max(var(--md-list-after), var(--md-paragraph-before))']);
    expect(s.doc.toString()).toBe(doc);
  },
);

test.each(['- First\n- Second', '- First\n- Second\n\n- Third'])(
  'list item spacing is outside the editable text line: %s',
  (doc) => {
    const s = state(doc);
    const gaps: number[] = [];
    livePreviewDecorations(s, { workspace, openNote() {}, openLink() {} }).between(
      0,
      s.doc.length,
      (from, _to, value) => {
        expect(value.spec.class ?? '').not.toMatch(/cm-live-list-gap-/);
        if (value.spec.widget?.height?.includes('--md-list-item-gap')) {
          expect(value.spec.block).toBe(true);
          expect(value.spec.side).toBe(-1);
          expect(value.spec.widget.height).toBe('var(--md-list-item-gap)');
          gaps.push(s.doc.lineAt(from).number);
        }
      },
    );
    expect(gaps).toEqual(doc.includes('Third') ? [2, 4] : [2]);
  },
);

test.each(['- First\n- \n\n- Last', '1. First\n2. \n\n3. Last', '- Parent\n  - First\n  - \n\n  - Last'])(
  'an empty new item never inherits a blank line from another part of the list: %s',
  (doc) => {
    const s = state(doc);
    const heights: string[] = [];
    livePreviewDecorations(s, { workspace, openNote() {}, openLink() {} }).between(
      0,
      s.doc.length,
      (_from, _to, value) => {
        const height = value.spec.widget?.height;
        if (height?.includes('--md-list-item-gap')) heights.push(height);
      },
    );
    expect(heights.length).toBeGreaterThan(0);
    expect(heights.every((height) => height === 'var(--md-list-item-gap)')).toBe(true);
  },
);

test('loose-list separator heights are stable and code indentation stays literal', () => {
  const s = state('- First\n\n- Second\n\n  ```text\n    indented\n\n  ```');
  const separators: number[] = [];
  livePreviewDecorations(s, { workspace, openNote: () => {}, openLink: () => {} }).between(
    0,
    s.doc.length,
    (from, _to, value) => {
      if (value.spec.class === 'cm-live-separator') separators.push(s.doc.lineAt(from).number);
    },
  );
  expect(separators).toEqual([2, 4]);
  const editingCode = s.update({ selection: { anchor: s.doc.line(6).from + 4 } }).state;
  expect(replacements(editingCode).some((r) => r.from === s.doc.line(6).from)).toBe(false);
  expect(editingCode.doc.toString()).toBe(s.doc.toString());
});

test('preview gutter retains blank line numbers and their height while moving the cursor', () => {
  let s = EditorState.create({
    doc: '# Heading\n\nParagraph\n\n## Next',
    extensions: [
      markdown(),
      livePreviewExtension(() => ({ workspace, openNote: () => {}, openLink: () => {} }), true),
    ],
  });
  const classes = () => {
    const result: { line: number; className: string }[] = [];
    for (const set of s.facet(gutterLineClass))
      set.between(0, s.doc.length, (from, _to, marker) => {
        result.push({ line: s.doc.lineAt(from).number, className: marker.elementClass });
      });
    return result;
  };
  expect(classes()).toEqual([
    { line: 1, className: 'cm-live-gutter-h1' },
    { line: 2, className: 'cm-live-gutter-separator' },
    { line: 4, className: 'cm-live-gutter-separator' },
    { line: 5, className: 'cm-live-gutter-h2' },
  ]);
  const before = classes();
  s = s.update({ selection: { anchor: s.doc.line(2).from } }).state;
  expect(classes()).toEqual(before);
  expect(s.doc.toString()).toBe('# Heading\n\nParagraph\n\n## Next');
});

test.each([
  '```go\npackage main\n\nfunc main() {}\n```',
  '```\n\n```',
  '```unknown\nplain code',
  '> ```go\n> package main\n> ```',
  '- ```go\n  package main\n  ```',
])('code bodies remain editable lines instead of block widgets: %s', (block) => {
  const doc = `Before\n\n${block}\n\nAfter`;
  const s = state(doc);
  const styles: number[] = [];
  livePreviewDecorations(s, { workspace, openNote() {}, openLink() {} }).between(
    0,
    s.doc.length,
    (from, _to, value) => {
      if (value.spec.class?.split(' ').includes('cm-live-code-line')) styles.push(s.doc.lineAt(from).number);
    },
  );
  expect(styles.length).toBeGreaterThan(0);
  expect(replacements(s).some((r) => r.block)).toBe(false);
  const code = s.doc.line(4);
  expect(replacements(s).some((r) => r.from < code.to && r.to > code.from)).toBe(false);
  expect(s.doc.toString()).toBe(doc);
});

test('code fences reveal on keyboard selection and conceal on leaving without changing line layout', () => {
  const s = state('Before\n\n```go\npackage main\n```\n\nAfter');
  const decorations = (state: EditorState, focused = true) => {
    const styles: { line: number; className: string }[] = [];
    livePreviewDecorations(state, { workspace, openNote() {}, openLink() {} }, focused).between(
      0,
      state.doc.length,
      (from, _to, value) => {
        if (value.spec.class)
          styles.push({ line: state.doc.lineAt(from).number, className: value.spec.class });
      },
    );
    return styles;
  };
  const before = decorations(s);
  expect(before.filter((v) => v.className === 'cm-live-code-fence-hidden').map((v) => v.line)).toEqual([
    3, 5,
  ]);
  for (const line of [3, 4, 5]) {
    const inside = s.update({ selection: { anchor: s.doc.line(line).from } }).state;
    const current = decorations(inside);
    expect(current.some((v) => v.className === 'cm-live-code-fence-hidden')).toBe(false);
    expect(current.filter((v) => v.className.includes('cm-live-code-line'))).toEqual(
      before.filter((v) => v.className.includes('cm-live-code-line')),
    );
    expect(decorations(inside, false)).toEqual(before);
  }
});

test('code line numbers follow the code row height before and during editing', () => {
  const s = EditorState.create({
    doc: 'Before\n\n```go\npackage main\n```\n\nAfter',
    extensions: [markdown(), livePreviewExtension(() => ({ workspace, openNote() {}, openLink() {} }), true)],
  });
  for (const anchor of [0, s.doc.line(4).from]) {
    const moved = s.update({ selection: { anchor } }).state;
    const lines: number[] = [];
    for (const markers of moved.facet(gutterLineClass))
      markers.between(0, moved.doc.length, (from, _to, marker) => {
        if (marker.elementClass === 'cm-live-gutter-code') lines.push(moved.doc.lineAt(from).number);
      });
    expect(lines).toEqual([3, 4, 5]);
  }
});
