---
"awaitly": minor
---

Declared errors, literal `catchUnexpected`, stream failures as values, and the option types strict consumers can actually pass. One theme, carried over from 4.0.0: when the escape hatch is a cast, a type-parameter list, or a wrapper around library plumbing, that is a library problem.

## `errors` declares errors, not just documentation

An error introduced by `step.try` rather than by a dep had no supported way in. `errors` looked like the answer but was analyzer-only metadata, so this did not compile:

```ts
const wf = createWorkflow("ingest", { fetchRow }, { errors: ["PARSE_FAILED"] });

await wf.run(async ({ step, deps }) => {
  const row = await step("fetchRow", () => deps.fetchRow(id));
  return await step.try("parse", () => JSON.parse(row.body), {
    error: "PARSE_FAILED", // Type '"PARSE_FAILED"' is not assignable to type '"ROW_NOT_FOUND"'
  });
});
```

The only workaround was spelling out all four type parameters — `createWorkflow<typeof deps, UnexpectedError, void, "ROW_NOT_FOUND" | "PARSE_FAILED">(...)` — two of which the caller has no opinion about.

Each entry in `errors` now joins the workflow's error union, so the code above compiles and `result.error` reads `"ROW_NOT_FOUND" | "PARSE_FAILED" | UnexpectedError`. The list still feeds analyzer validation; it now also means what its name says. Omitting `errors` changes nothing: it defaults to the empty tuple, so the union stays exactly what the deps infer.

**Possible compile impact:** if you already passed `errors` *and* exhaustively switch on `result.error`, the declared entries now appear in that union and the switch may need new cases.

## A failing stream is infrastructure failing, not a bug

`reader.read()` models a read failure as a Result, but iterating a reader — `for await`, a transformer, or `collect()` — turns it back into a throw. That throw reached the workflow boundary and was wrapped in `UnexpectedError`, filing "the stream store is unreachable" under "there is a bug in your code" and hiding an actionable, retryable failure behind the catch-all.

Stream errors now arrive as **typed error values**, the same treatment `STEP_TIMEOUT` already gets:

```ts
if (!result.ok) {
  switch (result.error.type ?? result.error) {
    case "STREAM_READ_ERROR": return { status: 503 }; // store is down, retry
    case "STEP_TIMEOUT": return { status: 504 };
  }
}
```

Declare it — `errors: ["STREAM_READ_ERROR"]` — to put it in the static union so the boundary switch stays exhaustive. A throw from **your own** transform callback is still a bug, so it stays an `UnexpectedError` with the original throw on `.cause`. That split is the point: awaitly's own failures are values, yours-that-shouldn't-happen are exceptions.

`collect` and `reduce` keep their signatures. They are terminal consumers of an async iterable, and returning `AsyncResult<T[], …>` would make every caller unwrap a Result to get an array — including the ones who passed a plain async iterable and only ever write `await`. Nobody should have to unwrap a Result for library plumbing they never declared.

New export from `awaitly/durable`: `isStreamError`, the guard the engine uses to tell its own stream failures from arbitrary throws.

## `catchUnexpected` keeps its literal tag without `as const`

```diff
- catchUnexpected: (cause) => ({ type: "UNEXPECTED" as const, cause })
+ catchUnexpected: (cause) => ({ type: "UNEXPECTED", cause })
```

`U` is a `const` type parameter now, the same modifier `Deps` and `errors` already carried, so the tag infers as `"UNEXPECTED"` instead of `string`. Applies to `createWorkflow(deps, { catchUnexpected })` and `run(deps, fn, { catchUnexpected })`. The callback-only `run(fn, { catchUnexpected })` still needs its type parameters — there `E` is inferred from the callback as well as from the mapper, so the literal cannot survive on its own.

## `durable.run` accepts a `streamStore`

Durable execution and streaming could not be expressed in one call: `streamStore` existed on `createWorkflow` but not in `DurableOptions`, so a durable run had no way to open `step.getReadable()` / `step.getWritable()` — the exact combination the streaming docs are pitched on.

```ts
await durable.run(deps, fn, {
  id: `import-${jobId}`,
  store,
  streamStore: createMemoryStreamStore(),
});
```

## `pipe` composes up to eight stages

It stopped at four, and the fifth produced `Expected 1-5 arguments, but got 6` with nothing pointing at the cause.

## Options accept explicit `undefined`

Forwarding an optional value into an options object failed for every consumer with `exactOptionalPropertyTypes` enabled:

```ts
createWorkflow("pipeline", deps, {
  cache: options?.cache, // Type 'StepCache | undefined' is not assignable to type 'StepCache'
});
```

The workaround was a conditional spread per field. The optional properties of `WorkflowOptions`, `RunConfig`, `ExecutionOptions`, `StepOptions`, `RunOptions*`, and `DurableOptions` now include `| undefined`.

## Docs

- **The callable form is gone from the README.** Nine examples still executed workflows as `await workflow(async ({ step }) => …)`, a form removed two majors ago — including the headline caching example. All now use `workflow.run(...)`.
- **Strict mode.** The README documented `strict: true` as a `createWorkflow` option; it is a per-run one (`workflow.run(fn, { strict: true })`), so the example did not compile. It also credited `strict` with closing the error union — `catchUnexpected` does that. Both corrected, and the section now covers declaring extra errors.
- **`run(fn)` with no deps and no type parameters** types `result.error` as `UnexpectedError` alone, which is easy to miss because it reads identically to the form that infers everything. Called out in the README table and on the overload itself.
- **`createMemoryStreamStore`** documents that it takes no type parameter on purpose: one store backs many namespaces, and typing happens at `step.getReadable<T>()` / `step.getWritable<T>()`.
- **README examples now run in CI** (`src/readme-examples.test.ts`). Nothing was executing them, which is how the defects above survived. Alongside the mirrored examples are two mechanical guards over the README's code fences: no calling a workflow directly, and no `as const` on error declarations. Both were verified to fail when the corresponding mistake is reintroduced.
