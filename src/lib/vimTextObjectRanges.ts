/** Half-open document offsets, shared by operator, Visual, and edge motions. */
export interface TextObjectRange {
  from: number;
  to: number;
}

export interface VimTextObjectCandidate {
  around: TextObjectRange;
  inner: TextObjectRange;
  /** Search envelope when a separator is intentionally excluded from `around`. */
  match?: TextObjectRange;
}

export interface VimTextObjectOptions {
  inner?: boolean;
  count?: number;
  search?: 'cover_or_next' | 'next' | 'previous' | 'prev';
  nLines?: number;
}

// A huge minified line or numeric prefix must not freeze editor key handling.
const maxSearchCharacters = 100_000;
const maxCount = 1_000;
const opening = '([{<';
const closing = ')]}>';
const quotes = new Set(['"', "'", '`']);
const whitespace = /\s/u;
const word = /[\p{L}\p{N}_]/u;
const functionName = /[\p{L}\p{N}_.$:]/u;

const equal = (a: TextObjectRange, b: TextObjectRange) => a.from === b.from && a.to === b.to;
const width = (range: TextObjectRange) => range.to - range.from;
const contains = (outer: TextObjectRange, inner: TextObjectRange) =>
  outer.from <= inner.from && (inner.from === inner.to ? outer.to > inner.to : outer.to >= inner.to);

function trim(source: string, range: TextObjectRange): TextObjectRange {
  let { from, to } = range;
  while (from < to && whitespace.test(source[from])) from++;
  while (to > from && whitespace.test(source[to - 1])) to--;
  return { from, to };
}

function validReference(source: string, reference: TextObjectRange) {
  return (
    Number.isInteger(reference.from) &&
    Number.isInteger(reference.to) &&
    reference.from >= 0 &&
    reference.to >= reference.from &&
    reference.to <= source.length &&
    width(reference) <= maxSearchCharacters
  );
}

function lineWindow(source: string, reference: TextObjectRange, nLines: number): TextObjectRange {
  const limit = Math.max(0, Math.min(50, Math.floor(nLines)));
  let from = reference.from;
  let to = reference.to;
  let lines = 0;
  const leftLimit = Math.max(0, from - maxSearchCharacters / 2);
  const rightLimit = Math.min(source.length, to + maxSearchCharacters / 2);
  while (from > leftLimit) {
    if (source[from - 1] === '\n' && lines++ >= limit) break;
    from--;
  }
  lines = 0;
  while (to < rightLimit) {
    if (source[to] === '\n' && lines++ >= limit) break;
    to++;
  }
  return { from, to };
}

export function textObjectSearchWindow(
  source: string,
  reference: TextObjectRange,
  nLines = 50,
): TextObjectRange | null {
  if (!validReference(source, reference)) return null;
  const range = lineWindow(source, reference, Number.isFinite(nLines) ? nLines : 50);
  return width(range) <= maxSearchCharacters ? range : null;
}

function collectionWindow(source: string, window?: TextObjectRange): TextObjectRange {
  const from = Math.max(0, Math.min(source.length, window?.from ?? 0));
  const to = Math.max(from, Math.min(source.length, window?.to ?? source.length, from + maxSearchCharacters));
  return { from, to };
}

interface BracketPair extends TextObjectRange {
  kind: string;
  commas: number[];
}

/** Single pass pairs delimiters and records only commas at their direct depth. */
function scan(source: string, window: TextObjectRange, angleBrackets: boolean) {
  const brackets: BracketPair[] = [];
  const strings: Array<TextObjectRange & { kind: string }> = [];
  const stack: Array<{ from: number; kind: string; commas: number[] }> = [];
  const quoteStarts = new Map<string, number>();
  let bracketQuote: string | null = null;
  for (let i = window.from; i < window.to; i++) {
    const character = source[i];
    if (character === '\\') {
      i++;
      continue;
    }
    const isQuote =
      quotes.has(character) &&
      !(character === "'" && word.test(source[i - 1] ?? '') && word.test(source[i + 1] ?? ''));
    if (isQuote) {
      const from = quoteStarts.get(character);
      if (from === undefined) quoteStarts.set(character, i);
      else {
        strings.push({ from, to: i + 1, kind: character });
        quoteStarts.delete(character);
      }
    } else if (character === '\n') {
      quoteStarts.delete('"');
      quoteStarts.delete("'");
    }

    // Quotes within an argument protect its separators. Top-level quoted code
    // stays searchable, so af/ia also work in inline and fenced Markdown code.
    if (bracketQuote) {
      if (character === bracketQuote || (character === '\n' && bracketQuote !== '`')) bracketQuote = null;
      continue;
    }
    if (isQuote && stack.length) {
      bracketQuote = character;
      continue;
    }
    if (opening.includes(character) && (angleBrackets || character !== '<')) {
      stack.push({ from: i, kind: character, commas: [] });
    } else if (closing.includes(character) && (angleBrackets || character !== '>')) {
      const top = stack.at(-1);
      if (top?.kind === opening[closing.indexOf(character)]) {
        stack.pop();
        brackets.push({ ...top, to: i + 1 });
      } else {
        // Malformed crossed pairs are not safe operator targets.
        stack.length = 0;
      }
    } else if (character === ',') {
      stack.at(-1)?.commas.push(i);
    }
  }
  return { brackets, strings };
}

