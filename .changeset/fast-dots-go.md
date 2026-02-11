---
"awaitly-analyze": minor
"awaitly": minor
"awaitly-docs": minor
---

- **awaitly-docs**: Document class-based Workflow API and static analyzer support. Static Analysis guide: new "Class-based workflows" subsection (extend Workflow, run(event, step), workflow name from super(), steps from run body), API types note for description/markdown via constructor options, and .named() note for class-based workflow names. Documenting Workflows: class-based workflows can pass description/markdown in constructor (third argument) and use JSDoc. Foundations Workflows: mention Workflow class, state/options at construction (cache, resumeState, onEvent, etc. in constructor; execute() only payload + signal/instanceId), link to API reference.
- **awaitly-analyze**: Static analyzer supports class-based workflows (workflow name from super(), steps from run()); no code changes in this changeset.
- **awaitly**: Class-based Workflow API (extend Workflow, run(event, step), execute(payload), this.env) unchanged; docs now reflect it.
