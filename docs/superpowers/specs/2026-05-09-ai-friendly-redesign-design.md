# Awaitly AI-Friendly Redesign

**Status:** Draft for review
**Date:** 2026-05-09
**Scope:** Unify runtime errors, lint rules, static-analysis diagnostics, visualizer events, and skill catalogue around a single canonical slug namespace. Breaking changes accepted. No backwards compatibility.

## Goal

Make awaitly the easiest async-error library for AI coding agents to use correctly and recover from. The unifying mechanic: every concept has one canonical kebab-case slug, and that slug appears identically across six surfaces:

| Surface | Where the slug shows up |
|---|---|
| Runtime errors | `error.code === 'step-timeout'` |
| Lint plugin | `awaitly/step-timeout` (rule name) |
| Static analyzer | `awaitly-analyze` diagnostics carry the slug |
| Visualizer events | error/warning events tagged with the slug |
| Skill rules | `.claude/skills/awaitly-patterns/rules/step-timeout.md` |
| Docs | `awaitly.dev/rules/step-timeout` |

An agent that hits a problem at any layer can grep one token to find the rule, the explanation, the fix, and the related lint enforcement.

## Non-goals

- No changes to awaitly's runtime semantics (workflow execution, step lifecycle, Result composition). Only the *shape* of errors and the *discoverability* of guidance.
- No new step helpers, no new public APIs beyond what serves the spine.
- The other AI-friendly improvements not in this spec (better TypeScript inference, more code samples, longer docs) are out of scope.

## The slug namespace

Slugs are kebab-case, prefixed by category. Categories are intentionally few:

| Prefix | What it covers | Surface dominance |
|---|---|---|
| `step-*` | step() discipline: id, thunk, nesting, options | Lint-heavy, some runtime |
| `workflow-*` | createWorkflow / run / runWithState shape | Lint-heavy |
| `result-*` | Result usage: ok/err, propagation, double-wrap | Lint-heavy |
| `error-*` | Boundary handling: isUnexpectedError, .cause, normalization | Skill + runtime |
| `concurrency-*` | step.all / step.map / step.race vs Promise.* | Lint + skill |
| `runtime-*` | Failures only observable at runtime: timeout, retry-exhausted, rate-limit, circuit-open, unexpected | Runtime-dominant |

Slugs are public API. Renaming a slug = major version bump. Adding slugs is non-breaking. The slug namespace lives in one file: `packages/awaitly/src/slugs.ts`, exporting a typed const map.

## Concrete slug inventory (initial set)

Derived from current lint rules, patterns SKILL.md MUST/MUST-NOT contract, errors.ts pre-built error types, and `___AWAITLY_FEEDBACK.md`.

### `step-*`
- `step-require-id` (lint: was `require-step-id`) — step() and step.all/map/race need a string-literal ID. Covers the existing rule's full surface (top-level step + helpers + computed/template-literal rejection).
- `step-no-immediate-execution` (lint: was `no-immediate-execution`) — second argument must be a thunk.
- `step-require-thunk-for-key` (lint: was `require-thunk-for-key`) — `{ key }` requires a thunk.
- `step-no-bare-await` (NEW lint) — no bare `await deps.fn()` inside workflow callbacks.
- `step-no-try-catch-wrap` (NEW lint) — do not wrap step() in try/catch; use `step.try()`.
- `step-stable-cache-keys` (lint: was `stable-cache-keys`).

### `workflow-*`
- `workflow-no-floating` (lint: was `no-floating-workflow`).
- `workflow-options-position` (lint: was `no-options-on-executor`).
- `workflow-callback-shape` (NEW lint) — destructured `{ step, deps, ctx }`, no positional args.
- `workflow-no-callable-form` (NEW lint) — execute via `workflow.run(...)`, never `workflow(fn)`.
- `workflow-no-dynamic-import` (lint: was `no-dynamic-import`) — keep static imports for tooling traceability.

### `result-*`
- `result-no-floating` (lint: was `no-floating-result`).
- `result-require-handling` (lint: was `require-result-handling`).
- `result-no-double-wrap` (lint: was `no-double-wrap-result`).
- `result-no-manual-propagation` (NEW lint) — inside callbacks, return raw values, not Results.
- `result-no-direct-ok-err` (NEW lint) — inside callbacks, do not call `Awaitly.ok()` / `err()` directly.

### `error-*`
- `error-check-unexpected-first` (NEW lint, heuristic; ship as `warn`) — `isUnexpectedError(result.error)` before tag matching.
- `error-access-cause` (skill-only) — read `result.error.cause` (a property), not arguments.
- `error-normalize` (skill-only) — use `result.error.type ?? result.error` for string/object errors.
- `error-no-throw-in-deps` (skill-only; runtime behaviour observable via `runtime-unexpected`) — deps should return Result, not throw.

### `concurrency-*`
- `concurrency-no-promise-all` (NEW lint) — replace `Promise.all` inside workflows with `step.all` / `step.map`.
- `concurrency-no-promise-race` (NEW lint) — replace `Promise.race` with `step.race`.
- `concurrency-no-promise-allsettled` (NEW lint) — replace `Promise.allSettled` with `step.map` (which collects per-item Results without fail-fast).

