export type PluginPermission =
  | 'notes.read'
  | 'notes.write'
  | 'databases.read'
  | 'databases.write'
  | 'editor.read'
  | 'editor.write'
  | 'ui'
  | 'anki.connect'
  | 'automation';
export interface PluginRuntime {
  apiVersion: 1;
  backgroundCommand?: string;
  source: string;
  permissions: PluginPermission[];
  views?: { id: string; title: string; placement?: 'main' | 'right-sidebar' }[];
  settingsView?: string;
  events?: ('workspace.changed' | 'note.opened')[];
  settings?: {
    id: string;
    label: string;
    type: 'text' | 'number' | 'checkbox' | 'select';
    default: string | number | boolean;
    options?: string[];
  }[];
}
export interface PluginStatus {
  id: string;
  digest: string;
  enabled: boolean;
  dataRevision?: string;
}
export interface PluginEditorSnapshot {
  noteId: string;
  body: string;
  from: number;
  to: number;
  selection: string;
}
export interface PluginNode {
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
    | 'calendar';
  text?: string;
  label?: string;
  value?: string;
  placeholder?: string;
  action?: string;
  payload?: unknown;
  columns?: number;
  children?: PluginNode[];
  tone?: 'muted' | 'accent' | 'danger';
  inputType?: 'text' | 'number' | 'date';
  checked?: boolean;
  disabled?: boolean;
  options?: string[];
  month?: string;
  today?: string;
  markedDates?: string[];
  previousAction?: string;
  nextAction?: string;
  todayAction?: string;
}
export interface PluginEvent {
  type: 'load' | 'unload' | 'command' | 'render' | 'action' | 'event';
  id?: string;
  name?: string;
  action?: { id: string; value?: string | boolean; payload?: unknown };
  args?: Record<string, unknown>;
}
export interface PluginResponse {
  result: unknown;
  state: Record<string, unknown>;
  view: PluginNode | null;
  effects: {
    type: 'openView' | 'openNote' | 'notify' | 'editor.replaceSelection';
    args: { id?: string; message?: string; text?: string };
  }[];
  changed: boolean;
}
export type PluginSettingsInvoke = (
  pluginId: string,
  event: PluginEvent & { type: 'render' | 'action' },
) => Promise<PluginResponse | null>;
export const pluginPermissionLabels: Record<PluginPermission, string> = {
  'notes.read': '노트·링크 읽기',
  'notes.write': '노트·폴더 생성, 수정, 삭제',
  'databases.read': '데이터베이스 읽기',
  'databases.write': '데이터베이스·행 생성, 수정, 삭제',
  'editor.read': '현재 편집 내용·선택 읽기',
  'editor.write': '현재 선택 영역 편집',
  ui: '플러그인 화면·노트 열기, 알림 표시',
  'anki.connect': '이 기기의 AnkiConnect로 카드 읽기·생성·수정',
  automation: '노트·DB 변경 후 백그라운드 명령 실행',
};
