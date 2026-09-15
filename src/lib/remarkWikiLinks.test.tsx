import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { expect, test } from 'vitest';
import { remarkWikiLinks, wikiTarget } from './remarkWikiLinks';

test('wiki links render as links while code examples remain literal', () => {
  const html = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkWikiLinks]}>
      {'[[Target|Read]]\n\n`[[Target]]`\n\n```md\n[[Target]]\n```'}
    </ReactMarkdown>,
  );
  expect(html).toContain('href="#foltra-Target">Read</a>');
  expect(html).toContain('<code>[[Target]]</code>');
  expect(html).toContain('<code class="language-md">[[Target]]\n</code>');
  expect(html.match(/href=/g)).toHaveLength(1);
});

test('malformed user-authored link targets cannot crash the renderer', () => {
  expect(wikiTarget('#foltra-%')).toBeNull();
  expect(wikiTarget('#foltra-%ED%95%9C%EA%B8%80%23%5Eanchor')).toBe('한글');
});

test('read-mode aliases preserve their text and keep the note name as destination', () => {
  const html = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkWikiLinks]}>{'[[노트이름|foo | bar]]'}</ReactMarkdown>,
  );
  expect(html).toContain('href="#foltra-%EB%85%B8%ED%8A%B8%EC%9D%B4%EB%A6%84">foo | bar</a>');
});
