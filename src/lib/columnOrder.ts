import type { Property } from './types';

export function readColumnOrder(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
      : [];
  } catch {
    return [];
  }
}

export function orderedColumns(properties: Property[], order: string[]): Property[] {
  const remaining = new Map(properties.map((property) => [property.id, property]));
  const result: Property[] = [];
  for (const id of order) {
    const property = remaining.get(id);
    if (property) {
      result.push(property);
      remaining.delete(id);
    }
  }
  return [...result, ...remaining.values()];
}

export function moveColumn(
  order: string[],
  source: string,
  target: string,
  placement: 'before' | 'after',
): string[] {
  if (source === target || !order.includes(source) || !order.includes(target)) return order;
  const next = order.filter((id) => id !== source);
  next.splice(next.indexOf(target) + (placement === 'after' ? 1 : 0), 0, source);
  return next;
}
