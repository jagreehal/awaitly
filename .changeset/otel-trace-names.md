---
'awaitly': minor
'awaitly-analyze': minor
---

`awaitly-analyze --doctor` flags runs whose OpenTelemetry span will be a bare `run`, such as `const checkout = createWorkflow(deps)` or an inline `run()` callback, and gives you the exact call to name them. The new `workflow-unnamed-trace` slug links to the rule. The analyzer names a run after its `workflowName` option, so diagram trace counts match your spans.

Step spans keep `code.function.name` for named helpers that call a step after an `await`, and for functions that `process.nextTick` or `Array.map` call.

Bundlers now drop the slug table when you only import `ok` and `err`, which halves the minified size of `awaitly/result` for that import.
