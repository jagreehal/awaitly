---
'awaitly': minor
'awaitly-analyze': minor
'awaitly-libsql': patch
'awaitly-mongo': patch
'awaitly-postgres': patch
---

### awaitly

**UnexpectedError class migration** — Replace `UNEXPECTED_ERROR` string constant and plain object with an `UnexpectedError` TaggedError class. `isUnexpectedError()` now returns a proper type guard (`e is UnexpectedError`), `matchError` uses class-based keys, and `defaultCatchUnexpected` returns `new UnexpectedError({ cause })`. All error unions, resolvers, sagas, webhooks, and workflow types updated accordingly.

**Workflow engine** — Add `createEngine()` (`awaitly/engine`) for durable workflow orchestration with configurable concurrency, polling, cron-style scheduling, and lifecycle events.

**Input validation** — Add `validateInput()` using the Standard Schema spec (`@standard-schema/spec` optional peer dep) for schema validation with Zod, Valibot, or ArkType. Includes `InputValidationError` type and `isInputValidationError` guard.

**Test runner** — Add `testWorkflow()` (`awaitly/testing`) for running real workflows with structured per-step result tracking and event capture without mocking.

**Durable improvements** — Add `LeaseExpiredError`, `IdempotencyConflictError` error types with type guards, and `WorkflowLock.renew()` for lease extension.

### awaitly-analyze

**Workflow diff engine** — Add `diffWorkflows()` for comparing two workflow IR snapshots with rename and move detection. Includes three renderers (markdown, JSON, Mermaid) and CLI support via `--diff` with local files, git refs (`main:src/wf.ts`), single-file HEAD comparison, and GitHub PR auto-discovery (`gh:#123`).

**Railway diagrams** — Add railway-style Mermaid flowchart generation showing linear happy path with ok/err branching per step.

### awaitly-libsql / awaitly-mongo / awaitly-postgres

Add `renew()` method to lock implementations for lease extension, supporting the new `WorkflowLock.renew()` interface.
