import { useEffect, useMemo, useState } from 'react';
import { LanguageDescription, type LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightTree } from '@lezer/highlight';
import { editorHighlightStyle } from '../lib/codeHighlighting';

export function HighlightedCode({ className, source }: { className?: string; source: string }) {
  const name = className?.match(/(?:^|\s)language-(\S+)/)?.[1];
  const language = name ? LanguageDescription.matchLanguageName(languages, name, false) : null;
  const [loaded, setLoaded] = useState<{ language: LanguageDescription; support: LanguageSupport } | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    if (language)
      void language
        .load()
        .then((support) => {
          if (active) setLoaded({ language, support });
        })
        .catch(() => {
          /* A missing highlighter leaves readable plain text. */
        });
    return () => {
      active = false;
    };
  }, [language]);
  const content = useMemo(() => {
    const support = language?.support ?? (loaded?.language === language ? loaded?.support : null);
    if (!support) return source;
    const parts: (string | React.ReactElement)[] = [];
    let cursor = 0;
    highlightTree(support.language.parser.parse(source), editorHighlightStyle, (from, to, style) => {
      if (from > cursor) parts.push(source.slice(cursor, from));
      parts.push(
        <span key={from} className={style}>
          {source.slice(from, to)}
        </span>,
      );
      cursor = to;
    });
    if (cursor < source.length) parts.push(source.slice(cursor));
    return parts;
  }, [source, language, loaded]);
  return <code className={className}>{content}</code>;
}
