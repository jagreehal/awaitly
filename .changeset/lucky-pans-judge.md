---
"awaitly": minor
"eslint-plugin-awaitly": minor
"awaitly-analyze": patch
---

Stop widening error literals, type-check timeout errors, drop the cause parameter from `Result`, match mixed error unions, lint deps bypasses, and fail empty diagrams.

## `awaitly`

**`err()` was destroying discriminants.** Its error type parameter was not `const`, so an error object inferred as its widened shape:

```ts
err({ type: 'NOT_FOUND', id })   // was: Err<{ type: string; id: string }>
```

Any dependency without an explicit return annotation therefore produced `result.error.type: string` — no narrowing, no exhaustive `switch` — and `as const` was the only way to get the literal back. The `err()` docblock already documented the literal behaviour, so the docs described something that did not happen. `err()` now takes a `const` type parameter.

The same `as const` tax applied to every other error-producing helper. `from`, `fromPromise`, `tryAsync`, `fromNullable`, `mapError`, `mapTry`, `mapErrorTry`, and `tryAsyncRetry` now take `const` error parameters, so error mappers keep their literals without a caller-written assertion:

```ts
tryAsync(() => charge(amount), (cause) => ({ type: 'CHARGE_FAILED', cause }))
// error type is { readonly type: 'CHARGE_FAILED'; readonly cause: unknown }
```

`step.try`, `step.fromResult`, `step.fromNullable`, `catchUnexpected`, and `errors: [...]` already had `const` parameters and are unchanged.

**Breaking:** inferred error literals now carry `readonly` modifiers, so an inferred error object holding an array is a readonly tuple and will not assign to a mutable `string[]`. Annotating the function's return type — the documented pattern — makes the error contextual and avoids this. The `Mutable<E>` unwrapper that would strip the modifiers was deliberately not applied: it flattens `Error` and `TaggedError` instances into structural objects, a worse and far more common regression.

**Hover noise:** `run()` and `createWorkflow()` declared `NoInfer<E>` in their *return* types. Return positions are not inference sites, so this was display-only, and it rendered as `Result<User, UnexpectedError | NoInfer<UserNotFound>, unknown>`. The wrapper is gone from those return types; the `NoInfer` guards on `onError`, `onEvent`, and `step` — which do pin `E` against an annotated callback parameter — are unchanged.

Docstrings and documentation that taught the now-unnecessary `as const` have been updated, including a troubleshooting section and a `step()` aside that asserted the opposite of current behaviour.

**Follow-up:** `const` alone does not produce literal inference through a *callback's return position*, and the behaviour differs by compiler — TypeScript 6.x infers the literal from `const E` while 5.9 widens to `string`. Object literals were fine either way; bare strings were not, so `tryAsync(fn, () => 'FETCH_ERROR')` still widened on the compiler this package actually depends on. The error parameters of `from`, `fromPromise`, `tryAsync`, `fromNullable`, `mapError`, `mapTry`, `mapErrorTry`, `tryAsyncRetry` and `tryAsyncBoundary` are now `const E extends ErrorValue`, where the new exported `ErrorValue` is `unknown` written out as a union of its constituents — it accepts exactly what `unknown` accepts, and the spelling is what restores literal inference.

**`step.withTimeout` now type-checks its timeout error.** `TimeoutOptions.error` was `unknown` and `TimeoutBehavior`'s function form returned `unknown`, so a custom timeout error never reached the result union — the documented example produced a workflow whose error type did not mention the timeout at all. Both are now generic over the timeout error, and `step.withTimeout` constrains it to the workflow's error union the same way `step.try` does:

```ts
const workflow = createWorkflow({ apiCall }, { errors: ['API_TIMEOUT'] });
await workflow.run(async ({ step, deps }) =>
  step.withTimeout('apiCall', () => deps.apiCall(), {
    ms: 5000,
    onTimeout: () => 'API_TIMEOUT',   // in the union; an undeclared tag is now a compile error
  })
);
```

**Breaking:** a custom timeout error whose tag is not in the workflow's error union no longer compiles. Declare it with `errors: [...]`. The `'error'`/`'option'`/`'disconnect'` behaviours are unchanged.

**`Result` and `AsyncResult` now take two type parameters, not three.** The third was the cause type, and it was the reason every hover ended in a stray `, unknown` — TypeScript never elides a trailing type argument, even when it equals the default, so `Result<User, UserNotFound>` printed as `Result<User, UserNotFound, unknown>` no matter how it was written:

```ts
// before
Result<User, UnexpectedError | NoInfer<UserNotFound>, unknown>
// after
Result<User, UnexpectedError | UserNotFound>
```

