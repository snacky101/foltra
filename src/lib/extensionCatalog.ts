import noteChat from '../../examples/plugins/note-chat.json';
import anki from '../../examples/plugins/anki.json';
import calendar from '../../examples/plugins/daily-calendar.json';
import dates from '../../examples/plugins/date-mentions.json';
import gitSync from '../../examples/plugins/git-sync.json';
import { themeCatalog } from './themeCatalog';
import type { Extension } from './types';

export const extensionCatalog = [
  anki,
  calendar,
  dates,
  gitSync,
  noteChat,
  ...themeCatalog,
] as readonly Extension[];
