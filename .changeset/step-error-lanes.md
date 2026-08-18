---
"awaitly": patch
---

Keep every error lane a step callback can return. `step()`, `step.all` (array form), `step.race`, `step.retry`, `step.withTimeout`, `step.map` and `step.streamForEach` inferred their value and error separately, so TypeScript pinned the error to the first `Err` member of a multi-branch callback and rejected the rest. A step branching into two of the workflow's declared errors failed to compile, and the message named only one lane. Each signature now captures the callback's whole return type in one parameter and extracts the value with `ExtractValue`. `step.retry` types `shouldRetry` against the callback's own error union, and `step.map` and `step.streamForEach` derive their element type from it.
