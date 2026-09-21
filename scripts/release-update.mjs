import { createHash, createPublicKey, verify } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

export const REPOSITORY = 'snacky101/foltra';
export const FEED_TAG = 'updater';
const PLATFORM = 'darwin-aarch64';
const API = `repos/${REPOSITORY}`;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseVersion(version) {
  const match =
    typeof version === 'string' &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version,
    );
  requireValue(match && version.length <= 100, 'A valid SemVer version is required');
  const pre = match[4]?.split('.') ?? [];
  requireValue(
    pre.every((part) => !/^0\d+$/.test(part)),
    'Numeric prerelease identifiers cannot have leading zeros',
  );
  return { numbers: match.slice(1, 4).map(BigInt), pre };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const compare = (x, y) => (x === y ? 0 : x > y ? 1 : -1);
  for (let index = 0; index < 3; index++) {
    const difference = compare(a.numbers[index], b.numbers[index]);
    if (difference) return difference;
  }
  if (!a.pre.length || !b.pre.length) return compare(!a.pre.length, !b.pre.length);
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index++) {
    if (a.pre[index] === undefined || b.pre[index] === undefined) return compare(a.pre.length, b.pre.length);
    const [x, y] = [a.pre[index], b.pre[index]];
    if (x === y) continue;
    const [numericX, numericY] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (numericX && numericY) return compare(BigInt(x), BigInt(y));
    if (numericX !== numericY) return numericX ? -1 : 1;
    return compare(x, y);
  }
  return 0;
}

export function versionFromTag(tag) {
  requireValue(typeof tag === 'string' && tag.startsWith('v'), 'Release tags must start with v');
  const version = tag.slice(1);
  parseVersion(version);
  return version;
}

export function assertVersionAlignment(tag, versions, head, tagHead) {
  const version = versionFromTag(tag);
  for (const [name, actual] of Object.entries(versions)) {
    requireValue(actual === version, `${name} does not match ${tag}`);
  }
  requireValue(
    /^[0-9a-f]{40}$/.test(head) && head === tagHead,
    'Release tag does not point to the checked out commit',
  );
  return version;
}

export function artifactNames(version) {
  parseVersion(version);
  return [
    `Foltra_${version}_aarch64.dmg`,
    'Foltra.app.tar.gz',
    'Foltra.app.tar.gz.sig',
    `foltra-cli_${version}_macos-aarch64.tar.gz`,
    'latest.json',
  ];
}

export function validateManifest(manifest, version = manifest?.version) {
  parseVersion(version);
  requireValue(manifest?.version === version, 'Manifest version does not match release');
  requireValue(
    manifest.platforms && Object.keys(manifest.platforms).length === 1 && manifest.platforms[PLATFORM],
    'Manifest must contain only darwin-aarch64',
  );
  const target = manifest.platforms[PLATFORM];
  const url = `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(`v${version}`)}/Foltra.app.tar.gz`;
  requireValue(target.url === url, 'Updater artifact must use the immutable release URL');
  requireValue(
    typeof target.signature === 'string' && target.signature.length > 0 && target.signature.length < 4096,
    'Updater signature is required',
  );
  requireValue(typeof manifest.notes === 'string' && manifest.notes.length <= 65536, 'Invalid release notes');
  requireValue(
    typeof manifest.pub_date === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(manifest.pub_date) &&
      Number.isFinite(Date.parse(manifest.pub_date)),
    'Invalid publication date',
  );
  return manifest;
}

export function assertPromotion(previous, candidate) {
  validateManifest(candidate);
  if (previous) {
    validateManifest(previous);
    requireValue(
      compareVersions(candidate.version, previous.version) > 0,
      'Feed promotion requires a strictly newer version',
    );
  }
}

function decodeBase64(value) {
  requireValue(
    typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value),
    'Invalid base64 encoding',
  );
  const bytes = Buffer.from(value, 'base64');
  requireValue(bytes.toString('base64') === value, 'Invalid base64 encoding');
  return bytes;
}

