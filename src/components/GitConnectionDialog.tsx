import type { GitConnection } from '../lib/usePluginGit';
import { Modal } from './Modal';

export function GitConnectionDialog({
  connection,
  busy,
  error,
  confirm,
  close,
}: {
  connection: GitConnection;
  busy: boolean;
  error: string;
  confirm: () => Promise<void>;
  close: () => void;
}) {
  return (
    <Modal title="Git 저장소 연결" close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
      >
        <div className="plugin-stack">
          <p>이 Vault를 다음 저장소에 연결합니다.</p>
          <div className="plugin-card">
            <strong style={{ overflowWrap: 'anywhere' }}>{connection.params.remote}</strong>
            <span>브랜치 · {connection.params.branch}</span>
            <span>
              자동 동기화 ·{' '}
              {connection.params.automatic ? `${connection.params.intervalMinutes}분마다` : '꺼짐'}
            </span>
          </div>
          <p>
            동기화할 때 노트·폴더·데이터베이스·DB 항목·이미지 첨부·휴지통·주제 순서와 Vault 정보가 이 주소로
            전송됩니다.
          </p>
          <p className="muted">
            빈 Vault에 기존 Foltra 저장소를 연결하면 그 저장소의 Vault를 가져옵니다. 앱 설정·확장·권한 승인은
            기기에 유지됩니다. 저장소에 접근할 수 있는 사람은 전송된 내용을 읽을 수 있습니다.
          </p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={close}>
            취소
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? '연결 중…' : '이 저장소에 연결'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
