// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { applyTheme, builtInThemes, contrastRatio, mixColor, themeChoices, themePalette } from './theme';
import { themeCatalog } from './themeCatalog';
import type { Extension, Workspace } from './types';

test.each([...builtInThemes, ...themeCatalog].map((t) => t.id))(
  '%s has readable text on its content, panels, selection and sidebar',
  (id) => {
    const { tokens: t } = themePalette(id, [...themeCatalog]);
    for (const color of [
      'ink',
      'muted',
      'accent',
      'strong',
      'danger',
      'warning',
      'success',
      'syntax-keyword',
      'syntax-atom',
      'syntax-literal',
      'syntax-string',
    ] as const) {
      for (const background of [t.paper, t.panel])
        expect(
          contrastRatio(t[color], background),
          `${id}: ${color} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(t.ink, t.selection)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.strong, t.selection)).toBeGreaterThanOrEqual(4.5);
    expect(t.strong).not.toBe(t.ink);
    for (const color of [t['sidebar-ink'], t['sidebar-muted']]) {
      expect(contrastRatio(color, t.sidebar)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color, mixColor(t['sidebar-ink'], t.sidebar, 0.14))).toBeGreaterThanOrEqual(4.5);
    }
  },
);

test('imported partial dark palettes get matching surfaces and repair illegible text', () => {
  const theme: Extension = {
    kind: 'theme',
    id: 'custom',
    name: 'Dark',
    version: '1.0.0',
    tokens: {
      paper: '#191919',
      ink: '#222222',
      muted: '#222222',
      accent: '#202020',
      sidebar: '#eeeeee',
      'sidebar-ink': '#ffffff',
    },
  };
  const original = structuredClone(theme);
  const { dark, tokens: t } = themePalette(theme.id, [theme]);
  expect(dark).toBe(true);
  expect(t.panel).toBe(themePalette('night').tokens.panel);
  for (const background of [t.paper, t.panel, t.selection])
    expect(contrastRatio(t.ink, background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(t.muted, t.panel)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(t['sidebar-ink'], t.sidebar)).toBeGreaterThanOrEqual(4.5);
  expect(theme).toEqual(original);
});

test('custom bold colors are optional, preserved when readable and repaired when illegible', () => {
  const theme = (strong: string): Extension => ({
    kind: 'theme',
    id: 'emphasis',
    name: 'Emphasis',
    version: '1.0.0',
    tokens: { strong },
  });
  expect(themePalette('emphasis', [theme('#365747')]).tokens.strong).toBe('#365747');
  for (const strong of ['#ffffff', 'url(https://example.com/leak)']) {
    const { tokens } = themePalette('emphasis', [theme(strong)]);
    for (const background of [tokens.paper, tokens.panel, tokens.selection])
      expect(contrastRatio(tokens.strong, background)).toBeGreaterThanOrEqual(4.5);
  }
});

test('switching an installed dark theme to Paper resets selection, colors and native controls without stale tokens', () => {
  const workspace = (theme: string) =>
    ({ settings: { theme }, extensions: [...themeCatalog] }) as unknown as Workspace;
  applyTheme(workspace('catppuccin-mocha'));
  expect(document.documentElement.dataset.theme).toBe('night');
  expect(document.documentElement.style.colorScheme).toBe('dark');
  const selection = document.documentElement.style.getPropertyValue('--selection');
  applyTheme(workspace('paper'));
  expect(document.documentElement.dataset.theme).toBe('paper');
  expect(document.documentElement.style.colorScheme).toBe('light');
  expect(document.documentElement.style.getPropertyValue('--selection')).not.toBe(selection);
  for (const [key, value] of Object.entries(themePalette('paper').tokens))
    expect(document.documentElement.style.getPropertyValue(`--${key}`)).toBe(value);
});

test('built-ins coexist with imported overrides without duplicate choices or changing files', () => {
  const imported: Extension = {
    id: 'paper',
    name: 'My Paper',
    kind: 'theme',
    version: '2.0.0',
    tokens: { paper: '#ffffff' },
  };
  expect(themeChoices([imported])).toHaveLength(2);
  expect(themeChoices([imported]).find((t) => t.id === 'paper')).toMatchObject({
    name: 'My Paper',
    installed: true,
  });
  expect(themePalette('paper', [imported]).tokens.paper).toBe('#ffffff');
  expect(themeChoices([]).every((t) => !t.installed)).toBe(true);
  expect(themePalette('missing')).toEqual(themePalette('paper'));
});
