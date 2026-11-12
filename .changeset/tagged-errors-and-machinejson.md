---
"awaitly": major
"awaitly-visualizer": major
"awaitly-analyze": minor
---

Tagged errors, and XState MachineJSON output from the analyzer.

**awaitly:** `err()`, the error mappers (`from`, `fromPromise`, `tryAsync`, `tryAsyncRetry`, `tryAsyncBoundary`, `fromNullable`, `mapError`, `mapTry`, `mapErrorTry`, `bimap`), `step.try`, `step.fromResult`, `step.fromNullable`, `onTimeout` and `catchUnexpected` take tagged errors: a `{ type }` object or a `TaggedError`. Workflow `errors: ["X"]` declarations add `{ type: "X" }` to the error union.

```ts
// before
return err("NOT_FOUND");
step.try("parse", parse, { error: "PARSE_FAILED" });
catchUnexpected: () => "UNEXPECTED"

// after
return err({ type: "NOT_FOUND" });
step.try("parse", parse, { error: { type: "PARSE_FAILED" } });
catchUnexpected: () => ({ type: "UNEXPECTED" })
```

Compare errors with `error.type === "NOT_FOUND"`. `match` arms keep their keys.

**awaitly-visualizer:** `KrokiError`, `ExportUrlError`, `DiscordError`, `WebhookError`, `SlackError`, `NotifyError`, `FlushError` and `StringifyError` use `{ type }` objects, and renderers label errors by their `type`.

**awaitly-analyze:** `renderMachineJSON(ir)` and `awaitly-analyze --format=xstate` emit XState v6 MachineJSON. Steps invoke their deps, parallel branches run as regions, decisions and races become events, loops iterate until `done`, and errors lead to a `failed` state that lists their tags.
