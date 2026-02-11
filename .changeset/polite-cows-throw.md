---
"awaitly": minor
"awaitly-postgres": patch
"awaitly-mongo": patch
"awaitly-docs": minor
---

### createWorkflow introspection (WorkflowClass parity)

- **createWorkflow return value** now exposes `name`, `deps`, `options`, and `snapshot` (read-only). Aligns with WorkflowClass for inspection and persistence. Use `workflow.snapshot` for one-off access or `workflow.getSnapshot()` when reusing. `deps` and `options` are frozen.
- **WorkflowSnapshot** gains optional `workflowName` (set by the engine when creating a snapshot).
- **awaitly/core** exports `matchWhen` and type `MatchTag` for tagged-union pattern matching.

### Docs

- API reference: Workflow instance (createWorkflow return value) and Pattern matching (awaitly/core). Foundations and quick reference updated. Functional utilities guide links to core pattern matching.

### Tests and quality

- **awaitly-postgres**, **awaitly-mongo**: Integration tests skip when the database is unavailable (beforeAll connection check + `it.skipIf`), so `pnpm quality` passes without a running Postgres/Mongo.
