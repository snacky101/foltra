import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { measureDirectory, run } from './build-storage.mjs';

const GIB = 1024 ** 3;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'foltra storage '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('exact ceilings pass and either directory exceeding its ceiling fails check', (t) => {
  const root = fixture(t);
  for (const [target, results, expected] of [
    [15 * GIB, GIB, 0],
    [15 * GIB + 1024, GIB, 1],
    [15 * GIB, GIB + 1024, 1],
  ]) {
    const logs = [];
    const options = {
      root,
      targetDir: 'target',
      measure: (path) => (path === join(root, 'target') ? target : results),
      log: (line) => logs.push(line),
    };
    assert.equal(run('check', options), expected);
    assert.equal(
      logs.some((line) => line.includes('OVER LIMIT')),
      expected === 1,
    );
    assert.equal(
      logs.some((line) => line.includes('make clean-cache')),
      expected === 1,
    );
    assert.equal(run('report', options), 0);
  }
});

test('missing directories count zero without invoking du', (t) => {
  const missing = join(fixture(t), 'missing');
  assert.equal(
    measureDirectory(missing, () => assert.fail('du must not run')),
    0,
  );
});

test('allocated size uses du without shell interpolation, including spaces and symlinks', (t) => {
  const root = fixture(t);
  const directory = join(root, 'cache with spaces $(not-a-command)');
  mkdirSync(directory);
  writeFileSync(join(directory, 'small fixture'), 'hello');
  const link = join(root, 'linked target');
  symlinkSync(directory, link);
  const expected =
    Number(execFileSync('du', ['-sk', realpathSync(directory)], { encoding: 'utf8' }).split(/\s+/)[0]) * 1024;
  assert.equal(measureDirectory(link), expected);
  assert.equal(
    measureDirectory(directory, (command, args, options) => {
      assert.equal(command, 'du');
      assert.deepEqual(args, ['-sk', realpathSync(directory)]);
      assert.equal(options.encoding, 'utf8');
      return `42\t${directory}\n`;
    }),
    42 * 1024,
  );
});

test('filesystem and du failures propagate instead of reporting zero', (t) => {
  const root = fixture(t);
  const file = join(root, 'file');
  writeFileSync(file, 'fixture');
  assert.throws(() => measureDirectory(join(file, 'child')), { code: 'ENOTDIR' });
  for (const code of ['EACCES', 'EIO']) {
    const error = Object.assign(new Error('measurement denied'), { code });
    assert.throws(
      () =>
        measureDirectory(root, () => {
          throw error;
        }),
      (actual) => actual === error,
    );
    assert.throws(
      () =>
        run('check', {
          root,
          measure: () => {
            throw error;
          },
          log: () => {},
        }),
      (actual) => actual === error,
    );
  }
  assert.throws(() => measureDirectory(root, () => 'invalid output'), /Invalid du output/);
});

test('custom target paths leave test-results rooted in the repository', (t) => {
  const root = fixture(t);
  for (const targetDir of ['cache with spaces', join(root, 'external cache')]) {
    const measured = [];
    assert.equal(
      run('check', {
        root,
        targetDir,
        measure: (path) => {
          measured.push(path);
          return 0;
        },
        log: () => {},
      }),
      0,
    );
    assert.deepEqual(measured, [resolve(root, targetDir), join(root, 'test-results')]);
  }
});

test('CLI resolves the repository from the script and honors CARGO_TARGET_DIR', (t) => {
  const root = fixture(t);
  const script = fileURLToPath(new URL('./build-storage.mjs', import.meta.url));
  const targetDir = join(root, 'missing custom target');
  const result = spawnSync(process.execPath, [script, 'report'], {
    cwd: root,
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`target: 0.00 / 15 GiB (${targetDir})`));
  assert.ok(result.stdout.includes(resolve(fileURLToPath(new URL('../', import.meta.url)), 'test-results')));
  assert.throws(() => run('delete'), /Usage:/);
});
