# Foltra code plugin SDK v1

This implementation extends the original DESIGN.md section 9. Legacy JSON templates, queries, view shortcuts and themes remain compatible. Code packages add a `runtime` object containing a bundled JavaScript ES module, `apiVersion: 1`, requested permissions, view declarations, settings and event subscriptions. TypeScript authors compile to this module using the provided packaging script.

## Execution boundary

Code runs in a fresh QuickJS context in the Rust core for each invocation, never in the application's JavaScript realm. No DOM, Node, filesystem, general network, native modules or module loader are exposed. The optional `anki.connect` capability exposes only the restricted local AnkiConnect transport described in `ANKI.md`. The only host bridge is a permission-checked SDK; every data operation goes through the same core validation, vault lock and revision rules as the UI and CLI. There is no raw HTML/CSS rendering and no host `eval`.

Anki HTTP waits have separate 1.2s request / 8s invocation wall-time bounds. Each invocation has a 32 MiB JS heap, 512 KiB stack, 500 ms JavaScript execution budget, 64 SDK-call budget and 512 KiB output limit. A failing plugin is stopped by the UI until the user disables and re-enables it. These interpreter limits are not an OS process sandbox or a proof against engine vulnerabilities. Native host operations retain their existing core bounds. Each data operation is atomic; a sequence of SDK calls is not a multi-operation transaction, and successful earlier calls are not rolled back when later code fails.

Installation does not enable code. Settings → Extensions has a **Plugin use** switch with one-time consent for the current device and canonical vault path. After accepting, users only install and enable individual packages; re-enabling and explicit local package updates do not ask for consent again. Turning plugin use off stops every code plugin while preserving individual activation choices and consent. Existing per-package grants are preserved but require this one-time global consent before running. Themes do not require plugin consent.

The policy and per-package activation digests live in the device's application data, outside the vault; importing or synchronizing a vault does not activate its code. External package edits invalidate activation; users can enable the changed package without a repeated consent prompt. SDK calls still require the package's declared permissions, and requests with stale digests are rejected. Disabling/removing a package stops event delivery and removes its commands/views from the active UI. Plugin settings and created notes/records survive removal.

Headless clients use `extension.policy` to read `{consentAccepted, enabled}` and `extension.policy.update {enabled:true, acceptConsent:true}` for first consent. Later toggles use `{enabled:true}` or `{enabled:false}`. Individual `extension.enable {id,digest}` requires plugin use to be on. These policy commands are not exposed to plugin code.

## SDK contract

The module exports a default object with `commands`, `views`, `completions`, optional `onLoad`, `onUnload`, and `onEvent` functions. Commands and views are keyed by declared IDs. Handlers receive an `api` object; event/action payloads are separate arguments. They are synchronous (no ambient background jobs or timers). Only commands and view actions can write vault/plugin data or navigate/edit the UI; lifecycle and change notifications compute session state/read data. This avoids event-driven write feedback loops in SDK v1. Use `api.state` for JSON session state across invocations; use the plugin's own storage for durable data. The host delivers lifecycle and subscribed events, serializes invocations, and discards stale results when the vault/package changes.

- `api.call(command, args)`: permitted note/database/query/link operations. Updates require the revision obtained when the data was read. Link/backlink queries require both note and database read permissions because they include record-body relationships; opening/creating a record body requires database read/write plus note read/write. Plugin installation, arbitrary paths and app settings are unavailable.
- `api.settings`: validated plugin-specific settings, configured in Settings → Extensions.
- `api.storage.read()` / `api.storage.write(value, expectedRevision)`: durable, revision-checked JSON scoped to this plugin.
- `api.openView(id)`, `api.openNote(id)`, `api.notify(message)`: bounded UI effects, requiring `ui` permission.
- `api.editor.read()` / `api.editor.replaceSelection(text)`: current editor selection and an undoable replacement. The application verifies the original note, document and selection still match before applying an asynchronous result. Live Preview/IME internals remain owned by the editor.
- `api.state`: JSON session state; independent per plugin/vault and reset on deactivation.

