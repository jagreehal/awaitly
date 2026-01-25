# awaitly-analyze

## 2.0.0

### Minor Changes

- cc6ebff: - Add browser-compatible static analysis via `awaitly-analyze/browser` (fetch-based WASM loading with configurable base path).
  - Improve static analysis coverage (detect `run()` calls, conditionals/loops/parallel/race patterns) and capture `createWorkflow` docs (`description`, `markdown`) for richer diagrams.
  - Add `eslint-plugin-awaitly` to catch common workflow mistakes (immediate execution, missing thunks for keyed steps, unstable cache keys).
  - Improve `awaitly` workflow DX: `STEP_TIMEOUT` is returned as a typed error (not wrapped) and workflows can include docs metadata for static analysis.

### Patch Changes

- Updated dependencies [cc6ebff]
  - awaitly@1.7.0

## 1.1.0

### Minor Changes

- c122ea2: Fix CJS/ESM dual module support and add awaitly peer dependency

  - Fix `import.meta.url` issue in tree-sitter-loader.ts that caused CJS builds to fail
  - Package now works correctly with both `require()` and `import`
  - Add `awaitly` as a peer dependency to document the relationship
