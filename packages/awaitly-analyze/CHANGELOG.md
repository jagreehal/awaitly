# awaitly-analyze

## 1.1.0

### Minor Changes

- c122ea2: Fix CJS/ESM dual module support and add awaitly peer dependency

  - Fix `import.meta.url` issue in tree-sitter-loader.ts that caused CJS builds to fail
  - Package now works correctly with both `require()` and `import`
  - Add `awaitly` as a peer dependency to document the relationship