Permissions are `notes.read`, `notes.write`, `databases.read`, `databases.write`, `editor.read`, `editor.write`, `ui`, `anki.connect`, `ai.chat`, `git.sync`, and `automation`. Own settings/storage do not expose any other plugin's data. General network/native-file APIs and arbitrary CodeMirror extensions are outside SDK v1.

## Views and commands

A plugin computes its own view tree: stacks, rows, grids, cards, text/headings, buttons, text/number/date inputs, checkboxes and selects. The host validates the tree, depth, node count, IDs, input options and bounded layout values, then renders React elements with the active Foltra theme. No executable props, HTML, arbitrary CSS or external URLs are accepted. Actions invoke the owning view's `onAction(api, action)` and render it again. Custom views are implemented by plugin code and generic layout primitives.

Commands use `plugin.<package-id>.<command-id>` in the existing registry, palette, slash menu, normal shortcuts and Leader bindings. A command marked `headless: true` also runs from the CLI through the same interpreter and permission checks. UI-only methods reject headless invocation. Views and event handlers are desktop lifecycle features; the CLI does not run a background plugin daemon.

Commands may declare optional default `bindings`, for example `[{"keys":"Mod+Shift+d","leader":false},{"keys":"nd","leader":true}]`. Up to 10 bindings per command use the same validation and keyboard router as user shortcuts. `commands.list` exposes the defaults, and the settings page uses them when that command has no saved override. An explicit saved empty array disables all bindings. Installation, updates, activation and removal do not rewrite user shortcut settings. `Mod` means Cmd on macOS and Ctrl elsewhere; Leader sequences use the configured Leader key. Script commands and their defaults become active only when plugin use and the individual package are enabled.

Views may declare `placement: "right-sidebar"`; omission means the main view. Enabled sidebar views use the same serialized plugin session and appear below backlinks even without an open note. Calling `api.openView` for such a view reveals the sidebar without opening a central plugin page. Load/render handlers do not navigate. The `calendar` view node accepts a real `YYYY-MM` month, a real `YYYY-MM-DD` today, at most 31 unique marked dates in that month, and declared navigation/date actions. The host owns its themed rendering and keyboard focus; plugins do not receive DOM access. `examples/code/calendar/` demonstrates this contract.

## Host note chat

`{type:'note-chat'}` and `{type:'ai-settings'}` are host-rendered nodes with no additional properties. They require `ai.chat`, `ui`, and `notes.read`; applying an answer also requires `notes.write`. The host supplies the owning package ID/digest and current note; packages cannot override the provider, note, or credentials through view props. `runtime.settingsView` can point to an `ai-settings` view. See `examples/code/note-chat/` and [NOTE_CHAT.md](NOTE_CHAT.md).

The host uses the shared `chat.*` core commands. They are not exposed through QuickJS `api.call`. Provider HTTP runs outside the vault writer lock and QuickJS invocation limits, with a separate 90-second timeout and bounded payload/response sizes. Activation, permissions, provider revision, and conversation revision are checked again after the request. Applying a rewrite additionally requires the note revision used to generate it. Provider credentials are device-local and never returned to package code; this is not a general network capability.

## Text completions

Declare up to 12 providers in `runtime.completions`, each with a unique slug `id` and a single ASCII punctuation `trigger`. Providers require `editor.write` because accepting a candidate edits the token:

```json
"permissions": ["editor.write"],
"completions": [{ "id": "dates", "trigger": "@" }]
```

Implement `completions.dates(api, {query})` and return up to 100 `{label, insertText, detail?}` items. `query` excludes the trigger, may be empty, and is limited to 256 UTF-8 bytes without control characters. Labels must be nonblank and at most 120 bytes; literal `insertText` allows up to 8000 bytes (including an empty replacement); optional plain-text `detail` allows 240 bytes. Extra fields, asynchronous handlers and malformed output are rejected. The shared 512 KiB output limit also applies.

