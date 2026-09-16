import anki from '../../examples/plugins/anki.json';
import { themeCatalog } from './themeCatalog';
import type { Extension } from './types';

export const extensionCatalog = [anki, ...themeCatalog] as readonly Extension[];
