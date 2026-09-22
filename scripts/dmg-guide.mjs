import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const guideFiles = ['설치 안내.html', '보안 설정.inetloc'];

// Add documents to the outer DMG only. The signed app/updater archive stay intact.
// Work on a copy, and replace the DMG only after conversion and verification succeed.
export async function addDmgGuide(dmg, { execute = execFileSync } = {}) {
  const temporary = await mkdtemp(join(dirname(dmg), '.install-guide-'));
  const writable = join(temporary, 'writable.dmg');
  const result = join(temporary, 'guided.dmg');
  const mount = join(temporary, 'mount');
  const hdiutil = (...args) => execute('/usr/bin/hdiutil', args, { stdio: 'pipe' });
  let mounted = false;
  try {
    await mkdir(mount);
    hdiutil('convert', dmg, '-format', 'UDRW', '-o', writable);
    hdiutil('attach', writable, '-readwrite', '-noverify', '-noautoopen', '-nobrowse', '-mountpoint', mount);
    mounted = true;
    for (const name of guideFiles) await copyFile(join(ROOT, 'packaging/macos', name), join(mount, name));
    hdiutil('detach', mount);
    mounted = false;
    hdiutil('convert', writable, '-format', 'UDZO', '-o', result);
    hdiutil('verify', result);
    await rename(result, dmg);
  } finally {
    if (mounted) {
      // Never recursively remove a path while a volume may still be mounted on it.
      hdiutil('detach', mount);
    }
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'darwin') throw new Error('DMG 안내 패키징은 macOS에서 실행하세요.');
    const { version } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    const dmg = process.argv[2]
      ? resolve(process.argv[2])
      : join(ROOT, `target/release/bundle/dmg/Foltra_${version}_aarch64.dmg`);
    await addDmgGuide(dmg);
    console.log('DMG에 설치 안내와 보안 설정 바로가기를 포함했습니다.');
  } catch (error) {
    console.error(`DMG 안내 패키징 실패: ${error.message}`);
    process.exitCode = 1;
  }
}
