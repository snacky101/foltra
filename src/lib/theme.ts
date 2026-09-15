import type { Workspace } from './types';
const tokenNames = ['paper', 'panel', 'ink', 'muted', 'line', 'accent', 'sidebar', 'sidebar-ink'];
export function applyTheme(workspace: Workspace) {
  const root = document.documentElement;
  root.dataset.theme = workspace.settings.theme === 'night' ? 'night' : 'paper';
  for (const name of tokenNames) root.style.removeProperty(`--${name}`);
  const theme = workspace.extensions.find((e) => e.kind === 'theme' && e.id === workspace.settings.theme);
  for (const [name, value] of Object.entries(theme?.tokens ?? {})) {
    // Revalidate at the rendering boundary; vault files can be edited outside the app.
    if (tokenNames.includes(name) && /^#[0-9a-f]{6}$/i.test(value))
      root.style.setProperty(`--${name}`, value);
  }
}
