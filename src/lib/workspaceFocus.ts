export type FocusDirection = 'left' | 'down' | 'up' | 'right';
export type FocusRegion =
  | 'sidebar-navigation'
  | 'sidebar-tree'
  | 'sidebar-footer'
  | 'settings-navigation'
  | 'main-toolbar'
  | 'main'
  | 'backlinks';
const lastFocus = new WeakMap<HTMLElement, HTMLElement>();

export function nextFocusRegion(current: FocusRegion, direction: FocusDirection): FocusRegion | null {
  if (current === 'settings-navigation') return direction === 'right' ? 'main' : null;
  const sidebar: FocusRegion[] = ['sidebar-navigation', 'sidebar-tree', 'sidebar-footer'];
  const index = sidebar.indexOf(current);
  if (index >= 0) {
    if (direction === 'right') return 'main';
    if (direction === 'up') return sidebar[index - 1] ?? null;
    if (direction === 'down') return sidebar[index + 1] ?? null;
    return null;
  }
  if (direction === 'left') return current === 'backlinks' ? 'main' : 'sidebar-tree';
  if (direction === 'right' && current !== 'backlinks') return 'backlinks';
  if (direction === 'up' && current === 'main') return 'main-toolbar';
  if (direction === 'down' && current === 'main-toolbar') return 'main';
  return null;
}
export function rememberWorkspaceFocus(target: EventTarget) {
  if (!(target instanceof HTMLElement)) return;
  const region = target.closest<HTMLElement>('[data-focus-region]');
  if (region) lastFocus.set(region, target);
}
export function focusSidebarTree() {
  const tree = document.querySelector<HTMLElement>('[data-focus-region="sidebar-tree"]');
  if (!tree || tree.closest('[hidden], [inert]') || !tree.getClientRects().length) return;
  const items = [...tree.querySelectorAll<HTMLElement>('[data-tree-item]:not([disabled])')].filter(
    (item) => item.getClientRects().length,
  );
  const target = items.find((item) => item.classList.contains('active')) ?? items[0] ?? tree;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function focusRegion(name: FocusRegion) {
  const region = document.querySelector<HTMLElement>(`[data-focus-region="${name}"]`);
  if (!region || region.closest('[inert], [hidden]') || !region.getClientRects().length) return;
  const previous = lastFocus.get(region);
  const links =
    name === 'backlinks'
      ? [...region.querySelectorAll<HTMLElement>('[data-backlink-item]:not(:disabled)')].filter(
          (item) => item.getClientRects().length,
        )
      : null;
  if (links && !links.length) return;
  const firstVisible = (selector: string) =>
    [...region.querySelectorAll<HTMLElement>(selector)].find(
      (item) => !item.closest('[hidden], [inert]') && item.getClientRects().length,
    );
  const target =
    previous?.isConnected &&
    !previous.matches(':disabled') &&
    !previous.closest('[hidden], [inert]') &&
    previous.getClientRects().length &&
    (!links || links.includes(previous))
      ? previous
      : (links?.[0] ??
        firstVisible(
          '.cm-content[contenteditable="true"], [data-sidebar-item].active, [data-settings-group].active',
        ) ??
        firstVisible('[data-tree-item]:not([disabled])') ??
        firstVisible(
          '[data-sidebar-item]:not([disabled]), button:not([disabled]), input:not([disabled]), [tabindex="0"]',
        ) ??
        region);
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
export function moveWorkspaceFocus(direction: FocusDirection) {
  const current = document.activeElement?.closest<HTMLElement>('[data-focus-region]')?.dataset.focusRegion as
    FocusRegion | undefined;
  const next = nextFocusRegion(current ?? 'main', direction);
  const settings = document.querySelector<HTMLElement>('[data-focus-region="settings-navigation"]');
  if (next === 'sidebar-tree' && settings && !settings.closest('[inert]')) focusRegion('settings-navigation');
  else if (next) focusRegion(next);
}
export function moveSidebarFocus(target: HTMLElement, key: string): boolean {
  const origin = target.closest<HTMLElement>('[data-focus-region]');
  const name = origin?.dataset.focusRegion ?? '';
  if (!origin || (!name.startsWith('sidebar-') && name !== 'backlinks' && name !== 'settings-navigation'))
    return false;
  const settings = name === 'settings-navigation';
  const region =
    name === 'backlinks' || settings
      ? origin
      : target.closest('.sidebar')?.querySelector<HTMLElement>('[data-focus-region="sidebar-tree"]');
  if (!region) return false;
  const selector = settings
    ? '[data-settings-group]'
    : name === 'backlinks'
      ? '[data-backlink-item]'
      : '[data-tree-item]';
  const items = [...region.querySelectorAll<HTMLButtonElement>(selector)].filter(
    (item) => !item.disabled && item.getClientRects().length,
  );
  const active =
    target.closest<HTMLButtonElement>(selector) ??
    target.closest('.note-navigation-row')?.querySelector<HTMLButtonElement>(selector);
  const focus = (item: HTMLButtonElement | undefined | null) => {
    item?.focus({ preventScroll: true });
    item?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  if (!active || !items.includes(active)) {
    focus(items[0]);
    return true;
  }
  if (key === 'l') {
    if (settings) {
      active.click();
      focusRegion('main');
      return true;
    }
    if (active.getAttribute('aria-expanded') === 'true') {
      const child = items[items.indexOf(active) + 1];
      if (child?.dataset.parentFolder === active.closest<HTMLElement>('[data-folder-id]')?.dataset.folderId)
        focus(child);
    } else active.click();
    return true;
  }
  if (key === 'h') {
    if (active.getAttribute('aria-expanded') === 'true') active.click();
    else if (active.dataset.parentFolder)
      focus(
        region.querySelector<HTMLButtonElement>(
          `[data-folder-id="${active.dataset.parentFolder}"] > [data-tree-item]`,
        ),
      );
    return true;
  }
  const next = Math.max(0, Math.min(items.length - 1, items.indexOf(active) + (key === 'j' ? 1 : -1)));
  focus(items[next]);
  if (settings) items[next]?.click();
  return true;
}
