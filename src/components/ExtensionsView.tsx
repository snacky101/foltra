import { useRef, useState } from 'react';
import { Puzzle, Palette, Upload, Trash2, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { call } from '../lib/api';
import type { Workspace } from '../lib/types';

export function ExtensionsView({
  workspace,
  refresh,
  onError,
}: {
  workspace: Workspace;
  refresh: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const install = async (file: File) => {
    setBusy(true);
    try {
      if (file.size > 256_000) throw new Error('확장 파일은 256 KB 이하여야 합니다.');
      const manifest = JSON.parse(await file.text());
      await call(workspace.path, 'extension.install', { manifest });
      await refresh();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const remove = async (id: string) => {
    try {
      await call(workspace.path, 'extension.remove', { id });
      await refresh();
    } catch (e) {
      onError(e);
    }
  };
  return (
    <section className="page-view">
      <div className="eyebrow">ROOM TO GROW</div>
      <div className="page-heading">
        <h1>확장</h1>
        <button className="primary-button" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={15} />
          패키지 설치
        </button>
      </div>
      <p className="page-description">작업 방식에 맞는 명령과 색을 더하세요.</p>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        aria-label="확장 패키지 파일"
        onChange={(e) => {
          if (e.target.files?.[0]) void install(e.target.files[0]);
        }}
      />
      <div className="extension-policy">
        <ShieldCheck size={20} />
        <div>
          <strong>선언형 확장 · 로컬 설치</strong>
          <p>
            현재 버전은 명령·템플릿·저장 쿼리와 색상 테마를 지원합니다. 확장 패키지의 JavaScript나 임의 CSS를
            실행하지 않습니다.
          </p>
        </div>
      </div>
      <div className="extension-grid">
        {workspace.extensions.map((extension) => (
          <article className="extension-card" key={extension.id}>
            <div className="extension-card-top">
              <span className={`extension-icon ${extension.kind}`}>
                {extension.kind === 'theme' ? <Palette size={24} /> : <Puzzle size={24} />}
              </span>
              <span className="version">v{extension.version}</span>
            </div>
            <h2>{extension.name}</h2>
            <p>
              {extension.description ||
                (extension.kind === 'theme' ? '나만의 색상 테마' : '작업을 연결하는 확장')}
            </p>
            <div className="extension-bottom">
              <span>{extension.kind === 'theme' ? '테마' : `${extension.commands?.length ?? 0}개 명령`}</span>
              <button className="text-button" onClick={() => void remove(extension.id)}>
                <Trash2 size={13} />
                제거
              </button>
            </div>
          </article>
        ))}
      </div>
      {!workspace.extensions.length && (
        <div className="empty-panel">
          <Puzzle size={32} />
          <h2>나만의 도구로 확장하세요</h2>
          <p>프로젝트의 examples 폴더에 있는 JSON 패키지부터 설치해 보세요.</p>
        </div>
      )}
      <div className="extension-tip">
        <ArrowUpRight size={16} />
        <p>
          설치한 명령은 명령 팔레트와 설정 → 단축키에 자동으로 추가됩니다. 테마는 설정 → 테마에서 선택할 수
          있습니다.
        </p>
      </div>
    </section>
  );
}
