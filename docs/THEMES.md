# Themes

Paper & Pine and Midnight are built in. Settings → Themes offers Catppuccin Mocha, Rosé Pine, Tokyo Night and Darcula as optional installs, plus local JSON files. Installed themes have a delete button beside their selection card. Removing the active theme returns the vault to Paper & Pine in the same core transaction; notes and other settings are unchanged.

These are Foltra adaptations of the original palettes, not official ports. The palettes are mapped to Foltra UI roles; text colors may be adjusted to remain readable on content, panel and selected surfaces. Missing colors in a partial custom theme inherit a matching light/dark base. Imported files themselves are not rewritten.

| Theme | Palette source | License |
| --- | --- | --- |
| Catppuccin Mocha | [Catppuccin palette](https://github.com/catppuccin/palette/blob/main/palette.json) | MIT |
| Rosé Pine | [Rosé Pine palette](https://github.com/rose-pine/palette/blob/main/palette.json) | MIT |
| Tokyo Night | [Enkia's Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme) | MIT |
| Darcula | [JetBrains UI palette](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-resources/src/themes/darcula.theme.json), [editor colors](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-resources/src/DefaultColorSchemesManager.xml) | Apache-2.0 |

License texts and attribution ship in `public/third-party/theme-licenses/` and are copied into the desktop web assets.

A theme manifest uses `kind: "theme"`, `id`, `name`, `version`, optional `description`, and `tokens`. See `examples/themes/` for installable files. Only these color tokens in `#RRGGBB` format are accepted:

- Surfaces/text: `paper`, `panel`, `ink`, `muted`, `line`, `accent`, `sidebar`, `sidebar-ink`.
- Optional selection/status: `selection`, `danger`, `warning`, `success`.
- Optional bold text: `strong`. When omitted, Foltra subtly blends the theme accent into the text color. Bold uses weight 700 in reading, live preview and source editing; its color is adjusted for contrast on content, panel and selected surfaces.
- Optional code colors: `syntax-keyword`, `syntax-atom`, `syntax-literal`, `syntax-string`.

Legacy eight-token themes remain valid. Themes cannot run code, add commands, inject CSS or load remote resources.
