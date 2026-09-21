import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  artifactNames,
  assertPromotion,
  assertVersionAlignment,
  compareVersions,
  parseVersion,
  sha256,
  validateArchiveEntries,
  validateBuildSource,
  validateChecksums,
  validateManifest,
  verifyUpdaterSignature,
  versionFromTag,
  waitForGitHubVisibility,
} from './release-update.mjs';

function manifest(version = '0.1.0-preview.2') {
  return {
    version,
    notes: '변경 사항',
    pub_date: '2026-09-18T00:00:00.000Z',
    platforms: {
      'darwin-aarch64': {
        signature: 'fixture signature',
        url: `https://github.com/snacky101/foltra/releases/download/${encodeURIComponent(`v${version}`)}/Foltra.app.tar.gz`,
      },
    },
  };
}

test('SemVer ordering handles prereleases, numeric identifiers and build metadata', () => {
  const ordered = [
    '0.1.0-preview.1',
    '0.1.0-preview.2',
    '0.1.0-preview.10',
    '0.1.0-rc.1',
    '0.1.0',
    '0.2.0',
    '1.0.0',
  ];
  for (let index = 1; index < ordered.length; index++) {
    assert.equal(compareVersions(ordered[index - 1], ordered[index]), -1);
    assert.equal(compareVersions(ordered[index], ordered[index - 1]), 1);
  }
  assert.equal(compareVersions('1.0.0+build.1', '1.0.0+build.2'), 0);
  assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1);
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1);
});

test('invalid release versions and unsafe tags are rejected', () => {
  for (const value of [
    '0.1',
    '01.1.0',
    '1.0.0-01',
    '1.0.0-',
    '1.0.0-a..b',
    '1.0.0\n',
    '../1.0.0',
    '1.0.0/evil',
  ]) {
    assert.throws(() => parseVersion(value));
  }
  for (const tag of ['main', '--help', 'updater', '1.0.0', 'v1.0.0;command'])
    assert.throws(() => versionFromTag(tag));
  assert.equal(versionFromTag('v1.0.0-preview.2'), '1.0.0-preview.2');
});

test('all source versions and the source commit must agree with the tag', () => {
  const head = 'a'.repeat(40);
  assert.equal(
    assertVersionAlignment('v1.0.0', { npm: '1.0.0', Cargo: '1.0.0', Tauri: '1.0.0' }, head, head),
    '1.0.0',
  );
  assert.throws(() => assertVersionAlignment('v1.0.0', { npm: '1.0.1' }, head, head), /npm/);
  assert.throws(() => assertVersionAlignment('v1.0.0', { Cargo: undefined }, head, head), /Cargo/);
  assert.throws(() => assertVersionAlignment('v1.0.0', { npm: '1.0.0' }, head, 'b'.repeat(40)), /commit/);
});

test('manifest requires the exact immutable artifact URL and supported platform', () => {
  assert.equal(validateManifest(manifest()).version, '0.1.0-preview.2');
  for (const url of [
    'http://github.com/snacky101/foltra/test',
    'https://evil.invalid/Foltra.app.tar.gz',
    'https://github.com/snacky101/foltra/releases/download/updater/Foltra.app.tar.gz',
  ]) {
    const value = manifest();
    value.platforms['darwin-aarch64'].url = url;
    assert.throws(() => validateManifest(value), /immutable/);
  }
  const value = manifest();
  value.platforms['darwin-x86_64'] = value.platforms['darwin-aarch64'];
  assert.throws(() => validateManifest(value), /darwin-aarch64/);
  assert.throws(() => validateManifest(manifest(), '0.1.0-preview.3'), /version/);
});

test('manifest rejects missing signatures, notes and publication dates', () => {
  const value = manifest();
  value.platforms['darwin-aarch64'].signature = '';
  assert.throws(() => validateManifest(value), /signature/);
  assert.throws(() => validateManifest({ ...manifest(), notes: null }), /notes/);
  assert.throws(() => validateManifest({ ...manifest(), pub_date: 'today' }), /date/);
});