Completion calls are desktop-only, serialized with the plugin's existing session and read-only. They receive no editor snapshot and cannot use `api.editor.read`, data/storage writes, AnkiConnect, navigation, notifications or other UI effects. Permissioned reads of saved vault data, settings and own storage remain available. Failed providers stop with the normal plugin error until re-enabled. Late results are discarded when the vault, package or activation changes.

The host opens suggestions only at a token boundary, outside code, ordinary Markdown links and escaped text. A trigger immediately after `[[` also opens plugin suggestions, taking precedence over the wiki-note popup while that trigger is active. Existing tag completion retains precedence outside wiki links. Subsequent letters, numbers, combining marks, `_` and `-` form the query. Clicking a candidate or accepting the highlighted option with Enter/Tab replaces the trigger and token as one undoable editor transaction. Input-method composition cannot accept a candidate. Escape, blur or continuing with a space leaves the original text intact; no background rewrite or note creation occurs.

`examples/code/date-mentions/` implements **날짜 자동완성**, installed and enabled from Settings → Extensions. `@Today`, `@Yesterday` and `@Tomorrow` offer case-insensitive prefix completion to the device's local `YYYY-MM-DD` date. Calendar arithmetic accounts for month/year boundaries and daylight-saving transitions. To link the resulting date, users may apply ordinary wiki-link syntax themselves; the extension inserts plain text only. For example, selecting Today after `[[@` replaces only the `@` token with the date. Existing `]]` and `|alias` text are preserved; unclosed brackets remain unclosed. Escape keeps the original text unchanged.

## Extension settings

Installed plugins that declare settings show a **설정** button in Settings → Extensions. It opens a dedicated page inside the extension manager; returning to the list retains its search/filter. Values are scoped to the current vault and package ID, survive restarts/removal, and use the existing revision-checked storage.

For a host-rendered form, declare `runtime.settings`. No plugin execution or activation is required to edit these fields. The host validates values and exposes them as `api.settings` on subsequent invocations:

```json
"settings": [
  { "id": "prefix", "label": "노트 제목 접두사", "type": "text", "default": "기록" },
  { "id": "limit", "label": "표시 개수", "type": "number", "default": 20 },
  { "id": "enabled", "label": "기능 사용", "type": "checkbox", "default": true },
  { "id": "order", "label": "정렬", "type": "select", "default": "최신순", "options": ["최신순", "이름순"] }
]
```

For dynamic options, connection checks or more involved configuration, declare a settings view:

```json
"permissions": ["ui"],
"views": [{ "id": "preferences", "title": "내 확장 설정" }],
"settingsView": "preferences"
```

Implement `views.preferences.render(api)` and `onAction(api, action)` using the same safe view nodes and storage APIs as other views. Add only the permissions required by the settings operations. `settingsView` must reference a declared view; it runs only after activation and shares the plugin's existing serialized session with commands/background jobs. The manager stops rendering it when hidden/disabled or the vault changes. It cannot bypass permissions, render-time write restrictions or revision checks. A package may provide both a static form and a custom settings view. Anki 1.0.1 demonstrates a dynamic settings view sharing its saved configuration with the sync view.

Existing installed packages are not silently replaced by catalog updates. The extension manager offers an explicit update for a newer stable catalog version. `extension.update {manifest, expectedDigest}` checks the installed manifest digest and matching ID/kind, then atomically replaces only that manifest. Plugin storage, settings and user documents remain intact. An enabled package retains activation at its new digest, including while global plugin use is off; a disabled package remains disabled. Stale requests using the old digest are rejected. The host provides a narrow compatibility mapping for Anki 1.0.0: its existing declared `sync` view already contains its settings and is accessible from the settings button without reinstalling or changing its approval. New packages should declare `settingsView` explicitly. Other views are not automatically treated as settings.

## Daily Calendar and note creation

The installable **일지 캘린더** package (`examples/code/calendar/`, version 1.1.0) includes `plugin.daily-calendar.open-today`, titled **오늘의 노트 열기**, with `Mod+Shift+d` and `<leader>nd` defaults. It computes the current local `YYYY-MM-DD` on invocation, opens an existing note or uses the atomic `note.open-link` command to create an empty note at the vault root. Existing notes retain their body, folder and revision. Duplicate date titles open the calendar's existing selection list without guessing or creating another note.

