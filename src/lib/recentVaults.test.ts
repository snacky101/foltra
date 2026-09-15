import { expect, test } from 'vitest';
import { readRecentVaults, rememberVault } from './recentVaults';

test('reopening or renaming a vault updates a unique entry and retains other vaults', () => {
  const list = [
    { path: '/a', name: 'A' },
    { path: '/b', name: 'B' },
  ];
  expect(rememberVault(list, { path: '/b', name: 'Renamed' })).toEqual([
    { path: '/b', name: 'Renamed' },
    { path: '/a', name: 'A' },
  ]);
  expect(rememberVault(list, list[0])).toBe(list);
});
test('corrupt or older browser storage does not break vault selection', () => {
  expect(readRecentVaults('{')).toEqual([]);
  expect(readRecentVaults('{"path":"/a"}')).toEqual([]);
  expect(readRecentVaults('[null,{"path":42},{"path":"/a","name":"A"}]')).toEqual([
    { path: '/a', name: 'A' },
  ]);
});
