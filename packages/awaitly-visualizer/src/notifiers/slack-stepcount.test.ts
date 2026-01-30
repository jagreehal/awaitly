import { describe, it, expect } from "vitest";
import { createSlackNotifier } from "./slack";
import type { WorkflowIR } from "../types";

const makeIr = (): WorkflowIR => ({
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
});

describe("createSlackNotifier step count", () => {
  it("counts nested steps, not just top-level nodes", async () => {
    const ir = makeIr();

    let capturedBlocks: Array<{ type: string; text?: { text: string } }> | undefined;

    const client = {
      chat: {
        postMessage: async (message: { blocks?: Array<{ type: string; text?: { text: string } }>; }) => {
          capturedBlocks = message.blocks;
          return { ok: true, ts: "1" } as unknown as { ok: boolean; ts?: string; error?: string };
        },
        update: async () => ({ ok: true }) as unknown as { ok: boolean; error?: string },
      },
    };

    const notifier = createSlackNotifier(
      {
        token: "x",
        channel: "#test",
        diagramProvider: { provider: "kroki" },
      },
      { client }
    );

    await notifier.notify(ir, { title: "Test" });

    const section = capturedBlocks?.find((block) => block.type === "section");
    const text = section?.text?.text ?? "";
    expect(text).toContain("*Steps:* 2");
  });
});
