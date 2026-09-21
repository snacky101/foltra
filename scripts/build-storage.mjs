import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const GIB = 1024 ** 3;

export function measureDirectory(directory, execute = execFileSync) {
  let path;
  try {
    path = realpathSync(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  const output = execute('du', ['-sk', path], { encoding: 'utf8' });
  const match = /^\s*(\d+)\s/.exec(output);
  const bytes = match ? Number(match[1]) * 1024 : NaN;
  if (!Number.isSafeInteger(bytes)) throw new Error(`Invalid du output for ${directory}`);
  return bytes;
}

export function run(
  command,
  {
    root = ROOT,
    targetDir = process.env.CARGO_TARGET_DIR,
    measure = measureDirectory,
    log = console.log,
  } = {},
) {
  if (command !== 'report' && command !== 'check')
    throw new Error('Usage: node scripts/build-storage.mjs report|check');
  const entries = [
    { name: 'target', path: resolve(root, targetDir ?? 'target'), limit: 15 * GIB },
    { name: 'test-results', path: resolve(root, 'test-results'), limit: GIB },
  ];
  let exceeded = false;
  for (const entry of entries) {
    const bytes = measure(entry.path);
    const over = bytes > entry.limit;
    exceeded ||= over;
    log(
      `${entry.name}: ${(bytes / GIB).toFixed(2)} / ${entry.limit / GIB} GiB${over ? ' [OVER LIMIT]' : ''} (${entry.path})`,
    );
  }
  if (exceeded) {
    log('Review make storage, then use make clean-cache to remove rebuildable native/core caches.');
    log(
      'For test-results, remove only verified inactive, disposable QA binary/source copies. Preserve release backups and evidence.',
    );
    log('The storage check never deletes files and does not cap growth during a build.');
  }
  return command === 'check' && exceeded ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = run(process.argv[2]);
  } catch (error) {
    console.error(`Build storage check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
