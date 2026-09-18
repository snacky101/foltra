// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { prepareAppUpdate } from './appUpdateSave';
import {
  pauseCoreRequests,
  settleAndPauseCoreRequests,
  settleCoreRequests,
  trackCoreRequest,
  runCoreRequest,
} from './coreRequestBarrier';

afterEach(() => {
  document.body.replaceChildren();
});

test('blur commits and chained inspect/rename finish before installation can pause new requests', async () => {
  const events: string[] = [];
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  input.onblur = () => {
    void trackCoreRequest(Promise.resolve('inspection')).then(async () => {
      events.push('inspected');
      await trackCoreRequest(
        new Promise<void>((resolve) =>
          setTimeout(() => {
            events.push('renamed');
            resolve();
          }, 5),
        ),
      );
    });
  };
  const save = vi.fn(async () => {
    events.push('saved');
    return true;
  });
  const resume = await prepareAppUpdate(save);
  expect(events).toEqual(['inspected', 'renamed', 'saved']);
  let requested = false;
  const request = runCoreRequest(async () => {
    requested = true;
  });
  await Promise.resolve();
  expect(requested).toBe(false);
  resume();
  await request;
  expect(requested).toBe(true);
});

test('failed pending blur save and existing invalid drafts block installation', async () => {
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  let reject!: (error: Error) => void;
  input.onblur = () => {
    void trackCoreRequest(
      new Promise<void>((_, failure) => {
        reject = failure;
      }),
    ).catch(() => {});
    setTimeout(() => reject(new Error('stale revision')), 2);
  };
  await expect(prepareAppUpdate(async () => true)).rejects.toThrow('저장하지 못한');
  await runCoreRequest(async () => {});
  input.setAttribute('aria-invalid', 'true');
  await expect(prepareAppUpdate(async () => true)).rejects.toThrow('저장하지 못한');
});

test('note save failure cannot pause core; drain also waits for already-running background writes', async () => {
  let finish!: () => void;
  void trackCoreRequest(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  let completed = false;
  const pending = settleCoreRequests().then(() => {
    completed = true;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  finish();
  await pending;
  await expect(prepareAppUpdate(async () => false)).rejects.toThrow('저장하지 못한');
  await runCoreRequest(async () => {});
});

test('releasing an older barrier twice cannot unlock a later installation', async () => {
  const first = pauseCoreRequests();
  first();
  const second = pauseCoreRequests();
  first();
  let resumed = false;
  const request = runCoreRequest(async () => {
    resumed = true;
  });
  await Promise.resolve();
  expect(resumed).toBe(false);
  second();
  await request;
  expect(resumed).toBe(true);
});

test('admission cannot cross a newly acquired barrier and late chained requests drain before atomic pause', async () => {
  const events: string[] = [];
  let finish!: () => void;
  const earlier = runCoreRequest(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  void earlier.then(() =>
    runCoreRequest(async () => {
      events.push('late write');
    }),
  );
  const locking = settleAndPauseCoreRequests();
  finish();
  const lock = await locking;
  expect(events).toEqual(['late write']);
  const waiting = runCoreRequest(async () => {
    events.push('after resume');
  });
  await Promise.resolve();
  expect(events).toEqual(['late write']);
  lock.resume();
  await waiting;
  expect(events).toEqual(['late write', 'after resume']);
});
