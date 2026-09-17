import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

const dateValue = (date: Date) =>
  `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function DateField({
  value,
  label,
  invalid,
  onChange,
  onCommit,
  onFocus,
}: {
  value: string;
  label: string;
  invalid: boolean;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  onFocus: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(new Date());
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', resize);
    };
  }, [open]);
  const choose = (next: string) => {
    onChange(next);
    onCommit(next);
    setOpen(false);
    trigger.current?.focus();
  };
  const first = new Date(month);
  first.setDate(1);
  const last = new Date(first);
  last.setMonth(last.getMonth() + 1);
  last.setDate(0);
  const changeMonth = (delta: number) => {
    const next = new Date(first);
    next.setMonth(next.getMonth() + delta);
    setMonth(next);
  };
  return (
    <div
      className="date-field"
      data-keyboard-input
      ref={root}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <input
        type="text"
        inputMode="numeric"
        placeholder="YYYY-MM-DD"
        aria-label={label}
        aria-invalid={invalid}
        className={invalid ? 'invalid' : ''}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={() => onCommit(value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      <button
        ref={trigger}
        type="button"
        className="icon-button"
        aria-label={`${label} 달력 열기`}
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          onFocus();
          const selected = new Date(`${value}T12:00:00`);
          setMonth(Number.isNaN(selected.getTime()) ? new Date() : selected);
          const rect = trigger.current!.getBoundingClientRect();
          setPosition({
            left: Math.max(12, Math.min(rect.right - 260, window.innerWidth - 272)),
            top: rect.bottom + 310 > window.innerHeight ? Math.max(12, rect.top - 310) : rect.bottom + 5,
          });
          setOpen(true);
        }}
      >
        <CalendarDays size={14} />
      </button>
      {open && (
        <div className="date-calendar" role="group" aria-label={`${label} 날짜 선택`} style={position}>
          <div className="calendar-heading">
            <button
              type="button"
              className="icon-button"
              aria-label="이전 달"
              onClick={() => changeMonth(-1)}
            >
              <ChevronLeft size={15} />
            </button>
            <strong aria-live="polite">
              {month.getFullYear()}년 {month.getMonth() + 1}월
            </strong>
            <button type="button" className="icon-button" aria-label="다음 달" onClick={() => changeMonth(1)}>
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="calendar-grid">
            {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
              <small key={day}>{day}</small>
            ))}
            {Array.from({ length: first.getDay() }, (_, index) => (
              <span key={`blank-${index}`} />
            ))}
            {Array.from({ length: last.getDate() }, (_, index) => {
              const day = new Date(first);
              day.setDate(index + 1);
              const date = dateValue(day);
              return (
                <button
                  key={date}
                  type="button"
                  aria-label={date}
                  aria-pressed={value === date}
                  onClick={() => choose(date)}
                  onKeyDown={(e) => {
                    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
                    if (delta !== undefined) {
                      e.preventDefault();
                      const buttons =
                        root.current!.querySelectorAll<HTMLButtonElement>('.calendar-grid button');
                      buttons[Math.max(0, Math.min(buttons.length - 1, index + delta))]?.focus();
                    }
                  }}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
          <div className="calendar-actions">
            <button type="button" className="text-button" onClick={() => choose('')}>
              지우기
            </button>
            <button type="button" className="text-button" onClick={() => choose(dateValue(new Date()))}>
              오늘
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
