---
"awaitly-analyze": patch
---

Detect steps awaited inline as call arguments. `s.validateUser(await s.getUser('1'))` produces both `getUser` and `validateUser` nodes in evaluation order, each with its error edges.
