import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

export function codeLanguage(name: string, fuzzy = false) {
  return LanguageDescription.matchLanguageName(languages, name === 'foltra-sql' ? 'PostgreSQL' : name, fuzzy);
}
