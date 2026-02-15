---
'awaitly': minor
'awaitly-docs': minor
---

Use string constant for unexpected errors; improve tsconfig and docs

- **awaitly:** `run()` and workflows without custom `catchUnexpected` now return the string `"UNEXPECTED_ERROR"` for uncaught exceptions instead of an `UnexpectedError` object. The thrown value is preserved in `result.cause`. `isUnexpectedError()` and `matchError()` accept both the string and the legacy object shape. Added `tsconfig.quality.json`; main tsconfig no longer excludes test files from typecheck.
- **awaitly-docs:** Updated foundations and getting-started docs for the new error model; fixed Astro check (config and AnimatedWorkflowDiagram types).
