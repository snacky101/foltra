import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const runner = fileURLToPath(new URL('./run-task.sh', import.meta.url));
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'foltra-task-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
function run(cwd, name, code, args = []) {
  return spawnSync('sh', [runner, name, process.execPath, '-e', code, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

test('success emits a short summary and saves complete stdout and stderr without evaluating arguments', (t) => {
  const cwd = fixture(t);
  const literal = 'space $(echo unwanted) `echo unwanted`';
  const result = run(cwd, 'verify', 'console.log(process.argv[1]); console.error("detail");', [literal]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /완료/);
  assert.ok(!result.stdout.includes(literal));
  const log = readFileSync(join(cwd, 'test-results/tasks/verify.log'), 'utf8');
  assert.ok(log.includes(literal));
  assert.ok(log.includes('detail'));
});

test('failure preserves exit status and only prints the final 40 log lines', (t) => {
  const cwd = fixture(t);
  const result = run(cwd, 'test', 'for(let i=0;i<100;i++) console.log("line-"+i); process.exit(7);');
  assert.equal(result.status, 7);
  assert.match(result.stderr, /실패 · exit 7/);
  assert.ok(!result.stderr.includes('line-59\n'));
  assert.ok(result.stderr.includes('line-60\n'));
  assert.ok(result.stderr.includes('line-99\n'));
  assert.equal(readFileSync(join(cwd, 'test-results/tasks/test.log'), 'utf8').trim().split('\n').length, 100);
});

test('a subsequent run replaces its routine log without affecting other task logs', (t) => {
  const cwd = fixture(t);
  run(cwd, 'build', 'console.log("previous");');
  run(cwd, 'check', 'console.log("retained");');
  run(cwd, 'build', 'console.log("current");');
  assert.equal(readFileSync(join(cwd, 'test-results/tasks/build.log'), 'utf8'), 'current\n');
  assert.equal(readFileSync(join(cwd, 'test-results/tasks/check.log'), 'utf8'), 'retained\n');
});

test('invalid task names and missing commands fail before executing anything', (t) => {
  const cwd = fixture(t);
  for (const args of [[], ['../outside', 'true'], ['test']]) {
    assert.equal(spawnSync('sh', [runner, ...args], { cwd }).status, 2);
  }
  assert.equal(spawnSync('sh', [runner, 'test', 'foltra-no-such-executable'], { cwd }).status, 127);
});

function makeFixture(t) {
  const cwd = fixture(t);
  mkdirSync(join(cwd, 'scripts'));
  mkdirSync(join(cwd, 'bin'));
  copyFileSync(runner, join(cwd, 'scripts/run-task.sh'));
  copyFileSync(new URL('../Makefile', import.meta.url), join(cwd, 'Makefile'));
  writeFileSync(join(cwd, 'bin/node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const stub = '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FOLTRA_TASK_CALLS"\nexit "${FOLTRA_TASK_EXIT:-0}"\n';
  for (const name of ['npm', 'gh']) writeFileSync(join(cwd, 'bin', name), stub, { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${join(cwd, 'bin')}:${process.env.PATH}`,
    FOLTRA_TASK_CALLS: join(cwd, 'calls'),
  };
  return { cwd, env, encoding: 'utf8' };
}

test('make verify runs both checks in order, once, and stops on failure', (t) => {
  const options = makeFixture(t);
  assert.equal(spawnSync('make', ['-j4', 'verify'], options).status, 0);
  assert.equal(readFileSync(join(options.cwd, 'calls'), 'utf8'), 'test\nrun check\n');
  writeFileSync(join(options.cwd, 'calls'), '');
  options.env.FOLTRA_TASK_EXIT = '9';
  assert.notEqual(spawnSync('make', ['verify'], options).status, 0);
  assert.equal(readFileSync(join(options.cwd, 'calls'), 'utf8'), 'test\n');
});

test('release wait uses a 60 second interval and propagates failure; missing run IDs are rejected', (t) => {
  const options = makeFixture(t);
  options.env.FOLTRA_TASK_EXIT = '1';
  assert.notEqual(spawnSync('make', ['release-wait', 'RUN=123'], options).status, 0);
  assert.equal(
    readFileSync(join(options.cwd, 'calls'), 'utf8'),
    'run watch 123 --repo snacky101/foltra --interval 60 --compact --exit-status\n',
  );
  for (const value of ['', '123;echo unsafe']) {
    assert.notEqual(spawnSync('make', ['release-status', `RUN=${value}`], options).status, 0);
  }
});
