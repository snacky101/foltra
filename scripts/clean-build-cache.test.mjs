import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCleanArguments, run } from './clean-build-cache.mjs';

const metadata = {
  packages: [
    { name: 'foltra-core', id: 'path+file:///repo/crates/core#foltra-core@0.1.0-preview.2' },
    { name: 'foltra-cli', id: 'path+file:///repo/crates/cli#foltra-cli@0.1.0-preview.2' },
    { name: 'foltra-desktop', id: 'path+file:///repo/src-tauri#foltra-desktop@0.1.0-preview.2' },
    { name: 'dependency', id: 'registry+https://github.com/rust-lang/crates.io-index#dependency@1.0.0' },
    { name: 'dependency', id: 'registry+https://github.com/rust-lang/crates.io-index#dependency@2.0.0' },
  ],
};

test('cleanup selects exact IDs for every dependency and core, preserving executable packages', () => {
  assert.deepEqual(buildCleanArguments(metadata), [
    'clean',
    '--locked',
    '--profile',
    'dev',
    '-p',
    metadata.packages[0].id,
    '-p',
    metadata.packages[3].id,
    '-p',
    metadata.packages[4].id,
  ]);
});

test('metadata is resolved before cleanup and both calls inherit the environment', () => {
  const calls = [];
  run([], {
    root: '/repo with spaces',
    execute(command, args, options) {
      calls.push({ command, args, options });
      return JSON.stringify(metadata);
    },
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    command: 'cargo',
    args: ['metadata', '--locked', '--offline', '--format-version', '1'],
    options: { cwd: '/repo with spaces', encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  });
  assert.deepEqual(calls[1], {
    command: 'cargo',
    args: buildCleanArguments(metadata),
    options: { cwd: '/repo with spaces', stdio: 'inherit' },
  });
});

test('dry run passes --dry-run to cargo clean while keeping package and profile restrictions', () => {
  const calls = [];
  run(['--dry-run'], {
    execute(command, args) {
      calls.push(args);
      return JSON.stringify(metadata);
    },
  });
  assert.deepEqual(calls[1], [
    ...buildCleanArguments(metadata).slice(0, 4),
    '--dry-run',
    '--verbose',
    ...buildCleanArguments(metadata).slice(4),
  ]);
});

test('unknown, repeated and package-selection arguments fail before any Cargo command', () => {
  for (const args of [['--all'], ['--release'], ['-p', 'foltra-cli'], ['--dry-run', '--dry-run']])
    assert.throws(
      () => run(args, { execute: () => assert.fail('Cargo must not run') }),
      /Usage:/,
    );
});

test('metadata command failure prevents cleanup', () => {
  const failure = new Error('offline dependency unavailable');
  let calls = 0;
  assert.throws(
    () =>
      run([], {
        execute() {
          calls++;
          throw failure;
        },
      }),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
});

test('invalid metadata and empty selections never fall back to broad cargo clean', () => {
  for (const output of [
    'not JSON',
    'null',
    '{}',
    JSON.stringify({ packages: [] }),
    JSON.stringify({ packages: [metadata.packages[1], metadata.packages[2]] }),
    JSON.stringify({ packages: [null] }),
    JSON.stringify({ packages: [{ name: 'dependency' }] }),
    JSON.stringify({ packages: [{ name: '', id: 'dependency@1.0.0' }] }),
    JSON.stringify({ packages: [{ name: 'dependency', id: '' }] }),
  ]) {
    let calls = 0;
    assert.throws(() =>
      run([], {
        execute() {
          calls++;
          return output;
        },
      }),
    );
    assert.equal(calls, 1);
  }
});

test('Cargo cleanup failure is propagated', () => {
  const failure = new Error('Cargo could not acquire its lock');
  assert.throws(
    () =>
      run([], {
        execute(command, args) {
          if (args[0] === 'metadata') return JSON.stringify(metadata);
          throw failure;
        },
      }),
    (error) => error === failure,
  );
});
