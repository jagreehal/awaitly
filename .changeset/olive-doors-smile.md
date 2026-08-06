---
"awaitly": minor
---

`durable.run` accepts `errors`, closing the gap 4.1 left between the two run styles.

4.1 made `errors` widen a workflow's error union, but only on `createWorkflow`. A durable run had no way to declare anything, so an error introduced by `step.try` could not be expressed there at all:

```ts
await durable.run(
  { fetchRow },
  async ({ step, deps }) => {
    const row = await step("fetchRow", () => deps.fetchRow(id));
    return await step.try("parse", () => JSON.parse(row.body), {
      error: "PARSE_FAILED", // was: not assignable to type '"ROW_NOT_FOUND"'
    });
  },
  { id: `ingest-${jobId}`, errors: ["PARSE_FAILED"] }
);
// result.error: "ROW_NOT_FOUND" | "PARSE_FAILED" | UnexpectedError | …durable errors
```

Same contract as `createWorkflow`: each entry joins the run's error union and feeds analyzer validation, no `as const` needed, and omitting it leaves the union exactly as the deps infer it.

This is also the way to put a system error into the durable static union. `STREAM_READ_ERROR` already arrives as a typed value rather than an `UnexpectedError` — declaring it (`errors: ["STREAM_READ_ERROR"]`) is what lets a boundary `switch` over `result.error` stay exhaustive.
