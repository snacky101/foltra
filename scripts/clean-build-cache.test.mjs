import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildCleanArguments, run } from './clean-build-cache.mjs';

const hostOutput = 'rustc 1.90.0\nhost: aarch64-apple-darwin\n';
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
    '--offline',
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

test('metadata filters to the compiler host before cleanup and calls inherit the environment', () => {
  const calls = [];
  run([], {
    root: '/repo with spaces',
    execute(command, args, options) {
      calls.push({ command, args, options });
      return command === 'rustc' ? hostOutput : JSON.stringify(metadata);
    },
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], {
    command: 'rustc',
    args: ['-vV'],
    options: { cwd: '/repo with spaces', encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  });
  assert.deepEqual(calls[1], {
    command: 'cargo',
    args: [
      'metadata',
      '--locked',
      '--offline',
      '--format-version',
      '1',
      '--filter-platform',
      'aarch64-apple-darwin',
    ],
    options: { cwd: '/repo with spaces', encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  });
  assert.deepEqual(calls[2], {
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
      return command === 'rustc' ? hostOutput : JSON.stringify(metadata);
    },
  });
  assert.deepEqual(calls[2], [
    ...buildCleanArguments(metadata).slice(0, 5),
    '--dry-run',
    '--verbose',
    ...buildCleanArguments(metadata).slice(5),
  ]);
});

test('unknown, repeated and package-selection arguments fail before any Cargo command', () => {
  for (const args of [['--all'], ['--release'], ['-p', 'foltra-cli'], ['--dry-run', '--dry-run']])
    assert.throws(() => run(args, { execute: () => assert.fail('Cargo must not run') }), /Usage:/);
});

test('compiler host and metadata command failures prevent cleanup', () => {
  const failure = new Error('offline dependency unavailable');
  for (const failureCall of [1, 2]) {
    let calls = 0;
    assert.throws(
      () =>
        run([], {
          execute() {
            if (++calls === failureCall) throw failure;
            return hostOutput;
          },
        }),
      (error) => error === failure,
    );
    assert.equal(calls, failureCall);
  }
});

test('an unknown compiler host fails before metadata or cleanup', () => {
  let calls = 0;
  assert.throws(
    () =>
      run([], {
        execute() {
          calls++;
          return 'rustc 1.90.0';
        },
      }),
    /host platform/,
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
        execute(command) {
          if (command === 'rustc') return hostOutput;
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
          if (command === 'rustc') return hostOutput;
          if (args[0] === 'metadata') return JSON.stringify(metadata);
          throw failure;
        },
      }),
    (error) => error === failure,
  );
});

test('cold cache cleanup succeeds without downloading inactive platform dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'foltra-clean-cold-'));
  const execute = (command, args, options = {}) =>
    execFileSync(command, args, {
      ...options,
      cwd: root,
      env: { ...process.env, CARGO_HOME: join(root, 'cargo-home'), CARGO_TARGET_DIR: join(root, 'target') },
      encoding: 'utf8',
      stdio: 'pipe',
    });
  const write = (name, content) => {
    const file = join(root, name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  };
  try {
    write('Cargo.toml', '[workspace]\nmembers = ["core", "cli", "desktop"]\nresolver = "2"\n');
    write(
      'core/Cargo.toml',
      '[package]\nname="foltra-core"\nversion="0.1.0"\nedition="2021"\n[target.\'cfg(target_os = "android")\'.dependencies]\nandroid-only="1.0.0"\n',
    );
    write('core/src/lib.rs', '');
    for (const name of ['cli', 'desktop']) {
      write(`${name}/Cargo.toml`, `[package]\nname="foltra-${name}"\nversion="0.1.0"\nedition="2021"\n`);
      write(`${name}/src/main.rs`, 'fn main() {}');
    }
    write(
      'registry/index/an/dr/android-only',
      JSON.stringify({
        name: 'android-only',
        vers: '1.0.0',
        deps: [],
        cksum: '0'.repeat(64),
        features: {},
        yanked: false,
      }) + '\n',
    );
    write(
      '.cargo/config.toml',
      `[source.crates-io]\nreplace-with="fixture"\n[source.fixture]\nlocal-registry=${JSON.stringify(join(root, 'registry'))}\n`,
    );
    execute('cargo', ['generate-lockfile', '--offline']);
    const lock = readFileSync(join(root, 'Cargo.lock'), 'utf8');
    assert.match(lock, /name = "android-only"/);
    assert.throws(
      () => execute('cargo', ['metadata', '--locked', '--offline', '--format-version', '1']),
      /failed to download `android-only/,
    );
    // No build or real application is needed to exercise Cargo's package-restricted cleanup.
    const preserved = [
      'debug/foltra',
      'debug/foltra-desktop',
      'debug/bundle/macos/Foltra.app/Contents/MacOS/foltra-desktop',
      'release/foltra',
    ];
    for (const name of preserved) write(`target/${name}`, `preserve ${name}`);
    const calls = [];
    run([], {
      root,
      execute(command, args, options) {
        calls.push({ command, args });
        return execute(command, args, options);
      },
    });
    assert.equal(calls.length, 3);
    assert(calls[1].args.includes('--filter-platform'));
    assert.equal(calls[2].args.filter((arg) => arg === '-p').length, 1);
    assert.match(calls[2].args.at(-1), /foltra-core@0\.1\.0$/);
    assert.equal(readFileSync(join(root, 'Cargo.lock'), 'utf8'), lock);
    assert.equal(existsSync(join(root, 'registry/android-only-1.0.0.crate')), false);
    for (const name of preserved)
      assert.equal(readFileSync(join(root, 'target', name), 'utf8'), `preserve ${name}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
