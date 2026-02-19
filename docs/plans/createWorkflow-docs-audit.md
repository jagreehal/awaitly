# createWorkflow docs audit — “new way” checklist

Use this when adding or editing docs that use `createWorkflow`. Search the repo for `createWorkflow(` to find all occurrences.

## The new way (rules)

1. **Signature**
   - `createWorkflow(name, deps, options?)`
   - `name`: string (e.g. `'workflow'`, `'checkout'`).
   - `deps`: object of functions that return `AsyncResult` (or omit for no deps: `createWorkflow('name')`).
   - `options`: optional `{ resumeState, onEvent, cache, streamStore, signal, ... }`.

2. **Run callback**
   - When the workflow has **deps**, use **`async ({ step, deps }) =>`** and call **`deps.xxx`** inside steps.
   - Example: `step('fetchUser', () => deps.fetchUser('1'))`, not `step('fetchUser', () => fetchUser('1'))` with a global.
   - When the workflow has **no deps**, `async (step) =>` is fine (or still use `({ step })` for consistency).

3. **Persistence**
   - **Preferred:** `workflow.runWithState(fn)` → `{ result, resumeState }` → `store.save(id, resumeState)`.
   - **Restore:** `store.loadResumeState(id)` then `workflow.run(fn, { resumeState: loaded })`.
   - Use **collector** (`createResumeStateCollector` + `onEvent: collector.handleEvent` + `collector.getResumeState()`) only when you need custom event handling alongside state capture (e.g. logging, incremental save on each step).

4. **Per-run overrides**
   - **Deps:** `workflow.run(fn, { deps: { ... } })` (partial override, e.g. for tests).
   - **Resume:** `workflow.run(fn, { resumeState })`.
   - **Snapshot:** `workflow.run(fn, { snapshot })` only when restoring from a WorkflowSnapshot (not from ResumeState).

5. **Don’t use (outdated)**
   - `snapshot: await store.load(...)` at creation time for “resume from store” — instead: load then `run(fn, { resumeState })` or `run(fn, { snapshot })`.
   - `collector.getResumeState()` as the only way to persist — prefer `runWithState` and save `resumeState`.
   - Callback as `(step, deps)` (two args) — the callback receives a single context object: `({ step, deps, ctx })`.

---

## Files with `createWorkflow(` (audit list)

| File | Notes / action |
|------|-----------------|
| `apps/docs-site/src/content/docs/comparison/awaitly-vs-effect.mdx` | Uses `({ step, deps })`; persistence uses runWithState. |
| `apps/docs-site/src/content/docs/comparison/awaitly-vs-neverthrow.mdx` | Same. |
| `apps/docs-site/src/content/docs/comparison/awaitly-vs-promise.mdx` | Uses `({ step, deps })`. |
| `apps/docs-site/src/content/docs/comparison/awaitly-vs-try-catch.mdx` | Uses `({ step, deps })`. |
| `apps/docs-site/src/content/docs/comparison/effect-layers-in-awaitly.mdx` | Uses `({ step, deps })` and run override. |
| `apps/docs-site/src/content/docs/comparison/awaitly-vs-workflow.mdx` | Check run callback vs deps. |
| `apps/docs-site/src/content/docs/reference/api.md` | Text only; ensure run/createWorkflow options described. |
| `apps/docs-site/src/content/docs/reference/quick-reference.md` | **Fix:** Use `({ step, deps })` and `deps.xxx` where deps exist; persistence snippet already runWithState. |
| `apps/docs-site/src/content/docs/guides/persistence.mdx` | runWithState primary; collector for custom onEvent. |
| `apps/docs-site/src/content/docs/guides/mongo-persistence.md` | Uses `({ step, deps })`. |
| `apps/docs-site/src/content/docs/guides/hooks.md` | **Fix:** Callback `(step, { waitForPayment })` → `({ step, deps })` and `deps.waitForPayment`. |
| `apps/docs-site/src/content/docs/guides/streaming.md` | Uses `(step)`; deps in createWorkflow — can use `({ step, deps })` if steps use deps. |
| `apps/docs-site/src/content/docs/guides/testing.md` | Uses `(step)`; if deps used in steps, switch to `({ step, deps })`. |
| `apps/docs-site/src/content/docs/guides/versioning.md` | Uses `(step)` in some places; align with deps. |
| `apps/docs-site/src/content/docs/guides/caching.mdx` | Uses `({ step, deps })`. |
| `apps/docs-site/src/content/docs/guides/conditional-execution.md` | Uses `({ step, deps })`. |
| `apps/docs-site/src/content/docs/guides/drizzle.mdx` | Uses `({ step, deps })`. |
| `apps/docs-site/src/content/docs/guides/migration.mdx` | Check `(step, d)` → should be `({ step, deps })`. |
| `apps/docs-site/src/content/docs/guides/prisma.mdx` | Uses `({ step, deps })`. |
| `apps/docs-site/src/content/docs/guides/retries-timeouts.mdx` | Uses `({ step, deps })`. |
| `apps/docs-site/src/content/docs/guides/static-analysis.mdx` | Mixed; conceptual. |
| `apps/docs-site/src/content/docs/guides/ai-integration.mdx` | Uses `({ step, deps })`. |
| `apps/docs-site/src/content/docs/advanced/production-deployment.md` | **Fix:** Use `({ step, deps })` and `deps.xxx` where workflow has deps. |
| `apps/docs-site/src/content/docs/advanced/opentelemetry.md` | **Fix:** Use `({ step, deps })` where deps used. |
| `apps/docs-site/src/content/docs/advanced/circuit-breaker.md` | Check run callback. |
| `apps/docs-site/src/content/docs/advanced/policies.md` | Check run callback. |
| `apps/docs-site/src/content/docs/advanced/rate-limiting.md` | Check run callback. |
| `apps/docs-site/src/content/docs/patterns/error-recovery.md` | **Fix:** Use `({ step, deps })` if deps passed. |
| `apps/docs-site/src/content/docs/foundations/index.mdx` | Conceptual; no code fixes. |

---

## Quick grep

From repo root:

```bash
rg 'createWorkflow\(' --glob '*.{md,mdx}' apps/docs-site
```

Then for each file, check:

- [ ] `createWorkflow(name, deps, options?)` — name first, then deps, then optional options.
- [ ] Run callback: if deps are passed, use `async ({ step, deps }) =>` and `deps.xxx` in steps.
- [ ] Persistence: prefer `runWithState` → `store.save(id, resumeState)` → `loadResumeState` + `run(fn, { resumeState })`.
- [ ] No `(step, deps)` two-arg callback; no creation-time `snapshot: await store.load(...)` for “resume from store” unless documenting the snapshot restore flow explicitly.
