import type { Extension, Workspace } from './types';

const tokenNames = ['paper', 'panel', 'ink', 'muted', 'line', 'accent', 'sidebar', 'sidebar-ink'] as const;
type Token = (typeof tokenNames)[number];
export type ThemeTokens = Record<Token, string>;
export const builtInThemes = [
  {
    id: 'paper',
    name: 'Paper & Pine',
    tokens: {
      paper: '#f8f7f3',
      panel: '#f1f0e9',
      ink: '#303c35',
      muted: '#667060',
      line: '#e3e5dc',
      accent: '#57785f',
      sidebar: '#213d35',
      'sidebar-ink': '#e4eadd',
    },
  },
  {
    id: 'night',
    name: 'Midnight',
    tokens: {
      paper: '#202827',
      panel: '#27312e',
      ink: '#dee5d8',
      muted: '#a2b1a4',
      line: '#36443c',
      accent: '#b3c7a3',
      sidebar: '#17211f',
      'sidebar-ink': '#d3dfd1',
    },
  },
] as const;
const validColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const rgb = (color: string) => [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
function luminance(color: string) {
  const channels = rgb(color).map((value) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrastRatio(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function mixColor(foreground: string, background: string, amount: number) {
  const back = rgb(background);
  return (
    '#' +
    rgb(foreground)
      .map((value, i) =>
        Math.round(value * amount + back[i] * (1 - amount))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
function readable(color: string, backgrounds: string[], minimum = 4.5) {
  const works = (candidate: string) =>
    backgrounds.every((background) => contrastRatio(candidate, background) >= minimum);
  if (works(color)) return color;
  for (let step = 1; step <= 100; step++) {
    for (const target of ['#000000', '#ffffff']) {
      const candidate = mixColor(target, color, step / 100);
      if (works(candidate)) return candidate;
    }
  }
  return contrastRatio('#ffffff', backgrounds[0]) > contrastRatio('#000000', backgrounds[0])
    ? '#ffffff'
    : '#000000';
}
export function themePalette(id: string, extensions: Extension[] = []) {
  const builtin = builtInThemes.find((theme) => theme.id === id);
  const imported = extensions.find((theme) => theme.kind === 'theme' && theme.id === id);
  const supplied: Record<string, string> = { ...builtin?.tokens, ...imported?.tokens };
  const dark = validColor(supplied.paper) && luminance(supplied.paper) < 0.18;
  const tokens: ThemeTokens = { ...builtInThemes[dark ? 1 : 0].tokens };
  for (const name of tokenNames) if (validColor(supplied[name])) tokens[name] = supplied[name];
  // Partial imported themes inherit a matching light/dark palette. A mismatched
  // panel is brought back onto the same surface so one foreground stays readable.
  if (luminance(tokens.panel) < 0.18 !== dark)
    tokens.panel = mixColor(dark ? '#ffffff' : '#000000', tokens.paper, 0.04);
  const surfaces = [tokens.paper, tokens.panel];
  tokens.ink = readable(tokens.ink, surfaces);
  tokens.muted = readable(tokens.muted, surfaces);
  tokens.accent = readable(tokens.accent, surfaces, 5.5);
  tokens['sidebar-ink'] = readable(tokens['sidebar-ink'], [tokens.sidebar]);
  const selection = validColor(supplied.selection)
    ? supplied.selection
    : mixColor(tokens.accent, tokens.paper, 0.18);
  tokens.ink = readable(tokens.ink, [...surfaces, selection]);
  const sidebarMuted = readable(mixColor(tokens['sidebar-ink'], tokens.sidebar, 0.7), [
    tokens.sidebar,
    mixColor(tokens['sidebar-ink'], tokens.sidebar, 0.14),
  ]);
  const semantic = (name: string, color: string) =>
    readable(validColor(supplied[name]) ? supplied[name] : color, surfaces, 5.5);
  return {
    dark,
    tokens: {
      ...tokens,
      selection,
      strong: readable(
        validColor(supplied.strong) ? supplied.strong : mixColor(tokens.accent, tokens.ink, 0.6),
        [...surfaces, selection],
      ),
      'sidebar-muted': sidebarMuted,
      danger: semantic('danger', dark ? '#eea18c' : '#a4553f'),
      warning: semantic('warning', dark ? '#e2c77b' : '#8b661e'),
      success: semantic('success', dark ? '#a8c99b' : '#4c7147'),
      'syntax-keyword': semantic('syntax-keyword', dark ? '#d4b4e6' : '#77508e'),
      'syntax-atom': semantic('syntax-atom', dark ? '#aabce9' : '#48689b'),
      'syntax-literal': semantic('syntax-literal', dark ? '#afd0b2' : '#417a53'),
      'syntax-string': semantic('syntax-string', dark ? '#e3b59f' : '#a25940'),
    },
  };
}
export function themeChoices(extensions: Extension[]) {
  const choices = new Map<string, { id: string; name: string; installed: boolean }>(
    builtInThemes.map((theme) => [
      theme.id as string,
      { id: theme.id as string, name: theme.name, installed: false },
    ]),
  );
  for (const theme of extensions)
    if (theme.kind === 'theme') choices.set(theme.id, { id: theme.id, name: theme.name, installed: true });
  return [...choices.values()];
}
export function applyTheme(workspace: Workspace) {
  const root = document.documentElement;
  const palette = themePalette(workspace.settings.theme, workspace.extensions);
  root.dataset.theme = palette.dark ? 'night' : 'paper';
  root.style.colorScheme = palette.dark ? 'dark' : 'light';
  for (const [name, value] of Object.entries(palette.tokens)) root.style.setProperty(`--${name}`, value);
}
