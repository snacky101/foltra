import type { Api, Database, Note, QueryResult } from '../../../packages/plugin-sdk';
export interface Config {
  database: string;
  front: string;
  back: string;
  backSource: 'column' | 'note';
  deck: string;
  tag: string;
  blocks: boolean;
  auto: boolean;
  profile: string;
}
export interface Source {
  key: string;
  label: string;
  front: string;
  back: string;
  revision: string;
  noteId?: string;
  bodyNoteId?: string;
  problem?: string;
  line?: number;
  block?: boolean;
}
interface Block {
  noteId: string;
  title: string;
  revision: string;
  line: number;
  body: string;
}
export const marker = /<!-- foltra-anki:([a-f0-9-]{36}) -->/g;
export const clean = (s: string) => s.replace(marker, '').trim();
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function tagged(api: Api, config: Config): Block[] {
  const result: Block[] = [];
  if (!config.blocks || !config.tag.trim()) return result;
  for (let offset = 0; ; offset += 100) {
    const page = api.call<{ blocks: Block[]; total: number }>('tags.blocks', {
      tag: config.tag,
      limit: 100,
      offset,
    });
    result.push(...page.blocks);
    if (result.length >= page.total) return result;
  }
}
export function identify(api: Api, config: Config) {
  const blocks = tagged(api, config)
    .filter((b) => !b.body.split('\n')[0].match(marker))
    .slice(0, 8);
  const notes = [
    ...new Set(blocks.filter((b) => !b.body.split('\n')[0].match(marker)).map((b) => b.noteId)),
  ].slice(0, 4);
  for (const id of notes) {
    const note = api.call<Note>('note.read', { id });
    const lines = note.body.split('\n');
    // Discovery and the conditional update share one core invocation. Never retry a conflict.
    for (const block of blocks.filter((b) => b.noteId === id)) {
      if (block.revision !== note.revision)
        throw new Error('노트가 바뀌었습니다. 저장 후 다시 동기화하세요.');
      const index = block.line - 1;
      if (!lines[index].match(marker)) lines[index] += ` <!-- foltra-anki:${api.createId()} -->`;
    }
    api.call('note.update', {
      id,
      title: note.title,
      body: lines.join('\n'),
      expectedRevision: note.revision,
    });
  }
}
export function sources(api: Api, config: Config): Source[] {
  const result: Source[] = [];
  if (config.database) {
    const db = api.call<Database[]>('database.list').find((d) => d.id === config.database);
    if (
      !db ||
      ![config.front, ...(config.backSource === 'column' ? [config.back] : [])].every((id) =>
        db.properties.some((p) => p.id === id),
      )
    )
      throw new Error('데이터베이스와 앞면·뒷면 컬럼을 다시 선택하세요.');
    const notes =
      config.backSource === 'note'
        ? new Map(api.call<Pick<Note, 'id' | 'revision'>[]>('note.list').map((note) => [note.id, note]))
        : undefined;
    for (let offset = 0; ; offset += 100) {
      const page = api.call<QueryResult>('query.run', { databaseId: db.id, limit: 100, offset });
      for (const row of page.rows) {
        const note = row.bodyNoteId ? notes?.get(row.bodyNoteId) : undefined;
        result.push({
          key: `row-${row.id}`,
          label: db.name,
          front: String(row.values[config.front] ?? ''),
          back: config.backSource === 'column' ? String(row.values[config.back] ?? '') : '',
          revision: JSON.stringify([
            'db-v2',
            row.revision,
            config.front,
            config.backSource,
            config.backSource === 'note' ? [row.bodyNoteId, note?.revision ?? null] : config.back,
          ]),
          ...(note ? { noteId: note.id, bodyNoteId: note.id } : {}),
          ...(config.backSource === 'note' && !note
            ? {
                problem: row.bodyNoteId
                  ? '연결된 노트를 찾을 수 없습니다. DB 행에 다른 노트를 연결하거나 뒷면에서 컬럼을 선택하세요.'
                  : '이 행에 연결된 노트가 없습니다. DB 행에 노트를 연결하거나 뒷면에서 컬럼을 선택하세요.',
              }
            : {}),
        });
      }
      if (offset + page.rows.length >= page.total) break;
    }
  }
  for (const block of tagged(api, config)) {
    const lines = block.body.split('\n'),
      first = lines[0],
      id = [...first.matchAll(marker)][0]?.[1];
    const tag = config.tag.replace(/^#/, '').trim();
    const front = clean(first)
      .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(new RegExp(`#${escapeRegExp(tag)}(?=$|[^\\p{L}\\p{N}\\p{M}_/-])`, 'giu'), '')
      .trim();
    result.push({
      key: id ? `block-${block.noteId}-${id}` : `pending-${block.noteId}-${block.line}`,
      label: block.title,
      front,
      back: clean(lines.slice(1).join('\n')).replace(/^\s*[-+*]\s+/gm, '• '),
      revision: block.revision,
      noteId: block.noteId,
      line: block.line,
      block: true,
    });
  }
  return result;
}

// Read only the cards being displayed or sent, within the SDK's host-call budget.
export function withNoteBody(api: Api, source: Source): Source {
  if (!source.bodyNoteId) return source;
  let body = api.call<Note>('note.read', { id: source.bodyNoteId }).body;
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(body);
  if (opening) {
    const closing = /\n---[ \t]*(?:\r?\n|(?![\s\S]))/g;
    closing.lastIndex = opening[0].length - 1;
    const match = closing.exec(body);
    if (match) body = body.slice(match.index + match[0].length);
  }
  const back = clean(body);
  return {
    ...source,
    back,
    ...(!back
      ? { problem: '연결된 노트 본문이 비어 있습니다. 본문을 입력하거나 뒷면에서 컬럼을 선택하세요.' }
      : {}),
  };
}
export const html = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br>');
