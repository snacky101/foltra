export interface NoteSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: string;
  words?: number;
  folderId?: string | null;
}
export interface Note extends NoteSummary {
  body: string;
}
export interface Property {
  id: string;
  name: string;
  type: 'text' | 'number' | 'checkbox' | 'date' | 'select' | 'status' | 'url';
  options?: string[];
}
export interface Database {
  id: string;
  name: string;
  properties: Property[];
  createdAt: string;
}
export interface Row {
  id: string;
  databaseId: string;
  values: Record<string, string | number | boolean | null>;
  bodyNoteId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: string;
}
export interface Link {
  source: string;
  target: string | null;
  name: string;
  label: string;
  block: string | null;
  line: number;
  context: string;
}
export interface Binding {
  keys: string;
  leader: boolean;
}
export interface Settings {
  readonly shortcutVersion?: 4;
  vim: boolean;
  editorMode: 'live' | 'source' | 'read';
  lineNumbers: 'none' | 'absolute' | 'relative';
  databaseFontSize: number;
  editorFontFamily: string;
  databaseFontFamily: string;
  topicFolders: { include: string[]; exclude: string[] };
  cursorShape: 'bar' | 'block' | 'underline';
  cursorFollowVim: boolean;
  cursorBlink: 'steady' | 'blink' | 'breath';
  cursorBlinkRate: number;
  cursorAnimation: 'none' | 'smooth' | 'smear';
  slash: boolean;
  showUnresolvedLinks: boolean;
  leader: string;
  theme: string;
  keybindings: Record<string, Binding[]>;
}
export interface Query {
  databaseId: string;
  filters?: { property: string; op: string; value: unknown }[];
  sort?: string;
  descending?: boolean;
  limit?: number;
  offset?: number;
}
export interface QueryResult {
  database: Database;
  rows: Row[];
  total: number;
  offset: number;
  limit: number;
}
export type PluginAction =
  | { type: 'script' }
  | { type: 'view'; view: string }
  | { type: 'template'; title: string; body: string }
  | { type: 'query'; query: Query };
export interface Extension {
  kind: 'plugin' | 'theme';
  id: string;
  name: string;
  version: string;
  description?: string;
  commands?: { id: string; title: string; action: PluginAction; headless?: boolean; bindings?: Binding[] }[];
  runtime?: import('./pluginTypes').PluginRuntime;
  tokens?: Record<string, string>;
}
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  revision: string;
}
export interface TrashItem {
  id: string;
  revision: string;
  folderCount?: number;
  noteCount?: number;
  recordCount?: number;
  title: string;
  kind: string;
  deletedAt: string;
}
export interface Workspace {
  vault: { id: string; name: string; formatVersion: number };
  path: string;
  notes: NoteSummary[];
  folders: Folder[];
  trash: TrashItem[];
  databases: Database[];
  records: Row[];
  links: Link[];
  settings: Settings;
  extensions: Extension[];
  pluginStates?: import('./pluginTypes').PluginStatus[];
  topicOrderRevision?: string;
}
export interface Topic {
  id: string;
  title: string;
  noteId: string | null;
  blockCount: number;
  noteCount: number;
}
export interface TopicBlock {
  id: string;
  noteId: string;
  noteTitle: string;
  revision: string;
  createdAt: string;
  updatedAt: string;
  line: number;
  endLine: number;
  body: string;
}
export interface TopicBlocks {
  topic: Topic | null;
  blocks: TopicBlock[];
  total: number;
  offset: number;
  limit: number;
  sort: TopicSort;
  orderRevision: string;
}
export type TopicSort = 'newest' | 'oldest' | 'custom';
export type View =
  'notes' | 'all-notes' | 'database' | 'graph' | 'timeline' | 'topics' | 'settings' | 'trash' | 'plugin';
export interface CoreCommand {
  id: string;
  title: string;
  readOnly: boolean;
  headless: boolean;
  argsSchema: { required: string[]; properties: Record<string, { type: string }> };
}
