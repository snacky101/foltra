export type NoteCommand = 'write' | 'quit' | 'writequit';
export interface NoteCommandContext {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
  discard: () => Promise<void>;
  close: () => void;
  notify: (message: string) => void;
}

export async function runNoteCommand(command: NoteCommand, force: boolean, context: NoteCommandContext) {
  if (command !== 'quit') {
    // Input may arrive while a write is in flight. A write-and-close must drain it too.
    do {
      if (!(await context.save())) throw new Error('저장하지 못했습니다. 변경 내용을 보존했습니다.');
    } while (context.isDirty());
    context.notify('저장했습니다.');
  }
  if (command === 'write') return;
  if (command === 'quit' && force) await context.discard();
  else if (context.isDirty())
    throw new Error('E37: 저장하지 않은 변경이 있습니다. :w 또는 :wq를 사용하세요.');
  context.close();
}
