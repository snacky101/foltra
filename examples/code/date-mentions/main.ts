import type { Api, Plugin } from '../../../packages/plugin-sdk';

const dates = [
  { label: 'Today', offset: 0, detail: '오늘' },
  { label: 'Yesterday', offset: -1, detail: '어제' },
  { label: 'Tomorrow', offset: 1, detail: '내일' },
];
const pad = (number: number, length = 2) => String(number).padStart(length, '0');

const plugin = {
  completions: {
    dates(_api: Api, { query }: { query: string }) {
      const today = new Date();
      return dates
        .filter(({ label }) => label.toLowerCase().startsWith(query.toLowerCase()))
        .map(({ label, offset, detail }) => {
          const date = new Date(today);
          date.setDate(today.getDate() + offset);
          return {
            label,
            insertText: `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
            detail,
          };
        });
    },
  },
} satisfies Plugin;

export default plugin;
