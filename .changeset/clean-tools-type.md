---
'eslint-plugin-awaitly': major
'awaitly-analyze': minor
'awaitly-visualizer': patch
'awaitly': patch
---

**Tooling alignment with the AI-DX slug spine.** Lint, analyzer, and visualizer now share the canonical slug namespace from `awaitly/slugs`, so a runtime error code, an ESLint rule name, and an analyzer diagnostic code are the same identifier — one token, every surface.

### `eslint-plugin-awaitly` (major)

**Breaking — all rules renamed to canonical slugs:**

| Old name | New name |
|---|---|
| `awaitly/no-immediate-execution` | `awaitly/step-no-immediate-execution` |
| `awaitly/require-step-id` | `awaitly/step-require-id` |
| `awaitly/require-thunk-for-key` | `awaitly/step-require-thunk-for-key` |
| `awaitly/stable-cache-keys` | `awaitly/step-stable-cache-keys` |
| `awaitly/no-floating-workflow` | `awaitly/workflow-no-floating` |
| `awaitly/no-floating-result` | `awaitly/result-no-floating` |
| `awaitly/require-result-handling` | `awaitly/result-require-handling` |
| `awaitly/no-options-on-executor` | `awaitly/workflow-options-position` |
| `awaitly/no-double-wrap-result` | `awaitly/result-no-double-wrap` |
| `awaitly/no-dynamic-import` | `awaitly/workflow-no-dynamic-import` |

No legacy aliases. Update your `eslint.config.js` rule names.

**Added:** 10 new rules covering gaps the patterns guide previously asserted only in prose.

- `step-no-bare-await` — disallows bare `await deps.fn()` inside workflow callbacks
- `step-no-try-catch-wrap` — disallows wrapping `step()` in `try/catch`; use `step.try()`
- `workflow-callback-shape` — requires `({ step })` (or superset) on workflow callbacks
- `workflow-no-callable-form` — disallows `workflow(callback)`; use `workflow.run(...)`
- `concurrency-no-promise-all` — replace `Promise.all` with `step.all` / `step.map`
- `concurrency-no-promise-race` — replace `Promise.race` with `step.race`
- `concurrency-no-promise-allsettled` — replace `Promise.allSettled` with `step.map`
- `result-no-manual-propagation` — disallows `return ok()/err()` inside workflow callbacks (scope-guarded; deps functions and step thunks are unaffected)
- `result-no-direct-ok-err` — disallows `ok()`/`err()` calls inside workflow callbacks (same scope guard)
- `error-check-unexpected-first` — heuristic warn for `if (result.error._tag === ...)` without an `isUnexpectedError` guard. **Deliberately not in `recommended` or `recommended-strict`** — opt-in only.

**Added:** `recommended-strict` config — same rules as `recommended` but with `result-require-handling` upgraded from `warn` to `error` for CI gating.

### `awaitly-analyze` (minor)

**Added:** `--doctor` CLI flag emits slug-keyed strict-mode diagnostics with `code`, `hint`, and `docsUrl` fields. `--format=json` produces structured output for CI/tooling integration.

```bash
awaitly-analyze ./src/workflows/checkout.ts --doctor --format=json
```

**Added:** `STRICT_RULE_TO_SLUG` exported from `awaitly-analyze` — maps internal strict-rule names to canonical awaitly slugs. Used by cross-surface parity tests to prevent drift.

**Internal:** `StrictDiagnostic` shape gains `code: AwaitlySlug`, `hint: string`, `docsUrl: string` fields imported from `awaitly/slugs`.

### `awaitly-visualizer` (patch)

`step_error` and `workflow_error` events preserve the new `code`, `hint`, and `docsUrl` fields on the error payload. No public API change — the visualizer just passes through the awaitly error shape it receives. Renderers and downstream tooling now have access to the canonical slug for filtering, deep-linking, and analytics.
