import { expect, test } from 'vitest';
import { noteLinks } from './noteLinks';
import type { Link, NoteSummary } from './types';

const note = (id: string): NoteSummary => ({
  id,
  title: '같은 제목',
  createdAt: '',
  updatedAt: '',
  revision: '',
});
const link = (source: string, target: string | null, label = '같은 제목'): Link => ({
  source,
  target,
  name: target ?? label,
  label,
  block: null,
  line: source === 'row' ? 0 : 1,
  context: label,
});

test('database body ownership does not appear as a note link or inflate its count', () => {
  const ownership = link('row', 'body', 'Record body');
  const outgoing = link('body', 'other');
  const links = [ownership, outgoing];
  expect(noteLinks({ notes: [note('body'), note('other')], links })).toEqual([outgoing]);
  expect(noteLinks({ notes: [note('body')], links: [ownership] })).toEqual([]);
  expect(links).toEqual([ownership, outgoing]);
});

test('explicit backlinks, self-links, aliases, unresolved and record targets remain visible', () => {
  const links = [
    link('other', 'body'),
    link('body', 'body', '직접 작성한 자기 링크'),
    link('other', 'body', 'Record body'),
    link('body', null, '없는 노트'),
    link('body', 'row', '데이터베이스 행 링크'),
  ];
  expect(noteLinks({ notes: [note('body'), note('other')], links })).toEqual(links);
});
