import anki from '../../examples/plugins/anki.json';
import calendar from '../../examples/plugins/daily-calendar.json';
import dates from '../../examples/plugins/date-mentions.json';
import { themeCatalog } from './themeCatalog';
import type { Extension } from './types';

export const extensionCatalog = [anki, calendar, dates, ...themeCatalog] as readonly Extension[];
