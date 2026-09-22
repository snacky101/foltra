/** SDK v1 executes synchronously in Foltra's bounded JavaScript interpreter. */
export interface Note {
  id: string;
  title: string;
  body: string;
  revision: string;
  createdAt: string;
  updatedAt: string;
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
}
export interface Row {
  id: string;
  databaseId: string;
  values: Record<string, string | number | boolean | null>;
  bodyNoteId: string | null;
  revision: string;
}
export interface QueryResult {
  rows: Row[];
  total: number;
  database: Database;
}
export interface EditorSnapshot {
  noteId: string;
  body: string;
  from: number;
  to: number;
  selection: string;
}
export interface ViewNode {
  type:
    | 'stack'
    | 'row'
    | 'grid'
    | 'card'
    | 'text'
    | 'heading'
    | 'button'
    | 'input'
    | 'select'
    | 'checkbox'
    | 'calendar'
    | 'note-chat'
    | 'ai-settings';
  text?: string;
  label?: string;
  value?: string;
  placeholder?: string;
  action?: string;
  payload?: unknown;
  columns?: number;
  children?: ViewNode[];
  tone?: 'muted' | 'accent' | 'danger';
  inputType?: 'text' | 'number' | 'date';
  checked?: boolean;
  disabled?: boolean;
  options?: string[];
  /** Calendar only: valid Gregorian YYYY-MM, years 0001–9999. */
  month?: string;
  /** Calendar only: local YYYY-MM-DD used to highlight today (may be outside month). */
  today?: string;
  /** Calendar only: unique real dates in month, at most 31. */
  markedDates?: string[];
  previousAction?: string;
  nextAction?: string;
  todayAction?: string;
}
export interface Action {
  id: string;
  value?: string | boolean;
  payload?: unknown;
}
/** Plain-text candidates. Only explicit acceptance edits the current token. */
export interface CompletionItem {
  /** Nonempty label, at most 120 UTF-8 bytes. */
  label: string;
  /** Literal replacement text without snippet expansion, at most 8000 UTF-8 bytes. */
  insertText: string;
  /** Optional plain-text description, at most 240 UTF-8 bytes. */
  detail?: string;
}
export interface Api {
  readonly vaultId: string;
  createId(): string;
  hash(text: string): string;
  /** Permissioned AnkiConnect v6 on loopback port 8765.
   * storeVaultImage({path, profile}) uploads a managed vault image to Anki media;
   * requires notes.read + anki.connect and a command/action context. Returns its filename. */
  anki<T = unknown>(action: string, params?: object): T;
  /** git.sync permission. status reads device-local state; configure, sync and resolve
   * queue host effects from desktop commands/actions. Configuration requires host confirmation.
   * Git work runs outside the interpreter and vault writer lock. */
  git<T = unknown>(action: 'status' | 'configure' | 'sync' | 'resolve', params?: object): T;
  /** Serialisable session state, reset on deactivation. */
  state: Record<string, unknown>;
  readonly settings: Readonly<Record<string, string | number | boolean>>;
  /** See `foltra commands` for argument and revision contracts. No nested plugin or system commands. */
  call<T = unknown>(command: string, args?: object): T;
  storage: {
    read<T = unknown>(): { value: T | null; revision: string };
    write(value: unknown, expectedRevision: string): { value: unknown; revision: string };
  };
  openView(id: string): void;
  openNote(id: string): void;
  notify(message: string): void;
  editor: { read(): EditorSnapshot; replaceSelection(text: string): void };
}
export type TreeIconName =
  | 'file-text'
  | 'folder'
  | 'table'
  | 'book-open'
  | 'notebook'
  | 'bookmark'
  | 'star'
  | 'heart'
  | 'lightbulb'
  | 'code'
  | 'calendar'
  | 'check-square'
  | 'briefcase'
  | 'graduation-cap'
  | 'music'
  | 'image'
  | 'globe'
  | 'coffee'
  | 'archive'
  | 'inbox';
export interface TreeIcons {
  note?: TreeIconName;
  folder?: TreeIconName;
  database?: TreeIconName;
  items?: Record<string, TreeIconName>;
}
export interface Plugin {
  /** Declare runtime.treeIcons:true and ui permission. Read-only; no editor snapshot or effects. At most 5000 UUID overrides. */
  treeIcons?(api: Api): TreeIcons;
  onLoad?(api: Api): void;
  onUnload?(api: Api): void;
  onEvent?(api: Api, event: { name: string; args?: Record<string, unknown> }): void;
  commands?: Record<string, (api: Api, args: Record<string, unknown>) => unknown>;
  /** Declare runtime.completions [{id, trigger}] and editor.write in the manifest.
   * Read-only desktop requests; at most 100 candidates and 256 query UTF-8 bytes.
   * No editor snapshot, UI effects, writes or AnkiConnect calls are available. */
  completions?: Record<string, (api: Api, context: { query: string }) => CompletionItem[]>;
  views?: Record<string, { render(api: Api): ViewNode; onAction?(api: Api, action: Action): unknown }>;
}
