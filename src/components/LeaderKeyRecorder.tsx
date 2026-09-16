import { useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { bindingsFor, bindingUsesLeader, type Command } from '../lib/commands';
import { leaderLabel, recordLeaderKey } from '../lib/leaderKey';
import type { Settings } from '../lib/types';

export function LeaderKeyRecorder({
  settings,
  commands,
  update,
}: {
  settings: Settings;
  commands: Command[];
  update: (patch: Partial<Settings>) => Promise<boolean>;
}) {
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const captured = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const cancel = () => {
    setRecording(false);
    setError('');
  };
  return (
    <div className="key-recorder" data-key-recorder>
      <div className="key-recorder-controls">
        {recording ? (
          <input
            autoFocus
            readOnly
            aria-label="Leader 키 기록"
            placeholder="원하는 키를 누르세요"
            value=""
            onBlur={cancel}
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                cancel();
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === 'Escape') {
                cancel();
                button.current?.focus();
                return;
              }
              if (captured.current) return;
              const value = recordLeaderKey(event.nativeEvent);
              if (!value) return;
              const collision = commands.find((command) => {
                return bindingsFor(command, settings).some((binding) => bindingUsesLeader(binding, value));
              });
              if (collision) {
                setError(`“${collision.title}” 단축키와 겹칩니다. 다른 키를 눌러주세요.`);
                return;
              }
              setError('');
              captured.current = true;
              setRecording(false);
              setSaving(true);
              void update({ leader: value })
                .then((saved) => {
                  if (!saved) setError('저장하지 못했습니다. 다시 기록하세요.');
                })
                .catch((e) => setError((e as Error).message))
                .finally(() => {
                  setSaving(false);
                  window.requestAnimationFrame(() => button.current?.focus());
                });
            }}
          />
        ) : (
          <kbd aria-label="현재 Leader 키">{leaderLabel(settings.leader)}</kbd>
        )}
        <button
          ref={button}
          type="button"
          className="secondary-button"
          disabled={saving}
          onMouseDown={(event) => {
            if (recording) event.preventDefault();
          }}
          onClick={() => {
            if (recording) cancel();
            else {
              captured.current = false;
              setError('');
              setRecording(true);
            }
          }}
        >
          <Keyboard size={14} />
          {saving ? '저장 중…' : recording ? '취소' : '키 기록'}
        </button>
      </div>
      {recording && <small>Esc 취소 · Tab 다음 항목</small>}
      {error && (
        <small className="binding-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
