---
"awaitly": minor
"awaitly-docs": minor
---

- **awaitly**: Add `awaitly/result` subpath export for minimal bundle; improve JSDoc in core, workflow, and webhook modules; export all main API on `Awaitly` namespace alongside existing named exports.
- **awaitly-docs**: Document `awaitly/result` in installation and API reference; update comparison docs (vs neverthrow, try/catch, promise, effect, Vercel Workflow) to use `Awaitly.*` namespace (e.g. `Awaitly.ok`, `Awaitly.err`); fix API generator dedupe and truncation.
