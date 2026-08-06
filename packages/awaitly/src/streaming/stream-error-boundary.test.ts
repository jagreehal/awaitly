/**
 * A failing stream is infrastructure failing, not a bug.
 *
 * `reader.read()` models a read failure as a Result, but iterating a reader —
 * via for-await, a transformer, or collect() — turns it back into a throw. That
 * throw used to reach the workflow boundary and get wrapped in UnexpectedError,
 * filing "the stream store is down" under "there is a bug in your code".
 *
 * Stream errors now arrive as values, the same treatment STEP_TIMEOUT gets.
 */
import { describe, it, expect } from "vitest";
import { ok, err, createWorkflow, isUnexpectedError, type AsyncResult } from "../index";
import { collect, pipe, map } from "./transformers";
import { createMemoryStreamStore } from "./stores/memory";
import {
  isStreamError,
  isStreamReadError,
  streamStoreError,
  type StreamError,
  type StreamStore,
  type StreamItem,
} from "./types";

/** A store that writes fine but fails every read. */
function createFailingReadStore(): StreamStore {
  const inner = createMemoryStreamStore();
  return {
    append: inner.append.bind(inner),
    getMetadata: inner.getMetadata.bind(inner),
    closeStream: inner.closeStream.bind(inner),
    subscribe: inner.subscribe.bind(inner),
    read: async <T>(): AsyncResult<StreamItem<T>[], ReturnType<typeof streamStoreError>> =>
      err(streamStoreError("connection", "stream store unreachable")),
  } as StreamStore;
}

const noop = async (): AsyncResult<void, never> => ok(undefined);

describe("stream failures at the workflow boundary", () => {
  it("surfaces a read failure as a typed error, not UnexpectedError", async () => {
    const workflow = createWorkflow("reader", { noop }, {
      streamStore: createFailingReadStore(),
    });

    const result = await workflow.run(async ({ step, deps }) => {
      await step("noop", () => deps.noop());
      const reader = step.getReadable<string>({ namespace: "lines" });
      return await collect(reader);
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(isUnexpectedError(result.error)).toBe(false);
    expect(isStreamReadError(result.error)).toBe(true);
    // Matched at the boundary the same way STEP_TIMEOUT is
    expect((result.error as StreamError).type ?? result.error).toBe("STREAM_READ_ERROR");
  });

  it("does the same through a transformer pipeline", async () => {
    const workflow = createWorkflow("reader", { noop }, {
      streamStore: createFailingReadStore(),
    });

    const result = await workflow.run(async ({ step, deps }) => {
      await step("noop", () => deps.noop());
      const reader = step.getReadable<string>({ namespace: "lines" });
      return await collect(pipe(reader, (s) => map(s, (line) => line.toUpperCase())));
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(isStreamReadError(result.error)).toBe(true);
  });

  it("does the same for a bare for-await loop", async () => {
    const workflow = createWorkflow("reader", { noop }, {
      streamStore: createFailingReadStore(),
    });

    const result = await workflow.run(async ({ step, deps }) => {
      await step("noop", () => deps.noop());
      const reader = step.getReadable<string>({ namespace: "lines" });
      const seen: string[] = [];
      for await (const line of pipe(reader)) seen.push(line);
      return seen;
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(isStreamReadError(result.error)).toBe(true);
  });

  it("still wraps a genuine bug in a transform callback as UnexpectedError", async () => {
    const store = createMemoryStreamStore();
    const workflow = createWorkflow("reader", { noop }, { streamStore: store });

    const result = await workflow.run(async ({ step, deps }) => {
      await step("noop", () => deps.noop());

      const writer = step.getWritable<string>({ namespace: "lines" });
      await writer.write("a");
      await writer.close();

      const reader = step.getReadable<string>({ namespace: "lines" });
      return await collect(
        pipe(reader, (s) =>
          map(s, () => {
            throw new Error("bug in my mapper");
          })
        )
      );
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isUnexpectedError(result.error)).toBe(true);
      expect(isStreamError(result.error)).toBe(false);
    }
  });

  it("lets a declared STREAM_READ_ERROR into the static union", async () => {
    // `errors` puts it in the type, so the boundary can switch exhaustively.
    const workflow = createWorkflow("reader", { noop }, {
      streamStore: createFailingReadStore(),
      errors: ["STREAM_READ_ERROR"],
    });

    const result = await workflow.run(async ({ step, deps }) => {
      await step("noop", () => deps.noop());
      const reader = step.getReadable<string>({ namespace: "lines" });
      return await collect(reader);
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const status =
        (typeof result.error === "object" && result.error && "type" in result.error
          ? result.error.type
          : result.error) === "STREAM_READ_ERROR"
          ? 503
          : 500;
      expect(status).toBe(503);
    }
  });
});

describe("isStreamError", () => {
  it("recognises every member of the StreamError union", () => {
    // One sample per member of StreamError. Add a member to that union and
    // this list should grow with it.
    for (const type of [
      "STREAM_WRITE_ERROR",
      "STREAM_READ_ERROR",
      "STREAM_CLOSE_ERROR",
      "STREAM_STORE_ERROR",
      "STREAM_BACKPRESSURE_ERROR",
    ]) {
      expect(isStreamError({ type, message: "x" })).toBe(true);
    }
  });

  it("does not claim arbitrary objects", () => {
    expect(isStreamError({ type: "NOT_A_STREAM_THING" })).toBe(false);
    expect(isStreamError(new Error("nope"))).toBe(false);
    expect(isStreamError(null)).toBe(false);
    expect(isStreamError("STREAM_READ_ERROR")).toBe(false);
  });
});
