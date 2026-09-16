import type { Plugin } from '../../../../packages/plugin-sdk';
export default {
  commands: {
    uppercase(api) {
      const selected = api.editor.read().selection;
      if (selected) api.editor.replaceSelection(selected.toUpperCase());
    },
    list(api) {
      const selected = api.editor.read().selection;
      if (selected)
        api.editor.replaceSelection(
          selected
            .split('\n')
            .map((line) => (line.trim() ? `- ${line.replace(/^\s*[-*+]\s+/, '')}` : line))
            .join('\n'),
        );
    },
    date(api) {
      const now = new Date();
      const separator = api.settings['date-style'] === 'YYYY/MM/DD' ? '/' : '-';
      api.editor.replaceSelection(
        [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, '0'),
          String(now.getDate()).padStart(2, '0'),
        ].join(separator),
      );
    },
  },
} satisfies Plugin;
