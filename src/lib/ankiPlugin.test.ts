import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import plugin from '../../examples/code/anki/main';
import { sync, defaults, read } from '../../examples/code/anki/sync';
import { html } from '../../examples/code/anki/sources';
import { prepareCard } from '../../examples/code/anki/media';
import type { Api, Database, Note, Row, ViewNode } from '../../packages/plugin-sdk';
function fixture() {
  let storage: any = null,
    revision = 0,
    profile = 'QA',
    sequence = 100,
    loseReply = false;
  const notes = new Map<number, any>(),
    vaultNotes = new Map<string, Note>(),
    hostCalls: string[] = [],
    calls: string[] = [];
  const rows: Row[] = [
    {
      id: 'row-1',
      databaseId: 'db-1',
      values: { front: '안녕 <script>', back: 'Hello' },
      revision: 'r1',
      bodyNoteId: null,
    },
  ];
  const database: Database = {
    id: 'db-1',
    name: '단어',
    properties: [
      { id: 'front', name: '앞면', type: 'text' },
      { id: 'back', name: '뒷면', type: 'text' },
    ],
  };
  const api: Api = {
    vaultId: 'vault-1',
    git() {
      throw new Error('Anki does not use Git');
    },
    createId: () => '11111111-1111-4111-8111-111111111111',
    hash: (s) => {
      hostCalls.push('hash');
      return createHash('sha256').update(s).digest('hex');
    },
    state: {},
    settings: {},
    storage: {
      read: () => ({ value: structuredClone(storage), revision: String(revision) }),
      write(value, expected) {
        if (expected !== String(revision)) throw Object.assign(new Error('conflict'), { code: 'conflict' });
        storage = structuredClone(value);
        revision++;
        return { value, revision: String(revision) };
      },
    },
    call(command, args: any) {
      hostCalls.push(command);
      if (command === 'note.list')
        return [...vaultNotes.values()].map(({ body: _body, ...summary }) => summary) as any;
      if (command === 'note.read') {
        const note = vaultNotes.get(args.id);
        if (!note) throw Object.assign(new Error('Missing note'), { code: 'not_found' });
        return structuredClone(note) as any;
      }
      if (command === 'database.list') return [structuredClone(database)] as any;
      if (command === 'query.run') return { rows: structuredClone(rows), total: rows.length } as any;
      if (command === 'tags.blocks') return { blocks: [], total: 0 } as any;
      throw new Error(command);
    },
    anki(action, params: any = {}) {
      calls.push(action);
      if (action === 'getActiveProfile') return profile as any;
      if (action === 'modelNames') return ['Foltra'] as any;
      if (action === 'modelFieldNames') return ['Front', 'Back', 'Source'] as any;
      if (action === 'createDeck') return 1 as any;
      if (action === 'findNotes')
        return [...notes.values()]
          .filter((n) => n.tags.includes(params.query.slice(4)))
          .map((n) => n.noteId) as any;
      if (action === 'notesInfo')
        return params.notes.map((id: number) => structuredClone(notes.get(id) ?? {}));
      if (action === 'updateNoteFields') {
        const note = notes.get(params.note.id);
        note.fields = Object.fromEntries(
          Object.entries(params.note.fields).map(([k, value]) => [k, { value }]),
        );
        return null as any;
      }
      if (action === 'addNote') {
        const note = params.note,
          id = ++sequence;
        notes.set(id, {
          noteId: id,
          profile,
          modelName: 'Foltra',
          tags: note.tags,
          fields: Object.fromEntries(Object.entries(note.fields).map(([k, value]) => [k, { value }])),
        });
        if (loseReply) {
          loseReply = false;
          throw Object.assign(new Error('connection lost'), { code: 'anki_unavailable' });
        }
        return id as any;
      }
      throw new Error(action);
    },
    openView() {},
    openNote() {},
    notify() {},
    editor: {
      read() {
        throw new Error('no editor');
      },
      replaceSelection() {},
    },
  };
  storage = {
    config: { ...defaults, database: 'db-1', front: 'front', back: 'back', blocks: false },
    sent: {},
    errors: {},
    message: '',
  };
  return {
    api,
    rows,
    database,
    notes,
    vaultNotes,
    hostCalls,
    calls,
    loseReply: () => {
      loseReply = true;
    },
    profile: (value: string) => {
      profile = value;
    },
  };
}
function nodes(tree: ViewNode): ViewNode[] {
  return [tree, ...(tree.children?.flatMap(nodes) ?? [])];
}
describe('Anki code plugin', () => {
  const path = `attachments/${'a'.repeat(64)}.png`;
  const markdown = `![이미지](../${path})`;
  const filename = `foltra-${'a'.repeat(64)}.png`;
  function images(f: ReturnType<typeof fixture>) {
    const request = f.api.anki.bind(f.api);
    const uploaded: any[] = [];
    f.api.anki = (action, params) => {
      if (action === 'storeVaultImage') {
        f.calls.push(action);
        uploaded.push(params);
        return filename as any;
      }
      return request(action, params);
    };
    return uploaded;
  }
  function legacy(f: ReturnType<typeof fixture>) {
    const id = [...f.notes.keys()][0];
    const content = {
      Front: html(String(f.rows[0].values.front)),
      Back: html(String(f.rows[0].values.back)),
      Source: 'Foltra · 단어',
    };
    f.notes.get(id).fields = Object.fromEntries(Object.entries(content).map(([k, value]) => [k, { value }]));
    const saved = read(f.api);
    saved.data.sent['row-row-1'] = {
      id,
      digest: f.api.hash(JSON.stringify(content)),
      revision: f.rows[0].revision,
    };
    f.api.storage.write(saved.data, saved.revision);
    return id;
  }
  function linkedBody(f: ReturnType<typeof fixture>, body = '노트 본문') {
    const note: Note = {
      id: 'body-1',
      title: '연결 노트',
      body,
      revision: 'note-r1',
      createdAt: '2026-09-17T00:00:00Z',
      updatedAt: '2026-09-17T00:00:00Z',
    };
    f.vaultNotes.set(note.id, note);
    f.rows[0].bodyNoteId = note.id;
    const saved = read(f.api);
    saved.data.config.backSource = 'note';
    f.api.storage.write(saved.data, saved.revision);
    return note;
  }
  it.each([undefined, false, true])(
    'migrates legacy includeNoteBody=%s without load writes and strips it on save',
    (legacyFlag) => {
      const f = fixture();
      const saved = f.api.storage.read<any>();
      delete saved.value.config.backSource;
      if (legacyFlag !== undefined) saved.value.config.includeNoteBody = legacyFlag;
      saved.value.config.deck = 'Keep deck';
      saved.value.sent = { 'row-old': { id: 321, digest: 'keep-digest', revision: 'keep-revision' } };
      f.api.storage.write(saved.value, saved.revision);
      const before = f.api.storage.read();
      expect(read(f.api).data.config.backSource).toBe(legacyFlag ? 'note' : 'column');
      expect(f.api.storage.read()).toEqual(before);
      plugin.views.settings.onAction(f.api, { id: 'save' });
      const after = f.api.storage.read<any>();
      expect(after.value.config).not.toHaveProperty('includeNoteBody');
      expect(after.value.config.backSource).toBe(legacyFlag ? 'note' : 'column');
      expect(after.value.config.deck).toBe('Keep deck');
      expect(after.value.sent).toEqual(saved.value.sent);
      expect(f.calls).toEqual([]);
    },
  );
  it.each(['column', 'note'] as const)(
    'keeps an explicit %s choice ahead of the obsolete opposite flag',
    (backSource) => {
      const f = fixture();
      const saved = f.api.storage.read<any>();
      saved.value.config.backSource = backSource;
      saved.value.config.includeNoteBody = backSource === 'column';
      f.api.storage.write(saved.value, saved.revision);
      const before = f.api.storage.read();
      expect(read(f.api).data.config.backSource).toBe(backSource);
      expect(f.api.storage.read()).toEqual(before);
    },
  );
  it('offers one back menu with unambiguous labels even when a column is named like the note option', () => {
    const f = fixture();
    f.database.properties[1].name = '연결된 노트 본문';
    const ui = nodes(plugin.views.settings.render(f.api));
    const back = ui.find((node) => node.action === 'back')!;
    expect(back).toMatchObject({ type: 'select', label: '뒷면', value: '컬럼 · 연결된 노트 본문' });
    expect(back.options).toEqual(['컬럼 · 앞면', '컬럼 · 연결된 노트 본문', '연결된 노트 본문']);
    expect(ui.some((node) => node.action === 'include-note-body')).toBe(false);
    plugin.views.settings.onAction(f.api, { id: 'back', value: '연결된 노트 본문' });
    expect(f.api.state.draft).toMatchObject({ back: 'back', backSource: 'note' });
    plugin.views.settings.onAction(f.api, { id: 'back', value: '컬럼 · 연결된 노트 본문' });
    expect(f.api.state.draft).toMatchObject({ back: 'back', backSource: 'column' });
  });
  it('updates an old appended answer to body only using the existing card ID', () => {
    const f = fixture();
    const note = linkedBody(f);
    sync(f.api);
    const id = [...f.notes.keys()][0];
    const fields = {
      Front: html(String(f.rows[0].values.front)),
      Back: 'Hello<br><br>노트 본문',
      Source: 'Foltra · 단어',
    };
    f.notes.get(id).fields = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, { value }]),
    );
    const saved = f.api.storage.read<any>();
    delete saved.value.config.backSource;
    saved.value.config.includeNoteBody = true;
    saved.value.sent['row-row-1'] = {
      id,
      digest: f.api.hash(JSON.stringify(fields)),
      revision: JSON.stringify(['r1', 'front', 'back', note.revision]),
      mediaVersion: 1,
    };
    f.api.storage.write(saved.value, saved.revision);
    expect(sync(f.api)).toMatchObject({ processed: 1, failed: 0 });
    expect([...f.notes.keys()]).toEqual([id]);
    expect(f.notes.get(id).fields.Back.value).toBe('노트 본문');
    expect(f.rows[0].revision).toBe('r1');
  });
  it('does not require the previous back column in note mode', () => {
    const f = fixture();
    linkedBody(f);
    f.database.properties = f.database.properties.filter((property) => property.id !== 'back');
    delete f.rows[0].values.back;
    expect(sync(f.api)).toMatchObject({ processed: 1, failed: 0 });
    expect([...f.notes.values()][0].fields.Back.value).toBe('노트 본문');
    expect(nodes(plugin.views.settings.render(f.api)).find((node) => node.action === 'back')?.value).toBe(
      '연결된 노트 본문',
    );
  });
  it.each(['missing', 'empty'])(
    'keeps good card previews and continues the UI sync queue after an %s first body',
    (kind) => {
      const f = fixture();
      const first = linkedBody(f, ' \n');
      if (kind === 'missing') f.rows[0].bodyNoteId = null;
      f.vaultNotes.set('body-2', { ...first, id: 'body-2', body: '정상 노트 본문' });
      f.rows.push({ ...f.rows[0], id: 'row-2', bodyNoteId: 'body-2' });
      const ui = JSON.stringify(plugin.views.sync.render(f.api));
      expect(ui).toContain('카드 원본 · 2');
      expect(ui).toContain('정상 노트 본문');
      expect(ui).toContain('뒷면에서 컬럼을 선택하세요.');
      expect(plugin.views.sync.onAction(f.api, { id: 'sync' })).toMatchObject({
        processed: 0,
        failed: 1,
        pending: true,
      });
      expect(f.api.state.syncRequested).toBe(true);
      expect(sync(f.api, true)).toMatchObject({ processed: 1, failed: 0, pending: false });
      expect(f.api.state.syncRequested).toBe(false);
      expect([...f.notes.values()][0].fields.Back.value).toBe('정상 노트 본문');
      expect(read(f.api).data.errors['row-row-1'].message).toContain('뒷면에서 컬럼을 선택하세요.');
    },
  );
  it('resyncs changed column mappings even without a row revision change', () => {
    const f = fixture();
    sync(f.api);
    const id = [...f.notes.keys()][0];
    plugin.views.settings.onAction(f.api, { id: 'back', value: '컬럼 · 앞면' });
    plugin.views.settings.onAction(f.api, { id: 'save' });
    expect(sync(f.api).processed).toBe(1);
    expect(f.notes.get(id).fields.Back.value).toBe('안녕 &lt;script&gt;');
    plugin.views.settings.onAction(f.api, { id: 'front', value: '뒷면' });
    plugin.views.settings.onAction(f.api, { id: 'save' });
    expect(sync(f.api).processed).toBe(1);
    expect(f.notes.get(id).fields.Front.value).toBe('Hello');
    expect([...f.notes.keys()]).toEqual([id]);
    expect(f.rows[0].revision).toBe('r1');
  });
  it('uses only the linked body without metadata/footer and updates the same card on body-only revisions', () => {
    const f = fixture();
    const note = linkedBody(
      f,
      '---\ntags: [private]\n---\n설명 <script>\n다음 줄 <!-- foltra-anki:11111111-1111-4111-8111-111111111111 -->',
    );
    expect(sync(f.api)).toMatchObject({ processed: 1, failed: 0 });
    const id = [...f.notes.keys()][0];
    expect(f.notes.get(id).fields.Back.value).toBe('설명 &lt;script&gt;<br>다음 줄');
    expect(f.rows[0].revision).toBe('r1');
    expect(sync(f.api).processed).toBe(0);
    const sourceRevision = read(f.api).data.sent['row-row-1'].revision;
    note.body = '새 본문';
    note.revision = 'note-r2'; // External Markdown changes need not change updatedAt.
    expect(sync(f.api)).toMatchObject({ processed: 1, failed: 0 });
    expect([...f.notes.keys()]).toEqual([id]);
    expect(f.notes.get(id).fields.Back.value).toBe('새 본문');
    expect(read(f.api).data.sent['row-row-1'].revision).not.toBe(sourceRevision);
    expect(f.vaultNotes.get(note.id)).toBe(note);
  });
  it('switches exclusively between a column and note body in place without reading notes in column mode', () => {
    const f = fixture();
    linkedBody(f);
    const saved = read(f.api);
    saved.data.config.backSource = 'column';
    f.api.storage.write(saved.data, saved.revision);
    expect(read(f.api).data.config.backSource).toBe('column');
    sync(f.api);
    const id = [...f.notes.keys()][0];
    expect(f.notes.get(id).fields.Back.value).toBe('Hello');
    expect(f.hostCalls).not.toContain('note.list');
    expect(f.hostCalls).not.toContain('note.read');
    plugin.views.settings.onAction(f.api, { id: 'back', value: '연결된 노트 본문' });
    plugin.views.settings.onAction(f.api, { id: 'save' });
    expect(sync(f.api).processed).toBe(1);
    expect(f.notes.get(id).fields.Back.value).toBe('노트 본문');
    expect(read(f.api).data.config.back).toBe('back');
    plugin.views.settings.onAction(f.api, { id: 'back', value: '컬럼 · 뒷면' });
    plugin.views.settings.onAction(f.api, { id: 'save' });
    expect(sync(f.api).processed).toBe(1);
    expect([...f.notes.keys()]).toEqual([id]);
    expect(f.notes.get(id).fields.Back.value).toBe('Hello');
  });
  it.each(['empty', 'missing', 'unlinked'])(
    'preserves the previous card with an actionable error for an %s note body',
    (kind) => {
      const f = fixture();
      const note = linkedBody(f);
      expect(sync(f.api)).toMatchObject({ processed: 1, failed: 0 });
      const id = [...f.notes.keys()][0];
      if (kind === 'empty') {
        note.body = ' \n';
        note.revision = 'note-r2';
      }
      if (kind === 'missing') f.vaultNotes.delete(note.id);
      if (kind === 'unlinked') {
        f.rows[0].bodyNoteId = null;
        f.rows[0].revision = 'r2';
      }
      f.hostCalls.length = 0;
      expect(sync(f.api).failed).toBe(1);
      if (kind !== 'empty') expect(f.hostCalls).not.toContain('note.read');
      expect(read(f.api).data.errors['row-row-1'].message).toContain('뒷면에서 컬럼을 선택하세요.');
      expect(f.notes.get(id).fields.Back.value).toBe('노트 본문');
      expect([...f.notes.keys()]).toEqual([id]);
    },
  );
  it('accepts body-only answers and keeps the previous card if a missing body would empty the answer', () => {
    const f = fixture();
    const note = linkedBody(f);
    f.rows[0].values.back = '';
    expect(sync(f.api)).toMatchObject({ processed: 1, failed: 0 });
    const id = [...f.notes.keys()][0];
    expect(f.notes.get(id).fields.Back.value).toBe('노트 본문');
    f.vaultNotes.delete(note.id);
    expect(sync(f.api).failed).toBe(1);
    expect(f.notes.get(id).fields.Back.value).toBe('노트 본문');
  });
  it('uploads linked-body images through the existing deduplicated vault media path', () => {
    const f = fixture(),
      uploaded = images(f);
    linkedBody(f, `설명\n${markdown}\n${markdown}`);
    f.rows[0].values.front = `문제 ${markdown}`;
    f.rows[0].values.back = `![ignored](../attachments/${'b'.repeat(64)}.png)`;
    expect(sync(f.api)).toMatchObject({ processed: 1, failed: 0 });
    expect(uploaded).toEqual([{ path, profile: 'QA' }]);
    expect([...f.notes.values()][0].fields.Back.value).toBe(
      `설명<br><img src="${filename}"><br><img src="${filename}">`,
    );
  });
  it('preserves Anki edits on a body-only change until the reviewed overwrite', () => {
    const f = fixture();
    const note = linkedBody(f);
    sync(f.api);
    const id = [...f.notes.keys()][0];
    f.notes.get(id).fields.Back.value = 'Anki 수정';
    note.body = 'Foltra 본문 수정';
    note.revision = 'note-r2';
    expect(sync(f.api).failed).toBe(1);
    expect(f.notes.get(id).fields.Back.value).toBe('Anki 수정');
    plugin.views.sync.onAction(f.api, { id: 'review', payload: 'row-row-1' });
    expect(JSON.stringify(plugin.views.sync.render(f.api))).toContain('Foltra 본문 수정');
    plugin.views.sync.onAction(f.api, { id: 'overwrite', payload: 'row-row-1' });
    expect(f.notes.get(id).fields.Back.value).toBe('Foltra 본문 수정');
    expect([...f.notes.keys()]).toEqual([id]);
  });
  it('does not replace the previous answer if an image in a changed body cannot be uploaded', () => {
    const f = fixture();
    const note = linkedBody(f);
    sync(f.api);
    const id = [...f.notes.keys()][0];
    note.body = markdown;
    note.revision = 'note-r2';
    const request = f.api.anki.bind(f.api);
    f.api.anki = (action, params) => {
      if (action === 'storeVaultImage') throw new Error('Image missing');
      return request(action, params);
    };
    expect(sync(f.api).failed).toBe(1);
    expect(f.notes.get(id).fields.Back.value).toBe('노트 본문');
    images(f);
    expect(sync(f.api).processed).toBe(1);
    expect([...f.notes.keys()]).toEqual([id]);
    expect(f.notes.get(id).fields.Back.value).toBe(`<img src="${filename}">`);
  });
  it('discovers large linked databases with one note summary call and hydrates only the bounded batch', () => {
    const f = fixture();
    const first = linkedBody(f);
    for (let i = 2; i <= 80; i++) {
      const id = `body-${i}`;
      f.vaultNotes.set(id, { ...first, id, body: `본문 ${i}` });
      f.rows.push({ ...f.rows[0], id: `row-${i}`, bodyNoteId: id });
    }
    expect(sync(f.api)).toMatchObject({ processed: 1, pending: true });
    expect(f.hostCalls.filter((call) => call === 'note.list')).toHaveLength(1);
    expect(f.hostCalls.filter((call) => call === 'note.read')).toHaveLength(1);
    expect(f.hostCalls.filter((call) => call === 'hash')).toHaveLength(1);
    f.hostCalls.length = 0;
    expect(JSON.stringify(plugin.views.sync.render(f.api))).toContain('80개');
    expect(f.hostCalls.filter((call) => call === 'note.read')).toHaveLength(40);
    expect(f.hostCalls.length).toBeLessThan(60);
  });
  it('uploads vault images once per card before creation and renders images on both sides', () => {
    const f = fixture(),
      uploaded = images(f);
    f.rows[0].values = { front: `Question ${markdown}`, back: `${markdown}\n${markdown}` };
    expect(sync(f.api)).toMatchObject({ processed: 1, failed: 0 });
    expect(uploaded).toEqual([{ path, profile: 'QA' }]);
    expect(f.calls.indexOf('storeVaultImage')).toBeLessThan(f.calls.indexOf('addNote'));
    const card = [...f.notes.values()][0];
    expect(card.fields.Front.value).toBe(`Question <img src="${filename}">`);
    expect(card.fields.Back.value).toBe(`<img src="${filename}"><br><img src="${filename}">`);
    expect(sync(f.api).processed).toBe(0);
    expect(uploaded).toHaveLength(1);
    expect(f.notes.size).toBe(1);
  });
  it('migrates an unchanged legacy image card in place on the next sync', () => {
    const f = fixture();
    images(f);
    f.rows[0].values.back = markdown;
    sync(f.api);
    const id = legacy(f);
    expect(JSON.stringify(plugin.views.sync.render(f.api))).toContain('동기화 대기');
    expect(sync(f.api)).toMatchObject({ processed: 1, failed: 0 });
    expect([...f.notes.keys()]).toEqual([id]);
    expect(f.notes.get(id).fields.Back.value).toBe(`<img src="${filename}">`);
    expect(read(f.api).data.sent['row-row-1'].mediaVersion).toBe(1);
  });
  it('preserves Anki edits during legacy migration without uploading media', () => {
    const f = fixture(),
      uploaded = images(f);
    f.rows[0].values.back = markdown;
    sync(f.api);
    const id = legacy(f);
    uploaded.length = 0;
    f.notes.get(id).fields.Back.value = 'Anki edit';
    expect(sync(f.api).failed).toBe(1);
    expect(uploaded).toHaveLength(0);
    expect(f.notes.get(id).fields.Back.value).toBe('Anki edit');
  });
  it('leaves the previous card intact on media failure and retries without duplicates', () => {
    const f = fixture();
    sync(f.api);
    const id = [...f.notes.keys()][0];
    const sourceRevision = read(f.api).data.sent['row-row-1'].revision;
    f.rows[0].values.back = markdown;
    f.rows[0].revision = 'r2';
    const request = f.api.anki.bind(f.api);
    f.api.anki = (action, params) => {
      if (action === 'storeVaultImage') throw new Error('Image missing');
      return request(action, params);
    };
    expect(sync(f.api).failed).toBe(1);
    expect(f.notes.get(id).fields.Back.value).toBe('Hello');
    expect(read(f.api).data.sent['row-row-1'].revision).toBe(sourceRevision);
    images(f);
    expect(sync(f.api).processed).toBe(1);
    expect([...f.notes.keys()]).toEqual([id]);
    expect(f.notes.get(id).fields.Back.value).toBe(`<img src="${filename}">`);
  });
  it('only transforms actual managed image nodes, retaining escaped examples and remote references as text', () => {
    const back = `\`${markdown}\`\n\n\`\`\`md\n${markdown}\n\`\`\`\n\n\\${markdown}\n![remote](https://example.com/image.png)\n![outside](../../secret.png)\n<img src=x onerror=alert(1)>`;
    const result = prepareCard({ key: 'test', label: '<Title>', revision: '1', front: markdown, back });
    expect([...result.media]).toEqual([[path, filename]]);
    expect(result.fields.Front).toBe(`<img src="${filename}">`);
    expect(result.fields.Back).toBe(html(back));
    expect(result.fields.Source).toBe('Foltra · &lt;Title&gt;');
  });
  it('creates a card template with only the question and answer, retaining source metadata separately', () => {
    const f = fixture();
    const request = f.api.anki.bind(f.api);
    let created: any;
    f.api.anki = (action, params) => {
      if (action === 'modelNames') return [] as any;
      if (action === 'createModel') {
        created = params;
        return null as any;
      }
      return request(action, params);
    };
    expect(sync(f.api).processed).toBe(1);
    expect(created.cardTemplates).toEqual([
      { Name: 'Card 1', Front: '{{Front}}', Back: '{{FrontSide}}<hr>{{Back}}' },
    ]);
    expect(created.inOrderFields).toEqual(['Front', 'Back', 'Source']);
    expect([...f.notes.values()][0].fields.Source.value).toBe('Foltra · 단어');
  });
  it('syncs independent DB rows, preserves IDs and escapes card HTML', () => {
    const f = fixture();
    expect(sync(f.api).processed).toBe(1);
    const id = [...f.notes.keys()][0];
    expect(f.notes.get(id).fields.Front.value).toBe('안녕 &lt;script&gt;');
    expect(sync(f.api).processed).toBe(0);
    expect(f.notes.size).toBe(1);
    f.rows[0].values.back = 'Updated';
    f.rows[0].revision = 'r2';
    expect(sync(f.api).processed).toBe(1);
    expect([...f.notes.keys()]).toEqual([id]);
    expect(f.notes.get(id).fields.Back.value).toBe('Updated');
    f.rows.push({ ...f.rows[0], id: 'row-2' });
    sync(f.api);
    expect(f.notes.size).toBe(2);
  });
  it('recovers an add whose response was lost without duplicating the note', () => {
    const f = fixture();
    f.loseReply();
    expect(sync(f.api).failed).toBe(1);
    expect(f.notes.size).toBe(1);
    expect(sync(f.api).processed).toBe(1);
    expect(f.notes.size).toBe(1);
  });
  it('detects Anki edits and requires review before a conditional overwrite', () => {
    const f = fixture();
    sync(f.api);
    const id = [...f.notes.keys()][0];
    f.notes.get(id).fields.Back.value = 'Anki edit';
    f.rows[0].values.back = 'Foltra edit';
    f.rows[0].revision = 'r2';
    expect(sync(f.api).failed).toBe(1);
    expect(f.notes.get(id).fields.Back.value).toBe('Anki edit');
    plugin.views.sync.onAction(f.api, { id: 'review', payload: 'row-row-1' });
    plugin.views.sync.onAction(f.api, { id: 'overwrite', payload: 'row-row-1' });
    expect(f.notes.get(id).fields.Back.value).toBe('Foltra edit');
    expect(read(f.api).data.errors).toEqual({});
  });
  it('prioritizes the explicitly reviewed conflict over other queued cards', () => {
    const f = fixture();
    for (let i = 2; i <= 6; i++)
      f.rows.push({ ...f.rows[0], id: `row-${i}`, values: { front: `Q${i}`, back: `A${i}` } });
    sync(f.api);
    sync(f.api);
    const id = read(f.api).data.sent['row-row-6'].id;
    f.notes.get(id).fields.Back.value = 'Manual';
    for (const row of f.rows) {
      row.revision = 'r2';
      row.values.back = 'Edited';
    }
    plugin.views.sync.onAction(f.api, { id: 'review', payload: 'row-row-6' });
    plugin.views.sync.onAction(f.api, { id: 'overwrite', payload: 'row-row-6' });
    expect(f.notes.get(id).fields.Back.value).toBe('Edited');
  });
  it('retains Anki cards after source removal, refuses profile changes and deleted-card recreation', () => {
    const f = fixture();
    sync(f.api);
    const row = f.rows.pop()!;
    sync(f.api);
    expect(f.notes.size).toBe(1);
    f.rows.push(row);
    row.revision = 'r2';
    row.values.back = 'new';
    f.profile('Other');
    expect(sync(f.api).failed).toBe(1);
    expect(f.notes.size).toBe(1);
    f.profile('QA');
    f.notes.clear();
    expect(sync(f.api).failed).toBe(1);
    expect(f.notes.size).toBe(0);
  });
  it('does not connect automatically before opt-in and processes bounded resumable batches', () => {
    const f = fixture();
    sync(f.api, true);
    expect(f.calls).toEqual([]);
    for (let i = 2; i <= 10; i++) f.rows.push({ ...f.rows[0], id: `row-${i}` });
    expect(sync(f.api)).toMatchObject({ processed: 4, pending: true });
    expect(sync(f.api)).toMatchObject({ processed: 4, pending: true });
    expect(sync(f.api)).toMatchObject({ processed: 2, pending: false });
    expect(f.notes.size).toBe(10);
  });
});

