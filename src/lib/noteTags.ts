import { parser, GFM } from '@lezer/markdown';
import type { Tree } from '@lezer/common';
const markdown = parser.configure(GFM);
export interface NoteTag {
  name: string;
  from: number;
  to: number;
}
// Keep this token grammar in sync with core/tags.rs; both use the shared fixtures.
export function tagTokens(body: string): NoteTag[] {
  return [
    ...body.matchAll(
      /(^|[\s([{"'“‘>*~])#([\p{L}\p{N}_][\p{L}\p{N}\p{M}_-]*(?:\/[\p{L}\p{N}_][\p{L}\p{N}\p{M}_-]*)*)/gu,
    ),
  ]
    .filter((m) => [...m[2]].length <= 128)
    .map((m) => ({ name: m[2].toLowerCase(), from: m.index + m[1].length, to: m.index + m[0].length }));
}
export function noteTags(body: string, tree: Tree = markdown.parse(body)): NoteTag[] {
  const excluded: { from: number; to: number }[] = [];
  tree.iterate({
    enter(node) {
      if (
        [
          'FencedCode',
          'CodeBlock',
          'InlineCode',
          'Link',
          'Autolink',
          'Image',
          'HTMLBlock',
          'HTMLTag',
          'CommentBlock',
          'Comment',
          'Escape',
        ].includes(node.name)
      ) {
        excluded.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  for (const match of body.matchAll(/\[\[[^\]\n]*\]\]/g))
    excluded.push({ from: match.index, to: match.index + match[0].length });
  return tagTokens(body).filter((tag) => !excluded.some((r) => r.from <= tag.from && r.to > tag.from));
}
