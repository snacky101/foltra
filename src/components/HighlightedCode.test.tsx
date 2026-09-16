// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { expect, test } from 'vitest';
import { NotePreview } from './NotePreview';
import type { Workspace } from '../lib/types';

test('Go fences highlight safely in reading mode, preserve code verbatim and fall back for unknown languages', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await LanguageDescription.matchLanguageName(languages, 'go', false)!.load();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const code = 'package main\nfunc main() { println("<script>alert(1)</script>") }\n';
  const render = (language: string) =>
    act(async () =>
      root.render(
        <NotePreview
          body={`\`\`\`${language}\n${code}\`\`\``}
          workspace={{ notes: [], records: [], path: '/test' } as unknown as Workspace}
          openNote={() => {}}
          openLink={() => {}}
        />,
      ),
    );
  try {
    await render('go');
    expect(host.querySelector('code')?.textContent).toBe(code);
    expect(host.querySelector('.code-syntax-keyword')?.textContent).toBe('package');
    expect(host.querySelector('.code-syntax-string')?.textContent).toContain('<script>');
    expect(host.querySelector('script')).toBeNull();
    await render('unknown-language');
    expect(host.querySelector('code')?.textContent).toBe(code);
    expect(host.querySelector('code span')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
