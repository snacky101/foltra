import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { CodeMirror, Vim } from '@replit/codemirror-vim';
import { underlineRanges } from './markdownUnderline';

const delimiters = ['*', '_', '~'] as const;
const contexts = ['operatorPending', 'visual'] as const;

Vim.defineMotion('foltraMarkdownObject', (cm, head, args, vim) => {
  const view = cm.cm6 as EditorView;
  const position = cm.indexFromPos(head);
  const tree = ensureSyntaxTree(view.state, position, 50) ?? syntaxTree(view.state);
  let remaining = args.repeat;
  for (let node = tree.resolveInner(position, 1); node; node = node.parent!) {
    if (!['Emphasis', 'StrongEmphasis', 'Strikethrough'].includes(node.name)) continue;
    const start = node.firstChild;
    const end = node.lastChild;
    if (!start || !end || view.state.doc.sliceString(start.from, start.from + 1) !== args.selectedCharacter)
      continue;
    if (--remaining > 0) continue;
    const from = args.textObjectInner ? start.to : node.from;
    const to = args.textObjectInner ? end.from : node.to;
    // Operators consume an exclusive end; Visual's engine uses an inclusive head.
    return [cm.posFromIndex(from), cm.posFromIndex(vim.visualMode ? to - 1 : to)];
  }
  return null;
});

export function bindVimTextObjects(cm: object) {
  // Keep the engine's it/at and HTML-language behavior. Its Markdown adapter
  // cannot pair inline HTMLTag siblings, so extend only exact safe underline tags.
  const findEnclosingTag = CodeMirror.findEnclosingTag;
  const findUnderline: typeof findEnclosingTag = (editor, head) => {
    const original = findEnclosingTag(editor, head);
    if (original || editor !== cm) return original;
    const state = editor.cm6.state;
    const position = editor.indexFromPos(head);
    const tree = ensureSyntaxTree(state, position, 50) ?? syntaxTree(state);
    const range = underlineRanges(state.doc.toString(), tree)
      .filter((range) => range.from <= position && position < range.to)
      .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
    if (!range) return;
    return {
      open: { from: editor.posFromIndex(range.from), to: editor.posFromIndex(range.openEnd) },
      close: { from: editor.posFromIndex(range.closeFrom), to: editor.posFromIndex(range.to) },
    };
  };
  CodeMirror.findEnclosingTag = findUnderline;
  for (const delimiter of delimiters) {
    for (const inner of [true, false]) {
      for (const context of contexts) {
        Vim.mapCommand(
          `${inner ? 'i' : 'a'}${delimiter}`,
          'motion',
          'foltraMarkdownObject',
          { selectedCharacter: delimiter, textObjectInner: inner },
          { context },
        );
      }
    }
  }
  return () => {
    if (CodeMirror.findEnclosingTag === findUnderline) CodeMirror.findEnclosingTag = findEnclosingTag;
    for (const delimiter of delimiters)
      for (const prefix of ['i', 'a'])
        for (const context of contexts) Vim.unmap(`${prefix}${delimiter}`, context);
  };
}
