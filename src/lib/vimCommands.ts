import { Vim } from '@replit/codemirror-vim';
import type { NoteCommand } from './noteCommands';

interface Handler {
  run: (command: NoteCommand, force: boolean) => Promise<void>;
  error: (error: unknown) => void;
}
const handlers = new WeakMap<object, Handler>();
const busy = new WeakSet<object>();

// Vim's Ex registry is global. Resolve the invoking editor instead of capturing the last mounted one.
for (const [name, prefix, command] of [
  ['write', 'w', 'write'],
  ['quit', 'q', 'quit'],
  ['wq', 'wq', 'writequit'],
  ['xit', 'x', 'writequit'],
  ['exit', 'exi', 'writequit'],
] as const) {
  Vim.defineEx(name, prefix, (cm, params) => {
    const handler = handlers.get(cm);
    if (!handler || busy.has(cm)) return;
    const argument = (params.argString ?? '').trim();
    if ((argument && argument !== '!') || params.line !== undefined || params.lineEnd !== undefined) {
      handler.error(new Error('현재 노트만 저장·닫을 수 있습니다. 파일 경로나 범위는 지원하지 않습니다.'));
      return;
    }
    busy.add(cm);
    void handler
      .run(command, argument === '!')
      .catch(handler.error)
      .finally(() => busy.delete(cm));
  });
}

export function bindVimCommands(cm: object, handler: Handler) {
  handlers.set(cm, handler);
  return () => {
    handlers.delete(cm);
  };
}
