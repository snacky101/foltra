import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// Runs after the single workspace build, before Tauri copies and signs the app.
export async function stageCli({ root = ROOT, env = process.env, execute = execFileSync } = {}) {
  if (env.TAURI_ENV_PLATFORM !== 'darwin') return;
  if (!['true', 'false'].includes(env.TAURI_ENV_DEBUG))
    throw new Error('Run CLI packaging through Tauri beforeBundleCommand.');
  const profile = env.TAURI_ENV_DEBUG === 'true' ? 'debug' : 'release';
  const source = resolve(root, env.CARGO_TARGET_DIR ?? 'target', profile, 'foltra');
  const destination = resolve(root, 'target/bundle-cli/foltra');
  const metadata = await stat(source).catch((error) => {
    if (error.code === 'ENOENT')
      throw new Error(`Missing CLI ${source}. Build the app with --workspace (make build or make release).`);
    throw error;
  });
  if (!metadata.isFile() || !metadata.size || !(metadata.mode & 0o111))
    throw new Error(`CLI is not a nonempty executable: ${source}`);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o755);
  // macOS.files are copied after Tauri gathers its binaries to sign.
  // Match the app's current ad-hoc signing identity without changing the build output.
  execute('/usr/bin/codesign', ['--force', '--sign', '-', destination], { stdio: 'pipe' });
  return destination;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await stageCli();
  } catch (error) {
    console.error(`CLI packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
