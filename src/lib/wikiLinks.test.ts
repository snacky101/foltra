import { expect, test } from 'vitest';
import { resolveWikiNote, splitWikiLink } from './wikiLinks';
import type { NoteSummary } from './types';

test('aliases affect only the display name and preserve everything after the first pipe', () => {
  expect(splitWikiLink('노트이름')).toEqual(['노트이름', '노트이름']);
  expect(splitWikiLink('노트이름|foo')).toEqual(['노트이름', 'foo']);
  expect(splitWikiLink('노트이름#^block|foo | bar')).toEqual(['노트이름#^block', 'foo | bar']);
});

test('legacy IDs take priority, duplicate titles are unresolved and record links keep their namespace', () => {
  const notes = [
    { id: 'first-id', title: 'Target' },
    { id: 'second-id', title: 'Target' },
    { id: 'shadow-id', title: 'first-id' },
    { id: 'record-shadow', title: 'record:row-id' },
    { id: 'unique-id', title: '노트이름' },
  ] as NoteSummary[];
  expect(resolveWikiNote(notes, 'first-id')?.id).toBe('first-id');
  expect(resolveWikiNote(notes, 'Target')).toBeUndefined();
  expect(resolveWikiNote(notes, 'record:row-id')).toBeUndefined();
  expect(resolveWikiNote(notes, '노트이름')?.id).toBe('unique-id');
});
