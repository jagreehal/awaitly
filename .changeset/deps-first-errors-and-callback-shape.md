---
"awaitly-analyze": patch
"eslint-plugin-awaitly": patch
---

`awaitly-analyze` reads a dependency's errors from its call signature with the TypeScript checker, so deps-first `run(deps, fn)` steps pick up errors from `typeof fn` references, imported error classes, named unions and every overload. The text parser covers projects without a checker.

`workflow-callback-shape` supports deps-first `run(deps, (s, context?) => ...)` and checks only `run` calls. Related rules read step aliases from the deps-first context parameter and match quoted property names.
