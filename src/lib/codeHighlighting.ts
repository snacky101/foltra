import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export const editorHighlightStyle = HighlightStyle.define([
  { tag: tags.meta, class: 'code-muted' },
  { tag: tags.link, class: 'code-accent' },
  { tag: tags.heading, class: 'code-heading' },
  { tag: tags.emphasis, class: 'code-emphasis' },
  { tag: tags.strong, class: 'code-strong' },
  { tag: tags.strikethrough, class: 'code-strikethrough' },
  { tag: tags.keyword, class: 'code-syntax-keyword' },
  { tag: [tags.atom, tags.bool, tags.url, tags.labelName], class: 'code-syntax-atom' },
  { tag: [tags.literal, tags.inserted, tags.typeName, tags.namespace], class: 'code-syntax-literal' },
  { tag: [tags.string, tags.deleted], class: 'code-syntax-string' },
  { tag: [tags.regexp, tags.escape, tags.special(tags.string)], class: 'code-warning' },
  { tag: [tags.definition(tags.variableName), tags.className], class: 'code-accent' },
  { tag: tags.comment, class: 'code-muted' },
  { tag: tags.invalid, class: 'code-danger' },
]);
