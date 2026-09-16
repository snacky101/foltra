import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './api';
import type { Workspace } from './types';
import { seedVault } from './seed';
import { readRecentVaults, rememberVault } from './recentVaults';

export function useWorkspace() {
  const [path, setPath] = useState(() => localStorage.getItem('foltra:last-vault') ?? '');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [recentVaults, setRecentVaults] = useState(() =>
    readRecentVaults(localStorage.getItem('foltra:recent-vaults')),
  );
  useEffect(() => {
    localStorage.setItem('foltra:recent-vaults', JSON.stringify(recentVaults));
  }, [recentVaults]);
  useEffect(() => {
    if (workspace)
      setRecentVaults((recent) =>
        rememberVault(recent, { path: workspace.path, name: workspace.vault.name }),
      );
  }, [workspace?.path, workspace?.vault.name]);
  const serial = useRef(0);
  const refresh = useCallback(async () => {
    if (!path) return;
    const request = ++serial.current;
    try {
      const value = await call<Workspace>(path, 'workspace.get');
      if (request !== serial.current) return;
      setWorkspace((old) => (JSON.stringify(old) === JSON.stringify(value) ? old : value));
      setError('');
    } catch (e) {
      if (request === serial.current) setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    return () => {
      serial.current++;
      clearInterval(interval);
    };
  }, [refresh]);
  const open = async (target: string) => {
    const value = await call<Workspace>(target, 'workspace.get');
    serial.current++;
    setPath(value.path);
    setWorkspace(value);
    setError('');
    localStorage.setItem('foltra:last-vault', value.path);
  };
  const create = async (target: string, name: string, demo: boolean) => {
    await call(target, 'vault.init', { name });
    if (demo) await seedVault(target);
    await open(target);
  };
  const close = () => {
    serial.current++;
    setPath('');
    setWorkspace(null);
    setError('');
    localStorage.removeItem('foltra:last-vault');
  };
  const forget = (target: string) => {
    if (target === path || target === workspace?.path) close();
    setRecentVaults((recent) => recent.filter((vault) => vault.path !== target));
  };
  return { path, workspace, error, refresh, open, create, close, recentVaults, forget };
}
