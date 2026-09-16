import type { Api } from '../../../packages/plugin-sdk';
import { identify, sources, type Config } from './sources';
import { hasImages, prepareCard } from './media';
export interface Sent {
  id: number;
  digest: string;
  revision: string;
  mediaVersion?: number;
}
export interface Data {
  config: Config;
  sent: Record<string, Sent>;
  errors: Record<string, { revision: string; message: string; mediaVersion?: number }>;
  message: string;
  lastSync?: string;
}
export const defaults: Config = {
  database: '',
  front: '',
  back: '',
  deck: 'Foltra',
  tag: 'anki',
  blocks: true,
  auto: false,
  profile: '',
};
export function read(api: Api) {
  const saved = api.storage.read<Data>();
  return {
    revision: saved.revision,
    data: {
      config: { ...defaults, ...saved.value?.config },
      sent: saved.value?.sent ?? {},
      errors: saved.value?.errors ?? {},
      message: saved.value?.message ?? '',
      lastSync: saved.value?.lastSync,
    } as Data,
  };
}
export function connection(api: Api) {
  if (api.anki<number>('version') < 6) throw new Error('AnkiConnect v6 이상이 필요합니다.');
  return { profile: api.anki<string>('getActiveProfile'), decks: api.anki<string[]>('deckNames') };
}
function ensureModel(api: Api) {
  if (!api.anki<string[]>('modelNames').includes('Foltra'))
    api.anki('createModel', {
      modelName: 'Foltra',
      inOrderFields: ['Front', 'Back', 'Source'],
      cardTemplates: [
        {
          Name: 'Card 1',
          Front: '{{Front}}',
          Back: '{{FrontSide}}<hr>{{Back}}',
        },
      ],
    });
  if (
    JSON.stringify(api.anki<string[]>('modelFieldNames', { modelName: 'Foltra' })) !==
    JSON.stringify(['Front', 'Back', 'Source'])
  )
    throw new Error('Anki의 Foltra 노트 유형 필드가 다릅니다. Front, Back, Source 필드가 필요합니다.');
}
interface AnkiNote {
  noteId: number;
  profile: string;
  modelName: string;
  fields: Record<string, { value: string }>;
  tags: string[];
}
export const needsSync = (data: Data, source: ReturnType<typeof sources>[number]) =>
  data.sent[source.key]?.revision !== source.revision ||
  (data.sent[source.key]?.mediaVersion !== 1 && hasImages(source));
