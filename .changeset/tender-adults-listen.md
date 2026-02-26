---
'eslint-plugin-awaitly': minor
'awaitly-analyze': minor
'awaitly': minor
'awaitly-docs': minor
---

- **awaitly**: `step.workflow()`, `step.withFallback()`, and `step.withResource()` run through the cached step wrapper (events, cache, onAfterStep). `Workflow.run` / `runWithState` support optional `ExtraE` generic for error-union inference.
- **awaitly-analyze**: Parser and DSL/Mermaid output support `step.workflow`, `step.withFallback`, and `step.withResource`. Child workflow refs invoked via `step.workflow("id", () => childWorkflow.run(...))` are detected and emitted as workflow-ref nodes; step.workflow steps get a "(Workflow)" label suffix.
- **eslint-plugin-awaitly**: `require-step-id`, `no-immediate-execution`, `require-thunk-for-key`, `stable-cache-keys`, and `no-floating-result` now apply to `step.workflow`, `step.withFallback`, and `step.withResource`.
- **docs**: Foundations (step.mdx) and ESLint plugin guide updated for the new step helpers; .claude skills (awaitly-patterns, awaitly-analyze) updated with Step Helpers table and analyzer notes.