test('feed promotion refuses equal, build-only and older versions', () => {
  assertPromotion(null, manifest());
  assertPromotion(manifest('0.1.0-preview.1'), manifest());
  assertPromotion(manifest('0.1.0-preview.10'), manifest('0.1.0'));
  for (const next of ['0.1.0-preview.2', '0.1.0-preview.2+rebuild', '0.1.0-preview.1']) {
    assert.throws(() => assertPromotion(manifest(), manifest(next)), /strictly newer/);
  }
});

test('checksums detect missing, duplicate, unexpected, unsafe and changed artifacts', () => {
  const version = '0.1.0-preview.2';
  const names = artifactNames(version);
  const files = Object.fromEntries(names.map((name) => [name, Buffer.from(name)]));
  const lines = names.map((name) => `${sha256(files[name])}  ${name}`);
  validateChecksums(`${lines.join('\n')}\n`, files, version);
  assert.throws(() => validateChecksums(lines.slice(1).join('\n'), files, version), /exactly/);
  assert.throws(
    () => validateChecksums([lines[0], lines[0], ...lines.slice(2)].join('\n'), files, version),
    /duplicate/,
  );
  assert.throws(
    () => validateChecksums(lines.join('\n').replace(names[0], '../outside'), files, version),
    /Invalid/,
  );
  assert.throws(
    () => validateChecksums(lines.join('\n'), { ...files, [names[0]]: Buffer.from('changed') }, version),
    /mismatch/,
  );
});

test('updater archives require the app and reject traversal, symlinks, duplicates and oversized entries', () => {
  const entries = [
    { name: './Foltra.app/', kind: 'directory', size: 0 },
    { name: 'Foltra.app/Contents/Info.plist', kind: 'file', size: 200 },
    { name: 'Foltra.app/Contents/MacOS/foltra-desktop', kind: 'file', size: 500 },
  ];
  validateArchiveEntries(entries);
  assert.throws(() => validateArchiveEntries(entries.slice(0, 2)), /missing/);
  for (const entry of [
    { name: '/Foltra.app/outside', kind: 'file', size: 1 },
    { name: 'Foltra.app/../outside', kind: 'file', size: 1 },
    { name: 'Foltra.app/link', kind: 'unsupported', size: 0 },
    { ...entries[2], size: 2 },
    { name: 'Foltra.app/large', kind: 'file', size: 1024 ** 3 },
  ])
    assert.throws(() => validateArchiveEntries([...entries, entry]));
});

function signedFixture(bytes, algorithm = 'ED') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = Buffer.alloc(8, 9);
  const publicBytes = Buffer.concat([
    Buffer.from('Ed'),
    keyId,
    publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
  ]);
  const input = algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes;
  const signature = sign(null, input, privateKey);
  const comment = 'timestamp:1\tfile:test';
  const wrappedSignature = Buffer.concat([Buffer.from(algorithm), keyId, signature]);
  const globalSignature = sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
  return {
    publicKey: Buffer.from(`untrusted comment: fixture\n${publicBytes.toString('base64')}\n`).toString(
      'base64',
    ),
    signature: Buffer.from(
      `untrusted comment: fixture\n${wrappedSignature.toString('base64')}\ntrusted comment: ${comment}\n${globalSignature.toString('base64')}\n`,
    ).toString('base64'),
  };
}

test('Minisign verifies prehashed and legacy signatures and rejects tampering', () => {
  const bytes = Buffer.from('signed update');
  for (const algorithm of ['ED', 'Ed']) {
    const fixture = signedFixture(bytes, algorithm);
    verifyUpdaterSignature(bytes, fixture.signature, fixture.publicKey);
    assert.throws(
      () => verifyUpdaterSignature(Buffer.from('changed update'), fixture.signature, fixture.publicKey),
      /signature/,
    );
    const changedComment = Buffer.from(
      Buffer.from(fixture.signature, 'base64').toString().replace('timestamp:1', 'timestamp:2'),
    ).toString('base64');
    assert.throws(() => verifyUpdaterSignature(bytes, changedComment, fixture.publicKey), /trusted comment/);
    const changedKey = Buffer.from(fixture.publicKey, 'base64').toString().split('\n');
    const keyBytes = Buffer.from(changedKey[1], 'base64');
    keyBytes[2] ^= 1;
    changedKey[1] = keyBytes.toString('base64');
    assert.throws(
      () =>
        verifyUpdaterSignature(
          bytes,
          fixture.signature,
          Buffer.from(changedKey.join('\n')).toString('base64'),
        ),
      /key/,
    );
    assert.throws(() => verifyUpdaterSignature(bytes, 'not base64', fixture.publicKey), /base64/);
  }
});

