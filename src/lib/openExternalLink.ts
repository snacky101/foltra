import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

export function externalLinkUrl(target: string): string | null {
  // Do not let URL normalization disguise control characters or local/custom protocols.
  if (target.trim() !== target || /[\u0000-\u001f\u007f]/.test(target)) return null;
  try {
    const url = new URL(target);
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return null;
    if (url.protocol === 'mailto:' && !url.pathname) return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function openExternalLink(target: string): Promise<boolean> {
  const url = externalLinkUrl(target);
  if (!url) return false;
  if (isTauri()) await openUrl(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
