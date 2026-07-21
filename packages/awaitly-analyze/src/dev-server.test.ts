/**
 * Dev server integration: analyze a real workflow file, serve its graph,
 * accept a run's events, and overlay the trace.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDevServer, type DevServer } from "./dev-server";

const WORKFLOW_SOURCE = `
  import { createWorkflow } from "awaitly/workflow";
  declare const fetchUser: (id: string) => Promise<any>;
  declare const charge: (u: any) => Promise<any>;

  const wf = createWorkflow("checkout", { fetchUser, charge });
  export async function runIt() {
    return await wf.run(async ({ step, deps }) => {
      const user = await step("fetchUser", () => deps.fetchUser("1"));
      return await step("charge", () => deps.charge(user));
    });
  }
`;

describe("dev server", () => {
  let dir: string;
  let dev: DevServer;

  // ts-morph analysis in startDevServer can exceed the default 10s hook
  // timeout when the whole suite runs in parallel.
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "awaitly-dev-"));
    writeFileSync(join(dir, "checkout.ts"), WORKFLOW_SOURCE);
    dev = await startDevServer({ file: join(dir, "checkout.ts"), port: 0 });
  }, 60_000);

  afterAll(async () => {
    await dev.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the inspector page", async () => {
    const res = await fetch(`http://localhost:${dev.port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("awaitly dev");
  });

  it("serves the static graph state", async () => {
    const res = await fetch(`http://localhost:${dev.port}/state`);
    const state = await res.json();
    expect(state.workflows).toHaveLength(1);
    expect(state.workflows[0].name).toBe("checkout");
    expect(state.workflows[0].mermaid).toContain("flowchart");
    expect(state.runs).toEqual([]);
  });

  it("accepts posted events and overlays the trace", async () => {
    const events = [
      { type: "workflow_start", workflowId: "run-1", workflowName: "checkout", ts: 1 },
      { type: "step_start", workflowId: "run-1", workflowName: "checkout", stepId: "fetchUser", name: "fetchUser", ts: 2 },
      { type: "step_success", workflowId: "run-1", workflowName: "checkout", stepId: "fetchUser", name: "fetchUser", ts: 3, durationMs: 1 },
    ];
    const post = await fetch(`http://localhost:${dev.port}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(events),
    });
    expect(post.status).toBe(204);

    const res = await fetch(`http://localhost:${dev.port}/state`);
    const state = await res.json();
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0].workflowName).toBe("checkout");
    expect(state.runs[0].trace.steps).toEqual([
      { stepId: "fetchUser", status: "success", durationMs: 1 },
    ]);
    expect(state.runs[0].mermaid).toContain("trace_success");
    expect(state.runs[0].unmatched).toEqual([]);
  });

  it("rejects malformed event payloads", async () => {
    const post = await fetch(`http://localhost:${dev.port}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(post.status).toBe(400);
  });

  it("rejects posts without a JSON content-type", async () => {
    const post = await fetch(`http://localhost:${dev.port}/events`, {
      method: "POST",
      body: JSON.stringify([]),
    });
    expect(post.status).toBe(415);
  });

  it("rejects cross-origin posts", async () => {
    const post = await fetch(`http://localhost:${dev.port}/events`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify([]),
    });
    expect(post.status).toBe(403);
  });

  it("rejects non-local Host headers (DNS rebinding)", async () => {
    // fetch/undici forbids overriding Host — use raw http.
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: dev.port, path: "/state", headers: { host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(421);
  });

  it("rejects oversized bodies with 413", async () => {
    const big = JSON.stringify([{ workflowId: "big", padding: "x".repeat(2 * 1024 * 1024) }]);
    const post = await fetch(`http://localhost:${dev.port}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: big,
    }).catch(() => undefined);
    // Either a clean 413 or a destroyed socket — never accepted.
    if (post) expect(post.status).toBe(413);
  });

  it("evicts oldest runs beyond the cap", async () => {
    const events = Array.from({ length: 60 }, (_, i) => ({
      type: "workflow_start",
      workflowId: `flood-${i}`,
      ts: i,
    }));
    const post = await fetch(`http://localhost:${dev.port}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(events),
    });
    expect(post.status).toBe(204);
    const state = await (await fetch(`http://localhost:${dev.port}/state`)).json();
    expect(state.runs.length).toBeLessThanOrEqual(50);
  });

  it("full loop: a real workflow streams itself in via devEvents", async () => {
    const { ok } = await import("awaitly");
    const { createWorkflow } = await import("awaitly/workflow");
    const { devEvents } = await import("awaitly-visualizer");

    const fetchUser = async (id: string) => ok({ id, premium: true });
    const charge = async (_u: unknown) => ok({ txId: "tx-1" });
    const workflow = createWorkflow(
      "checkout",
      { fetchUser, charge },
      { onEvent: devEvents(`http://localhost:${dev.port}`) }
    );

    const result = await workflow.run("live-run-1", async ({ step, deps }) => {
      const user = await step("fetchUser", () => deps.fetchUser("1"));
      if (step.if("premium-check", "user.premium", () => user.premium)) {
        return step("charge", () => deps.charge(user));
      }
      return undefined;
    });
    expect(result.ok).toBe(true);

    // devEvents flushes per microtask, fire-and-forget — poll until the run
    // (with all its events) lands rather than racing a fixed sleep.
    let run:
      | { workflowId: string; trace: { steps: Array<{ stepId: string; status: string }>; decisions: unknown[] } }
      | undefined;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const state = await (await fetch(`http://localhost:${dev.port}/state`)).json();
      run = state.runs.find((r: { workflowId: string }) => r.workflowId === "live-run-1");
      if (
        run &&
        run.trace.steps.length >= 2 &&
        run.trace.decisions.length >= 1 &&
        run.trace.steps.every((s) => s.status !== "running")
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(run).toBeDefined();
    expect(run!.trace.steps.map((s) => [s.stepId, s.status])).toEqual([
      ["fetchUser", "success"],
      ["charge", "success"],
    ]);
    expect(run!.trace.decisions).toEqual([
      { decisionId: "premium-check", branch: "then", label: "user.premium" },
    ]);
  });
});
