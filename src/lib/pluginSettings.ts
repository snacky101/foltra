import type { Extension } from './types';

export function pluginSettingsView(extension: Extension): string | undefined {
  const runtime = extension.runtime;
  if (runtime?.settingsView) return runtime.settingsView;
  // Anki 1.0.0 shipped its settings inside the sync view, before settingsView existed.
  // Route to that installed view without replacing its code or changing its approval.
  if (
    extension.id === 'anki' &&
    extension.version === '1.0.0' &&
    runtime?.views?.some((view) => view.id === 'sync')
  )
    return 'sync';
  return undefined;
}
