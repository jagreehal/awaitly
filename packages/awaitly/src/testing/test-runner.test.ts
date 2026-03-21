import { describe, it, expect } from "vitest";
import { testWorkflow } from "./test-runner";
import { ok, err } from "../core";
import type { AsyncResult } from "../core";

// =============================================================================
// Test Deps
// =============================================================================

const getUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> =>
  id === "unknown" ? err("NOT_FOUND") : ok({ id, name: "Alice" });

const getPosts = async (userId: string): AsyncResult<{ id: number; title: string }[], "FETCH_ERROR"> =>
  ok([{ id: 1, title: `Post by ${userId}` }]);

type FailError = { type: "FAIL"; message: string };
const failStep = async (): AsyncResult<never, FailError> =>
  err({ type: "FAIL", message: "failed" } satisfies FailError);

// =============================================================================
// Tests
// =============================================================================

describe("testWorkflow", () => {
  it("happy path: captures result, steps, and events", async () => {
    const { result, steps, stepOrder, events, durationMs } = await testWorkflow(
      { getUser, getPosts },
      async ({ step, deps: { getUser, getPosts } }) => {
        const user = await step("user", () => getUser("1"));
        const posts = await step("posts", () => getPosts(user.id));
        return { user, posts };
      },
    );

    // Final result is ok
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user).toEqual({ id: "1", name: "Alice" });
      expect(result.value.posts).toEqual([{ id: 1, title: "Post by 1" }]);
    }

    // Steps are captured
    expect(steps["user"]).toBeDefined();
    expect(steps["user"].result.ok).toBe(true);
    expect(steps["user"].output).toEqual({ id: "1", name: "Alice" });
    expect(steps["user"].durationMs).toBeGreaterThanOrEqual(0);

    expect(steps["posts"]).toBeDefined();
    expect(steps["posts"].result.ok).toBe(true);

    // Step order is correct
    expect(stepOrder).toEqual(["user", "posts"]);

    // Events are captured
    expect(events.length).toBeGreaterThan(0);

    // Duration is non-negative
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it("error path: captures step failure", async () => {
    const { result, steps, events } = await testWorkflow(
      { getUser, failStep },
      async ({ step, deps: { getUser, failStep } }) => {
        const user = await step("user", () => getUser("1"));
        await step("fail", () => failStep());
        return user;
      },
    );

    // Final result is err
    expect(result.ok).toBe(false);

    // The user step succeeded
    expect(steps["user"]).toBeDefined();
    expect(steps["user"].result.ok).toBe(true);

    // The fail step was captured with an error result
    expect(steps["fail"]).toBeDefined();
    expect(steps["fail"].result.ok).toBe(false);

    // Events include both step starts and the error
    expect(events.length).toBeGreaterThan(0);
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("workflow_start");
    expect(eventTypes).toContain("step_start");
  });

  it("step order matches execution sequence", async () => {
    const stepA = async (): AsyncResult<string, never> => ok("a");
    const stepB = async (): AsyncResult<string, never> => ok("b");
    const stepC = async (): AsyncResult<string, never> => ok("c");

    const { stepOrder } = await testWorkflow(
      { stepA, stepB, stepC },
      async ({ step, deps: { stepA, stepB, stepC } }) => {
        await step("first", () => stepA());
        await step("second", () => stepB());
        await step("third", () => stepC());
        return "done";
      },
    );

    expect(stepOrder).toEqual(["first", "second", "third"]);
  });

  it("duration is non-negative", async () => {
    const noop = async (): AsyncResult<string, never> => ok("ok");

    const { durationMs } = await testWorkflow(
      { noop },
      async ({ step, deps: { noop } }) => {
        await step("noop", () => noop());
        return "done";
      },
    );

    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it("events array is non-empty and contains expected event types", async () => {
    const noop = async (): AsyncResult<string, never> => ok("ok");

    const { events } = await testWorkflow(
      { noop },
      async ({ step, deps: { noop } }) => {
        await step("noop", () => noop());
        return "done";
      },
    );

    expect(events.length).toBeGreaterThan(0);
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("workflow_start");
    expect(eventTypes).toContain("workflow_success");
  });

  it("signal: AbortSignal.abort() triggers cancellation", async () => {
    const slowStep = async (): AsyncResult<string, never> => ok("ok");

    const { result } = await testWorkflow(
      { slowStep },
      async ({ step, deps: { slowStep } }) => {
        await step("step1", () => slowStep());
        return "done";
      },
      { signal: AbortSignal.abort("cancelled") },
    );

    // With a pre-aborted signal, the workflow should return an error
    expect(result.ok).toBe(false);
  });
});
