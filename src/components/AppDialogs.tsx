import { FolderSelect } from './FolderSelect';
import { Select } from './Select';
import { PropertyEditor } from './PropertyEditor';
import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { SearchDialog } from './SearchDialog';
import { Modal } from './Modal';
import { call } from '../lib/api';
import type { Database, Note, Property, Row, Workspace } from '../lib/types';

export type Dialog =
  | { kind: 'new-note'; folderId?: string }
  | { kind: 'new-database' | 'search' | 'query' | 'link' | 'slash' }
  | { kind: 'body'; row: Row }
  | { kind: 'property'; database: Database }
  | { kind: 'property-edit'; database: Database; property: Property };
interface Props {
  dialog: Dialog;
  workspace: Workspace;
  close: () => void;
  refresh: () => Promise<void>;
  openNote: (id: string) => void;
  openDatabase: (id: string) => void;
  insert: (text: string) => void;
  onError: (e: unknown) => void;
}
export function AppDialogs({
  dialog,
  workspace,
  close,
  refresh,
  openNote,
  openDatabase,
  insert,
  onError,
}: Props) {
  const [folderId, setFolderId] = useState(dialog.kind === 'new-note' ? (dialog.folderId ?? '') : '');
  const [value, setValue] = useState('');
  const [body, setBody] = useState('');
  const [existing, setExisting] = useState('');
  const [kind, setKind] = useState('text');
  const [options, setOptions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (dialog.kind === 'search')
    return <SearchDialog vault={workspace.path} close={close} openNote={openNote} />;
  if (dialog.kind === 'property-edit')
    return (
      <PropertyEditor
        vault={workspace.path}
        database={dialog.database}
        property={dialog.property}
        close={close}
        refresh={refresh}
      />
    );
  if (dialog.kind === 'link')
    return (
      <Modal title="생각 연결하기" close={close}>
        <input
          className="full-input"
          aria-label="연결할 노트 검색"
          placeholder="노트 제목 찾기…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="choice-list">
          {workspace.notes
            .filter((n) => n.title.toLowerCase().includes(value.toLowerCase()))
            .map((note) => (
              <button
                key={note.id}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const link = await call<string>(workspace.path, 'note.link', { id: note.id });
                    insert(link);
                    close();
                  })
                }
              >
                {note.title}
                <ArrowUpRight size={14} />
              </button>
            ))}
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </Modal>
    );
  if (dialog.kind === 'query')
    return (
      <Modal title="노트에 데이터베이스 쿼리 넣기" close={close}>
        <p className="muted">
          읽기 화면에 실제 DB 결과를 표시합니다. 삽입한 JSON에 필터와 정렬을 추가할 수 있습니다.
        </p>
        <div className="choice-list">
          {workspace.databases.map((db) => (
            <button
              key={db.id}
              onClick={() => {
                insert(
                  `\n\n\`\`\`foltra-query\n${JSON.stringify({ databaseId: db.id, limit: 25 }, null, 2)}\n\`\`\`\n`,
                );
                close();
              }}
            >
              {db.name}
              <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
        {!workspace.databases.length && <p>먼저 데이터베이스를 만들어 주세요.</p>}
      </Modal>
    );
  if (dialog.kind === 'slash')
    return (
      <Modal title="삽입 메뉴" close={close}>
        <div className="choice-list">
          {[
            { title: '제목', text: '# ' },
            { title: '할 일 목록', text: '- [ ] ' },
            { title: '인용', text: '> ' },
            { title: '코드 블록', text: '```\n\n```' },
            { title: '구분선', text: '\n---\n' },
          ].map((item) => (
            <button
              key={item.title}
              onClick={() => {
                insert(item.text);
                close();
              }}
            >
              {item.title}
              <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
      </Modal>
    );
  const title =
    dialog.kind === 'new-note'
      ? '새 노트'
      : dialog.kind === 'new-database'
        ? '새 데이터베이스'
        : dialog.kind === 'property'
          ? '속성 추가'
          : '행에 본문 추가';
  const submit = async () => {
    if (dialog.kind === 'new-note') {
      const note = await call<Note>(workspace.path, 'note.create', { title: value, folderId });
      await refresh();
      close();
      openNote(note.id);
    }
    if (dialog.kind === 'new-database') {
      const db = await call<Database>(workspace.path, 'database.create', { name: value });
      await refresh();
      close();
      openDatabase(db.id);
    }
    if (dialog.kind === 'property') {
      await call(workspace.path, 'database.property.add', {
        databaseId: dialog.database.id,
        property: {
          id: `p-${crypto.randomUUID().slice(0, 8)}`,
          name: value,
          type: kind,
          options: options
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
      });
      await refresh();
      close();
    }
    if (dialog.kind === 'body') {
      const note = await call<Note>(workspace.path, 'record.body', {
        id: dialog.row.id,
        expectedRevision: dialog.row.revision,
        ...(existing ? { noteId: existing } : { body }),
      });
      await refresh();
      close();
      openNote(note.id);
    }
  };
  return (
    <Modal title={title} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(submit);
        }}
      >
        {(dialog.kind === 'new-note' || dialog.kind === 'new-database' || dialog.kind === 'property') && (
          <label className="form-field">
            이름
            <input
              aria-label={title + ' 이름'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              maxLength={240}
              placeholder={dialog.kind === 'new-database' ? '예: Reading room' : '어떤 생각을 담을까요?'}
            />
          </label>
        )}
        {dialog.kind === 'new-note' && (
          <FolderSelect folders={workspace.folders} value={folderId} onChange={setFolderId} />
        )}
        {dialog.kind === 'new-database' && (
          <p className="muted">
            이름·상태·날짜 속성으로 시작합니다. 노트 파일 없이 항목을 입력할 수 있습니다.
          </p>
        )}
        {dialog.kind === 'property' && (
          <>
            <label className="form-field">
              속성 종류
              <Select value={kind} onValueChange={(value) => setKind(value)}>
                {[
                  ['text', '텍스트'],
                  ['number', '숫자'],
                  ['checkbox', '체크박스'],
                  ['date', '날짜'],
                  ['select', '선택'],
                  ['status', '상태'],
                  ['url', 'URL'],
                ].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </label>
            {(kind === 'select' || kind === 'status') && (
              <label className="form-field">
                선택지 (쉼표로 구분)
                <input
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                  placeholder="To do, In progress, Done"
                  required
                />
              </label>
            )}
          </>
        )}
        {dialog.kind === 'body' && (
          <>
            <p className="muted">
              “{String(dialog.row.values.title ?? 'Untitled')}”의 속성은 유지됩니다. 저장할 때 본문을
              생성합니다.
            </p>
            <label className="form-field">
              기존 노트 연결
              <Select
                aria-label="기존 노트 연결"
                value={existing}
                onValueChange={(value) => setExisting(value)}
              >
                <option value="">새 본문 작성</option>
                {workspace.notes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
              </Select>
            </label>
            {!existing && (
              <textarea
                aria-label="새 본문 내용"
                className="body-draft"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="이 항목에 대한 기록을 남겨보세요…"
              />
            )}
          </>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={close}>
            취소
          </button>
          <button className="primary-button" disabled={busy || (dialog.kind !== 'body' && !value.trim())}>
            {busy ? '저장 중…' : dialog.kind === 'body' ? '본문 저장' : '만들기'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
