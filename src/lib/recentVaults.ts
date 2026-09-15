export interface RecentVault {
  path: string;
  name: string;
}

export function readRecentVaults(raw: string | null): RecentVault[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is RecentVault =>
          item && typeof item.path === 'string' && item.path.length > 0 && typeof item.name === 'string',
      )
      .slice(0, 20);
  } catch {
    return [];
  }
}
export function rememberVault(recent: RecentVault[], vault: RecentVault): RecentVault[] {
  if (recent[0]?.path === vault.path && recent[0].name === vault.name) return recent;
  return [vault, ...recent.filter((item) => item.path !== vault.path)].slice(0, 20);
}
