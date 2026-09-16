import type { CSSProperties } from 'react';
import type { Settings } from '../lib/types';
import { Select } from './Select';

export function CursorSettings({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => Promise<boolean>;
}) {
  const rates = [400, 600, 800, 1200];
  return (
    <>
      <div className="setting-row">
        <span>
          <strong>커서 모양</strong>
          <small>노트 본문에서 사용할 커서 모양을 선택합니다.</small>
        </span>
        <Select
          aria-label="커서 모양"
          value={settings.cursorShape}
          onValueChange={(value) => void update({ cursorShape: value as Settings['cursorShape'] })}
        >
          <option value="bar">세로선 · Bar</option>
          <option value="block">블록 · Block</option>
          <option value="underline">밑줄 · Underline</option>
        </Select>
      </div>
      {settings.vim && (
        <label className="setting-row">
          <span>
            <strong>Vim 모드별 커서</strong>
            <small>
              Normal·Visual은 블록, Replace는 밑줄, Insert는 선택한 모양입니다. 끄면 모든 모드에 선택한 모양을
              적용합니다.
            </small>
          </span>
          <input
            aria-label="Vim 모드별 커서"
            className="switch"
            type="checkbox"
            checked={settings.cursorFollowVim}
            onChange={(e) => void update({ cursorFollowVim: e.target.checked })}
          />
        </label>
      )}
      <div className="setting-row">
        <span>
          <strong>커서 애니메이션</strong>
          <small>Blink는 일정하게 깜빡이고, Breath는 숨을 쉬듯 서서히 밝아졌다 흐려집니다.</small>
        </span>
        <Select
          aria-label="커서 애니메이션"
          value={settings.cursorBlink}
          onValueChange={(value) => void update({ cursorBlink: value as Settings['cursorBlink'] })}
        >
          <option value="steady">고정 · Steady</option>
          <option value="blink">깜빡임 · Blink</option>
          <option value="breath">숨쉬기 · Breath</option>
        </Select>
      </div>
      <div className="setting-row">
        <span>
          <strong>커서 점멸 간격</strong>
          <small>밝아지거나 흐려지는 한 단계의 시간입니다. 한 주기는 이 값의 두 배입니다.</small>
        </span>
        <Select
          aria-label="커서 점멸 간격"
          value={String(settings.cursorBlinkRate)}
          disabled={settings.cursorBlink === 'steady'}
          onValueChange={(value) => void update({ cursorBlinkRate: Number(value) })}
        >
          {rates.map((rate) => (
            <option key={rate} value={String(rate)}>
              {rate} ms
            </option>
          ))}
          {!rates.includes(settings.cursorBlinkRate) && (
            <option value={String(settings.cursorBlinkRate)}>{settings.cursorBlinkRate} ms</option>
          )}
        </Select>
      </div>
      <div className="cursor-appearance-preview" aria-label="커서 모양과 애니메이션 미리보기">
        <span className="cursor-preview-caption">일반 편집 · Insert 미리보기</span>
        <span className="cursor-preview-text" aria-hidden="true">
          Foltra
          <span className="cursor-preview-cell">
            <i
              key={`${settings.cursorShape}:${settings.cursorBlink}:${settings.cursorBlinkRate}`}
              className="foltra-cursor is-idle"
              data-shape={settings.cursorShape}
              data-blink={settings.cursorBlink}
              style={{ '--cursor-blink-duration': `${settings.cursorBlinkRate * 2}ms` } as CSSProperties}
            />
          </span>
        </span>
      </div>
      <div className="setting-row">
        <span>
          <strong>커서 이동 효과</strong>
          <small>
            Smear는 이동 방향으로 잔상을 남깁니다. 애니메이션과 이동 효과는 시스템의 동작 줄이기 설정을
            따릅니다.
          </small>
        </span>
        <Select
          aria-label="커서 이동 효과"
          value={settings.cursorAnimation}
          onValueChange={(value) => void update({ cursorAnimation: value as Settings['cursorAnimation'] })}
        >
          <option value="none">없음</option>
          <option value="smooth">부드럽게</option>
          <option value="smear">Smear · 잔상</option>
        </Select>
      </div>
    </>
  );
}
