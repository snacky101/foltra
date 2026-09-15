import type { Property } from './types';

export const defaultColumnWidth = (property: Property) =>
  property.id === 'title' ? 300 : property.type === 'date' ? 190 : 170;
export const clampColumnWidth = (width: number, property: Property) =>
  Math.max(property.id === 'title' ? 180 : 100, Math.min(800, Math.round(width)));
export function readColumnWidths(raw: string | null): Record<string, number> {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, width]) => typeof width === 'number' && Number.isFinite(width) && width >= 100 && width <= 800,
      ),
    );
  } catch {
    return {};
  }
}
