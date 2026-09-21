import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { Vim, type CodeMirrorV, type MotionArgs, type MotionFn, type vimState } from '@replit/codemirror-vim';
import {
  collectDelimitedCandidates,
  collectVimTextObjectCandidates,
  selectVimTextObject,
  textObjectSearchWindow,
  type TextObjectRange,
  type VimTextObjectCandidate,
  type VimTextObjectOptions,
} from './vimTextObjectRanges';

const contexts = ['operatorPending', 'visual'] as const;
const identifiers = Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)).filter(
  (key) => !/[A-Za-z]/.test(key) || 'abBfqt'.includes(key),
);
const activeEditors = new WeakMap<object, { closePrompt?: () => void }>();
interface ObjectArgs extends MotionArgs {
  search?: VimTextObjectOptions['search'];
  edge?: 'left' | 'right';
  opening?: string;
  closing?: string;
}

function splitsSurrogate(source: string, position: number) {
  return /[\uD800-\uDBFF]/.test(source[position - 1] ?? '') && /[\uDC00-\uDFFF]/.test(source[position] ?? '');
}

function candidates(
  view: EditorView,
  source: string,
  reference: TextObjectRange,
  args: ObjectArgs,
): VimTextObjectCandidate[] {
  const window = textObjectSearchWindow(source, reference);
  if (!window) return [];
  if (args.opening !== undefined && args.closing !== undefined)
    return collectDelimitedCandidates(source, args.opening, args.closing, window);
  const identifier = args.selectedCharacter ?? '';
  const plain = collectVimTextObjectCandidates(source, identifier, window);
  if (!'*_~'.includes(identifier)) return plain;
  const tree = ensureSyntaxTree(view.state, window.to, 50) ?? syntaxTree(view.state);
  const markdown: VimTextObjectCandidate[] = [];
  tree.iterate({
    from: window.from,
    to: window.to,
    enter(node) {
      if (!['Emphasis', 'StrongEmphasis', 'Strikethrough'].includes(node.name)) return;
      const first = node.node.firstChild;
      const last = node.node.lastChild;
      if (!first || !last || source[first.from] !== identifier) return;
      markdown.push({
        around: { from: node.from, to: node.to },
        inner: { from: first.to, to: last.from },
      });
    },
  });
  // Markdown keeps both syntax delimiters for `a*`/`a_`/`a~`. Elsewhere these
  // characters retain mini.ai's separator behavior, e.g. some_identifier_here.
  return [
    ...markdown,
    ...plain.filter((candidate) => {
      const range = candidate.match ?? candidate.around;
      return !markdown.some(({ around }) => range.from < around.to && range.to > around.from);
    }),
  ];
}

function referenceRange(cm: CodeMirrorV, head: { line: number; ch: number }, vim: vimState) {
  if (vim.visualMode) {
    const state = (cm.cm6 as EditorView).state;
    const selection = state.selection.main;
    // Initial `v` selects one character, which is still a cursor reference.
    const characterSize =
      (state.doc.sliceString(selection.from, selection.from + 2).codePointAt(0) ?? 0) > 0xffff ? 2 : 1;
    if (vim.lastMotion === textObjectMotion || selection.to - selection.from > characterSize)
      return { from: selection.from, to: selection.to };
    return { from: selection.from, to: selection.from };
  }
  const from = cm.indexFromPos(head);
  return { from, to: from };
}

const textObjectMotion: MotionFn = (cm, head, rawArgs, vim) => {
  if (!activeEditors.has(cm)) return null;
  const args = rawArgs as ObjectArgs;
  const view = cm.cm6 as EditorView;
  const source = view.state.doc.toString();
  const reference = referenceRange(cm, head, vim);
  const choices = candidates(view, source, reference, args);
  const options = { inner: args.textObjectInner, count: args.repeat, search: args.search };
  if (args.edge) {
    const first = selectVimTextObject(source, reference, choices, { ...options, inner: false, count: 1 });
    if (!first) return null;
    const boundary = (range: TextObjectRange) =>
      args.edge === 'left' ? range.from : Math.max(range.from, range.to - 1);
    const repeat = args.repeat + Number(boundary(first) === cm.indexFromPos(head));
    const range =
      repeat === 1
        ? first
        : selectVimTextObject(source, reference, choices, { ...options, inner: false, count: repeat });
    return range ? cm.posFromIndex(boundary(range)) : null;
  }
  const range = selectVimTextObject(source, reference, choices, options);
  if (!range || (vim.visualMode && range.from === range.to)) return null;
  if (vim.visualMode) {
    vim.visualLine = false;
    vim.visualBlock = false;
  }
  // Operators consume an exclusive end; Visual uses an inclusive endpoint.
  let end = vim.visualMode ? range.to - 1 : range.to;
  if (vim.visualMode && splitsSurrogate(source, end)) end--;
  return [cm.posFromIndex(range.from), cm.posFromIndex(end)];
};
Vim.defineMotion('foltraTextObject', textObjectMotion);

