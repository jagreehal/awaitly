# awaitly-visualizer

Visualization and rendering for [awaitly](https://github.com/jagreehal/awaitly) workflows: Mermaid diagrams, ASCII art, HTML, export URLs (Kroki / Mermaid.ink), and notifiers (Slack, Discord, webhook).

## Installation

```bash
npm install awaitly-visualizer awaitly
# or
pnpm add awaitly-visualizer awaitly
# or
yarn add awaitly-visualizer awaitly
```

## Quick Start

```ts
import { createWorkflow } from "awaitly/workflow";
import { createVisualizer } from "awaitly-visualizer";

const viz = createVisualizer({ workflowName: "checkout" });

const workflow = createWorkflow(
  "checkout",
  { validateCart, processPayment },
  { onEvent: viz.handleEvent }
);

await workflow(async ({ step, deps: { validateCart, processPayment } }) => {
  await step("Validate cart", () => validateCart(cart));
  await step("Process payment", () => processPayment(payment));
  return result;
});

console.log(viz.render());        // ASCII (default)
console.log(viz.renderAs("mermaid"));  // Mermaid flowchart
```

## Output Formats

Use `renderAs(format)` for:

| Format     | Description                    |
| ---------- | ------------------------------ |
| `ascii`    | Terminal-friendly box diagram (default) |
| `mermaid`  | Mermaid flowchart source       |
| `json`     | Workflow IR as JSON            |
| `logger`   | Step-by-step log style         |
| `flowchart`| Alternative flowchart text     |

```ts
viz.renderAs("mermaid");  // "flowchart LR\n  ..."
viz.renderAs("json");    // JSON string of workflow IR
```

## Export URLs (SVG, PNG, PDF)

Generate image/PDF URLs from the current diagram using Kroki or Mermaid.ink. Pass a provider when calling, or set a default in options:

```ts
const viz = createVisualizer({
  workflowName: "checkout",
  export: {
    default: { provider: "kroki" },  // or "mermaid-ink"
  },
});

// After running the workflow:
const svgUrl = viz.toSvgUrl();
const pngUrl = viz.toPngUrl();
const pdfUrl = viz.toPdfUrl();  // mermaid-ink only; Kroki does not support PDF for mermaid

// Or pass provider per call:
viz.toSvgUrl({ provider: "mermaid-ink" });
viz.toUrl("png", { provider: "kroki" });
```

- **Kroki**: SVG and PNG for Mermaid. Use subpath `awaitly-visualizer/kroki-fetch` for Node-only fetching (e.g. server-side image generation).
- **Mermaid.ink**: SVG, PNG, JPEG, WebP, PDF. Browser and Node safe.

## HTML Renderer

Render workflow state to HTML (e.g. for dashboards or reports):

```ts
import { htmlRenderer, renderToHTML } from "awaitly-visualizer";

const html = htmlRenderer();
const markup = html.render(viz.getIR(), renderOptions);

// Or use the helper with default options:
const doc = renderToHTML(viz.getIR(), { title: "Checkout workflow" });
```

## Event Collection and Post-Hoc Visualization

Collect events and visualize later, or combine with other handlers:

```ts
import { createEventCollector, visualizeEvents, combineEventHandlers } from "awaitly-visualizer";

// Option 1: Event collector
const collector = createEventCollector({ workflowName: "checkout" });
const workflow = createWorkflow("checkout", deps, {
  onEvent: collector.handleEvent,
});
await workflow(async ({ step }) => { /* ... */ });
console.log(collector.visualize());
console.log(collector.visualizeAs("mermaid"));

// Option 2: Visualize a list of events
const events = []; // push from onEvent
const workflow2 = createWorkflow("checkout", deps, { onEvent: (e) => events.push(e) });
await workflow2(async ({ step }) => { /* ... */ });
console.log(visualizeEvents(events, { workflowName: "checkout" }));

// Option 3: Combine visualization with logging or metrics
const viz = createVisualizer({ workflowName: "checkout" });
const workflow3 = createWorkflow("checkout", deps, {
  onEvent: combineEventHandlers(viz.handleEvent, (e) => console.log(e.type)),
});
```

## Decision Tracking (Conditional Branches)

Track `trackIf` / `trackSwitch` decision events so branches appear in the visualization. Emit decision events into the same visualizer or collector:

```ts
import { createVisualizer, trackIf, trackSwitch } from "awaitly-visualizer";

const viz = createVisualizer({ workflowName: "checkout" });

await workflow(async ({ step }) => {
  const decision = trackIf("discount-check", hasCoupon, {
    emit: viz.handleDecisionEvent,
  });
  if (decision.then) {
    await step("Apply discount", () => applyDiscount(percent));
  }
  // ...
});
```

## Time-Travel and Performance Analysis

- **Time-travel**: `createTimeTravelController` for replay and stepping through recorded workflow events.
- **Performance**: `createPerformanceAnalyzer` and `getHeatLevel` for step timing and hot-spot visualization (e.g. heatmap in HTML/ASCII).

## Live Terminal Visualization (Node only)

In Node, use a live-updating terminal view:

```ts
import { createLiveVisualizer } from "awaitly-visualizer";

const live = createLiveVisualizer();  // uses process.stdout
const workflow = createWorkflow("checkout", deps, {
  onEvent: live.handleEvent,
});
await workflow(async ({ step }) => { /* ... */ });
```

Not available in browser builds; use the main entry in browsers.

## Notifiers (Slack, Discord, Webhook)

Send workflow status or diagrams to Slack, Discord, or a generic webhook. Use subpath imports so you don’t pull in unused dependencies:

```ts
import { createSlackNotifier } from "awaitly-visualizer/notifiers/slack";
import { createDiscordNotifier } from "awaitly-visualizer/notifiers/discord";
import { createWebhookNotifier } from "awaitly-visualizer/notifiers/webhook";
```

Each notifier can be wired to workflow events (e.g. completion, failure) and can include diagram URLs (Kroki/Mermaid.ink) in messages. See the notifier types and options in the package exports.

## Subpath Exports

| Subpath                        | Purpose                          |
| ------------------------------ | --------------------------------- |
| `awaitly-visualizer`               | Main API (visualizer, renderers, etc.) |
| `awaitly-visualizer/kroki-fetch`   | Node-only Kroki fetch (e.g. server-side image fetch) |
| `awaitly-visualizer/notifiers/slack`   | Slack notifier (optional `@slack/web-api`) |
| `awaitly-visualizer/notifiers/discord` | Discord notifier                  |
| `awaitly-visualizer/notifiers/webhook` | Generic webhook notifier          |
| `awaitly-visualizer/devtools`      | DevTools integration (browser)   |

In bundlers that respect `exports`, use the main entry for Node and the **browser** conditional for browser builds (e.g. `awaitly-visualizer` → browser build excludes `createLiveVisualizer` and uses a stub; export URL helpers are browser-safe).

## Requirements

- Node.js >= 22
- **Peer dependency**: `awaitly` (workspace ^ or same major)

Optional:

- `@slack/web-api` for the Slack notifier (optional dependency).

## License

MIT
