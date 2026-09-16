# @foltra/plugin-sdk

TypeScript authoring contract for Foltra's code plugins. This SDK does not run in the app's JavaScript realm. Use the supplied API to read/write notes and databases, create views, transform editor selections, and store plugin settings/data.

The shipped plugin is Anki, in `examples/code/anki`, with `manifest.json` and `main.ts`. Export a default object satisfying `Plugin`. List every command/view/permission in the manifest. Pure JS/TS dependencies can be bundled; DOM, native modules, arbitrary files and network access are not available.

From the repository:

```sh
npm run plugin:pack -- examples/code/anki /tmp/anki.json
```

Install that JSON file in Settings → Extensions, inspect its requested permissions, then activate it. Commands appear in the palette and in Vim/shortcut settings. Bind both a Leader sequence and a regular shortcut using the existing recorder.

SDK calls are synchronous. Commands and view actions may write with granted permissions. Rendering, lifecycle and workspace/note events are read-only for vault/plugin storage and must not navigate or edit the active document. They may update `api.state`. Handle events to invalidate computations or rebuild session state; a visible view re-renders after workspace changes. Returning a view tree rather than HTML keeps it theme-compatible and isolates it from app internals.

`api.call('note.update', { id, title, body, expectedRevision })` and record updates require the revision that was actually read. A conflict must be surfaced or resolved by the user, not retried using a newly fetched revision. A stale asynchronous editor transformation is rejected by the host and may be re-run by the user.

`api.storage` is durable, scoped by package ID and revision checked. Its data/settings survive uninstall and are included in vault exports. Execution trust is device-local and never exported. A package change invalidates approval. Command handlers declared `headless: true` also run through `foltra --vault PATH plugin.ID.COMMAND`; UI APIs fail there. Consult `docs/PLUGIN_SDK.md` for limits and the full contract.

SDK regression packages live in `tests/fixtures/plugins/`. They exercise individual host capabilities and are not part of the app catalog or shipped examples.
