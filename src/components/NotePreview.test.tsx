import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { NotePreview } from './NotePreview';
import type { Workspace } from '../lib/types';

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
    settings: { vim: false, editorMode: 'live', slash: false, leader: ' ', theme: 'paper', keybindings: {} },
  };
  const html = renderToStaticMarkup(
    <NotePreview
      workspace={workspace}
      openNote={() => {}}
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