function pairCandidate(range: TextObjectRange): VimTextObjectCandidate {
  return { around: { from: range.from, to: range.to }, inner: { from: range.from + 1, to: range.to - 1 } };
}

function tagCandidates(source: string, window: TextObjectRange): VimTextObjectCandidate[] {
  const candidates: VimTextObjectCandidate[] = [];
  const stack: Array<{ name: string; from: number; to: number }> = [];
  const tagStart = /<\/?([A-Za-z][\w:.-]*)/gy;
  const voidTags = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ]);
  const input = source.slice(window.from, window.to);
  for (let i = 0; i < input.length;) {
    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i + 4);
      i = end < 0 ? input.length : end + 3;
      continue;
    }
    tagStart.lastIndex = i;
    const match = tagStart.exec(input);
    if (!match) {
      i++;
      continue;
    }
    const start = i;
    i = tagStart.lastIndex;
    if (i < input.length && !/[\s/>]/.test(input[i])) continue;
    let quote: string | null = null;
    for (; i < input.length; i++) {
      const character = input[i];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '<' || character === '>') break;
    }
    if (input[i] !== '>') continue;
    const from = window.from + start;
    const to = window.from + ++i;
    const name = match[1];
    if (input[start + 1] === '/') {
      const open = stack.at(-1);
      if (open?.name === name) {
        stack.pop();
        candidates.push({ around: { from: open.from, to }, inner: { from: open.to, to: from } });
      } else stack.length = 0;
    } else if (input[i - 2] !== '/' && !voidTags.has(name.toLowerCase())) {
      stack.push({ name, from, to });
    }
  }
  return candidates;
}

function separatorCandidates(source: string, identifier: string, window: TextObjectRange) {
  const candidates: VimTextObjectCandidate[] = [];
  let previous: TextObjectRange | null = null;
  for (let i = window.from; i < window.to; i++) {
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source[i] !== identifier) continue;
    const from = i;
    while (i + 1 < window.to && source[i + 1] === identifier) i++;
    const to = i + 1;
    if (previous)
      candidates.push({
        match: { from: previous.from, to },
        around: { from: previous.to, to },
        inner: { from: previous.to, to: from },
      });
    previous = { from, to };
  }
  return candidates;
}

export function collectVimTextObjectCandidates(
  source: string,
  identifier: string,
  searchWindow?: TextObjectRange,
): VimTextObjectCandidate[] {
  const window = collectionWindow(source, searchWindow);
  if (identifier === 't') return tagCandidates(source, window);
  if (identifier.length !== 1) return [];
  if (!'()[]{}<>bBqfa'.includes(identifier) && !quotes.has(identifier)) {
    return /[A-Za-z\r\n]/.test(identifier) ? [] : separatorCandidates(source, identifier, window);
  }
  const { brackets, strings } = scan(source, window, identifier === '<' || identifier === '>');
  if (quotes.has(identifier) || identifier === 'q') {
    return strings.filter((range) => identifier === 'q' || range.kind === identifier).map(pairCandidate);
  }
  if (identifier === 'f') {
    return brackets.flatMap((range) => {
      if (range.kind !== '(') return [];
      let from = range.from;
      while (from > window.from && /[ \t]/.test(source[from - 1])) from--;
      const nameEnd = from;
      while (from > window.from && functionName.test(source[from - 1])) from--;
      if (from === nameEnd || !/[\p{L}_$]/u.test(source[from])) return [];
      return [{ around: { from, to: range.to }, inner: { from: range.from + 1, to: range.to - 1 } }];
    });
  }
  if (identifier === 'a') {
    return brackets.flatMap((range) => {
      const bounds = [range.from, ...range.commas, range.to - 1];
      return bounds.slice(0, -1).flatMap((left, index) => {
        const right = bounds[index + 1];
        const inner = trim(source, { from: left + 1, to: right });
        if (inner.from === inner.to) return [];
        const last = index === bounds.length - 2;
        const single = bounds.length === 2;
        const around = {
          from: single ? left + 1 : index === 0 ? inner.from : left,
          to: single ? right : index === 0 ? right + 1 : last ? inner.to : right,
        };
        return [
          { around, inner, match: { from: Math.min(left + 1, around.from), to: Math.max(right, around.to) } },
        ];
      });
    });
  }
  const kind =
    identifier === 'B'
      ? '{'
      : closing.includes(identifier)
        ? opening[closing.indexOf(identifier)]
        : identifier;
  return brackets
    .filter((range) => identifier === 'b' || range.kind === kind)
    .map((range) => {
      const candidate = pairCandidate(range);
      if (opening.includes(identifier)) candidate.inner = trim(source, candidate.inner);
      return candidate;
    });
}

