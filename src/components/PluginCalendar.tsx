import { useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PluginNode } from '../lib/pluginTypes';
import { calendarMonth, moveCalendarFocus } from '../lib/calendar';

export function PluginCalendar({
  node,
  action,
}: {
  node: PluginNode;
  action: (id: string, value?: string | boolean, payload?: unknown) => Promise<void>;
}) {
  // Calendar nodes arrive through the core's date and shape validator.
  const month = node.month!;
  const { year, number, cells } = calendarMonth(month);
  const marked = new Set(node.markedDates);
  const initial = node.today?.startsWith(`${month}-`) ? node.today : `${month}-01`;
  const [focused, setFocused] = useState(initial);
  const focusDate = focused?.startsWith(`${month}-`) ? focused : initial;
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const run = async (id?: string, value?: string) => {
    if (!id || locked.current || node.disabled) return;
    locked.current = true;
    setPending(true);
    try {
      await action(id, value);
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  const keydown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.key.startsWith('Arrow')) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.nativeEvent.isComposing)
      return;
    if (moveCalendarFocus(event.currentTarget, event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const disabled = pending || node.disabled;
  return (
    <div className="plugin-calendar" data-plugin-calendar aria-busy={pending}>
      <div className="plugin-calendar-heading">
        <strong aria-live="polite">
          {year}년 {number}월
        </strong>
        <div className="plugin-calendar-navigation">
          <button
            type="button"
            className="plugin-calendar-today"
            title="오늘이 있는 달로 이동"
            disabled={disabled || !node.todayAction}
            onClick={() => void run(node.todayAction)}
          >
            오늘
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="이전 달"
            disabled={disabled || !node.previousAction || month === '0001-01'}
            onClick={() => void run(node.previousAction)}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="다음 달"
            disabled={disabled || !node.nextAction || month === '9999-12'}
            onClick={() => void run(node.nextAction)}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div
        className="plugin-calendar-grid"
        role="grid"
        aria-label={node.label ?? `${year}년 ${number}월 달력`}
      >
        <div className="plugin-calendar-week" role="row">
          {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
            <span className="plugin-calendar-weekday" role="columnheader" key={day}>
              {day}
            </span>
          ))}
        </div>
        {Array.from({ length: cells.length / 7 }, (_, week) => (
          <div className="plugin-calendar-week" role="row" key={week}>
            {cells.slice(week * 7, week * 7 + 7).map((date, column) => (
              <div role="gridcell" key={date ?? `blank-${column}`}>
                {date && (
                  <button
                    type="button"
                    className={`plugin-calendar-day${date === node.today ? ' is-today' : ''}`}
                    data-calendar-date={date}
                    aria-current={date === node.today ? 'date' : undefined}
                    aria-label={`${date}${date === node.today ? ', 오늘' : ''}${marked.has(date) ? ', 노트 있음' : ''}`}
                    tabIndex={date === focusDate ? 0 : -1}
                    disabled={disabled || !node.action}
                    onFocus={() => setFocused(date)}
                    onKeyDown={keydown}
                    onClick={() => void run(node.action, date)}
                  >
                    <span>{Number(date.slice(-2))}</span>
                    {marked.has(date) && <span className="plugin-calendar-dot" aria-hidden="true" />}
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
