import { describe, expect, it, vi, afterEach } from "vitest";
import { devEvents } from "./dev-events";
import type { WorkflowEvent } from "awaitly";

/**
 * Regression: batches were POSTed concurrently, so a later batch could reach
 * the inspector first. The inspector applies events in arrival order, so a
 * `step_start` landing after its own `step_success` left that step displayed as
 * "running" forever — which showed up as a ~1-in-3 flake in the dev-server
 * integration test.
 */
const evt = (stepKey: string, type: string): WorkflowEvent<unknown, unknown> =>
  ({ type, stepKey, workflowId: "w", ts: 0 }) as unknown as WorkflowEvent<unknown, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("devEvents delivery order", () => {
  it("posts batches in the order they were produced, even when an early POST is slow", async () => {
    const arrived: string[][] = [];
    let resolveFirst: (() => void) | undefined;

    const fetchMock = vi.fn((_url: string, init: { body: string }) => {
      const keys = (JSON.parse(init.body) as Array<{ stepKey: string }>).map((e) => e.stepKey);
      arrived.push(keys);
      // Stall the first POST so an unordered implementation lets the second win.
      if (arrived.length === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = () => resolve({ ok: true } as Response);
        });
      }
      return Promise.resolve({ ok: true } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const send = devEvents("http://inspector.test");

    send(evt("charge", "step_start"));
    await Promise.resolve(); // flush batch 1
    send(evt("charge", "step_success"));
    await new Promise((r) => setTimeout(r, 10));

    // The second batch must not have been sent while the first is in flight.
    expect(arrived).toEqual([["charge"]]);

    resolveFirst?.();
    await new Promise((r) => setTimeout(r, 10));

    expect(arrived).toEqual([["charge"], ["charge"]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps delivering after a failed POST", async () => {
    const sent: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: { body: string }) => {
        const keys = (JSON.parse(init.body) as Array<{ stepKey: string }>).map((e) => e.stepKey);
        sent.push(...keys);
        return sent.length === 1
          ? Promise.reject(new Error("inspector down"))
          : Promise.resolve({ ok: true } as Response);
      })
    );

    const send = devEvents();
    send(evt("a", "step_start"));
    await new Promise((r) => setTimeout(r, 5));
    send(evt("b", "step_start"));
    await new Promise((r) => setTimeout(r, 5));

    // A dead inspector must never stall or break the chain.
    expect(sent).toEqual(["a", "b"]);
  });
});