// Tauri wraps the standard Minisign key/signature text in base64. The Ed25519
// operations use Node/OpenSSL; the container follows minisign-verify's format.
export function verifyUpdaterSignature(bytes, encodedSignature, encodedPublicKey) {
  const publicLines = decodeBase64(encodedPublicKey.trim()).toString('utf8').trimEnd().split(/\r?\n/);
  const signatureLines = decodeBase64(encodedSignature.trim()).toString('utf8').trimEnd().split(/\r?\n/);
  requireValue(publicLines.length === 2 && signatureLines.length === 4, 'Invalid Minisign document');
  requireValue(
    publicLines[0].startsWith('untrusted comment: ') && signatureLines[0].startsWith('untrusted comment: '),
    'Invalid Minisign header',
  );
  const publicBytes = decodeBase64(publicLines[1]);
  const signatureBytes = decodeBase64(signatureLines[1]);
  const globalSignature = decodeBase64(signatureLines[3]);
  requireValue(
    publicBytes.length === 42 && signatureBytes.length === 74 && globalSignature.length === 64,
    'Invalid Minisign length',
  );
  requireValue(
    ['Ed', 'ED'].includes(publicBytes.subarray(0, 2).toString()) &&
      ['Ed', 'ED'].includes(signatureBytes.subarray(0, 2).toString()),
    'Unsupported Minisign algorithm',
  );
  requireValue(
    publicBytes.subarray(2, 10).equals(signatureBytes.subarray(2, 10)),
    'Updater signing key does not match app public key',
  );
  requireValue(signatureLines[2].startsWith('trusted comment: '), 'Invalid Minisign trusted comment');
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicBytes.subarray(10)]),
    format: 'der',
    type: 'spki',
  });
  const signature = signatureBytes.subarray(10);
  const message =
    signatureBytes.subarray(0, 2).toString() === 'ED'
      ? createHash('blake2b512').update(bytes).digest()
      : bytes;
  requireValue(verify(null, message, key, signature), 'Updater artifact signature is invalid');
  const comment = Buffer.from(signatureLines[2].slice('trusted comment: '.length));
  requireValue(
    verify(null, Buffer.concat([signature, comment]), key, globalSignature),
    'Updater trusted comment signature is invalid',
  );
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function validateChecksums(checksums, files, version) {
  const expected = artifactNames(version);
  const lines = checksums.trimEnd().split('\n');
  requireValue(lines.length === expected.length, 'Checksum list must cover exactly the release artifacts');
  const seen = new Set();
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  ([^/\\\r\n]+)$/.exec(line);
    requireValue(
      match && expected.includes(match[2]) && !seen.has(match[2]),
      'Invalid or duplicate checksum entry',
    );
    seen.add(match[2]);
    requireValue(files[match[2]] && sha256(files[match[2]]) === match[1], `Checksum mismatch: ${match[2]}`);
  }
}

