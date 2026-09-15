import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react';
import { CoreError } from '../lib/api';
import type { TreeEdit } from '../lib/useTreeEditing';

export function InlineTreeName({
  target,
  expanded,
  commit,
  cancel,
}: {
  target: TreeEdit;
  expanded?: boolean;
  commit: (name: string) => Promise<void>;
  cancel: () => void;
}) {
  const [name, setName] = useState(target.name);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const element = input.current;
      if (!element) return;
      element.focus();
      // Keep the beginning visible when the selected name exceeds the row width.
      element.setSelectionRange(0, element.value.length, 'backward');
      element.scrollLeft = 0;
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const restoreFocus = () =>
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          `[data-${target.kind}-id="${target.id}"] > button[data-sidebar-item]`,
        )
        ?.focus(),
    );
  const save = async (blur = false) => {
    if (busy.current || cancelled.current) return;
    if (!name.trim()) {
      if (blur) cancel();
      else setError('이름을 입력하세요.');
      return;
    }
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      await commit(name);
      if (!blur) restoreFocus();
    } catch (e) {
      setError(
        e instanceof CoreError && e.code === 'conflict'
          ? '다른 곳에서 변경되었습니다. Esc로 취소한 뒤 다시 시도하세요.'
          : e instanceof CoreError && e.code === 'folder_exists'
            ? '같은 위치에 같은 이름의 폴더가 있습니다.'
            : (e as Error).message,
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  return (
    <div className="tree-inline-editor" data-inline-rename>
      <span aria-hidden="true">
        {target.kind === 'folder' && (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
      </span>
      {target.kind === 'folder' ? <Folder size={15} /> : <FileText size={15} />}
      <input
        ref={input}
        aria-label={target.kind === 'folder' ? '폴더 이름 변경' : '노트 이름 변경'}
        value={name}
        maxLength={240}
        readOnly={saving}
        aria-invalid={!!error}
        onChange={(e) => {
          setName(e.target.value);
          setError('');
        }}
        onBlur={() => {
          if (!error) void save(true);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelled.current = true;
            cancel();
            restoreFocus();
          }
        }}
      />
      {error && (
        <small className="tree-name-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