export function sync(api: Api, automatic = false) {
  const saved = read(api),
    data = saved.data;
  if (automatic && !data.config.auto && !api.state.syncRequested) return { pending: false };
  const originalMessage = data.message;
  let revision = saved.revision;
  const persist = () => {
    revision = api.storage.write(data, revision).revision;
  };
  let processed = 0,
    failed = 0;
  try {
    const profile = api.anki<string>('getActiveProfile');
    if (data.config.profile && data.config.profile !== profile)
      throw new Error(`Anki 프로필이 바뀌었습니다. 연결한 프로필: ${data.config.profile}, 현재: ${profile}`);
    if (!data.config.profile) {
      data.config.profile = profile;
      persist();
    }
    identify(api, data.config);
    const all = sources(api, data.config),
      keys = new Set<string>(),
      duplicates = new Set<string>();
    for (const item of all) {
      if (keys.has(item.key)) duplicates.add(item.key);
      keys.add(item.key);
    }
    const candidates = all.filter(
      (s) =>
        needsSync(data, s) &&
        (!automatic ||
          data.errors[s.key]?.revision !== s.revision ||
          (hasImages(s) && data.errors[s.key]?.mediaVersion !== 1)),
    );
    const force = api.state.force as Record<string, string> | undefined;
    candidates.sort((a, b) => Number(Boolean(force?.[b.key])) - Number(Boolean(force?.[a.key])));
    // Media I/O also shares the host invocation budget; process image cards individually.
    const work = candidates.slice(0, candidates.some(hasImages) ? 1 : 4);
    if (work.length) {
      ensureModel(api);
      api.anki('createDeck', { deck: data.config.deck });
    }
    for (const item of work) {
      try {
        if (duplicates.has(item.key))
          throw new Error('중복된 블록 ID입니다. 복사된 블록의 foltra-anki 주석을 제거하세요.');
        if (item.key.startsWith('pending-')) continue;
        if (!item.front.trim() || !item.back.trim()) throw new Error('앞면과 뒷면을 모두 입력하세요.');
        if (item.front.length + item.back.length > 20_000)
          throw new Error('카드 내용은 20,000자 이하로 작성하세요.');
        const prepared = prepareCard(item),
          content = prepared.fields,
          digest = api.hash(JSON.stringify(content)),
          previous = data.sent[item.key];
        const sourceTag = `foltra::${api.vaultId}::${item.key}`;
        if (previous?.digest === digest) {
          data.sent[item.key].revision = item.revision;
          data.sent[item.key].mediaVersion = 1;
          delete data.errors[item.key];
          persist();
          continue;
        }
        const ids = api.anki<number[]>('findNotes', { query: `tag:${sourceTag}` });
        if (ids.length > 1) throw new Error('Anki에 같은 원본의 카드가 여러 개 있습니다. 중복을 확인하세요.');
        let id = ids[0];
        if (!id && previous)
          throw new Error(
            '연결된 Anki 카드가 삭제되었거나 원본 태그가 사라졌습니다. 자동 재생성하지 않습니다.',
          );
        const upload = () => {
          if (prepared.media.size > 20)
            throw new Error('카드 하나에는 최대 20개의 서로 다른 이미지를 넣을 수 있습니다.');
          for (const [path, filename] of prepared.media) {
            const stored = api.anki<string>('storeVaultImage', { path, profile });
            if (stored !== filename) throw new Error('Anki 이미지 저장 결과가 예상한 파일명과 다릅니다.');
          }
        };
        if (id) {
          const remote = api.anki<AnkiNote[]>('notesInfo', { notes: [id] })[0];
          if (!remote || remote.modelName !== 'Foltra' || remote.profile !== profile)
            throw new Error('Anki 카드의 유형 또는 프로필이 일치하지 않습니다.');
          const current = {
            Front: remote.fields.Front?.value,
            Back: remote.fields.Back?.value,
            Source: remote.fields.Source?.value,
          };
          const remoteDigest = api.hash(JSON.stringify(current));
          if (remoteDigest !== digest) {
            if (
              (!previous || previous.id !== id || previous.digest !== remoteDigest) &&
              (api.state.force as Record<string, string> | undefined)?.[item.key] !== remoteDigest
            )
              throw new Error('Anki에서도 내용이 변경되었습니다. 자동 덮어쓰기를 멈췄습니다.');
            upload();
            api.anki('updateNoteFields', { note: { id, fields: content } });
            const after = api.anki<AnkiNote[]>('notesInfo', { notes: [id] })[0];
            if (!after || Object.entries(content).some(([k, v]) => after.fields[k]?.value !== v))
              throw new Error('Anki 변경 확인에 실패했습니다. Anki 편집 창을 닫고 다시 시도하세요.');
          } else upload();
        } else {
          upload();
          id = api.anki<number>('addNote', {
            note: {
              deckName: data.config.deck,
              modelName: 'Foltra',
              fields: content,
              tags: ['foltra', sourceTag],
              options: { allowDuplicate: true },
            },
          });
          if (!Number.isSafeInteger(id)) throw new Error('Anki가 카드 ID를 반환하지 않았습니다.');
        }
        data.sent[item.key] = { id, digest, revision: item.revision, mediaVersion: 1 };
        delete data.errors[item.key];
        processed++;
        persist();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Never continue a batch after losing connectivity or exhausting the host budget.
        if (['anki_unavailable', 'plugin_limit', 'conflict'].includes((e as { code?: string }).code ?? ''))
          throw e;
        data.errors[item.key] = { revision: item.revision, message, mediaVersion: 1 };
        failed++;
        persist();
      }
    }
    const pending = all.some(
      (s) =>
        needsSync(data, s) &&
        (data.errors[s.key]?.revision !== s.revision ||
          (hasImages(s) && data.errors[s.key]?.mediaVersion !== 1)),
    );
    api.state.syncRequested = Boolean(api.state.syncRequested && pending);
    if (work.length || !automatic) {
      data.lastSync = new Date().toISOString();
      data.message = `${processed}개 동기화 · ${failed}개 확인 필요${pending ? ' · 남은 항목은 이어서 처리합니다.' : ''}`;
      persist();
    }
    delete api.state.error;
    delete api.state.force;
    return { processed, failed, pending, message: data.message };
  } catch (e) {
    api.state.syncRequested = false;
    data.message = e instanceof Error ? e.message : String(e);
    if (data.message !== originalMessage || !automatic) persist();
    api.state.error = data.message;
    return { processed, failed: failed + 1, pending: false, message: data.message };
  }
}
