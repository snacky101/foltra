import type { PluginSidebarView } from '../lib/usePlugins';
import type { PluginSettingsInvoke } from '../lib/pluginTypes';
import { PluginSettingsView } from './PluginSettingsView';

export function PluginSidebarViews({
  views,
  revision,
  invoke,
  errors,
}: {
  views: PluginSidebarView[];
  revision: string;
  invoke: PluginSettingsInvoke;
  errors: Record<string, string>;
}) {
  return (
    <div className="plugin-sidebar-views">
      {views.map((view) => (
        <section key={view.key} aria-label={view.title} data-plugin-sidebar-view={view.id}>
          <PluginSettingsView
            pluginId={view.pluginId}
            viewId={view.id}
            title={view.title}
            revision={revision}
            invoke={invoke}
            error={errors[view.pluginId]}
            preserveOnError
          />
        </section>
      ))}
    </div>
  );
}
