/**
 * `maxIterations` bounds the diagram's path count. It also stops the loop, and
 * stopping quietly meant a collection longer than the bound lost its tail while
 * the workflow reported success: 501 payments in, 500 submitted, Ok returned.
 *
 * Erroring is the default. Truncation stays available for the cases that want
 * it, spelled out at the call site.
 */

import { describe, expect, it } from "vitest";
import { ok, type AsyncResult } from "./core";
import { isIterationLimitError } from "./errors";
import { createWorkflow } from "./workflow";

const deps = {
  submit: async (n: number): AsyncResult<number, never> => ok(n),
};

function runOver(
  items: number[],
  forEachOptions: Record<string, unknown>
): Promise<{ ok: boolean; error?: unknown; seen: number[] }> {
  const seen: number[] = [];
  const wf = createWorkflow("limit", {
    submit: async (n: number): AsyncResult<number, never> => {
      seen.push(n);
      return ok(n);
    },
  });

  return wf
    .run(async ({ step, deps: d }) => {
      await step.forEach("submitAll", items, {
        stepIdPattern: "submit-{i}",
        ...forEachOptions,
        run: async (n: number) => step("submit", () => d.submit(n)),
      });
      return "complete" as const;
    })
    .then((result) => ({
      ok: result.ok,
      error: result.ok ? undefined : result.error,
      seen,
    }));
}

describe("step.forEach maxIterations", () => {
  it("fails when the collection is longer than the bound", async () => {
    const items = Array.from({ length: 501 }, (_, i) => i);
    const result = await runOver(items, { maxIterations: 500 });

    expect(result.ok).toBe(false);
  });

  it("names the limit and the overrun so the message is actionable", async () => {
    const items = Array.from({ length: 501 }, (_, i) => i);
    const result = await runOver(items, { maxIterations: 500 });

    const cause = (result.error as { cause?: unknown })?.cause ?? result.error;
    expect(isIterationLimitError(cause)).toBe(true);
    expect(String((cause as Error).message)).toContain("500");
  });

  it("allows a collection exactly at the bound", async () => {
    const items = Array.from({ length: 500 }, (_, i) => i);
    const result = await runOver(items, { maxIterations: 500 });

    expect(result.ok).toBe(true);
    expect(result.seen).toHaveLength(500);
  });

  it("still truncates when the caller asks for it", async () => {
    const items = Array.from({ length: 501 }, (_, i) => i);
    const result = await runOver(items, {
      maxIterations: 500,
      onMaxIterations: "stop",
    });

    expect(result.ok).toBe(true);
    expect(result.seen).toHaveLength(500);
  });

  it("leaves an unbounded loop alone", async () => {
    const items = Array.from({ length: 3 }, (_, i) => i);
    const result = await runOver(items, {});

    expect(result.ok).toBe(true);
    expect(result.seen).toHaveLength(3);
  });
});

void deps;
