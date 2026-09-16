import { packPlugin } from './pack-plugin.mjs';
for (const id of ['calendar', 'kanban', 'editor-tools'])
  await packPlugin(`tests/fixtures/plugins/${id}`, `tests/fixtures/plugins/${id}.json`);
