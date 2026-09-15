# Foltra development

- This project is independent of snack-note. Do not import its data or modify its repository.
- Read `docs/ARCHITECTURE.md` and `docs/STATUS.md` before changing storage, commands, or extension contracts.
- Keep file access, validation, revisions, and durable writes in `crates/core`. UI and CLI are adapters to the same core.
- Add data command metadata to `crates/core/commands.json`; add UI action metadata to `src/lib/builtinCommands.ts`. Do not add isolated global key handlers for features.
- Keep view components separate from editor state and command routing. Do not grow `App.tsx` into a data engine.
- Core/CLI must work without a UI or browser. Do not create a note as a side effect of creating a database record.
- User content and extension manifests are untrusted input. Do not add raw HTML, eval, unrestricted CSS, remote loading, or filesystem access for community extensions without an explicit design change.
- Changes to persisted data must preserve existing content or declare a versioned migration. Never bypass an expectedRevision conflict by fetching a new revision and retrying automatically.
- Test behavior at the changed boundary. Use temporary vaults for automated tests and explicitly disposable vaults for interactive checks.
- Run `npm test` and `npm run check` for behavior changes. Rebuild the desktop bundle after native changes. Record unverified platform/IME/performance behavior honestly.
- Update `docs/STATUS.md` when a requirement changes state. Do not describe design goals as implemented features.
