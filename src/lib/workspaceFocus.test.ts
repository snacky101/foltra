import { expect, it } from 'vitest';
import { nextFocusRegion } from './workspaceFocus';

it('moves between content panes without entering the editor toolbar', () => {
  expect(nextFocusRegion('main', 'left')).toBe('sidebar-tree');
  expect(nextFocusRegion('sidebar-tree', 'right')).toBe('main');
  expect(nextFocusRegion('main', 'right')).toBe('backlinks');
  expect(nextFocusRegion('backlinks', 'left')).toBe('main');
  expect(nextFocusRegion('sidebar-navigation', 'down')).toBe('sidebar-tree');
  expect(nextFocusRegion('sidebar-tree', 'down')).toBe('sidebar-footer');
  expect(nextFocusRegion('sidebar-footer', 'up')).toBe('sidebar-tree');
  expect(nextFocusRegion('main', 'up')).toBeNull();
  expect(nextFocusRegion('main', 'down')).toBeNull();
  expect(nextFocusRegion('main-toolbar', 'down')).toBe('main');
  expect(nextFocusRegion('sidebar-navigation', 'up')).toBeNull();
  expect(nextFocusRegion('backlinks', 'right')).toBeNull();
  expect(nextFocusRegion('settings-navigation', 'right')).toBe('main');
  expect(nextFocusRegion('settings-navigation', 'left')).toBeNull();
});
