// The updater must wait for blur saves (including chained reads/writes) before
// replacing the app. New background requests wait while installation runs.
const pending = new Set<Promise<boolean>>();
let barrier: Promise<void> | null = null;

export async function runCoreRequest<T>(request: () => Promise<T>): Promise<T> {
  while (barrier) await barrier;
  // Admission and registration are synchronous: no request can start between
  // the last barrier check and entering the pending set.
  return trackCoreRequest(request());
}

export function trackCoreRequest<T>(request: Promise<T>): Promise<T> {
  const settled = request.then(
    () => true,
    () => false,
  );
  pending.add(settled);
  void settled.then(() => pending.delete(settled));
  return request;
}

async function settle<T>(finish: (succeeded: boolean) => T): Promise<T> {
  let succeeded = true;
  do {
    const results = await Promise.all([...pending]);
    if (results.some((result) => !result)) succeeded = false;
    // Let callers process responses, enqueue chained writes and render errors.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  } while (pending.size);
  return finish(succeeded);
}

export function settleCoreRequests(): Promise<boolean> {
  return settle((succeeded) => succeeded);
}

export function settleAndPauseCoreRequests() {
  // Pause in the same task as the final pending check, before returning.
  return settle((succeeded) => ({ succeeded, resume: pauseCoreRequests() }));
}

export function pauseCoreRequests(): () => void {
  if (barrier) throw new Error('앱 업데이트 설치가 이미 진행 중입니다.');
  let resume!: () => void;
  const current = new Promise<void>((resolve) => {
    resume = resolve;
  });
  barrier = current;
  return () => {
    if (barrier === current) barrier = null;
    resume();
  };
}
