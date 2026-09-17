import { ArrowUpRight, Link2 } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Link, Workspace } from '../lib/types';
import { noteLinks } from '../lib/noteLinks';
import { ResizableSidebar } from './ResizableSidebar';

function linkItems(links: Link[], direction: string) {
  const occurrences = new Map<string, number>();
  return links.map((link) => {
    const id = JSON.stringify([direction, link.source, link.target, link.line, link.block, link.label]);
    const occurrence = occurrences.get(id) ?? 0;
    occurrences.set(id, occurrence + 1);
    return { link, key: `${id}:${occurrence}` };
  });
}

export function Backlinks({
  workspace,
  noteId,
  openNote,
  openLink,
  sidebar,
}: {
  workspace: Workspace;
  noteId: string | null;
  openNote: (id: string, line?: number) => void;
  openLink: (target: string) => void;
  sidebar?: ReactNode;
}) {
  const links = noteLinks(workspace);
  const incoming = linkItems(
    links.filter((l) => l.target === noteId),
    'incoming',
  );
  const outgoing = linkItems(
    links.filter((l) => l.source === noteId && (l.target || workspace.settings.showUnresolvedLinks)),
    'outgoing',
  );
  const panel = useRef<HTMLElement>(null);
  const selection = useRef<{ key: string; index: number; noteId: string | null } | null>(null);
  const selectable = () => [
    ...(panel.current?.querySelectorAll<HTMLButtonElement>('[data-backlink-item]:not(:disabled)') ?? []),
  ];
  useLayoutEffect(() => {
    const previous = selection.current;
    if (!previous || !panel.current) return;
    if (document.activeElement !== document.body && !panel.current.contains(document.activeElement)) {
      selection.current = null;
      return;
    }
    const items = selectable();
    const target =
      items.find((item) => item.dataset.backlinkItem === previous.key) ??
      items[previous.noteId === noteId ? Math.min(previous.index, items.length - 1) : 0];
    if (!target) {
      selection.current = null;
      // The editor may remount while loading the same external note update.
      panel.current.closest<HTMLElement>('[data-focus-region="main"]')?.focus();
    } else {
      selection.current = { key: target.dataset.backlinkItem!, index: items.indexOf(target), noteId };
      if (target !== document.activeElement) {
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [noteId, workspace.links, workspace.notes]);
  return (
    <ResizableSidebar side="right">
      <aside
        ref={panel}
        className="backlinks-panel"
        data-focus-region="backlinks"
        tabIndex={-1}
        onPointerDown={(event) =>
          (event.target as Element).closest<HTMLButtonElement>('[data-backlink-item]')?.focus()
        }
        onFocusCapture={(event) => {
          const item = (event.target as Element).closest<HTMLButtonElement>('[data-backlink-item]');
          if (item)
            selection.current = {
              key: item.dataset.backlinkItem!,
              index: selectable().indexOf(item),
              noteId,
            };
          else selection.current = null;
        }}
        onBlurCapture={(event) => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
            selection.current = null;
        }}
      >
        <div className="backlinks-scroll">
          {noteId && (
            <>
              <div className="backlinks-heading">
                <Link2 size={16} />
                <strong>연결된 생각</strong>
                <span>{incoming.length}</span>
              </div>
              <p className="panel-description">이 노트로 이어지는 기록</p>
              {incoming.map(({ link, key }) => {
                const note = workspace.notes.find((n) => n.id === link.source)!;
                return (
                  <button
                    data-sidebar-item
                    data-backlink-item={key}
                    className="backlink-card"
                    key={key}
                    onClick={() => openNote(note.id, link.line)}
                  >
                    <div>
                      <span className="small-dot" />
                      <strong>{note.title}</strong>
                      <ArrowUpRight size={13} />
                    </div>
                    <p>{link.context.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')}</p>
                    {link.block && <small>블록 #{link.block}</small>}
                  </button>
                );
              })}
              {!incoming.length && (
                <div className="no-backlinks">
                  <span>↗</span>
                  <p>
                    다른 노트에서 이 노트를
                    <br />
                    연결하면 여기에 나타나요.
                  </p>
                </div>
              )}
              <div className="outgoing-heading">
                OUTGOING LINKS <span>{outgoing.length}</span>
              </div>
              {outgoing.map(({ link, key }) => (
                <button
                  data-sidebar-item
                  data-backlink-item={key}
                  key={key}
                  className={`outgoing-link ${!link.target ? 'unresolved' : ''}`}
                  title={!link.target ? `미생성 링크: ${link.name}` : undefined}
                  onClick={() => openLink(link.name)}
                >
                  <Link2 size={13} />
                  <span>{link.label}</span>
                  <ArrowUpRight size={12} />
                </button>
              ))}
            </>
          )}
        </div>
        {sidebar && <div className="backlinks-extensions">{sidebar}</div>}
      </aside>
    </ResizableSidebar>
  );
}