### `runtime-*` (raised at runtime; no static lint)
- `runtime-step-timeout` — replaces current `STEP_TIMEOUT` string code.
- `runtime-step-aborted` — replaces current `STEP_ABORTED` string.
- `runtime-retry-exhausted` — replaces `RetryExhaustedError` `_tag`.
- `runtime-rate-limit` — replaces `RateLimitError`.
- `runtime-circuit-open` — replaces `CircuitBreakerOpenError`.
- `runtime-unexpected` — replaces `UnexpectedError`.
- `runtime-resolver-not-found` — replaces `ResolverNotFoundError`.
- `runtime-saga-compensation` — replaces `SagaCompensationError`.

**Slug counts:** 6 step + 5 workflow + 5 result + 4 error + 3 concurrency + 8 runtime = **31 slugs**. Of these: 10 are renames of existing lint rules, 10 are new lint rules, 4 are skill-only, 8 are runtime-only (replacing existing TaggedError tags / string codes), and 1 (`workflow-callback-shape`) is a new lint rule that overlaps with what the patterns SKILL.md currently asserts as an invariant.

## Runtime error shape

Today, awaitly errors are `TaggedError` instances with `_tag` and a free-form `cause`. Add three fields, all required on every awaitly-thrown error:

```ts
interface AwaitlyErrorShape {
  readonly _tag: string;       // existing — class-name discriminant
  readonly code: AwaitlySlug;  // new — canonical kebab-case slug (typed)
  readonly message: string;    // existing
  readonly hint: string;       // new — one-line "do X" guidance
  readonly docsUrl: string;    // new — `awaitly.dev/rules/${code}`
  readonly cause?: unknown;    // existing on UnexpectedError; optional elsewhere
}
```

`AwaitlySlug` is the union type exported from `slugs.ts`. `TaggedError` factory is updated so every constructed error carries `code`, `hint`, `docsUrl` derived from a static slug definition. `makeError()` callers pass a slug (e.g. `makeError('TimeoutError', { slug: 'runtime-step-timeout', hint: 'Increase the step timeout option or check why the upstream call is slow.' })`).

User-defined errors (their domain failures) are *unaffected*. The spine only governs awaitly-system-thrown errors.

## ESLint plugin changes

Each existing lint rule is renamed to its slug (breaking). The ten existing rules map 1:1 to ten `step-*` / `workflow-*` / `result-*` slugs above. Ten *additional* lint rules are added (listed below) so the lint plugin enforces all the statically-checkable items currently only asserted in the patterns SKILL.md MUST/MUST-NOT contract. Each rule's diagnostic gains:

