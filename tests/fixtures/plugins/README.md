# Plugin test fixtures

These packages exercise SDK views, actions, settings, database writes, editor effects, CLI commands and legacy templates. They are test inputs, not bundled or advertised Foltra extensions.

`npm test` rebuilds the three code fixtures with `scripts/build-test-plugins.mjs` before the Rust and UI tests. Their sources also participate in `npm run plugins:check`. Generated JSON is retained so direct `cargo test` can run without Node.

The shipped plugin catalog contains Anki only; theme packages remain under `examples/themes/`.