export function validateArchiveEntries(entries) {
  requireValue(
    Array.isArray(entries) && entries.length > 0 && entries.length <= 10000,
    'Invalid updater archive entry count',
  );
  const names = new Set();
  let totalSize = 0;
  for (const entry of entries) {
    const name = entry.name.replace(/^\.\//, '').replace(/\/$/, '');
    requireValue(
      name === 'Foltra.app' || name.startsWith('Foltra.app/'),
      'Updater archive contains a path outside Foltra.app',
    );
    requireValue(
      !name.includes('\\') &&
        !/[\r\n\0]/.test(name) &&
        name.split('/').every((part) => part && part !== '.' && part !== '..'),
      'Unsafe updater archive path',
    );
    requireValue(
      !names.has(name) && ['file', 'directory'].includes(entry.kind),
      'Updater archive contains a duplicate or unsupported entry',
    );
    requireValue(
      Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= 512 * 1024 * 1024,
      'Invalid updater archive size',
    );
    totalSize += entry.size;
    names.add(name);
  }
  requireValue(totalSize <= 1024 * 1024 * 1024, 'Updater archive is too large');
  for (const path of ['Foltra.app/Contents/Info.plist', 'Foltra.app/Contents/MacOS/foltra-desktop']) {
    requireValue(
      entries.some(
        (entry) => entry.name.replace(/^\.\//, '') === path && entry.kind === 'file' && entry.size > 0,
      ),
      'Updater archive is missing the app metadata or executable',
    );
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function ghApi(path, { optional = false } = {}) {
  const result = spawnSync('gh', ['api', path], { encoding: 'utf8' });
  if (result.status !== 0) {
    if (optional && /HTTP 404/.test(result.stderr ?? '')) return null;
    throw new Error(`GitHub API failed: ${path}: ${result.stderr ?? result.error?.message}`);
  }
  return JSON.parse(result.stdout);
}

function releaseFor(tag) {
  const published = ghApi(`${API}/releases/tags/${encodeURIComponent(tag)}`, { optional: true });
  if (published) return published;
  // The tag endpoint documents published releases only. Draft repair must also
  // query the authenticated release list, which includes drafts for writers.
  const pages = JSON.parse(run('gh', ['api', '--paginate', '--slurp', `${API}/releases?per_page=100`]));
  return pages.flat().find((release) => release.tag_name === tag) ?? null;
}

// GitHub may briefly return the old release list after a successful write.
// Retry reads only; never repeat creation, uploads or publication automatically.
export async function waitForGitHubVisibility(read, ready, description, pause = setTimeout) {
  for (const delay of [0, 1000, 2000, 4000, 8000, 16000]) {
    if (delay) await pause(delay);
    const result = read();
    if (ready(result)) return result;
  }
  throw new Error(`GitHub has not exposed ${description} yet; retry after checking the release.`);
}

function currentFeed() {
  const release = releaseFor(FEED_TAG);
  if (!release) return null;
  requireValue(
    !release.draft && release.prerelease,
    'Existing updater release must be a published prerelease',
  );
  const asset = release.assets.find((item) => item.name === 'latest.json');
  requireValue(asset, 'Existing updater release is missing latest.json; repair it before publishing');
  const manifest = JSON.parse(
    run('gh', ['api', `${API}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream']),
  );
  return validateManifest(manifest);
}

async function sourceVersion(tag) {
  const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
  const [npm, lock, tauri, cargo, cargoLock] = await Promise.all([
    json('package.json'),
    json('package-lock.json'),
    json('src-tauri/tauri.conf.json'),
    readFile('Cargo.toml', 'utf8'),
    readFile('Cargo.lock', 'utf8'),
  ]);
  const versions = {
    npm: npm.version,
    'npm lock': lock.version,
    'npm lock root': lock.packages?.['']?.version,
    Tauri: tauri.version,
    Cargo: /\[workspace\.package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1],
  };
  for (const name of ['foltra-core', 'foltra-cli', 'foltra-desktop']) {
    const block = cargoLock
      .split('[[package]]')
      .find((part) => new RegExp(`^name = "${name}"$`, 'm').test(part));
    versions[`Cargo lock ${name}`] = block && /^version = "([^"]+)"/m.exec(block)?.[1];
  }
  const head = run('git', ['rev-parse', 'HEAD']);
  const tagHead = run('git', ['rev-parse', `refs/tags/${tag}^{commit}`]);
  const version = assertVersionAlignment(tag, versions, head, tagHead);
  requireValue(
    !process.env.GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY === REPOSITORY,
    'Release publishing is restricted to the Foltra repository',
  );
  requireValue(
    !run('git', ['status', '--porcelain', '--untracked-files=no']),
    'Release source contains uncommitted tracked changes',
  );
  requireValue(
    ghApi(`${API}/commits/${encodeURIComponent(tag)}`).sha === head,
    'Remote release tag does not point to the checked out commit',
  );
  return { version, head, publicKey: tauri.plugins?.updater?.pubkey };
}

function verifyMacApp(bundle, version) {
  const plist = `${bundle}/Contents/Info.plist`;
  for (const [key, expected] of [
    ['CFBundleShortVersionString', version],
    ['CFBundleIdentifier', 'app.foltra.desktop'],
    ['CFBundleExecutable', 'foltra-desktop'],
  ]) {
    requireValue(
      run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]) === expected,
      `Built app ${key} does not match release`,
    );
  }
  requireValue(
    run('/usr/bin/lipo', ['-archs', `${bundle}/Contents/MacOS/foltra-desktop`]) === 'arm64',
    'Release app is not arm64',
  );
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
}

export async function verifyArchive(path, version) {
  const entries = JSON.parse(
    run(
      'python3',
      [
        '-c',
        'import json, sys, tarfile\nwith tarfile.open(sys.argv[1], "r:gz") as archive:\n print(json.dumps([{"name": m.name, "size": m.size, "kind": "directory" if m.isdir() else "file" if m.isfile() else "unsupported"} for m in archive.getmembers()]))',
        path,
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    ),
  );
  validateArchiveEntries(entries);
  const directory = await mkdtemp(join(tmpdir(), 'foltra-archive-'));
  try {
    run('/usr/bin/tar', ['-xzf', path, '-C', directory]);
    verifyMacApp(join(directory, 'Foltra.app'), version);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function verifyDirectory(directory, version, publicKey) {
  const files = Object.fromEntries(
    await Promise.all(
      artifactNames(version).map(async (name) => [name, await readFile(join(directory, name))]),
    ),
  );
  validateChecksums(await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8'), files, version);
  const manifest = validateManifest(JSON.parse(files['latest.json'].toString()), version);
  requireValue(
    manifest.platforms[PLATFORM].signature === files['Foltra.app.tar.gz.sig'].toString().trim(),
    'Manifest and detached signature differ',
  );
  verifyUpdaterSignature(files['Foltra.app.tar.gz'], manifest.platforms[PLATFORM].signature, publicKey);
  await verifyArchive(join(directory, 'Foltra.app.tar.gz'), version);
  return manifest;
}

async function prepare(version, publicKey) {
  requireValue(
    process.platform === 'darwin' && process.arch === 'arm64',
    'Release packaging requires an Apple Silicon Mac',
  );
  const directory = resolve('target/release/update-assets');
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const bundle = 'target/release/bundle/macos/Foltra.app';
  verifyMacApp(bundle, version);
  requireValue(
    run('/usr/bin/lipo', ['-archs', 'target/release/foltra']) === 'arm64',
    'Release CLI is not arm64',
  );
  const names = artifactNames(version);
  run('/usr/bin/hdiutil', ['verify', `target/release/bundle/dmg/${names[0]}`]);
  await copyFile(`target/release/bundle/dmg/${names[0]}`, join(directory, names[0]));
  for (const name of names.slice(1, 3))
    await copyFile(`target/release/bundle/macos/${name}`, join(directory, name));
  run('/usr/bin/tar', ['-czf', join(directory, names[3]), '-C', 'target/release', 'foltra'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  const signature = (await readFile(join(directory, names[2]), 'utf8')).trim();
  const manifest = validateManifest({
    version,
    notes: `Foltra ${version}\nhttps://github.com/${REPOSITORY}/releases/tag/v${version}`,
    pub_date: new Date().toISOString(),
    platforms: {
      [PLATFORM]: {
        url: `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(`v${version}`)}/Foltra.app.tar.gz`,
        signature,
      },
    },
  });
  await writeFile(join(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const checksums = await Promise.all(
    names.map(async (name) => `${sha256(await readFile(join(directory, name)))}  ${name}\n`),
  );
  await writeFile(join(directory, 'SHA256SUMS.txt'), checksums.join(''));
  await verifyDirectory(directory, version, publicKey);
  return directory;
}

async function downloadAndVerify(tag, version, publicKey) {
  const release = releaseFor(tag);
  const names = [...artifactNames(version), 'SHA256SUMS.txt'];
  requireValue(
    release &&
      release.assets.length === names.length &&
      release.assets.every((asset) => names.includes(asset.name) && asset.state === 'uploaded'),
    'Release must contain exactly the complete uploaded artifact set',
  );
  const directory = await mkdtemp(join(tmpdir(), 'foltra-release-'));
  try {
    run('gh', ['release', 'download', tag, '--repo', REPOSITORY, '--dir', directory]);
    return await verifyDirectory(directory, version, publicKey);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function validateRelease(release, tag, head) {
  requireValue(
    release && release.tag_name === tag && release.target_commitish === head,
    'Existing release points to a different source commit',
  );
  requireValue(
    release.prerelease === parseVersion(versionFromTag(tag)).pre.length > 0,
    'Existing release channel does not match its version',
  );
}

export function validateBuildSource(record, { tag, head, checksums, runId }) {
  requireValue(
    record?.repository === REPOSITORY &&
      record.tag === tag &&
      record.head === head &&
      /^[0-9a-f]{40}$/.test(head),
    'Prepared assets do not match the release source commit and tag',
  );
  requireValue(record.checksumsSha256 === sha256(checksums), 'Prepared asset checksum list was changed');
  requireValue(!runId || record.runId === runId, 'Prepared assets came from a different workflow run');
}

async function verifyPrepared(directory, tag, source) {
  const names = [...artifactNames(source.version), 'SHA256SUMS.txt', 'BUILD_SOURCE.json'];
  const entries = await readdir(directory);
  requireValue(
    entries.length === names.length && entries.every((name) => names.includes(name)),
    'Prepared assets must contain exactly the release files and source record',
  );
  for (const name of names)
    requireValue((await lstat(join(directory, name))).isFile(), 'Prepared assets must be regular files');
  validateBuildSource(JSON.parse(await readFile(join(directory, 'BUILD_SOURCE.json'), 'utf8')), {
    tag,
    head: source.head,
    checksums: await readFile(join(directory, 'SHA256SUMS.txt')),
    runId: process.env.GITHUB_RUN_ID,
  });
  await verifyDirectory(directory, source.version, source.publicKey);
  return directory;
}

async function publish(tag, source, preparedDirectory) {
  let release = releaseFor(tag);
  if (release) validateRelease(release, tag, source.head);
  if (!release || release.draft) {
    const directory = preparedDirectory
      ? await verifyPrepared(resolve(preparedDirectory), tag, source)
      : await prepare(source.version, source.publicKey);
    const candidate = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
    assertPromotion(currentFeed(), candidate);
    if (!release) {
      run('gh', [
        'release',
        'create',
        tag,
        '--repo',
        REPOSITORY,
        '--verify-tag',
        '--target',
        source.head,
        '--draft',
        '--latest=false',
        `--prerelease=${parseVersion(source.version).pre.length > 0}`,
        '--title',
        `Foltra ${source.version}`,
        '--generate-notes',
      ]);
      release = await waitForGitHubVisibility(() => releaseFor(tag), Boolean, `the draft ${tag}`);
    }
    validateRelease(release, tag, source.head);
    requireValue(release.draft, 'Cannot replace artifacts of a published release');
    run('gh', [
      'release',
      'upload',
      tag,
      '--repo',
      REPOSITORY,
      '--clobber',
      ...[...artifactNames(source.version), 'SHA256SUMS.txt'].map((name) => join(directory, name)),
    ]);
    await downloadAndVerify(tag, source.version, source.publicKey);
    // No installation can see this version until every asset has been verified.
    run('gh', ['release', 'edit', tag, '--repo', REPOSITORY, '--draft=false', '--latest=false']);
  }
  release = await waitForGitHubVisibility(
    () => releaseFor(tag),
    (value) => value && !value.draft,
    `the published release ${tag}`,
  );
  validateRelease(release, tag, source.head);
  requireValue(!release.draft, 'Release must be published before promoting the feed');
  const candidate = await downloadAndVerify(tag, source.version, source.publicKey);
  assertPromotion(currentFeed(), candidate);
  const directory = await mkdtemp(join(tmpdir(), 'foltra-feed-'));
  try {
    const file = join(directory, 'latest.json');
    await writeFile(file, `${JSON.stringify(candidate, null, 2)}\n`);
    if (releaseFor(FEED_TAG)) {
      run('gh', ['release', 'upload', FEED_TAG, file, '--repo', REPOSITORY, '--clobber']);
    } else {
      run('gh', [
        'release',
        'create',
        FEED_TAG,
        file,
        '--repo',
        REPOSITORY,
        '--target',
        source.head,
        '--prerelease',
        '--latest=false',
        '--title',
        'Foltra update feed',
        '--notes',
        'Update metadata only. Download installers from the versioned Foltra releases.',
      ]);
    }
    await waitForGitHubVisibility(
      currentFeed,
      (value) => JSON.stringify(value) === JSON.stringify(candidate),
      'the verified updater feed',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  console.log(`Published and verified ${tag}; updater feed promoted.`);
}

async function main() {
  const [command, tag, flag, directory, ...extra] = process.argv.slice(2);
  requireValue(
    ['preflight', 'prepare', 'publish'].includes(command) &&
      !extra.length &&
      (!flag || (command === 'publish' && flag === '--prepared' && directory)),
    'Usage: node scripts/release-update.mjs preflight|prepare|publish vVERSION [--prepared DIRECTORY]',
  );
  versionFromTag(tag);
  const source = await sourceVersion(tag);
  if (command === 'publish') return publish(tag, source, directory);
  if (command === 'prepare') {
    const prepared = await prepare(source.version, source.publicKey);
    await writeFile(
      join(prepared, 'BUILD_SOURCE.json'),
      `${JSON.stringify(
        {
          repository: REPOSITORY,
          tag,
          head: source.head,
          runId: process.env.GITHUB_RUN_ID ?? null,
          checksumsSha256: sha256(await readFile(join(prepared, 'SHA256SUMS.txt'))),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`Verified release assets for ${tag} at ${source.head}.`);
    return;
  }
  const release = releaseFor(tag);
  if (release) validateRelease(release, tag, source.head);
  const feed = currentFeed();
  if (feed)
    requireValue(
      compareVersions(source.version, feed.version) > 0,
      'Release version must be newer than the current updater feed',
    );
  if (process.env.GITHUB_OUTPUT)
    await writeFile(
      process.env.GITHUB_OUTPUT,
      `build=${!release || release.draft}\nversion=${source.version}\nhead=${source.head}\n`,
      { flag: 'a' },
    );
  console.log(
    `Validated ${tag} at ${source.head}; ${release && !release.draft ? 'retry feed promotion without rebuilding' : 'build required'}.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
