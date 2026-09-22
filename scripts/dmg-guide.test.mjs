import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { addDmgGuide, guideFiles } from './dmg-guide.mjs';

const guide = new URL('../packaging/macos/설치 안내.html', import.meta.url);

test('the offline guide advances only on acknowledgment and supports returning to earlier steps', async () => {
  const dom = new JSDOM(await readFile(guide, 'utf8'), { runScripts: 'dangerously' });
  try {
    const document = dom.window.document;
    const next = document.querySelector('#next');
    const back = document.querySelector('#back');
    const visibleStep = () => document.querySelector('[data-step]:not([hidden])').dataset.step;
    assert.equal(visibleStep(), '0');
    assert.equal(back.hidden, true);
    next.click();
    assert.equal(visibleStep(), '1');
    next.click();
    assert.equal(visibleStep(), '2');
    assert.match(document.querySelector('#open-settings').href, /^x-apple.systempreferences:/);
    assert.equal(document.activeElement, document.querySelector('[data-step="2"] h1'));
    back.click();
    assert.equal(visibleStep(), '1');
    next.click();
    next.click();
    assert.equal(visibleStep(), '3');
    assert.equal(next.hidden, true);
    back.click();
    assert.equal(visibleStep(), '2');
    assert.equal(next.hidden, false);
    assert.equal(document.querySelectorAll('script[src], link[rel=stylesheet], iframe').length, 0);
  } finally {
    dom.window.close();
  }
});

test('a failed DMG conversion preserves the original and removes temporary copies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'foltra-dmg-failure-'));
  try {
    const dmg = join(directory, 'original.dmg');
    await writeFile(dmg, 'original');
    await assert.rejects(
      addDmgGuide(dmg, {
        execute() {
          throw new Error('conversion failed');
        },
      }),
      /conversion failed/,
    );
    assert.equal(await readFile(dmg, 'utf8'), 'original');
    assert.deepEqual(await readdir(directory), ['original.dmg']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  'DMG includes the guide and Settings shortcut without changing the application',
  { skip: process.platform !== 'darwin' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'foltra-dmg-integration-'));
    const source = join(directory, 'source');
    const dmg = join(directory, 'test.dmg');
    const mount = join(directory, 'readback');
    const run = (...args) => execFileSync('/usr/bin/hdiutil', args, { stdio: 'pipe' });
    let mounted = false;
    try {
      await mkdir(join(source, 'Foltra.app/Contents'), { recursive: true });
      await writeFile(join(source, 'Foltra.app/Contents/unchanged'), 'signed app stand-in');
      await symlink('/Applications', join(source, 'Applications'));
      run(
        'create',
        '-size',
        '16m',
        '-srcfolder',
        source,
        '-volname',
        'Foltra Guide Test',
        '-format',
        'UDZO',
        dmg,
      );
      await addDmgGuide(dmg);
      await mkdir(mount);
      run('attach', dmg, '-readonly', '-noautoopen', '-nobrowse', '-mountpoint', mount);
      mounted = true;
      assert.equal(
        await readFile(join(mount, 'Foltra.app/Contents/unchanged'), 'utf8'),
        'signed app stand-in',
      );
      for (const name of guideFiles) {
        assert.deepEqual(
          await readFile(join(mount, name)),
          await readFile(new URL(`../packaging/macos/${name}`, import.meta.url)),
        );
      }
      const { readlink } = await import('node:fs/promises');
      assert.equal(await readlink(join(mount, 'Applications')), '/Applications');
    } finally {
      if (mounted) run('detach', mount);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
