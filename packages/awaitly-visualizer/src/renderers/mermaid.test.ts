import { describe, it, expect } from "vitest";
import { mermaidRenderer, defaultColorScheme } from "./index";
import type { RenderOptions, WorkflowIR } from "../types";

describe("mermaidRenderer", () => {
  it("uses unique branch IDs when labels sanitize to the same value", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        startTs: 0,
        endTs: 1,
        children: [
          {
            type: "decision",
            id: "decision-1",
            key: "my-decision",
            state: "success",
            branches: [
              { label: "a-b", taken: true, children: [] },
              { label: "a b", taken: false, children: [] },
            ],
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const options: RenderOptions = {
      showTimings: false,
      showKeys: false,
      terminalWidth: 80,
      colors: defaultColorScheme,
    };

    const output = mermaidRenderer().render(ir, options);
    const branchLines = output
      .split("\n")
      .filter((line) => line.includes("decision_my_decision_") && line.includes("[") && !line.includes("hook_"));

    const branchIds = branchLines
      .map((line) => line.match(/\s*(decision_my_decision_[A-Za-z0-9_]+)\[/)?.[1])
      .filter((id): id is string => Boolean(id));

    const uniqueIds = new Set(branchIds);
    expect(uniqueIds.size).toBe(2);
  });

  it("marks non-step race winner branches as winner", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-2",
        workflowId: "wf-2",
        state: "success",
        startTs: 0,
        endTs: 1,
        children: [
          {
            type: "race",
            id: "race-1",
            state: "success",
            startTs: 0,
            endTs: 1,
            durationMs: 1,
            winnerId: "parallel-1",
            children: [
              {
                type: "parallel",
                id: "parallel-1",
                state: "success",
                startTs: 0,
                endTs: 1,
                durationMs: 1,
                mode: "all",
                children: [],
              },
              {
                type: "step",
                id: "step-1",
                state: "aborted",
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

    const options: RenderOptions = {
      showTimings: false,
      showKeys: false,
      terminalWidth: 80,
      colors: defaultColorScheme,
    };

    const output = mermaidRenderer().render(ir, options);

    expect(output).toContain("Winner");
  });

  it("ensures decision node IDs are unique even with duplicate keys", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-3",
        workflowId: "wf-3",
        state: "success",
        startTs: 0,
        endTs: 1,
        children: [
          {
            type: "decision",
            id: "decision-a",
            key: "dup-key",
            state: "success",
            branches: [{ label: "if", taken: true, children: [] }],
          },
          {
            type: "decision",
            id: "decision-b",
            key: "dup-key",
            state: "success",
            branches: [{ label: "if", taken: true, children: [] }],
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const options: RenderOptions = {
      showTimings: false,
      showKeys: false,
      terminalWidth: 80,
      colors: defaultColorScheme,
    };

    const output = mermaidRenderer().render(ir, options);
    const decisionNodes = output
      .split("\n")
      .filter((line) => line.includes("decision_dup_key") && line.includes("{\""));

    const ids = decisionNodes
      .map((line) => line.match(/\s*(decision_dup_key\w*)\{"/)?.[1])
      .filter((id): id is string => Boolean(id));

    expect(new Set(ids).size).toBe(2);
  });

  it("ensures step IDs are unique when keys repeat", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-4",
        workflowId: "wf-4",
        state: "success",
        startTs: 0,
        endTs: 1,
        children: [
          {
            type: "step",
            id: "step-1",
            key: "dup",
            state: "success",
            startTs: 0,
            endTs: 1,
            durationMs: 1,
          },
          {
            type: "step",
            id: "step-2",
            key: "dup",
            state: "success",
            startTs: 1,
            endTs: 2,
            durationMs: 1,
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const options: RenderOptions = {
      showTimings: false,
      showKeys: false,
      terminalWidth: 80,
      colors: defaultColorScheme,
    };

    const output = mermaidRenderer().render(ir, options);
    const stepLines = output
      .split("\n")
      .filter((line) => line.includes("step_dup") && line.includes("[\""));

    const ids = stepLines
      .map((line) => line.match(/\s*(step_dup\w*)\[/)?.[1])
      .filter((id): id is string => Boolean(id));

    expect(new Set(ids).size).toBe(2);
  });
});
