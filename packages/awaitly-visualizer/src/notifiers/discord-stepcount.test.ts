import { describe, it, expect, vi, afterEach } from "vitest";
import { createDiscordNotifier } from "./discord";
import type { WorkflowIR } from "../types";

describe("createDiscordNotifier step count", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts nested steps, not just top-level nodes", async () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-steps",
        workflowId: "wf-steps",
        state: "success",
        startTs: 0,
        endTs: 1,
        children: [
          {
            type: "parallel",
            id: "parallel-1",
            state: "success",
            startTs: 0,
            endTs: 1,
            durationMs: 1,
            mode: "all",
            children: [
              {
                type: "step",
                id: "step-1",
                name: "first",
                state: "success",
                startTs: 0,
                endTs: 1,
                durationMs: 1,
              },
              {
                type: "step",
                id: "step-2",
                name: "second",
                state: "success",
                startTs: 0,
                endTs: 1,
                durationMs: 1,
              },
            ],
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "1" }),
      text: async () => "",
    })) as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    const notifier = createDiscordNotifier({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      diagramProvider: { provider: "kroki" },
    });

    await notifier.notify(ir, { title: "Test" });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
      embeds: Array<{ fields?: Array<{ name: string; value: string }> }>;
    };

    const stepsField = body.embeds[0].fields?.find((field) => field.name === "Steps");
    expect(stepsField?.value).toBe("2");
  });
});
