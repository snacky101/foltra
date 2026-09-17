import { lazy, Suspense, type RefObject, type Dispatch, type SetStateAction } from 'react';
import { FileText, Link2, Loader2, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Backlinks } from './Backlinks';
import type { EditorHandle } from './Editor';
import type { Workspace } from '../lib/types';
import type { useNote } from '../lib/useNote';
import type { Dialog } from './AppDialogs';
import type { NoteCommand } from '../lib/noteCommands';
import { noteLinks } from '../lib/noteLinks';
import { vimNormalBindings, type Command } from '../lib/commands';
const Editor = lazy(() => import('./Editor').then((module) => ({ default: module.Editor })));
const NotePreview = lazy(() => import('./NotePreview').then((module) => ({ default: module.NotePreview })));
interface Props {
  workspace: Workspace;
  noteId: string | null;
  note: ReturnType<typeof useNote>;
  preview: boolean;
  backlinks: boolean;
  editor: RefObject<EditorHandle | null>;
  dispatch: (id: string) => void;
  commands: Command[];
  openNote: (id: string, line?: number) => Promise<void>;
  openLink: (target: string, createIfMissing?: boolean) => void;
  setNoteId: Dispatch<SetStateAction<string | null>>;
  setMode: (mode: string) => void;
  setDialog: Dispatch<SetStateAction<Dialog | null>>;
  onError: (error: unknown) => void;
  onEditorReady: () => void;
  commandLineHost: RefObject<HTMLDivElement | null>;
  onNoteCommand: (command: NoteCommand, force: boolean) => Promise<void>;
}
export function NotePane({
  workspace,
  noteId,
  note,
  preview,
  backlinks,
  editor,
  dispatch,
  commands,
  openNote,
  openLink,
  setNoteId,
  setMode,
  setDialog,
  onError,
  onEditorReady,
  commandLineHost,
  onNoteCommand,
}: Props) {
  return (
    <>
      <div className="note-scroll" tabIndex={-1}>
        {noteId ? (
          <article className="note-document">
            <div className="note-meta">
              <span className="note-type">
                <FileText size={13} /> NOTE
              </span>
              <span>
                {note.note &&
                  new Date(note.note.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
              </span>
            </div>
            <input
              className="note-title"
              aria-label="노트 제목"
              value={note.draft.title}
              disabled={note.status === 'loading'}
              onChange={(e) => note.edit({ title: e.target.value })}
              placeholder="Untitled"
            />
            <div className="note-subline">
              <span>
                <Link2 size={12} />
                {noteLinks(workspace).filter((l) => l.source === noteId || l.target === noteId).length}{' '}
                connections
              </span>
              <span>Personal knowledge</span>
              <button
                className="icon-button"
                aria-label="노트 속성 편집"
                title="노트 속성 · frontmatter 편집"
                onClick={() => dispatch('note.frontmatter.edit')}
              >
                <SlidersHorizontal size={13} />
              </button>
              <button
                className="icon-button"
                aria-label="현재 노트 삭제"
                onClick={() => dispatch('note.delete')}
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="document-divider" />
            {note.error && (
              <div className="save-error" role="alert">
                <p>{note.error}</p>
                <button
                  onClick={() =>
                    void note
                      .saveCopy()
                      .then((item) => {
                        setNoteId(item.id);
                      })
                      .catch(onError)
                  }
                >
                  사본으로 저장
                </button>
                <button onClick={() => void note.reload()}>디스크 내용 다시 불러오기</button>
              </div>
            )}
            {note.status === 'loading' ? (
              <div className="loading-note">
                <Loader2 size={18} className="spin" />
                기록을 불러오는 중…
              </div>
            ) : (
              note.note?.id === noteId && (
                <Suspense fallback={<div className="loading-note">편집 도구를 준비하는 중…</div>}>
                  {preview && (
                    <Suspense fallback={<div className="loading-note">읽기 화면을 준비하는 중…</div>}>
                      <NotePreview
                        body={note.draft.body}
                        workspace={workspace}
                        openNote={(id) => void openNote(id)}
                        openLink={openLink}
                      />
                    </Suspense>
                  )}
                  <div hidden={preview}>
                    <Editor
                      key={`${workspace.vault.id}:${noteId}`}
                      noteId={noteId}
                      ref={editor}
                      onReady={onEditorReady}
                      value={note.draft.body}
                      hidden={preview}
                      vimEnabled={workspace.settings.vim}
                      livePreview={workspace.settings.editorMode === 'live'}
                      workspace={workspace}
                      openNote={(id) => void openNote(id)}
                      openLink={openLink}
                      commandLineHost={commandLineHost}
                      vimBindings={vimNormalBindings(commands, workspace.settings)}
                      onCommand={dispatch}
                      slash={workspace.settings.slash}
                      onChange={(body) => note.edit({ body })}
                      onMode={setMode}
                      onSlash={() => setDialog({ kind: 'slash' })}
                      onNoteCommand={onNoteCommand}
                      onError={onError}
                    />
                  </div>
                </Suspense>
              )
            )}
          </article>
        ) : (
          <div className="empty-notes">
            <span>✳</span>
            <h1>{workspace.notes.length ? '노트를 열어 이어가세요.' : '첫 생각을 남겨보세요.'}</h1>
            <p>
              {workspace.notes.length
                ? '왼쪽 목록에서 노트를 선택하거나 새 기록을 시작하세요.'
                : '한 줄의 기록에서 시작해도 좋아요.'}
            </p>
            <button className="primary-button" onClick={() => dispatch('note.create')}>
              <Plus size={16} />새 노트
            </button>
            <small>
              <kbd>Space</kbd> <kbd>n</kbd> <kbd>n</kbd>
            </small>
          </div>
        )}
      </div>
      {backlinks && noteId && (
        <Backlinks
          workspace={workspace}
          noteId={noteId}
          openNote={(id, line) => void openNote(id, line)}
          openLink={openLink}
        />
      )}
    </>
  );
}
