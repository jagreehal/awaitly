---
"eslint-plugin-awaitly": major
"awaitly": patch
---

Resolve `step`/`deps` bindings by scope, scope the concurrency rules to workflows, and document the callback shapes.

**Lint** — the shared detector in `detect-step.ts` now resolves `step` and `deps`
through ESLint's lexical scopes, so aliased destructuring lints the same as the
plain form:

```ts
run(deps, async ({ step: s, deps: d }) => { … })
```

Shadowing by local variables, functions, catch bindings and loop bindings is
respected; defaulted bindings and quoted property keys are supported. Autofixes
preserve the original callee, including aliases and helper methods, and retain
cache options when wrapping computed member expressions in thunks. This applies
to `step-require-id`, `step-no-immediate-execution`, `step-require-thunk-for-key`,
`step-stable-cache-keys`, `result-no-floating`, `result-require-handling`,
`step-no-try-catch-wrap` and `step-no-bare-await`.

`concurrency-no-promise-all`, `-race` and `-allsettled` now fire only inside a
workflow callback, matching their documented scope and keeping their
`step.all()` / `step.map()` advice actionable.

Breaking: aliased bindings now report, and `Promise.all` outside a workflow does not.

**Docs and skill** — `SKILL.md` states what each entry point hands the callback:

| Call | Callback receives |
| --- | --- |
| `run(cb)` | `{ step }` |
| `run(deps, cb)` | the deps, bound as steps |
| `createWorkflow(name, deps).run(cb)` | `{ step, deps }` |
| `durable.run(deps, cb, opts)` | `{ step, deps }` |

A bound call is a real step that caches and retries. A new durability section
covers what resumption restores: keyed steps, per-iteration identity for
`step.forEach` via `stepIdPattern`, the `maxIterations` and `errors: []` that
`awaitly-analyze --assert-diagrammable` expects, and how `resumeFailedSteps`
treats a crash against a typed error. `durable.run` joins the pattern selection
guide. New docs page *Entity Status and Workflow State* covers keeping lifecycle
rules in the domain while the workflow drives them.

New `skill-snippets.test.ts` extracts every sample importing awaitly and
typechecks it against `dist/*.d.ts` — the declarations a consumer resolves —
so samples and the published API stay in step.
