import { useId, useRef, useState } from 'react';
import { ChevronDown, Filter } from 'lucide-react';
import type { Folder, Settings } from '../lib/types';

export function TopicFolderFilter({
  folders,
  value,
  updateSettings,
}: {
  folders: Folder[];
  value: Settings['topicFolders'];
  updateSettings: (patch: Partial<Settings>) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const panelId = useId();
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const entries = folders
    .map((folder) => {
      const names = [folder.name];
      let parent = folder.parentId ? byId.get(folder.parentId) : undefined;
      while (parent) {
        names.unshift(parent.name);
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
      return { id: folder.id, name: names.join(' / '), missing: false };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  entries.unshift({ id: '', name: '최상위 노트', missing: false });
  for (const id of new Set([...value.include, ...value.exclude])) {
    if (id && !byId.has(id)) entries.push({ id, name: `없는 폴더 (${id})`, missing: true });
  }
  const selected = value.include.length + value.exclude.length;
  const save = async (next: Settings['topicFolders']) => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      await updateSettings({ topicFolders: next });
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  const toggle = (kind: 'include' | 'exclude', id: string) =>
    void save({
      ...value,
      [kind]: value[kind].includes(id) ? value[kind].filter((item) => item !== id) : [...value[kind], id],
    });
  return (
    <div className="topic-folder-filter">
      <div className="topic-filter-summary">
        <button
          type="button"
          className="secondary-button"
          aria-label="폴더 필터"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          <Filter size={14} /> 폴더 필터
          {selected > 0 && <span className="topic-filter-count">{selected}</span>}
          <ChevronDown size={13} />
        </button>
        <span>{selected ? `포함 ${value.include.length} · 제외 ${value.exclude.length}` : '모든 폴더'}</span>
        {selected > 0 && (
          <button
            className="text-button"
            type="button"
            disabled={saving}
            onClick={() => void save({ include: [], exclude: [] })}
          >
            필터 해제
          </button>
        )}
        {saving && <span role="status">저장 중…</span>}
      </div>
      <div id={panelId} className="topic-filter-panel" hidden={!open}>
        <p>폴더를 선택하면 하위 폴더도 적용합니다. 포함을 비워두면 전체이며, 제외가 우선합니다.</p>
        <fieldset disabled={saving} aria-label="주제 모음 폴더 범위">
          <div className="topic-filter-columns" aria-hidden="true">
            <span>폴더</span>
            <span>포함</span>
            <span>제외</span>
          </div>
          <div className="topic-filter-folders">
            {entries.map((entry) => (
              <div className="topic-filter-folder" key={entry.id}>
                <span title={entry.name}>
                  {entry.name}
                  {entry.id === '' && <small>폴더에 속하지 않은 노트만</small>}
                  {entry.missing && <small>선택을 해제하면 목록에서 사라집니다.</small>}
                </span>
                {(['include', 'exclude'] as const).map((kind) => (
                  <input
                    type="checkbox"
                    key={kind}
                    aria-label={`${entry.name} ${kind === 'include' ? '포함' : '제외'}`}
                    checked={value[kind].includes(entry.id)}
                    disabled={entry.missing && !value[kind].includes(entry.id)}
                    onChange={() => toggle(kind, entry.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}
