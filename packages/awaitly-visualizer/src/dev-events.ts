/**
 * devEvents — stream workflow events into the awaitly dev inspector.
 *
 * Wire it to any workflow's onEvent and every run appears live in the
 * inspector page served by `awaitly-analyze --dev`:
 *
 * ```typescript
 * import { devEvents } from "awaitly-visualizer";
 *
 * const workflow = createWorkflow("checkout", deps, {
 *   onEvent: devEvents("http://localhost:4747"),
 * });
 * ```
 *
 * Events are batched per microtask and POSTed fire-and-forget; a dead or
 * absent inspector never affects the workflow.
 */

import type { WorkflowEvent } from "awaitly";

export function devEvents(url = "http://localhost:4747"): (event: WorkflowEvent<unknown, unknown>) => void {
  const endpoint = `${url.replace(/\/$/, "")}/events`;
  let batch: WorkflowEvent<unknown, unknown>[] = [];
  let scheduled = false;
  // Batches must reach the inspector in the order they were produced. Posting
  // them concurrently lets a later batch land first, and since the inspector
  // applies events in arrival order, a `step_start` arriving after its own
  // `step_success` leaves that step displayed as "running" forever. Chaining
  // keeps the order without making the workflow await anything.
  let inFlight: Promise<void> = Promise.resolve();

  const flush = () => {
    scheduled = false;
    if (batch.length === 0) return;
    const events = batch;
    batch = [];
    // Fire-and-forget: the inspector is a dev convenience, never a dependency.
    // Serialization can throw too (cyclic context, BigInt) — swallow both.
    try {
      const body = JSON.stringify(events, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
      );
      inFlight = inFlight.then(
        () =>
          fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          }).then(
            () => undefined,
            () => undefined
          )
      );
    } catch {
      // Drop the batch rather than affect the workflow.
    }
  };

  return (event) => {
    batch.push(event);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  };
}
