---
"awaitly": minor
"awaitly-analyze": minor
---

A DX pass over retry ergonomics, saga rollbacks, Standard Schema typing, and static-analysis output.

## `awaitly`

### Standard Schema without a peer dependency

`StandardSchemaV1` is now copied into the package instead of imported from `@standard-schema/spec`. The optional peer resolved for nobody, so `pnpm add awaitly` could fail typechecking with `Cannot find module '@standard-schema/spec'` unless the consumer had `skipLibCheck` on. Structural compatibility with the real package is still asserted in `standard-schema.test-d.ts`.

### Retry options speak the same language everywhere

`retry()` policies and per-step `retry` options now accept the same aliases:

| Policy (`retry()`) | Step (`step(..., { retry })`) |
| --- | --- |
| `delay` | `initialDelay` |
| `retryIf` | `shouldRetry` |

`retryIf` / `shouldRetry` also receive the 1-indexed attempt number. Invalid `attempts` or delay values now throw at configuration time instead of failing silently.

### Saga compensations can return Results

`compensate` may return a `Result`. An `err` counts as a failed rollback and lands in `SAGA_COMPENSATION_ERROR`, exactly like a throw — so `compensate: (p) => deps.refund(p.id)` works with no wrapper. Void returns are unchanged.

## `awaitly-analyze`

### Portable generated types

`--types` now emits portable return and input types (no `[object Object]`, no checker-internal names) and unwraps `Promise<T>` to `T` in generated output. Anonymous `run()` calls get compilable `.types.ts` files, and workflow names are sanitized into valid type/file identifiers.

### Saga compensation in Mermaid

`showSagaCompensations: true` renders saga error entry points, LIFO compensation order, and rollback failure paths. Five new analyzer-showcase fixtures cover run-level policies, step metadata, cancelled runs, resumed runs, and saga rollback.
