import { settleAndPauseCoreRequests, settleCoreRequests } from './coreRequestBarrier';

/** Return a release function only after all current content is durable. */
export async function prepareAppUpdate(save: () => Promise<boolean>): Promise<() => void> {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  const settled = await settleCoreRequests();
  const saved = await save();
  const lock = await settleAndPauseCoreRequests();
  if (!settled || !saved || !lock.succeeded || document.querySelector('[aria-invalid="true"], .save-error')) {
    lock.resume();
    throw new Error('저장하지 못한 내용이 있습니다. 편집 화면에서 저장 문제를 해결한 뒤 다시 설치하세요.');
  }
  return lock.resume;
}
