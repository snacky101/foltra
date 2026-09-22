import type { Plugin } from '../../../packages/plugin-sdk';

export default {
  commands: { open: (api) => api.openView('chat') },
  views: {
    chat: { render: () => ({ type: 'note-chat' }) },
    provider: { render: () => ({ type: 'ai-settings' }) },
  },
} satisfies Plugin;
