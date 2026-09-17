import anki from '../../examples/plugins/anki.json';
import calendar from '../../examples/plugins/daily-calendar.json';
import { themeCatalog } from './themeCatalog';
import type { Extension } from './types';

export const extensionCatalog = [anki, calendar, ...themeCatalog] as readonly Extension[];
