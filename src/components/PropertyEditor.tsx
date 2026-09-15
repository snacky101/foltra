import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Select } from './Select';
import { call, CoreError } from '../lib/api';
import type { Database, Property } from '../lib/types';

interface Preview {
  revision: string;
  property: Property;
  rowCount: number;
  changedRows: number;
  errorCount: number;
  errors: { rowId: string; title: string | null; value: string }[];
  canApply: boolean;
}
export function PropertyEditor({
  vault,
  database,
  property,
  close,
  refresh,
}: {
  vault: string;
  database: Database;
  property: Property;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [type, setType] = useState(property.type);
  const [options, setOptions] = useState(property.options?.join('\n') ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const dismiss = useCallback(() => {
    if (!busy.current) close();
  }, [close]);
  const proposal = useMemo<Property>(
    () => ({
      id: property.id,
      name: property.name,
      type,
      ...((type === 'select' || type === 'status') && options.trim()
        ? {
            options: options
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
          }
        : {}),
    }),
    [property.id, property.name, type, options],
  );
  useEffect(() => {
    if (property.id === 'title') return;
    let active = true;
    setChecking(true);
    setPreview(null);
    setError('');
    const timer = setTimeout(() => {
      void call<Preview>(vault, 'database.property.preview', { databaseId: database.id, property: proposal })
        .then((value) => {
          if (active) setPreview(value);
        })
        .catch((e) => {
          if (active) setError((e as Error).message);
        })
        .finally(() => {
          if (active) setChecking(false);
        });
    }, 160);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [vault, database.id, proposal, attempt, property.id]);
  const apply = async () => {
    if (!preview?.canApply || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      await call(vault, 'database.property.update', {
        databaseId: database.id,
        property: proposal,
        expectedRevision: preview.revision,
      });
      await refresh();
      close();
    } catch (e) {
      setError(
        e instanceof CoreError && e.code === 'conflict'
          ? '검사 이후 데이터가 변경되었습니다. 다시 검사한 결과를 확인한 뒤 적용하세요.'
          : (e as Error).message,
      );
      setPreview(null);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal title={`${property.name} 컬럼`} close={dismiss} className="property-editor">
      {property.id === 'title' ? (
        <p className="muted">
          행 이름 컬럼은 텍스트로 유지됩니다. 본문은 이름 셀 옆의 열기 버튼으로 열 수 있습니다.
        </p>
      ) : (
        <>
          <fieldset disabled={saving}>
            <label className="form-field">
              컬럼 타입
              <Select
                aria-label="컬럼 타입"
                value={type}
                onValueChange={(value) => {
                  setPreview(null);
                  setType(value as Property['type']);
                }}
              >
                {[
                  ['text', '텍스트'],
                  ['number', '숫자'],
                  ['checkbox', '체크박스'],
                  ['date', '날짜'],
                  ['select', '선택'],
                  ['status', '상태'],
                  ['url', 'URL'],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            {(type === 'select' || type === 'status') && (
              <label className="form-field">
                선택지 · 한 줄에 하나
                <textarea
                  aria-label="컬럼 선택지"
                  rows={4}
                  value={options}
                  onChange={(e) => {
                    setPreview(null);
                    setOptions(e.target.value);
                  }}
                  placeholder="비워 두면 기존 값에서 자동으로 만듭니다."
                />
              </label>
            )}
          </fieldset>
          <div className="property-conversion-summary" aria-live="polite">
            {checking ? (
              <p className="muted">기존 값을 검사하고 있습니다…</p>
            ) : (
              preview && (
                <>
                  <p>
                    {preview.rowCount}개 행 검사 · {preview.changedRows}개 값 변환
                  </p>
                  {preview.canApply ? (
                    <small>컬럼과 변환된 값을 함께 저장합니다.</small>
                  ) : (
                    <>
                      <p className="conversion-warning">
                        {preview.errorCount}개 값을 변환할 수 없습니다. 아래 값을 먼저 수정하세요.
                      </p>
                      <ul>
                        {preview.errors.map((item) => (
                          <li key={item.rowId}>
                            <strong>{item.title || item.rowId}</strong>
                            <code>{item.value}</code>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {(type === 'select' || type === 'status') && !options.trim() && (
                    <small>선택지: {preview.property.options?.join(' · ') || '없음'}</small>
                  )}
                </>
              )
            )}
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <p className="muted">
            숫자는 정확한 숫자 표기, 체크박스는 true/false 또는 숫자 0/1로 변환합니다. 변환할 수 없는 값은
            삭제하지 않습니다.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="text-button"
              disabled={saving || checking}
              onClick={() => setAttempt((v) => v + 1)}
            >
              다시 검사
            </button>
            <button type="button" className="secondary-button" disabled={saving} onClick={dismiss}>
              취소
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={saving || checking || !preview?.canApply}
              onClick={() => void apply()}
            >
              {saving ? '적용 중…' : '변경 적용'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
