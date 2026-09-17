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
  changedNotes: number;
  changedQueries: number;
  queryErrors: { noteId: string; title: string; message: string }[];
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
  const [name, setName] = useState(property.name);
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
      name: name.trim(),
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
    [property.id, name, type, options],
  );
  const renaming = proposal.name !== property.name;
  const converting = proposal.type !== property.type;
  useEffect(() => {
    let active = true;
    setPreview(null);
    setError('');
    if (!proposal.name) {
      setChecking(false);
      return;
    }
    setChecking(true);
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
  }, [vault, database.id, proposal, attempt]);
  const apply = async () => {
    if (!proposal.name || checking || !preview?.canApply || busy.current) return;
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
      <fieldset disabled={saving}>
        <label className="form-field">
          컬럼 이름
          <input
            aria-label="컬럼 이름"
            value={name}
            aria-invalid={!proposal.name}
            onChange={(event) => {
              setPreview(null);
              setName(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                void apply();
              }
            }}
          />
        </label>
        {property.id === 'title' ? (
          <p className="muted property-role-description">
            각 행의 노트를 만들거나 여는 컬럼입니다. 이름은 바꿀 수 있으며 타입은 텍스트로 유지됩니다.
          </p>
        ) : (
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
        )}
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
          <p className="muted">컬럼과 연결된 쿼리를 검사하고 있습니다…</p>
        ) : (
          preview && (
            <>
              {converting ? (
                <p>
                  {preview.rowCount}개 행 검사 · {preview.changedRows}개 값 변환
                </p>
              ) : renaming ? (
                <p>
                  {property.name} → {proposal.name}
                </p>
              ) : (
                <p>컬럼 설정을 확인했습니다.</p>
              )}
              {renaming && (
                <small>
                  {preview.changedNotes ?? 0}개 노트의 쿼리 {preview.changedQueries ?? 0}개 이름 참조 변경
                </small>
              )}
              {preview.canApply ? (
                <small>
                  {converting
                    ? '컬럼과 변환된 값을 함께 저장합니다.'
                    : renaming
                      ? '컬럼 이름과 연결된 쿼리를 함께 저장합니다. 기존 값과 본문 연결은 유지됩니다.'
                      : '컬럼 설정을 저장합니다.'}
                </small>
              ) : (
                <>
                  {preview.errorCount > 0 && (
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
                  {!!preview.queryErrors?.length && (
                    <>
                      <p className="conversion-warning">
                        아래 쿼리를 먼저 확인하세요. 안전하게 이름을 변경할 수 없어 저장하지 않습니다.
                      </p>
                      <ul>
                        {preview.queryErrors.map((item, index) => (
                          <li key={`${item.noteId}:${index}`}>
                            <strong>{item.title}</strong>
                            <span>{item.message}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
              {(type === 'select' || type === 'status') && !options.trim() && (
                <small>선택지: {preview.property.options?.join(' · ') || '없음'}</small>
              )}
            </>
          )
        )}
      </div>
      {(error || !proposal.name) && (
        <p className="inline-error" role="alert">
          {error || '컬럼 이름을 입력하세요.'}
        </p>
      )}
      {converting && (
        <p className="muted">
          숫자는 정확한 숫자 표기, 체크박스는 true/false 또는 숫자 0/1로 변환합니다. 변환할 수 없는 값은
          삭제하지 않습니다.
        </p>
      )}
      <div className="modal-actions">
        <button
          type="button"
          className="text-button"
          disabled={saving || checking || !proposal.name}
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
          disabled={saving || checking || !proposal.name || !preview?.canApply}
          onClick={() => void apply()}
        >
          {saving ? '적용 중…' : '변경 적용'}
        </button>
      </div>
    </Modal>
  );
}
