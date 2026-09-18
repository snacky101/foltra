// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../examples/code/date-mentions/main';
import manifest from '../../examples/plugins/date-mentions.json';
import type { Api } from '../../packages/plugin-sdk';
import { extensionCatalog } from './extensionCatalog';

const api = new Proxy({} as Api, {
  get() {
    throw new Error('Date completions must not access notes, storage, or editor APIs');
  },
});
const complete = (query = '') => plugin.completions.dates(api, { query });

describe('date mentions plugin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 18, 0, 1));
  });
  afterEach(() => vi.useRealTimers());

  it('offers plain local dates without accessing the vault or modifying editor contents', () => {
    expect(complete()).toEqual([
      { label: 'Today', insertText: '2026-09-18', detail: '오늘' },
      { label: 'Yesterday', insertText: '2026-09-17', detail: '어제' },
      { label: 'Tomorrow', insertText: '2026-09-19', detail: '내일' },
    ]);
    vi.setSystemTime(new Date(2026, 8, 19, 0, 1));
    expect(complete('Today')[0].insertText).toBe('2026-09-19');
  });

  it('filters label prefixes without case sensitivity and hides unrelated tokens', () => {
    expect(complete('tO').map(({ label }) => label)).toEqual(['Today', 'Tomorrow']);
    expect(complete('yES').map(({ label }) => label)).toEqual(['Yesterday']);
    expect(complete('tomor').map(({ label }) => label)).toEqual(['Tomorrow']);
    for (const query of ['day', 'todayx', 'someone', '한글']) expect(complete(query)).toEqual([]);
  });

  it.each([
    [new Date(2026, 0, 1, 0, 1), ['2026-01-01', '2025-12-31', '2026-01-02']],
    [new Date(2026, 11, 31, 23, 59), ['2026-12-31', '2026-12-30', '2027-01-01']],
    [new Date(2024, 1, 29, 0, 1), ['2024-02-29', '2024-02-28', '2024-03-01']],
    [new Date(2025, 2, 1, 0, 1), ['2025-03-01', '2025-02-28', '2025-03-02']],
  ])('uses local calendar arithmetic at %s', (date, expected) => {
    vi.setSystemTime(date);
    expect(complete().map(({ insertText }) => insertText)).toEqual(expected);
  });

  it.each([
    ['Asia/Seoul', '2026-09-17T15:01:00Z', ['2026-09-18', '2026-09-17', '2026-09-19']],
    ['America/Los_Angeles', '2026-09-18T06:59:00Z', ['2026-09-17', '2026-09-16', '2026-09-18']],
    ['America/Los_Angeles', '2026-03-08T07:30:00Z', ['2026-03-07', '2026-03-06', '2026-03-08']],
    ['America/Los_Angeles', '2026-11-01T07:30:00Z', ['2026-11-01', '2026-10-31', '2026-11-02']],
  ])('keeps the packaged provider on local dates in %s at %s', (timezone, instant, expected) => {
    // A separate process supplies a real timezone, including DST transitions, without
    // changing other tests' clocks. Freeze only the current instant, not date arithmetic.
    const source = `
      const RealDate = Date;
      globalThis.Date = class extends RealDate {
        constructor(...args) {
          if (args.length) super(...args);
          else super(${JSON.stringify(instant)});
        }
        static now() { return new RealDate(${JSON.stringify(instant)}).getTime(); }
      };
      const {default: plugin} = await import(${JSON.stringify(`data:text/javascript;base64,${Buffer.from(manifest.runtime.source).toString('base64')}`)});
      console.log(JSON.stringify(plugin.completions.dates({}, {query: ''}).map(item => item.insertText)));
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      env: { PATH: process.env.PATH, TZ: timezone },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(JSON.parse(output)).toEqual(expected);
  });

  it('ships only as an installable approved editor completion package', () => {
    expect(manifest).toMatchObject({ id: 'date-mentions', name: '날짜 자동완성', commands: [] });
    expect(manifest.runtime.permissions).toEqual(['editor.write']);
    expect(manifest.runtime.completions).toEqual([{ id: 'dates', trigger: '@' }]);
    expect(extensionCatalog.filter(({ id }) => id === manifest.id)).toEqual([manifest]);
  });
});
