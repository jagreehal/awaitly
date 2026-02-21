---
'awaitly-docs': patch
---

**Docs: import and terminology consistency**

- **Reference (quick-reference + api):** Document both `awaitly` and `awaitly/result`; remove `run` from main `awaitly` in tables; add rows for `awaitly/run` and `awaitly/result` in Import Cheatsheet and Module Sizes. Add sentence in API reference that `AsyncResult` and `Result` are available from both `awaitly` and `awaitly/result`.
- **createWorkflow:** All docs now import `createWorkflow` from `awaitly/workflow` (not main `awaitly`) so the main bundle stays small. Updated: installation, visualization, framework-integration, ai-integration, migration, opentelemetry.
- **Type imports:** Use `type Result` / `type AsyncResult` and `import type { Result }` where appropriate (migration, framework-integrations).
- **Bundle sizes:** Docs that mention size use gzipped (e.g. installation batch/resource comments). Module Sizes table notes that sizes in docs are gzipped when given.