The static checkbox setting `create-missing-notes` defaults to false and controls clicks on empty calendar dates. Off sends `api.notify` with an informational toast; on creates/opens the date note. The explicit open-today command creates a missing note regardless of this click preference. Load and render never create notes or send toasts. The package requests `notes.read`, `notes.write` and `ui`, and explicit updates from 1.0.0 retain activation without another consent prompt. The host saves the current draft before invoking the command. The existing `today` command only returns the calendar to the current month.

Sidebar runtime errors use the host toast while retaining a disabled view instead of inserting an inline error block. Main and settings views retain their diagnostic display. Failed actions do not request another render of the failed session.

## Acceptance checks

Anki, Daily Calendar, Date Completion and Git Sync are the bundled plugins. Keep SDK regression packages under `tests/fixtures/plugins/`, outside the app catalog. Verify first-use consent, install/enable/disable/remove, global disable/re-enable and restart persistence, plugin settings, custom views and actions, note/DB change events, CLI command execution, Leader/regular shortcut discovery, revision conflicts, stale editor results, changed-package trust rejection, permission denial, bounded loops/memory/output, and legacy package compatibility. Do not equate these checks with full Obsidian API compatibility, independent security auditing or verified behavior on untested platforms.

## Implementation references

- [rquickjs Runtime API](https://docs.rs/rquickjs/latest/rquickjs/runtime/struct.Runtime.html): interpreter memory, stack and interrupt controls.
- [esbuild API](https://esbuild.github.io/api/): bundled ESM authoring pipeline.

## Local integrations and automatic commands

`api.anki(action, params)` connects only to AnkiConnect v6 on 127.0.0.1:8765. It requires `anki.connect`; rendering and lifecycle/change events cannot call it. The host action `api.anki<string>('storeVaultImage', {path, profile})` also requires `notes.read`; it uploads a validated managed vault image and returns `foltra-<sha256>.<ext>`. The host reads and sends the bytes without exposing them to JS. Only exact `<img src="foltra-<sha256>.<ext>">` tags are accepted in card fields. Raw media APIs, deletion, arbitrary URLs/files/HTML scripts and profile switching remain unavailable. The host ignores proxies and redirects, bounds the response, and never places API keys in the vault. An optional `FOLTRA_ANKICONNECT_KEY` environment variable supplies a configured local API key. See `ANKI.md` for limits and partial-upload behavior.

`api.vaultId`, `api.createId()` and `api.hash(text)` provide stable IDs and SHA-256 content fingerprints. `tags.list` and `tags.blocks` are read-only core commands under `notes.read`; `search` accepts an exact `tag:name` query.

A manifest `backgroundCommand` requires `automation` and must reference a declared script command. Desktop dispatches it with `{automatic:true}` after 2.5s of settled data changes and periodically every 15s, while the app is running. Returning `{pending:true}` requests another batch after about 1s. Invocations serialize with other plugin actions; disposal cancels queued work. Background commands must be idempotent. A write to plugin storage also marks the workspace changed for UI refresh, but storage-only refresh does not restart the automation effect. The CLI runs one explicit bounded invocation and reports pending work; callers can repeat until pending is false.

## Git host effects

`api.git('status')` reads device-local connection, job, conflict previews and recent history under the `git.sync` permission. `api.git('configure' | 'sync' | 'resolve', params)` only queues a host effect from a desktop command/action with `git.sync` and `ui`; it never executes a shell or waits for Git inside QuickJS. Rendering/completions/headless effects and `api.call('git.*')` bypasses are rejected. The host verifies the current package grant, confirms connection changes in its own dialog, appends the real plugin ID/digest, saves the draft, and starts a separate core request. Core rechecks authorization before apply and push. Status polling runs independently of the plugin queue and vault data rerenders. Expected transport/merge failures become job states instead of disabling the interpreter session. Device-local settings are never read from synchronized plugin storage. See [GIT.md](GIT.md) for command contracts and limits.
