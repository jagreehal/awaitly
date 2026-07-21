---
"awaitly": minor
"awaitly-analyze": minor
"awaitly-visualizer": minor
---

The graph contract and the live inspector: the static diagram, the runtime, and the visualizer now share one identity, and you can watch real runs paint the graph.

**awaitly — core decision events.** `step.if` / `step.label` emit a `decision` event (`decisionId`, `label`, `branch`, `value`) through the standard `onEvent` stream — no `trackIf` instrumentation needed to see which branch fired. `step.branch` owns arm execution, so it emits a *scoped* decision (`phase: "start"` before the arm, `phase: "end"` with duration after, emitted even when the arm throws) — visualizers nest the arm's steps inside the taken branch.

**awaitly — strict graph validation (`graph` option).** Pass a declared workflow graph — the `WorkflowDiagramDSL` from awaitly-analyze or a plain list of ids — to `run()` or `createWorkflow` (creation-time, overridable per run). Any runtime step or decision id not in the graph fails the workflow immediately, so the diagram is guaranteed to match what actually runs. Ids with `{placeholder}` segments (e.g. `item-{i}`) match any value in that slot. Enforced across the full helper surface, including the independently-implemented `step.try`, `step.fromResult`, `step.withFallback`, and `step.withResource`.

**One identity contract.** DSL state ids are the semantic ids authored in the code — `step()`'s literal first argument and `step.if()`'s decision id — so analyzer output works directly as the `graph` option and matches runtime event `name`s. Literal cache keys are carried on the new `WorkflowDiagramState.key`; snapshot-driven highlighting matches `currentStepId === (state.key ?? state.id)`. All state ids are collision-safe (`#2` suffixing, `start`/`end` reserved).

**awaitly-analyze — no silent drops.** An awaited call static analysis can't model now surfaces as a real `unknown` node in the IR plus an `UNANALYZED_AWAIT` warning, instead of vanishing from the diagram. Explicit `step.if` decisions always produce a decision node, even with step-free branches.

**awaitly-analyze — trace layer.** `traceFromEvents` captures decisions (branch taken) and retry counts; `renderStaticMermaidWithTrace` overlays evaluated decision diamonds alongside step statuses — whole shape visible, executed path painted.

**awaitly-analyze — `--dev`, the live inspector.** `awaitly-analyze ./workflow.ts --dev` starts a zero-dependency dev server (SSE, no WebSocket setup): it analyzes and watches the file, serves the full static graph, and accepts runtime event streams at `POST /events`. Each run appears in a run bar with its trace overlaid — executed steps colored by status, decisions highlighted, untouched nodes greyed.

**awaitly-visualizer — `devEvents`.** Wire `onEvent: devEvents("http://localhost:4747")` and every run streams itself into the inspector. Batched per microtask, fire-and-forget, and crash-proof: fetch failures and serialization failures (cyclic context, BigInt) are swallowed — the inspector is a dev convenience, never a dependency. The runtime IR builder also consumes core decision events directly: `step.branch` arms nest inside the taken branch, `step.if` renders as a decision marker with the untaken branch visible.
