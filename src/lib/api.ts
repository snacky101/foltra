import { invoke, isTauri } from '@tauri-apps/api/core';
declare const __DEV_BRIDGE_TOKEN__: string;

export class CoreError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function call<T>(vault: string, command: string, args: object = {}): Promise<T> {
  try {
    if (isTauri()) return await invoke<T>('execute', { vault, command, args });
    if (!import.meta.env.DEV)
      throw new CoreError('desktop_required', 'Open Foltra as a desktop application.');
    const response = await fetch('/__foltra', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Foltra-Token': __DEV_BRIDGE_TOKEN__ },
      body: JSON.stringify({ vault, command, args }),
    });
    const value = await response.json();
    if (!response.ok) throw value.error ?? value;
    return value as T;
  } catch (error) {
    if (error instanceof CoreError) throw error;
    const e = error as { code?: string; message?: string };
    throw new CoreError(e.code ?? 'connection', e.message ?? 'Cannot connect to the vault core.');
  }
}