- `data.code` = slug (already implicit in name; now explicit so consumers don't parse rule name)
- A `messages` table whose IDs all carry one short hint and one `docsUrl`-equivalent reference

The recommended config block in `index.ts` is regenerated.

New lint rules added (pulled from patterns SKILL.md MUST/MUST-NOT items not currently enforced):
- `step-no-bare-await`
- `step-no-try-catch-wrap`
- `concurrency-no-promise-all`
- `concurrency-no-promise-race`
- `concurrency-no-promise-allsettled`
- `result-no-manual-propagation`
- `result-no-direct-ok-err`
- `workflow-no-callable-form`
- `workflow-callback-shape`
- `error-check-unexpected-first` (heuristic: if-chain on result.error without isUnexpected guard; ship as `warn`)

## awaitly-analyze changes

`strict-diagnostics.ts` emits findings as `{ code: AwaitlySlug, message, hint, docsUrl, location }`. Where the analyzer detects something the lint plugin would also catch (the analyzer runs deeper, follows imports), it emits the same slug. The analyzer can also emit slugs for things lint can't see, e.g. `concurrency-no-promise-all` on a transitively imported helper, or `step-id-must-be-literal` after const-folding.

Output format (`render-md-mermaid-workflow`, JSON output, etc.) gains a `diagnostics: AwaitlyDiagnostic[]` field on each workflow.

## awaitly-visualizer changes

Event capture today emits step lifecycle events. Add an error event variant:

```ts
type AwaitlyErrorEvent = {
  type: 'error';
  code: AwaitlySlug;
  hint: string;
  docsUrl: string;
  stepName?: string;
  cause?: unknown;
}
```

When a workflow returns Err with an awaitly-system error, the capture pipeline emits this event. Renderers (mermaid, devtools) display the slug and link to docsUrl. Time-travel debugging gains the ability to filter events by `code`.

## Skill catalogue restructure

Today: one 1256-line `awaitly-patterns/SKILL.md`.

After:
- `SKILL.md` (~150-200 lines): trigger description, MUST/MUST-NOT contract (kept; this is the thing agents internalize), category index linking to rule files, anti-pattern list with one-line summaries.
- `rules/<slug>.md` (one file per slug, ~40-100 lines): frontmatter declaring `category`, `lint_rule`, `error_code`, `analyzer_diag` (any combination); body has why, wrong example, right example, related rules.
- `AGENTS.md`: machine-generated concatenation of all rule files for full-doc consumers (Cursor, Copilot, etc.).

`awaitly-analyze` and `awaitly-visualizer` skills (smaller, separate triggers) are reviewed but not split. They each get a frontmatter cross-link to relevant `awaitly-patterns/rules/*` slugs.

### Rule file frontmatter

```yaml
---
slug: step-no-immediate-execution
category: step
lint_rule: awaitly/step-no-immediate-execution
error_code: null         # not raised at runtime
analyzer_diag: step-no-immediate-execution
related: [step-require-thunk-for-key, step-require-id]
---
```

The frontmatter lets tooling generate the index and the `awaitly.dev/rules/<slug>` page automatically.

## Bidirectional discovery in practice

An agent writes `step('user-' + i, () => ...)`:
1. Lint fires `awaitly/step-require-id` with hint `"Step IDs must be string literals; use { key } for per-item identity."` and `docsUrl: awaitly.dev/rules/step-require-id`.
2. `awaitly-analyze` flags the same site post-import-resolution with the same slug, so a CI run that doesn't run ESLint still surfaces it.
3. The skill rule `rules/step-require-id.md` carries the worked counter-example with `{ key }` migration.
4. Docs site renders the rule page with lint and analyzer cross-links and (where applicable) the matching `runtime-*` slug.

## Implementation surfaces (overview, not a plan)

1. `packages/awaitly/src/slugs.ts` — new file; the typed const map of all slugs.
2. `packages/awaitly/src/tagged-error.ts` and `errors.ts` — extend factory + every pre-built error.
3. `packages/awaitly/src/run.ts`, `workflow.ts`, `step*.ts` — propagate slug into constructed errors.
4. `packages/eslint-plugin-awaitly/src/rules/*.ts` — rename files, add new rules, update message tables, regenerate `index.ts`/`recommended.ts`.
5. `packages/awaitly-analyze/src/strict-diagnostics.ts` and `error-flow.ts` — emit slug-keyed diagnostics.
6. `packages/awaitly-visualizer/src/event-capture/*.ts` — add error event type; renderers consume it.
7. `.claude/skills/awaitly-patterns/` — split into SKILL.md + rules/*.md + AGENTS.md.
8. Docs site — generator that consumes `slugs.ts` + skill rule frontmatter to produce `awaitly.dev/rules/<slug>` pages.

## Breaking changes catalog

For the next major version:

- All ESLint rule names change (`require-step-id` → `step-require-id`, etc.). Consumers must update their config.
- All awaitly-system error shapes gain required `code`, `hint`, `docsUrl`. Consumers that destructure errors or pass them through serialization need to expect new fields (additive but observable).
- Runtime string codes `STEP_TIMEOUT`, `STEP_ABORTED` become slugs `runtime-step-timeout`, `runtime-step-aborted`. Code that string-compares is broken.
- `awaitly-analyze` diagnostic JSON shape changes (adds `code`, drops any prior id format).
- `awaitly-visualizer` event types add `error` variant (additive, but exhaustive switches break).
- Skill: layout changes (path of rules); existing in-repo cross-links rewrite.

A migration codemod can handle the lint-rule rename and the string-code rename; the rest is one-time consumer adjustment.

## Risks and open questions

- **Slug bikeshedding.** Some slugs are awkward (`step-no-immediate-execution` is wordy). Worth one revision pass once all rule file content is drafted.
- **Hint discipline.** Hints must be one short sentence each; bad hints reduce signal. Suggest a CI check that fails if any hint exceeds 120 chars or ends in a period followed by more sentences.
- **Slug stability.** Once published, renames are major bumps. Worth a final review by the maintainer before this lands.
- **Doc site generator.** Not built yet. The spec assumes one will be built; if not, `awaitly.dev/rules/<slug>` returns 404 and `docsUrl` becomes a lie. Mitigation: ship an `awaitly.dev/rules/index` redirect-or-list page in the same release.
- **`error-check-unexpected-first` lint rule.** Heuristic detection is hard; risks false positives. Consider shipping as `warn` initially, or as a type-aware-only rule.
- **Visualizer / analyzer overlap.** Both will emit `code`-keyed diagnostics. Their outputs should be combinable without duplicate suppression — clarify in implementation.

## Acceptance criteria

- One file (`slugs.ts`) is the source of truth for all slugs; the typed union flows everywhere.
- Every awaitly-system runtime error carries `code`, `hint`, `docsUrl`.
- Every ESLint rule name matches a slug.
- `awaitly-analyze` diagnostics carry `code` matching a slug.
- `awaitly-visualizer` emits error events keyed by `code`.
- `awaitly-patterns` skill is split into one file per slug; index references match `slugs.ts`.
- A test verifies that the slug set in `slugs.ts` equals the set of skill rule files equals the set of lint rule names (no orphan slugs in any direction).
