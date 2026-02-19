---
name: awaitly-visualizer
description: "Workflow visualization patterns for awaitly. Use when wiring event capture, renderers, collectors, time-travel, and export URLs in code."
user-invocable: true
---

# Awaitly Visualizer

Use `awaitly-visualizer` to capture workflow events and render workflow state (ASCII, Mermaid, JSON, logger, flowchart), plus export URLs and post-hoc visualization.

Core model:
- Create visualizer/collector.
- Wire handlers to workflow events (`onEvent`) and decision events (`emit` for `trackIf`/`trackSwitch`).
- Execute with `workflow.run(...)`.
- Render or export from captured state.

---

## Agent Contract (MUST follow)

### Event wiring
- **MUST** wire `onEvent` at workflow creation or run config to `viz.handleEvent`, `collector.handleEvent`, or `combineEventHandlers(...)`.
- **MUST** support per-run wiring when creation-time config cannot be changed: `workflow.run(fn, { onEvent: viz.handleEvent })`.
- **MUST NOT** call `viz.render*()` expecting updates unless events were captured.
- **MUST NOT** render before executing (or feeding events), unless rendering a pre-captured event list via `visualizeEvents(events, options)`.

### Execution model
- **MUST** execute workflows via `workflow.run(...)` / `workflow.runWithState(...)`.
- **MUST NOT** use callable workflow form (`workflow(...)`).

### API surface constraint
- **MUST NOT** invent renderer names or collector methods.
- **MUST NOT** invent event types.
- If unsure, consult package exports/types before adding APIs.

### Environment constraints
- **MUST NOT** use `createLiveVisualizer` in browser code.
- In browser builds, use main visualizer/collector APIs; `createLiveVisualizer` is Node-only.

### Export URLs
- **MUST** provide export provider either:
  - in visualizer options: `export.default`, or
  - per call: `viz.toUrl(..., { provider: ... })` / `toSvgUrl` / `toPngUrl` / `toPdfUrl`.
- **MUST NOT** assume PDF works with Kroki for Mermaid (use Mermaid.ink for PDF).

### Export provider compatibility (MUST)
- PDF export **MUST** use provider `"mermaid-ink"` unless package types confirm other providers support PDF.
- SVG/PNG may use other providers only when supported by types.

### Decision trackers
- When using `trackIf` / `trackSwitch`, agents **MUST** pass `emit: viz.handleDecisionEvent` (or collector equivalent) to capture decisions.
- Agents **MUST NOT** call decision trackers without `emit` when expecting visualization output.

---

## Canonical Snippets

### 1) Live capture while workflow runs
```typescript
import { createWorkflow } from "awaitly/workflow";
import { createVisualizer } from "awaitly-visualizer";

const viz = createVisualizer({ workflowName: "checkout" });
const workflow = createWorkflow("checkout", deps, { onEvent: viz.handleEvent });

const result = await workflow.run(async ({ step, deps }) => {
  const user = await step("fetchUser", () => deps.fetchUser("1"));
  return user;
});

const ascii = viz.render();
const mermaid = viz.renderAs("mermaid");
```

### 2) Post-hoc capture with collector
```typescript
import { createEventCollector, visualizeEvents } from "awaitly-visualizer";

const collector = createEventCollector({ workflowName: "checkout" });
const workflow = createWorkflow("checkout", deps, { onEvent: collector.handleEvent });

await workflow.run(async ({ step }) => {
  await step("op", () => deps.op());
});

const events = collector.getEvents();
const ascii = visualizeEvents(events, { workflowName: "checkout" });
const flow = collector.visualizeAs("flowchart"); // consult OutputFormat types
```

### 3) Combine handlers (visualize + logging/metrics)
```typescript
import { createVisualizer, combineEventHandlers } from "awaitly-visualizer";

const viz = createVisualizer({ workflowName: "checkout" });
const workflow = createWorkflow("checkout", deps, {
  onEvent: combineEventHandlers(viz.handleEvent, (e) => console.log(e.type)),
});
```

### 4) Decision tracking integration
```typescript
import { trackIf } from "awaitly-visualizer";

await workflow.run(async ({ step }) => {
  const decision = trackIf("discount-check", hasCoupon, {
    emit: viz.handleDecisionEvent,
  });
  if (decision.then) {
    await step("applyDiscount", () => deps.applyDiscount());
  }
});
```
> NOTE: `trackIf` signature may vary over time; consult package types. Invariant: use a stable string label and pass `emit`.

### 4b) Per-run event wiring (no workflow rebuild)
```typescript
await workflow.run(
  async ({ step, deps }) => {
    await step("op", () => deps.op());
  },
  { onEvent: viz.handleEvent }
);
```

### 5) Export URLs
```typescript
const viz = createVisualizer({
  workflowName: "checkout",
  export: { default: { provider: "mermaid-ink" } },
});

const svg = viz.toSvgUrl();
const png = viz.toPngUrl();
const pdf = viz.toPdfUrl(); // Mermaid.ink
```

---

## Deterministic Rewrites (Autofix Rules)

| See | Rewrite to |
|-----|------------|
| `workflow(...)` with visualizer wiring | `workflow.run(...)` and keep `onEvent` wiring on create/run config. |
| Decision tracker without `emit` | Add `emit: viz.handleDecisionEvent` (or collector handler). |
| `viz.toPdfUrl({ provider: "kroki" })` | Use Mermaid.ink provider for PDF. |
| Browser code calling `createLiveVisualizer()` | Replace with `createVisualizer()` + renderer output in UI. |
| Manual event array + ad hoc render logic | Use `createEventCollector()` or `visualizeEvents(events, options)`. |
| Rendering before events are captured | Execute workflow (or feed events) first; for pre-captured events use `visualizeEvents(events, options)`. |

---

## API Reference (Core)

Guaranteed core (use without checking types):
- `createVisualizer(options?)`
- `viz.handleEvent(event)`
- `viz.handleDecisionEvent(event)` (when using decision trackers)
- `viz.render()`
- `viz.renderAs(format)` (supported formats are typed)
- `viz.reset()`
- `combineEventHandlers(...)`
- `createEventCollector(options?)`
- `collector.handleEvent(event)`
- `collector.getEvents()`

Advanced / optional (**MUST** consult package types before use):
- `viz.handleScopeEvent(event)`
- `viz.onUpdate(cb)`
- `viz.getIR()`
- Collector helpers (`collector.getWorkflowEvents`, `collector.getDecisionEvents`, `collector.clear`, `collector.visualize`, `collector.visualizeAs`)
- HTML helpers (`htmlRenderer`, `renderToHTML`, `generateInteractiveHTML`)
- Time travel / performance tools
- `createLiveVisualizer()` (Node-only)
