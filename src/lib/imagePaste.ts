import { Prec, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { importClipboardImage, type Attachment } from './attachments';

interface PendingPaste {
  from: number;
  to: number;
  insert?: string;
}
interface Context {
  vault: string;
  onError: (error: unknown) => void;
}

export function imagePasteExtension(
  context: () => Context,
  importImage: (vault: string, file: File) => Promise<Attachment> = importClipboardImage,
) {
  return Prec.highest(
    ViewPlugin.fromClass(
      class {
        pending = new Set<PendingPaste>();
        alive = true;
        queue = Promise.resolve();
        // Vim registers its own paste listener and enters Insert before CM handlers.
        // Handle image files in capture phase; ordinary text keeps that Vim behavior.
        capturePaste = (event: ClipboardEvent) => {
          if (this.paste(event)) event.stopImmediatePropagation();
        };
        constructor(readonly view: EditorView) {
          view.contentDOM.addEventListener('paste', this.capturePaste, true);
        }
        update(update: ViewUpdate) {
          for (const transaction of update.transactions) {
            if (!transaction.docChanged) continue;
            for (const paste of this.pending) {
              let replaced =
                transaction.annotation(Transaction.addToHistory) === false ||
                transaction.isUserEvent('undo') ||
                transaction.isUserEvent('redo');
              transaction.changes.iterChangedRanges((from, to) => {
                if (from < paste.to && to > paste.from) replaced = true;
                if (paste.from === paste.to && from < paste.from && to > paste.from) replaced = true;
              });
              if (replaced) this.pending.delete(paste);
              else {
                paste.from = transaction.changes.mapPos(paste.from, 1);
                paste.to = transaction.changes.mapPos(paste.to, 1);
              }
            }
          }
        }
        destroy() {
          this.view.contentDOM.removeEventListener('paste', this.capturePaste, true);
          this.alive = false;
          this.pending.clear();
        }
        flush() {
          if (!this.alive || this.view.compositionStarted) return;
          for (const paste of this.pending) {
            if (paste.insert === undefined) break;
            this.pending.delete(paste);
            const selection = this.view.state.selection.main;
            this.view.dispatch({
              changes: { from: paste.from, to: paste.to, insert: paste.insert },
              selection:
                selection.from === paste.from && selection.to === paste.to
                  ? { anchor: paste.from + paste.insert.length }
                  : undefined,
              annotations: isolateHistory.of('full'),
              userEvent: 'input.paste',
            });
          }
        }
        paste(event: ClipboardEvent) {
          const data = event.clipboardData;
          const files = Array.from(data?.items ?? [])
            .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
            .map((item) => item.getAsFile())
            .filter((file): file is File => !!file);
          if (!files.length)
            files.push(...Array.from(data?.files ?? []).filter((file) => file.type.startsWith('image/')));
          if (!files.length) return false;
          event.preventDefault();
          if (this.view.compositionStarted) {
            context().onError(new Error('글자 입력을 확정한 뒤 이미지를 붙여넣어 주세요.'));
            return true;
          }
          const paste: PendingPaste = {
            from: this.view.state.selection.main.from,
            to: this.view.state.selection.main.to,
          };
          this.pending.add(paste);
          const vault = context().vault;
          this.queue = this.queue.then(async () => {
            try {
              const links: string[] = [];
              for (const file of files) {
                if (!this.alive || !this.pending.has(paste)) return;
                const attachment = await importImage(vault, file);
                links.push(`![이미지](../${attachment.path})`);
              }
              if (!this.alive || !this.pending.has(paste) || context().vault !== vault) {
                this.pending.delete(paste);
                return;
              }
              paste.insert = links.join('\n\n');
              this.flush();
            } catch (error) {
              this.pending.delete(paste);
              if (this.alive && context().vault === vault) context().onError(error);
            }
          });
          return true;
        }
      },
      {
        eventHandlers: {
          compositionend() {
            // Let CodeMirror flush the committed text before inserting a saved image.
            requestAnimationFrame(() => this.flush());
          },
        },
      },
    ),
  );
}