test('actual Tauri signer output verifies and rejects an altered artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'foltra-updater-sign-test-'));
  try {
    const keyPath = join(directory, 'fixture.key');
    const artifact = join(directory, 'fixture.bin');
    const cli = join(process.cwd(), 'node_modules/.bin/tauri');
    // Output includes a disposable private key: capture it, never print it.
    const signer = (args) => {
      try {
        execFileSync(cli, ['signer', ...args], { stdio: 'pipe' });
      } catch {
        throw new Error('Disposable Tauri signer fixture failed');
      }
    };
    signer(['generate', '--ci', '-w', keyPath, '-p', '']);
    const bytes = Buffer.from('Foltra updater fixture\0with binary content');
    await writeFile(artifact, bytes);
    signer(['sign', '-f', keyPath, '-p', '', artifact]);
    const [signature, publicKey] = await Promise.all([
      readFile(`${artifact}.sig`, 'utf8'),
      readFile(`${keyPath}.pub`, 'utf8'),
    ]);
    verifyUpdaterSignature(bytes, signature, publicKey);
    assert.throws(
      () => verifyUpdaterSignature(Buffer.concat([bytes, Buffer.from('tampered')]), signature, publicKey),
      /signature/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('release publication waits for an absent draft and stale publication/feed reads', async () => {
  for (const states of [
    [null, null, { draft: true }],
    [{ draft: true }, { draft: false }],
    [null, { version: 'old' }, { version: 'new' }],
  ]) {
    const expected = states.at(-1);
    const delays = [];
    const reads = [...states];
    const result = await waitForGitHubVisibility(
      () => reads.shift(),
      (value) => value === expected,
      'fixture release',
      async (delay) => {
        delays.push(delay);
      },
    );
    assert.equal(result, expected);
    assert.equal(reads.length, 0);
    assert.equal(delays.length, states.length - 1);
  }
});

test('visibility retries are bounded and do not hide API errors', async () => {
  let reads = 0;
  const delays = [];
  await assert.rejects(
    waitForGitHubVisibility(
      () => {
        reads++;
        return null;
      },
      Boolean,
      'missing release',
      async (delay) => {
        delays.push(delay);
      },
    ),
    /GitHub has not exposed missing release/,
  );
  assert.equal(reads, 6);
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000]);
  await assert.rejects(
    waitForGitHubVisibility(
      () => {
        throw new Error('HTTP 403');
      },
      Boolean,
      'forbidden release',
      async () => assert.fail('Permission failures must not be retried'),
    ),
    /HTTP 403/,
  );
});

test('prepared releases require the exact source, tag, run and sealed checksum list', () => {
  const expected = {
    tag: 'v0.1.0-preview.5',
    head: 'a'.repeat(40),
    checksums: Buffer.from('verified checksums\n'),
    runId: '123456',
  };
  const record = {
    repository: 'snacky101/foltra',
    tag: expected.tag,
    head: expected.head,
    checksumsSha256: sha256(expected.checksums),
    runId: expected.runId,
  };
  validateBuildSource(record, expected);
  for (const changed of [
    { repository: 'someone/foltra' },
    { tag: 'v0.1.0-preview.4' },
    { head: 'b'.repeat(40) },
    { head: undefined },
  ])
    assert.throws(() => validateBuildSource({ ...record, ...changed }, expected), /source commit and tag/);
  assert.throws(() => validateBuildSource(null, expected), /source commit and tag/);
  assert.throws(
    () => validateBuildSource(record, { ...expected, checksums: Buffer.from('changed checksums') }),
    /checksum list was changed/,
  );
  assert.throws(
    () => validateBuildSource({ ...record, runId: 'another-run' }, expected),
    /different workflow run/,
  );
  assert.throws(() => validateBuildSource({ ...record, runId: null }, expected), /different workflow run/);
  // A failed publish job reuses the build from the same run, even on a new attempt.
  validateBuildSource(record, { ...expected, runAttempt: '2' });
  // Local publication still requires the immutable source and checksums.
  validateBuildSource({ ...record, runId: null }, { ...expected, runId: undefined });
});
