import { describe, it, expect, vi, afterEach } from "vitest";
import { createDiscordNotifier } from "./discord";
import type { WorkflowIR } from "../types";

describe("createDiscordNotifier", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders duration as 0ms when startTs equals endTs", async () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        startTs: 10,
        endTs: 10,
        durationMs: 0,
        children: [],
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

    const durationField = body.embeds[0].fields?.find((field) => field.name === "Duration");
    expect(durationField?.value).toBe("0ms");
  });
});
