import { useState } from 'react';
import type { TrashItem } from '../lib/types';
import { RotateCcw, Trash2 } from 'lucide-react';
import { call } from '../lib/api';

export function TrashView({
  vault,
  items,
  refresh,
  onError,
}: {
  vault: string;
  items: TrashItem[];
  refresh: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [restoring, setRestoring] = useState<string | null>(null);
  const restore = async (id: string) => {
    if (restoring) return;
    setRestoring(id);
    try {
      await call(vault, 'trash.restore', { id });
      await refresh();
    } catch (e) {
      onError(e);
    } finally {
      setRestoring(null);
    }
  };
  return (
    <section className="page-view">
      <div className="eyebrow">NOTHING LOST ALONG THE WAY</div>
      <h1>휴지통</h1>
      <p className="page-description">삭제한 노트·폴더·데이터베이스·DB 항목을 복원합니다.</p>
      {items.map((item) => (
        <div className="trash-row" key={item.id}>
          <Trash2 size={17} />
          <span>
            <strong>{item.title}</strong>
            <small>
              {{ note: '노트', folder: '폴더', database: '데이터베이스', record: 'DB 항목' }[item.kind] ??
                item.kind}{' '}
              · {new Date(item.deletedAt).toLocaleString('ko-KR')}
            </small>
          </span>
          <button
            className="secondary-button"
            disabled={restoring !== null}
            onClick={() => void restore(item.id)}
          >
            <RotateCcw size={14} />
            복원
          </button>
        </div>
      ))}
      {!items.length && (
        <div className="empty-panel">
          <Trash2 size={30} />
          <h2>휴지통이 비어 있어요</h2>
        </div>
      )}
    </section>
  );
}
