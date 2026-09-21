import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PRESERVED_PACKAGES = new Set(['foltra-cli', 'foltra-desktop']);

export function buildCleanArguments(metadata, { dryRun = false } = {}) {
  if (
    !Array.isArray(metadata?.packages) ||
    metadata.packages.some(
      (entry) =>
        typeof entry?.name !== 'string' ||
        !entry.name.trim() ||
        typeof entry?.id !== 'string' ||
        !entry.id.trim(),
    )
  )
    throw new Error('Cargo metadata does not contain valid package IDs.');
  const packages = metadata.packages.filter((entry) => !PRESERVED_PACKAGES.has(entry.name));
  if (!packages.length) throw new Error('No rebuildable packages selected; refusing broad cleanup.');
  return [
    'clean',
    '--locked',
    '--profile',
    'dev',
    ...(dryRun ? ['--dry-run', '--verbose'] : []),
    ...packages.flatMap((entry) => ['-p', entry.id]),
  ];
}

export function run(args, { root = ROOT, execute = execFileSync } = {}) {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run'))
    throw new Error('Usage: node scripts/clean-build-cache.mjs [--dry-run]');
  const metadata = JSON.parse(
    execute('cargo', ['metadata', '--locked', '--offline', '--format-version', '1'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
  execute('cargo', buildCleanArguments(metadata, { dryRun: args[0] === '--dry-run' }), {
    cwd: root,
    stdio: 'inherit',
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(`Build cache cleanup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
