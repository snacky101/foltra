import { useEffect, useRef, useState } from 'react';
import type { TrashItem } from '../lib/types';
import { Database, FileText, Folder, RotateCcw, Search, Table2, Trash2, type LucideIcon } from 'lucide-react';
import { call, CoreError } from '../lib/api';
import { Modal } from './Modal';

type Props = {
  vault: string;
  items: TrashItem[];
  refresh: () => Promise<void>;
  onError: (e: unknown) => void;
};
const kindNames: Record<string, string> = {
  note: '노트',
  folder: '폴더',
  database: '데이터베이스',
  record: 'DB 항목',
};
const kindIcons: Record<string, LucideIcon> = {
  note: FileText,
  folder: Folder,
  database: Database,
  record: Table2,
};

export function TrashView(props: Props) {
  return <TrashContents key={props.vault} {...props} />;
}

function TrashContents({ vault, items, refresh, onError }: Props) {
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState<{ items: TrashItem[]; all: boolean } | null>(null);
  const deletingItem = deleting && !deleting.all ? deleting.items[0] : null;
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setRemoved((current) => {
      const stillListed = new Set(items.filter((item) => current.has(item.id)).map((item) => item.id));
      return stillListed.size === current.size ? current : stillListed;
    });
  }, [items]);
  const dismiss = () => {
    if (pending.current) return;
    setDeleting(null);
    setError('');
  };
  const perform = async (targets: TrashItem[], action: 'restore' | 'delete' | 'empty') => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    let committed = false;
    try {
      await call(
        vault,
        `trash.${action}`,
        action === 'empty'
          ? { items: targets.map((item) => ({ id: item.id, expectedRevision: item.revision })) }
          : { id: targets[0].id, expectedRevision: targets[0].revision },
      );
      committed = true;
      if (!mounted.current) return;
      setRemoved((current) => new Set([...current, ...targets.map((item) => item.id)]));
      setDeleting(null);
      await refresh();
    } catch (e) {
      if (!mounted.current) return;
      if (action !== 'restore' && !committed) {
        setError(
          e instanceof CoreError && e.code === 'conflict'
            ? '휴지통 목록이나 항목이 변경되었습니다. 취소한 뒤 최신 내용을 확인하고 다시 시도하세요.'
            : (e as Error).message,
        );
      } else onError(e);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const remaining = items.filter((item) => !removed.has(item.id));
  const query = search.trim().toLocaleLowerCase();
  const filtered = remaining.filter((item) => item.title.toLocaleLowerCase().includes(query));
  return (
    <section className="page-view trash-view">
      <div className="eyebrow">NOTHING LOST ALONG THE WAY</div>
      <h1>휴지통</h1>
      <p className="page-description">삭제한 노트·폴더·데이터베이스·DB 항목을 복원하거나 영구 삭제합니다.</p>
      <div className="trash-toolbar">
        <label className="note-list-search trash-search">
          <Search size={15} />
          <input
            aria-label="휴지통 검색"
            placeholder="제목으로 찾기"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          className="secondary-button trash-delete"
          disabled={busy || !remaining.length}
          onClick={() => {
            setError('');
            setDeleting({ items: [...remaining], all: true });
          }}
        >
          <Trash2 size={14} />
          전체 영구 삭제
        </button>
      </div>
      {filtered.map((item) => {
        const KindIcon = kindIcons[item.kind] ?? FileText;
        const kindName = kindNames[item.kind] ?? item.kind;
        return (
          <div className="trash-row" key={item.id}>
            <span className="trash-kind-icon" role="img" aria-label={kindName} title={kindName}>
              <KindIcon size={19} aria-hidden="true" />
            </span>
            <span className="trash-item-name">
              <strong>{item.title}</strong>
              <small>
                {kindName} · {new Date(item.deletedAt).toLocaleString('ko-KR')}
              </small>
            </span>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void perform([item], 'restore')}
            >
              <RotateCcw size={14} />
              복원
            </button>
            <button
              className="secondary-button trash-delete"
              disabled={busy}
              onClick={() => {
                setError('');
                setDeleting({ items: [item], all: false });
              }}
            >
              영구 삭제
            </button>
          </div>
        );
      })}
      {!filtered.length && (
        <div className="empty-panel">
          {remaining.length ? <Search size={30} /> : <Trash2 size={30} />}
          <h2>{remaining.length ? '검색 결과가 없어요' : '휴지통이 비어 있어요'}</h2>
        </div>
      )}
      {deleting && (
        <Modal title={deleting.all ? '휴지통 전체 영구 삭제' : '영구 삭제'} close={dismiss}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(deleting.items, deleting.all ? 'empty' : 'delete');
            }}
          >
            {deleting.all ? (
              <>
                <p>
                  휴지통의 모든 항목 {deleting.items.length}개를 영구 삭제합니다. 검색으로 숨겨진 항목도
                  포함됩니다.
                </p>
                <p>폴더 안의 하위 폴더·노트와 데이터베이스에 함께 보관된 DB 항목도 삭제됩니다.</p>
              </>
            ) : (
              <p>
                “{deletingItem!.title}” {kindNames[deletingItem!.kind] ?? '항목'}을 영구 삭제합니다.
              </p>
            )}
            {deletingItem?.kind === 'folder' && (
              <p>
                함께 보관된 하위 폴더 {deletingItem.folderCount ?? 0}개와 노트 {deletingItem.noteCount ?? 0}
                개도 삭제됩니다.
              </p>
            )}
            {deletingItem?.kind === 'database' && (
              <p>
                함께 보관된 DB 항목 {deletingItem.recordCount ?? 0}개도 삭제됩니다. 연결된 노트는 유지됩니다.
              </p>
            )}
            {deletingItem?.kind === 'record' && <p>연결된 노트는 유지됩니다.</p>}
            <p className="muted">영구 삭제한 항목은 복원할 수 없습니다.</p>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={dismiss}>
                취소
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? '삭제 중…' : deleting.all ? '전체 영구 삭제' : '영구 삭제'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
