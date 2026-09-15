import { useEffect, useRef, useState } from 'react';
import { call } from './api';
import { parentDirectory, suggestedVaultPath } from './vaultLocation';

export function useVaultLocation(previousPath: string, initialName = '') {
  const [name, setName] = useState(initialName);
  const [directory, setDirectory] = useState(() => parentDirectory(previousPath));
  const [customPath, setCustomPath] = useState<string | null>(null);
  const [error, setError] = useState('');
  const chosen = useRef(false);
  useEffect(() => {
    if (parentDirectory(previousPath)) return;
    let active = true;
    void call<{ path: string }>('', 'vault.default')
      .then(({ path }) => {
        if (active && !chosen.current) setDirectory(parentDirectory(path));
      })
      .catch((e: Error) => {
        if (active && !chosen.current) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [previousPath]);
  const setPath = (path: string) => {
    chosen.current = true;
    setCustomPath(path);
    setError('');
  };
  const selectDirectory = (path: string) => {
    chosen.current = true;
    setDirectory(path);
    setCustomPath(null);
    setError('');
  };
  return {
    name,
    setName,
    path: customPath ?? suggestedVaultPath(directory, name),
    setPath,
    directory: customPath === null ? directory : parentDirectory(customPath),
    selectDirectory,
    error,
  };
}
