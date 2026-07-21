/**
 * devEvents must never let inspector plumbing affect the workflow:
 * fetch failures AND serialization failures are swallowed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowEvent } from "awaitly/workflow";
import { devEvents } from "./dev-events";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("devEvents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts batched events to the inspector", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const handler = devEvents("http://localhost:9999");
    handler({ type: "workflow_start", workflowId: "r1", ts: 1 } as WorkflowEvent<unknown, unknown>);
    handler({ type: "workflow_success", workflowId: "r1", ts: 2, durationMs: 1 } as WorkflowEvent<unknown, unknown>);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:9999/events");
    expect(JSON.parse(init.body as string)).toHaveLength(2);
  });

  it("survives a cyclic context without throwing", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    const handler = devEvents("http://localhost:9999");
    handler({ type: "workflow_start", workflowId: "r1", ts: 1, context: cyclic } as WorkflowEvent<unknown, unknown>);
    await expect(flushMicrotasks()).resolves.toBeUndefined();
    // Batch was dropped, not thrown.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serializes BigInt values instead of throwing", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const handler = devEvents("http://localhost:9999");
    handler({ type: "workflow_start", workflowId: "r1", ts: 1, context: { n: 10n } } as WorkflowEvent<unknown, unknown>);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body as string).toContain('"10"');
  });

  it("survives a rejecting fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("connection refused"))));

    const handler = devEvents("http://localhost:9999");
    handler({ type: "workflow_start", workflowId: "r1", ts: 1 } as WorkflowEvent<unknown, unknown>);
    await expect(flushMicrotasks()).resolves.toBeUndefined();
  });
});
