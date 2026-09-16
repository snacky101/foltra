import { describe, it, expect } from 'vitest';
import { noteTags } from './noteTags';
import { remarkTags } from './remarkTags';
import { remarkWikiLinks } from './remarkWikiLinks';
import ReactMarkdown from 'react-markdown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fixtures from '../../tests/fixtures/tags.json';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { livePreviewDecorations } from './livePreview';
import type { Workspace } from './types';
describe('Markdown tags', () => {
  for (const fixture of fixtures)
    it(`parses ${fixture.tags.join(',')}`, () => {
      expect(noteTags(fixture.body).map((t) => t.name)).toEqual(fixture.tags);
      const html = renderToStaticMarkup(
        createElement(ReactMarkdown, {
          remarkPlugins: [remarkTags, remarkWikiLinks],
          children: fixture.body,
        }),
      );
      const rendered = [...html.matchAll(/href="#foltra-tag:([^\"]+)"/g)].map((m) =>
        decodeURIComponent(m[1]),
      );
      expect(rendered).toEqual(fixture.tags);
    });
  it('preserves wiki-link source positions when mixed with escaped tags and literals', () => {
    const body = String.raw`\[[literal]] #anki [[Page]] \#anki #anki`;
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown, { remarkPlugins: [remarkTags, remarkWikiLinks], children: body }),
    );
    expect([...html.matchAll(/href="#foltra-tag:/g)]).toHaveLength(2);
    expect(html).toContain('href="#foltra-Page"');
    expect(html).not.toContain('href="#foltra-literal"');
  });
  it('marks completed tags without replacing editable text or changing the document', () => {
    const body = '질문 #anki 답';
    const context = {
      workspace: { notes: [], records: [], settings: {} } as unknown as Workspace,
      openNote: () => {},
      openLink: () => {},
    };
    const state = EditorState.create({
      doc: body,
      selection: { anchor: body.length },
      extensions: [markdown()],
    });
    const marks: string[] = [];
    livePreviewDecorations(state, context).between(0, body.length, (_f, _t, value) => {
      if (value.spec.class === 'tag-chip') marks.push(value.spec.attributes['data-note-tag']);
    });
    expect(marks).toEqual(['anki']);
    expect(state.doc.toString()).toBe(body);
    const editing = state.update({ selection: { anchor: 6 } }).state;
    const active: { from: number; to: number; name: string }[] = [];
    livePreviewDecorations(editing, context).between(0, body.length, (from, to, v) => {
      if (v.spec.class === 'tag-chip tag-chip-editing')
        active.push({ from, to, name: v.spec.attributes['data-note-tag'] });
    });
    expect(active).toEqual([{ from: 3, to: 8, name: 'anki' }]);
    expect(editing.doc.toString()).toBe(body);
  });
});
