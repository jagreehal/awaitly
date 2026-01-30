import { describe, it, expect, vi, afterEach } from "vitest";
import { createWebhookAdapter } from "./adapters/webhook";
import type { WorkflowIR } from "../types";

describe("Webhook adapter update event types", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves workflow.complete when sending a final update", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({}),
    }));

    vi.stubGlobal("fetch", fetchMock);

    const adapter = createWebhookAdapter({
      url: "https://example.com/webhook",
      includeDiagramUrl: false,
    });

    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        startTs: 0,
        endTs: 1,
        durationMs: 1,
        children: [],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const message = adapter.buildMessage(
      { ir, title: "Workflow", status: "completed" },
      {
        getDiagramUrl: () => "",
        countSteps: () => 0,
        formatDuration: () => "1ms",
      }
    );

    await adapter.sendUpdate("msg-1", message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = fetchMock.mock.calls[0]?.[1] as { body?: string };
    const payload = JSON.parse(options?.body ?? "{}") as { event: string };

    expect(payload.event).toBe("workflow.complete");
  });
});
