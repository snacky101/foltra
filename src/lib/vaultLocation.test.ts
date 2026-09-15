import { expect, test } from 'vitest';
import { parentDirectory, suggestedVaultPath } from './vaultLocation';

test('new vault names become siblings of the previous vault', () => {
  const base = parentDirectory('/Users/me/Notes/Personal/');
  expect(suggestedVaultPath(base, '업무')).toBe('/Users/me/Notes/업무');
  expect(suggestedVaultPath(base, '개인 기록')).toBe('/Users/me/Notes/개인 기록');
  expect(suggestedVaultPath('/Volumes/Archive/', '업무')).toBe('/Volumes/Archive/업무');
  expect(suggestedVaultPath('', '업무')).toBe('');
});

test('root, Windows drive and UNC parents keep their separators', () => {
  expect(suggestedVaultPath(parentDirectory('/Personal'), 'Work')).toBe('/Work');
  expect(suggestedVaultPath(parentDirectory('C:\\Notes\\Personal'), 'Work')).toBe('C:\\Notes\\Work');
  expect(suggestedVaultPath(parentDirectory('C:\\Personal'), 'Work')).toBe('C:\\Work');
  expect(suggestedVaultPath(parentDirectory('\\\\server\\share\\Personal'), 'Work')).toBe(
    '\\\\server\\share\\Work',
  );
});

test('a vault title produces one folder component without changing its parent', () => {
  expect(suggestedVaultPath('/Notes', '  나의 기록  ')).toBe('/Notes/나의 기록');
  expect(suggestedVaultPath('/Notes', '../업무/개인')).toBe('/Notes/..-업무-개인');
  expect(suggestedVaultPath('/Notes', 'A\\B:C?')).toBe('/Notes/A-B-C-');
  expect(suggestedVaultPath('/Notes', '..')).toBe('/Notes/새로운공간');
  expect(suggestedVaultPath('/Notes', '')).toBe('/Notes/새로운공간');
  expect(suggestedVaultPath('/Notes', 'CON.txt')).toBe('/Notes/_CON.txt');
});
