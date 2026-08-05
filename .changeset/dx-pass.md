---
"awaitly": major
"awaitly-analyze": minor
"eslint-plugin-awaitly": major
---

A DX pass over imports, error unions, and static analysis. The theme: a user reaching for `as const`, a cast, or a restated error list is a library problem, so each of those is removed rather than documented.

## Four entry points instead of thirteen

| Entry | Carries |
| --- | --- |
| `awaitly` | Results, `run`, `createWorkflow`, steps, resources, batching, policies |
| `awaitly/result` | Result-only size guarantee |
| `awaitly/durable` | durable execution, persistence, sagas, human-in-the-loop, streaming, webhooks, engine |
| `awaitly/testing` | harness code, kept out of production bundles |

Nine subpaths are removed. Every export they carried is still published — `run`/`workflow`/`reliability` → `awaitly`, and `persistence`/`saga`/`hitl`/`streaming`/`webhook`/`engine` → `awaitly/durable`. `awaitly` still re-exports nothing from `awaitly/durable`, so CommonJS and non-tree-shaking consumers don't pull the production graph in through the front door.

## No more `as const` on declared errors

```diff
- createWorkflow("checkout", deps, { errors: ["NOT_FOUND"] as const })
+ createWorkflow("checkout", deps, { errors: ["NOT_FOUND"] })
```

The option's type parameter is now a `const` type parameter — the same modifier `Deps` already used — so the literals survive without help.

## `any` / `anyAsync` require a non-empty array

The parameter is a non-empty tuple, so an empty array is a compile error and `EmptyInputError` is gone from both return types. Deleting an error case beats declaring one: there is one fewer failure mode to handle, and the mistake is caught before it ships. The runtime guard remains for JavaScript callers.

Code passing a `Result[]` typed as a plain array rather than a literal or tuple needs a non-empty tuple type or a length check, since TypeScript cannot tell whether such an array has elements.

## A rejected promise is unexpected, not a declared error

A rejection is a thrown exception, and `catchUnexpected` / `UnexpectedError` already exist for those. `allAsync` and `anyAsync` were catching rejections and reporting `PromiseRejectedError`, which put a failure nobody modelled into every caller's union — and because a step's errors must belong to the workflow's declared union, the documented race did not type-check without a cast:

```diff
- const fastest = await step.race("cacheRace", () =>
-   anyAsync([deps.cacheA(), deps.cacheB()]) as AsyncResult<string, "MISS">
- );
+ const fastest = await step.race("cacheRace", () => anyAsync([deps.cacheA(), deps.cacheB()]));
```

`anyAsync` also stops letting a rejection hide a real error. It races, so a thrown racer simply loses and the others still compete. But when every racer failed it reported whichever settled *first*, so a thrown racer could mask another racer's modelled error depending on timing. A modelled failure now always wins, and the exception propagates only when every racer threw.

`allSettledAsync` is unchanged and still reports `PromiseRejectedError` per item — telling you every outcome is what it is for. The type, constant, and guard stay exported.

Code matching on `PROMISE_REJECTED` from `allAsync` or `anyAsync` needs a `try`/`catch`, or to handle `UnexpectedError` inside a workflow.

## Resume safety: `onBeforeStep` and step-order drift

Bound step keys are position-derived (`getUser`, `getUser#2`, …), so inserting or reordering a dep call shifted every later suffix — a resumed run could read a *different* step's checkpoint under the same key and continue with the wrong value. Avoiding that relied on remembering to bump `version`.

Snapshots now record the executed step order, and a mismatched resume fails with `WorkflowShapeDriftError` instead of replaying. The new `onBeforeStep(stepKey, workflowId, context, info)` fires before each step, including one about to be served from cache or a snapshot and before that value is read — the only point where a stale checkpoint can still be rejected, since `onAfterStep` never fires for a replayed step.

## Branch ids are derived, so two lint rules are gone

The analyzer derives a stable id from a branch's own expression (`user.isPremium` → `user-is-premium`), so raw `if` / `for...of` stay diagrammable. That was the entire reason `workflow-prefer-step-if` and `workflow-prefer-step-foreach` existed; both are removed, along with their entries in `recommended` and `strict`. Configs that set either rule explicitly must drop the entry, since ESLint errors on unknown rule names.

Derivation is deliberately conservative: every operator encodes to a distinct word, and an expression it cannot encode losslessly (calls, arithmetic) yields no id and the node stays unlabelled. These ids identify branches in diagrams and graph validation, so being injective matters more than covering every expression.

## `step.race` is diagrammed as it is actually called

The analyzer only matched `step.race([...])` and `step.race({...})` — shapes the runtime never accepted and that `require-step-id` rejects, since it wants a string first argument. The real signature is `step.race(name, operation)`, a scope wrapper whose racers come from what the callback runs. Given that, the analyzer produced a race node with **zero children**, so every real race rendered as an empty fork-and-join. Both dead branches are removed.

Two gaps kept the documented pattern from rendering even once the signature was recognised:

- `anyAsync([a(), b()])` produced no children when its racers were invoked directly, missing the implicit-step fallback `allAsync` already had.
- A cast hid the expression under it, and `() => anyAsync([...]) as AsyncResult<T, E>` was the usual way to absorb the extra error types. Parentheses, `as`, and `!` are now unwrapped wherever a callback is analyzed, so this applies to every construct rather than just races.

A race scope now carries its `name`, and wrapping `anyAsync` reports one race instead of nesting a race inside a race.

## A child workflow passed as a dep is shown as a workflow reference

Passing a child workflow as a dep — `enrichUser: (id) => childWorkflow.run(fn)` — is how the child's errors join the parent's union, so it is the composition worth reaching for. But the reference sits in the deps object rather than the callback, and only the callback was scanned for `<x>.run(...)`, so calling that dep drew a plain step.

Dependencies now carry `workflowRef`, and a step calling one renders as a reference and counts toward `workflowRefCount`. Detection runs before policy unwrapping, so `retry(() => child.run(fn))` is still recognised; only a plain `<identifier>.run` / `.runWithState` is matched.

Relatedly, `step.workflow` cannot widen a parent's error union — `E` is fixed before the callback is typed and TypeScript cannot infer it back out of a callback body — so its JSDoc claim that the child's errors flow in was false. It now documents what it does and points at the dep pattern.

## Inferred and declared step errors read alike

A step's errors are inferred from its dep's return type when `errors` is not passed, but they arrived as TypeScript writes them — `"NOT_FOUND"`, quotes included — while a declared `errors: ["NOT_FOUND"]` arrived bare. The same step rendered differently depending on whether the author restated something the types already knew. Inferred names are now unquoted. Errors containing a delimiter are still not split: a dep failing with `"A|B"` stays one error.

This is what makes the redundant per-step `errors` option safe to drop from examples; it remains supported as an assertion.
