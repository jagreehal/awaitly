---
"awaitly": minor
"awaitly-analyze": minor
---

Deps-first `run(deps, fn)` with auto-bound steps and automatic error inference.

**awaitly**

- New `run(deps, fn)` form: pass your functions as the first argument and compose through the bound steps object — `run({ getOrder, getUser }, async (s) => s.getOrder(id))`. No type parameters, no string step IDs, no thunks; the result's error union is inferred from the deps object.
- Plain (non-Result) functions are valid deps: values pass through, throws become `UnexpectedError`, enabling incremental adoption from plain async/await.
- `createWorkflow` parity: workflow callbacks receive the same bound steps object as `steps` — `workflow(async ({ steps }) => steps.getUser(id))` — routed through the cached step so caching and resume apply.
- Loop safety: repeat invocations of the same dep auto-suffix the step key (`getUser`, `getUser#2`, ...). Previously a workflow loop calling the same dep twice silently returned the first cached result.
- `ErrorOf`/`ErrorsOf` now correctly yield `never` (instead of `unknown`) for plain non-Result functions.
- New exports: `BoundSteps` (awaitly, awaitly/run) and `WorkflowSteps` (awaitly/workflow).

**awaitly-analyze**

- Detects the deps-first forms as steps with the dep key as step ID: `s.getOrder(id)`, destructured `({ getOrder }) => getOrder(id)`, renamed bindings, workflow `({ steps })`, and nested `({ steps: { getUser } })`. The deps object passed to `run(deps, fn)` is captured for dependency and error-type resolution, so deps-first workflows visualize with full fidelity.
- Internals: step-method detection is now a dispatch table, and the static analyzer is decomposed into concern modules (discovery, bindings, step-options, deps-types). No behavior change.
