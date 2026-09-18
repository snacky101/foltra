import { packPlugin } from './pack-plugin.mjs';
await packPlugin('examples/code/anki', 'examples/plugins/anki.json');
await packPlugin('examples/code/calendar', 'examples/plugins/daily-calendar.json');
await packPlugin('examples/code/date-mentions', 'examples/plugins/date-mentions.json');
