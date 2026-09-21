import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stageCli } from './bundle-cli.mjs';

test('bundling stages the selected workspace CLI and signs only its copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'foltra-bundle-cli-'));
  try {
    for (const profile of ['debug', 'release']) {
      await mkdir(join(root, 'target', profile), { recursive: true });
      await writeFile(join(root, 'target', profile, 'foltra'), profile, { mode: 0o755 });
    }
    for (const [debug, profile] of [['true', 'debug'], ['false', 'release'], [undefined, 'release']]) {
      const calls = [];
      const destination = await stageCli({
        root,
        env: { TAURI_ENV_PLATFORM: 'darwin', TAURI_ENV_DEBUG: debug },
        execute: (...args) => calls.push(args),
      });
      assert.equal(destination, join(root, 'target/bundle-cli/foltra'));
      assert.equal(await readFile(destination, 'utf8'), profile);
      assert.equal((await stat(destination)).mode & 0o777, 0o755);
      assert.equal(await readFile(join(root, 'target', profile, 'foltra'), 'utf8'), profile);
      assert.deepEqual(calls, [
        ['/usr/bin/codesign', ['--force', '--sign', '-', destination], { stdio: 'pipe' }],
      ]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bundling rejects missing or nonexecutable CLI and propagates signing failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'foltra-bundle-cli-'));
  const options = {
    root,
    env: { TAURI_ENV_PLATFORM: 'darwin', TAURI_ENV_DEBUG: 'true' },
    execute: () => { throw new Error('signing failed'); },
  };
  try {
    await assert.rejects(stageCli(options), /Missing CLI.*--workspace/);
    await mkdir(join(root, 'target/debug'), { recursive: true });
    await writeFile(join(root, 'target/debug/foltra'), 'CLI', { mode: 0o644 });
    await assert.rejects(stageCli(options), /not a nonempty executable/);
    await chmod(join(root, 'target/debug/foltra'), 0o755);
    await assert.rejects(stageCli(options), /signing failed/);
    await assert.rejects(stageCli({ ...options, env: { TAURI_ENV_PLATFORM: 'darwin', TAURI_ENV_DEBUG: 'invalid' } }), /Tauri/);
    await stageCli({ ...options, env: { TAURI_ENV_PLATFORM: 'linux' } });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
