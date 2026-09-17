import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, vi } from 'vitest';

// Replace only transport; exercise the same seed function against the real CLI and file core.
vi.mock('./api', async () => {
  const { execFileSync } = await import('node:child_process');
  return {
    call: async (vault: string, command: string, args = {}) =>
      JSON.parse(
        execFileSync(
          resolve('target/debug/foltra'),
          ['--vault', vault, command, '--args', JSON.stringify(args)],
          { encoding: 'utf8' },
        ),
      ),
  };
});
import { call } from './api';
import { seedVault } from './seed';
import type { Note, Workspace } from './types';
import type { SqlResult } from './sqlQuery';

test('starter database rows open their own body notes and welcome query points to that database', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'foltra-seed-'));
  try {
    await call(vault, 'vault.init', { name: 'Starter test' });
    await seedVault(vault);
    const workspace = await call<Workspace>(vault, 'workspace.get');
    expect(workspace.settings.vim).toBe(false);
    expect(workspace.records).toHaveLength(3);
    expect(workspace.notes).toHaveLength(7);
    for (const row of workspace.records) {
      expect(row.bodyNoteId).toBeTruthy();
      const body = await call<Note>(vault, 'note.read', { id: row.bodyNoteId });
      expect(body.title).toBe(row.values.title);
      expect(body.body.length).toBeGreaterThan(20);
    }
    const welcome = workspace.notes.find((note) => note.title === '폴트라에 오신 것을 환영해요')!;
    const body = (await call<Note>(vault, 'note.read', { id: welcome.id })).body;
    const sql = body.match(/```foltra-sql\n([\s\S]*?)\n```/)?.[1];
    expect(sql).toContain('"Reading room"');
    expect(sql).not.toContain(workspace.databases[0].id);
    const result = await call<SqlResult>(vault, 'query.sql', { sql });
    expect(result.rows).toHaveLength(3);
    expect(result.rows.flat()).toContain('생각을 정리하는 공간');
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
  // The native integration launches a fresh CLI for every seed operation.
}, 20_000);
