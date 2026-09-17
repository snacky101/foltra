const genericFamilies = new Set(['system-ui', 'sans-serif', 'serif', 'monospace']);

// Custom input names one installed family, never a CSS declaration or a font URL.
export function fontFamilyStack(value?: string): string | undefined {
  const name = value?.trim();
  if (!name) return undefined;
  const family = genericFamilies.has(name) ? name : `"${name.replace(/["\\]/g, '\\$&')}"`;
  return `${family}, var(--body-font)`;
}