it('extension settings persist without sending cards and reuse the sync view configuration', () => {
  const f = fixture();
  const api = f.api;
  const view = plugin.views.settings;
  const before = JSON.stringify(view.render(api));
  expect(before).toContain('Anki 덱 이름');
  expect(before).toContain('연결된 노트 본문');
  expect(before).not.toContain('include-note-body');
  expect(before).not.toContain('카드 원본');
  view.onAction(api, { id: 'deck', value: '내 학습 덱' });
  view.onAction(api, { id: 'tag', value: '복습' });
  view.onAction(api, { id: 'back', value: '연결된 노트 본문' });
  expect(read(api).data.config.backSource).toBe('column');
  expect(api.state.draft).toMatchObject({ backSource: 'note' });
  view.onAction(api, { id: 'save' });
  expect(read(api).data.config).toMatchObject({
    deck: '내 학습 덱',
    tag: '복습',
    auto: false,
    backSource: 'note',
  });
  expect(f.calls).toHaveLength(0);
  api.state = {};
  const settings = view.render(api);
  const target = settings.children?.find((node) => node.type === 'card');
  expect(target?.children?.find((node) => node.action === 'back')?.value).toBe('연결된 노트 본문');
  expect(JSON.stringify(view.render(api))).toContain('내 학습 덱');
  expect(JSON.stringify(plugin.views.sync.render(api))).toContain('내 학습 덱');
});
