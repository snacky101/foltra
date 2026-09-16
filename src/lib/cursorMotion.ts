export interface CursorPoint {
  x: number;
  y: number;
}
export interface CursorRect extends CursorPoint {
  width: number;
  height: number;
}

// Time-based damping gives the same response at 60 Hz and 120 Hz.
export function followCursor(
  current: CursorPoint,
  target: CursorPoint,
  elapsed: number,
  lag: number,
): CursorPoint {
  const amount = 1 - Math.exp(-Math.max(0, elapsed) / lag);
  const x = current.x + (target.x - current.x) * amount;
  const y = current.y + (target.y - current.y) * amount;
  return Math.hypot(target.x - x, target.y - y) < 0.25 ? { ...target } : { x, y };
}

// Connect the cursor's leading edge to a narrow tail, in any movement direction.
export function cursorTrail(head: CursorRect, tail: CursorPoint): string {
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.5) return '';
  const nx = -dy / distance;
  const ny = dx / distance;
  const radius = (Math.abs(nx) * head.width + Math.abs(ny) * head.height) / 2;
  const x = head.x + head.width / 2;
  const y = head.y + head.height / 2;
  const tx = tail.x + head.width / 2;
  const ty = tail.y + head.height / 2;
  return `${x + nx * radius},${y + ny * radius} ${tx + nx},${ty + ny} ${tx - nx},${ty - ny} ${x - nx * radius},${y - ny * radius}`;
}
