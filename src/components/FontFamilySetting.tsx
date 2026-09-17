import { useRef, useState } from 'react';
import { fontFamilyStack } from '../lib/fontFamily';
import { Select } from './Select';

const presets = [
  { value: '', label: '기본 글꼴' },
  { value: 'system-ui', label: '시스템' },
  { value: 'sans-serif', label: '고딕' },
  { value: 'serif', label: '명조' },
  { value: 'monospace', label: '고정폭' },
];

export function FontFamilySetting({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (family: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const custom = draft !== null || !presets.some((preset) => preset.value === value);
  const save = async (family: string) => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      if (await onChange(family)) setDraft(null);
      else setError('글꼴을 저장하지 못했습니다. 다시 시도하세요.');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  const apply = () => {
    const name = (draft ?? value).trim();
    if (!name) {
      setError('설치된 글꼴 이름을 입력하세요.');
      return;
    }
    void save(name);
  };
  return (
    <div className="font-family-setting">
      <div className="setting-row">
        <span>
          <strong>글꼴</strong>
          <small>이 기기에 설치된 글꼴을 이름으로 지정할 수 있습니다.</small>
        </span>
        <Select
          aria-label={`${label} 글꼴`}
          value={custom ? 'custom' : value}
          disabled={saving}
          onValueChange={(family) => {
            if (family === 'custom') {
              setDraft(
                (current) => current ?? (presets.some((preset) => preset.value === value) ? '' : value),
              );
              setError('');
            } else void save(family);
          }}
        >
          {presets.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
          <option value="custom">직접 입력</option>
        </Select>
      </div>
      {custom && (
        <div className="font-family-custom">
          <label>
            <span>설치된 글꼴 이름</span>
            <input
              aria-label={`${label} 글꼴 이름`}
              placeholder="예: Pretendard"
              value={draft ?? value}
              maxLength={100}
              disabled={saving}
              onChange={(event) => {
                setDraft(event.target.value);
                setError('');
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229
                ) {
                  event.preventDefault();
                  apply();
                }
              }}
            />
          </label>
          <button type="button" className="secondary-button" disabled={saving} onClick={apply}>
            적용
          </button>
        </div>
      )}
      <div
        className="font-family-preview"
        aria-label={`${label} 글꼴 미리보기`}
        style={{ fontFamily: fontFamilyStack(value) ?? 'var(--body-font)' }}
      >
        생각을 기록하는 공간 · Foltra · 0123456789
      </div>
      <p className="font-family-hint">해당 글꼴이나 글자가 없으면 기본 글꼴로 표시합니다.</p>
      {error && (
        <p className="font-family-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
