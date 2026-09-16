import { parser } from '@lezer/markdown';
import type { Source } from './sources';
import { html } from './sources';

interface ImageReference {
  from: number;
  to: number;
  path: string;
  filename: string;
}
function references(text: string): ImageReference[] {
  const result: ImageReference[] = [];
  parser.parse(text).iterate({
    enter(node) {
      if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock'].includes(node.name)) return false;
      if (node.name !== 'Image') return;
      const url = node.node.getChild('URL');
      const target = url ? text.slice(url.from, url.to).replace(/^<|>$/g, '') : '';
      const match = /^(?:\.\.\/)?attachments\/([a-f0-9]{64}\.(?:png|jpg|gif|webp))$/.exec(target);
      if (match)
        result.push({
          from: node.from,
          to: node.to,
          path: `attachments/${match[1]}`,
          filename: `foltra-${match[1]}`,
        });
      return false;
    },
  });
  return result;
}

export function prepareCard(source: Source) {
  const media = new Map<string, string>();
  const render = (text: string) => {
    text = text.trim();
    let result = '',
      offset = 0;
    for (const image of references(text)) {
      media.set(image.path, image.filename);
      result += html(text.slice(offset, image.from)) + `<img src="${image.filename}">`;
      offset = image.to;
    }
    return result + html(text.slice(offset));
  };
  const fields = {
    Front: render(source.front),
    Back: render(source.back),
    Source: html(`Foltra · ${source.label}`),
  };
  return { fields, media };
}

export function hasImages(source: Source) {
  return references(source.front).length > 0 || references(source.back).length > 0;
}
