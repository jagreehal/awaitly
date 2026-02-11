/**
 * Tests for the class-based Workflow API (extend Workflow, override run, execute).
 */
import { describe, it, expect } from "vitest";
import { ok, err, type Result } from "../core";
import {
  WorkflowClass,
  type RunStep,
  type WorkflowRunEvent,
  type ErrorsOfDeps,
  isWorkflowCancelled,
} from "./index";
import type { UnexpectedError } from "../core";

// Minimal deps for tests
const fetchUser = async (id: string): Promise<Result<{ id: string; name: string }, "NOT_FOUND">> =>
  id === "1" ? ok({ id, name: "Alice" }) : err("NOT_FOUND");

const fetchPosts = async (_userId: string): Promise<Result<{ title: string }[], never>> =>
  ok([{ title: "Hello" }]);

const deps = { fetchUser, fetchPosts };
type Deps = typeof deps;
type E = ErrorsOfDeps<Deps>;

describe("Workflow class", () => {
  it("executes run() and returns result with payload", async () => {
    class GetUserWorkflow extends WorkflowClass<Deps, E, UnexpectedError> {
      async run(
        event: WorkflowRunEvent<{ userId: string }>,
        step: RunStep<E>
      ): Promise<{ user: { id: string; name: string }; posts: { title: string }[] }> {
        const user = await step("fetchUser", () => this.deps.fetchUser(event.payload.userId));
        const posts = await step("fetchPosts", () => this.deps.fetchPosts(user.id));
        return { user, posts };
      }
    }

    const w = new GetUserWorkflow("get-user", deps);
    const result = await w.execute<{ user: { id: string; name: string }; posts: { title: string }[] }, { userId: string }>(
      { userId: "1" }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user).toEqual({ id: "1", name: "Alice" });
      expect(result.value.posts).toEqual([{ title: "Hello" }]);
    }
  });

  it("executes with typed payload via event.payload", async () => {
    class GetUserByIdWorkflow extends WorkflowClass<Deps, E, UnexpectedError> {
      async run(
        event: WorkflowRunEvent<{ userId: string }>,
        step: RunStep<E>
      ): Promise<{ id: string; name: string }> {
        const user = await step("fetchUser", () => this.deps.fetchUser(event.payload.userId));
        return user;
      }
    }

    const w = new GetUserByIdWorkflow("get-user-by-id", deps);
    const result = await w.execute<{ id: string; name: string }, { userId: string }>(
      { userId: "1" }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ id: "1", name: "Alice" });
    }
  });

  it("exposes getSnapshot and snapshot property after execution", async () => {
    class SnapshotWorkflow extends WorkflowClass<Deps, E, UnexpectedError> {
      async run(
        event: WorkflowRunEvent<{ userId: string }>,
        step: RunStep<E>
      ): Promise<string> {
        const user = await step("fetchUser", () => this.deps.fetchUser(event.payload.userId), { key: "user:1" });
        return user.name;
      }
    }

    const w = new SnapshotWorkflow("snapshot-demo", deps);
    await w.execute<string, { userId: string }>({ userId: "1" });

    // Test both getSnapshot() method and snapshot property
    const snapshot1 = w.getSnapshot();
    const snapshot2 = w.snapshot;

    expect(snapshot1.formatVersion).toBe(1);
    expect(snapshot1.steps).toBeDefined();
    expect(Object.keys(snapshot1.steps).length).toBeGreaterThan(0);
    expect(snapshot1.execution.status).toBe("completed");

    expect(snapshot2).toEqual(snapshot1); // Property should return same as method
  });

  it("subscribe receives step_complete and workflow_complete", async () => {
    const events: { type: string; stepId?: string }[] = [];
    class SubscribeWorkflow extends WorkflowClass<Deps, E, UnexpectedError> {
      async run(
        event: WorkflowRunEvent<{ userId: string }>,
        step: RunStep<E>
      ): Promise<number> {
        const user = await step("fetchUser", () => this.deps.fetchUser(event.payload.userId), { key: "u" });
        return user.id.length;
      }
    }

    const w = new SubscribeWorkflow("subscribe-demo", deps);
    const unsub = w.subscribe((evt) => {
      events.push({ type: evt.type, stepId: evt.stepId });
    });
    await w.execute<number, { userId: string }>({ userId: "1" });
    unsub();

    expect(events.some((e) => e.type === "step_complete")).toBe(true);
    expect(events.some((e) => e.type === "workflow_complete")).toBe(true);
  });

  it("supports step.try and step.sleep", async () => {
    const parseSafe = async (
      s: string
    ): Promise<Result<number, "PARSE_ERROR">> => {
      const n = parseInt(s, 10);
      if (Number.isNaN(n)) return err("PARSE_ERROR");
      return ok(n);
    };
    const depsWithParse = { ...deps, parseSafe };
    type DepsWithParse = typeof depsWithParse;
    type E2 = ErrorsOfDeps<DepsWithParse>;

    class TryAndSleepWorkflow extends WorkflowClass<DepsWithParse, E2, UnexpectedError> {
      async run(
        event: WorkflowRunEvent<{ input: string }>,
        step: RunStep<E2>
      ): Promise<number> {
        const n = await step("parse", () => this.deps.parseSafe(event.payload.input), { key: "parse:42" });
        await step.sleep("delay", "1ms", { key: "delay" });
        return n;
      }
    }

    const w = new TryAndSleepWorkflow("try-sleep", depsWithParse);
    const result = await w.execute<number, { input: string }>({ input: "42" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it("constructor accepts optional env and exposes this.env", async () => {
    type Env = { prefix: string };
    class EnvWorkflow extends WorkflowClass<Deps, E, UnexpectedError, Env> {
      async run(
        event: WorkflowRunEvent<{ userId: string }>,
        step: RunStep<E>
      ): Promise<string> {
        const user = await step("fetchUser", () => this.deps.fetchUser(event.payload.userId));
        return (this.env?.prefix ?? "") + user.name;
      }
    }

    const w = new EnvWorkflow("env-demo", deps, undefined, { prefix: "Hello, " });
    const result = await w.execute<string, { userId: string }>({ userId: "1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("Hello, Alice");
  });

  it("throws if name is empty", () => {
    class BadWorkflow extends WorkflowClass<Deps, E, UnexpectedError> {
      async run(
        _event: WorkflowRunEvent,
        _step: RunStep<E>
      ): Promise<void> {
        return undefined;
      }
    }
    expect(() => new BadWorkflow("", deps)).toThrow(/name must be a non-empty string/);
  });

  it("event contains instanceId and timestamp", async () => {
    let capturedEvent: WorkflowRunEvent<{ test: string }> | null = null;
    class EventInspectorWorkflow extends WorkflowClass<Deps, E, UnexpectedError> {
      async run(
        event: WorkflowRunEvent<{ test: string }>,
        step: RunStep<E>
      ): Promise<string> {
        capturedEvent = event;
        await step("noop", () => this.deps.fetchUser("1"));
        return "ok";
      }
    }

    const w = new EventInspectorWorkflow("event-inspector", deps);
    await w.execute<string, { test: string }>({ test: "value" });

    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent!.payload).toEqual({ test: "value" });
    expect(capturedEvent!.instanceId).toBeDefined();
    expect(typeof capturedEvent!.instanceId).toBe("string");
    expect(capturedEvent!.timestamp).toBeDefined();
    expect(typeof capturedEvent!.timestamp).toBe("number");
  });

  it("execute signal overrides constructor signal", async () => {
    class SignalWorkflow extends WorkflowClass<Deps, E, UnexpectedError> {
      async run(
        event: WorkflowRunEvent<{ userId: string }>,
        step: RunStep<E>
      ): Promise<string> {
        const user = await step("fetchUser", () => this.deps.fetchUser(event.payload.userId));
        return user.name;
      }
    }

    const constructorSignal = new AbortController();
    const executionSignal = new AbortController();
    executionSignal.abort("cancel per run");

    const w = new SignalWorkflow("signal-override", deps, {
      signal: constructorSignal.signal,
    });

    const result = await w.execute<string, { userId: string }>(
      { userId: "1" },
      { signal: executionSignal.signal }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isWorkflowCancelled(result.cause)).toBe(true);
      if (isWorkflowCancelled(result.cause)) {
        expect(result.cause.reason).toBe("cancel per run");
      }
    }
  });

  it("event.signal falls back to constructor signal when execute signal is omitted", async () => {
    let capturedSignal: AbortSignal | undefined;

    class EventSignalWorkflow extends WorkflowClass<Deps, E, UnexpectedError> {
      async run(
        event: WorkflowRunEvent<{ userId: string }>,
        step: RunStep<E>
      ): Promise<string> {
        capturedSignal = event.signal;
        const user = await step("fetchUser", () => this.deps.fetchUser(event.payload.userId));
        return user.name;
      }
    }

    const constructorSignal = new AbortController();
    const w = new EventSignalWorkflow("event-signal-fallback", deps, {
      signal: constructorSignal.signal,
    });

    const result = await w.execute<string, { userId: string }>({ userId: "1" });
    expect(result.ok).toBe(true);
    expect(capturedSignal).toBe(constructorSignal.signal);
  });
});
