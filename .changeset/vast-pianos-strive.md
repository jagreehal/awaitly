---
"eslint-plugin-awaitly": minor
"awaitly-visualizer": minor
"awaitly-postgres": minor
"awaitly-analyze": minor
"awaitly-libsql": minor
"awaitly-mongo": minor
"awaitly": minor
"awaitly-docs": minor
---

**Step IDs for workflows and steps**

- **awaitly**: Workflow execution and snapshots now use explicit step IDs. Steps and helpers (`step()`, `step.sleep()`, `step.retry()`, `step.withTimeout()`, `step.try()`, `step.fromResult()`) accept an optional string literal as the first argument for durable execution, resumption, and observability.
- **eslint-plugin-awaitly**: New rule `require-step-id` enforces that all step calls use a string literal step ID as the first argument.
- **awaitly-analyze**: Static workflow IR and analyzer updated to support step IDs.
- **awaitly-visualizer**: IR builder updated for step ID support.
- **awaitly-postgres**, **awaitly-mongo**, **awaitly-libsql**: README and docs updated for step IDs.
- **awaitly-docs**: Documentation updated across foundations, guides, and reference for step IDs and the new ESLint rule.
