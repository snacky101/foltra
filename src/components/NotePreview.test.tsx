import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { NotePreview } from './NotePreview';
import type { Workspace } from '../lib/types';

test.each([
  ['Before\n- aaaa\n- bbb\n- ccc\n안녕', '</ul>\n<p>안녕</p>'],
  ['Before\n1. First\n2. Second\n안녕', '</ol>\n<p>안녕</p>'],
  ['- Parent\n  - Child\n안녕', '</ul>\n<p>안녕</p>'],
  ['> - Item\n> 안녕', '</ul>\n<p>안녕</p>\n</blockquote>'],
  ['- Item\n**안녕**\n- Next', '</ul>\n<p><strong>안녕</strong></p>\n<ul>'],
])('reading displays source-aligned text outside the list: %s', (body, expected) => {
  const html = renderToStaticMarkup(
    <NotePreview
      body={body}
      workspace={{ notes: [], records: [] } as unknown as Workspace}
      openNote={() => {}}
      openLink={() => {}}
    />,
  );
  expect(html).toContain(expected);
});

test('reading gives blank spacing only to the item preceded by source blank lines', () => {
  const html = renderToStaticMarkup(
    <NotePreview
      workspace={{ notes: [], records: [] } as unknown as Workspace}
      openNote={() => {}}
      openLink={() => {}}
      body={'- First\n- \n\n- Third\n  - Child\n  - Next\n\n\n- Fourth'}
    />,
  );
  expect(html.match(/--md-list-blank-lines:1/g)).toHaveLength(1);
  expect(html.match(/--md-list-blank-lines:2/g)).toHaveLength(1);
  expect(html.match(/--md-list-blank-lines:/g)).toHaveLength(2);
  expect(html).toContain('First');
  expect(html).toContain('Child');
});

test('reading preserves soft newlines in paragraphs, lists and quotes without doubling hard breaks', () => {
  const html = renderToStaticMarkup(
    <NotePreview
      workspace={{ notes: [], records: [] } as unknown as Workspace}
      openNote={() => {}}
      openLink={() => {}}
      body={
        'First\nSecond  \nThird\n\n- Item\n  continuation\n\n> Quote\n> next\n\n`inline`\n\n```text\ncode\nline\n```'
      }
    />,
  );
  expect(html).toContain('First<br/>\nSecond<br/>\nThird');
  expect(html).toContain('Item<br/>\ncontinuation');
  expect(html).toContain('Quote<br/>\nnext');
  expect(html).toContain('code\nline\n</code>');
  expect(html.match(/<br\/>/g)).toHaveLength(4);
});

test('topic card previews render query examples as code and keep untrusted content inert', () => {
  const workspace: Workspace = {
    vault: { id: 'test', name: 'Test', formatVersion: 1 },
    path: '/temporary-vault',
    notes: [],
    folders: [],
    trash: [],
    databases: [],
    records: [],
    links: [],
    extensions: [],
    settings: {
      vim: false,
      editorMode: 'live',
      slash: false,
      lineNumbers: 'none' as const,
      cursorShape: 'bar' as const,
      cursorFollowVim: true,
      cursorBlink: 'blink' as const,
      cursorBlinkRate: 600,
      cursorAnimation: 'none' as const,
      showUnresolvedLinks: true,
      leader: ' ',
      theme: 'paper',
      keybindings: {},
    },
  };
  const html = renderToStaticMarkup(
    <NotePreview
      workspace={workspace}
      openNote={() => {}}
      openLink={() => {}}
      executeQueries={false}
      body={
        '- [[Foo]]\n  ```foltra-query\n  {"databaseId":"example"}\n  ```\n\n<script>alert(1)</script>\n\n![image](https://example.com/image.png)'
      }
    />,
  );
  expect(html).toContain('language-foltra-query');
  expect(html).not.toContain('embedded-query');
  expect(html).not.toContain('<script');
  expect(html).not.toContain('<img');
  expect(html).toContain('wiki-link unresolved');
});
