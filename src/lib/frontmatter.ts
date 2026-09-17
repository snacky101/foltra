import { isMap, isNode, isScalar, parseDocument, stringify, visit, type Document } from 'yaml';

export interface Frontmatter {
  from: 0;
  to: number;
  yaml: string;
  bodyFrom: number;
  closed: boolean;
}

// This is user-authored frontmatter in the editable Markdown body. Foltra's
// managed file header and note identity remain owned by the vault core.
export function frontmatterRange(body: string): Frontmatter | null {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(body);
  if (!opening) return null;
  // Use literal LF boundaries and absolute EOF; multiline $ also accepts lone CR.
  const closing = /\n(---[ \t]*)(?:\r?\n|(?![\s\S]))/g;
  closing.lastIndex = opening[0].length - 1;
  const match = closing.exec(body);
  if (!match) return null;
  const bodyFrom = match.index + match[0].length;
  const start = match.index + 1;
  const to = start + match[1].length;
  return { from: 0, to, yaml: body.slice(opening[0].length, start), bodyFrom, closed: true };
}

function validateValue(value: unknown, depth = 0): void {
  if (depth > 16) throw new Error('속성의 중첩은 16단계까지 지원합니다.');
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      if (typeof key !== 'string' || !key.trim())
        throw new Error('속성 이름은 비어 있지 않은 문자열이어야 합니다.');
      validateValue(entry, depth + 1);
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) validateValue(entry, depth + 1);
  } else if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('유한한 숫자만 사용할 수 있습니다.');
  } else if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new Error('정수는 ±9,007,199,254,740,991 범위까지 지원합니다. 더 큰 값은 따옴표로 감싸세요.');
  }
}

function parseYaml(source: string) {
  if (new TextEncoder().encode(source).byteLength > 64 * 1024)
    throw new Error('속성 영역은 64 KiB까지 표시할 수 있습니다. 원문은 보존됩니다.');
  const document = parseDocument(source, {
    uniqueKeys: true,
    version: '1.2',
    schema: 'core',
    resolveKnownTags: false,
  });
  if (document.errors.length) throw new Error(document.errors[0].message);
  if (document.warnings.length) throw new Error(document.warnings[0].message);
  visit(document, (_key, node) => {
    if (isNode(node) && node.tag && !/^tag:yaml\.org,2002:(str|null|bool|int|float|map|seq)$/.test(node.tag))
      throw new Error('사용자 정의 YAML 태그는 지원하지 않습니다.');
  });
  const value: unknown = document.toJS({ mapAsMap: true, maxAliasCount: 0 });
  validateValue(value);
  return { document, value };
}

export function parseFrontmatter(yaml: string): Document {
  const { document, value } = parseYaml(yaml);
  if (value !== null && !(value instanceof Map)) throw new Error('속성은 이름: 값 형태로 작성하세요.');
  return document;
}

export function frontmatterEntries(document: Document): { key: string; value: string }[] {
  if (!isMap(document.contents)) return [];
  return document.contents.items.map((pair) => ({
    key: String(isScalar(pair.key) ? pair.key.value : pair.key),
    value: stringify(pair.value, { lineWidth: 0, collectionStyle: 'flow' }).trimEnd(),
  }));
}

export function updateFrontmatter(source: string, key: string, value: string | null, adding = false) {
  const document = parseFrontmatter(source);
  const name = adding ? key.trim() : key;
  if (!name.trim()) throw new Error('속성 이름을 입력하세요.');
  if (adding && document.has(name)) throw new Error('같은 이름의 속성이 있습니다.');
  if (value === null) document.delete(name);
  else {
    const parsed = parseYaml(value);
    const previous = document.get(name, true);
    const next = parsed.document.contents ?? document.createNode(null);
    if (isNode(previous)) {
      next.comment ??= previous.comment;
      next.commentBefore ??= previous.commentBefore;
      next.spaceBefore ??= previous.spaceBefore;
    }
    document.set(name, next);
  }
  const updated = document.toString({ lineWidth: 0 });
  parseFrontmatter(updated);
  return updated;
}

export function frontmatterBlock(yaml: string) {
  return `---\n${yaml.endsWith('\n') || !yaml ? yaml : `${yaml}\n`}---`;
}
