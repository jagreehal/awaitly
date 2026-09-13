---
"awaitly-analyze": minor
---

Bound `s.getUser()` steps inherit the dep's Result error union, so diagrams draw `-->|err|` branches without an explicit `errors` option. The CLI writes `<basename>.workflow.md` next to the source by default (`--no-output-adjacent` to print only) and `--types` is opt-in. `--trace` keeps each `step.forEach` iteration as its own node, so `cache-hit`, `success`, and `aborted` iterations colour separately.
