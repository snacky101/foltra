# @foltra/plugin-sdk

TypeScript authoring contract for Foltra's code plugins. This SDK does not run in the app's JavaScript realm. Use the supplied API to read/write notes and databases, create views, transform editor selections, and store plugin settings/data.

The shipped plugins are Anki (`examples/code/anki`) and the daily calendar (`examples/code/calendar`), each with `manifest.json` and `main.ts`. Export a default object satisfying `Plugin`. List every command/view/permission in the manifest. Pure JS/TS dependencies can be bundled; DOM, native modules, arbitrary files and network access are not available.

From the repository:

```sh
npm run plugin:pack -- examples/code/anki /tmp/anki.json
```

Install that JSON file in Settings → Extensions, inspect its requested permissions, then activate it. Commands appear in the palette and in Vim/shortcut settings. Bind both a Leader sequence and a regular shortcut using the existing recorder.

SDK calls are synchronous. Commands and view actions may write with granted permissions. Rendering, lifecycle and workspace/note events are read-only for vault/plugin storage and must not navigate or edit the active document. They may update `api.state`. Handle events to invalidate computations or rebuild session state; a visible view re-renders after workspace changes. Returning a view tree rather than HTML keeps it theme-compatible and isolates it from app internals.

Declare `runtime.views: [{id, title, placement: 'right-sidebar'}]` to place a permissioned view at the bottom of the right sidebar. Omit `placement` (or use `'main'`) for the existing main view. The calendar primitive is `{type:'calendar', month:'2026-09', today:'2026-09-17', markedDates:['2026-09-17'], action:'select-date', previousAction:'previous-month', nextAction:'next-month', todayAction:'today'}`. Its required month/today are real Gregorian dates in years 0001–9999; marked dates must be unique and within the displayed month (maximum 31). Calendar nodes also accept `label` and `disabled`, but no children, HTML, styles or other properties. Day actions receive the ISO date in `action.value`; navigation actions receive their declared IDs. Keep browsing in `api.state` and initialize the local current month in `onLoad` for a fresh app session.

`note.list` returns all active note metadata, including each note's content `revision`, without bodies. Use the revision to detect linked-body changes even if external edits leave timestamps unchanged; `note.read` returns the full body when needed. Existing per-invocation SDK response and execution budgets still apply.

`api.call('note.update', { id, title, body, expectedRevision })` and record updates require the revision that was actually read. A conflict must be surfaced or resolved by the user, not retried using a newly fetched revision. A stale asynchronous editor transformation is rejected by the host and may be re-run by the user.

`api.storage` is durable, scoped by package ID and revision checked. Its data/settings survive uninstall and are included in vault exports. Execution trust is device-local and never exported. A package change invalidates approval. Command handlers declared `headless: true` also run through `foltra --vault PATH plugin.ID.COMMAND`; UI APIs fail there. Consult `docs/PLUGIN_SDK.md` for limits and the full contract.

SDK regression packages live in `tests/fixtures/plugins/`. They exercise individual host capabilities and are not part of the app catalog or shipped examples.

For note chat, declare `ai.chat`, `notes.read`, and `ui`, then return `{type:'note-chat'}` from a sidebar view and `{type:'ai-settings'}` from its `runtime.settingsView`. Add `notes.write` to allow explicit answer application. These nodes accept no extra props: the host supplies the current note and owning extension. Credentials and HTTP remain in the host, outside plugin JavaScript. See `examples/code/note-chat/` and [Note chat](../../docs/NOTE_CHAT.md).
