/**
 * Tests for streaming functionality
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ok, isOk, isErr, isUnexpectedError } from "./core";
import { createWorkflow, createResumeStateCollector, type WorkflowEvent } from "./workflow";
import {
  createMemoryStreamStore,
  createTestableMemoryStreamStore,
  createBackpressureController,
  toAsyncIterable,
  map,
  filter,
  chunk,
  take,
  skip,
  collect,
  reduce,
  pipe,
  isStreamEnded,
  getStreamReader,
  STREAM_WRITE_ERROR,
  type StreamStore,
  type StreamItem,
} from "./streaming/index";

// =============================================================================
// Memory Stream Store Tests
// =============================================================================

describe("createMemoryStreamStore", () => {
  let store: StreamStore;

  beforeEach(() => {
    store = createMemoryStreamStore();
  });

  it("appends and reads items", async () => {
    const item1: StreamItem<string> = { value: "hello", position: 0, ts: Date.now() };
    const item2: StreamItem<string> = { value: "world", position: 1, ts: Date.now() };

    const appendResult1 = await store.append("wf1", "default", item1);
    const appendResult2 = await store.append("wf1", "default", item2);

    expect(isOk(appendResult1)).toBe(true);
    expect(isOk(appendResult2)).toBe(true);

    const readResult = await store.read<string>("wf1", "default", 0);
    expect(isOk(readResult)).toBe(true);
    if (isOk(readResult)) {
      expect(readResult.value).toHaveLength(2);
      expect(readResult.value[0].value).toBe("hello");
      expect(readResult.value[1].value).toBe("world");
    }
  });

  it("reads items from specific index", async () => {
    const items = [
      { value: "a", position: 0, ts: Date.now() },
      { value: "b", position: 1, ts: Date.now() },
      { value: "c", position: 2, ts: Date.now() },
    ];

    for (const item of items) {
      await store.append("wf1", "default", item);
    }

    const readResult = await store.read<string>("wf1", "default", 1);
    expect(isOk(readResult)).toBe(true);
    if (isOk(readResult)) {
      expect(readResult.value).toHaveLength(2);
      expect(readResult.value[0].value).toBe("b");
      expect(readResult.value[1].value).toBe("c");
    }
  });

  it("reads items with limit", async () => {
    const items = [
      { value: "a", position: 0, ts: Date.now() },
      { value: "b", position: 1, ts: Date.now() },
      { value: "c", position: 2, ts: Date.now() },
    ];

    for (const item of items) {
      await store.append("wf1", "default", item);
    }

    const readResult = await store.read<string>("wf1", "default", 0, 2);
    expect(isOk(readResult)).toBe(true);
    if (isOk(readResult)) {
      expect(readResult.value).toHaveLength(2);
      expect(readResult.value[0].value).toBe("a");
      expect(readResult.value[1].value).toBe("b");
    }
  });

  it("returns empty array for non-existent stream", async () => {
    const readResult = await store.read<string>("nonexistent", "default", 0);
    expect(isOk(readResult)).toBe(true);
    if (isOk(readResult)) {
      expect(readResult.value).toHaveLength(0);
    }
  });

  it("tracks metadata", async () => {
    const item: StreamItem<string> = { value: "test", position: 0, ts: Date.now() };
    await store.append("wf1", "ns1", item);

    const metaResult = await store.getMetadata("wf1", "ns1");
    expect(isOk(metaResult)).toBe(true);
    if (isOk(metaResult) && metaResult.value) {
      expect(metaResult.value.workflowId).toBe("wf1");
      expect(metaResult.value.namespace).toBe("ns1");
      expect(metaResult.value.length).toBe(1);
      expect(metaResult.value.closed).toBe(false);
    }
  });

  it("closes stream", async () => {
    const item: StreamItem<string> = { value: "test", position: 0, ts: Date.now() };
    await store.append("wf1", "default", item);

    const closeResult = await store.closeStream("wf1", "default");
    expect(isOk(closeResult)).toBe(true);

    const metaResult = await store.getMetadata("wf1", "default");
    expect(isOk(metaResult)).toBe(true);
    if (isOk(metaResult) && metaResult.value) {
      expect(metaResult.value.closed).toBe(true);
      expect(metaResult.value.closedAt).toBeDefined();
    }
  });

  it("prevents writes to closed stream", async () => {
    const item1: StreamItem<string> = { value: "test", position: 0, ts: Date.now() };
    await store.append("wf1", "default", item1);
    await store.closeStream("wf1", "default");

    const item2: StreamItem<string> = { value: "test2", position: 1, ts: Date.now() };
    const appendResult = await store.append("wf1", "default", item2);
    expect(isErr(appendResult)).toBe(true);
    if (isErr(appendResult)) {
      expect(appendResult.error.type).toBe("STREAM_STORE_ERROR");
      expect(appendResult.error.reason).toBe("write_error");
    }
  });

  it("supports subscribers", async () => {
    const received: StreamItem<string>[] = [];
    const unsubscribe = store.subscribe<string>("wf1", "default", (item) => {
      received.push(item);
    });

    const item1: StreamItem<string> = { value: "hello", position: 0, ts: Date.now() };
    const item2: StreamItem<string> = { value: "world", position: 1, ts: Date.now() };

    await store.append("wf1", "default", item1);
    await store.append("wf1", "default", item2);

    expect(received).toHaveLength(2);
    expect(received[0].value).toBe("hello");
    expect(received[1].value).toBe("world");

    // Unsubscribe
    unsubscribe();

    const item3: StreamItem<string> = { value: "!", position: 2, ts: Date.now() };
    await store.append("wf1", "default", item3);

    // Should not receive item3
    expect(received).toHaveLength(2);
  });
});

// =============================================================================
// Backpressure Controller Tests
// =============================================================================

describe("createBackpressureController", () => {
  it("starts in flowing state", () => {
    const controller = createBackpressureController({ highWaterMark: 4 });
    expect(controller.state).toBe("flowing");
    expect(controller.bufferedCount).toBe(0);
  });

  it("transitions to paused when reaching high water mark", () => {
    const controller = createBackpressureController({ highWaterMark: 4 });

    controller.increment();
    controller.increment();
    controller.increment();
    expect(controller.state).toBe("flowing");

    controller.increment();
    expect(controller.state).toBe("paused");
    expect(controller.bufferedCount).toBe(4);
  });

  it("transitions back to flowing when below low water mark", () => {
    const controller = createBackpressureController({
      highWaterMark: 4,
      lowWaterMark: 2,
    });

    // Fill up to high water mark
    controller.increment();
    controller.increment();
    controller.increment();
    controller.increment();
    expect(controller.state).toBe("paused");

    // Drain one - still above low water mark
    controller.decrement();
    expect(controller.state).toBe("paused");
    expect(controller.bufferedCount).toBe(3);

    // Drain to low water mark
    controller.decrement();
    expect(controller.state).toBe("flowing");
    expect(controller.bufferedCount).toBe(2);
  });

  it("calls onStateChange callback", () => {
    const stateChanges: string[] = [];
    const controller = createBackpressureController({
      highWaterMark: 2,
      onStateChange: (state) => stateChanges.push(state),
    });

    controller.increment();
    controller.increment();
    expect(stateChanges).toEqual(["paused"]);

    controller.decrement();
    controller.decrement();
    expect(stateChanges).toEqual(["paused", "flowing"]);
  });

  it("waitForDrain resolves immediately when flowing", async () => {
    const controller = createBackpressureController({ highWaterMark: 4 });
    await controller.waitForDrain();
    expect(controller.state).toBe("flowing");
  });

  it("waitForDrain waits until flowing", async () => {
    const controller = createBackpressureController({
      highWaterMark: 2,
      lowWaterMark: 1,
    });

    controller.increment();
    controller.increment();
    expect(controller.state).toBe("paused");

    let resolved = false;
    const drainPromise = controller.waitForDrain().then(() => {
      resolved = true;
    });

    // Still paused
    expect(resolved).toBe(false);

    // Drain below low water mark
    controller.decrement();
    expect(controller.state).toBe("flowing");

    await drainPromise;
    expect(resolved).toBe(true);
  });

  it("reset clears state", () => {
    const controller = createBackpressureController({ highWaterMark: 2 });

    controller.increment();
    controller.increment();
    expect(controller.state).toBe("paused");

    controller.reset();
    expect(controller.state).toBe("flowing");
    expect(controller.bufferedCount).toBe(0);
  });
});

// =============================================================================
// Workflow Streaming Integration Tests
// =============================================================================

describe("createWorkflow with streaming", () => {
  it("writes and reads from stream within same workflow", async () => {
    const streamStore = createMemoryStreamStore();
    const deps = {};

    const workflow = createWorkflow(deps, { streamStore });

    const result = await workflow(async (step) => {
      const writer = step.getWritable<string>({ namespace: "test" });

      await writer.write("item1");
      await writer.write("item2");
      await writer.write("item3");
      await writer.close();

      // Read in the same workflow (same workflowId)
      const reader = step.getReadable<string>({ namespace: "test" });
      const items: string[] = [];

      let readResult = await reader.read();
      while (readResult.ok) {
        items.push(readResult.value);
        readResult = await reader.read();
      }

      return items;
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual(["item1", "item2", "item3"]);
    }
  });

  it("releases backpressure when reader consumes items", async () => {
    const streamStore = createMemoryStreamStore();
    const workflow = createWorkflow({}, { streamStore });

    const result = await workflow(async (step) => {
      const writer = step.getWritable<string>({
        namespace: "backpressure",
        highWaterMark: 1,
      });
      const reader = step.getReadable<string>({ namespace: "backpressure" });

      const writeResult1 = await writer.write("first");
      if (!writeResult1.ok) {
        return writeResult1;
      }

      const writeResult2Promise = writer.write("second");

      const readResult = await reader.read();
      if (!readResult.ok) {
        return readResult;
      }

      return Promise.race([
        writeResult2Promise,
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 20)),
      ]);
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).not.toBe("timeout");
    }
  });

  it("emits stream events", async () => {
    const streamStore = createMemoryStreamStore();
    const events: WorkflowEvent<unknown>[] = [];

    const workflow = createWorkflow(
      {},
      {
        streamStore,
        onEvent: (event) => events.push(event),
      }
    );

    await workflow(async (step) => {
      const writer = step.getWritable<string>({ namespace: "events-test" });
      await writer.write("hello");
      await writer.close();
    });

    const streamCreated = events.find((e) => e.type === "stream_created");
    const streamWrite = events.find((e) => e.type === "stream_write");
    const streamClose = events.find((e) => e.type === "stream_close");

    expect(streamCreated).toBeDefined();
    expect(streamWrite).toBeDefined();
    expect(streamClose).toBeDefined();

    if (streamCreated?.type === "stream_created") {
      expect(streamCreated.namespace).toBe("events-test");
    }
    if (streamWrite?.type === "stream_write") {
      expect(streamWrite.position).toBe(0);
    }
    if (streamClose?.type === "stream_close") {
      expect(streamClose.finalPosition).toBe(1);
    }
  });

  it("waits for first write when reader starts before any items exist", async () => {
    const streamStore = createMemoryStreamStore();
    const workflow = createWorkflow({}, { streamStore });

    const result = await workflow(async (step) => {
      const writer = step.getWritable<string>({ namespace: "delayed" });
      const reader = step.getReadable<string>({
        namespace: "delayed",
        pollInterval: 5,
        pollTimeout: 50,
      });

      const writePromise = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        await writer.write("hello");
        await writer.close();
      })();

      const readResult = await reader.read();
      await writePromise;
      return readResult;
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(isOk(result.value)).toBe(true);
      if (isOk(result.value)) {
        expect(result.value.value).toBe("hello");
      }
    }
  });

  it("waits when reader starts before writer is created", async () => {
    const streamStore = createMemoryStreamStore();
    const workflow = createWorkflow({}, { streamStore });

    const result = await workflow(async (step) => {
      const reader = step.getReadable<string>({
        namespace: "late-writer",
        pollInterval: 5,
        pollTimeout: 50,
      });

      const readPromise = reader.read();

      await new Promise((resolve) => setTimeout(resolve, 10));
      const writer = step.getWritable<string>({ namespace: "late-writer" });
      await writer.write("late");
      await writer.close();

      return readPromise;
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(isOk(result.value)).toBe(true);
      if (isOk(result.value)) {
        expect(result.value.value).toBe("late");
      }
    }
  });

  it("honors startIndex when reading from stream", async () => {
    const streamStore = createMemoryStreamStore();
    const workflow = createWorkflow({}, { streamStore });

    const result = await workflow(async (step) => {
      const writer = step.getWritable<number>({ namespace: "start-index" });
      await writer.write(1);
      await writer.write(2);
      await writer.write(3);
      await writer.close();

      const reader = step.getReadable<number>({
        namespace: "start-index",
        startIndex: 2,
      });

      const readResult = await reader.read();
      return readResult;
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(isOk(result.value)).toBe(true);
      if (isOk(result.value)) {
        expect(result.value.value).toBe(3);
      }
    }
  });

  it("returns UnexpectedError when streamStore not provided", async () => {
    const workflow = createWorkflow({});

    const result = await workflow(async (step) => {
      step.getWritable<string>();
      return "should not reach";
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(isUnexpectedError(result.error)).toBe(true);
    }
  });

  it("supports external reader with getStreamReader", async () => {
    const streamStore = createMemoryStreamStore();
    let capturedWorkflowId = "";

    const workflow = createWorkflow(
      {},
      {
        streamStore,
        onEvent: (event) => {
          if (event.type === "workflow_start") {
            capturedWorkflowId = event.workflowId;
          }
        },
      }
    );

    // Write items in workflow
    await workflow(async (step) => {
      const writer = step.getWritable<number>({ namespace: "external" });
      for (let i = 0; i < 10; i++) {
        await writer.write(i);
      }
      await writer.close();
    });

    // Read externally using getStreamReader (simulating HTTP handler)
    const reader = getStreamReader<number>({
      store: streamStore,
      workflowId: capturedWorkflowId,
      namespace: "external",
      startIndex: 5,
      pollTimeout: 100, // Short timeout for test
    });

    const items: number[] = [];
    for await (const item of toAsyncIterable(reader)) {
      items.push(item);
    }

    expect(items).toEqual([5, 6, 7, 8, 9]);
  });

  it("supports multiple namespaces in same workflow", async () => {
    const streamStore = createMemoryStreamStore();
    const workflow = createWorkflow({}, { streamStore });

    const result = await workflow(async (step) => {
      const writer1 = step.getWritable<string>({ namespace: "ns1" });
      const writer2 = step.getWritable<string>({ namespace: "ns2" });

      await writer1.write("a");
      await writer2.write("b");
      await writer1.write("c");
      await writer2.write("d");

      await writer1.close();
      await writer2.close();

      // Read both namespaces in same workflow
      const reader1 = step.getReadable<string>({ namespace: "ns1" });
      const reader2 = step.getReadable<string>({ namespace: "ns2" });

      const items1: string[] = [];
      let r1 = await reader1.read();
      while (r1.ok) {
        items1.push(r1.value);
        r1 = await reader1.read();
      }

      const items2: string[] = [];
      let r2 = await reader2.read();
      while (r2.ok) {
        items2.push(r2.value);
        r2 = await reader2.read();
      }

      return { ns1: items1, ns2: items2 };
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.ns1).toEqual(["a", "c"]);
      expect(result.value.ns2).toEqual(["b", "d"]);
    }
  });
});

// =============================================================================
// Stream Transformer Tests
// =============================================================================

describe("stream transformers", () => {
  describe("toAsyncIterable", () => {
    it("converts StreamReader to AsyncIterable", async () => {
      const store = createMemoryStreamStore();

      // Write items directly to store with known workflowId
      const workflowId = "test-workflow-id";
      await store.append(workflowId, "ns", { value: 1, position: 0, ts: Date.now() });
      await store.append(workflowId, "ns", { value: 2, position: 1, ts: Date.now() });
      await store.append(workflowId, "ns", { value: 3, position: 2, ts: Date.now() });
      await store.closeStream(workflowId, "ns");

      // Use external reader
      const reader = getStreamReader<number>({
        store,
        workflowId,
        namespace: "ns",
        pollTimeout: 100,
      });

      const items: number[] = [];
      for await (const item of toAsyncIterable(reader)) {
        items.push(item);
      }

      expect(items).toEqual([1, 2, 3]);
    });
  });

  describe("map", () => {
    it("transforms each item", async () => {
      async function* source() {
        yield 1;
        yield 2;
        yield 3;
      }

      const doubled: number[] = [];
      for await (const item of map(source(), (n) => n * 2)) {
        doubled.push(item);
      }

      expect(doubled).toEqual([2, 4, 6]);
    });

    it("supports async transform", async () => {
      async function* source() {
        yield "a";
        yield "b";
      }

      const upper: string[] = [];
      for await (const item of map(source(), async (s) => s.toUpperCase())) {
        upper.push(item);
      }

      expect(upper).toEqual(["A", "B"]);
    });
  });

  describe("filter", () => {
    it("filters items by predicate", async () => {
      async function* source() {
        yield 1;
        yield 2;
        yield 3;
        yield 4;
        yield 5;
      }

      const evens: number[] = [];
      for await (const item of filter(source(), (n) => n % 2 === 0)) {
        evens.push(item);
      }

      expect(evens).toEqual([2, 4]);
    });

    it("supports async predicate", async () => {
      async function* source() {
        yield 1;
        yield 2;
        yield 3;
      }

      const results: number[] = [];
      for await (const item of filter(source(), async (n) => n > 1)) {
        results.push(item);
      }

      expect(results).toEqual([2, 3]);
    });
  });

  describe("chunk", () => {
    it("groups items into chunks", async () => {
      async function* source() {
        for (let i = 1; i <= 7; i++) yield i;
      }

      const chunks: number[][] = [];
      for await (const batch of chunk(source(), 3)) {
        chunks.push(batch);
      }

      expect(chunks).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    });

    it("throws for invalid chunk size", async () => {
      async function* source() {
        yield 1;
      }

      await expect(async () => {
        for await (const _ of chunk(source(), 0)) {
          // Should throw
        }
      }).rejects.toThrow("Chunk size must be at least 1");
    });
  });

  describe("take", () => {
    it("takes first N items", async () => {
      async function* source() {
        for (let i = 1; i <= 10; i++) yield i;
      }

      const results: number[] = [];
      for await (const item of take(source(), 3)) {
        results.push(item);
      }

      expect(results).toEqual([1, 2, 3]);
    });

    it("handles count larger than source", async () => {
      async function* source() {
        yield 1;
        yield 2;
      }

      const results = await collect(take(source(), 10));
      expect(results).toEqual([1, 2]);
    });
  });

  describe("skip", () => {
    it("skips first N items", async () => {
      async function* source() {
        for (let i = 1; i <= 5; i++) yield i;
      }

      const results = await collect(skip(source(), 2));
      expect(results).toEqual([3, 4, 5]);
    });
  });

  describe("collect", () => {
    it("collects all items into array", async () => {
      async function* source() {
        yield "a";
        yield "b";
        yield "c";
      }

      const result = await collect(source());
      expect(result).toEqual(["a", "b", "c"]);
    });
  });

  describe("reduce", () => {
    it("reduces stream to single value", async () => {
      async function* source() {
        yield 1;
        yield 2;
        yield 3;
        yield 4;
      }

      const sum = await reduce(source(), (acc, n) => acc + n, 0);
      expect(sum).toBe(10);
    });

    it("supports async reducer", async () => {
      async function* source() {
        yield "hello";
        yield "world";
      }

      const result = await reduce(
        source(),
        async (acc, s) => acc + s.length,
        0
      );
      expect(result).toBe(10);
    });
  });

  describe("pipe", () => {
    it("composes transformers", async () => {
      async function* source() {
        for (let i = 1; i <= 10; i++) yield i;
      }

      const result = await collect(
        pipe(
          source(),
          (s) => filter(s, (n) => n % 2 === 0),
          (s) => map(s, (n) => n * 10),
          (s) => take(s, 3)
        )
      );

      expect(result).toEqual([20, 40, 60]);
    });
  });
});

// =============================================================================
// Stream Error Handling Tests
// =============================================================================

describe("stream error handling", () => {
  it("write to closed stream returns error", async () => {
    const streamStore = createMemoryStreamStore();
    const workflow = createWorkflow({}, { streamStore });

    const result = await workflow(async (step) => {
      const writer = step.getWritable<string>({ namespace: "test" });
      await writer.write("first");
      await writer.close();

      const writeResult = await writer.write("second");
      return writeResult;
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const writeResult = result.value;
      expect(isErr(writeResult)).toBe(true);
      if (isErr(writeResult)) {
        expect(writeResult.error.type).toBe(STREAM_WRITE_ERROR);
        expect(writeResult.error.reason).toBe("closed");
      }
    }
  });

  it("close already closed stream returns error", async () => {
    const streamStore = createMemoryStreamStore();
    const workflow = createWorkflow({}, { streamStore });

    const result = await workflow(async (step) => {
      const writer = step.getWritable<string>({ namespace: "test" });
      await writer.close();
      const closeResult = await writer.close();
      return closeResult;
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const closeResult = result.value;
      expect(isErr(closeResult)).toBe(true);
      if (isErr(closeResult)) {
        expect(closeResult.error.type).toBe("STREAM_CLOSE_ERROR");
        expect(closeResult.error.reason).toBe("already_closed");
      }
    }
  });

  it("read from empty stream returns STREAM_ENDED", async () => {
    const streamStore = createMemoryStreamStore();
    const workflow = createWorkflow({}, { streamStore });

    const result = await workflow(async (step) => {
      // Use short pollTimeout since no writer will ever exist
      const reader = step.getReadable<string>({
        namespace: "empty",
        pollTimeout: 50,
      });
      const readResult = await reader.read();
      return readResult;
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const readResult = result.value;
      expect(isErr(readResult)).toBe(true);
      if (isErr(readResult)) {
        expect(isStreamEnded(readResult.error)).toBe(true);
      }
    }
  });

  it("writer.abort emits error event", async () => {
    const streamStore = createMemoryStreamStore();
    const events: WorkflowEvent<unknown>[] = [];

    const workflow = createWorkflow(
      {},
      {
        streamStore,
        onEvent: (event) => events.push(event),
      }
    );

    await workflow(async (step) => {
      const writer = step.getWritable<string>({ namespace: "abort-test" });
      await writer.write("before abort");
      writer.abort(new Error("test abort"));
      return "done";
    });

    const errorEvent = events.find((e) => e.type === "stream_error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "stream_error") {
      expect(errorEvent.namespace).toBe("abort-test");
      expect(errorEvent.error).toBeInstanceOf(Error);
    }
  });
});

// =============================================================================
// streamForEach Tests
// =============================================================================

describe("step.streamForEach", () => {
  it("processes items from stream in same workflow", async () => {
    const streamStore = createMemoryStreamStore();
    const deps = {
      process: async (item: number) => ok(item * 2),
    };

    const workflow = createWorkflow(deps, { streamStore });
    const result = await workflow(async (step, deps) => {
      // Write items
      const writer = step.getWritable<number>({ namespace: "process" });
      for (let i = 1; i <= 5; i++) {
        await writer.write(i);
      }
      await writer.close();

      // Process items in same workflow
      const reader = step.getReadable<number>({ namespace: "process" });
      return step.streamForEach(reader, async (item) => deps.process(item));
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.processedCount).toBe(5);
      expect(result.value.results).toEqual([2, 4, 6, 8, 10]);
    }
  });

  it("checkpoints processed items via step_complete events", async () => {
    const streamStore = createMemoryStreamStore();
    const collector = createResumeStateCollector();

    const workflow = createWorkflow(
      {},
      {
        streamStore,
        onEvent: collector.handleEvent,
      }
    );

    const result = await workflow(async (step) => {
      const writer = step.getWritable<number>({ namespace: "checkpoint" });
      await writer.write(1);
      await writer.write(2);
      await writer.write(3);
      await writer.close();

      const reader = step.getReadable<number>({ namespace: "checkpoint" });
      return step.streamForEach(
        reader,
        async (item) => ok(item),
        { checkpointInterval: 1 }
      );
    });

    expect(isOk(result)).toBe(true);
    const state = collector.getResumeState();
    expect(state.steps.size).toBe(3);
  });

  it("uses stream positions for checkpoint keys to avoid collisions", async () => {
    const streamStore = createMemoryStreamStore();
    const events: WorkflowEvent<unknown>[] = [];

    const workflow = createWorkflow(
      {},
      {
        streamStore,
        onEvent: (e) => events.push(e),
      }
    );

    // Process stream items in two passes with different startIndex
    // This verifies position-based keys don't collide
    const result = await workflow(async (step) => {
      const writer = step.getWritable<number>({ namespace: "positions" });
      await writer.write(10);
      await writer.write(20);
      await writer.write(30);
      await writer.close();

      // First pass: process from position 0
      const reader1 = step.getReadable<number>({ namespace: "positions" });
      const firstPass = await step.streamForEach(
        reader1,
        async (item) => ok(item * 2),
        { checkpointInterval: 1 }
      );

      // Second pass: process from position 1 (should use different keys)
      const reader2 = step.getReadable<number>({
        namespace: "positions",
        startIndex: 1,
        pollTimeout: 50,
      });
      const secondPass = await step.streamForEach(
        reader2,
        async (item) => ok(item * 3), // Different multiplier to verify actual processing
        { checkpointInterval: 1 }
      );

      return { firstPass, secondPass };
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      // First pass should have doubled values for positions 0, 1, 2
      expect(result.value.firstPass.results).toEqual([20, 40, 60]);
      // Second pass should have tripled values for positions 1, 2 (NOT cached doubled values)
      expect(result.value.secondPass.results).toEqual([60, 90]);
    }

    // Verify step_complete events have position-based keys
    const stepCompleteEvents = events.filter(e => e.type === "step_complete");
    const keys = stepCompleteEvents
      .map(e => (e as { stepKey?: string }).stepKey)
      .filter(k => k?.startsWith("stream-foreach:positions:"));

    // Should have unique position-based keys
    expect(keys).toContain("stream-foreach:positions:pos-0");
    expect(keys).toContain("stream-foreach:positions:pos-1");
    expect(keys).toContain("stream-foreach:positions:pos-2");
  });

  it("works with AsyncIterable source", async () => {
    const streamStore = createMemoryStreamStore();
    const deps = {
      process: async (s: string) => ok(s.toUpperCase()),
    };

    async function* source() {
      yield "hello";
      yield "world";
    }

    const workflow = createWorkflow(deps, { streamStore });
    const result = await workflow(async (step, deps) => {
      return step.streamForEach(
        source(),
        async (item) => deps.process(item)
      );
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.results).toEqual(["HELLO", "WORLD"]);
    }
  });

  it("processes async iterable items before source completes when concurrency > 1", async () => {
    const streamStore = createMemoryStreamStore();
    const workflow = createWorkflow({}, { streamStore });

    const result = await workflow(async (step) => {
      let startedProcessing = false;
      let release!: () => void;
      const releasePromise = new Promise<void>((resolve) => {
        release = resolve;
      });

      async function* source() {
        yield 1;
        await releasePromise;
      }

      const processingPromise = step.streamForEach(
        source(),
        async (item) => {
          startedProcessing = true;
          return ok(item);
        },
        { concurrency: 2 }
      );

      const processingStarted = await Promise.race([
        new Promise<"started">((resolve) => {
          const interval = setInterval(() => {
            if (startedProcessing) {
              clearInterval(interval);
              resolve("started");
            }
          }, 1);
        }),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 20)),
      ]);

      release();
      await processingPromise;
      return processingStarted;
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe("started");
    }
  });

  it("preserves all results when concurrency slots complete out of order", async () => {
    const streamStore = createMemoryStreamStore();
    const workflow = createWorkflow({}, { streamStore });

    const result = await workflow(async (step) => {
      const writer = step.getWritable<number>({ namespace: "out-of-order" });
      await writer.write(1);
      await writer.write(2);
      await writer.write(3);
      await writer.close();

      const reader = step.getReadable<number>({ namespace: "out-of-order" });
      return step.streamForEach(
        reader,
        async (item) => {
          if (item === 1) {
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
          if (item === 2) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          return ok(item);
        },
        { concurrency: 2 }
      );
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.results).toHaveLength(3);
      expect(result.value.results).toEqual([1, 2, 3]);
    }
  });

  it("honors concurrency option when processing items", async () => {
    const streamStore = createMemoryStreamStore();
    const workflow = createWorkflow({}, { streamStore });
    let inFlight = 0;
    let maxInFlight = 0;

    const result = await workflow(async (step) => {
      const writer = step.getWritable<number>({ namespace: "concurrency" });
      for (let i = 0; i < 4; i++) {
        await writer.write(i);
      }
      await writer.close();

      const reader = step.getReadable<number>({ namespace: "concurrency" });
      return step.streamForEach(
        reader,
        async (item) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 10));
          inFlight--;
          return ok(item);
        },
        { checkpointInterval: 1, concurrency: 2 }
      );
    });

    expect(isOk(result)).toBe(true);
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
  });

  it("processes items before stream is closed when concurrency > 1", async () => {
    const streamStore = createMemoryStreamStore();
    const workflow = createWorkflow({}, { streamStore });

    const result = await workflow(async (step) => {
      const writer = step.getWritable<number>({ namespace: "live" });
      const reader = step.getReadable<number>({
        namespace: "live",
        pollInterval: 5,
        pollTimeout: 50,
      });

      const processed: number[] = [];
      const processingPromise = step.streamForEach(
        reader,
        async (item) => {
          processed.push(item);
          return ok(item);
        },
        { checkpointInterval: 1, concurrency: 2 }
      );

      await writer.write(1);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const processedBeforeClose = processed.length;
      await writer.close();
      await processingPromise;

      return processedBeforeClose;
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBeGreaterThanOrEqual(1);
    }
  });
});

// =============================================================================
// Testable Memory Store Tests
// =============================================================================

describe("createTestableMemoryStreamStore", () => {
  it("provides additional inspection methods", async () => {
    const store = createTestableMemoryStreamStore();

    expect(store.keys()).toEqual([]);
    expect(store.has("wf1", "ns1")).toBe(false);

    await store.append("wf1", "ns1", { value: "test", position: 0, ts: Date.now() });

    expect(store.keys()).toEqual(["wf1:ns1"]);
    expect(store.has("wf1", "ns1")).toBe(true);

    store.delete("wf1", "ns1");
    expect(store.has("wf1", "ns1")).toBe(false);

    await store.append("wf1", "ns2", { value: "test", position: 0, ts: Date.now() });
    store.clear();
    expect(store.keys()).toEqual([]);
  });
});