Vim.defineMotion('foltraPromptObject', (cm, _head, rawArgs, vim, inputState) => {
  const binding = activeEditors.get(cm);
  if (!binding) return null;
  const args = rawArgs as ObjectArgs;
  const view = cm.cm6 as EditorView;
  const document = view.state.doc;
  const selection = view.state.selection;
  const current = () =>
    activeEditors.get(cm) === binding && view.state.doc === document && view.state.selection.eq(selection);
  const ask = (label: string, accept: (value: string) => void) => {
    const element = view.dom.ownerDocument.createElement('label');
    element.append(`${label} `);
    const input = view.dom.ownerDocument.createElement('input');
    input.type = 'text';
    input.maxLength = 1000;
    input.setAttribute('aria-label', label);
    element.append(input);
    binding.closePrompt = cm.openDialog(
      element,
      (value: string) => {
        if (value && current()) accept(value);
      },
      { bottom: true, onKeyDown: (event: KeyboardEvent) => event.isComposing || event.keyCode === 229 },
    );
  };
  ask('시작 구분자', (opening) =>
    ask('끝 구분자', (closing) => {
      // Replay through the normal Vim motion pipeline so registers, counts,
      // operators, undo and dot-repeat all retain this exact literal pair.
      queueMicrotask(() => {
        if (!current()) return;
        const context = inputState.operator ? 'operatorPending' : vim.visualMode ? 'visual' : 'normal';
        Vim.mapCommand(
          '<FoltraLiteralPair>',
          'motion',
          'foltraTextObject',
          { ...args, opening, closing },
          { context },
        );
        try {
          vim.inputState = inputState;
          inputState.keyBuffer.length = 0;
          Vim.handleKey(cm, '<FoltraLiteralPair>', 'user');
        } finally {
          Vim.unmap('<FoltraLiteralPair>', context);
        }
      });
    }),
  );
  return null;
});

export function bindVimTextObjects(cm: object) {
  const binding = {};
  activeEditors.set(cm, binding);
  const editor = cm as CodeMirrorV;
  const originalSetSelections = editor.setSelections;
  const setSelections: typeof originalSetSelections = function (this: CodeMirrorV, ranges, primary) {
    if (editor.state.vim?.visualMode) {
      const doc = (editor.cm6 as EditorView).state.doc;
      const splitAt = (position: number) =>
        position > 0 &&
        position < doc.length &&
        splitsSurrogate(doc.sliceString(position - 1, position + 1), 1);
      // Vim uses inclusive UTF-16 endpoints and adds one code unit. Expand a
      // split surrogate only at this editor's Visual selection boundary, for
      // both display and subsequent native operators, including reverse ranges.
      for (const range of ranges) {
        let start = editor.indexFromPos(range.anchor);
        let end = editor.indexFromPos(range.head);
        if (start === end) continue;
        const forward = start < end;
        if (splitAt(start)) {
          start += forward ? -1 : 1;
          range.anchor = editor.posFromIndex(start);
        }
        if (splitAt(end)) {
          end += forward ? 1 : -1;
          range.head = editor.posFromIndex(end);
        }
      }
    }
    return originalSetSelections.call(this, ranges, primary);
  };
  editor.setSelections = setSelections;
  const mappings: Array<{ keys: string; context: string }> = [];
  const map = (keys: string, args: ObjectArgs | Omit<ObjectArgs, 'repeat'>, context: string) => {
    Vim.mapCommand(
      keys,
      'motion',
      args.selectedCharacter === '?' ? 'foltraPromptObject' : 'foltraTextObject',
      args,
      { context },
    );
    mappings.push({ keys, context });
  };
  for (const context of contexts) {
    for (const inner of [true, false]) {
      const prefix = inner ? 'i' : 'a';
      for (const [suffix, direction] of [
        ['n', 'next'],
        ['l', 'previous'],
      ] as const) {
        const virtual = `<Foltra${inner ? 'Inside' : 'Around'}${suffix === 'n' ? 'Next' : 'Last'}>`;
        // A concrete alias must consume `in` first: otherwise Vim's built-in
        // i<register> fallback completes before a third object key can arrive.
        Vim.map(`${prefix}${suffix}`, virtual, context);
        mappings.push({ keys: `${prefix}${suffix}`, context });
        for (const identifier of identifiers)
          map(
            `${virtual}${identifier === ' ' ? '<Space>' : identifier}`,
            { selectedCharacter: identifier, textObjectInner: inner, search: direction },
            context,
          );
      }
      for (const identifier of identifiers)
        map(
          `${prefix}${identifier === ' ' ? '<Space>' : identifier}`,
          { selectedCharacter: identifier, textObjectInner: inner },
          context,
        );
    }
  }
  for (const context of ['normal', ...contexts])
    for (const [prefix, edge] of [
      ['g[', 'left'],
      ['g]', 'right'],
    ] as const)
      for (const identifier of identifiers)
        map(
          `${prefix}${identifier === ' ' ? '<Space>' : identifier}`,
          { selectedCharacter: identifier, edge, inclusive: true },
          context,
        );
  return () => {
    if (editor.setSelections === setSelections) editor.setSelections = originalSetSelections;
    if (activeEditors.get(cm) === binding) {
      activeEditors.get(cm)?.closePrompt?.();
      activeEditors.delete(cm);
    }
    for (const { keys, context } of mappings) Vim.unmap(keys, context);
  };
}
