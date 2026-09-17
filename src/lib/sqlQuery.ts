export interface SqlResult {
  columns: { name: string; type: string }[];
  rows: (string | null)[][];
  truncated: boolean;
  limit: number;
}

export interface SqlCatalog {
  tables: {
    databaseId: string;
    name: string;
    columns: { name: string; propertyId: string | null; type: string }[];
    sql: string;
  }[];
}

export function isQueryLanguage(language: string) {
  return language === 'foltra-sql' || language === 'foltra-query';
}

export function sqlQueryMarkdown(sql: string) {
  // A quoted identifier can contain backticks or newlines. Keep them inside one fence.
  const longest = Math.max(2, ...Array.from(sql.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return `\n\n${fence}foltra-sql\n${sql.trimEnd()}\n${fence}\n`;
}
