import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import plugin from '../../examples/code/anki/main';
import { sync, defaults, read } from '../../examples/code/anki/sync';
import { html } from '../../examples/code/anki/sources';
import { prepareCard } from '../../examples/code/anki/media';
import type { Api, Row } from '../../packages/plugin-sdk';
function fixture() {
  let storage: any = null,
    revision = 0,
    profile = 'QA',
    sequence = 100,
    loseReply = false;
  const notes = new Map<number, any>(),
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
  const api: Api = {
    vaultId: 'vault-1',
    createId: () => '11111111-1111-4111-8111-111111111111',
    hash: (s) => createHash('sha256').update(s).digest('hex'),
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
    call(command) {
      if (command === 'database.list')
        return [
          {
            id: 'db-1',
            name: '단어',
            properties: [
              { id: 'front', name: '앞면', type: 'text' },
              { id: 'back', name: '뒷면', type: 'text' },
            ],
          },
        ] as any;
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
    notes,
    calls,
    loseReply: () => {
      loseReply = true;
    },
    profile: (value: string) => {
      profile = value;
    },
  };
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
    f.rows[0].values.back = markdown;
    f.rows[0].revision = 'r2';
    const request = f.api.anki.bind(f.api);
    f.api.anki = (action, params) => {
      if (action === 'storeVaultImage') throw new Error('Image missing');
      return request(action, params);
    };
    expect(sync(f.api).failed).toBe(1);
    expect(f.notes.get(id).fields.Back.value).toBe('Hello');
    expect(read(f.api).data.sent['row-row-1'].revision).toBe('r1');
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
  expect(before).not.toContain('카드 원본');
  view.onAction(api, { id: 'deck', value: '내 학습 덱' });
  view.onAction(api, { id: 'tag', value: '복습' });
  view.onAction(api, { id: 'save' });
  expect(read(api).data.config).toMatchObject({ deck: '내 학습 덱', tag: '복습', auto: false });
  expect(f.calls).toHaveLength(0);
  api.state = {};
  expect(JSON.stringify(view.render(api))).toContain('내 학습 덱');
  expect(JSON.stringify(plugin.views.sync.render(api))).toContain('내 학습 덱');
});
