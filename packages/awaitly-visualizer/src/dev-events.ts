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

import type { WorkflowEvent } from "awaitly/workflow";

export function devEvents(url = "http://localhost:4747"): (event: WorkflowEvent<unknown, unknown>) => void {
  const endpoint = `${url.replace(/\/$/, "")}/events`;
  let batch: WorkflowEvent<unknown, unknown>[] = [];
  let scheduled = false;

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
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }).catch(() => {});
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
