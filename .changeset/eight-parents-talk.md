---
"eslint-plugin-awaitly": minor
"awaitly-analyze": minor
"awaitly": minor
"awaitly-docs": minor
---

Saga step names: require a string name as the first argument to `saga.step()` and `saga.tryStep()` for observability and compensation tracking. Runtime validation rejects empty or non-string names with clear errors. ESLint rule `require-step-id` and static analyzer updated to enforce and analyze step names.
