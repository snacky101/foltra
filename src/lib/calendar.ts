/** UTC is only used for Gregorian grid arithmetic; the plugin supplies local date strings. */
export function calendarMonth(month: string) {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(0);
  first.setUTCHours(0, 0, 0, 0);
  first.setUTCFullYear(year, number - 1, 1);
  const last = new Date(first);
  last.setUTCMonth(number, 0);
  const offset = first.getUTCDay();
  const days = last.getUTCDate();
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= days ? `${month}-${String(day).padStart(2, '0')}` : null;
  });
  return { year, number, cells };
}

/** Shared by native arrows and Foltra's Vim sidebar command routing. */
export function moveCalendarFocus(target: HTMLElement, key: string) {
  const calendar = target.closest<HTMLElement>('[data-plugin-calendar]');
  if (!calendar) return false;
  const items = [...calendar.querySelectorAll<HTMLButtonElement>('[data-calendar-date]:not(:disabled)')];
  if (!items.length) return false;
  const active = target.closest<HTMLButtonElement>('[data-calendar-date]');
  const index = active ? items.indexOf(active) : -1;
  const steps: Record<string, number> = {
    ArrowLeft: -1,
    h: -1,
    ArrowRight: 1,
    l: 1,
    ArrowUp: -7,
    k: -7,
    ArrowDown: 7,
    j: 7,
  };
  const step = steps[key];
  if (step === undefined) return false;
  const next =
    index < 0
      ? (items.find((item) => item.tabIndex === 0) ?? items[0])
      : items[Math.max(0, Math.min(items.length - 1, index + step))];
  next.focus({ preventScroll: true });
  return true;
}