/** Literal custom pairs: no regular expressions or executable user patterns. */
export function collectDelimitedCandidates(
  source: string,
  left: string,
  right: string,
  searchWindow?: TextObjectRange,
): VimTextObjectCandidate[] {
  if (!left || !right || left.length > 1000 || right.length > 1000) return [];
  const window = collectionWindow(source, searchWindow);
  const candidates: VimTextObjectCandidate[] = [];
  const stack: number[] = [];
  for (let i = window.from; i < window.to;) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source.startsWith(right, i) && i + right.length <= window.to && stack.length) {
      const from = stack.pop()!;
      candidates.push({ around: { from, to: i + right.length }, inner: { from: from + left.length, to: i } });
      i += right.length;
    } else if (source.startsWith(left, i) && i + left.length <= window.to) {
      stack.push(i);
      i += left.length;
    } else i++;
  }
  return candidates;
}

export function selectVimTextObject(
  source: string,
  reference: TextObjectRange,
  candidates: readonly VimTextObjectCandidate[],
  options: VimTextObjectOptions = {},
): TextObjectRange | null {
  const neighborhood = textObjectSearchWindow(source, reference, options.nLines);
  if (!neighborhood) return null;
  const count = Math.floor(options.count ?? 1);
  if (!Number.isFinite(count) || count < 1 || count > maxCount) return null;
  const bounded = candidates
    .filter(
      ({ around, inner, match = around }) =>
        match.from >= neighborhood.from &&
        match.to <= neighborhood.to &&
        inner.from >= around.from &&
        inner.to <= around.to &&
        inner.from <= inner.to &&
        around.from <= around.to,
    )
    .sort((a, b) => width(a.match ?? a.around) - width(b.match ?? b.around));
  let current = reference;
  const visited = new Set<VimTextObjectCandidate>();
  let lines = lineWindow(source, current, 0);
  let singleLine = !source.slice(lines.from, lines.to).includes('\n');
  for (let iteration = 0; iteration < count; iteration++) {
    // Most repeated objects remain on the same line. Reuse its bounds instead
    // of rescanning a long line on every expansion.
    if (!singleLine || current.from < lines.from || current.to > lines.to) {
      lines = lineWindow(source, current, 0);
      singleLine = !source.slice(lines.from, lines.to).includes('\n');
    }
    const choose = (local: boolean) => {
      let directional: VimTextObjectCandidate | null = null;
      const previous = options.search === 'prev' || options.search === 'previous';
      for (const candidate of bounded) {
        if (visited.has(candidate)) continue;
        const envelope = candidate.match ?? candidate.around;
        const output = options.inner ? candidate.inner : candidate.around;
        if (local && (envelope.from < lines.from || envelope.to > lines.to)) continue;
        if (current.from !== current.to && contains(current, output)) continue;
        if (equal(output, current) && current.from !== current.to) continue;
        // Candidates are ordered by width, so the first covering one is best.
        if ((!options.search || options.search === 'cover_or_next') && contains(envelope, current))
          return candidate;
        const ahead = previous
          ? envelope.from < current.from && envelope.to <= current.to
          : envelope.from >= current.from && envelope.to > current.to;
        if (!ahead || contains(envelope, current)) continue;
        if (
          !directional ||
          (previous
            ? envelope.to > (directional.match ?? directional.around).to
            : envelope.from < (directional.match ?? directional.around).from)
        )
          directional = candidate;
      }
      return directional;
    };
    const selected = choose(true) ?? choose(false);
    if (!selected) return null;
    visited.add(selected);
    current = options.inner ? selected.inner : selected.around;
  }
  return { ...current };
}

export function findVimTextObject(
  source: string,
  reference: TextObjectRange,
  identifier: string,
  options: VimTextObjectOptions = {},
): TextObjectRange | null {
  const window = textObjectSearchWindow(source, reference, options.nLines);
  return window
    ? selectVimTextObject(
        source,
        reference,
        collectVimTextObjectCandidates(source, identifier, window),
        options,
      )
    : null;
}
