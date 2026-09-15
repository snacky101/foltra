export function parentDirectory(path: string): string {
  const value = path.trim().replace(/[\\/]+$/, '');
  const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return index < 0 ? '' : value.slice(0, index + 1);
}

export function suggestedVaultPath(directory: string, name: string): string {
  if (!directory) return '';
  let folder = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/, '');
  if (!folder) folder = '새로운공간';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(folder)) folder = `_${folder}`;
  const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/';
  return `${directory.replace(/[\\/]+$/, '')}${separator}${folder}`;
}