`Err<E, C = unknown>` keeps its cause parameter, so `err(error, { cause })` still infers the cause type and `ExtractCause`/`CauseOf` still read it off an `Err`. What changes is that a value widened to a `Result` no longer carries the type — and since annotating a function's return type is exactly such a widening, this was already the case for essentially all real code: `AsyncResult<User, 'NOT_FOUND'>` had a cause of `unknown` before this change too. The `cause` value is untouched at runtime.

**Breaking:** `Result<T, E, C>` and `AsyncResult<T, E, C>` no longer accept a third argument — drop it. The `err` handlers of `match`, `tapError`, `mapError` and `unwrapOrElse` receive `cause: unknown` rather than a typed cause; narrow it at the point of use, or read it off the `Err` before widening.

**`matchError` now handles unions that mix string tags and `TaggedError` classes.** awaitly supports both error shapes, so this union is a natural thing to write:

```ts
const getUser = async (
  id: string
): AsyncResult<User, 'NOT_FOUND' | ValidationError> => { /* … */ };
```

Nothing could match it exhaustively. `matchError` was constrained to `E extends string`, `TaggedError.match` takes only tagged classes, and the `Match` pipeline is keyed on `_tag` objects — so a mixed union fell between all three and left `instanceof` chains as the only option. A `switch` could not close the gap either: `case ValidationError:` compares the error against the *constructor*, which never matches an instance.

Handlers are now keyed by tag, where a bare string is its own tag and anything else is keyed by its `type` (falling back to the deprecated `_tag`). The matched member arrives narrowed, so a class's props are reachable without an `instanceof` check:

```ts
const message = matchError(result.error, {
  NOT_FOUND: () => 'User not found',
  FETCH_ERROR: () => 'Fetch error',
  ValidationError: (e) => `Bad input: ${e.userId}`,  // e is ValidationError
  UnexpectedError: (e) => `Unexpected: ${e.message}`,
});
```

Exhaustiveness is still enforced — a missing handler is a compile error, and a misspelled tag reports `Did you mean to write 'ValidationError'?`.

This is additive. `MatchErrorHandlers<E, R>` keeps adding the `UnexpectedError` key, so string-only unions type exactly as before, and an unmatched tag at runtime now throws a named error instead of `undefined is not a function`.

## `eslint-plugin-awaitly`

New lint rule: `awaitly/step-no-deps-bypass`.

A workflow can register dependencies and then call the module-level functions anyway:

```ts
const wf = createWorkflow('checkout', { validateCart, chargeCard });

wf.run(async ({ step }) => {
  // registered as a dep, called directly — deps is now just a name registry
  const cart = await step('validateCart', () => validateCart(input));
});
```

This compiles, runs, and passes its tests. What it silently loses is injection: `wf.run(fn, { deps: mockDeps })` has no effect on that step, so the test double never runs and the DI story is only true on paper. Nothing in the type system catches it, because the deps object is still well-typed and still drives the inferred error union.

The rule reports a bare call to any registered dep name inside a workflow callback and points at `deps.<name>(...)`. It covers `createWorkflow`, `createSagaWorkflow`, and the deps-first `run(deps, fn)` form, where the bound steps parameter (`s.fn(...)`) counts as correct. Dep names shadowed by a callback parameter are left alone, and a deps object assembled with a spread is skipped, since its keys cannot be enumerated statically.

Enabled in both `recommended` and `recommended-strict`. The slug `step-no-deps-bypass` joins the shared spine in `awaitly/slugs`.

## `awaitly-analyze`

Fix two defects that let `--assert-diagrammable` pass on a workflow the analyzer could not read.

**The named-run overload was invisible.** `run` is overloaded: the callback comes first in `run(fn)`, but second in `run('run-id', fn)`. Invocation discovery took `args[0]` unconditionally, so the named form handed the analyzer a string literal instead of the callback. The workflow was still discovered and its dependencies resolved, so the output looked plausible while every step was missing:

```ts
// Diagrammed correctly
wf.run(async ({ step, deps }) => { await step('validateCart', () => deps.validateCart(cart)); });

// Reported six dependencies and zero steps
wf.run('checkout', async ({ step, deps }) => { await step('validateCart', () => deps.validateCart(cart)); });
```

The callback is now selected by shape: an inline function wins, otherwise the first non-string argument, which keeps `run(handler)` and `run('run-id', handler)` working where the callback is passed by identifier.

**An empty diagram scored 100/100.** `computeDiagrammability` returned `score: 100, deterministic: true` whenever a workflow produced no flow nodes. Combined with the above, `--assert-diagrammable` exited 0 on every named-run workflow, and `--doctor` reported "fully diagrammable" about a diagram with nothing in it. A workflow that resolves to no nodes now reports a new `empty-diagram` issue with `deterministic: false` and `score: 0`, so the CI gate fails and says why.
